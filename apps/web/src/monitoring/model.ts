import type { Pipeline } from "../../../../packages/pipeline-model";
import { getDefinition } from "../../../../packages/pipeline-model/catalog";
import type { MonitoringSnapshot } from "../../../../packages/monitoring/contracts";

type Node = MonitoringSnapshot["pipelines"][number]["nodes"][number];
export type MonitorRow = Node & {
  key: string; pipelineId: string; pipelineName: string; runId?: string; createdAt?: string;
  state: string; serverId?: string; retries: number; removed: boolean; draft: boolean;
};
export function monitorRows(snapshot: MonitoringSnapshot | null, document: Pipeline, dirty: boolean, pipelineOnly: boolean, history: boolean): MonitorRow[] {
  const pipelines = new Map((snapshot?.pipelines ?? []).map(pipeline => [pipeline.id, pipeline]));
  pipelines.set(document.id, { id: document.id, name: document.name, graphRevision: 0, nodes: document.nodes.map(node => {
    const definition = getDefinition(node.type, node.typeVersion);
    return { id: node.id, label: node.label, type: node.type, typeVersion: node.typeVersion,
      kind: snapshot?.pipelines.find(p => p.id === document.id)?.nodes.find(n => n.id === node.id && n.type === node.type && n.typeVersion === node.typeVersion)?.kind ?? (["dataset", "model", "compute"].includes(node.type) || definition?.execution?.kind === "reference" ? "reference" : definition?.execution ? "executable" : "unavailable") };
  }) });
  const rows: MonitorRow[] = [], covered = new Set<string>();
  for (const run of snapshot?.runs ?? []) {
    if (pipelineOnly && run.pipelineId !== document.id) continue;
    for (const node of run.nodes) {
      const current = pipelines.get(run.pipelineId)?.nodes.find(n => n.id === node.id && n.type === node.type);
      const removed = !current;
      if (removed && !history && ["succeeded", "failed", "stopped"].includes(run.state)) continue;
      covered.add(JSON.stringify([run.pipelineId, node.id, node.type]));
      rows.push({ ...node, key: JSON.stringify([run.pipelineId, run.id, node.id]), pipelineId: run.pipelineId, pipelineName: run.pipelineName, runId: run.id, createdAt: run.createdAt,
        state: node.kind === "reference" ? "reference" : node.step?.state ?? "unknown", serverId: node.step?.serverId, retries: node.step?.retries ?? 0, removed, draft: false });
    }
  }
  for (const pipeline of pipelines.values()) {
    if (pipelineOnly && pipeline.id !== document.id) continue;
    for (const node of pipeline.nodes) {
      if (covered.has(JSON.stringify([pipeline.id, node.id, node.type]))) continue;
      rows.push({ ...node, key: JSON.stringify([pipeline.id, null, node.id]), pipelineId: pipeline.id, pipelineName: pipeline.name,
        state: node.kind === "reference" ? "reference" : "not-started", retries: 0, removed: false,
        draft: pipeline.id === document.id && (dirty || !snapshot?.pipelines.some(p => p.id === document.id)) });
    }
  }
  const rank = (state: string) => ["failed", "unknown", "running", "dispatching", "queued", "pending"].indexOf(state);
  return rows.sort((a, b) => (rank(a.state) < 0 ? 99 : rank(a.state)) - (rank(b.state) < 0 ? 99 : rank(b.state)));
}
