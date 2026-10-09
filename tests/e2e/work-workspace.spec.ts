import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const identity of ["unknown", "mismatch", "agree"] as const) test(`Work operations require verified workspace identity: ${identity}`, async ({ page }) => {
  const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
  let release!: () => void, mutations = 0, capabilityWorkspace = identity === "mismatch" ? "different-workspace" : "local";
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") mutations++;
    if (path === "/api/v1/system/status") {
      if (identity === "unknown") await gate;
      return route.fulfill({ json: { service: "Navigator", status: "OK", version: "test", workspaceId: "local", authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString() } });
    }
    if (path === "/api/v1/navigator/assistant/capabilities") return route.fulfill({ json: { workspaceId: capabilityWorkspace, defaultRuntime: "harness", mcpConfigured: true, runtimes: [], providers: [] } });
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
    if (identity === "unknown") release();
    else {
      await expect(page.getByRole("alert")).toContainText("Selected workspace does not match");
      capabilityWorkspace = "local";
      await page.getByRole("button", { name: "Retry workspace connection", exact: true }).click();
    }
  }
  await expect(page.getByRole("button", { name: "Create task", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save note", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Upload a workspace attachment", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect.poll(() => mutations).toBe(1);
});
