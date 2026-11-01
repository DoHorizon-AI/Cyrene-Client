// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Conversation chat browser tests                             │
// │ Role: Exercise the dedicated Web ingress UI with a simulated host.  │
// │ 中文：模块职责：通过模拟主机验证 Web 对话入口界面。                  │
// └─────────────────────────────────────────────────────────────────────┘

import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const conversationId = "web-e2e-acceptance";
const sourceMessages = [
  { id: "message-user-1", eventId: "event-user-1", role: "user", content: "Please keep answers concise.", occurredAt: 1000, status: "active", revokedAt: null, sourceRefs: [], scope: { conversationId, conversationKind: "direct", personaId: null, visibility: "private" } },
  { id: "message-assistant-1", eventId: "event-assistant-1", role: "assistant", content: "I will keep replies concise.", occurredAt: 1100, status: "active", revokedAt: null, sourceRefs: [], scope: { conversationId, conversationKind: "direct", personaId: null, visibility: "private" } },
];

async function mountConversationChat(page: Page) {
  const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  const calls: Array<{ method: string; path: string; body: unknown; idempotencyKey?: string; csrf?: string }> = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const body = request.postDataJSON() as unknown;
    calls.push({ method, path, body, idempotencyKey: request.headers()["idempotency-key"], csrf: request.headers()["x-csrf-token"] });
    const reply = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/v1/auth/session") return reply({ authenticated: true, state: "AUTHENTICATED", sessionId: "paired-session", expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "paired-csrf", refreshed: false });
    if (path === "/api/v1/system/status") return reply({ service: "Navigator", status: "OK", version: "fixture", workspaceId: "local", authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString() });
    if (path === "/api/v1/conversation-assistant/turns" && method === "POST") return reply({ conversationId, taskId: "task-1", sessionId: "session-1", status: "queued", eventsUrl: "/api/v1/tasks/task-1/events?after=0", statusUrl: "/api/v1/tasks/task-1/status" }, 202);
    if (path === "/api/v1/tasks/task-1/events") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "id: 1\nevent: status\ndata: {\"type\":\"status\",\"status\":\"completed\"}\n\n" });
    if (path === "/api/v1/tasks/task-1/status") return reply({ id: "task-1", workspaceId: "local", sessionId: "session-1", prompt: "Test turn", status: "completed", createdAt: 1000, startedAt: 1000, endedAt: 1100, output: "I will keep replies concise.", reasoning: "", error: null, durationMs: 100, sequence: 1, title: "Private conversation", description: null, metadata: {} });
    if (path.endsWith("/work/conversation-memory/messages")) return reply({ items: sourceMessages, nextCursor: null });
    return reply({ code: "NOT_FOUND", error: `No simulated route for ${method} ${path}.` }, 404);
  });
  await page.goto("/?fixture=conversation-chat");
  return { calls };
}

test("SIMULATED conversation page submits one direct/private ingress and reads Work messages", async ({ page }) => {
  const { calls } = await mountConversationChat(page);
  await page.getByLabel("Conversation ID", { exact: true }).fill(conversationId);
  await page.getByLabel("Message", { exact: true }).fill("Please keep answers concise.");
  await page.getByRole("button", { name: "Send private message" }).click();
  await expect(page.getByText("I will keep replies concise.", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".conversation-assistant__list").first()).toContainText("event-user-1");
  await expect(page.locator(".conversation-assistant__list").first()).toContainText("event-assistant-1");

  const submit = calls.find(call => call.method === "POST" && call.path === "/api/v1/conversation-assistant/turns");
  expect(submit?.body).toEqual({ conversationId, text: "Please keep answers concise." });
  expect(submit?.idempotencyKey).toMatch(/^[\x21-\x7e]{1,200}$/);
  expect(submit?.csrf).toBe("paired-csrf");
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/work/conversation-memory/messages"))).toBe(false);
  expect(calls.some(call => call.method === "GET" && call.path === "/api/v1/tasks/task-1/status")).toBe(true);
  expect(calls.some(call => call.method === "GET" && call.path === "/api/v1/tasks/task-1/events")).toBe(true);
});
