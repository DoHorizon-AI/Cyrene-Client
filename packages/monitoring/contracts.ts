import { z } from "zod";
import { identifier } from "../server-control/contracts";
import { runSchema, stepSchema } from "../run-control/contracts";

export const monitorNodeSchema = z.object({
  id: identifier, type: z.string(), typeVersion: z.string(), label: z.string(),
  kind: z.enum(["reference", "executable", "unavailable"]),
});
const summary = runSchema.pick({ id: true, pipelineId: true, graphRevision: true, revision: true, state: true, createdAt: true, parentRunId: true }).extend({
  pipelineName: z.string(),
  nodes: z.array(monitorNodeSchema.extend({ step: stepSchema.pick({ state: true, serverId: true, retries: true, generation: true, attemptId: true, taskId: true }).optional() })),
});
export const monitoringSnapshotSchema = z.object({
  workspaceId: identifier, observedAt: z.string().datetime(),
  pipelines: z.array(z.object({ id: identifier, name: z.string(), graphRevision: z.number(), nodes: z.array(monitorNodeSchema) })),
  runs: z.array(summary),
});
export const monitoringCommands = {
  "monitoring.snapshot": {
    input: z.object({ workspaceId: identifier, pipelineId: identifier.optional(), history: z.boolean().default(false) }).strict(),
    output: monitoringSnapshotSchema, readOnly: true, scope: "runs.read",
    requiredScopes: ["pipelines.read", "runs.read"], effects: "read", external: false,
    description: "按工作空间或流水线读取节点与运行监控摘要；需要 pipelines.read 和 runs.read。默认返回进行中及每条流水线最近结束的运行，history 包含历史。不包含配置或凭据。",
  },
} as const;
export type MonitoringSnapshot = z.infer<typeof monitoringSnapshotSchema>;
