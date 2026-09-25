import { menuAction } from "./ide-helpers";
import { expect, test, type Page } from "@playwright/test";
import { examplePipeline } from "../../packages/pipeline-model";

async function upload(page: Page, id: string) {
  const p = examplePipeline(); p.id = id;
  await page.getByLabel("导入流程文件").setInputFiles({ name: "pipeline.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(p)) });
}
async function command(page: Page, name: string, input: object) {
  const session = await page.request.get("/studio-pipelines/v1/session"); const { token } = await session.json();
  const response = await page.request.post("/studio-pipelines/v1/commands", { headers: { "x-studio-control-token": token }, data: { name, input, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).result;
}
const positions = (page: Page) => page.locator("canvas").evaluate(el => Object.fromEntries((el as any).data.graph._nodes.map((n: any) => [n.properties.document.id, Array.from(n.pos)])));

test("automatic layout, pinned nodes and local undo/redo preserve graph semantics", async ({ page }) => {
  await page.goto("/");
  const before = await positions(page);
  await menuAction(page, "编辑", "锁定节点位置");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByRole("button", { name: "解锁节点位置", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "编辑", exact: true }).press("Escape");
  await page.getByRole("button", { name: "自动排版", exact: true }).click();
  await expect(page.locator(".footer [role=status]")).toContainText("排版已应用");
  const after = await positions(page);
  expect(after.training).toEqual(before.training);
  expect(after).not.toEqual(before);
  await expect(page.getByText("7 节点 · 9 连接")).toBeVisible();
  await menuAction(page, "编辑", "撤销本地修改");
  expect(await positions(page)).toEqual(before);
  await menuAction(page, "编辑", "重做本地修改");
  expect(await positions(page)).toEqual(after);
  await menuAction(page, "编辑", "撤销本地修改");
  expect(await positions(page)).toEqual(before);
  await page.getByLabel("流水线名称").fill("新的分支修改");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByRole("button", { name: "重做本地修改", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "解锁节点位置", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "编辑", exact: true }).press("Escape");
});

test("persisted pipeline follows external edits while protecting unsaved work", async ({ page }) => {
  const id = `browser-pipeline-${Date.now()}`;
  await page.goto("/"); await upload(page, id);
  await page.getByRole("button", { name: "保存到服务端", exact: true }).click();
  await expect(page.locator(".footer [role=status]")).toContainText("服务端草稿已保存");
  await command(page, "pipelines.patch", { workspaceId: "local", pipelineId: id, expectedGraphRevision: 1, expectedLayoutRevision: 1, edits: [{ op: "rename", name: "外部客户端设计的流程" }] });
  await expect(page.getByLabel("流水线名称")).toHaveValue("外部客户端设计的流程", { timeout: 8000 });
  await page.getByLabel("流水线名称").fill("本地未保存的流程");
  await command(page, "pipelines.patch", { workspaceId: "local", pipelineId: id, expectedGraphRevision: 2, expectedLayoutRevision: 1, edits: [{ op: "rename", name: "新的外部修改" }] });
  await expect(page.getByText("本地修改已保留", { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(page.getByLabel("流水线名称")).toHaveValue("本地未保存的流程");
  await page.getByRole("button", { name: "保存到服务端", exact: true }).click();
  await expect(page.locator(".footer [role=status]")).toContainText("版本差异");
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "载入新版本", exact: true }).click();
  await expect(page.getByLabel("流水线名称")).toHaveValue("新的外部修改");
  await menuAction(page, "编辑", "撤销服务端修改");
  await expect(page.getByLabel("流水线名称")).toHaveValue("外部客户端设计的流程");
  await menuAction(page, "编辑", "重做服务端修改");
  await expect(page.getByLabel("流水线名称")).toHaveValue("新的外部修改");
  await menuAction(page, "编辑", "撤销服务端修改");
  await expect(page.getByLabel("流水线名称")).toHaveValue("外部客户端设计的流程");
  await page.getByRole("button", { name: "自动排版", exact: true }).click();
  await expect(page.locator(".footer [role=status]")).toContainText("排版已应用");
  await page.getByRole("button", { name: "保存到服务端", exact: true }).click();
  await expect(page.locator(".footer [role=status]")).toContainText("布局 v2");
  await page.screenshot({ path: "test-results/client-pipeline-control.png", fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByRole("button", { name: "读取流程列表", exact: true }).click();
  await page.getByLabel("服务端流程").selectOption(id);
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "载入服务端流程", exact: true }).click();
  await expect(page.getByLabel("流水线名称")).toHaveValue("外部客户端设计的流程");
});

test("late layout results cannot replace edits made while calculation is in flight", async ({ page }) => {
  await page.goto("/");
  await page.route("**/studio-pipelines/v1/commands", async route => {
    if (route.request().postDataJSON().name !== "pipelines.preview_layout") return route.continue();
    const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "自动排版", exact: true }).click();
  await page.getByLabel("流水线名称").fill("计算期间的新名称");
  await expect(page.locator(".footer [role=status]")).toContainText("旧结果未应用");
  await expect(page.getByLabel("流水线名称")).toHaveValue("计算期间的新名称");
});
