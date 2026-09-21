import { describe, expect, it } from "vitest";
import { LGraph } from "litegraph.js/build/litegraph.core.js";
import { examplePipeline, inspect, parsePipeline, createNode } from "../../packages/pipeline-model";
import { loadGraph, snapshotGraph, editorNodes } from "../../apps/web/src/graph/adapter";

describe("pipeline contract and compiler preview", () => {
  it("orders every dependency before its consumer", () => {
    const p = examplePipeline(), result = inspect(p);
    expect(result.issues).toEqual([]);
    expect(result.order).toHaveLength(p.nodes.length);
    for (const edge of p.edges) expect(result.order.indexOf(edge.from.node)).toBeLessThan(result.order.indexOf(edge.to.node));
  });
  it("rejects type mismatches and does not produce an executable order", () => {
    const p = examplePipeline(); p.edges[0].from = { node: "compute", port: "compute" };
    const r = inspect(p); expect(r.issues.map((i) => i.code)).toContain("PORT_TYPE"); expect(r.order).toEqual([]);
  });
  it("allows incomplete drafts to be saved but blocks their preview", () => {
    const p = examplePipeline(); p.edges = p.edges.slice(1);
    expect(parsePipeline(p)).toEqual(p);
    expect(inspect(p).issues.map((i) => i.code)).toContain("MISSING_INPUT");
    expect(inspect(p).order).toEqual([]);
  });
  it("blocks cycles even when all connected ports have compatible types", () => {
    const p = examplePipeline(); p.edges[1].from = { node: "training", port: "model" };
    expect(inspect(p).issues.map((i) => i.code)).toContain("CYCLE");
    expect(inspect(p).order).toEqual([]);
  });
  it.each(["unknown-type", "unknown-version", "raw-litegraph", "extra-config", "duplicate-node", "duplicate-edge", "dangling", "double-input", "invalid-port", "bad-number", "missing-layout", "future-schema"])("rejects malformed import: %s", (kind) => {
    const p = examplePipeline();
    if (kind === "unknown-type") p.nodes[0].type = "untrusted/script";
    if (kind === "unknown-version") Reflect.set(p.nodes[0], "typeVersion", "2");
    if (kind === "raw-litegraph") Reflect.set(p, "last_node_id", 900);
    if (kind === "extra-config") p.nodes[0].config.apiKey = "not-a-supported-field";
    if (kind === "duplicate-node") p.nodes.push(structuredClone(p.nodes[0]));
    if (kind === "duplicate-edge") p.edges.push(structuredClone(p.edges[0]));
    if (kind === "dangling") p.edges[0].from.node = "missing";
    if (kind === "double-input") p.edges.push({ ...structuredClone(p.edges[0]), id: "another-edge" });
    if (kind === "invalid-port") p.edges[0].to.port = "missing";
    if (kind === "bad-number") p.nodes.find((n) => n.type === "training")!.config.epochs = -2;
    if (kind === "missing-layout") delete p.presentation.nodes.dataset;
    if (kind === "future-schema") Reflect.set(p, "schemaVersion", "cyrene.pipeline.v999");
    expect(() => parsePipeline(p)).toThrow();
  });
  it("enforces node limits before opening the graph", () => {
    const p = examplePipeline(); p.nodes = Array.from({ length: 201 }, (_, i) => createNode("dataset", `n-${i}`));
    expect(() => parsePipeline(p)).toThrow();
  });
});

describe("LiteGraph adapter", () => {
  it("preserves stable IDs, ports, config, edge identity and layout across a round trip", () => {
    const p = examplePipeline(); p.nodes[3].config.epochs = 8; p.nodes[3].label = "另一个名称";
    const graph = new LGraph(); loadGraph(graph, p);
    expect(snapshotGraph(graph, p)).toEqual(p);
    expect(graph.status).toBe(LGraph.STATUS_STOPPED);
    expect(editorNodes(graph).every((n) => !n.onExecute)).toBe(true);
  });
  it("keeps moved coordinates and removes references to deleted nodes", () => {
    const p = examplePipeline(), graph = new LGraph(); loadGraph(graph, p);
    const dataset = editorNodes(graph).find((n) => n.properties.document.id === "dataset")!;
    dataset.pos = [700, 600];
    expect(snapshotGraph(graph, p).presentation.nodes.dataset).toEqual({ x: 700, y: 600 });
    graph.remove(dataset);
    const next = snapshotGraph(graph, p);
    expect(next.nodes).toHaveLength(6);
    expect(next.edges.some((e) => e.from.node === "dataset")).toBe(false);
    expect(next.presentation.nodes.dataset).toBeUndefined();
    expect(inspect(next).order).toEqual([]);
  });
});
