import { expect, test } from "@playwright/test";
import { menuAction } from "./ide-helpers";

test("tool windows retain edits, resize, collapse and restore layout preferences", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("训练轮数").fill("8");
  await page.getByRole("button", { name: "平台 MCP", exact: true }).click();
  await page.getByLabel("任务草稿").fill("保留训练节点，增加第二组评估。");
  await page.getByRole("button", { name: "节点信息", exact: true }).click();
  await expect(page.getByLabel("训练轮数")).toHaveValue("8");
  const left = page.getByRole("separator", { name: "调整左侧窗口宽度" });
  await left.focus(); await left.press("ArrowRight");
  await expect(left).toHaveAttribute("aria-valuenow", "256");
  const right = page.getByRole("separator", { name: "调整右侧窗口宽度" });
  const box = (await right.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 40); await page.mouse.down();
  await page.mouse.move(box.x - 38, box.y + 40, { steps: 4 }); await page.mouse.up();
  await expect(right).toHaveAttribute("aria-valuenow", "350");
  await page.getByRole("button", { name: "收起底部窗口" }).click();
  await expect(page.getByRole("region", { name: "底部工具窗口" })).toBeHidden();
  await page.keyboard.press("Control+s");
  await expect(page.locator(".footer [role=status]")).toContainText("草稿已保存");
  await page.getByRole("button", { name: "平台 MCP", exact: true }).click();
  await expect(page.getByLabel("任务草稿")).toHaveValue("保留训练节点，增加第二组评估。");
  await page.reload();
  await expect(left).toHaveAttribute("aria-valuenow", "256");
  await expect(right).toHaveAttribute("aria-valuenow", "350");
  await expect(page.getByRole("button", { name: "平台 MCP", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "底部工具窗口" })).toBeHidden();
  await page.getByRole("button", { name: "日志", exact: true }).click();
  await expect(page.locator(".ide-event-log")).toBeVisible();
  await menuAction(page, "视图", "恢复默认布局");
  await expect(left).toHaveAttribute("aria-valuenow", "240");
  await expect(right).toHaveAttribute("aria-valuenow", "310");
});

test("menus support keyboard and file previews do not mutate the graph", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  const fileMenu = page.getByRole("button", { name: "文件", exact: true });
  await fileMenu.focus(); await fileMenu.press("ArrowDown");
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(fileMenu).toBeFocused();
  await expect(fileMenu).toHaveAttribute("aria-expanded", "false");
  await page.locator(".node-list summary").click();
  await page.locator(".node-list").getByRole("button", { name: /模型微调/ }).click();
  await page.getByRole("button", { name: "项目文件", exact: true }).click();
  await page.getByLabel("选择本地文件", { exact: true }).setInputFiles({ name: "training-notes.md", mimeType: "text/markdown", buffer: Buffer.from("# 训练记录\n学习率：0.0002") });
  await page.getByRole("button", { name: "training-notes.md", exact: true }).click();
  const preview = page.getByLabel("文件内容预览");
  await expect(preview).toContainText("学习率：0.0002");
  await preview.focus(); await preview.press("Delete");
  await expect(page.getByText("7 节点 · 9 连接")).toBeVisible();
  await page.getByRole("button", { name: "页面插件", exact: true }).click();
  await page.getByRole("button", { name: /流程 JSON 查看当前文档/ }).click();
  await expect(preview).toContainText('"schemaVersion"');
  await expect(page.getByRole("tab", { name: "JSON", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /\.pipeline/ }).click();
  await page.getByRole("button", { name: "节点信息", exact: true }).click();
  await page.locator(".node-list").getByRole("button", { name: /模型微调/ }).click();
  await page.locator("canvas").focus(); await page.keyboard.press("Delete");
  await expect(page.getByText("6 节点 · 4 连接")).toBeVisible();
  expect(errors).toEqual([]);
});

test("MCP panel reads actual tools and copies task references without a model request", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const requests: string[] = [];
  page.on("request", r => { if (r.method() !== "GET") requests.push(r.url()); });
  await page.goto("/");
  await page.getByRole("button", { name: "平台 MCP", exact: true }).click();
  await expect(page.getByText("内置对话模型尚未配置。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "查看可用工具" }).click();
  await expect(page.locator(".ide-tool-list code")).toHaveCount(11);
  await expect(page.locator(".ide-tool-list")).toContainText("pipelines.patch");
  await page.getByLabel("任务草稿").fill("增加评估节点，保留已锁定的位置。");
  await page.getByRole("button", { name: /复制任务与上下文/ }).click();
  await expect(page.locator(".footer [role=status]")).toContainText("上下文已复制");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("instruction-tuning"); expect(copied).toContain("training"); expect(copied).toContain("增加评估节点");
  expect(requests).toEqual([]);
  await page.screenshot({ path: "test-results/studio-ide-mcp.png", fullPage: true });
});

test("narrow windows avoid overlapping docks and horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.locator(".ide-left-dock")).toBeHidden();
  await page.getByRole("button", { name: "项目文件", exact: true }).click();
  await expect(page.locator(".ide-left-dock")).toBeVisible();
  await expect(page.locator(".ide-right-dock")).toBeHidden();
  await page.getByRole("button", { name: "平台 MCP", exact: true }).click();
  await expect(page.locator(".ide-left-dock")).toBeHidden();
  await expect(page.locator(".ide-right-dock")).toBeVisible();
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "test-results/studio-ide-narrow.png", fullPage: true });
});
