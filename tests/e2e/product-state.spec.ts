import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function fixtureEntry(page: Page, mode: "catalyst" | "work") {
  const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  await page.goto(`/?fixture=${mode}`);
}
const block = (id: string, text: string) => ({ id, sourceRevisionId: "source-1", ordinal: 0, kind: "TEXT", text, locator: {}, origin: "EXTRACTED",
  policy: { allowKnowledge: false, allowTraining: false, allowedPrincipalRefs: [], allowedUsePurposes: [] },
});
const revision = (id: string, n: number) => ({ id, datasetId: "dataset-1", revision: n, sourceRevisionIds: ["source-1"], state: "DRAFT", blocks: [],
  createdAt: "2026-10-09T00:00:00Z", resourceVersion: 1,
});
async function catalystRoutes(page: Page, running = false) {
  let completed = false, releasePage: (() => void) | undefined;
  let pageRequested: (() => void) | undefined;
  const revisions = [revision("revision-1", 1), revision("revision-2", 2)];
  const run = { id: "run-1", datasetId: "dataset-1", operation: "parse", state: "RUNNING", sourceRevisionIds: ["source-1"],
    recipe: {}, recipeDigest: "digest", outputArtifacts: [], warnings: [], createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z", resourceVersion: 1,
  };
  await page.route("**/api/v1/catalyst/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const reply = (json: unknown) => route.fulfill({ json });
    if (path.endsWith("/content-revisions")) return reply(completed ? [revision("revision-new", 3), ...revisions] : revisions);
    if (path.endsWith("/processing-runs")) return reply(running ? [{ ...run, state: completed ? "SUCCEEDED" : "RUNNING" }] : []);
    if (path.endsWith("/processing-runs/run-1")) return reply({ ...run, state: completed ? "SUCCEEDED" : "RUNNING" });
    if (path.endsWith("/review-queue")) return reply({ items: [], generatedDrafts: [] });
    if (path.endsWith("/blocks")) {
      const id = path.split("/").at(-2)!;
      const offset = Number(url.searchParams.get("offset"));
      if (offset) { pageRequested?.(); await new Promise<void>(resolve => { releasePage = resolve; }); }
      return reply({ revisionId: id, offset, limit: 50, total: id === "revision-1" ? 2 : 1,
        blocks: [block(`${id}-${offset}`, offset ? "Late first revision passage" : `Text for ${id}`)],
      });
    }
    return reply([]);
  });
  return { complete: () => { completed = true; }, waitForPage: () => new Promise<void>(resolve => { pageRequested = resolve; }), releasePage: () => releasePage?.() };
}

test("Catalyst completion preserves unsaved passage edits and announces the new revision", async ({ page }) => {
  const state = await catalystRoutes(page, true); await fixtureEntry(page, "catalyst");
  await page.getByRole("combobox", { name: /^Dataset / }).selectOption("dataset-1");
  await expect(page.getByRole("textbox", { name: "Passage text", exact: true })).toHaveValue("Text for revision-1");
  await page.getByRole("textbox", { name: "Passage text", exact: true }).fill("Pending author correction");
  state.complete();
  await expect(page.getByText("A new content revision is available.", { exact: false })).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole("combobox", { name: "Content revision", exact: true })).toHaveValue("revision-1");
  await expect(page.getByRole("textbox", { name: "Passage text", exact: true })).toHaveValue("Pending author correction");
});

test("Catalyst discards a late block page after switching revisions", async ({ page }) => {
  const state = await catalystRoutes(page); await fixtureEntry(page, "catalyst");
  await page.getByRole("combobox", { name: /^Dataset / }).selectOption("dataset-1");
  await expect(page.getByRole("textbox", { name: "Passage text", exact: true })).toHaveValue("Text for revision-1");
  const requested = state.waitForPage();
  await page.getByRole("button", { name: "Load more passages", exact: true }).click(); await requested;
  await page.getByRole("combobox", { name: "Content revision", exact: true }).selectOption("revision-2");
  await expect(page.getByRole("textbox", { name: "Passage text", exact: true })).toHaveValue("Text for revision-2");
  state.releasePage();
  await expect(page.getByRole("textbox", { name: "Passage text", exact: true })).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Passage text", exact: true })).toHaveValue("Text for revision-2");
});

test("Work Assistant streams a task selected after a terminal task and coalesces event bursts", async ({ page }) => {
  let reads = 0, streamed = false;
  const task = (id: string, status: string) => ({ id, workspaceId: "local", sessionId: id, prompt: `Question ${id}`, status,
    createdAt: 1, startedAt: 1, endedAt: status === "completed" ? 2 : null, output: status === "completed" ? "Final output" : "", reasoning: "", error: null, durationMs: 0,
    sequence: streamed && id === "task-b" ? 21 : 1, metadata: {},
  });
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/system/status") return route.fulfill({ json: { service: "Navigator", status: "OK", version: "test", workspaceId: "local", authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString() } });
    if (path === "/api/v1/navigator/tasks") return route.fulfill({ json: { items: [task("task-a", "completed"), task("task-b", "queued")], nextCursor: null } });
    if (path.endsWith("/task-a")) return route.fulfill({ json: task("task-a", "completed") });
    if (path.endsWith("/task-b")) { reads++; return route.fulfill({ json: task("task-b", streamed ? "completed" : "queued") }); }
    if (path.endsWith("/task-b/events")) {
      streamed = true;
      return route.fulfill({ contentType: "text/event-stream", body: Array.from({ length: 20 }, (_, i) => `id: ${i + 1}\nevent: task.output\ndata: {"type":"task.output","status":"running"}\n\n`).join("") });
    }
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: ": heartbeat\n\n" });
    if (path.endsWith("/approvals")) return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [] } });
  });
  await fixtureEntry(page, "work");
  await expect(page.locator(".work-assistant__detail")).toContainText("task-a");
  await page.getByRole("button", { name: /Question task-b/ }).click();
  await expect(page.locator(".work-assistant__detail")).toContainText("Final output");
  await expect(page.locator(".work-assistant__event-list p")).toHaveCount(20);
  expect(reads).toBeLessThanOrEqual(2);
});
