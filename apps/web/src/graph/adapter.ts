import { LiteGraph, LGraph, LGraphNode } from "litegraph.js/build/litegraph.core.js";
import { catalog, definitions } from "../../../../packages/pipeline-model/catalog";
import type { Pipeline, PipelineNode } from "../../../../packages/pipeline-model";
import { nodeSize } from "../../../../packages/pipeline-model/geometry";

export type EditorGraph = LGraph & { onAfterChange?: () => void; onConnectionChange?: () => void; onNodeRemoved?: () => void };
export class ClientNode extends LGraphNode {
  properties: { document: PipelineNode } = { document: { id: "", type: "", typeVersion: "1", label: "", config: {} } };
}

export function registerNodes() {
  for (const d of catalog) {
    const name = `cyrene/${d.type}`;
    if (LiteGraph.registered_node_types[name]) continue;
    class VisualNode extends ClientNode {
      constructor() {
        super(d.title);
        for (const p of d.inputs) this.addInput(p.label, p.kind);
        for (const p of d.outputs) this.addOutput(p.label, p.kind);
        this.size = nodeSize(d.type);
        Reflect.set(this, "resizable", false);
        this.color = "#393c43"; this.bgcolor = "#2b2d32"; this.boxcolor = d.color;
        this.shape = LiteGraph.ROUND_SHAPE;
      }
      onDrawForeground(ctx: CanvasRenderingContext2D) {
        if (this.flags.collapsed) return;
        ctx.font = "11px sans-serif"; ctx.fillStyle = d.color;
        ctx.fillText(d.owner.toUpperCase(), 14, this.size[1] - 12);
      }
    }
    LiteGraph.registerNodeType(name, VisualNode);
  }
}

export function editorNodes(graph: LGraph): ClientNode[] {
  return catalog.flatMap((d) => graph.findNodesByType<ClientNode>(`cyrene/${d.type}`));
}

export function appendNode(graph: LGraph, n: PipelineNode, position: { x: number; y: number }) {
  const node = LiteGraph.createNode(`cyrene/${n.type}`) as ClientNode | null;
  if (!node) throw new Error(`节点类型尚未注册：${n.type}`);
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
    const output = definitions.get(from.properties.document.type)!.outputs.findIndex((s) => s.name === e.from.port);
    const input = definitions.get(to.properties.document.type)!.inputs.findIndex((s) => s.name === e.to.port);
    from.connect(output, to, input);
  }
}

export function snapshotGraph(graph: LGraph, base: Pipeline): Pipeline {
  const visual = editorNodes(graph);
  const nodes = visual.map((n) => ({ ...structuredClone(n.properties.document), label: n.title }));
  const nodeMap = new Map(visual.map((n) => [n.id, n.properties.document]));
  const edges = Object.values(graph.links).map((l) => {
    const source = nodeMap.get(l.origin_id)!, target = nodeMap.get(l.target_id)!;
    const output = definitions.get(source.type)!.outputs[l.origin_slot].name;
    const input = definitions.get(target.type)!.inputs[l.target_slot].name;
    const old = base.edges.find((e) => e.from.node === source.id && e.from.port === output && e.to.node === target.id && e.to.port === input);
    return { id: old?.id ?? crypto.randomUUID(), from: { node: source.id, port: output }, to: { node: target.id, port: input } };
  });
  // Preserve authored order across loading, independent of LiteGraph registration order.
  // 加载时保留文档中定义的顺序，不受 LiteGraph 注册顺序影响。
  const rank = new Map(base.nodes.map((n, i) => [n.id, i]));
  nodes.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  const edgeRank = new Map(base.edges.map((e, i) => [e.id, i]));
  edges.sort((a, b) => (edgeRank.get(a.id) ?? Infinity) - (edgeRank.get(b.id) ?? Infinity));
  return { ...base, nodes, edges, presentation: { nodes: Object.fromEntries(visual.map((n) => [n.properties.document.id, { ...base.presentation.nodes[n.properties.document.id], x: n.pos[0], y: n.pos[1] }])) } };
}
