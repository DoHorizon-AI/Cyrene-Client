import { LiteGraph, LGraph, LGraphNode } from "litegraph.js/build/litegraph.core.js";
import { allDefinitions, type NodeDefinition } from "../../../../packages/pipeline-model/catalog";
import { visualDefinition, type Pipeline, type PipelineNode } from "../../../../packages/pipeline-model";
import { nodeSize } from "../../../../packages/pipeline-model/geometry";

export type EditorGraph = LGraph & { onAfterChange?: () => void; onConnectionChange?: () => void; onNodeRemoved?: () => void };
export class ClientNode extends LGraphNode {
  properties: { document: PipelineNode } = { document: { id: "", type: "", typeVersion: "1", label: "", config: {} } };
}

export function registerNodes(extra: NodeDefinition[] = []) {
  for (const d of [...allDefinitions(), ...extra]) {
    const name = `cyrene/${d.type}@${d.version}`;
    if (LiteGraph.registered_node_types[name]) continue;
    class VisualNode extends ClientNode {
      constructor() {
        super(d.title);
        for (const p of d.inputs) this.addInput(p.label, p.kind);
        for (const p of d.outputs) this.addOutput(p.label, p.kind);
        this.size = nodeSize(d.type, d.version);
        Reflect.set(this, "resizable", false);
        this.color = "#393c43"; this.bgcolor = "#2b2d32"; this.boxcolor = d.color;
        this.shape = LiteGraph.ROUND_SHAPE;
      }
      onDrawForeground(ctx: CanvasRenderingContext2D) {
        if (this.flags.collapsed) return;
        const visual = visualDefinition(this.properties.document) ?? d;
        ctx.font = "11px sans-serif"; ctx.fillStyle = visual.color;
        ctx.fillText(visual.owner.toUpperCase(), 14, this.size[1] - 12);
      }
    }
    LiteGraph.registerNodeType(name, VisualNode);
  }
}

export function editorNodes(graph: LGraph): ClientNode[] {
  return (Reflect.get(graph, "_nodes") as LGraphNode[]).filter((node): node is ClientNode => node instanceof ClientNode);
}

export function appendNode(graph: LGraph, n: PipelineNode, position: { x: number; y: number }) {
  const definition = visualDefinition(n);
  if (definition) registerNodes([definition]);
  const node = LiteGraph.createNode(`cyrene/${n.type}@${n.typeVersion}`) as ClientNode | null;
  if (!node) throw new Error(`节点类型尚未注册：${n.type}`);
  // A placeholder may have registered this type before its package arrived, or
  // another draft may retain a different unavailable port snapshot. Configure
  // each new instance from its own document before connecting any edges.
  node.inputs = []; node.outputs = [];
  for (const port of definition!.inputs) node.addInput(port.label, port.kind);
  for (const port of definition!.outputs) node.addOutput(port.label, port.kind);
  node.size = nodeSize(n.type, n.typeVersion);
  node.properties = { document: structuredClone(n) };
  node.title = n.label; node.pos = [position.x, position.y]; graph.add(node);
  return node;
}

export function loadGraph(graph: LGraph, p: Pipeline) {
  registerNodes(); graph.clear();
  const mapping = new Map(p.nodes.map((n) => [n.id, appendNode(graph, n, p.presentation.nodes[n.id])]));
  for (const [id, node] of mapping) Reflect.set(node.flags, "pinned", !!p.presentation.nodes[id].pinned);
  for (const e of p.edges) {
    const from = mapping.get(e.from.node)!, to = mapping.get(e.to.node)!;
    const output = visualDefinition(from.properties.document)!.outputs.findIndex((s) => s.name === e.from.port);
    const input = visualDefinition(to.properties.document)!.inputs.findIndex((s) => s.name === e.to.port);
    from.connect(output, to, input);
  }
}

export function snapshotGraph(graph: LGraph, base: Pipeline): Pipeline {
  const visual = editorNodes(graph);
  const nodes = visual.map((n) => ({ ...structuredClone(n.properties.document), label: n.title }));
  const nodeMap = new Map(visual.map((n) => [n.id, n.properties.document]));
  const edges = Object.values(graph.links).map((l) => {
    const source = nodeMap.get(l.origin_id)!, target = nodeMap.get(l.target_id)!;
    const output = visualDefinition(source)!.outputs[l.origin_slot].name;
    const input = visualDefinition(target)!.inputs[l.target_slot].name;
    const old = base.edges.find((e) => e.from.node === source.id && e.from.port === output && e.to.node === target.id && e.to.port === input);
    return { id: old?.id ?? crypto.randomUUID(), from: { node: source.id, port: output }, to: { node: target.id, port: input } };
  });
  // Preserve authored order across loading, independent of LiteGraph registration order.
  // 加载时保留文档中定义的顺序，不受 LiteGraph 注册顺序影响。
  const rank = new Map(base.nodes.map((n, i) => [n.id, i]));
  nodes.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  const edgeRank = new Map(base.edges.map((e, i) => [e.id, i]));
  edges.sort((a, b) => (edgeRank.get(a.id) ?? Infinity) - (edgeRank.get(b.id) ?? Infinity));
  return { ...base, schemaVersion: nodes.some(n => n.packageRef || n.typeVersion !== "1") ? "cyrene.pipeline.v2" : base.schemaVersion, nodes, edges, presentation: { nodes: Object.fromEntries(visual.map((n) => [n.properties.document.id, { ...base.presentation.nodes[n.properties.document.id], x: n.pos[0], y: n.pos[1] }])) } };
}
