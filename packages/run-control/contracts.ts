import { z } from "zod";
import { pipelineSchema, nodeSchema } from "../pipeline-model";
import { identifier, resolvedServerSchema } from "../server-control/contracts";

export const artifactSchema = z.object({
  uri: z.string().min(1).max(2000), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), kind: z.string().min(1).max(100),
  sizeBytes: z.number().int().nonnegative().optional(), manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
}).strict();
export const outputsSchema = z.record(identifier, artifactSchema);
export const placementSchema = z.object({ serverId: identifier.optional(), pool: z.array(identifier).max(50).optional(), acceleratorCount: z.number().int().positive().max(1024).default(1), provider: z.string().min(1).max(100).optional(), accelerator: z.string().min(1).max(300).optional() }).strict();
export const capabilitiesSchema = z.object({ image: z.string().regex(/^[A-Za-z0-9./:_-]+@sha256:[a-f0-9]{64}$/), contractVersion: z.literal("cyrene.studio.execution.v1"), mutableFields: z.array(z.string()).max(64), checkpoint: z.boolean(), safeRetry: z.boolean() }).strict();
export const observationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("absent"), authoritative: z.literal(true) }).strict(),
  z.object({ state: z.enum(["queued", "running", "succeeded", "failed", "stopped", "unknown"]), attemptId: identifier, generation: z.number().int().positive(), taskId: identifier, serverId: identifier.optional(), outputs: outputsSchema.default({}), checkpoint: artifactSchema.optional(), terminalAuthority: z.boolean().default(false), retryable: z.boolean().default(false), appliedConfig: nodeSchema.shape.config.optional(), effectiveStep: z.number().int().nonnegative().optional(), message: z.string().max(4000).optional(), events: z.array(z.object({ sequence: z.number().int().nonnegative(), message: z.string().max(4000) })).max(1000).default([]) }).strict(),
]);
export type Observation = z.infer<typeof observationSchema>;
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type Outputs = z.infer<typeof outputsSchema>;
export const stepSchema = z.object({
  nodeId: identifier, adapter: z.string(), state: z.enum(["pending", "dispatching", "queued", "running", "succeeded", "failed", "stopped", "unknown"]),
  config: nodeSchema.shape.config, actualConfig: nodeSchema.shape.config, capabilities: capabilitiesSchema.optional(),
  attemptId: identifier.optional(), generation: z.number().int().nonnegative(), retries: z.number().int().nonnegative(), nextAttemptAt: z.number().int().nonnegative().optional(), taskId: identifier.optional(), serverId: identifier.optional(),
  inputs: outputsSchema, outputs: outputsSchema, checkpoint: artifactSchema.optional(), message: z.string().optional(), eventCursor: z.number().int().default(0), effectiveStep: z.number().int().optional(),
  change: z.object({ id: identifier, config: nodeSchema.shape.config, state: z.enum(["pending", "unknown"]) }).optional(),
});
export const runSchema = z.object({
  id: identifier, workspaceId: identifier, pipelineId: identifier, graphRevision: z.number().int().positive(), revision: z.number().int().positive(),
  document: pipelineSchema, state: z.enum(["queued", "running", "succeeded", "failed", "stopping", "stopped", "attention"]),
  parentRunId: identifier.optional(), createdAt: z.string().datetime(), createdBy: identifier, placements: z.record(identifier, placementSchema), steps: z.array(stepSchema),
  targets: z.record(identifier, z.array(resolvedServerSchema)).default({}),
});
export type Run = z.infer<typeof runSchema>;
export type Step = z.infer<typeof stepSchema>;
export const runEventSchema = z.object({ sequence: z.number().int().positive(), workspaceId: identifier, runId: identifier, nodeId: identifier.optional(), actorId: identifier, kind: z.string(), message: z.string(), at: z.string().datetime() });
export const runDatabase = z.object({ version: z.literal(1), runs: z.array(runSchema), attempts: z.array(z.object({ runId: identifier, nodeId: identifier, attemptId: identifier, generation: z.number().int(), observation: observationSchema.optional() })).default([]), events: z.array(runEventSchema), receipts: z.array(z.object({ key: z.string(), fingerprint: z.string(), runId: identifier })) });
export type RunDatabase = z.infer<typeof runDatabase>;
export const emptyRunDatabase = (): RunDatabase => ({ version: 1, runs: [], attempts: [], events: [], receipts: [] });
const workspace = z.object({ workspaceId: identifier }).strict();
const target = workspace.extend({ runId: identifier });
const eventInput = target.extend({ after: z.number().int().nonnegative().safe().default(0), limit: z.number().int().positive().max(500).default(100) });
export const runObservationSchema = z.object({ run: runSchema, items: z.array(runEventSchema), cursor: z.number().int().nonnegative().safe() });
const changeInput = target.extend({ expectedRevision: z.number().int().positive(), nodeId: identifier, config: nodeSchema.shape.config });
const startInput = workspace.extend({ pipelineId: identifier, expectedGraphRevision: z.number().int().positive(), placements: z.record(identifier, placementSchema).default({}) });
export const preflightSchema = z.object({ fingerprint: z.string(), issues: z.array(z.object({ nodeId: z.string().optional(), code: z.string(), message: z.string() })), capabilities: z.record(capabilitiesSchema), placements: z.record(placementSchema), targets: z.record(identifier, z.array(resolvedServerSchema)).default({}) });
export const changePreviewSchema = z.object({ fingerprint: z.string(), mode: z.enum(["online", "branch", "checkpoint-branch", "rejected"]), affected: z.array(identifier), reusable: z.array(identifier), message: z.string(), expectedRevision: z.number().int() });
export const runCommands = {
  "runs.observe": { input: eventInput, output: runObservationSchema, readOnly: true, description: "从同一持久化快照读取运行状态与增量事件；使用返回游标继续读取，断线后可补齐。" },
  "runs.attempts": { input: target, output: z.object({ items: z.array(runDatabase.shape.attempts._def.innerType.element) }), readOnly: true, description: "读取运行中各节点的持久化执行代次及权威观测。" },
  "runs.artifacts": { input: target, output: z.object({ items: z.array(z.object({ nodeId: identifier, port: z.string(), artifact: artifactSchema, checkpoint: z.boolean() })) }), readOnly: true, description: "读取当前运行的已确认输出与检查点引用；不隐式下载或删除制品。" },
  "runs.preflight": { input: startInput, output: preflightSchema, readOnly: true, description: "检查版本、节点执行能力及资源条件；不会创建任务或申请资源。" },
  "runs.start": { input: startInput.extend({ expectedFingerprint: z.string().length(64) }), output: runSchema, readOnly: false, description: "提交固定图版本和镜像的工作流运行；需要 runs.write 权限和幂等键。" },
  "runs.list": { input: workspace, output: z.object({ items: z.array(runSchema.omit({ document: true, steps: true })) }), readOnly: true, description: "列出工作空间运行和分支。" },
  "runs.get": { input: target, output: runSchema, readOnly: true, description: "读取任务关联、期望/实际配置、执行代次和结果。" },
  "runs.events": { input: target.extend({ after: z.number().int().nonnegative().default(0), limit: z.number().int().positive().max(500).default(100) }), output: z.object({ items: z.array(runEventSchema), cursor: z.number().int() }), readOnly: true, description: "按持久化游标读取运行事件；断线后可补齐。" },
  "runs.preview_change": { input: changeInput, output: changePreviewSchema, readOnly: true, description: "预览在线调整或新分支的影响，不改变执行。" },
  "runs.apply_change": { input: changeInput.extend({ expectedFingerprint: z.string().length(64) }), output: runSchema, readOnly: false, description: "提交已预览的运行变更，版本变化时拒绝；影响下游时保留旧分支。" },
  "runs.stop": { input: target.extend({ expectedRevision: z.number().int().positive() }), output: runSchema, readOnly: false, description: "记录停止意图；以执行权威确认的停止状态为准。" },
  "runs.resume": { input: target.extend({ expectedRevision: z.number().int().positive() }), output: runSchema, readOnly: false, description: "恢复已确认终止的运行步骤；未知结果或仍在运行的步骤必须先核对。" },
} as const;
