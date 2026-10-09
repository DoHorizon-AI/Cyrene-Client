import type { StateStore } from "../control-storage";
import type { PipelineDatabase } from "../pipeline-control/service";
import { pipelineRequest } from "../pipeline-control/contracts";
import type { RunDatabase } from "../run-control/contracts";
import { ControlError, type Actor } from "../server-control/contracts";
import { getDefinition } from "../pipeline-model/catalog";
import type { PipelineNode } from "../pipeline-model";
import { monitoringCommands, monitoringSnapshotSchema } from "./contracts";

export function monitorNode(node: PipelineNode, adapters: ReadonlySet<string> = new Set()) {
  const definition = getDefinition(node.type, node.typeVersion);
  const reference = ["dataset", "model", "compute"].includes(node.type) || definition?.execution?.kind === "reference";
  const adapter = definition?.execution?.adapter ?? ({ training: "yield", evaluation: "echo", deployment: "reactor", agent: "navigator" }[node.type] ?? node.type);
  return { id: node.id, type: node.type, typeVersion: node.typeVersion, label: node.label,
    kind: reference ? "reference" as const : definition && adapters.has(adapter) ? "executable" as const : "unavailable" as const };
}
export class MonitoringControl {
  constructor(private pipelines: Pick<StateStore<PipelineDatabase>, "read">, private runs: Pick<StateStore<RunDatabase>, "read">, private adapters: ReadonlySet<string> = new Set()) {}
  async execute(raw: unknown, actor: Actor) {
    const request = pipelineRequest.parse(raw);
    if (request.name !== "monitoring.snapshot") throw new ControlError("UNKNOWN_COMMAND", "Unknown monitoring command");
    const input = monitoringCommands[request.name].input.parse(request.input);
    if (!actor.workspaceIds.includes(input.workspaceId) || !monitoringCommands["monitoring.snapshot"].requiredScopes.every(scope => actor.scopes.includes(scope))) throw new ControlError("FORBIDDEN", "Monitoring access denied", 403);
    // These stores have independent revisions. Never imply a cross-store transaction.
    const [pipelines, runs] = await Promise.all([this.pipelines.read(), this.runs.read()]);
    const matches = (row: { workspaceId: string; pipelineId?: string }) => row.workspaceId === input.workspaceId && (!input.pipelineId || row.pipelineId === input.pipelineId);
    const recent = new Set<string>();
    return monitoringSnapshotSchema.parse({ workspaceId: input.workspaceId, observedAt: new Date().toISOString(),
      pipelines: pipelines.records.filter(row => matches({ ...row, pipelineId: row.document.id })).map(row => ({ id: row.document.id, name: row.document.name, graphRevision: row.graphRevision, nodes: row.document.nodes.map(node => monitorNode(node, this.adapters)) })),
      runs: runs.runs.filter(matches).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).filter(run => {
        if (input.history || !["succeeded", "failed", "stopped"].includes(run.state)) return true;
        if (recent.has(run.pipelineId)) return false;
        recent.add(run.pipelineId); return true;
      }).map(run => ({ ...run, pipelineName: run.document.name, nodes: run.document.nodes.map(node => ({ ...monitorNode(node, this.adapters), step: run.steps.find(step => step.nodeId === node.id) })) })),
    });
  }
}
