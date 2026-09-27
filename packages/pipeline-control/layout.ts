import ELK from "elkjs/lib/elk.bundled.js";
import { parsePipeline, visualDefinition, type Pipeline } from "../pipeline-model";
import { definitions } from "../pipeline-model/catalog";
import { nodeSize, TITLE_HEIGHT } from "../pipeline-model/geometry";
import { ControlError } from "../server-control/contracts";

// Server-side ELK: the canvas does not download the layout engine. Persisted
// coordinates are authoritative; browser and MCP use this same implementation.
// 由服务端运行 ELK：画布不会下载布局引擎。持久化坐标具有权威性；浏览器与 MCP 共用此实现。
export async function arrange(document: Pipeline, options: { direction: "RIGHT" | "DOWN"; nodeIds?: string[] }): Promise<Pipeline> {
  const p = parsePipeline(document), ids = new Set(p.nodes.map(n => n.id));
  if (options.nodeIds?.some(id => !ids.has(id))) throw new ControlError("UNKNOWN_NODE", "排版范围包含未知节点。");
  const selected = new Set(options.nodeIds ?? ids);
  const moving = p.nodes.filter(n => selected.has(n.id) && !p.presentation.nodes[n.id].pinned);
  if (!moving.length) return p;
  const movingIds = new Set(moving.map(n => n.id));
  const elk = new ELK();
  const graph = await elk.layout({
    id: "layout", layoutOptions: { "elk.algorithm": "layered", "elk.direction": options.direction, "elk.spacing.nodeNode": "60", "elk.layered.spacing.nodeNodeBetweenLayers": "100", "elk.randomSeed": "1" },
    children: moving.map(n => {
      const d = visualDefinition(n)!, [width, height] = nodeSize(n.type, n.typeVersion);
      return { id: n.id, width, height: height + TITLE_HEIGHT,
        layoutOptions: { "elk.portConstraints": "FIXED_ORDER" },
        ports: [...d.inputs.map((port, i) => ({ id: `${n.id}:in:${port.name}`, width: 1, height: 1, layoutOptions: { "elk.port.side": "WEST", "elk.port.index": String(i) } })), ...d.outputs.map((port, i) => ({ id: `${n.id}:out:${port.name}`, width: 1, height: 1, layoutOptions: { "elk.port.side": "EAST", "elk.port.index": String(i) } }))],
      };
    }),
    edges: p.edges.filter(e => movingIds.has(e.from.node) && movingIds.has(e.to.node)).map(e => ({ id: e.id, sources: [`${e.from.node}:out:${e.from.port}`], targets: [`${e.to.node}:in:${e.to.port}`] })),
  });
  const result = structuredClone(p);
  const fixed = p.nodes.filter(n => !movingIds.has(n.id));
  const anchorX = fixed.length ? Math.min(...moving.map(n => p.presentation.nodes[n.id].x)) : 40;
  const anchorY = fixed.length ? Math.min(...moving.map(n => p.presentation.nodes[n.id].y)) : 80;
  const boxes = fixed.map(n => { const pos = p.presentation.nodes[n.id], [w, h] = nodeSize(n.type); return { x: pos.x, y: pos.y - TITLE_HEIGHT, w, h: h + TITLE_HEIGHT }; });
  // Fixed nodes are obstacles. For partial layout, translate the whole computed
  // block until it clears obstacles, preserving the internal layered structure.
  // 固定节点作为障碍物。局部排版时，整体平移计算出的节点块，直到避开障碍，同时保留块内的分层结构。
  const children = graph.children!;
  let shiftY = 0;
  for (let attempt = 0; attempt <= fixed.length * children.length; attempt++) {
    let next = shiftY;
    for (const child of children) for (const box of boxes) {
      const x = anchorX + child.x!, y = anchorY + child.y! + shiftY - TITLE_HEIGHT;
      if (x < box.x + box.w + 30 && x + child.width! + 30 > box.x && y < box.y + box.h + 30 && y + child.height! + 30 > box.y) next = Math.max(next, box.y + box.h + 30 - (anchorY + child.y! - TITLE_HEIGHT));
    }
    if (next === shiftY) break;
    shiftY = next;
  }
  for (const child of children) result.presentation.nodes[child.id] = { ...p.presentation.nodes[child.id], x: Math.round(anchorX + child.x!), y: Math.round(anchorY + child.y! + shiftY) };
  return parsePipeline(result);
}
