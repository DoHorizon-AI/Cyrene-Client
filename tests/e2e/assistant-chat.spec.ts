import { expect, test, type Page } from "@playwright/test";
import type { NavigatorTaskRecord } from "../../apps/web/services/navigator/src/api";

interface FixtureOptions {
  hostWorkspace?: string;
  failFirstSubmission?: boolean;
}

async function fixture(page: Page, options: FixtureOptions = {}) {
  const tasks: NavigatorTaskRecord[] = [];
  const submissions: Array<{ body: Record<string, unknown>; idempotencyKey: string | null }> = [];
  const requests: string[] = [];
  const session = { state: "AUTHENTICATED", authenticated: true, sessionId: "paired-session", expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "paired-csrf", refreshed: false };
  let failFirstSubmission = options.failFirstSubmission === true;
  let revealTasks = !failFirstSubmission;
  await page.route("**/studio-team/v1/session", route => route.fulfill({ json: { mode: "local", authenticated: true, token: "studio-csrf", actor: { id: "test-user", workspaceIds: ["local"], scopes: ["products.read", "products.operate", "products.admin"] } } }));
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    requests.push(path);
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === "/api/v1/auth/session/refresh") return reply(session);
    if (path === "/api/v1/auth/session") return reply(session);
    if (path === "/api/v1/system/status") return reply({ service: "Navigator", status: "OK", version: "test", ...(options.hostWorkspace ? { workspaceId: options.hostWorkspace } : {}), authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString() });
    if (path === "/api/v1/navigator/tasks" && method === "GET") return reply({ items: revealTasks ? tasks.slice().reverse() : [], nextCursor: null });
    if (path === "/api/v1/navigator/tasks" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      const idempotencyKey = request.headers()["idempotency-key"] ?? null;
      submissions.push({ body, idempotencyKey });
      const taskId = String(body.taskId);
      let task = tasks.find(item => item.id === taskId);
      if (!task) {
        task = { id: taskId, workspaceId: "local", sessionId: String(body.sessionId ?? "agent-session-1"), prompt: String(body.prompt), status: "queued", createdAt: Date.now(), startedAt: null, endedAt: null, output: "", reasoning: "", error: null, durationMs: 0, sequence: 1, metadata: {} };
        tasks.push(task);
      }
      if (failFirstSubmission) { failFirstSubmission = false; return reply({ code: "TIMEOUT", detail: "Response lost after acceptance", retryable: true }, 503); }
      revealTasks = true;
      return reply(task, 202);
    }
    if (path.match(/^\/api\/v1\/navigator\/tasks\/[^/]+\/events$/)) return route.fulfill({ contentType: "text/event-stream", body: "id: 1\nevent: status\ndata: {\"type\":\"status\",\"status\":\"queued\"}\n\n" });
    if (path.match(/^\/api\/v1\/navigator\/tasks\/[^/]+\/cancel$/) && method === "POST") {
      const taskId = path.split("/").at(-2)!;
      const task = tasks.find(item => item.id === taskId);
      if (task) { task.status = "aborted"; task.endedAt = Date.now(); }
      return reply({ taskId, cancelled: true });
    }
    const taskPath = path.match(/^\/api\/v1\/navigator\/tasks\/([^/]+)$/);
    if (taskPath && method === "GET") return reply(tasks.find(item => item.id === taskPath[1]) ?? { code: "NOT_FOUND" }, tasks.some(item => item.id === taskPath[1]) ? 200 : 404);
    if (path === "/api/v1/workspaces/local/work/approvals") return reply([]);
    if (path === "/api/v1/workspaces/local/work/inputs") return reply({ items: [] });
    if (path === "/api/v1/workspaces/local/work/memory/facts") return reply({ items: [] });
    return reply({ code: "UNAVAILABLE", detail: "Fixture endpoint unavailable" }, 404);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "AI Assistant", exact: true }).click();
  return { tasks, submissions, requests };
}

test("chat retries the same durable task id and leaves runtime selection with Navigator", async ({ page }) => {
  const state = await fixture(page, { hostWorkspace: "local", failFirstSubmission: true });
  await expect(page.locator(".assistant-model-bar")).toBeVisible();
  await page.getByLabel("消息", { exact: true }).fill("One durable task");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试原请求", exact: true })).toBeVisible();
  expect(state.tasks).toHaveLength(1);
  expect(state.submissions).toHaveLength(1);
  const taskId = state.submissions[0].body.taskId;
  expect(typeof taskId).toBe("string");
  expect(state.submissions[0].body).toEqual({ prompt: "One durable task", taskId });
  expect(state.submissions[0].idempotencyKey).toBe(taskId);
  await page.getByRole("button", { name: "重试原请求", exact: true }).click();
  await expect(page.locator(`[data-task-id="${taskId}"]`)).toBeVisible();
  expect(state.tasks).toHaveLength(1);
  expect(state.submissions).toHaveLength(2);
  expect(state.submissions[1]).toEqual(state.submissions[0]);
  expect(state.requests.some(path => path.includes("assistant/capabilities") || path.includes("assistant/providers"))).toBe(false);
});

for (const hostWorkspace of [undefined, "different-workspace"] as const) {
  test(`assistant writes stay disabled when Navigator workspace is ${hostWorkspace ?? "unknown"}`, async ({ page }) => {
    const state = await fixture(page, { hostWorkspace });
    await expect(page.getByLabel("消息", { exact: true })).toBeDisabled();
    expect(state.submissions).toEqual([]);
    expect(state.requests.some(path => path.includes("assistant/capabilities") || path.includes("assistant/providers"))).toBe(false);
  });
}

test("provider settings stay explicitly unavailable and make no provider API calls", async ({ page }) => {
  const state = await fixture(page, { hostWorkspace: "local" });
  await page.getByRole("button", { name: "助手设置", exact: true }).click();
  await expect(page.locator(".assistant-provider")).toBeVisible();
  expect(state.requests.some(path => path.includes("assistant/capabilities") || path.includes("assistant/providers"))).toBe(false);
});
