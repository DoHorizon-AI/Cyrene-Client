import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("shared task stream ignores late previous-task refreshes, resumes its cursor, and stops at terminal state", async ({ page }) => {
  const entry = `/@fs/${resolve("tests/fixtures/task-stream.tsx").replaceAll("\\", "/")}`;
  let oldRefreshArrived!: () => void, releaseOldRefresh!: () => void, bFinished = false;
  const oldArrived = new Promise<void>(resolve => { oldRefreshArrived = resolve; });
  const oldGate = new Promise<void>(resolve => { releaseOldRefresh = resolve; });
  const cursors: { id: string; after: number }[] = [];
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  await page.route("**/api/v1/navigator/tasks/**", async route => {
    const url = new URL(route.request().url()), id = url.pathname.split("/")[5];
    if (url.pathname.endsWith("/events")) {
      const after = Number(url.searchParams.get("after")); cursors.push({ id, after });
      if (id === "task-b" && after === 1) bFinished = true;
      return route.fulfill({ contentType: "text/event-stream", body: `id: ${after + 1}\nevent: text-delta\ndata: {"type":"text-delta","status":"running"}\n\n` });
    }
    if (id === "task-a") { oldRefreshArrived(); await oldGate; }
    return route.fulfill({ json: { id, workspaceId: "local", sessionId: id, prompt: id, status: bFinished ? "completed" : "running", createdAt: 1,
      startedAt: 1, endedAt: bFinished ? 2 : null, output: "", reasoning: "", error: null, durationMs: 0, sequence: bFinished ? 2 : 1, metadata: {} } });
  });
  await page.goto("/");
  await oldArrived;
  await page.getByRole("button", { name: "Select B", exact: true }).click();
  await expect(page.getByLabel("Task events", { exact: true })).toContainText('"task-b":[1]');
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  releaseOldRefresh();
  expect(await page.getByLabel("Task observations", { exact: true }).textContent()).not.toContain("task-a");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByLabel("Task events", { exact: true })).toContainText('"task-b":[1,2]');
  await expect(page.getByLabel("Task observations", { exact: true })).toContainText('"status":"completed"');
  await expect(page.getByLabel("Task observations", { exact: true })).not.toContainText("task-a");
  expect(cursors.filter(value => value.id === "task-b")).toEqual([{ id: "task-b", after: 0 }, { id: "task-b", after: 1 }]);
  const before = cursors.length;
  await page.clock.install(); await page.clock.fastForward(30_000);
  expect(cursors).toHaveLength(before);
  await expect(page.getByRole("alert")).toBeEmpty();
});

for (const resources of ["fail", "slow"] as const) test(`a successful terminal task observation stops streaming when auxiliary refreshes ${resources}`, async ({ page }) => {
  const entry = `/@fs/${resolve("tests/fixtures/task-stream.tsx").replaceAll("\\", "/")}`;
  let streamReads = 0, finished = resources === "fail";
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  await page.route("**/api/v1/navigator/tasks/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/events")) {
      streamReads++;
      const after = Number(url.searchParams.get("after"));
      if (after) finished = true;
      return route.fulfill({ contentType: "text/event-stream", body: `id: ${after + 1}\nevent: status\ndata: {"type":"status","status":"${finished ? "completed" : "running"}"}\n\n` });
    }
    return route.fulfill({ json: { id: "task-a", workspaceId: "local", sessionId: "session", prompt: "Task", status: finished ? "completed" : "running", createdAt: 1,
      startedAt: 1, endedAt: finished ? 2 : null, output: "Finished", reasoning: "", error: null, durationMs: 0, sequence: finished ? 2 : 1, metadata: {} } });
  });
  await page.goto(`/?resources-${resources}`);
  await expect(page.getByLabel("Task observations", { exact: true })).toContainText('"status":"completed"');
  await page.clock.install(); await page.clock.fastForward(30_000);
  expect(streamReads).toBe(resources === "slow" ? 2 : 1);
});

test("the same task ID in a new scope starts at zero and cannot receive the old scope's late observation", async ({ page }) => {
  const entry = `/@fs/${resolve("tests/fixtures/task-stream.tsx").replaceAll("\\", "/")}`;
  let scope = "scope-a", oldRefreshArrived!: () => void, releaseOldRefresh!: () => void;
  const oldArrived = new Promise<void>(resolve => { oldRefreshArrived = resolve; });
  const oldGate = new Promise<void>(resolve => { releaseOldRefresh = resolve; });
  const cursors: { scope: string; after: number }[] = [];
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  await page.route("**/api/v1/navigator/tasks/**", async route => {
    const url = new URL(route.request().url()), owner = scope;
    if (url.pathname.endsWith("/events")) {
      const after = Number(url.searchParams.get("after")); cursors.push({ scope: owner, after });
      return route.fulfill({ contentType: "text/event-stream", body: `id: ${after + 1}\nevent: text-delta\ndata: {"type":"text-delta","status":"running"}\n\n` });
    }
    if (owner === "scope-a") { oldRefreshArrived(); await oldGate; }
    return route.fulfill({ json: { id: "task-a", workspaceId: owner, sessionId: "session", prompt: owner, status: "completed", createdAt: 1,
      startedAt: 1, endedAt: 2, output: "", reasoning: "", error: null, durationMs: 0, sequence: 1, metadata: {} } });
  });
  await page.goto("/"); await oldArrived;
  scope = "scope-b";
  await page.getByRole("button", { name: "Switch scope", exact: true }).click();
  await expect(page.getByLabel("Task observations", { exact: true })).toContainText('"workspaceId":"scope-b"');
  releaseOldRefresh();
  await expect(page.getByLabel("Task observations", { exact: true })).not.toContainText("scope-a");
  expect(cursors).toEqual([{ scope: "scope-a", after: 0 }, { scope: "scope-b", after: 0 }]);
  await expect(page.getByRole("alert")).toBeEmpty();
});

test("paused task streams replay once, settle at approval, and reopen after the task resumes", async ({ page }) => {
  const entry = `/@fs/${resolve("tests/fixtures/task-stream.tsx").replaceAll("\\", "/")}`;
  let taskStatus: "waiting_approval" | "running" = "waiting_approval";
  let eventReads = 0;
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  await page.route("**/api/fixture/task-stream/resume", route => {
    taskStatus = "running";
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/v1/navigator/tasks/**", route => {
    const url = new URL(route.request().url()), id = url.pathname.split("/")[5];
    if (url.pathname.endsWith("/events")) {
      eventReads++;
      return route.fulfill({ contentType: "text/event-stream", body: `id: ${eventReads}\nevent: status\ndata: {"type":"status","status":"${taskStatus}"}\n\n` });
    }
    return route.fulfill({ json: { id, workspaceId: "local", sessionId: "session-a", prompt: "Task A", status: taskStatus, createdAt: 1,
      startedAt: 1, endedAt: null, output: "", reasoning: "", error: null, durationMs: 0, sequence: eventReads + 1, metadata: {} } });
  });

  await page.goto("/?paused-resume");
  await expect(page.getByLabel("Task observations", { exact: true })).toContainText("waiting_approval");
  await expect(page.getByLabel("Task events", { exact: true })).toContainText('"task-a":[1]');
  expect(eventReads).toBe(1);
  await page.clock.install();
  await page.clock.fastForward(5_000);
  expect(eventReads).toBe(1);

  await page.getByRole("button", { name: "Resume task", exact: true }).click();
  await expect(page.getByLabel("Task observations", { exact: true })).toContainText("running");
  await expect.poll(() => eventReads).toBe(2);
});
