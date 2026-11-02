// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-domain API                          │
// │ Role: Call owner-backed persona, profile, and graph Work routes.    │
// │ 中文：模块职责：调用人格、画像和图谱的 Work 所属 API。                 │
// └─────────────────────────────────────────────────────────────────────┘

import type { NavigatorTransport } from "./transport";
import { NavigatorContractError } from "./errors";
import { requireArray, requireBoolean, requireNumber, requireRecord, requireString } from "./parsers/validation";
import { jsonRequest, workId, workPath } from "./requests";
import type { ResponseParser } from "./types";
import type { ConversationKind } from "./conversation-memory";

export type ProfileSubjectKind = "user" | "group";
export type ProfileCategory = "preference" | "style" | "constraint" | "temporary_state";
export type ProfileState = "candidate" | "active" | "rolled_back" | "expired" | "superseded";

export interface ConversationPersona {
  id: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  conversationIds: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** Actor-owned persona binding for one opaque conversation scope. 中文：单个对话范围的主体人格绑定。 */
export interface ConversationPersonaBinding {
  conversationId: string;
  conversationKind: ConversationKind;
  personaId: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** Server-authorized personas available for one scope and its current binding. 中文：服务端授权的人格选项与当前绑定。 */
export interface ConversationPersonaBindingView {
  binding: ConversationPersonaBinding | null;
  availablePersonaIds: string[];
}

/** CAS result for a persona binding update. 中文：人格绑定 CAS 更新回执。 */
export interface ConversationPersonaBindingReceipt {
  binding: ConversationPersonaBinding | null;
  duplicate: boolean;
}

export interface ProfileCandidate {
  id: string;
  idempotencyKey: string;
  conversationId: string;
  conversationKind: ConversationKind | null;
  subjectKind: ProfileSubjectKind;
  personaId: string | null;
  category: ProfileCategory;
  text: string;
  sourceMessageIds: string[];
  confidence: number;
  validUntil: number | null;
  state: ProfileState;
  version: number;
  profileId: string | null;
  evidence: { sourceMessageIds: string[]; confidence: number };
  createdAt: number;
  updatedAt: number;
}

export interface ActiveProfile {
  id: string;
  candidateId: string;
  conversationId: string;
  conversationKind: ConversationKind | null;
  subjectKind: ProfileSubjectKind;
  personaId: string | null;
  category: ProfileCategory;
  text: string;
  sourceMessageIds: string[];
  evidence: { sourceMessageIds: string[]; confidence: number };
  validUntil: number | null;
  state: "active" | "superseded" | "rolled_back" | "expired";
  version: number;
  previousProfileId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GraphNode {
  id: string;
  label: string;
  properties?: Record<string, unknown>;
  sourceMessageIds: string[];
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  properties?: Record<string, unknown>;
  sourceMessageIds: string[];
}

export interface GraphChangeset {
  id: string;
  idempotencyKey: string;
  conversationId: string;
  conversationKind: ConversationKind | null;
  personaId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  digest: string;
  state: "proposed" | "projected";
  version: number;
  providerReceipt: { requestDigest: string; readbackDigest: string; nodeCount: number; edgeCount: number; appliedAt: number } | null;
  providerStatus: "unavailable" | "applied";
  providerApplied: boolean;
  createdAt: number;
  updatedAt: number;
}

function itemArray(value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) return value;
  const root = requireRecord(value, label);
  return requireArray(root["items"], `${label} items`);
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

function nullableChoice<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[], label: string): T | null {
  if (record[key] === null || record[key] === undefined) return null;
  return choice(record, key, values, label);
}

function stringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item) => {
    if (typeof item !== "string") throw new NavigatorContractError(`Navigator returned an invalid ${label}.`);
    return item;
  });
}

function recordArray(value: unknown, label: string): Record<string, unknown>[] {
  return requireArray(value, label).map((item) => requireRecord(item, label));
}

function choice<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[], label: string): T {
  const value = requireString(record, key, label);
  if (!values.includes(value as T)) throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  return value as T;
}

function parsePersona(value: unknown): ConversationPersona {
  const row = requireRecord(value, "conversation persona");
  return {
    id: requireString(row, "id", "conversation persona"), name: requireString(row, "name", "conversation persona"),
    description: requireString(row, "description", "conversation persona"), prompt: requireString(row, "prompt", "conversation persona"),
    enabled: requireBoolean(row, "enabled", "conversation persona"), conversationIds: stringArray(row["conversationIds"], "persona conversation ids"),
    version: requireNumber(row, "version", "conversation persona"), createdAt: requireNumber(row, "createdAt", "conversation persona"), updatedAt: requireNumber(row, "updatedAt", "conversation persona"),
  };
}

function parsePersonaBinding(value: unknown): ConversationPersonaBinding {
  const row = requireRecord(value, "conversation persona binding");
  return {
    conversationId: requireString(row, "conversationId", "conversation persona binding"),
    conversationKind: choice(row, "conversationKind", ["direct", "group", "channel"], "conversation persona binding"),
    personaId: nullableString(row, "personaId", "conversation persona binding"),
    version: requireNumber(row, "version", "conversation persona binding"),
    createdAt: requireNumber(row, "createdAt", "conversation persona binding"),
    updatedAt: requireNumber(row, "updatedAt", "conversation persona binding"),
  };
}

function parseEvidence(value: unknown, label: string): ProfileCandidate["evidence"] {
  const row = requireRecord(value, label);
  return { sourceMessageIds: stringArray(row["sourceMessageIds"], `${label} source ids`), confidence: requireNumber(row, "confidence", label) };
}

function parseCandidate(value: unknown): ProfileCandidate {
  const row = requireRecord(value, "profile candidate");
  return {
    id: requireString(row, "id", "profile candidate"), idempotencyKey: requireString(row, "idempotencyKey", "profile candidate"),
    conversationId: requireString(row, "conversationId", "profile candidate"),
    conversationKind: nullableChoice(row, "conversationKind", ["direct", "group", "channel"], "profile candidate"),
    subjectKind: choice(row, "subjectKind", ["user", "group"], "profile candidate"),
    personaId: nullableString(row, "personaId", "profile candidate"),
    category: choice(row, "category", ["preference", "style", "constraint", "temporary_state"], "profile candidate"),
    text: requireString(row, "text", "profile candidate"), sourceMessageIds: stringArray(row["sourceMessageIds"], "profile candidate source ids"),
    confidence: requireNumber(row, "confidence", "profile candidate"), validUntil: nullableNumber(row, "validUntil", "profile candidate"),
    state: choice(row, "state", ["candidate", "active", "rolled_back", "expired", "superseded"], "profile candidate"),
    version: requireNumber(row, "version", "profile candidate"), profileId: nullableString(row, "profileId", "profile candidate"),
    evidence: parseEvidence(row["evidence"], "profile candidate evidence"), createdAt: requireNumber(row, "createdAt", "profile candidate"), updatedAt: requireNumber(row, "updatedAt", "profile candidate"),
  };
}

function parseProfile(value: unknown): ActiveProfile {
  const row = requireRecord(value, "conversation profile");
  return {
    id: requireString(row, "id", "conversation profile"), candidateId: requireString(row, "candidateId", "conversation profile"),
    conversationId: requireString(row, "conversationId", "conversation profile"),
    conversationKind: nullableChoice(row, "conversationKind", ["direct", "group", "channel"], "conversation profile"),
    subjectKind: choice(row, "subjectKind", ["user", "group"], "conversation profile"),
    personaId: nullableString(row, "personaId", "conversation profile"),
    category: choice(row, "category", ["preference", "style", "constraint", "temporary_state"], "conversation profile"),
    text: requireString(row, "text", "conversation profile"), sourceMessageIds: stringArray(row["sourceMessageIds"], "profile source ids"),
    evidence: parseEvidence(row["evidence"], "conversation profile evidence"), validUntil: nullableNumber(row, "validUntil", "conversation profile"),
    state: choice(row, "state", ["active", "superseded", "rolled_back", "expired"], "conversation profile"),
    version: requireNumber(row, "version", "conversation profile"), previousProfileId: nullableString(row, "previousProfileId", "conversation profile"),
    createdAt: requireNumber(row, "createdAt", "conversation profile"), updatedAt: requireNumber(row, "updatedAt", "conversation profile"),
  };
}

function parseGraphNode(value: unknown): GraphNode {
  const row = requireRecord(value, "graph node");
  const properties = row["properties"] === undefined ? undefined : requireRecord(row["properties"], "graph node properties");
  return { id: requireString(row, "id", "graph node"), label: requireString(row, "label", "graph node"), ...(properties ? { properties } : {}), sourceMessageIds: stringArray(row["sourceMessageIds"], "graph node source ids") };
}

function parseGraphEdge(value: unknown): GraphEdge {
  const row = requireRecord(value, "graph edge");
  const properties = row["properties"] === undefined ? undefined : requireRecord(row["properties"], "graph edge properties");
  return { id: requireString(row, "id", "graph edge"), fromId: requireString(row, "fromId", "graph edge"), toId: requireString(row, "toId", "graph edge"), label: requireString(row, "label", "graph edge"), ...(properties ? { properties } : {}), sourceMessageIds: stringArray(row["sourceMessageIds"], "graph edge source ids") };
}

function parseChangeset(value: unknown): GraphChangeset {
  const row = requireRecord(value, "graph changeset");
  const state = choice(row, "state", ["proposed", "projected"], "graph changeset");
  const digest = requireString(row, "digest", "graph changeset");
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new NavigatorContractError("Navigator returned an invalid graph changeset digest.");
  const providerStatus = choice(row, "providerStatus", ["unavailable", "applied"], "graph changeset");
  const providerApplied = requireBoolean(row, "providerApplied", "graph changeset");
  const receiptValue = row["providerReceipt"];
  const providerReceipt = receiptValue === null || receiptValue === undefined ? null : (() => {
    const receipt = requireRecord(receiptValue, "graph provider receipt");
    return { requestDigest: requireString(receipt, "requestDigest", "graph provider receipt"), readbackDigest: requireString(receipt, "readbackDigest", "graph provider receipt"), nodeCount: requireNumber(receipt, "nodeCount", "graph provider receipt"), edgeCount: requireNumber(receipt, "edgeCount", "graph provider receipt"), appliedAt: requireNumber(receipt, "appliedAt", "graph provider receipt") };
  })();
  if (state === "proposed" && (providerStatus !== "unavailable" || providerApplied || providerReceipt !== null)) throw new NavigatorContractError("Navigator returned an invalid unapplied graph state.");
  if (state === "projected" && (providerStatus !== "applied" || !providerApplied || providerReceipt === null || providerReceipt.requestDigest !== digest || providerReceipt.readbackDigest !== digest)) throw new NavigatorContractError("Navigator returned an invalid graph readback receipt.");
  return {
    id: requireString(row, "id", "graph changeset"), idempotencyKey: requireString(row, "idempotencyKey", "graph changeset"),
    conversationId: requireString(row, "conversationId", "graph changeset"), conversationKind: nullableChoice(row, "conversationKind", ["direct", "group", "channel"], "graph changeset"),
    personaId: nullableString(row, "personaId", "graph changeset"), nodes: recordArray(row["nodes"], "graph nodes").map(parseGraphNode),
    edges: recordArray(row["edges"], "graph edges").map(parseGraphEdge), digest,
    state, version: requireNumber(row, "version", "graph changeset"), providerStatus, providerApplied, providerReceipt,
    createdAt: requireNumber(row, "createdAt", "graph changeset"), updatedAt: requireNumber(row, "updatedAt", "graph changeset"),
  };
}

const parsePersonaEnvelope: ResponseParser<ConversationPersona> = (value) => parsePersona(requireRecord(value, "persona receipt")["persona"]);
const parsePersonaBindingView: ResponseParser<ConversationPersonaBindingView> = (value) => {
  const row = requireRecord(value, "persona binding view");
  return {
    binding: row["binding"] === null ? null : parsePersonaBinding(row["binding"]),
    availablePersonaIds: stringArray(row["availablePersonaIds"], "available persona ids"),
  };
};
const parsePersonaBindingReceipt: ResponseParser<ConversationPersonaBindingReceipt> = (value) => {
  const row = requireRecord(value, "persona binding receipt");
  return {
    binding: row["binding"] === null ? null : parsePersonaBinding(row["binding"]),
    duplicate: requireBoolean(row, "duplicate", "persona binding receipt"),
  };
};
const parseCandidateEnvelope: ResponseParser<ProfileCandidate> = (value) => parseCandidate(requireRecord(value, "profile candidate receipt")["candidate"]);
const parseProfileEnvelope: ResponseParser<ActiveProfile> = (value) => parseProfile(requireRecord(value, "profile receipt")["profile"]);
const parseChangesetEnvelope: ResponseParser<GraphChangeset> = (value) => parseChangeset(requireRecord(value, "graph changeset receipt")["changeset"]);

/**
 * Owner-scoped Client adapter for persona, profile, and graph projections.
 * 中文：为人格、画像和图谱所属数据提供同源 Client 适配器。
 */
export class ConversationDomainsApi {
  constructor(private readonly transport: NavigatorTransport) {}

  getPersonas(workspaceId: string, conversationId?: string, signal?: AbortSignal): Promise<ConversationPersona[]> {
    const query = conversationId ? `?${new URLSearchParams({ conversationId: workId(conversationId) })}` : "";
    const parse: ResponseParser<ConversationPersona[]> = (value) => itemArray(value, "conversation personas").map(parsePersona);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/personas${query}`), { method: "GET", signal }, parse);
  }

  /** Read the binding and server-filtered options for one conversation. 中文：读取对话当前绑定及服务端过滤后的可选人格。 */
  getPersonaBinding(workspaceId: string, input: { conversationId: string; conversationKind: ConversationKind }, signal?: AbortSignal): Promise<ConversationPersonaBindingView> {
    const query = new URLSearchParams({ conversationId: workId(input.conversationId), conversationKind: input.conversationKind });
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/personas/binding?" + query), { method: "GET", signal }, parsePersonaBindingView);
  }

  /** Save a persona binding with the caller's last observed version. 中文：按最近读取到的版本 CAS 保存人格绑定。 */
  putPersonaBinding(workspaceId: string, input: { conversationId: string; conversationKind: ConversationKind; personaId: string | null; expectedVersion: number }): Promise<ConversationPersonaBindingReceipt> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new NavigatorContractError("Invalid conversation persona binding version.");
    const body = {
      conversationId: workId(input.conversationId),
      conversationKind: input.conversationKind,
      personaId: input.personaId === null ? null : workId(input.personaId),
      expectedVersion: input.expectedVersion,
    };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/personas/binding"), jsonRequest("PUT", body, true), parsePersonaBindingReceipt);
  }

  putPersona(workspaceId: string, input: { id: string; name: string; description?: string; prompt: string; enabled: boolean; conversationIds?: string[] }): Promise<ConversationPersona> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/personas"), jsonRequest("PUT", input, true), parsePersonaEnvelope);
  }

  createProfileCandidate(workspaceId: string, input: {
    idempotencyKey: string; conversationId: string; conversationKind: ConversationKind; subjectKind: ProfileSubjectKind; personaId?: string;
    category: ProfileCategory; text: string; sourceMessageIds: string[]; confidence: number; validUntil?: number;
  }): Promise<ProfileCandidate> {
    const body = { ...input, conversationId: workId(input.conversationId), sourceMessageIds: input.sourceMessageIds.map(workId), ...(input.personaId ? { personaId: workId(input.personaId) } : {}) };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/profile-candidates"), jsonRequest("POST", body, input.idempotencyKey), parseCandidateEnvelope);
  }

  listProfileCandidates(workspaceId: string, input: { state?: ProfileState; limit?: number } = {}, signal?: AbortSignal): Promise<ProfileCandidate[]> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 100) });
    if (input.state) query.set("state", input.state);
    const parse: ResponseParser<ProfileCandidate[]> = (value) => itemArray(value, "profile candidates").map(parseCandidate);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/profile-candidates?${query}`), { method: "GET", signal }, parse);
  }

  listConversationProfiles(workspaceId: string, input: { conversationId?: string; state?: ActiveProfile["state"]; limit?: number } = {}, signal?: AbortSignal): Promise<ActiveProfile[]> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 100) });
    if (input.conversationId) query.set("conversationId", workId(input.conversationId));
    if (input.state) query.set("state", input.state);
    const parse: ResponseParser<ActiveProfile[]> = (value) => itemArray(value, "conversation profiles").map(parseProfile);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/profiles?${query}`), { method: "GET", signal }, parse);
  }

  activateProfileCandidate(workspaceId: string, candidateId: string, expectedVersion: number): Promise<ActiveProfile> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/profile-candidates/${workId(candidateId)}/activate`), jsonRequest("POST", { expectedVersion }, true), parseProfileEnvelope);
  }

  rollbackProfile(workspaceId: string, profileId: string, expectedVersion: number): Promise<ActiveProfile> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/profiles/${workId(profileId)}/rollback`), jsonRequest("POST", { expectedVersion }, true), parseProfileEnvelope);
  }

  createGraphProposal(workspaceId: string, input: { idempotencyKey: string; conversationId: string; conversationKind: ConversationKind; personaId?: string; nodes: GraphNode[]; edges: GraphEdge[] }): Promise<GraphChangeset> {
    const body = { ...input, conversationId: workId(input.conversationId) };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/graph/proposals"), jsonRequest("POST", body, input.idempotencyKey), parseChangesetEnvelope);
  }

  listGraphChangesets(workspaceId: string, state?: "proposed" | "projected", signal?: AbortSignal): Promise<GraphChangeset[]> {
    const query = state ? `?${new URLSearchParams({ state, limit: "100" })}` : "?limit=100";
    const parse: ResponseParser<GraphChangeset[]> = (value) => itemArray(value, "graph changesets").map(parseChangeset);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/graph/changesets${query}`), { method: "GET", signal }, parse);
  }

  applyGraphChangeset(workspaceId: string, changesetId: string, expectedVersion: number): Promise<GraphChangeset> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/graph/changesets/${workId(changesetId)}/apply`), jsonRequest("POST", { expectedVersion }, true), parseChangesetEnvelope);
  }

  queryGraph(workspaceId: string, input: { conversationId: string; conversationKind: ConversationKind; query: string; limit?: number }): Promise<Record<string, unknown>> {
    const body = { ...input, conversationId: workId(input.conversationId), limit: input.limit ?? 20 };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/graph/query"), jsonRequest("POST", body), (value) => requireRecord(value, "graph query"));
  }
}
