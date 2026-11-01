// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-operations API                      │
// │ Role: Call owner-backed maintenance, research, and Nous Work routes.│
// │ 中文：模块职责：调用维护、研究与 Nous 工作流所属 API。                │
// └─────────────────────────────────────────────────────────────────────┘

import type { NavigatorTransport } from "./transport";
import { NavigatorContractError } from "./errors";
import { requireArray, requireBoolean, requireNumber, requireRecord, requireString } from "./parsers/validation";
import { jsonRequest, workId, workPath } from "./requests";
import type { ResponseParser } from "./types";
import type { ConversationKind, ConversationSourceReference } from "./conversation-memory";

export type MaintenanceKind = "dream" | "forget" | "daily_review" | "backup" | "import";
export type MaintenanceState = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ConversationFocusKind = "commitment" | "wait" | "attention";
export type ConversationFocusState = "open" | "waiting" | "done" | "cancelled";

export interface MaintenanceJob {
  id: string; taskId: string; idempotencyKey: string; kind: MaintenanceKind; conversationId: string | null; conversationKind: ConversationKind | null; personaId: string | null; state: MaintenanceState;
  cursor: string | null; processedCount: number; checkpointDigest: string | null; details: Record<string, unknown>;
  version: number; queuedVersion: number; createdAt: number; updatedAt: number;
}
export interface MaintenanceCheckpoint {
  cursor: string | null; processedCount: number; checkpointDigest: string; details?: Record<string, unknown>;
}
export interface ResearchNote {
  id: string; idempotencyKey: string; conversationId: string; conversationKind: ConversationKind | null; personaId: string | null; title: string; content: string; sourceRefs: ConversationSourceReference[]; revision: number; createdAt: number;
}
export interface VerifiedConversationSkill {
  id: string; idempotencyKey: string; conversationId: string | null; conversationKind: ConversationKind | null; personaId: string | null; name: string; content: string; sourceRefs: ConversationSourceReference[]; operationReceiptId: string; independentReadReceiptId: string; verified: true;
  verifiedBy: string; verifiedAt: number; revision: number; createdAt: number;
}
export interface ConversationWatch {
  id: string; idempotencyKey: string; conversationId: string; conversationKind: ConversationKind | null; personaId: string | null; title: string; condition: string; sourceRefs: ConversationSourceReference[];
  nextCheckAt: number | null; state: "active" | "cancelled"; version: number; createdAt: number; updatedAt: number;
}
export interface ConversationFocusItem {
  id: string; idempotencyKey: string; conversationId: string; conversationKind: ConversationKind | null; personaId: string | null; kind: ConversationFocusKind; summary: string; sourceRefs: ConversationSourceReference[];
  dueAt: number | null; condition: string | null; state: ConversationFocusState; version: number; createdAt: number; updatedAt: number;
}
export interface ConversationHandoff {
  id: string; idempotencyKey: string; conversationId: string | null; conversationKind: ConversationKind | null; personaId: string | null; taskId: string; sessionId: string; summary: string; unresolvedItems: string[];
  unknownOperationRefs: string[]; sourceRefs: ConversationSourceReference[]; createdAt: number;
}
export interface ActiveBehaviorPolicy {
  conversationId: string; enabled: boolean; quietHours: { timeZone: string; start: string; end: string };
  cooldownSeconds: number; allowGroupInterjections: boolean; followupEnabled: boolean; version: number;
  createdAt: number | null; updatedAt: number | null;
}
export interface ConversationReviewEvent {
  id: string; idempotencyKey: string; conversationId: string | null; conversationKind: ConversationKind | null; personaId: string | null; eventType: "approved" | "rejected" | "edited" | "imported" | "rolled_back" | "reviewed";
  summary: string; decision: string | null; sourceRefs: ConversationSourceReference[]; createdAt: number;
}
export interface ConversationImportPreview { recordCount: number; acceptedCount: number; quarantinedCount: number; digest: string }
export interface ConversationImportResult { batchId: string; importedCount: number; quarantinedCount: number; digest: string }
export interface ConversationImportRollback { batchId: string; rolledBack: boolean; quarantinedCount: number }

function stringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item) => {
    if (typeof item !== "string") throw new NavigatorContractError(`Navigator returned an invalid ${label}.`);
    return item;
  });
}
function parseSourceRefs(value: unknown, label: string): ConversationSourceReference[] {
  return requireArray(value, label).map((item) => {
    if (typeof item === "string") return { memoryId: null, memoryVersion: null, sourceMessageIds: [item] };
    const row = requireRecord(item, label);
    const memoryId = nullableString(row, "memoryId", label), memoryVersion = nullableNumber(row, "memoryVersion", label);
    if ((memoryId === null) !== (memoryVersion === null)) throw new NavigatorContractError(`Navigator returned an invalid memory revision in ${label}.`);
    const sourceMessageIds = stringArray(row["sourceMessageIds"], `${label} source message IDs`);
    if (memoryId === null && sourceMessageIds.length === 0) throw new NavigatorContractError(`Navigator returned an empty source reference in ${label}.`);
    return { memoryId, memoryVersion, sourceMessageIds };
  });
}
function itemArray(value: unknown, label: string): unknown[] {
  const root = requireRecord(value, label);
  return requireArray(root["items"], `${label} items`);
}
function nullableString(row: Record<string, unknown>, key: string, label: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  return value;
}
function nullableNumber(row: Record<string, unknown>, key: string, label: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  return value;
}
function parseChoice<T extends string>(row: Record<string, unknown>, key: string, values: readonly T[], label: string): T {
  const value = requireString(row, key, label);
  if (!values.includes(value as T)) throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  return value as T;
}
function nullableChoice<T extends string>(row: Record<string, unknown>, key: string, values: readonly T[], label: string): T | null {
  if (row[key] === null || row[key] === undefined) return null;
  return parseChoice(row, key, values, label);
}

function parseMaintenanceJob(value: unknown): MaintenanceJob {
  const row = requireRecord(value, "maintenance job");
  return {
    id: requireString(row, "id", "maintenance job"), taskId: requireString(row, "taskId", "maintenance job"), idempotencyKey: requireString(row, "idempotencyKey", "maintenance job"),
    kind: parseChoice(row, "kind", ["dream", "forget", "daily_review", "backup", "import"], "maintenance job"),
    conversationId: nullableString(row, "conversationId", "maintenance job"),
    conversationKind: nullableChoice(row, "conversationKind", ["direct", "group", "channel"], "maintenance job"),
    personaId: nullableString(row, "personaId", "maintenance job"),
    state: parseChoice(row, "state", ["queued", "running", "completed", "failed", "cancelled"], "maintenance job"),
    cursor: nullableString(row, "cursor", "maintenance job"), processedCount: requireNumber(row, "processedCount", "maintenance job"),
    checkpointDigest: nullableString(row, "checkpointDigest", "maintenance job"), details: requireRecord(row["details"], "maintenance job details"),
    version: requireNumber(row, "version", "maintenance job"), queuedVersion: requireNumber(row, "queuedVersion", "maintenance job"), createdAt: requireNumber(row, "createdAt", "maintenance job"), updatedAt: requireNumber(row, "updatedAt", "maintenance job"),
  };
}
function parseResearchNote(value: unknown): ResearchNote {
  const row = requireRecord(value, "research note");
  return { id: requireString(row, "id", "research note"), idempotencyKey: requireString(row, "idempotencyKey", "research note"), conversationId: requireString(row, "conversationId", "research note"), conversationKind: nullableChoice(row, "conversationKind", ["direct", "group", "channel"], "research note"), personaId: nullableString(row, "personaId", "research note"), title: requireString(row, "title", "research note"), content: requireString(row, "content", "research note"), sourceRefs: parseSourceRefs(row["sourceRefs"], "research note source refs"), revision: requireNumber(row, "revision", "research note"), createdAt: requireNumber(row, "createdAt", "research note") };
}
function parseSkill(value: unknown): VerifiedConversationSkill {
  const row = requireRecord(value, "verified conversation skill");
  if (row["verified"] !== true) throw new NavigatorContractError("Navigator returned an unverified conversation skill.");
  return { id: requireString(row, "id", "verified conversation skill"), idempotencyKey: requireString(row, "idempotencyKey", "verified conversation skill"), conversationId: nullableString(row, "conversationId", "verified conversation skill"), conversationKind: nullableChoice(row, "conversationKind", ["direct", "group", "channel"], "verified conversation skill"), personaId: nullableString(row, "personaId", "verified conversation skill"), name: requireString(row, "name", "verified conversation skill"), content: requireString(row, "content", "verified conversation skill"), sourceRefs: parseSourceRefs(row["sourceRefs"], "skill source refs"), operationReceiptId: requireString(row, "operationReceiptId", "verified conversation skill"), independentReadReceiptId: requireString(row, "independentReadReceiptId", "verified conversation skill"), verified: true, verifiedBy: requireString(row, "verifiedBy", "verified conversation skill"), verifiedAt: requireNumber(row, "verifiedAt", "verified conversation skill"), revision: requireNumber(row, "revision", "verified conversation skill"), createdAt: requireNumber(row, "createdAt", "verified conversation skill") };
}
function parseWatch(value: unknown): ConversationWatch {
  const row = requireRecord(value, "conversation watch");
  return { id: requireString(row, "id", "conversation watch"), idempotencyKey: requireString(row, "idempotencyKey", "conversation watch"), conversationId: requireString(row, "conversationId", "conversation watch"), conversationKind: nullableChoice(row, "conversationKind", ["direct", "group", "channel"], "conversation watch"), personaId: nullableString(row, "personaId", "conversation watch"), title: requireString(row, "title", "conversation watch"), condition: requireString(row, "condition", "conversation watch"), sourceRefs: parseSourceRefs(row["sourceRefs"], "watch source refs"), nextCheckAt: nullableNumber(row, "nextCheckAt", "conversation watch"), state: parseChoice(row, "state", ["active", "cancelled"], "conversation watch"), version: requireNumber(row, "version", "conversation watch"), createdAt: requireNumber(row, "createdAt", "conversation watch"), updatedAt: requireNumber(row, "updatedAt", "conversation watch") };
}
function parseFocusItem(value: unknown): ConversationFocusItem {
  const row = requireRecord(value, "conversation focus item");
  return { id: requireString(row, "id", "conversation focus item"), idempotencyKey: requireString(row, "idempotencyKey", "conversation focus item"), conversationId: requireString(row, "conversationId", "conversation focus item"), conversationKind: nullableChoice(row, "conversationKind", ["direct", "group", "channel"], "conversation focus item"), personaId: nullableString(row, "personaId", "conversation focus item"), kind: parseChoice(row, "kind", ["commitment", "wait", "attention"], "conversation focus item"), summary: requireString(row, "summary", "conversation focus item"), sourceRefs: parseSourceRefs(row["sourceRefs"], "focus source refs"), dueAt: nullableNumber(row, "dueAt", "conversation focus item"), condition: nullableString(row, "condition", "conversation focus item"), state: parseChoice(row, "state", ["open", "waiting", "done", "cancelled"], "conversation focus item"), version: requireNumber(row, "version", "conversation focus item"), createdAt: requireNumber(row, "createdAt", "conversation focus item"), updatedAt: requireNumber(row, "updatedAt", "conversation focus item") };
}
function parseHandoff(value: unknown): ConversationHandoff {
  const row = requireRecord(value, "conversation handoff");
  return { id: requireString(row, "id", "conversation handoff"), idempotencyKey: requireString(row, "idempotencyKey", "conversation handoff"), conversationId: nullableString(row, "conversationId", "conversation handoff"), conversationKind: nullableChoice(row, "conversationKind", ["direct", "group", "channel"], "conversation handoff"), personaId: nullableString(row, "personaId", "conversation handoff"), taskId: requireString(row, "taskId", "conversation handoff"), sessionId: requireString(row, "sessionId", "conversation handoff"), summary: requireString(row, "summary", "conversation handoff"), unresolvedItems: stringArray(row["unresolvedItems"], "handoff unresolved items"), unknownOperationRefs: stringArray(row["unknownOperationRefs"], "handoff unknown operations"), sourceRefs: parseSourceRefs(row["sourceRefs"], "handoff source refs"), createdAt: requireNumber(row, "createdAt", "conversation handoff") };
}
function parsePolicy(value: unknown): ActiveBehaviorPolicy {
  const root = requireRecord(value, "active behavior policy receipt"), row = requireRecord(root["policy"], "active behavior policy");
  const quiet = requireRecord(row["quietHours"], "active behavior quiet hours");
  return { conversationId: requireString(row, "conversationId", "active behavior policy"), enabled: requireBoolean(row, "enabled", "active behavior policy"), quietHours: { timeZone: requireString(quiet, "timeZone", "active behavior quiet hours"), start: requireString(quiet, "start", "active behavior quiet hours"), end: requireString(quiet, "end", "active behavior quiet hours") }, cooldownSeconds: requireNumber(row, "cooldownSeconds", "active behavior policy"), allowGroupInterjections: requireBoolean(row, "allowGroupInterjections", "active behavior policy"), followupEnabled: requireBoolean(row, "followupEnabled", "active behavior policy"), version: requireNumber(row, "version", "active behavior policy"), createdAt: nullableNumber(row, "createdAt", "active behavior policy"), updatedAt: nullableNumber(row, "updatedAt", "active behavior policy") };
}
function parseReviewEvent(value: unknown): ConversationReviewEvent {
  const row = requireRecord(value, "conversation review event");
  return { id: requireString(row, "id", "conversation review event"), idempotencyKey: requireString(row, "idempotencyKey", "conversation review event"), conversationId: nullableString(row, "conversationId", "conversation review event"), conversationKind: nullableChoice(row, "conversationKind", ["direct", "group", "channel"], "conversation review event"), personaId: nullableString(row, "personaId", "conversation review event"), eventType: parseChoice(row, "eventType", ["approved", "rejected", "edited", "imported", "rolled_back", "reviewed"], "conversation review event"), summary: requireString(row, "summary", "conversation review event"), decision: nullableString(row, "decision", "conversation review event"), sourceRefs: parseSourceRefs(row["sourceRefs"], "review event source refs"), createdAt: requireNumber(row, "createdAt", "conversation review event") };
}
function parseImportPreview(value: unknown): ConversationImportPreview {
  const row = requireRecord(value, "conversation import preview");
  return { recordCount: requireNumber(row, "recordCount", "conversation import preview"), acceptedCount: requireNumber(row, "acceptedCount", "conversation import preview"), quarantinedCount: requireNumber(row, "quarantinedCount", "conversation import preview"), digest: requireString(row, "digest", "conversation import preview") };
}

const parseMaintenanceEnvelope: ResponseParser<{ job: MaintenanceJob; duplicate: boolean }> = (value) => { const row = requireRecord(value, "maintenance job receipt"); return { job: parseMaintenanceJob(row["job"]), duplicate: requireBoolean(row, "duplicate", "maintenance job receipt") }; };
const parseMaintenanceView: ResponseParser<MaintenanceJob> = parseMaintenanceJob;
const parseMaintenanceUpdate: ResponseParser<{ job: MaintenanceJob }> = (value) => ({ job: parseMaintenanceJob(requireRecord(value, "maintenance checkpoint receipt")["job"]) });
const parseResearchNoteEnvelope: ResponseParser<{ note: ResearchNote; duplicate: boolean }> = (value) => { const row = requireRecord(value, "research note receipt"); return { note: parseResearchNote(row["note"]), duplicate: requireBoolean(row, "duplicate", "research note receipt") }; };
const parseSkillEnvelope: ResponseParser<{ skill: VerifiedConversationSkill; duplicate: boolean }> = (value) => { const row = requireRecord(value, "verified skill receipt"); return { skill: parseSkill(row["skill"]), duplicate: requireBoolean(row, "duplicate", "verified skill receipt") }; };
const parseWatchEnvelope: ResponseParser<{ watch: ConversationWatch; duplicate: boolean }> = (value) => { const row = requireRecord(value, "watch receipt"); return { watch: parseWatch(row["watch"]), duplicate: requireBoolean(row, "duplicate", "watch receipt") }; };
const parseWatchUpdate: ResponseParser<{ watch: ConversationWatch }> = (value) => ({ watch: parseWatch(requireRecord(value, "watch update receipt")["watch"]) });
const parseFocusEnvelope: ResponseParser<{ item: ConversationFocusItem; duplicate: boolean }> = (value) => { const row = requireRecord(value, "focus item receipt"); return { item: parseFocusItem(row["item"]), duplicate: requireBoolean(row, "duplicate", "focus item receipt") }; };
const parseFocusUpdate: ResponseParser<{ item: ConversationFocusItem }> = (value) => ({ item: parseFocusItem(requireRecord(value, "focus item transition receipt")["item"]) });
const parseHandoffEnvelope: ResponseParser<{ handoff: ConversationHandoff; duplicate: boolean }> = (value) => { const row = requireRecord(value, "handoff receipt"); return { handoff: parseHandoff(row["handoff"]), duplicate: requireBoolean(row, "duplicate", "handoff receipt") }; };
const parseImportApply: ResponseParser<ConversationImportResult> = (value) => { const row = requireRecord(value, "import apply receipt"); return { batchId: requireString(row, "batchId", "import apply receipt"), importedCount: requireNumber(row, "importedCount", "import apply receipt"), quarantinedCount: requireNumber(row, "quarantinedCount", "import apply receipt"), digest: requireString(row, "digest", "import apply receipt") }; };
const parseImportRollback: ResponseParser<ConversationImportRollback> = (value) => { const row = requireRecord(value, "import rollback receipt"); return { batchId: requireString(row, "batchId", "import rollback receipt"), rolledBack: requireBoolean(row, "rolledBack", "import rollback receipt"), quarantinedCount: requireNumber(row, "quarantinedCount", "import rollback receipt") }; };

/**
 * Owner-scoped Client adapter for maintenance, research, and Nous projections.
 * 中文：为维护、研究与 Nous 投影提供同源 Client 适配器。
 */
export class ConversationOperationsApi {
  constructor(private readonly transport: NavigatorTransport) {}

  createMaintenanceJob(workspaceId: string, input: { idempotencyKey: string; kind: MaintenanceKind; conversationId?: string; conversationKind?: ConversationKind; personaId?: string; cursor?: string }): Promise<{ job: MaintenanceJob; duplicate: boolean }> {
    const conversationId = input.conversationId ? workId(input.conversationId) : undefined;
    const body = {
      idempotencyKey: input.idempotencyKey,
      kind: input.kind,
      ...(conversationId ? { conversationId, conversationKind: input.conversationKind ?? "direct", ...(input.personaId ? { personaId: workId(input.personaId) } : {}) } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/maintenance/jobs"), jsonRequest("POST", body, input.idempotencyKey), parseMaintenanceEnvelope);
  }
  listMaintenanceJobs(workspaceId: string, input: { state?: MaintenanceState; limit?: number } = {}, signal?: AbortSignal): Promise<MaintenanceJob[]> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 100) }); if (input.state) query.set("state", input.state);
    const parse: ResponseParser<MaintenanceJob[]> = (value) => itemArray(value, "maintenance jobs").map(parseMaintenanceJob);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/maintenance/jobs?${query}`), { method: "GET", signal }, parse);
  }
  getMaintenanceJob(workspaceId: string, jobId: string, signal?: AbortSignal): Promise<MaintenanceJob> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/maintenance/jobs/${workId(jobId)}`), { method: "GET", signal }, parseMaintenanceView);
  }
  checkpointMaintenanceJob(workspaceId: string, jobId: string, input: { expectedVersion: number; checkpoint: MaintenanceCheckpoint }): Promise<{ job: MaintenanceJob }> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/maintenance/jobs/${workId(jobId)}/checkpoint`), jsonRequest("PATCH", input), parseMaintenanceUpdate);
  }
  cancelMaintenanceJob(workspaceId: string, jobId: string, expectedVersion: number): Promise<{ job: MaintenanceJob }> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/maintenance/jobs/${workId(jobId)}/cancel`), jsonRequest("POST", { expectedVersion }, true), parseMaintenanceUpdate);
  }

  createResearchNote(workspaceId: string, input: { idempotencyKey: string; conversationId: string; conversationKind: ConversationKind; personaId?: string; title: string; content: string; sourceRefs: string[] }): Promise<{ note: ResearchNote; duplicate: boolean }> {
    const body = { ...input, conversationId: workId(input.conversationId), sourceRefs: input.sourceRefs.map(workId), ...(input.personaId ? { personaId: workId(input.personaId) } : {}) };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/research/notes"), jsonRequest("POST", body, input.idempotencyKey), parseResearchNoteEnvelope);
  }
  listResearchNotes(workspaceId: string, input: { conversationId?: string; limit?: number } = {}, signal?: AbortSignal): Promise<ResearchNote[]> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 100) }); if (input.conversationId) query.set("conversationId", workId(input.conversationId));
    const parse: ResponseParser<ResearchNote[]> = (value) => itemArray(value, "research notes").map(parseResearchNote);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/research/notes?${query}`), { method: "GET", signal }, parse);
  }
  createVerifiedSkill(workspaceId: string, input: { idempotencyKey: string; name: string; content: string; sourceRefs: string[]; operationReceiptId: string; independentReadReceiptId: string; conversationId?: string; conversationKind?: ConversationKind; personaId?: string }): Promise<{ skill: VerifiedConversationSkill; duplicate: boolean }> {
    const body = {
      ...input,
      sourceRefs: input.sourceRefs.map(workId),
      operationReceiptId: workId(input.operationReceiptId),
      independentReadReceiptId: workId(input.independentReadReceiptId),
      ...(input.conversationId ? { conversationId: workId(input.conversationId), conversationKind: input.conversationKind ?? "direct", ...(input.personaId ? { personaId: workId(input.personaId) } : { personaId: null }) } : { conversationKind: "direct" as const, personaId: null }),
    };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/research/skills"), jsonRequest("POST", body, input.idempotencyKey), parseSkillEnvelope);
  }
  listVerifiedSkills(workspaceId: string, limit = 100, signal?: AbortSignal): Promise<VerifiedConversationSkill[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    const parse: ResponseParser<VerifiedConversationSkill[]> = (value) => itemArray(value, "verified skills").map(parseSkill);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/research/skills?${query}`), { method: "GET", signal }, parse);
  }

  createWatch(workspaceId: string, input: { idempotencyKey: string; conversationId: string; conversationKind: ConversationKind; personaId?: string; title: string; condition: string; sourceRefs: string[]; nextCheckAt?: number }): Promise<{ watch: ConversationWatch; duplicate: boolean }> {
    const body = { ...input, conversationId: workId(input.conversationId), sourceRefs: input.sourceRefs.map(workId), ...(input.personaId ? { personaId: workId(input.personaId) } : {}) };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/watches"), jsonRequest("POST", body, input.idempotencyKey), parseWatchEnvelope);
  }
  listWatches(workspaceId: string, input: { state?: "active" | "cancelled"; limit?: number } = {}, signal?: AbortSignal): Promise<ConversationWatch[]> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 100) }); if (input.state) query.set("state", input.state);
    const parse: ResponseParser<ConversationWatch[]> = (value) => itemArray(value, "conversation watches").map(parseWatch);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/watches?${query}`), { method: "GET", signal }, parse);
  }
  cancelWatch(workspaceId: string, watchId: string, expectedVersion: number): Promise<{ watch: ConversationWatch }> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/watches/${workId(watchId)}/cancel`), jsonRequest("POST", { expectedVersion }, true), parseWatchUpdate);
  }

  createFocusItem(workspaceId: string, input: { idempotencyKey: string; conversationId: string; conversationKind: ConversationKind; personaId?: string; kind: ConversationFocusKind; summary: string; sourceRefs: string[]; dueAt?: number; condition?: string }): Promise<{ item: ConversationFocusItem; duplicate: boolean }> {
    const body = { ...input, conversationId: workId(input.conversationId), sourceRefs: input.sourceRefs.map(workId), ...(input.personaId ? { personaId: workId(input.personaId) } : {}) };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/focus-items"), jsonRequest("POST", body, input.idempotencyKey), parseFocusEnvelope);
  }
  listFocusItems(workspaceId: string, input: { conversationId?: string; state?: ConversationFocusState; limit?: number } = {}, signal?: AbortSignal): Promise<ConversationFocusItem[]> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 100) }); if (input.conversationId) query.set("conversationId", workId(input.conversationId)); if (input.state) query.set("state", input.state);
    const parse: ResponseParser<ConversationFocusItem[]> = (value) => itemArray(value, "conversation focus items").map(parseFocusItem);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/focus-items?${query}`), { method: "GET", signal }, parse);
  }
  transitionFocusItem(workspaceId: string, itemId: string, input: { state: ConversationFocusState; expectedVersion: number }): Promise<{ item: ConversationFocusItem }> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/focus-items/${workId(itemId)}/transition`), jsonRequest("POST", input, true), parseFocusUpdate);
  }

  createHandoff(workspaceId: string, input: { idempotencyKey: string; taskId: string; sessionId: string; summary: string; unresolvedItems: string[]; unknownOperationRefs: string[]; sourceRefs: string[]; conversationId?: string; conversationKind?: ConversationKind; personaId?: string }): Promise<{ handoff: ConversationHandoff; duplicate: boolean }> {
    const body = {
      ...input,
      taskId: workId(input.taskId),
      sessionId: workId(input.sessionId),
      sourceRefs: input.sourceRefs.map(workId),
      ...(input.conversationId ? { conversationId: workId(input.conversationId), conversationKind: input.conversationKind ?? "direct", ...(input.personaId ? { personaId: workId(input.personaId) } : {}) } : { conversationKind: "direct" as const, personaId: null }),
    };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/handoffs"), jsonRequest("POST", body, input.idempotencyKey), parseHandoffEnvelope);
  }
  getHandoff(workspaceId: string, handoffId: string, signal?: AbortSignal): Promise<ConversationHandoff> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/handoffs/${workId(handoffId)}`), { method: "GET", signal }, parseHandoff);
  }

  getActiveBehaviorPolicy(workspaceId: string, conversationId: string, signal?: AbortSignal): Promise<ActiveBehaviorPolicy> {
    const query = new URLSearchParams({ conversationId: workId(conversationId) });
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/policies/active-behavior?${query}`), { method: "GET", signal }, parsePolicy);
  }
  putActiveBehaviorPolicy(workspaceId: string, input: { conversationId: string; enabled: boolean; quietHours: ActiveBehaviorPolicy["quietHours"]; cooldownSeconds: number; allowGroupInterjections: boolean; followupEnabled: boolean; expectedVersion?: number }): Promise<ActiveBehaviorPolicy> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/policies/active-behavior"), jsonRequest("PUT", input), parsePolicy);
  }

  createReviewEvent(workspaceId: string, input: { idempotencyKey: string; eventType: ConversationReviewEvent["eventType"]; summary: string; sourceRefs: string[]; conversationId?: string; conversationKind?: ConversationKind; personaId?: string; decision?: string }): Promise<{ event: ConversationReviewEvent; duplicate: boolean }> {
    const body = { ...input, sourceRefs: input.sourceRefs.map(workId), ...(input.conversationId ? { conversationId: workId(input.conversationId) } : {}), ...(input.personaId ? { personaId: workId(input.personaId) } : {}) };
    const parser: ResponseParser<{ event: ConversationReviewEvent; duplicate: boolean }> = (value) => { const row = requireRecord(value, "review event receipt"); return { event: parseReviewEvent(row["event"]), duplicate: requireBoolean(row, "duplicate", "review event receipt") }; };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/review-events"), jsonRequest("POST", body, input.idempotencyKey), parser);
  }
  listReviewEvents(workspaceId: string, limit = 100, signal?: AbortSignal): Promise<ConversationReviewEvent[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    const parse: ResponseParser<ConversationReviewEvent[]> = (value) => itemArray(value, "review events").map(parseReviewEvent);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/review-events?${query}`), { method: "GET", signal }, parse);
  }

  previewConversationImport(workspaceId: string, input: { batchId: string; sourceKind: string; records: Record<string, unknown>[] }): Promise<ConversationImportPreview> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/imports/preview"), jsonRequest("POST", input), parseImportPreview);
  }
  applyConversationImport(workspaceId: string, input: { batchId: string; sourceKind: string; records: Record<string, unknown>[] }): Promise<ConversationImportResult> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/imports"), jsonRequest("POST", input, input.batchId), parseImportApply);
  }
  rollbackConversationImport(workspaceId: string, batchId: string): Promise<ConversationImportRollback> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/imports/${workId(batchId)}/rollback`), jsonRequest("POST", {}), parseImportRollback);
  }
}
