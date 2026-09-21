import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { examplePipeline, createNode, type Pipeline } from "../../packages/pipeline-model";
import { nodeSize, TITLE_HEIGHT } from "../../packages/pipeline-model/geometry";
import { createPipelineControl } from "../../tooling/pipeline-control";
import { createMcpServer } from "../../apps/mcp/server";
import { arrange } from "../../packages/pipeline-control/layout";
import { mergeSaveAcknowledgement } from "../../packages/pipeline-control/merge";
import type { PipelineRecord } from "../../packages/pipeline-control/contracts";
import type { Actor } from "../../packages/server-control/contracts";

const folders: string[] = [];
afterEach(async () => { for (const f of folders.splice(0)) await rm(f, { recursive: true, force: true }); });
const actor: Actor = { id: "test-user", workspaceIds: ["local"], scopes: ["pipelines.read", "pipelines.write"] };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-pipelines-")); folders.push(directory);
  const control = createPipelineControl(directory);
  const call = (name: string, input: unknown, key = crypto.randomUUID() as string, who = actor) => control.execute({ name, input, requestId: crypto.randomUUID(), idempotencyKey: key }, who) as Promise<any>;
  const { record } = await call("pipelines.create", { workspaceId: "local", document: examplePipeline() });
  return { directory, control, call, record: record as PipelineRecord };
}
const target = { workspaceId: "local", pipelineId: "instruction-tuning" };
const expected = { ...target, expectedGraphRevision: 1, expectedLayoutRevision: 1 };
const stripLayout = ({ presentation: _, ...p }: Pipeline) => p;

describe("pipeline application service", () => {
  it("retains edits during a save without reverting concurrent server layout", () => {
    const sent = examplePipeline(), current = structuredClone(sent), ack = structuredClone(sent);
    current.nodes.find(n => n.id === "training")!.config.epochs = 9;
    ack.presentation.nodes.training.x = 999;
    const merged = mergeSaveAcknowledgement(sent, current, ack);
    expect(merged.nodes.find(n => n.id === "training")!.config.epochs).toBe(9);
    expect(merged.presentation.nodes.training.x).toBe(999);
  });
  it("persists documents, catalog schemas and revisions across instances", async () => {
    const { directory, call } = await fixture();
    const control = createPipelineControl(directory);
    const record = await control.execute({ name: "pipelines.get", input: target, requestId: "read" }, actor) as PipelineRecord;
    expect(record.document).toEqual(examplePipeline());
    const catalog = await call("nodes.list_types", { workspaceId: "local" });
    expect(catalog.items).toHaveLength(7);
    expect(catalog.items.find((n: any) => n.type === "training").configSchema.properties.epochs.maximum).toBe(10000);
  });
  it("checks permission and workspace, including idempotency replay", async () => {
    const { call } = await fixture();
    await expect(call("pipelines.get", { ...target, workspaceId: "other" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call("pipelines.patch", { ...expected, edits: [{ op: "rename", name: "No" }] }, "key", { ...actor, scopes: ["pipelines.read"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("applies a batch atomically and preserves geometry for parameter edits", async () => {
    const { call, record } = await fixture();
    const result = await call("pipelines.patch", { ...expected, edits: [{ op: "rename", name: "Changed" }, { op: "update_node", nodeId: "training", config: { epochs: 5 } }] });
    expect(result.record).toMatchObject({ graphRevision: 2, layoutRevision: 1 });
    expect(result.record.document.presentation).toEqual(record.document.presentation);
    expect(result.summary).toHaveLength(2);
    await expect(call("pipelines.patch", { ...expected, edits: [{ op: "rename", name: "Stale" }] })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it("rejects an invalid batch without retaining earlier edits", async () => {
    const { call, record } = await fixture();
    await expect(call("pipelines.patch", { ...expected, edits: [{ op: "rename", name: "Should roll back" }, { op: "update_node", nodeId: "training", config: { epochs: -2 } }] })).rejects.toMatchObject({ code: "INVALID_PIPELINE" });
    expect(await call("pipelines.get", target)).toEqual(record);
    expect((await call("pipelines.history", target)).items).toHaveLength(1);
  });
  it("allows parameter and layout edits from the same base to merge", async () => {
    const { call, record } = await fixture();
    const layout = structuredClone(record.document.presentation); layout.nodes.training.x += 50;
    await call("pipelines.save", { ...expected, presentation: layout });
    const graph = stripLayout(record.document); graph.nodes.find(n => n.id === "training")!.config.epochs = 7;
    const result = await call("pipelines.save", { ...expected, graph });
    expect(result.record).toMatchObject({ graphRevision: 2, layoutRevision: 2 });
    expect(result.record.document.presentation).toEqual(layout);
    expect(result.record.document.nodes.find((n: any) => n.id === "training").config.epochs).toBe(7);
  });
  it("replays the same write after restart and refuses key reuse for new content", async () => {
    const { call, directory } = await fixture();
    const input = { ...expected, edits: [{ op: "rename", name: "Idempotent" }] };
    const first = await call("pipelines.patch", input, "stable-key");
    const second = await createPipelineControl(directory).execute({ name: "pipelines.patch", input, requestId: "retry", idempotencyKey: "stable-key" }, actor);
    expect(second).toEqual(first);
    await expect(call("pipelines.patch", { ...input, edits: [{ op: "rename", name: "Different" }] }, "stable-key")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("adds a branch without AI supplied coordinates and rejects invalid ports", async () => {
    const { call } = await fixture();
    const result = await call("pipelines.patch", { ...expected, edits: [{ op: "add_node", node: createNode("evaluation", "eval-2") }, { op: "connect", edge: { id: "eval-link", from: { node: "training", port: "model" }, to: { node: "eval-2", port: "model" } } }] });
    expect(result.record.document.nodes).toHaveLength(8);
    expect(result.record.document.presentation.nodes["eval-2"]).toBeDefined();
    await expect(call("pipelines.patch", { ...expected, expectedGraphRevision: 2, expectedLayoutRevision: 2, edits: [{ op: "connect", edge: { id: "bad", from: { node: "compute", port: "compute" }, to: { node: "eval-2", port: "dataset" } } }] })).rejects.toMatchObject({ code: "INVALID_PIPELINE" });
  });
  it("undoes complete batches with monotonic revisions and stops at creation", async () => {
    const { call } = await fixture();
    await call("pipelines.patch", { ...expected, edits: [{ op: "remove_node", nodeId: "agent" }] });
    await call("pipelines.patch", { ...expected, expectedGraphRevision: 2, expectedLayoutRevision: 2, edits: [{ op: "rename", name: "Second" }] });
    const first = await call("pipelines.undo", { ...expected, expectedGraphRevision: 3, expectedLayoutRevision: 2 });
    expect(first.record.document.name).toBe(examplePipeline().name);
    const second = await call("pipelines.undo", { ...expected, expectedGraphRevision: 4, expectedLayoutRevision: 2 });
    expect(second.record.document).toEqual(examplePipeline());
    expect(second.record).toMatchObject({ graphRevision: 5, layoutRevision: 3 });
    await expect(call("pipelines.undo", { ...expected, expectedGraphRevision: 5, expectedLayoutRevision: 3 })).rejects.toMatchObject({ code: "NOTHING_TO_UNDO" });
  });
  it("validates structure without pretending external execution is available", async () => {
    const { call } = await fixture();
    expect(await call("pipelines.validate", target)).toMatchObject({ issues: [], executable: false });
    await call("pipelines.patch", { ...expected, edits: [{ op: "remove_node", nodeId: "dataset" }] });
    expect((await call("pipelines.validate", target)).issues.some((i: any) => i.code === "MISSING_INPUT")).toBe(true);
  });
});

describe("ELK layout", () => {
  it("is repeatable, leaves semantics intact, and avoids node overlap", async () => {
    const p = examplePipeline(); const result = await arrange(p, { direction: "RIGHT" });
    expect(stripLayout(result)).toEqual(stripLayout(p));
    expect(await arrange(p, { direction: "RIGHT" })).toEqual(result);
    for (const a of result.nodes) for (const b of result.nodes) {
      if (a.id >= b.id) continue;
      const pa = result.presentation.nodes[a.id], pb = result.presentation.nodes[b.id], [aw, ah] = nodeSize(a.type), [bw, bh] = nodeSize(b.type);
      expect(pa.x + aw <= pb.x || pb.x + bw <= pa.x || pa.y + ah + TITLE_HEIGHT <= pb.y || pb.y + bh + TITLE_HEIGHT <= pa.y).toBe(true);
    }
  });
  it("preserves pinned nodes and all positions outside a partial scope", async () => {
    const p = examplePipeline(); p.presentation.nodes.training.pinned = true;
    expect((await arrange(p, { direction: "RIGHT" })).presentation.nodes.training).toEqual(p.presentation.nodes.training);
    const partial = await arrange(p, { direction: "RIGHT", nodeIds: ["model"] });
    for (const n of p.nodes.filter(n => n.id !== "model")) expect(partial.presentation.nodes[n.id]).toEqual(p.presentation.nodes[n.id]);
    await expect(arrange(p, { direction: "RIGHT", nodeIds: ["unknown"] })).rejects.toMatchObject({ code: "UNKNOWN_NODE" });
  });
});

it("MCP tools expose real schemas and share edit/validate state with the UI service", async () => {
  const { control, call } = await fixture();
  const server = createMcpServer(control, actor), client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    const list = await client.listTools(); expect(list.tools.some(t => t.name === "pipelines.patch" && t.inputSchema)).toBe(true);
    const response = await client.callTool({ name: "pipelines.patch", arguments: { ...expected, edits: [{ op: "rename", name: "Edited through MCP" }], idempotencyKey: "mcp-edit" } });
    expect(response.isError).not.toBe(true);
    expect((await call("pipelines.get", target)).document.name).toBe("Edited through MCP");
    const conflict = await client.callTool({ name: "pipelines.patch", arguments: { ...expected, edits: [{ op: "rename", name: "Stale" }], idempotencyKey: "stale" } });
    expect(conflict.isError).toBe(true);
    expect(JSON.stringify(conflict.content)).toContain("REVISION_CONFLICT");
  } finally { await client.close(); await server.close(); }
});

it("real stdio MCP entrypoint negotiates and reads the same persisted document", async () => {
  const { directory } = await fixture();
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", resolve("apps/mcp/main.ts")], cwd: process.cwd(), env: { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")), STUDIO_CONTROL_DATA_DIR: directory, STUDIO_MCP_READ_ONLY: "1" }, stderr: "pipe" });
  const client = new Client({ name: "stdio-test", version: "1" });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.some(t => t.name === "pipelines.patch")).toBe(false);
    const result = await client.callTool({ name: "pipelines.get", arguments: target });
    expect(result.isError).not.toBe(true);
    expect((result.structuredContent as PipelineRecord).document.id).toBe(target.pipelineId);
  } finally { await client.close(); }
}, 20_000);
