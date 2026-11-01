// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-memory API tests                    │
// │ Role: Verify same-origin paths, strict DTO parsing, and mutations.   │
// │ 中文：模块职责：验证同源路径、严格 DTO 解析和记忆操作。               │
// └─────────────────────────────────────────────────────────────────────┘

import { describe, expect, it } from "vitest";
import { NavigatorApi, NavigatorContractError } from "../api";

const scope = { conversationId: "chat-1", conversationKind: "direct", personaId: null, visibility: "private" };
const memory = {
  id: "memory-1", version: 1, kind: "preference", text: "Prefers concise answers.", scope, state: "active", indexState: "indexed",
  sourceMessageIds: ["message-1"], sourceRefs: [], authorizationEpoch: 4, createdAt: 1000, updatedAt: 1000, validUntil: null,
};
const message = {
  id: "message-1", eventId: "event-1", role: "user", content: "Please keep answers concise.", occurredAt: 900,
  status: "active", revokedAt: null, sourceRefs: [], scope,
};
const source = {
  id: "message-1", eventId: "event-1", kind: "conversation_message", role: "user", status: "active", revokedAt: null,
  authorizationEpoch: 4, createdAt: 900, scope, canManageGrants: true, grants: [],
};
const grant = { id: "grant-1", visibility: "conversation", targetConversationId: "chat-2", expiresAt: null, createdAt: 1100, status: "active" };

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("conversation memory Work API", () => {
  it("reads only the selected workspace and validates scoped owner responses", async () => {
    const calls: string[] = [];
    const api = new NavigatorApi(async (input) => {
      const path = String(input);
      calls.push(path);
      if (path.endsWith("/conversation-memory/overview")) return response({ authorizationEpoch: 4, counts: { messages: 1, memories: 1, sources: 1 }, capabilities: { memoryProvider: "ready", summarizer: "unavailable" } });
      if (path.includes("/conversation-memory/messages?")) return response({ items: [message], nextCursor: null });
      if (path.includes("/conversation-memory/memories?")) return response({ items: [memory], authorizationEpoch: 4 });
      if (path.includes("/conversation-memory/sources?")) return response({ items: [source] });
      throw new Error(`Unexpected request: ${path}`);
    });

    const overview = await api.getConversationMemoryOverview("workspace-1");
    const messages = await api.getConversationMessages("workspace-1", { conversationId: "chat-1", conversationKind: "direct", limit: 20 });
    const memories = await api.listConversationMemories("workspace-1", { conversationId: "chat-1", conversationKind: "direct", personaId: "persona-1" });
    const sources = await api.listConversationMemorySources("workspace-1", "chat-1");

    expect(overview.capabilities.memoryProvider).toBe("ready");
    expect(messages.items[0]?.scope.conversationId).toBe("chat-1");
    expect(memories.items[0]?.version).toBe(1);
    expect(sources.items[0]?.status).toBe("active");
    expect(calls).toEqual([
      "/api/v1/workspaces/workspace-1/work/conversation-memory/overview",
      "/api/v1/workspaces/workspace-1/work/conversation-memory/messages?conversationId=chat-1&conversationKind=direct&limit=20",
      "/api/v1/workspaces/workspace-1/work/conversation-memory/memories?limit=100&conversationId=chat-1&conversationKind=direct&personaId=persona-1",
      "/api/v1/workspaces/workspace-1/work/conversation-memory/sources?conversationId=chat-1",
    ]);
  });

  it("sends corrections, deletion, and source revocation through the paired session", async () => {
    const calls: Array<{ path: string; method: string; headers: Headers; body: unknown }> = [];
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input), method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path, method, headers, body });
      if (path === "/api/v1/auth/session") return response({ authenticated: true, state: "AUTHENTICATED", sessionId: "session-1", expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "csrf-1", refreshed: false });
      if (path.endsWith("/conversation-memory/memories") && method === "POST") return response({ memory, duplicate: false });
      if (path.endsWith("/conversation-memory/memories/memory-1") && method === "PATCH") return response({ memory: { ...memory, version: 2, text: "Prefers short answers.", updatedAt: 2000 } });
      if (path.endsWith("/conversation-memory/memories/memory-1") && method === "DELETE") return response({ deleted: true, authorizationEpoch: 5 });
      if (path.endsWith("/conversation-memory/sources/message-1/revoke")) return response({ sourceId: "message-1", authorizationEpoch: 6, invalidatedCount: 1 });
      if (path.endsWith("/conversation-memory/sources/message-1/grants") && method === "POST") return response({ grant, authorizationEpoch: 5, duplicate: false });
      if (path.endsWith("/conversation-memory/sources/message-1/grants/grant-1") && method === "DELETE") return response({ revoked: true, authorizationEpoch: 6 });
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    await api.getSession();
    const created = await api.createConversationMemory("workspace-1", {
      idempotencyKey: "memory-request-1", conversationId: "chat-1", conversationKind: "direct", kind: "preference", text: memory.text,
      sourceMessageIds: ["message-1"], visibility: "private",
    });
    const updated = await api.updateConversationMemory("workspace-1", "memory-1", { text: "Prefers short answers.", validUntil: 3000 });
    const deleted = await api.deleteConversationMemory("workspace-1", "memory-1");
    const revoked = await api.revokeConversationMemorySource("workspace-1", "message-1");
    const createdGrant = await api.createConversationMemorySourceGrant("workspace-1", "message-1", { visibility: "conversation", targetConversationId: "chat-2" });
    const revokedGrant = await api.revokeConversationMemorySourceGrant("workspace-1", "message-1", "grant-1");

    expect(created.duplicate).toBe(false);
    expect(updated.memory.version).toBe(2);
    expect(deleted.authorizationEpoch).toBe(5);
    expect(revoked.invalidatedCount).toBe(1);
    expect(createdGrant.grant.targetConversationId).toBe("chat-2");
    expect(revokedGrant.revoked).toBe(true);
    const writes = calls.filter((call) => call.method !== "GET");
    expect(writes.every((call) => call.headers.get("Authorization") === null)).toBe(true);
    expect(writes.every((call) => call.headers.get("X-CSRF-Token") === "csrf-1")).toBe(true);
    expect(writes[0]?.headers.get("Idempotency-Key")).toBe("memory-request-1");
    expect(writes[0]?.body).toMatchObject({ conversationId: "chat-1", sourceMessageIds: ["message-1"] });
    expect(writes[1]?.body).toEqual({ text: "Prefers short answers.", validUntil: 3000 });
    expect(writes.find((call) => call.method === "POST" && call.path.endsWith("/grants"))?.body).toEqual({ visibility: "conversation", targetConversationId: "chat-2" });
  });

  it("surfaces provider unavailability and rejects malformed owner DTOs", async () => {
    const unavailableApi = new NavigatorApi(async () => response({ code: "MEMORY_PROVIDER_UNAVAILABLE", detail: "No provider is configured." }, 503));
    await expect(unavailableApi.queryConversationMemories("workspace-1", { conversationId: "chat-1", conversationKind: "direct", query: "concise" }))
      .rejects.toMatchObject({ code: "MEMORY_PROVIDER_UNAVAILABLE", status: 503 });

    const malformedApi = new NavigatorApi(async () => response({ items: [{ ...message, scope: { ...scope, visibility: "public" } }], nextCursor: null }));
    await expect(malformedApi.getConversationMessages("workspace-1", { conversationId: "chat-1", conversationKind: "direct" })).rejects.toBeInstanceOf(NavigatorContractError);
  });
});
