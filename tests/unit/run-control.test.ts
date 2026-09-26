import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "../../packages/control-storage";
import { PipelineControl, emptyPipelineDatabase } from "../../packages/pipeline-control/service";
import { examplePipeline } from "../../packages/pipeline-model";
import { RunControl } from "../../packages/run-control/service";
import { emptyRunDatabase, type Capabilities, type Observation, type Run } from "../../packages/run-control/contracts";
import type { Assignment, ExecutionAdapter } from "../../packages/run-control/adapter";
import type { PlacementResolver } from "../../packages/run-control/placement";
import { createMcpServer } from "../../apps/mcp/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const actor = { id: "operator", workspaceIds: ["local"], scopes: ["pipelines.read", "pipelines.write", "runs.read", "runs.write"] };
const image = `training@sha256:${"a".repeat(64)}`;
class Adapter implements ExecutionAdapter {
  records = new Map<string, Observation>(); starts: Assignment[] = []; timeoutAfterStart = false;
  capabilities: Capabilities = { image, contractVersion: "cyrene.studio.execution.v1", mutableFields: ["learningRate"], checkpoint: true, safeRetry: true };
  async preflight() { return this.capabilities; }
  async lookup(id: string): Promise<Observation> { return this.records.get(id) ?? { state: "absent", authoritative: true }; }
  async start(input: Assignment): Promise<Observation> {
    if (this.records.has(input.attemptId)) return this.records.get(input.attemptId)!;
    this.starts.push(input);
    const observation: Observation = { state: "running", attemptId: input.attemptId, generation: input.generation, taskId: crypto.randomUUID(), serverId: input.placement.serverId ?? "server-a", outputs: {}, terminalAuthority: false, retryable: false, events: [] };
    this.records.set(input.attemptId, observation);
    if (this.timeoutAfterStart) throw new Error("response lost");
    return observation;
  }
  async stop(id: string): Promise<Observation> { const old = this.records.get(id)!; if (old.state === "absent") return old; const next = { ...old, state: "stopped" as const, terminalAuthority: true }; this.records.set(id, next); return next; }
  async change(id: string, _workspace: string, config: any): Promise<Observation> { const old = this.records.get(id)!; if (old.state === "absent") return old; const next = { ...old, appliedConfig: config, effectiveStep: 12 }; this.records.set(id, next); return next; }
  finish(id: string, state: "succeeded" | "failed", authoritative = true) { const old = this.records.get(id)!; if (old.state === "absent") throw new Error(); this.records.set(id, { ...old, state, terminalAuthority: authoritative, retryable: true, outputs: { model: { uri: `artifact://sha256/${"b".repeat(64)}`, digest: `sha256:${"b".repeat(64)}`, kind: "model", sizeBytes: 42, manifestDigest: `sha256:${"b".repeat(64)}` } }, checkpoint: { uri: `artifact://sha256/${"c".repeat(64)}`, digest: `sha256:${"c".repeat(64)}`, kind: "checkpoint", sizeBytes: 21 } }); }
}
async function fixture() {
  const pipelines = new PipelineControl(new MemoryStateStore(emptyPipelineDatabase()));
  const document = examplePipeline();
  document.nodes = document.nodes.filter(n => !["deployment", "agent"].includes(n.id));
  document.edges = document.edges.filter(e => document.nodes.some(n => n.id === e.to.node));
  delete document.presentation.nodes.deployment; delete document.presentation.nodes.agent;
  const dataset = document.nodes.find(n => n.id === "dataset")!, model = document.nodes.find(n => n.id === "model")!;
  dataset.config.datasetRef = `artifact://sha256/${"d".repeat(64)}`;
  dataset.settingsBinding = { kind: "dataset-version", resourceId: "dataset-v1", artifact: { uri: dataset.config.datasetRef as string, digest: `sha256:${"d".repeat(64)}`, size_bytes: 100, kind: "dataset", manifest_digest: null } };
  model.config.modelRef = `artifact://sha256/${"e".repeat(64)}`;
  model.settingsBinding = { kind: "model-import", resourceId: "model-v1", artifact: { uri: model.config.modelRef as string, digest: `sha256:${"e".repeat(64)}`, size_bytes: 200, kind: "model", manifest_digest: `sha256:${"e".repeat(64)}` } };
  await pipelines.execute({ name: "pipelines.create", input: { workspaceId: "local", document }, requestId: "create", idempotencyKey: "create" }, actor);
  const store = new MemoryStateStore(emptyRunDatabase()), training = new Adapter(), evaluation = new Adapter();
  const adapters = new Map<string, ExecutionAdapter>([["yield", training], ["echo", evaluation]]);
  let now = Date.now();
  const resolver: PlacementResolver = { resolve: async (_workspace, placement) => placement.serverId ? [{ serverId: placement.serverId, revision: 1, nodeRef: { nodeId: `node-${placement.serverId}`, epoch: "9007199254740993" } }] : [] };
  const control = new RunControl(store, pipelines, adapters, () => now, resolver);
  const call = (name: string, input: unknown, key: string = crypto.randomUUID()): Promise<any> => control.execute({ name, input, requestId: crypto.randomUUID(), idempotencyKey: key }, actor);
  const input = { workspaceId: "local", pipelineId: document.id, expectedGraphRevision: 1, placements: { training: { serverId: "server-a", acceleratorCount: 1 }, evaluation: { serverId: "server-b", acceleratorCount: 1 } } };
  const preflight = await call("runs.preflight", input); expect(preflight.issues).toEqual([]);
  const run: Run = await call("runs.start", { ...input, expectedFingerprint: preflight.fingerprint }, "start");
  const get = (): Promise<Run> => call("runs.get", { workspaceId: "local", runId: run.id });
  return { control, store, adapters, pipelines, training, evaluation, call, get, run, resolver, input, advanceTime: (milliseconds: number) => { now += milliseconds; } };
}
describe("durable workflow coordination", () => {
  it("requires fresh preflight for resource-reference changes instead of reusing old placement", async () => {
    const f = await fixture();
    const node = f.run.document.nodes.find(n => n.type === "compute")!;
    const input = { workspaceId: "local", runId: f.run.id, expectedRevision: f.run.revision, nodeId: node.id, config: { ...node.config, count: 2 } };
    const preview = await f.call("runs.preview_change", input);
    expect(preview.mode).toBe("rejected");
    await expect(f.call("runs.apply_change", { ...input, expectedFingerprint: preview.fingerprint })).rejects.toMatchObject({ code: "CHANGE_REJECTED" });
    expect(await f.get()).toEqual(f.run);
  });
  it("ends failed dependency chains and permits explicit recovery after confirmed termination", async () => {
    const f = await fixture(); await f.control.tick();
    f.training.capabilities.safeRetry = false;
    const id = f.training.starts[0].attemptId;
    f.training.finish(id, "failed");
    const failed = f.training.records.get(id)!;
    if (failed.state !== "absent") failed.retryable = false;
    await f.control.tick();
    const run = await f.get();
    expect(run.state).toBe("failed");
    expect(run.steps.find(s => s.nodeId === "evaluation")).toMatchObject({ state: "stopped", generation: 0 });
    expect(f.evaluation.starts).toHaveLength(0);
    await f.call("runs.resume", { workspaceId: "local", runId: run.id, expectedRevision: run.revision });
    await f.control.tick(); expect(f.training.starts).toHaveLength(2);
  });
  it("stops never-dispatched work even when its execution adapter was removed", async () => {
    const f = await fixture(); f.adapters.clear();
    await f.call("runs.stop", { workspaceId: "local", runId: f.run.id, expectedRevision: f.run.revision });
    await f.control.tick(); expect((await f.get()).state).toBe("stopped");
    expect(f.training.starts).toHaveLength(0);
  });
  it("does not launch after stop is committed during an in-flight lookup", async () => {
    const f = await fixture();
    f.training.lookup = async () => {
      const run = await f.get();
      await f.call("runs.stop", { workspaceId: "local", runId: run.id, expectedRevision: run.revision });
      return { state: "absent", authoritative: true };
    };
    await f.control.tick(); await f.control.tick();
    expect(f.training.starts).toHaveLength(0); expect((await f.get()).state).toBe("stopped");
  });
  it("pins Node identities into preflight and rejects changed generations before dispatch", async () => {
    const f = await fixture();
    const preview = await f.call("runs.preflight", f.input);
    expect(preview.targets.training[0].nodeRef.epoch).toBe("9007199254740993");
    f.resolver.resolve = async (_workspace, placement) => [{ serverId: placement.serverId!, revision: 2, nodeRef: { nodeId: "replacement", epoch: "9007199254740994" } }];
    await expect(f.call("runs.start", { ...f.input, expectedFingerprint: preview.fingerprint })).rejects.toMatchObject({ code: "PREFLIGHT_CHANGED" });
    await f.control.tick(); expect(f.training.starts).toHaveLength(0);
    expect((await f.get()).state).toBe("failed");
    const events = await f.call("runs.events", { workspaceId: "local", runId: f.run.id });
    expect(events.items.some((e: any) => e.kind === "SERVER_IDENTITY_CHANGED")).toBe(true);
  });
  it("replays atomic observations from a durable cursor and enforces workspace and scope", async () => {
    const f = await fixture(); const input = { workspaceId: "local", runId: f.run.id, limit: 1 };
    const first = await f.call("runs.observe", input);
    await f.control.tick();
    const next = await f.call("runs.observe", { ...input, after: first.cursor, limit: 500 });
    expect(next.items.every((e: any) => e.sequence > first.cursor)).toBe(true);
    expect(next.run).toEqual(await f.get());
    expect((await f.call("runs.observe", { ...input, after: next.cursor })).items).toEqual([]);
    await expect(f.call("runs.observe", { ...input, after: Number.MAX_SAFE_INTEGER })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(f.control.execute({ name: "runs.observe", input, requestId: "read" }, { ...actor, scopes: ["pipelines.read"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.control.execute({ name: "runs.observe", input: { ...input, workspaceId: "other" }, requestId: "read" }, { ...actor, workspaceIds: ["other"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("orders provider events before advancing the persisted cursor", async () => {
    const f = await fixture(); await f.control.tick();
    const value = f.training.records.get(f.training.starts[0].attemptId)!;
    if (value.state !== "absent") value.events = [{ sequence: 2, message: "second" }, { sequence: 1, message: "first" }];
    await f.control.tick(); await f.control.tick();
    const result = await f.call("runs.events", { workspaceId: "local", runId: f.run.id });
    expect(result.items.filter((e: any) => e.kind === "step.log").map((e: any) => e.message)).toEqual(["first", "second"]);
  });
  it("projects graph compute intent into preflight and the immutable run snapshot", async () => {
    const f = await fixture(), node = (await f.get()).document.nodes.find(n => n.type === "compute")!;
    await f.pipelines.execute({ name: "pipelines.patch", input: { workspaceId: "local", pipelineId: f.run.pipelineId, expectedGraphRevision: 1, expectedLayoutRevision: 1, edits: [{ op: "update_node", nodeId: node.id, config: { count: 2, accelerator: "A100" }, settingsBinding: { kind: "server-registration", resourceId: "registered-server", workspaceId: "local" } }] }, requestId: "compute-patch", idempotencyKey: "compute-patch" }, actor);
    const input = { workspaceId: "local", pipelineId: f.run.pipelineId, expectedGraphRevision: 2 };
    const preview = await f.call("runs.preflight", input);
    expect(preview.placements.training).toMatchObject({ serverId: "registered-server", acceleratorCount: 2, accelerator: "A100", provider: "本地资源池" });
    const run = await f.call("runs.start", { ...input, expectedFingerprint: preview.fingerprint });
    expect(run.placements.training).toEqual(preview.placements.training);
    const override = await f.call("runs.preflight", { ...input, placements: { training: { serverId: "explicit", acceleratorCount: 1 } } });
    expect(override.placements.training).toMatchObject({ serverId: "explicit", acceleratorCount: 1, accelerator: "A100" });
  });
  it("recovers a lost start response without launching a duplicate attempt", async () => {
    const f = await fixture(); f.training.timeoutAfterStart = true;
    await f.control.tick(); expect(f.training.starts).toHaveLength(1); expect(f.evaluation.starts).toHaveLength(0);
    const restarted = new RunControl(f.store, f.pipelines, f.adapters, undefined, f.resolver); await restarted.tick();
    expect(f.training.starts).toHaveLength(1); expect((await f.get()).steps.find(s => s.nodeId === "training")?.state).toBe("running");
  });
  it("starts downstream work only after authoritative completion and transfers immutable references", async () => {
    const f = await fixture(); await f.control.tick(); const id = f.training.starts[0].attemptId;
    f.training.finish(id, "succeeded", false); await f.control.tick(); expect(f.evaluation.starts).toHaveLength(0);
    f.training.finish(id, "succeeded"); await f.control.tick(); await f.control.tick();
    expect(f.evaluation.starts).toHaveLength(1); expect(f.evaluation.starts[0].placement.serverId).toBe("server-b");
    expect(f.evaluation.starts[0].inputs.model.digest).toBe(`sha256:${"b".repeat(64)}`);
    expect(f.evaluation.starts[0].inputs.model).toMatchObject({ sizeBytes: 42, manifestDigest: `sha256:${"b".repeat(64)}` });
    expect(f.evaluation.starts[0].inputs.dataset).toMatchObject({ sizeBytes: 100, digest: `sha256:${"d".repeat(64)}` });
  });
  it("requires fenced terminal failure before retry and retains the checkpoint", async () => {
    const f = await fixture(); await f.control.tick(); const id = f.training.starts[0].attemptId;
    f.training.finish(id, "failed", false); await f.control.tick(); await f.control.tick(); expect(f.training.starts).toHaveLength(1);
    f.training.finish(id, "failed"); await f.control.tick(); await f.control.tick();
    expect(f.training.starts).toHaveLength(1);
    f.advanceTime(10_000); await f.control.tick();
    expect(f.training.starts).toHaveLength(2); expect(f.training.starts[1].generation).toBe(2); expect(f.training.starts[1].checkpoint?.digest).toBe(`sha256:${"c".repeat(64)}`);
  });
  it("records requested and effective configuration separately and rejects stale previews", async () => {
    const f = await fixture(); await f.control.tick(); let run = await f.get();
    const config = { ...run.steps.find(s => s.nodeId === "training")!.config, learningRate: 0.001 };
    const input = { workspaceId: "local", runId: run.id, expectedRevision: run.revision, nodeId: "training", config };
    const preview = await f.call("runs.preview_change", input); expect(preview.mode).toBe("online");
    const changed: Run = await f.call("runs.apply_change", { ...input, expectedFingerprint: preview.fingerprint });
    expect(changed.steps.find(s => s.nodeId === "training")?.actualConfig.learningRate).toBe(0.0002);
    await expect(f.call("runs.apply_change", { ...input, expectedFingerprint: preview.fingerprint })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await f.control.tick(); run = await f.get();
    expect(run.steps.find(s => s.nodeId === "training")).toMatchObject({ actualConfig: { learningRate: 0.001 }, effectiveStep: 12 });
  });
  it("branches without overwriting downstream results or stopping the original execution", async () => {
    const f = await fixture(); await f.control.tick(); f.training.finish(f.training.starts[0].attemptId, "succeeded"); await f.control.tick(); await f.control.tick();
    const before = await f.get(), input = { workspaceId: "local", runId: before.id, expectedRevision: before.revision, nodeId: "training", config: { ...before.document.nodes.find(n => n.id === "training")!.config, epochs: 4 } };
    const preview = await f.call("runs.preview_change", input); expect(preview.mode).toBe("branch");
    const branch: Run = await f.call("runs.apply_change", { ...input, expectedFingerprint: preview.fingerprint });
    expect(branch.parentRunId).toBe(before.id); expect(branch.steps.find(s => s.nodeId === "evaluation")?.state).toBe("pending"); expect(await f.get()).toEqual(before);
  });
  it("MCP uses the same operator permission and run state", async () => {
    const f = await fixture(), server = createMcpServer(f.pipelines, actor, f.control), client = new Client({ name: "run-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
    try { expect((await client.listTools()).tools.some(tool => tool.name === "runs.preview_change")).toBe(true); const result = await client.callTool({ name: "runs.get", arguments: { workspaceId: "local", runId: f.run.id } }); expect(result.isError).not.toBe(true); expect((result.structuredContent as Run).id).toBe(f.run.id); const snapshot = await client.callTool({ name: "runs.observe", arguments: { workspaceId: "local", runId: f.run.id } }); expect(snapshot.isError).not.toBe(true); expect((snapshot.structuredContent as { run: Run }).run.id).toBe(f.run.id); }
    finally { await client.close(); await server.close(); }
    await expect(f.control.execute({ name: "runs.stop", input: { workspaceId: "local", runId: f.run.id, expectedRevision: 1 }, requestId: "denied", idempotencyKey: "stop" }, { ...actor, scopes: ["pipelines.write", "runs.read"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("carries accepted online settings into a later branch", async () => {
    const f = await fixture(); await f.control.tick(); let run = await f.get();
    const online = { workspaceId: "local", runId: run.id, expectedRevision: run.revision, nodeId: "training", config: { ...run.steps.find(s => s.nodeId === "training")!.config, learningRate: 0.003 } };
    const preview = await f.call("runs.preview_change", online);
    await f.call("runs.apply_change", { ...online, expectedFingerprint: preview.fingerprint }); await f.control.tick();
    f.training.finish(f.training.starts[0].attemptId, "succeeded"); await f.control.tick(); run = await f.get();
    const branchInput = { workspaceId: "local", runId: run.id, expectedRevision: run.revision, nodeId: "evaluation", config: { ...run.steps.find(s => s.nodeId === "evaluation")!.config, threshold: 0.95 } };
    const branchPreview = await f.call("runs.preview_change", branchInput);
    const branch: Run = await f.call("runs.apply_change", { ...branchInput, expectedFingerprint: branchPreview.fingerprint });
    expect(branch.document.nodes.find(n => n.id === "training")!.config.learningRate).toBe(0.003);
    expect(branch.steps.find(s => s.nodeId === "training")).toMatchObject({ state: "succeeded", config: { learningRate: 0.003 }, actualConfig: { learningRate: 0.003 } });
    expect(await f.get()).toEqual(run);
  });
  it("requires confirmed stop before resume and records a fresh attempt", async () => {
    const f = await fixture(); await f.control.tick(); let run = await f.get();
    await expect(f.call("runs.resume", { workspaceId: "local", runId: run.id, expectedRevision: run.revision })).rejects.toMatchObject({ code: "RESUME_NOT_ALLOWED" });
    await f.call("runs.stop", { workspaceId: "local", runId: run.id, expectedRevision: run.revision }); await f.control.tick(); run = await f.get();
    expect(run.state).toBe("stopped");
    await f.call("runs.resume", { workspaceId: "local", runId: run.id, expectedRevision: run.revision }); await f.control.tick();
    expect(f.training.starts).toHaveLength(2); expect(f.training.starts[1].generation).toBe(2);
    expect((await f.store.read()).attempts.filter(a => a.nodeId === "training")).toHaveLength(2);
  });
});
