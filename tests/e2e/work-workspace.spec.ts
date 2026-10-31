import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const identity of ["unknown", "mismatch", "agree"] as const) {
  test(`Work operations require verified workspace identity: ${identity}`, async ({ page }) => {
    const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
    let mutations = 0;
    let hostWorkspace: string | undefined = identity === "unknown" ? undefined : identity === "mismatch" ? "different-workspace" : "local";
    await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
    await page.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== "GET") mutations++;
      if (path === "/api/v1/system/status") {
        return route.fulfill({ json: { service: "Navigator", status: "OK", version: "test", ...(hostWorkspace ? { workspaceId: hostWorkspace } : {}), authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString() } });
      }
      if (path === "/api/v1/navigator/tasks" && route.request().method() === "POST") return route.fulfill({ json: {
        id: "verified-task", workspaceId: "local", sessionId: "verified-session", prompt: "Verified task", status: "queued", createdAt: 1,
        startedAt: null, endedAt: null, output: "", reasoning: "", error: null, durationMs: 0, sequence: 1, metadata: {},
      } });
      if (path.endsWith("/approvals")) return route.fulfill({ json: [{ id: "approval", taskId: "task", kind: "tool", summary: "Approval", details: {}, status: "pending" }] });
      return route.fulfill({ json: { items: [], nextCursor: null } });
    });
    await page.goto("/?fixture=work");
    await page.getByLabel("Prompt", { exact: true }).fill("Verified task");
    await page.getByLabel("Fact key", { exact: true }).fill("note");
    await page.getByLabel("Note", { exact: true }).fill("Author note");
    if (identity !== "agree") {
      await expect(page.getByRole("button", { name: "Create task", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save note", exact: true })).toBeDisabled();
      await expect(page.getByLabel("Upload a workspace attachment", { exact: true })).toBeDisabled();
      expect(mutations).toBe(0);
      if (identity === "unknown") await expect(page.getByRole("alert")).toContainText("Navigator did not report a workspace identity");
      else await expect(page.getByRole("alert")).toContainText("Selected workspace does not match");
      hostWorkspace = "local";
      await page.getByRole("button", { name: "Retry workspace connection" }).click();
    }
    await expect(page.getByRole("button", { name: "Create task", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Save note", exact: true })).toBeEnabled();
    await expect(page.getByLabel("Upload a workspace attachment", { exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Create task", exact: true }).click();
    await expect.poll(() => mutations).toBe(1);
  });
}

test("task history from host workspace A is hidden and not reread while workspace B is selected", async ({ page }) => {
  const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
  let taskHistoryReads = 0;
  const hostTask = {
    id: "task-from-workspace-a", workspaceId: "workspace-a", sessionId: "session-a",
    prompt: "Host A private task history sentinel", status: "completed", createdAt: 1,
    startedAt: 1, endedAt: 2, output: "Host A private output sentinel", reasoning: "",
    error: null, durationMs: 1, sequence: 1, metadata: {},
  };
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/system/status") return route.fulfill({ json: {
      service: "Navigator", status: "OK", version: "test", workspaceId: "workspace-a", authenticated: true,
      proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString(),
    } });
    if (path === "/api/v1/navigator/tasks" && route.request().method() === "GET") {
      taskHistoryReads++;
      return route.fulfill({ json: { items: [hostTask], nextCursor: null } });
    }
    if (path === "/api/v1/navigator/tasks/task-from-workspace-a") return route.fulfill({ json: hostTask });
    if (path === "/api/v1/navigator/tasks/task-from-workspace-a/events") return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (path.endsWith("/approvals") || path.endsWith("/notifications") || path.endsWith("/connectors")) return route.fulfill({ json: [] });
    if (path.endsWith("/inputs") || path.endsWith("/memory/facts")) return route.fulfill({ json: { items: [] } });
    return route.fulfill({ json: { code: "NOT_FOUND" }, status: 404 });
  });

  await page.goto("/?fixture=work&workspace=workspace-a");
  await expect(page.getByRole("button", { name: /Host A private task history sentinel/ })).toBeVisible();
  await expect(page.getByText("Host A private output sentinel")).toBeVisible();
  await expect.poll(() => taskHistoryReads).toBe(1);

  await page.getByRole("button", { name: "Select B", exact: true }).click();
  await expect(page.locator(".work-assistant__notice--error").filter({ hasText: "Selected workspace does not match" })).toBeVisible();
  await expect(page.getByText("Host A private task history sentinel")).toHaveCount(0);
  await expect(page.getByText("Host A private output sentinel")).toHaveCount(0);
  await expect(page.getByText("Task history is hidden until the selected workspace is verified with Navigator.")).toBeVisible();
  expect(taskHistoryReads).toBe(1);
});

test("Work assistant reconciles an accepted-but-lost task response before retry", async ({ page }) => {
  const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
  const tasks: Record<string, unknown>[] = [];
  const submissions: { taskId: string; idempotencyKey: string | undefined }[] = [];
  const taskRecord = (id: string, prompt: string) => ({ id, workspaceId: "local", sessionId: "session-from-host", prompt,
    status: "queued", createdAt: 1, startedAt: null, endedAt: null, output: "", reasoning: "", error: null, durationMs: 0, sequence: 1, metadata: {} });
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/v1/system/status") return route.fulfill({ json: {
      service: "Navigator", status: "OK", version: "test", workspaceId: "local", authenticated: true,
      proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString(),
    } });
    if (path === "/api/v1/navigator/tasks" && request.method() === "GET") return route.fulfill({ json: { items: tasks, nextCursor: null } });
    if (path === "/api/v1/navigator/tasks" && request.method() === "POST") {
      const body = request.postDataJSON() as { taskId: string; prompt: string };
      submissions.push({ taskId: body.taskId, idempotencyKey: request.headers()["idempotency-key"] });
      if (!tasks.some(task => task.id === body.taskId)) tasks.push(taskRecord(body.taskId, body.prompt));
      return route.fulfill({ status: 503, json: { code: "TIMEOUT", detail: "Response lost after acceptance", retryable: true } });
    }
    const taskPath = path.match(/^\/api\/v1\/navigator\/tasks\/([^/]+)$/);
    if (taskPath && request.method() === "GET") {
      const id = decodeURIComponent(taskPath[1]);
      const task = tasks.find(item => item.id === id);
      return task ? route.fulfill({ json: task }) : route.fulfill({ status: 404, json: { code: "NOT_FOUND" } });
    }
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (path.endsWith("/approvals") || path.endsWith("/notifications") || path.endsWith("/connectors")) return route.fulfill({ json: [] });
    if (path.endsWith("/inputs") || path.endsWith("/memory/facts")) return route.fulfill({ json: { items: [] } });
    return route.fulfill({ json: { code: "NOT_FOUND" }, status: 404 });
  });

  await page.goto("/?fixture=work");
  await page.getByLabel("Prompt", { exact: true }).fill("Create one durable task");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry same task", exact: true }).first()).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0].idempotencyKey).toBe(submissions[0].taskId);

  await page.getByRole("button", { name: "Retry same task", exact: true }).first().click();
  await expect(page.locator(".work-assistant__task-list").getByRole("button", { name: /Create one durable task/ })).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(tasks).toHaveLength(1);
});

test("Work assistant confirms a lost approval response with the same message ID", async ({ page }) => {
  const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
  let taskStatus: "waiting_approval" | "running" = "waiting_approval";
  let approvalPending = true;
  const approvalSubmissions: { body: Record<string, unknown>; idempotencyKey: string | undefined }[] = [];
  const task = () => ({ id: "task-approval", workspaceId: "local", sessionId: "session-approval", prompt: "Approval task",
    status: taskStatus, createdAt: 1, startedAt: 1, endedAt: null, output: "", reasoning: "", error: null, durationMs: 1,
    sequence: taskStatus === "running" ? 2 : 1, metadata: {} });
  const approval = () => ({ id: "approval-1", taskId: "task-approval", kind: "tool", summary: "Approve a host action", details: {}, status: "pending" });
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/v1/system/status") return route.fulfill({ json: {
      service: "Navigator", status: "OK", version: "test", workspaceId: "local", authenticated: true,
      proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString(),
    } });
    if (path === "/api/v1/navigator/tasks" && request.method() === "GET") return route.fulfill({ json: { items: [task()], nextCursor: null } });
    if (path === "/api/v1/navigator/tasks/task-approval/events") return route.fulfill({ contentType: "text/event-stream", body: `id: 1\nevent: status\ndata: {"type":"status","status":"${taskStatus}"}\n\n` });
    if (path === "/api/v1/navigator/tasks/task-approval") return route.fulfill({ json: task() });
    if (path === "/api/v1/workspaces/local/work/approvals" && request.method() === "GET") return route.fulfill({ json: approvalPending ? [approval()] : [] });
    if (path === "/api/v1/workspaces/local/work/approvals/approval-1/resolve" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      approvalSubmissions.push({ body, idempotencyKey: request.headers()["idempotency-key"] });
      taskStatus = "running";
      approvalPending = false;
      if (approvalSubmissions.length === 1) return route.fulfill({ status: 503, json: { code: "TIMEOUT", detail: "Approval committed but response lost", retryable: true } });
      return route.fulfill({ json: { approval: { ...approval(), status: body.decision, createdAt: 1 }, duplicate: true, task: task() } });
    }
    if (path.endsWith("/inputs") || path.endsWith("/memory/facts") || path.endsWith("/notifications") || path.endsWith("/connectors")) return route.fulfill({ json: { items: [] } });
    return route.fulfill({ status: 404, json: { code: "NOT_FOUND" } });
  });

  await page.goto("/?fixture=work");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("No pending approvals")).toBeVisible();
  expect(approvalSubmissions).toHaveLength(2);
  expect(approvalSubmissions[0].body).toEqual(approvalSubmissions[1].body);
  expect(approvalSubmissions[0].idempotencyKey).toBe(approvalSubmissions[0].body.messageId);
  expect(approvalSubmissions[0].idempotencyKey).toBe(approvalSubmissions[1].idempotencyKey);
});
