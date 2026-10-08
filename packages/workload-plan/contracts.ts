// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 contracts.ts                                                     │
// │  Module: packages/workload-plan                                      │
// │  Role: Strict local workload-plan and helper protocol contracts.    │
// │                                                                      │
// │  模块职责：定义本机 workload 安装计划与受限 helper 协议。              │
// └─────────────────────────────────────────────────────────────────────┘
import { z } from "zod";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const componentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const planId = z.string().regex(/^plan-[a-f0-9]{32}$/);
const workloadId = z.enum(["catalyst", "echo", "plugins"]);
const workloadAction = z.enum(["install", "uninstall"]);
const targetId = z.literal("linux-ubuntu-24.04-x86_64");
const workloadTargetId = z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/);

/** Optional workload selections; required membership is resolved by the trusted catalog. */
export const workloadSelectionsSchema = z.object({
  includeComponentIds: z.array(componentId).max(100),
  excludeComponentIds: z.array(componentId).max(100),
  choices: z.record(z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/), componentId),
}).strict().superRefine((selections, context) => {
  const included = new Set(selections.includeComponentIds);
  for (const excluded of selections.excludeComponentIds) {
    if (included.has(excluded)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["excludeComponentIds"], message: `Component ${excluded} cannot be both included and excluded.` });
    }
  }
});

const defaultSelections = () => ({ includeComponentIds: [], excludeComponentIds: [], choices: {} });
const requestBase = {
  protocolVersion: z.literal("cyrene.workload-plan.v1"),
  workloadId,
  targetId,
  selections: workloadSelectionsSchema,
};

/** Requests accepted by the fixed local `cyrene workload --json` CLI bridge. */
export const workloadPlanHelperRequestSchema = z.discriminatedUnion("operation", [
  z.object({ ...requestBase, operation: z.literal("status") }).strict(),
  z.object({ ...requestBase, operation: z.literal("check"), action: workloadAction.default("install") }).strict(),
  z.object({ ...requestBase, operation: z.literal("stage"), action: workloadAction, planId, planDigest: digest }).strict(),
  z.object({ ...requestBase, operation: z.literal("apply"), action: workloadAction, planId, planDigest: digest, confirmation: z.object({ planId, planDigest: digest, confirmed: z.literal(true) }).strict() }).strict(),
]).superRefine((request, context) => {
  if (request.operation === "apply" && (request.confirmation.planId !== request.planId || request.confirmation.planDigest !== request.planDigest)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmation"], message: "Confirmation must match the staged workload plan ID and digest." });
  }
  if ("action" in request && request.action === "uninstall"
    && (request.selections.includeComponentIds.length !== 1 || request.selections.excludeComponentIds.length !== 0 || Object.keys(request.selections.choices).length !== 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["selections"], message: "Uninstall plans require exactly one included component and no exclusions or choices." });
  }
});

type BoundedJson = null | boolean | number | string | BoundedJson[] | { [key: string]: BoundedJson };
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 10_000;

function isBoundedJson(value: unknown, depth = 0, budget = { nodes: 0 }): value is BoundedJson {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 4096;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => isBoundedJson(item, depth + 1, budget));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const entries = Object.entries(value);
  return entries.length <= 500 && entries.every(([key, item]) => key.length <= 128 && isBoundedJson(item, depth + 1, budget));
}

const boundedJsonSchema = z.custom<BoundedJson>(value => isBoundedJson(value));
const boundedJsonObjectSchema = boundedJsonSchema.refine(
  value => value !== null && typeof value === "object" && !Array.isArray(value),
  "Expected a bounded JSON object.",
);
const publisherIdentitySchema = z.object({
  id: z.string().min(1).max(160),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  workflow: z.string().min(1).max(255),
  tagFormat: z.enum(["source-sha", "component-source-sha", "component-version-source-sha"]),
}).strict();
const indexIdentitySchema = z.object({
  publisherIdentity: publisherIdentitySchema,
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  assetName: z.string().min(1).max(255),
  assetUri: z.string().url().refine(value => value.startsWith("https://"), "Expected an HTTPS index URI."),
  assetDigest: digest,
  indexDigest: digest,
  channel: z.enum(["stable", "preview"]),
  releaseTag: z.string().min(1).max(200),
}).strict();

const attestationRefSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  workflow: z.string().min(1).max(255),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/),
  sourceRef: z.string().min(1).max(255),
  subjectName: z.string().min(1).max(255),
  subjectDigest: digest,
}).catchall(boundedJsonSchema);

const sourcePolicySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("actualProduct"),
    productComponentIds: z.array(componentId).min(1).max(100),
    productSources: z.array(z.object({ componentId, sourceId: z.string().regex(/^[a-z][a-z0-9._-]{0,159}$/) }).strict()).min(1).max(100),
    operations: z.tuple([
      z.literal("activate"),
      z.literal("recover_binding"),
      z.literal("deactivate"),
      z.literal("runtime_status"),
      z.literal("get_installation"),
    ]),
    sourceId: z.never().optional(),
  }).strict(),
  z.object({
    mode: z.literal("standaloneOperator"),
    productComponentIds: z.array(componentId).length(0),
    productSources: z.array(z.object({ componentId, sourceId: z.string().regex(/^[a-z][a-z0-9._-]{0,159}$/) }).strict()).length(0),
    operations: z.tuple([
      z.literal("activate"),
      z.literal("recover_binding"),
      z.literal("deactivate"),
      z.literal("runtime_status"),
      z.literal("get_installation"),
    ]),
    sourceId: z.literal("cyrene-plugin-standalone-operator"),
  }).strict(),
]).superRefine((policy, context) => {
  if (policy.mode === "actualProduct") {
    if (new Set(policy.productComponentIds).size !== policy.productComponentIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["productComponentIds"], message: "Product component IDs must be unique." });
    }
    if (new Set(policy.operations).size !== policy.operations.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["operations"], message: "Source-policy operations must be unique." });
    }
    const productIds = [...policy.productComponentIds].sort();
    const sourceIds = policy.productSources.map(source => source.componentId).sort();
    if (new Set(sourceIds).size !== sourceIds.length || stableJson(productIds) !== stableJson(sourceIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["productSources"], message: "Product source component IDs must exactly match the product component IDs." });
    }
  }
});

const requiredness = z.enum(["required", "recommended", "optional", "choice", "dependency"]);
const nullableComponentId = componentId.nullable();
const nullableDigest = digest.nullable();

const closureReasonSchema = z.object({
  componentId,
  reasonCode: z.string().min(1).max(128),
  fromComponentId: nullableComponentId,
  rootComponentId: nullableComponentId,
  versionRange: z.string().max(128).nullable(),
  depth: z.number().int().nonnegative(),
}).strict();
const warningSchema = z.object({
  code: z.string().min(1).max(80),
  componentId: nullableComponentId,
  message: z.string().min(1).max(1000),
  details: boundedJsonObjectSchema,
}).strict();
const blockerSchema = z.object({
  code: z.string().min(1).max(80),
  componentId: nullableComponentId,
  capabilityId: z.string().min(1).max(160).nullable(),
  requiredness: requiredness.nullable(),
  targetId: workloadTargetId.nullable(),
  message: z.string().min(1).max(1000),
  retryable: z.boolean(),
  details: boundedJsonObjectSchema,
}).strict();

const selectionBindingSchema = z.object({
  includeComponentIds: z.array(componentId).max(100),
  excludeComponentIds: z.array(componentId).max(100),
  choices: z.record(z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/), componentId),
}).strict();

/** One catalog-resolved release and its verified provenance identity. */
const workloadSelectedComponentFields = z.object({
  componentId,
  version: z.string().min(1).max(128),
  targetId: workloadTargetId,
  artifactKind: z.string().min(1).max(80),
  releaseId: z.string().min(1).max(200),
  manifestUri: z.string().url().refine(value => value.startsWith("https://"), "Expected an HTTPS manifest URL.").nullable(),
  manifestDigest: digest,
  manifestAssetDigest: digest,
  digest,
  indexIdentity: indexIdentitySchema.nullable(),
  publisherIdentity: publisherIdentitySchema.nullable(),
  reason: z.string().min(1).max(128),
  requiredness,
  sourcePolicy: sourcePolicySchema.nullable(),
  attestationRef: attestationRefSchema.nullable(),
  installed: z.boolean(),
  installationId: z.string().min(1).max(200).nullable(),
  installedIdentity: boundedJsonObjectSchema.nullable(),
  capabilityId: z.string().min(1).max(160).nullable(),
  packageId: z.string().min(1).max(160).nullable(),
  bindingId: z.string().regex(/^[a-z][a-z0-9-]{0,159}$/).nullable(),
}).strict();

function validateSelectedComponent(component: z.infer<typeof workloadSelectedComponentFields>, context: z.RefinementCtx) {
  if (component.sourcePolicy === null && component.bindingId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bindingId"], message: "A source binding requires its catalog-authored source policy." });
  }
  if (component.artifactKind !== "plugin-package" && component.installationId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["installationId"], message: "Non-plugin deployment components do not have Package Runtime installation IDs." });
  }
}

export const workloadSelectedComponentSchema = workloadSelectedComponentFields.superRefine(validateSelectedComponent);

const planDigestMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  catalogDigest: digest,
  workloadId,
  action: workloadAction,
  targetId,
  selectionBinding: selectionBindingSchema,
  selectedComponents: z.array(workloadSelectedComponentSchema).max(200),
  closureReasons: z.array(closureReasonSchema).max(1000),
  warnings: z.array(warningSchema).max(100),
  blockers: z.array(blockerSchema).max(100),
}).strict();

/** Catalog-bound workload resolution and digest-bound installation plan. */
export const workloadResolutionSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["ready", "blocked"]),
  planId,
  planDigest: digest,
  catalogDigest: digest,
  workloadId,
  action: workloadAction,
  targetId,
  selectedComponents: z.array(workloadSelectedComponentSchema).max(200),
  closureReasons: z.array(closureReasonSchema).max(1000),
  warnings: z.array(warningSchema).max(100),
  blockers: z.array(blockerSchema).max(100),
  selectionBinding: selectionBindingSchema,
  planDigestMaterial: planDigestMaterialSchema,
}).strict().superRefine((result, context) => {
  const expectedPlanId = `plan-${result.planDigest.slice("sha256:".length, "sha256:".length + 32)}`;
  if (result.planId !== expectedPlanId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["planId"], message: "Plan ID must be derived from the full plan digest." });
  }
  for (let index = 1; index < result.selectedComponents.length; index += 1) {
    if (result.selectedComponents[index - 1].componentId >= result.selectedComponents[index].componentId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedComponents", index], message: "Selected components must be sorted by unique component ID." });
      break;
    }
  }
  if (result.status === "ready" && result.blockers.length > 0 || result.status === "blocked" && result.blockers.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["blockers"], message: "Ready results have no blockers; blocked results identify at least one blocker." });
  }
  for (const [field, ids] of [["includeComponentIds", result.selectionBinding.includeComponentIds], ["excludeComponentIds", result.selectionBinding.excludeComponentIds]] as const) {
    if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && ids[index - 1] >= id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectionBinding", field], message: "Selection binding component IDs must be unique and sorted." });
    }
  }
  if (result.action === "uninstall") {
    if (result.selectionBinding.includeComponentIds.length !== 1 || result.selectionBinding.excludeComponentIds.length !== 0 || Object.keys(result.selectionBinding.choices).length !== 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectionBinding"], message: "Uninstall plans require one included component and no exclusions or choices." });
    }
    if (result.status === "ready" && result.selectedComponents.length !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedComponents"], message: "A ready uninstall plan must resolve exactly one installed component." });
    }
    result.selectedComponents.forEach((component, index) => {
      if ((component.artifactKind === "plugin-package" && component.installationId === null)
        || (component.artifactKind !== "plugin-package" && component.installationId !== null)
        || component.installedIdentity === null || component.componentId !== result.selectionBinding.includeComponentIds[0]) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedComponents", index], message: "Uninstall rows must bind the selected component's exact installed identity." });
      }
    });
  }
  result.selectedComponents.forEach((component, index) => {
    if (result.action === "install" && (component.publisherIdentity === null || component.indexIdentity === null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedComponents", index], message: "Install rows must resolve through a verified publisher and release index." });
    }
    if (result.action === "install" && component.indexIdentity !== null
      && stableJson(component.indexIdentity.publisherIdentity) !== stableJson(component.publisherIdentity)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedComponents", index, "indexIdentity", "publisherIdentity"], message: "Install index publisher identity must match the selected component authority." });
    }
  });
  const expectedMaterial = {
    schemaVersion: result.schemaVersion,
    catalogDigest: result.catalogDigest,
    workloadId: result.workloadId,
    action: result.action,
    targetId: result.targetId,
    selectionBinding: result.selectionBinding,
    selectedComponents: result.selectedComponents,
    closureReasons: result.closureReasons,
    warnings: result.warnings,
    blockers: result.blockers,
  };
  if (stableJson(expectedMaterial) !== stableJson(result.planDigestMaterial)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["planDigestMaterial"], message: "Plan digest material must match the resolved workload snapshot." });
  }
});

const planResultIdentityFields = {
  planId,
  planDigest: digest,
  catalogDigest: digest,
  workloadId,
  action: workloadAction,
  targetId,
  resolution: workloadResolutionSchema,
  warnings: z.array(warningSchema).max(100),
  blockers: z.array(blockerSchema).max(100),
};

const statusComponentSchema = z.object({
  componentId,
  installed: boundedJsonSchema,
  version: z.string().min(1).max(128).nullable(),
  digest: nullableDigest,
  verification: boundedJsonSchema,
}).strict();

const stagedComponentSchema = z.object({
  componentId,
  status: z.enum(["current", "staged"]),
  artifactKind: z.string().min(1).max(80).optional(),
  version: z.string().min(1).max(128).optional(),
  digest: nullableDigest.optional(),
  manifestDigest: nullableDigest.optional(),
  stagedIdentity: boundedJsonObjectSchema.optional(),
}).strict();

const appliedComponentSchema = z.object({
  ...workloadSelectedComponentFields.shape,
  alreadyAbsent: z.literal(true).optional(),
}).strict().superRefine((component, context) => validateSelectedComponent(component, context));

/** Read-only local inventory result returned by the status operation. */
export const workloadStatusResultSchema = z.object({
  status: z.literal("ready"),
  workloadId,
  targetId,
  catalogGeneration: z.number().int().positive(),
  catalogDigest: digest,
  components: z.array(statusComponentSchema).max(200),
}).strict().superRefine((result, context) => {
  for (let index = 1; index < result.components.length; index += 1) {
    if (result.components[index - 1].componentId >= result.components[index].componentId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["components", index], message: "Status components must be sorted by unique component ID." });
      break;
    }
  }
});

type PlanResultIdentity = {
  planId: string;
  planDigest: string;
  catalogDigest: string;
  workloadId: "catalyst" | "echo" | "plugins";
  action: "install" | "uninstall";
  targetId: string;
  resolution: z.infer<typeof workloadResolutionSchema>;
  warnings: z.infer<typeof warningSchema>[];
  blockers: z.infer<typeof blockerSchema>[];
};

function comparePlanIdentity(result: PlanResultIdentity, context: z.RefinementCtx) {
  if (result.planId !== result.resolution.planId || result.planDigest !== result.resolution.planDigest || result.catalogDigest !== result.resolution.catalogDigest || result.workloadId !== result.resolution.workloadId || result.action !== result.resolution.action || result.targetId !== result.resolution.targetId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resolution"], message: "Result identity must match the resolver resolution." });
  }
  if (stableJson(result.warnings) !== stableJson(result.resolution.warnings) || stableJson(result.blockers) !== stableJson(result.resolution.blockers)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["warnings"], message: "Public warnings and blockers must match the resolver resolution." });
  }
}

export const workloadCheckResultSchema = z.object({
  status: z.enum(["ready", "blocked"]),
  ...planResultIdentityFields,
  components: z.array(workloadSelectedComponentSchema).max(200),
}).strict().superRefine((result, context) => {
  comparePlanIdentity(result, context);
  if (stableJson(result.components) !== stableJson(result.resolution.selectedComponents)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["components"], message: "Check components must mirror resolver selections." });
  }
  if (result.status !== result.resolution.status || result.resolution.status === "ready" && result.blockers.length > 0 || result.resolution.status === "blocked" && result.blockers.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Check status must match the ready/blocked resolver result." });
  }
});

export const workloadStageResultSchema = z.object({
  status: z.literal("staged"),
  ...planResultIdentityFields,
  components: z.array(stagedComponentSchema).max(200),
}).strict().superRefine((result, context) => {
  comparePlanIdentity(result, context);
  if (result.resolution.status !== "ready" || result.blockers.length > 0 || result.components.length !== result.resolution.selectedComponents.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Only a ready resolution with a stage row for every selected component can be staged." });
  }
  if (result.components.some((component, index) => {
    const selected = result.resolution.selectedComponents[index];
    return !selected || component.componentId !== selected.componentId
      || component.artifactKind !== undefined && component.artifactKind !== selected.artifactKind
      || component.version !== undefined && component.version !== selected.version
      || component.digest !== undefined && component.digest !== selected.digest
      || component.manifestDigest !== undefined && component.manifestDigest !== selected.manifestDigest;
  })) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["components"], message: "Stage rows must preserve ordered selected component identity." });
  }
});

export const workloadApplyResultSchema = z.object({
  status: z.enum(["installed", "activated", "uninstalled"]),
  planId,
  planDigest: digest,
  catalogDigest: digest,
  workloadId,
  action: workloadAction,
  targetId,
  components: z.array(appliedComponentSchema).max(200),
  resolution: workloadResolutionSchema,
  warnings: z.array(warningSchema).max(100),
  blockers: z.array(blockerSchema).max(100),
}).strict().superRefine((result, context) => {
  if (result.resolution.status !== "ready" || result.blockers.length > 0 || result.planId !== result.resolution.planId || result.planDigest !== result.resolution.planDigest || result.catalogDigest !== result.resolution.catalogDigest || result.workloadId !== result.resolution.workloadId || result.action !== result.resolution.action || result.targetId !== result.resolution.targetId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resolution"], message: "Apply results must bind a ready resolver plan with the same identity." });
  }
  if ((result.resolution.action === "uninstall") !== (result.status === "uninstalled")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Apply status must identify whether the plan installed or uninstalled components." });
  }
  if (result.components.length !== result.resolution.selectedComponents.length || result.components.some((component, index) => {
    const selected = result.resolution.selectedComponents[index];
    const identity = Object.fromEntries(Object.entries(component).filter(([key]) => key !== "alreadyAbsent"));
    return !selected || stableJson(identity) !== stableJson(selected);
  })) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["components"], message: "Applied component rows must preserve resolver identity." });
  }
  if (stableJson(result.warnings) !== stableJson(result.resolution.warnings) || stableJson(result.blockers) !== stableJson(result.resolution.blockers)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["warnings"], message: "Public warnings and blockers must match the resolver resolution." });
  }
  if (result.components.some(component => component.alreadyAbsent === true && (result.resolution.action !== "uninstall"
    || result.resolution.selectedComponents.find(selected => selected.componentId === component.componentId)?.artifactKind !== "plugin-package"))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["components"], message: "alreadyAbsent is valid only for a plugin uninstall receipt." });
  }
  if (result.components.some((component, index) => {
    const selected = result.resolution.selectedComponents[index];
    return selected?.artifactKind !== "plugin-package" && component.installationId !== null;
  })) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["components"], message: "Non-plugin deployment components do not have Package Runtime installation IDs." });
  }
});

/** Operation-specific result union returned to local Control callers. */
export const workloadCommandResultSchema = z.union([
  workloadStatusResultSchema,
  workloadCheckResultSchema,
  workloadStageResultSchema,
  workloadApplyResultSchema,
]);

/** Canonicalize bounded JSON for structural checks without relying on Node-only crypto. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Success or bounded error response returned by the local workload CLI. */
export const workloadPlanHelperEnvelopeSchema = z.union([
  z.object({ protocolVersion: z.literal("cyrene.workload-plan.v1"), ok: z.literal(true), operation: z.literal("status"), result: workloadStatusResultSchema }).strict(),
  z.object({ protocolVersion: z.literal("cyrene.workload-plan.v1"), ok: z.literal(true), operation: z.literal("check"), result: workloadCheckResultSchema }).strict(),
  z.object({ protocolVersion: z.literal("cyrene.workload-plan.v1"), ok: z.literal(true), operation: z.literal("stage"), result: workloadStageResultSchema }).strict(),
  z.object({ protocolVersion: z.literal("cyrene.workload-plan.v1"), ok: z.literal(true), operation: z.literal("apply"), result: workloadApplyResultSchema }).strict(),
  z.object({ protocolVersion: z.literal("cyrene.workload-plan.v1"), ok: z.literal(false), operation: z.enum(["status", "check", "stage", "apply"]), error: z.object({ code: z.string().min(1).max(80), message: z.string().min(1).max(1000), retryable: z.boolean() }).strict() }).strict(),
]);

const selectionInput = workloadSelectionsSchema.default(defaultSelections());
const commandBase = z.object({ workloadId, targetId, selections: selectionInput }).strict();
const confirmationSchema = z.object({ planId, planDigest: digest, confirmed: z.literal(true) }).strict();

/** Commands exposed only by a loopback local Control instance. */
export const workloadCommands = {
  "workloads.status": { input: commandBase, output: workloadStatusResultSchema, scope: "workloads.read", readOnly: true },
  "workloads.check": { input: commandBase.extend({ action: workloadAction.default("install") }).superRefine((value, context) => {
    if (value.action === "uninstall"
      && (value.selections.includeComponentIds.length !== 1 || value.selections.excludeComponentIds.length !== 0 || Object.keys(value.selections.choices).length !== 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selections"], message: "Uninstall plans require exactly one included component and no exclusions or choices." });
    }
  }), output: workloadCheckResultSchema, scope: "workloads.read", readOnly: true },
  "workloads.stage": { input: commandBase.extend({ action: workloadAction, planId, planDigest: digest }).superRefine((value, context) => {
    if (value.action === "uninstall"
      && (value.selections.includeComponentIds.length !== 1 || value.selections.excludeComponentIds.length !== 0 || Object.keys(value.selections.choices).length !== 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selections"], message: "Uninstall plans require exactly one included component and no exclusions or choices." });
    }
  }), output: workloadStageResultSchema, scope: "workloads.install", readOnly: false },
  "workloads.apply": { input: commandBase.extend({ action: workloadAction, planId, planDigest: digest, confirmation: confirmationSchema }).refine(
    request => request.confirmation.planId === request.planId && request.confirmation.planDigest === request.planDigest,
    "Confirmation must match the staged workload plan ID and digest.",
  ).superRefine((value, context) => {
    if (value.action === "uninstall"
      && (value.selections.includeComponentIds.length !== 1 || value.selections.excludeComponentIds.length !== 0 || Object.keys(value.selections.choices).length !== 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selections"], message: "Uninstall plans require exactly one included component and no exclusions or choices." });
    }
  }), output: workloadApplyResultSchema, scope: "workloads.install", readOnly: false },
} as const;

export type WorkloadPlanHelperRequest = z.infer<typeof workloadPlanHelperRequestSchema>;
export type WorkloadPlanHelperEnvelope = z.infer<typeof workloadPlanHelperEnvelopeSchema>;
export type WorkloadPlanResult = z.infer<typeof workloadCommandResultSchema>;
export type WorkloadCheckResult = z.infer<typeof workloadCheckResultSchema>;
export type WorkloadSelectedComponent = z.infer<typeof workloadSelectedComponentSchema>;
export type WorkloadCommandName = keyof typeof workloadCommands;
