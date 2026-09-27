import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "../../packages/control-storage";
import { NodeRegistry, emptyCatalogDatabase } from "../../packages/node-registry/service";
import { packageSchema } from "../../packages/node-registry/contracts";
import { getDefinition } from "../../packages/pipeline-model/catalog";
import { examplePipeline, parsePipeline, type Pipeline } from "../../packages/pipeline-model";
import { LGraph } from "litegraph.js/build/litegraph.core.js";
import { loadGraph, snapshotGraph } from "../../apps/web/src/graph/adapter";
import { PipelineControl, emptyPipelineDatabase } from "../../packages/pipeline-control/service";

const actor = { id: "editor", workspaceIds: ["local"], scopes: ["pipelines.read", "pipelines.write", "catalog.write"] };
const pkg = () => packageSchema.parse({ schemaVersion: "cyrene.studio.nodes.v1", id: "sample", version: "1.0.0", nodes: [{ type: "sample.filter", version: "1", title: "Filter", owner: "Example", category: "Data", description: "Example contribution", color: "#abcdef", inputs: [], outputs: [{ name: "dataset", label: "Dataset", kind: "dataset" }], fields: [{ name: "datasetRef", label: "Ref", kind: "text" }], defaults: { datasetRef: "artifact:test" }, execution: { kind: "reference", adapter: "sample.filter", mutableFields: [], checkpoint: false } }] });
describe("versioned catalog", () => {
  it("rejects a whole invalid reload and preserves the previous catalog and version", async () => {
    let source: unknown[] = [pkg()];
    const store = new MemoryStateStore(emptyCatalogDatabase()), registry = new NodeRegistry(store, async () => source);
    await registry.reload(actor); expect(getDefinition("sample.filter", "1")?.title).toBe("Filter");
    const invalid = pkg(); invalid.nodes[0].title = "Overwritten"; source = [invalid];
    await expect(registry.reload(actor)).rejects.toMatchObject({ code: "IMMUTABLE_PACKAGE" });
    expect((await store.read()).revision).toBe(1); expect(getDefinition("sample.filter", "1")?.title).toBe("Filter");
    source = [pkg(), { malformed: true }]; await expect(registry.reload(actor)).rejects.toThrow(); expect((await store.read()).revision).toBe(1);
  });
  it("round-trips unavailable v2 nodes without dropping configuration, edges or layout", () => {
    const p: Pipeline = { schemaVersion: "cyrene.pipeline.v2", id: "unknown-test", name: "Unknown", nodes: [
      { id: "source", type: "missing.source", typeVersion: "3", label: "Source", config: { setting: 7 }, portSnapshot: { inputs: [], outputs: [{ name: "model", label: "Model", kind: "model" }] } },
      { id: "target", type: "missing.target", typeVersion: "4", label: "Target", config: {}, portSnapshot: { inputs: [{ name: "model", label: "Model", kind: "model" }], outputs: [] } },
    ], edges: [{ id: "edge", from: { node: "source", port: "model" }, to: { node: "target", port: "model" } }], presentation: { nodes: { source: { x: 0, y: 0 }, target: { x: 300, y: 0 } } } };
    const graph = new LGraph(); loadGraph(graph, parsePipeline(p)); expect(snapshotGraph(graph, p)).toEqual(p);
  });
  it("removes retired nodes from the palette while retaining pinned documents", async () => {
    let source: unknown[] = [pkg()]; const registry = new NodeRegistry(new MemoryStateStore(emptyCatalogDatabase()), async () => source);
    await registry.reload(actor); expect(getDefinition("sample.filter")).toBeDefined();
    source = []; await registry.reload(actor);
    expect(getDefinition("sample.filter")).toBeUndefined(); expect(getDefinition("sample.filter", "1")).toBeDefined();
  });
});
it("merges independently edited nodes but rejects edits to the same node", async () => {
  const control = new PipelineControl(new MemoryStateStore(emptyPipelineDatabase()));
  const original = examplePipeline();
  const call = (name: string, input: unknown) => control.execute({ name, input, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }, actor) as Promise<any>;
  await call("pipelines.create", { workspaceId: "local", document: original });
  const save = (document: Pipeline) => { const { presentation: _, ...graph } = document; return call("pipelines.save", { workspaceId: "local", pipelineId: document.id, expectedGraphRevision: 1, expectedLayoutRevision: 1, graph, mergeIndependent: true }); };
  const first = structuredClone(original); first.nodes.find(n => n.id === "training")!.config.epochs = 5; await save(first);
  const second = structuredClone(original); second.nodes.find(n => n.id === "evaluation")!.config.threshold = 0.9; const merged = await save(second);
  expect(merged.record.document.nodes.find((n: any) => n.id === "training").config.epochs).toBe(5);
  expect(merged.record.document.nodes.find((n: any) => n.id === "evaluation").config.threshold).toBe(0.9);
  const conflict = structuredClone(original); conflict.nodes.find(n => n.id === "training")!.config.epochs = 9;
  await expect(save(conflict)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
});
it("undo reverses only the actor's edit and preserves another member's later work", async () => {
  const control = new PipelineControl(new MemoryStateStore(emptyPipelineDatabase())), document = examplePipeline();
  const call = (name: string, input: unknown, identity = actor) => control.execute({ name, input, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }, identity) as Promise<any>;
  await call("pipelines.create", { workspaceId: "local", document });
  const target = { workspaceId: "local", pipelineId: document.id, expectedLayoutRevision: 1 };
  await call("pipelines.patch", { ...target, expectedGraphRevision: 1, edits: [{ op: "update_node", nodeId: "training", config: { epochs: 5 } }] });
  await call("pipelines.patch", { ...target, expectedGraphRevision: 2, edits: [{ op: "update_node", nodeId: "evaluation", config: { threshold: 0.9 } }] }, { ...actor, id: "colleague" });
  const result = await call("pipelines.undo", { ...target, expectedGraphRevision: 3 });
  expect(result.record.document.nodes.find((n: any) => n.id === "training").config.epochs).toBe(3);
  expect(result.record.document.nodes.find((n: any) => n.id === "evaluation").config.threshold).toBe(0.9);
  expect(result.record.graphRevision).toBe(4);
});
