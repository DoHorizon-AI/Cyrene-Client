import { expect, test, type Page } from "@playwright/test";
import { examplePipeline } from "../../packages/pipeline-model";
import type { NavigatorTaskRecord } from "../../apps/web/services/navigator/src/api";
import { menuAction } from "./ide-helpers";

async function fixture(page: Page, hostDefault = false, restoreOldSession = false, expiresAt: string | null = null, probe: "ready" | "slow" | "failed" = "ready") {
  const tasks: NavigatorTaskRecord[] = [], submissions: Record<string, unknown>[] = [], decisions: Record<string, unknown>[] = [], eventCursors: number[] = [];
  const approvals: Record<string, unknown>[] = [];
  if (restoreOldSession) {
    await page.addInitScript(() => localStorage.setItem("cyrene.assistant.selection.v1:test-user:local", "archived-session"));
    tasks.push({ id: "archived-task", workspaceId: "local", sessionId: "archived-session", prompt: "Earlier Codex question", status: "completed", createdAt: Date.now() - 60_000, startedAt: Date.now() - 60_000, endedAt: Date.now() - 59_000, output: "Earlier Codex answer", reasoning: "", error: null, durationMs: 1000, sequence: 2, metadata: { navigator: { execution: { runtime: "codex", model: "codex-model", effort: "high", permission: "ask" } } } });
  }
  const provider = { id: "test-api", name: "Test API", baseUrl: "https://api.example.invalid/v1", configured: true, models: [{ id: "api-model", name: "API model", efforts: ["low", "high"] }] };
  let failFirstSubmission = false;
  let refreshes = 0;
  let failStatus = probe === "failed", releaseStatus: (() => void) | undefined;
  const session = { state: "AUTHENTICATED", authenticated: true, sessionId: "paired-session", expiresAt, refreshExpiresAt: null, refreshable: true, csrfToken: "paired-csrf", refreshed: false };
  await page.route("**/studio-team/v1/session", route => route.fulfill({ json: { mode: "local", authenticated: true, token: "studio-csrf", actor: { id: "test-user", workspaceIds: ["local"], scopes: ["pipelines.read", "pipelines.write", "servers.read", "servers.write", "runs.read", "products.read", "products.operate", "products.admin"] } } }));
  await page.route("**/api/v1/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === "/api/v1/auth/session/refresh") { refreshes++; session.csrfToken = "rotated-csrf"; session.expiresAt = null; return reply(session); }
    if (path === "/api/v1/auth/session") return reply(session);
    if (path === "/api/v1/system/status") {
      if (probe === "slow") await new Promise<void>(resolve => { releaseStatus = resolve; });
      if (failStatus) return reply({ code: "HOST_UNAVAILABLE", detail: "Host status unavailable" }, 503);
      return reply({ service: "Navigator", status: "OK", version: "test", workspaceId: "local", authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString() });
    }
    if (path === "/api/v1/navigator/assistant/capabilities") return reply({ defaultRuntime: "harness", workspaceId: "local", mcpConfigured: true, providers: hostDefault ? [] : [provider], runtimes: [
      { id: "harness", name: "Harness", available: true, models: hostDefault ? [{ id: "exchange-model", name: "Host Exchange model", efforts: [] }] : [], permissions: ["read-only", "ask"], approvalScopes: ["once", "task"], resume: true },
      { id: "codex", name: "Codex", available: true, models: [{ id: "codex-model", name: "Codex model", efforts: ["low", "high"] }], permissions: ["read-only", "ask", "auto", "full-access"], approvalScopes: ["once", "task"], resume: true },
      { id: "workbuddy", name: "WorkBuddy", available: false, reason: "Not installed", models: [], permissions: [], resume: false },
    ] });
    if (path === "/api/v1/navigator/assistant/providers/test-api" && method === "PUT") return reply(provider);
    if (path === "/api/v1/navigator/tasks" && method === "GET") {
      if (restoreOldSession && !url.searchParams.has("cursor")) return reply({ items: [], nextCursor: "older-page" });
      return reply({ items: tasks.slice().reverse(), nextCursor: null });
    }
    if (path === "/api/v1/navigator/tasks" && method === "POST") {
      const input = req.postDataJSON() as Record<string, unknown>, id = req.headers()["idempotency-key"];
      submissions.push({ ...input, requestId: id });
      const existing = tasks.find(task => task.id === id);
      if (existing) return reply(existing, 202);
      const task: NavigatorTaskRecord = { id, workspaceId: "local", sessionId: String(input.sessionId || "agent-session-1"), prompt: String(input.prompt), status: "running", createdAt: Date.now(), startedAt: Date.now(), endedAt: null, output: "", reasoning: "", error: null, durationMs: 0, sequence: 1,
        metadata: { ...(input.metadata as Record<string, unknown>), navigator: { execution: input.execution } } };
      tasks.push(task);
      if (failFirstSubmission) { failFirstSubmission = false; return reply({ code: "TIMEOUT", detail: "Response lost after acceptance", retryable: true }, 503); }
      return reply(task, 202);
    }
    if (path.match(/^\/api\/v1\/navigator\/tasks\/[^/]+\/events$/)) {
      const cursor = Number(url.searchParams.get("after")); eventCursors.push(cursor);
      return route.fulfill({ contentType: "text/event-stream", body: cursor ? ": heartbeat\n\n" : "id: 1\nevent: task.created\ndata: {\"status\":\"running\"}\n\n" });
    }
    if (path.match(/^\/api\/v1\/navigator\/tasks\/[^/]+\/cancel$/)) {
      const id = path.split("/").at(-2)!, task = tasks.find(item => item.id === id)!;
      task.status = "aborted"; task.endedAt = Date.now(); return reply({ taskId: id, cancelled: true });
    }
    if (path.match(/^\/api\/v1\/navigator\/tasks\/[^/]+$/)) return reply(tasks.find(item => item.id === path.split("/").at(-1)));
    if (path === "/api/v1/workspaces/local/work/approvals") return reply(approvals);
    if (path.match(/^\/api\/v1\/workspaces\/local\/work\/approvals\/[^/]+\/resolve$/)) { decisions.push({ id: path.split("/").at(-2), ...req.postDataJSON() }); approvals.splice(0); return reply({ resolved: true }); }
    if (path === "/api/v1/workspaces/local/work/inputs") return reply({ items: [] });
    return reply({ code: "UNAVAILABLE", detail: "Fixture endpoint unavailable" }, 404);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "AI Assistant", exact: true }).click();
  await expect(page.getByLabel("智能体", { exact: true })).toBeVisible();
  return { tasks, submissions, decisions, approvals, eventCursors, refreshes: () => refreshes,
    resumeStatus: () => { failStatus = false; releaseStatus?.(); }, loseFirstResponse: () => { failFirstSubmission = true; } };
}

test("one Navigator session survives docking, cancellation, continuation and browser reload", async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel("智能体", { exact: true }).selectOption("codex");
  await page.getByLabel("思考深度", { exact: true }).selectOption("high");
  await page.getByLabel("消息", { exact: true }).fill("First turn");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-task-id]")).toHaveCount(1);
  expect(state.submissions[0].execution).toEqual({ runtime: "codex", model: "codex-model", effort: "high", permission: "ask" });
  const firstSession = state.tasks[0].sessionId;
  await page.getByLabel("消息", { exact: true }).fill("Continue after docking");
  await page.getByRole("button", { name: "在主页面打开", exact: true }).click();
  await expect(page.getByRole("tab", { name: "AI Assistant", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("Continue after docking");
  await page.getByRole("button", { name: "停靠右侧", exact: true }).click();
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("Continue after docking");
  expect(state.submissions).toHaveLength(1);
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.locator("[data-task-id]")).toContainText("已停止");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-task-id]")).toHaveCount(2);
  expect(state.submissions[1].sessionId).toBe(firstSession);
  await page.reload();
  await expect(page.locator("[data-task-id]")).toHaveCount(2);
  await expect(page.getByLabel("智能体", { exact: true })).toHaveValue("codex");
  await expect(page.getByLabel("思考深度", { exact: true })).toHaveValue("high");
  expect(state.tasks).toHaveLength(2);
});

test("pending approvals retain the originating task and workflow when the canvas switches", async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel("消息", { exact: true }).fill("Edit the selected workflow");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-task-id]")).toHaveCount(1);
  const task = state.tasks[0];
  task.status = "waiting_approval";
  state.approvals.push({ id: "approval-old-flow", taskId: task.id, kind: "tool", summary: "pipelines.patch", details: { pipelineId: "instruction-tuning" }, status: "pending" });
  await expect(page.getByRole("button", { name: "允许本次", exact: true })).toBeVisible();
  const next = { ...examplePipeline(), id: "another-pipeline", name: "另一个流程" };
  page.on("dialog", dialog => dialog.accept());
  await page.getByLabel("导入流程文件", { exact: true }).setInputFiles({ name: "other.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(next)) });
  await expect(page.getByLabel("流水线名称", { exact: true })).toHaveValue("另一个流程");
  await expect(page.locator(".assistant-message.approval")).toContainText("instruction-tuning");
  await expect(page.locator(".assistant-message.approval")).toContainText("当前画布已切换");
  await page.getByRole("button", { name: "允许本次", exact: true }).click();
  await expect.poll(() => state.decisions.length).toBe(1);
  expect(state.decisions[0].id).toBe("approval-old-flow");
  expect((state.submissions[0].metadata as Record<string, any>).workflow.pipelineId).toBe("instruction-tuning");
});

test("untrusted Markdown does not load remote images or raw HTML and unavailable agents cannot be selected", async ({ page }) => {
  const state = await fixture(page), leaks: string[] = [];
  page.on("request", request => { if (request.url().includes("leak.example.invalid")) leaks.push(request.url()); });
  expect(await page.getByLabel("智能体", { exact: true }).locator('option[value="workbuddy"]').isDisabled()).toBe(true);
  await page.getByLabel("消息", { exact: true }).fill("Show a result");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.tasks.length).toBe(1);
  state.tasks[0].status = "completed";
  state.tasks[0].output = '**Done**\n\n![secret](https://leak.example.invalid/?pipeline=private)\n\n<img src="https://leak.example.invalid/raw">\n\n[unsafe](javascript:alert(1))';
  await expect(page.locator(".assistant-transcript")).toContainText("Done");
  expect(await page.locator(".assistant-transcript img").count()).toBe(0);
  expect(await page.locator('.assistant-transcript a[href^="javascript:"]').count()).toBe(0);
  expect(leaks).toEqual([]);
});

test("API credentials stay out of browser storage and lost task responses do not create duplicate work", async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "助手设置", exact: true }).click();
  await page.getByLabel("已有提供方", { exact: true }).selectOption("test-api");
  await page.getByLabel("API Key", { exact: true }).fill("test-private-key-never-persist");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain("test-private-key-never-persist");
  await page.getByRole("button", { name: "返回聊天", exact: true }).click();
  state.loseFirstResponse();
  await page.getByLabel("消息", { exact: true }).fill("One durable task");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-task-id]")).toHaveCount(1);
  expect(state.tasks).toHaveLength(1);
  expect(state.submissions[0].prompt).toBe("One durable task");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("");
});

test("task approval scope is sent to Navigator and a new chat resets permission mode", async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel("智能体", { exact: true }).selectOption("codex");
  await page.getByLabel("消息", { exact: true }).fill("Approve this turn");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.tasks.length).toBe(1);
  const task = state.tasks[0]; task.status = "waiting_approval";
  state.approvals.push({ id: "approval-turn", taskId: task.id, kind: "cyrene_mcp_write", summary: "pipelines.patch", details: {}, status: "pending" });
  await page.getByRole("button", { name: "本任务内同类操作全部允许", exact: true }).click();
  await expect.poll(() => state.decisions.length).toBe(1);
  expect(state.decisions[0]).toMatchObject({ id: "approval-turn", decision: "approved", scope: "task" });
  task.status = "completed";
  await expect(page.getByLabel("权限模式", { exact: true })).toBeEnabled();
  page.once("dialog", dialog => dialog.accept());
  await page.getByLabel("权限模式", { exact: true }).selectOption("full-access");
  await page.getByRole("button", { name: "新建聊天", exact: true }).click();
  await expect(page.getByLabel("权限模式", { exact: true })).toHaveValue("ask");
});

test("legacy history is read only and image uploads obey the model capability", async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel("选择附件", { exact: true }).setInputFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from("fake png") });
  await expect(page.getByRole("alert")).toContainText("没有声明图像支持");
  await page.getByRole("button", { name: "聊天历史", exact: true }).click();
  await page.getByLabel("选择旧聊天导出", { exact: true }).setInputFiles({ name: "old-chat.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, kind: "cyrene-legacy-assistant-history", workspaceId: "local", sessions: [{ id: "legacy-1", title: "Legacy chat", runtime: "codex", updatedAt: 1, events: [{ seq: 1, type: "user", data: { text: "Old question" } }, { seq: 2, type: "text", data: { text: "Old answer" } }, { seq: 3, type: "approval", data: { text: "Unsafe legacy approval" } }] }] })) });
  await expect(page.locator(".assistant-aux:visible")).toContainText("Old answer");
  await expect(page.locator(".assistant-aux:visible")).toContainText("旧聊天只读");
  await expect(page.getByRole("button", { name: "允许本次", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送", exact: true })).toHaveCount(0);
  expect(state.submissions).toEqual([]);
});

test("existing Harness Exchange configuration works without registering a personal API provider", async ({ page }) => {
  const state = await fixture(page, true);
  await expect(page.getByLabel("模型", { exact: true })).toHaveValue("exchange-model");
  await page.getByLabel("消息", { exact: true }).fill("Use the configured host model");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-task-id]")).toHaveCount(1);
  expect(state.submissions[0].execution).toEqual({ runtime: "harness", model: "exchange-model", permission: "ask" });
});

test("restoring an older selected session loads earlier tasks before enabling continuation", async ({ page }) => {
  const state = await fixture(page, false, true);
  await expect(page.locator(".assistant-transcript")).toContainText("Earlier Codex answer");
  await expect(page.getByLabel("智能体", { exact: true })).toHaveValue("codex");
  await expect(page.getByLabel("思考深度", { exact: true })).toHaveValue("high");
  expect(state.submissions).toEqual([]);
});

test("chat and Product share a single rotation, updated CSRF and logout state", async ({ page }) => {
  const state = await fixture(page, false, false, new Date(Date.now() + 33_000).toISOString());
  await menuAction(page, "工具", "服务状态");
  await expect(page.locator(".product-session-bar")).toContainText("Product 服务已连接");
  await expect.poll(state.refreshes, { timeout: 6000 }).toBe(1);
  await page.getByLabel("消息", { exact: true }).fill("Shared session after rotation");
  const sent = page.waitForRequest(request => new URL(request.url()).pathname === "/api/v1/navigator/tasks" && request.method() === "POST");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  expect((await sent).headers()["x-csrf-token"]).toBe("rotated-csrf");
  await page.route("**/api/v1/auth/session", route => route.request().method() === "DELETE" ? route.fulfill({ status: 204 }) : route.fallback());
  await page.getByRole("button", { name: "断开 Product 会话", exact: true }).click();
  await expect(page.locator(".assistant-aux")).toContainText("一次性配对码");
  await expect(page.locator(".product-connection")).toBeVisible();
  expect(state.refreshes()).toBe(1);
});

test("permission escalation requires confirmation and a legacy task without permission restores Ask", async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel("智能体", { exact: true }).selectOption("codex");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByLabel("权限模式", { exact: true }).selectOption("full-access");
  await expect(page.getByLabel("权限模式", { exact: true })).toHaveValue("ask");
  page.once("dialog", dialog => dialog.accept());
  await page.getByLabel("权限模式", { exact: true }).selectOption("full-access");
  await page.getByLabel("消息", { exact: true }).fill("First task");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.tasks.length).toBe(1);
  state.tasks[0].status = "completed";
  (state.tasks[0].metadata.navigator as any).execution.permission = undefined;
  await page.reload();
  await expect(page.getByLabel("权限模式", { exact: true })).toHaveValue("ask");
});

for (const probe of ["slow", "failed"] as const) test(`workspace identity ${probe} keeps operations disabled until the host is verified`, async ({ page }) => {
  const state = await fixture(page, false, false, null, probe);
  await expect(page.getByLabel("消息", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "附加文件", exact: true })).toBeDisabled();
  expect(state.submissions).toEqual([]);
  state.resumeStatus();
  if (probe === "failed") {
    await expect(page.getByText("Host status unavailable", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "重试工作空间连接", exact: true }).click();
  }
  await expect(page.getByLabel("消息", { exact: true })).toBeEnabled();
  await page.getByLabel("消息", { exact: true }).fill("Verified workspace task");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => state.submissions.length).toBe(1);
});
