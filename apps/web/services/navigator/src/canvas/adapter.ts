import { LiteGraph, LGraph, LGraphNode } from "litegraph.js/build/litegraph.core.js";
import { catalog, definitions } from "../model/catalog";
import type { Pipeline, PipelineNode } from "../model/pipeline";
import { nodeSize } from "../model/geometry";

export type EditorGraph = LGraph & {
  onAfterChange?: () => void;
  onConnectionChange?: () => void;
  onNodeRemoved?: () => void;
};

export class ClientNode extends LGraphNode {
  properties: { document: PipelineNode } = {
    document: { id: "", type: "", typeVersion: "1", label: "", config: {} },
  };
  executionStatus?: "running" | "done" | "idle";
}

export function registerNodes(): void {
  for (const d of catalog) {
    const name = `cyrene/${d.type}`;
    if (!LiteGraph.registered_node_types[name]) {
      class VisualNode extends ClientNode {
        constructor() {
          super(d.title);
          for (const p of d.inputs) this.addInput(p.label, p.kind);
          for (const p of d.outputs) this.addOutput(p.label, p.kind);
          this.size = nodeSize(d.type);
          Reflect.set(this, "resizable", false);
          this.color = "#232631";
          this.bgcolor = "#1d2029";
          this.boxcolor = d.color;
          this.shape = LiteGraph.ROUND_SHAPE;
        }

        override onDrawForeground(ctx: CanvasRenderingContext2D): void {
          if (this.flags?.collapsed) return;
          ctx.save();
          ctx.font = "bold 11px sans-serif";
          ctx.fillStyle = d.color;
          ctx.fillText(d.owner.toUpperCase(), 14, this.size[1] - 12);

          if (this.executionStatus === "running") {
            ctx.font = "bold 11px monospace";
            ctx.fillStyle = "#ffb76b";
            ctx.fillText("● RUNNING", this.size[0] - 82, this.size[1] - 12);
            ctx.strokeStyle = "#ffb76b";
            ctx.lineWidth = 2;
            ctx.strokeRect(-2, -2, this.size[0] + 4, this.size[1] + 4);
          } else if (this.executionStatus === "done") {
            ctx.font = "bold 11px monospace";
            ctx.fillStyle = "#6cc9a0";
            ctx.fillText("✓ DONE", this.size[0] - 62, this.size[1] - 12);
          }
          ctx.restore();
        }
      }
      LiteGraph.registerNodeType(name, VisualNode);

      if (d.type === "exchange_gateway" && !LiteGraph.registered_node_types["cyrene/gateway"]) {
        LiteGraph.registerNodeType("cyrene/gateway", VisualNode);
      }
    }
  }
}

export function editorNodes(graph: LGraph): ClientNode[] {
  const nodeTypes = catalog.map((d) => `cyrene/${d.type}`);
  if (!nodeTypes.includes("cyrene/gateway")) nodeTypes.push("cyrene/gateway");
  return nodeTypes.flatMap((t) => graph.findNodesByType<ClientNode>(t));
}

export function appendNode(
  graph: LGraph,
  n: PipelineNode,
  position: { x: number; y: number }
): ClientNode {
  registerNodes();
  let typeName = `cyrene/${n.type}`;
  if (!LiteGraph.registered_node_types[typeName] && n.type === "gateway") {
    typeName = "cyrene/exchange_gateway";
  }
  const node = LiteGraph.createNode(typeName) as ClientNode | null;
  if (!node) throw new Error(`节点类型尚未注册：${n.type}`);
  node.properties = { document: structuredClone(n) };
  node.title = n.label;
  node.pos = [position.x, position.y];
  graph.add(node);
  return node;
}

export function loadGraph(graph: LGraph, p: Pipeline): void {
  registerNodes();
  graph.clear();
  const mapping = new Map<string, ClientNode>();
  for (const n of p.nodes) {
    const pos = p.presentation.nodes[n.id] ?? { x: 100, y: 100 };
    mapping.set(n.id, appendNode(graph, n, pos));
  }

  for (const [id, node] of mapping) {
    if (p.presentation.nodes[id]?.pinned) {
      Reflect.set(node.flags, "pinned", true);
    }
  }

  for (const e of p.edges) {
    const from = mapping.get(e.from.node);
    const to = mapping.get(e.to.node);
    if (!from || !to) continue;

    const fromDef =
      definitions.get(from.properties.document.type) ||
      (from.properties.document.type === "gateway" ? definitions.get("exchange_gateway") : undefined);
    const toDef =
      definitions.get(to.properties.document.type) ||
      (to.properties.document.type === "gateway" ? definitions.get("exchange_gateway") : undefined);

    if (!fromDef || !toDef) continue;
    const outputIndex = fromDef.outputs.findIndex((s) => s.name === e.from.port);
    const inputIndex = toDef.inputs.findIndex((s) => s.name === e.to.port);

    if (outputIndex >= 0 && inputIndex >= 0) {
      from.connect(outputIndex, to, inputIndex);
    }
  }
}

export function snapshotGraph(graph: LGraph, base: Pipeline): Pipeline {
  const visual = editorNodes(graph);
  const nodes = visual.map((n) => ({
    ...structuredClone(n.properties.document),
    label: n.title,
  }));
  const nodeMap = new Map(visual.map((n) => [n.id, n.properties.document]));

  const links = graph.links ? Object.values(graph.links).filter(Boolean) : [];
  const edges = links
    .map((l) => {
      const source = nodeMap.get(l.origin_id);
      const target = nodeMap.get(l.target_id);
      if (!source || !target) return null;

      const sourceDef =
        definitions.get(source.type) ||
        (source.type === "gateway" ? definitions.get("exchange_gateway") : undefined);
      const targetDef =
        definitions.get(target.type) ||
        (target.type === "gateway" ? definitions.get("exchange_gateway") : undefined);

      if (!sourceDef || !targetDef) return null;
      const output = sourceDef.outputs[l.origin_slot]?.name;
      const input = targetDef.inputs[l.target_slot]?.name;
      if (!output || !input) return null;

      const old = base.edges.find(
        (e) =>
          e.from.node === source.id &&
          e.from.port === output &&
          e.to.node === target.id &&
          e.to.port === input
      );
      return {
        id: old?.id ?? crypto.randomUUID(),
        from: { node: source.id, port: output },
        to: { node: target.id, port: input },
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const rank = new Map(base.nodes.map((n, i) => [n.id, i]));
  nodes.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  const edgeRank = new Map(base.edges.map((e, i) => [e.id, i]));
  edges.sort((a, b) => (edgeRank.get(a.id) ?? Infinity) - (edgeRank.get(b.id) ?? Infinity));

  return {
    ...base,
    nodes,
    edges,
    presentation: {
      nodes: Object.fromEntries(
        visual.map((n) => [
          n.properties.document.id,
          {
            ...(base.presentation?.nodes[n.properties.document.id] || {}),
            x: Math.round(n.pos[0]),
            y: Math.round(n.pos[1]),
          },
        ])
      ),
    },
  };
}
