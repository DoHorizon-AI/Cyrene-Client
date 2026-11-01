// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-memory API                          │
// │ Role: Validate and call the same-origin conversation Work API.      │
// │ 中文：模块职责：校验并调用同源对话记忆 Work API。                      │
// └─────────────────────────────────────────────────────────────────────┘

import type { NavigatorTransport } from "./transport";
import { NavigatorContractError } from "./errors";
import { requireArray, requireBoolean, requireNumber, requireRecord, requireString } from "./parsers/validation";
import { jsonRequest, makeIdempotencyKey, toHttpError, workId, workPath } from "./requests";
import type { ResponseParser } from "./types";

export type ConversationVisibility = "private" | "conversation" | "workspace";
export type ConversationRole = "user" | "assistant" | "tool";
export type ConversationKind = "direct" | "group" | "channel";
export type ConversationMemoryKind = "fact" | "preference" | "commitment" | "episode";

export interface ConversationScope {
  conversationId: string;
  conversationKind: ConversationKind;
  personaId: string | null;
  visibility: ConversationVisibility;
}

export interface ConversationSourceReference {
  memoryId: string | null;
  memoryVersion: number | null;
  sourceMessageIds: string[];
}

export interface ConversationMemoryOverview {
  authorizationEpoch: number;
  counts: { messages: number; memories: number; sources: number };
  capabilities: { memoryProvider: "ready" | "unavailable"; summarizer: "ready" | "unavailable" };
}

export interface ConversationMessage {
  id: string;
  eventId: string;
  role: ConversationRole;
  content: string;
  occurredAt: number;
  status: "active" | "revoked";
  revokedAt: number | null;
  sourceRefs: ConversationSourceReference[];
  scope: ConversationScope;
}

export interface ConversationMessagesPage {
  items: ConversationMessage[];
  nextCursor: string | null;
}

export interface ConversationMemory {
  id: string;
  version: number;
  kind: ConversationMemoryKind;
  text: string;
  scope: ConversationScope;
  state: string;
  indexState: "pending" | "indexed" | "unavailable" | "failed";
  sourceMessageIds: string[];
  sourceRefs: ConversationSourceReference[];
  authorizationEpoch: number;
  createdAt: number;
  updatedAt: number;
  validUntil: number | null;
}

export interface ConversationMemoryMatch {
  memoryId: string;
  version: number;
  kind: ConversationMemoryKind;
  text: string;
  sourceMessageIds: string[];
  sourceRefs: ConversationSourceReference[];
  scope: ConversationScope;
  score: number;
  stale: boolean;
}

export interface ConversationMemorySource {
  id: string;
  eventId: string;
  kind: "conversation_message";
  role: ConversationRole;
  status: "active" | "revoked";
  revokedAt: number | null;
  authorizationEpoch: number;
  createdAt: number;
  scope: ConversationScope;
  canManageGrants: boolean;
  grants: ConversationMemoryGrant[];
}

export interface ConversationMemoryGrant {
  id: string;
  visibility: "conversation" | "workspace";
  targetConversationId: string | null;
  expiresAt: number | null;
  createdAt: number;
  status: "active" | "revoked";
}

export interface ConversationMemoryWriteReceipt {
  memory: ConversationMemory;
  duplicate: boolean;
}

export interface ConversationSourceRevokeReceipt {
  sourceId: string;
  authorizationEpoch: number;
  invalidatedCount: number;
}

export interface ConversationSourceGrantReceipt {
  grant: ConversationMemoryGrant;
  authorizationEpoch: number;
  duplicate: boolean;
}

export interface ConversationSourceGrantRevokeReceipt {
  revoked: true;
  authorizationEpoch: number;
}

export interface ConversationMemoryList {
  items: ConversationMemory[];
  authorizationEpoch: number;
}

export interface ConversationMemoryQueryResult {
  items: ConversationMemoryMatch[];
  authorizationEpoch: number;
}

const VISIBILITIES = new Set<ConversationVisibility>(["private", "conversation", "workspace"]);
const ROLES = new Set<ConversationRole>(["user", "assistant", "tool"]);
const MEMORY_KINDS = new Set<ConversationMemoryKind>(["fact", "preference", "commitment", "episode"]);
const CONVERSATION_KINDS = new Set<ConversationKind>(["direct", "group", "channel"]);

function parseScope(value: unknown, label: string): ConversationScope {
  const row = requireRecord(value, `${label} scope`);
  const conversationKind = requireString(row, "conversationKind", `${label} scope`);
  if (!CONVERSATION_KINDS.has(conversationKind as ConversationKind)) throw new NavigatorContractError(`Navigator returned an invalid conversationKind in ${label} scope.`);
  return {
    conversationId: requireString(row, "conversationId", `${label} scope`),
    conversationKind: conversationKind as ConversationKind,
    personaId: nullableString(row, "personaId", `${label} scope`),
    visibility: requiredVisibility(row, "visibility", `${label} scope`),
  };
}

function requiredVisibility(record: Record<string, unknown>, key: string, label: string): ConversationVisibility {
  const value = requireString(record, key, label);
  if (!VISIBILITIES.has(value as ConversationVisibility)) throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  return value as ConversationVisibility;
}

function requiredRole(record: Record<string, unknown>, label: string): ConversationRole {
  const value = requireString(record, "role", label);
  if (!ROLES.has(value as ConversationRole)) throw new NavigatorContractError(`Navigator returned an invalid role in ${label}.`);
  return value as ConversationRole;
}

function requiredMemoryKind(record: Record<string, unknown>, label: string): ConversationMemoryKind {
  const value = requireString(record, "kind", label);
  if (!MEMORY_KINDS.has(value as ConversationMemoryKind)) throw new NavigatorContractError(`Navigator returned an invalid kind in ${label}.`);
  return value as ConversationMemoryKind;
}

function nullableString(record: Record<string, unknown>, key: string, label: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  return value;
}

function nullableNumber(record: Record<string, unknown>, key: string, label: string): number | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item) => {
    if (typeof item !== "string") throw new NavigatorContractError(`Navigator returned an invalid ${label}.`);
    return item;
  });
}

function parseSourceRefs(value: unknown, label: string): ConversationSourceReference[] {
  return requireArray(value, label).map((item) => {
    const reference = requireRecord(item, label);
    const memoryId = nullableString(reference, "memoryId", label);
    const memoryVersion = nullableNumber(reference, "memoryVersion", label);
    if ((memoryId === null) !== (memoryVersion === null)) throw new NavigatorContractError(`Navigator returned an invalid memory revision in ${label}.`);
    const sourceMessageIds = stringArray(reference["sourceMessageIds"], `${label} source ids`);
    if (memoryId === null && sourceMessageIds.length === 0) throw new NavigatorContractError(`Navigator returned an empty source reference in ${label}.`);
    return { memoryId, memoryVersion, sourceMessageIds };
  });
}

function parseGrant(value: unknown): ConversationMemoryGrant {
  const row = requireRecord(value, "conversation memory grant");
  const visibility = requireString(row, "visibility", "conversation memory grant");
  const status = requireString(row, "status", "conversation memory grant");
  if (visibility !== "conversation" && visibility !== "workspace") throw new NavigatorContractError("Navigator returned an invalid grant visibility.");
  if (status !== "active" && status !== "revoked") throw new NavigatorContractError("Navigator returned an invalid grant status.");
  return {
    id: requireString(row, "id", "conversation memory grant"),
    visibility,
    targetConversationId: nullableString(row, "targetConversationId", "conversation memory grant"),
    expiresAt: nullableNumber(row, "expiresAt", "conversation memory grant"),
    createdAt: requireNumber(row, "createdAt", "conversation memory grant"),
    status,
  };
}

function parseOverview(value: unknown): ConversationMemoryOverview {
  const root = requireRecord(value, "conversation memory overview");
  const counts = requireRecord(root["counts"], "conversation memory counts");
  const capabilities = requireRecord(root["capabilities"], "conversation memory capabilities");
  const memoryProvider = requireString(capabilities, "memoryProvider", "conversation memory capabilities");
  const summarizer = requireString(capabilities, "summarizer", "conversation memory capabilities");
  if (memoryProvider !== "ready" && memoryProvider !== "unavailable") throw new NavigatorContractError("Navigator returned an invalid memoryProvider capability.");
  if (summarizer !== "ready" && summarizer !== "unavailable") throw new NavigatorContractError("Navigator returned an invalid summarizer capability.");
  return {
    authorizationEpoch: requireNumber(root, "authorizationEpoch", "conversation memory overview"),
    counts: {
      messages: requireNumber(counts, "messages", "conversation memory counts"),
      memories: requireNumber(counts, "memories", "conversation memory counts"),
      sources: requireNumber(counts, "sources", "conversation memory counts"),
    },
    capabilities: { memoryProvider, summarizer },
  };
}

function parseMessage(value: unknown): ConversationMessage {
  const row = requireRecord(value, "conversation message");
  const status = requireString(row, "status", "conversation message");
  if (status !== "active" && status !== "revoked") throw new NavigatorContractError("Navigator returned an invalid conversation message status.");
  return {
    id: requireString(row, "id", "conversation message"),
    eventId: requireString(row, "eventId", "conversation message"),
    role: requiredRole(row, "conversation message"),
    content: requireString(row, "content", "conversation message"),
    occurredAt: requireNumber(row, "occurredAt", "conversation message"),
    status,
    revokedAt: nullableNumber(row, "revokedAt", "conversation message"),
    sourceRefs: parseSourceRefs(row["sourceRefs"], "conversation message source references"),
    scope: parseScope(row["scope"], "conversation message"),
  };
}

function parseMessages(value: unknown): ConversationMessagesPage {
  const root = requireRecord(value, "conversation message page");
  return {
    items: requireArray(root["items"], "conversation messages").map(parseMessage),
    nextCursor: nullableString(root, "nextCursor", "conversation message page"),
  };
}

function parseMemory(value: unknown): ConversationMemory {
  const row = requireRecord(value, "conversation memory");
  const indexState = requireString(row, "indexState", "conversation memory");
  if (indexState !== "pending" && indexState !== "indexed" && indexState !== "unavailable" && indexState !== "failed") throw new NavigatorContractError("Navigator returned an invalid conversation memory index state.");
  return {
    id: requireString(row, "id", "conversation memory"),
    version: requireNumber(row, "version", "conversation memory"),
    kind: requiredMemoryKind(row, "conversation memory"),
    text: requireString(row, "text", "conversation memory"),
    scope: parseScope(row["scope"], "conversation memory"),
    state: requireString(row, "state", "conversation memory"),
    indexState,
    sourceMessageIds: stringArray(row["sourceMessageIds"], "conversation memory source ids"),
    sourceRefs: parseSourceRefs(row["sourceRefs"], "conversation memory source references"),
    authorizationEpoch: requireNumber(row, "authorizationEpoch", "conversation memory"),
    createdAt: requireNumber(row, "createdAt", "conversation memory"),
    updatedAt: requireNumber(row, "updatedAt", "conversation memory"),
    validUntil: nullableNumber(row, "validUntil", "conversation memory"),
  };
}

function parseMemories(value: unknown): ConversationMemoryList {
  const root = requireRecord(value, "conversation memories");
  return {
    items: requireArray(root["items"], "conversation memories").map(parseMemory),
    authorizationEpoch: requireNumber(root, "authorizationEpoch", "conversation memories"),
  };
}

function parseMemoryMatches(value: unknown): ConversationMemoryQueryResult {
  const root = requireRecord(value, "conversation memory matches");
  return {
    items: requireArray(root["items"], "conversation memory matches").map((item) => {
      const row = requireRecord(item, "conversation memory match");
      return {
        memoryId: requireString(row, "memoryId", "conversation memory match"),
        version: requireNumber(row, "version", "conversation memory match"),
        kind: requiredMemoryKind(row, "conversation memory match"),
        text: requireString(row, "text", "conversation memory match"),
        sourceMessageIds: stringArray(row["sourceMessageIds"], "conversation memory match source ids"),
        sourceRefs: parseSourceRefs(row["sourceRefs"], "conversation memory match source references"),
        scope: parseScope(row["scope"], "conversation memory match"),
        score: requireNumber(row, "score", "conversation memory match"),
        stale: requireBoolean(row, "stale", "conversation memory match"),
      };
    }),
    authorizationEpoch: requireNumber(root, "authorizationEpoch", "conversation memory matches"),
  };
}

function parseSources(value: unknown): { items: ConversationMemorySource[] } {
  const root = requireRecord(value, "conversation memory sources");
  return {
    items: requireArray(root["items"], "conversation memory sources").map((item) => {
      const row = requireRecord(item, "conversation memory source");
      const kind = requireString(row, "kind", "conversation memory source");
      const status = requireString(row, "status", "conversation memory source");
      if (kind !== "conversation_message") throw new NavigatorContractError("Navigator returned an invalid conversation memory source kind.");
      if (status !== "active" && status !== "revoked") throw new NavigatorContractError("Navigator returned an invalid conversation memory source status.");
      const revokedAt = row["revokedAt"];
      if (revokedAt !== null && (typeof revokedAt !== "number" || !Number.isFinite(revokedAt))) throw new NavigatorContractError("Navigator returned an invalid revokedAt in conversation memory source.");
      return {
        id: requireString(row, "id", "conversation memory source"),
        eventId: requireString(row, "eventId", "conversation memory source"),
        kind,
        role: requiredRole(row, "conversation memory source"),
        status,
        revokedAt,
        authorizationEpoch: requireNumber(row, "authorizationEpoch", "conversation memory source"),
        createdAt: requireNumber(row, "createdAt", "conversation memory source"),
        scope: parseScope(row["scope"], "conversation memory source"),
        canManageGrants: requireBoolean(row, "canManageGrants", "conversation memory source"),
        grants: requireArray(row["grants"], "conversation memory source grants").map(parseGrant),
      };
    }),
  };
}

function parseWriteReceipt(value: unknown): ConversationMemoryWriteReceipt {
  const root = requireRecord(value, "conversation memory write receipt");
  return { memory: parseMemory(root["memory"]), duplicate: requireBoolean(root, "duplicate", "conversation memory write receipt") };
}

const parseMemoryPatchReceipt: ResponseParser<{ memory: ConversationMemory }> = (value) => {
  const root = requireRecord(value, "conversation memory update receipt");
  return { memory: parseMemory(root["memory"]) };
};

const parseDeletedMemory: ResponseParser<{ deleted: true; authorizationEpoch: number }> = (value) => {
  const root = requireRecord(value, "conversation memory deletion receipt");
  if (root["deleted"] !== true) throw new NavigatorContractError("Navigator returned an invalid conversation memory deletion receipt.");
  return { deleted: true, authorizationEpoch: requireNumber(root, "authorizationEpoch", "conversation memory deletion receipt") };
};

const parseSourceRevoke: ResponseParser<ConversationSourceRevokeReceipt> = (value) => {
  const root = requireRecord(value, "conversation source revocation receipt");
  return {
    sourceId: requireString(root, "sourceId", "conversation source revocation receipt"),
    authorizationEpoch: requireNumber(root, "authorizationEpoch", "conversation source revocation receipt"),
    invalidatedCount: requireNumber(root, "invalidatedCount", "conversation source revocation receipt"),
  };
};

const parseSourceGrant: ResponseParser<ConversationSourceGrantReceipt> = (value) => {
  const root = requireRecord(value, "conversation source grant receipt");
  return {
    grant: parseGrant(root["grant"]),
    authorizationEpoch: requireNumber(root, "authorizationEpoch", "conversation source grant receipt"),
    duplicate: requireBoolean(root, "duplicate", "conversation source grant receipt"),
  };
};

const parseSourceGrantRevoke: ResponseParser<ConversationSourceGrantRevokeReceipt> = (value) => {
  const root = requireRecord(value, "conversation source grant revocation receipt");
  if (root["revoked"] !== true) throw new NavigatorContractError("Navigator returned an invalid conversation source grant revocation receipt.");
  return { revoked: true, authorizationEpoch: requireNumber(root, "authorizationEpoch", "conversation source grant revocation receipt") };
};

/**
 * Own the browser adapter for the Navigator conversation-memory Work API.
 * 中文：封装 Navigator 对话记忆 Work API 的浏览器适配器。
 */
export class ConversationMemoryApi {
  constructor(private readonly transport: NavigatorTransport) {}

  /** Read counts and provider readiness without caching Product state in Client. */
  getOverview(workspaceId: string, signal?: AbortSignal): Promise<ConversationMemoryOverview> {
    const parser: ResponseParser<ConversationMemoryOverview> = parseOverview;
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/overview"), { method: "GET", signal }, parser);
  }

  /** Read one bounded page of owner-backed conversation messages. */
  getMessages(workspaceId: string, input: { conversationId: string; conversationKind: ConversationKind; limit?: number; cursor?: string }, signal?: AbortSignal): Promise<ConversationMessagesPage> {
    const query = new URLSearchParams({ conversationId: workId(input.conversationId), conversationKind: input.conversationKind, limit: String(input.limit ?? 100) });
    if (input.cursor) query.set("cursor", input.cursor);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/messages?${query}`), { method: "GET", signal }, parseMessages);
  }

  /** Read owner-backed memory rows for the selected conversation scope. */
  listMemories(workspaceId: string, input: { conversationId: string; conversationKind: ConversationKind; personaId?: string; state?: string; limit?: number }, signal?: AbortSignal): Promise<ConversationMemoryList> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 100) });
    query.set("conversationId", workId(input.conversationId));
    query.set("conversationKind", input.conversationKind);
    if (input.personaId) query.set("personaId", workId(input.personaId));
    if (input.state) query.set("state", input.state);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/memories?${query}`), { method: "GET", signal }, parseMemories);
  }

  /** Search via the configured memory provider; unavailable providers stay errors. */
  queryMemories(workspaceId: string, input: { conversationId: string; conversationKind: ConversationKind; personaId?: string; query: string; limit?: number }, signal?: AbortSignal): Promise<ConversationMemoryQueryResult> {
    const body = { ...input, conversationId: workId(input.conversationId), ...(input.personaId ? { personaId: workId(input.personaId) } : {}), limit: input.limit ?? 50 };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/memories/query"), jsonRequest("POST", body, true), parseMemoryMatches);
  }

  /** Save a candidate memory with explicit source-message evidence. */
  createMemory(workspaceId: string, input: {
    idempotencyKey: string; conversationId: string; conversationKind: ConversationKind; personaId?: string; kind: ConversationMemoryKind;
    text: string; sourceMessageIds: string[]; visibility: ConversationVisibility; validUntil?: number;
  }): Promise<ConversationMemoryWriteReceipt> {
    const body = { ...input, conversationId: workId(input.conversationId), sourceMessageIds: input.sourceMessageIds.map(workId), ...(input.personaId ? { personaId: workId(input.personaId) } : {}) };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/memories"), jsonRequest("POST", body, input.idempotencyKey), parseWriteReceipt);
  }

  /** Correct the text or expiry of one selected memory. */
  updateMemory(workspaceId: string, memoryId: string, input: { expectedVersion: number; text?: string; validUntil?: number }): Promise<{ memory: ConversationMemory }> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/memories/${workId(memoryId)}`), jsonRequest("PATCH", input), parseMemoryPatchReceipt);
  }

  /** Remove a memory through its owning Work service. */
  deleteMemory(workspaceId: string, memoryId: string, expectedVersion: number): Promise<{ deleted: true; authorizationEpoch: number }> {
    const query = new URLSearchParams({ expectedVersion: String(expectedVersion) });
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/memories/${workId(memoryId)}?${query}`), { method: "DELETE" }, parseDeletedMemory);
  }

  /** Read source authorization rows scoped to the requested conversation. */
  listSources(workspaceId: string, conversationId: string, signal?: AbortSignal): Promise<{ items: ConversationMemorySource[] }> {
    const query = `?${new URLSearchParams({ conversationId: workId(conversationId) })}`;
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/sources${query}`), { method: "GET", signal }, parseSources);
  }

  /** Grant one source to an exact conversation or the same workspace. */
  createSourceGrant(workspaceId: string, sourceId: string, input: { visibility: "conversation" | "workspace"; targetConversationId?: string; expiresAt?: number }): Promise<ConversationSourceGrantReceipt> {
    if (input.visibility === "conversation" && !input.targetConversationId?.trim()) throw new NavigatorContractError("A conversation grant requires its exact target conversation.");
    const body = {
      visibility: input.visibility,
      ...(input.visibility === "conversation" && input.targetConversationId ? { targetConversationId: workId(input.targetConversationId) } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    };
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/sources/${workId(sourceId)}/grants`), jsonRequest("POST", body, true), parseSourceGrant);
  }

  /** Revoke one explicit sharing grant; repeated deletion remains safe. */
  revokeSourceGrant(workspaceId: string, sourceId: string, grantId: string): Promise<ConversationSourceGrantRevokeReceipt> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/sources/${workId(sourceId)}/grants/${workId(grantId)}`), { method: "DELETE" }, parseSourceGrantRevoke);
  }

  /** Revoke one source authorization and invalidate its derived contributions. */
  revokeSource(workspaceId: string, sourceId: string): Promise<ConversationSourceRevokeReceipt> {
    const parser: ResponseParser<ConversationSourceRevokeReceipt> = parseSourceRevoke;
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/sources/${workId(sourceId)}/revoke`), jsonRequest("POST", {}), parser);
  }
}

export function newConversationMemoryKey(): string {
  return makeIdempotencyKey();
}
