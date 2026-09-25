import { z } from "zod";

// Projections of the inspected Product contracts. Unknown response fields are
// discarded; only explicitly supported settings can enter a pipeline document.
// 这是根据已检查的 Product 合约构建的投影。丢弃响应中的未知字段；只有明确支持的设置才能进入流程文档。
export const artifactSchema = z.object({
  uri: z.string().regex(/^artifact:\/\/sha256\/[0-9a-f]{64}$/),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  size_bytes: z.number().int().nonnegative(), kind: z.string().min(1).max(128),
  manifest_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullish(),
}).refine((a) => a.uri.slice("artifact://sha256/".length) === a.digest.slice(7), "Artifact digest mismatch");
export const trainingParametersSchema = z.object({
  epochs: z.number().positive().max(100).default(1),
  perDeviceBatchSize: z.number().int().min(1).max(64).default(1),
  gradientAccumulationSteps: z.number().int().min(1).max(1024).default(1),
  learningRate: z.number().positive().max(1).default(0.0002),
  maxSequenceLength: z.number().int().min(16).max(32768).default(512),
  maxSteps: z.number().int().min(1).nullish(),
  loraRank: z.number().int().min(1).max(512).default(8),
  loraAlpha: z.number().int().min(1).default(16),
  loraDropout: z.number().min(0).max(1).default(0.05),
  template: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).default("default"),
}).strict();
export const baseModelSchema = z.object({
  artifact: artifactSchema,
  source: z.object({ repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), revision: z.string().regex(/^[0-9a-f]{40}$/) }),
}).refine((m) => m.artifact.kind === "model" && m.artifact.manifest_digest === m.artifact.digest, "训练需要完整的可移植基础模型制品");
export const trainingConfigurationSchema = z.object({ baseModel: baseModelSchema, parameters: trainingParametersSchema.default({}) });
export const trainingDraftSchema = z.object({
  id: z.string().uuid(), name: z.string(), state: z.enum(["DRAFT", "PREPARED", "STARTED"]),
  configuration: trainingConfigurationSchema.nullish(),
  datasetVersion: z.object({ id: z.string().uuid(), uri: z.string(), resourceVersion: z.number().int().positive(), artifact: artifactSchema }),
  trainingRun: z.object({ id: z.string().uuid() }).nullish(),
});
export type TrainingDraft = z.infer<typeof trainingDraftSchema>;
export const datasetSchema = z.object({ id: z.string().uuid(), name: z.string(), state: z.enum(["ACTIVE", "ARCHIVED"]) });
export const datasetVersionSchema = z.object({
  id: z.string().uuid(), datasetId: z.string().uuid(), version: z.number().int().positive(),
  state: z.enum(["PROCESSING", "PUBLISHED", "FAILED"]), resourceVersion: z.number().int().positive(),
  output: artifactSchema.nullish(), rowCount: z.number().int().nonnegative().nullish(),
});
export const modelImportSchema = z.object({
  id: z.string().uuid(), name: z.string(), state: z.enum(["VALIDATING", "READY", "FAILED"]),
  servingBindingId: z.string(), modelArtifact: artifactSchema.nullish(),
  source: z.object({ kind: z.enum(["HUGGING_FACE", "LOCAL_PATH"]), repository: z.string().nullish(), revision: z.string().nullish() }),
});
export const bindingSchema = z.object({ bindingId: z.string().min(1).max(200) });
export const suiteInputSchema = z.object({
  name: z.string().trim().min(1).max(200), evaluator: z.enum(["exact_match.v1", "llm_judge.v1"]),
  expectedField: z.string().min(1), actualField: z.string().min(1), threshold: z.number().min(0).max(1),
  judgeProfileId: z.string().uuid().optional(),
}).strict().refine((s) => s.evaluator !== "llm_judge.v1" || !!s.judgeProfileId, "LLM 评估需要 judgeProfileId");
export const suiteSchema = z.object({
  id: z.string().uuid(), name: z.string(), evaluator: z.enum(["exact_match.v1", "llm_judge.v1"]),
  expectedField: z.string(), actualField: z.string(), threshold: z.number().min(0).max(1),
  judgeProfileId: z.string().uuid().nullish(), state: z.enum(["ACTIVE", "ARCHIVED"]), resourceVersion: z.number().int().positive(),
});
export const sessionSchema = z.object({ authenticated: z.boolean(), refreshable: z.boolean(), csrfToken: z.string().nullish() });
export type HostSession = z.infer<typeof sessionSchema>;
export const hostStatusSchema = z.object({
  service: z.literal("cyrene-navigator-web-host"), status: z.string(), authenticated: z.boolean(),
  proxyPrefixes: z.array(z.string()), observedAt: z.string(),
  gpu: z.object({ available: z.boolean(), gpus: z.array(z.object({ name: z.string(), totalMib: z.number(), usedMib: z.number(), utilizationPct: z.number() })).optional() }).optional(),
  // Published by newer Web Hosts; optional so an older host still validates.
  // 由较新的 Web Host 发布；设为可选，以便旧版 Host 仍能通过校验。
  gatewayBaseUrl: z.string().optional(),
  bootstrapState: z.object({ state: z.string(), source: z.string().optional(), completedAt: z.string().nullish() }).optional(),
  runtime: z.object({ releaseLock: z.string().nullable().optional(), engines: z.record(z.string(), z.string()).optional(), cudaProfile: z.string().optional() }).optional(),
  diagnosticsDegraded: z.boolean().optional(),
});
export type HostStatus = z.infer<typeof hostStatusSchema>;
export const navigatorSessionsSchema = z.object({ items: z.array(z.object({
  revision: z.string(), eventCount: z.number().int().nonnegative(),
  productMetadata: z.object({ workspaceId: z.string(), sessionId: z.string(), ownerState: z.enum(["known", "unknown"]) }),
})) });

export function pathId(value: string): string {
  const v = value.trim();
  if (!v || v.length > 512 || /[\u0000-\u001f/\\%?#]/.test(v) || v === "." || v === "..") throw new Error("资源标识为空或包含不支持的字符。");
  return encodeURIComponent(v);
}
