import { expect, test, type Page } from "@playwright/test";
import { examplePipeline } from "../../packages/pipeline-model";
import { menuAction } from "./ide-helpers";

async function command(page: Page, name: string, input: object) {
  const { token } = await (await page.request.get("/studio-pipelines/v1/session")).json();
  const response = await page.request.post("/studio-pipelines/v1/commands", {
    headers: { "x-studio-control-token": token }, data: { name, input, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() },
  });
  expect(response.ok()).toBeTruthy(); return (await response.json()).result;
}

test("Alt tool shortcuts respect editable focus", async ({ page }) => {
  await page.goto("/");
  const files = page.getByRole("button", { name: "项目文件", exact: true }).first();
  const before = await files.getAttribute("aria-pressed");
  await page.getByLabel("流水线名称", { exact: true }).focus();
  await page.keyboard.press("Alt+1");
  await expect(files).toHaveAttribute("aria-pressed", before!);
  await page.getByLabel("训练轮数", { exact: true }).focus();
  await page.keyboard.press("Alt+1");
  await expect(files).toHaveAttribute("aria-pressed", before!);
  await page.locator(".canvas-container canvas").focus();
  await page.keyboard.press("Alt+1");
  await expect(files).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
});

test("showing and hiding Assistant retains the same connected portal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "AI Assistant", exact: true }).click();
  await expect(page.locator(".assistant-window")).toBeVisible();
  await page.evaluate(() => {
    const host = document.querySelector(".assistant-portal")!;
    (window as any).assistantHost = host;
    (window as any).assistantRemovals = 0;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.removedNodes) {
        if (node === host || (node instanceof Element && node.contains(host))) (window as any).assistantRemovals++;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "收起右侧窗口", exact: true }).click();
  await expect(page.locator(".assistant-window")).toBeHidden();
  await page.getByRole("button", { name: "AI Assistant", exact: true }).click();
  await expect(page.locator(".assistant-window")).toBeVisible();
  expect(await page.evaluate(() => ({ removals: (window as any).assistantRemovals,
    same: (window as any).assistantHost === document.querySelector(".assistant-portal"), connected: (window as any).assistantHost.isConnected,
  }))).toEqual({ removals: 0, same: true, connected: true });
});

test("remote updates preserve viewport and closed inspector, and wait for a canvas gesture to finish", async ({ page }) => {
  const document = examplePipeline(); document.id = `viewport-${crypto.randomUUID()}`;
  await page.goto("/");
  await page.getByLabel("导入流程文件", { exact: true }).setInputFiles({ name: "flow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await page.getByRole("button", { name: "保存到服务端", exact: true }).click();
  await expect(page.locator(".footer [role=status]")).toContainText("服务端草稿已保存");
  await page.getByRole("button", { name: "收起右侧窗口", exact: true }).click();
  const canvas = page.locator(".canvas-container canvas");
  const view = await canvas.evaluate(element => {
    const canvas = (element as any).data; canvas.ds.scale = 0.65; canvas.ds.offset[0] = -200; canvas.ds.offset[1] = 120;
    return { scale: canvas.ds.scale, offset: Array.from(canvas.ds.offset) };
  });
  await command(page, "pipelines.patch", { workspaceId: "local", pipelineId: document.id, expectedGraphRevision: 1, expectedLayoutRevision: 1,
    edits: [{ op: "rename", name: "Remote viewport update" }],
  });
  await expect(page.getByLabel("流水线名称", { exact: true })).toHaveValue("Remote viewport update", { timeout: 8000 });
  expect(await canvas.evaluate(element => ({ scale: (element as any).data.ds.scale, offset: Array.from((element as any).data.ds.offset) }))).toEqual(view);
  await expect(page.getByRole("button", { name: "节点信息", exact: true }).first()).toHaveAttribute("aria-pressed", "false");
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 15, bounds.y + 15); await page.mouse.down();
  await command(page, "pipelines.patch", { workspaceId: "local", pipelineId: document.id, expectedGraphRevision: 2, expectedLayoutRevision: 1,
    edits: [{ op: "rename", name: "Remote during gesture" }],
  });
  await page.waitForResponse(response => response.url().endsWith("/studio-pipelines/v1/commands") && response.request().postDataJSON()?.name === "pipelines.get");
  await expect(page.getByLabel("流水线名称", { exact: true })).toHaveValue("Remote viewport update");
  await page.mouse.up();
  await expect(page.getByLabel("流水线名称", { exact: true })).toHaveValue("Remote during gesture", { timeout: 8000 });
});

test("a late build poll cannot undo cancellation and terminal builds stop polling", async ({ page }) => {
  let getCount = 0, release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), arrived = new Promise<void>(resolve => { requested = resolve; });
  const build = { id: "fixture-build", workspaceId: "local", revision: 3, state: "running", profile: { title: "Fixture build" }, message: "Building" };
  await page.clock.install();
  await page.route("**/studio-team/v1/session", route => route.fulfill({ json: { mode: "local", authenticated: true, token: "team-token", actor: { id: "local-user", workspaceIds: ["local"], scopes: ["pipelines.read", "pipelines.write", "builds.read", "builds.write"] } } }));
  await page.route("**/api/v1/**", route => route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } }));
  await page.route("**/studio-builds/v1/session", route => route.fulfill({ json: { token: "build-token" } }));
  await page.route("**/studio-builds/v1/commands", async route => {
    const { name } = route.request().postDataJSON();
    let result: unknown;
    if (name === "builds.get") { getCount++; requested(); await gate; result = build; }
    else if (name === "builds.list_profiles") result = { items: [] };
    else if (name === "builds.list") result = { items: [build] };
    else if (name === "builds.read_events") result = { cursor: 0, items: [] };
    else if (name === "builds.cancel") result = { ...build, revision: 4, state: "cancelled", message: "Cancelled" };
    else throw new Error(`Unexpected build command ${name}`);
    await route.fulfill({ json: { result } });
  });
  await page.goto("/"); await menuAction(page, "视图", "构建输出");
  await page.getByRole("button", { name: "刷新构建任务", exact: true }).click();
  await page.getByLabel("构建任务", { exact: true }).selectOption(build.id); await arrived;
  await page.getByRole("button", { name: "取消选中构建", exact: true }).click();
  await expect(page.getByRole("region", { name: "构建与节点版本" })).toContainText("cancelled · v4");
  release();
  await page.clock.fastForward(10_000);
  await expect(page.getByRole("region", { name: "构建与节点版本" })).toContainText("cancelled · v4");
  expect(getCount).toBe(1);
});
