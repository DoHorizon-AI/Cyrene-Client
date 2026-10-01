// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 contracts.ts                                                     │
// │  Module: packages/component-updates                                  │
// │  Role: Shared local update command and helper protocol contracts.    │
// │                                                                      │
// │  模块职责：定义本地组件更新命令和受限 helper 的共享协议。                 │
// └─────────────────────────────────────────────────────────────────────┘
import { z } from "zod";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const componentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const planId = z.string().min(1).max(128);
export const windowsProductComponentIds = ["cyrene-exchange", "cyrene-reactor", "cyrene-yield", "cyrene-catalyst", "cyrene-echo"] as const;

/** A platform tuple that identifies where a component release can run. */
export const updateTargetSchema = z.object({
  os: z.string().min(1).max(32),
  osVersion: z.string().max(80).optional(),
  distribution: z.string().max(80).optional(),
  distributionVersion: z.string().max(80).optional(),
  architecture: z.string().min(1).max(32),
  abi: z.string().max(80).optional(),
  runtime: z.string().max(80).optional(),
}).strict();

/** Runtime readiness reported by the authenticated local maintenance source. */
export const updateReadinessSchema = z.object({
  state: z.enum(["idle", "busy", "unknown", "idle_runtime_requires_unload", "maintenance_active"]),
  gateGeneration: z.number().int().nonnegative().nullish(),
  installCatalogGeneration: z.number().int().nonnegative().nullish(),
  activeTaskCount: z.number().int().nonnegative().optional(),
  activeTasks: z.array(z.object({
    sourceId: z.string().min(1).max(160),
    taskId: z.string().min(1).max(160),
    state: z.string().min(1).max(64),
  }).strict()).max(1000).default([]),
  activeWorkerCount: z.number().int().nonnegative().optional(),
  activeAllocationCount: z.number().int().nonnegative().optional(),
  inflightRuntimeAdmissionCount: z.number().int().nonnegative().optional(),
  unknownActivitySources: z.array(z.string().max(160)).max(100).default([]),
  blockerCodes: z.array(z.string().min(1).max(80)).max(100).default([]),
  requiresRestartConfirmation: z.boolean().default(false),
  blockers: z.array(z.object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
    source: z.string().max(160).optional(),
  }).strict()).max(100).default([]),
}).strict();

/** A single supported or explicitly unsupported component on this machine. */
export const updateComponentSchema = z.object({
  componentId,
  installed: z.boolean().default(false),
  supported: z.boolean(),
  activeVersion: z.string().max(128).nullish(),
  availableVersion: z.string().max(128).nullish(),
  stagedVersion: z.string().max(128).nullish(),
  phase: z.enum(["current", "available", "checked", "staged", "applying", "rollback_required", "rollback_in_progress", "failed", "unknown", "unsupported"]),
  target: updateTargetSchema.nullable().optional(),
  artifactKind: z.enum(["native-binary", "python-bundle", "oci-image"]).optional(),
  updateAvailable: z.boolean(),
  gate: updateReadinessSchema,
  blockers: z.array(z.object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
    source: z.string().max(160).optional(),
  }).strict()).max(100).default([]),
  allowedActions: z.array(z.enum(["check", "stage", "apply"])).max(3).default([]),
}).strict();

/** The digest-bound immutable set of components staged as one update. */
export const updatePlanSchema = z.object({
  planId,
  planDigest: digest,
  channel: z.enum(["stable", "preview"]),
  phase: z.enum(["checked", "staged", "applying", "succeeded", "rolled_back", "failed", "unknown"]),
  components: z.array(z.object({
    componentId,
    version: z.string().min(1).max(128),
    manifestDigest: digest,
    artifactDigest: digest,
    restartGroup: z.enum(["core-runtime", "single-service", "none"]),
  }).strict()).max(100),
}).strict();

/** Helper response data shared by Control, Linux CLI, and Web UI. */
export const updateHelperResultSchema = z.object({
  status: z.string().min(1).max(64).optional(),
  components: z.array(updateComponentSchema).max(200),
  plan: updatePlanSchema.optional(),
  plans: z.array(updatePlanSchema).max(100).optional(),
}).strict();

// IDs are resolved only by the helper's trusted catalog; they are never treated as commands or paths.
const componentSelection = z.object({ componentIds: z.array(componentId).min(1).max(100).optional() }).strict();
export const updateConfirmationSchema = z.object({
  planId,
  planDigest: digest,
  confirmed: z.literal(true),
}).strict();

/** Request sent over the fixed-argv JSON stdio helper bridge. */
export const updateHelperRequestSchema = z.discriminatedUnion("operation", [
  z.object({ protocolVersion: z.literal("cyrene.component-updates.helper.v1"), operation: z.literal("status") }).strict(),
  z.object({ protocolVersion: z.literal("cyrene.component-updates.helper.v1"), operation: z.literal("check"), channel: z.enum(["stable", "preview"]).optional() }).merge(componentSelection),
  z.object({ protocolVersion: z.literal("cyrene.component-updates.helper.v1"), operation: z.literal("stage"), planId, planDigest: digest, channel: z.enum(["stable", "preview"]).optional() }).strict(),
  z.object({ protocolVersion: z.literal("cyrene.component-updates.helper.v1"), operation: z.literal("apply"), planId, planDigest: digest, channel: z.enum(["stable", "preview"]).optional(), confirmation: updateConfirmationSchema }).strict(),
]).superRefine((request, context) => {
  if (request.operation === "apply" && (request.confirmation.planId !== request.planId || request.confirmation.planDigest !== request.planDigest)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmation"], message: "Confirmation must match the staged plan ID and digest." });
  }
});

/** Strict success/error envelope emitted by a local helper process. */
export const updateHelperEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ protocolVersion: z.literal("cyrene.component-updates.helper.v1"), ok: z.literal(true), operation: z.enum(["status", "check", "stage", "apply"]), result: updateHelperResultSchema }).strict(),
  z.object({ protocolVersion: z.literal("cyrene.component-updates.helper.v1"), ok: z.literal(false), operation: z.enum(["status", "check", "stage", "apply"]), error: z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(1000), retryable: z.boolean() }).strict() }).strict(),
]);

/** Public command definitions exposed only from a local Control instance. */
export const updateCommands = {
  "updates.status": { input: z.object({}).strict(), output: updateHelperResultSchema, scope: "updates.read", readOnly: true },
  "updates.check": { input: componentSelection.extend({ channel: z.enum(["stable", "preview"]).optional() }), output: updateHelperResultSchema, scope: "updates.read", readOnly: true },
  "updates.stage": { input: z.object({ planId, planDigest: digest, channel: z.enum(["stable", "preview"]).optional() }).strict(), output: updateHelperResultSchema, scope: "updates.apply", readOnly: false },
  "updates.apply": { input: z.object({ planId, planDigest: digest, channel: z.enum(["stable", "preview"]).optional(), confirmation: updateConfirmationSchema }).strict().refine(
    request => request.confirmation.planId === request.planId && request.confirmation.planDigest === request.planDigest,
    "Confirmation must match the staged plan ID and digest.",
  ), output: updateHelperResultSchema, scope: "updates.apply", readOnly: false },
} as const;

export type UpdateHelperRequest = z.infer<typeof updateHelperRequestSchema>;
export type UpdateHelperEnvelope = z.infer<typeof updateHelperEnvelopeSchema>;
export type UpdateHelperResult = z.infer<typeof updateHelperResultSchema>;
export type UpdatePlan = z.infer<typeof updatePlanSchema>;
export type UpdateComponent = z.infer<typeof updateComponentSchema>;
export type UpdateCommandName = keyof typeof updateCommands;
