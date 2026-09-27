import type { Pipeline } from "../pipeline-model";
import { ControlError } from "../server-control/contracts";

type Graph = Omit<Pipeline, "presentation">;
const same = (a: unknown, b: unknown) => {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
};
/** Merge only provably independent edits. Never use a client-supplied base. */
export function mergeIndependentGraph(base: Graph, incoming: Graph, current: Graph): Graph {
  const conflict = () => { throw new ControlError("REVISION_CONFLICT", "相同节点或连接已被修改，双方内容已保留，请查看版本差异并处理冲突。", 409); };
  if (base.id !== incoming.id || base.id !== current.id) conflict();
  const result = structuredClone(current);
  for (const key of ["name", "schemaVersion"] as const) if (incoming[key] !== base[key]) {
    if (current[key] !== base[key] && current[key] !== incoming[key]) conflict();
    (result[key] as string) = incoming[key];
  }
  const ids = new Set([...base.nodes, ...incoming.nodes].map(node => node.id));
  for (const id of ids) {
    const old = base.nodes.find(node => node.id === id), local = incoming.nodes.find(node => node.id === id), remote = current.nodes.find(node => node.id === id);
    if (same(old, local)) continue;
    if (!same(old, remote) && !same(local, remote)) conflict();
    const incident = (graph: Graph) => graph.edges.filter(edge => edge.from.node === id || edge.to.node === id);
    if (!same(incident(base), incident(current))) conflict();
    const index = result.nodes.findIndex(node => node.id === id);
    if (!local) result.nodes = result.nodes.filter(node => node.id !== id);
    else if (index < 0) result.nodes.push(structuredClone(local));
    else result.nodes[index] = structuredClone(local);
  }
  if (!same(base.edges, incoming.edges)) {
    if (!same(base.edges, current.edges) && !same(incoming.edges, current.edges)) conflict();
    const affected = new Set([...base.edges, ...incoming.edges].filter(edge => !base.edges.some(e => same(e, edge)) || !incoming.edges.some(e => same(e, edge))).flatMap(edge => [edge.from.node, edge.to.node]));
    for (const id of affected) if (!same(base.nodes.find(n => n.id === id), current.nodes.find(n => n.id === id))) conflict();
    result.edges = structuredClone(incoming.edges);
  }
  return result;
}
