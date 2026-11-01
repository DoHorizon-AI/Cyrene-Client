// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-turn API tests                       │
// │ Role: Verify strict ingress, idempotency, Task readback, and SSE.    │
// │ 中文：模块职责：验证严格入口、幂等键、任务回读与 SSE。              │
// └─────────────────────────────────────────────────────────────────────┘

import { describe, expect, it } from "vitest";
import { NavigatorApi, NavigatorContractError, type ConversationTurnAdmission } from "../api";

const taskId = "task-1";
const admission = {
  conversationId: "web-acceptance-1", taskId, sessionId: "session-1", status: "queued",
  eventsUrl: `/api/v1/tasks/${taskId}/events?after=0`, statusUrl: `/api/v1/tasks/${taskId}/status`,
};
const task = {
  id: taskId, workspaceId: "local", sessionId: "session-1", prompt: "Hello", status: "completed", createdAt: 1000,
  startedAt: 1000, endedAt: 1100, output: "Hello back.", reasoning: "", error: null, durationMs: 100,
  sequence: 3, title: "Private conversation", description: null, metadata: {},
};

function response(value: unknown, status = 200, headers: Record<string, string> = { "Content-Type": "application/json" }): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

describe("trusted conversation-turn ingress", () => {
  it("submits only the private conversation text and reads the server Task/SSE receipt", async () => {
    const calls: Array<{ path: string; method: string; headers: Headers; body: unknown }> = [];
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input), method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path, method, headers, body });
      if (path === "/api/v1/auth/session") return response({ authenticated: true, state: "AUTHENTICATED", sessionId: "session-1", expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "csrf-1", refreshed: false });
      if (path === "/api/v1/conversation-assistant/turns") return response(admission, 202);
      if (path === admission.statusUrl) return response(task);
      if (path === `/api/v1/tasks/${taskId}/events?after=0`) return new Response("id: 1\nevent: status\ndata: {\"type\":\"status\",\"status\":\"completed\"}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    await api.getSession();
    const accepted = await api.submitConversationTurn({ conversationId: admission.conversationId, text: "  Hello  ", idempotencyKey: "turn-key-1" });
    const readback = await api.getConversationTurnTask(accepted);
    const controller = new AbortController();
    const stream = await api.openConversationTurnTaskEvents(accepted, 0, controller.signal);
    await stream.body?.cancel();

    expect(readback.status).toBe("completed");
    expect(calls.find((call) => call.path === "/api/v1/conversation-assistant/turns")?.body).toEqual({ conversationId: admission.conversationId, text: "Hello" });
    expect(calls.find((call) => call.path === "/api/v1/conversation-assistant/turns")?.headers.get("Idempotency-Key")).toBe("turn-key-1");
    expect(calls.find((call) => call.path === "/api/v1/conversation-assistant/turns")?.headers.get("X-CSRF-Token")).toBe("csrf-1");
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/auth/session", "/api/v1/conversation-assistant/turns", admission.statusUrl, `/api/v1/tasks/${taskId}/events?after=0`,
    ]);
  });

  it("rejects unsupported conversation ids and server links outside the fixed task routes", async () => {
    const api = new NavigatorApi(async (input) => {
      const path = String(input);
      if (path === "/api/v1/conversation-assistant/turns") return response({ ...admission, statusUrl: "https://example.invalid/task" }, 202);
      return response({ authenticated: false, state: "ANONYMOUS", sessionId: null, expiresAt: null, refreshExpiresAt: null, refreshable: false, csrfToken: null, refreshed: false });
    });

    await expect(api.submitConversationTurn({ conversationId: "invalid id", text: "Hello", idempotencyKey: "turn-key" })).rejects.toBeInstanceOf(NavigatorContractError);
    await expect(api.submitConversationTurn({ conversationId: admission.conversationId, text: "Hello", idempotencyKey: "turn-key" })).rejects.toBeInstanceOf(NavigatorContractError);
    await expect(api.getConversationTurnTask({ ...admission, statusUrl: "https://example.invalid/task" } as ConversationTurnAdmission)).rejects.toBeInstanceOf(NavigatorContractError);
  });

  it("surfaces the dedicated ingress error detail", async () => {
    const api = new NavigatorApi(async () => response({ code: "CONVERSATION_PROFILE_UNAVAILABLE", error: "The local conversation profile is disabled." }, 503));
    await expect(api.submitConversationTurn({ conversationId: admission.conversationId, text: "Hello", idempotencyKey: "turn-key" }))
      .rejects.toMatchObject({ code: "CONVERSATION_PROFILE_UNAVAILABLE", status: 503, detail: "The local conversation profile is disabled." });
  });
});
