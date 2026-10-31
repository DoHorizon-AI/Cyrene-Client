import { expect, test } from "@playwright/test";
import { menuAction } from "../e2e/ide-helpers";

test("manual MCP writes use the shared pipeline service and dotted display titles", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("团队用户名").fill("owner");
  await page.getByLabel("团队密码").fill("browser-fixture-owner-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await menuAction(page, "工具", "MCP 工具调试");
  const panel = page.getByRole("region", { name: "MCP 工作台" });
  await panel.getByRole("button", { name: "连接 MCP", exact: true }).click();
  await expect(panel.getByRole("button", { name: "模型提议调试", exact: true })).toHaveCount(0);
  await panel.getByLabel("MCP 工具", { exact: true }).selectOption("pipelines_create");
  await expect(panel).toContainText("pipelines.create");
  const { token } = await (await page.request.get("/studio-team/v1/session")).json();
  const saved = async () => {
    const response = await page.request.post("/studio-pipelines/v1/commands", { headers: { "x-studio-control-token": token }, data: { name: "pipelines.list", input: { workspaceId: "local" }, requestId: crypto.randomUUID() } });
    return (await response.json()).result.items.some((p: { id: string }) => p.id === "manual-fixture");
  };
  const args = { workspaceId: "local", document: { schemaVersion: "cyrene.pipeline.prototype.v1", id: "manual-fixture", name: "Manual MCP draft", nodes: [], edges: [], presentation: { nodes: {} } }, idempotencyKey: "manual-fixture" };
  await panel.getByLabel("调用参数 JSON").fill(JSON.stringify(args));
  expect(await saved()).toBe(false);
  await panel.getByRole("button", { name: "确认执行写操作", exact: true }).click();
  await expect(panel.getByLabel("MCP 调用结果")).toContainText('"manual-fixture"');
  expect(await saved()).toBe(true);
  await panel.getByRole("button", { name: "确认执行写操作", exact: true }).click();
  await expect(panel.getByLabel("MCP 调用结果")).toContainText('"graphRevision": 1');
  await page.getByLabel("语言", { exact: true }).selectOption("en-US");
  await expect(page.getByRole("region", { name: "MCP workbench" })).toBeVisible();
});

test("workbench uses real MCP to create a diagnostic run and Navigator observes it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("团队用户名").fill("owner"); await page.getByLabel("团队密码").fill("browser-fixture-owner-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("流水线名称")).toBeVisible();
  const initialName = await page.getByLabel("流水线名称").inputValue();
  await menuAction(page, "工具", "MCP 工具调试");
  const panel = page.getByRole("region", { name: "MCP 工作台" });
  await panel.getByRole("button", { name: "连接 MCP", exact: true }).click();
  await expect(panel).toContainText("Streamable HTTP");
  await panel.getByRole("button", { name: "工具调试", exact: true }).click();
  await panel.getByLabel("MCP 工具", { exact: true }).selectOption("monitoring_snapshot");
  await panel.getByRole("button", { name: "调用工具", exact: true }).click();
  await expect(panel.getByLabel("MCP 调用结果")).toContainText('"workspaceId": "local"');
  await panel.getByRole("button", { name: "接入与测试", exact: true }).click();
  await panel.getByRole("button", { name: "创建并运行本地诊断", exact: true }).click();
  const monitor = page.getByRole("region", { name: "Navigator 运行监控" });
  await expect(monitor).toBeVisible();
  await monitor.getByRole("tab", { name: /本地诊断|local-diagnostic/ }).click();
  await expect(monitor).toContainText("本地校验");
  await expect(monitor).toContainText("运行中", { timeout: 15000 });
  await monitor.getByRole("button", { name: /本地校验.*运行中/ }).click();
  await expect(monitor).toContainText("Local diagnostic (no GPU)", { timeout: 15000 });
  await expect(page.getByLabel("流水线名称")).toHaveValue(initialName);
  await page.screenshot({ path: "test-results/mcp-live-diagnostic.png", fullPage: true });
});
