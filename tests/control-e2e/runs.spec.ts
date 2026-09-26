import { expect, test } from "@playwright/test";
import { examplePipeline } from "../../packages/pipeline-model";

test("Run menu and live events observe the real control store and reconnect without duplicates", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("团队用户名").fill("owner"); await page.getByLabel("团队密码").fill("browser-fixture-owner-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("流水线名称")).toBeVisible();
  const { token } = await (await page.request.get("/studio-runs/v1/session")).json();
  const call = async (prefix: string, name: string, input: unknown) => {
    const response = await page.request.post(`${prefix}/v1/commands`, { headers: { "x-studio-control-token": token }, data: { name, input, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() } });
    expect(response.ok()).toBeTruthy(); return (await response.json()).result;
  };
  const document = examplePipeline(); document.id = `monitor-${crypto.randomUUID()}`;
  document.nodes = document.nodes.filter(node => node.type === "compute"); document.edges = [];
  document.presentation.nodes = Object.fromEntries(document.nodes.map(n => [n.id, document.presentation.nodes[n.id]]));
  await call("/studio-pipelines", "pipelines.create", { workspaceId: "local", document });
  const input = { workspaceId: "local", pipelineId: document.id, expectedGraphRevision: 1 };
  const preflight = await call("/studio-runs", "runs.preflight", input);
  const run = await call("/studio-runs", "runs.start", { ...input, expectedFingerprint: preflight.fingerprint });
  await page.getByRole("button", { name: "真实运行", exact: true }).click();
  await page.getByRole("button", { name: "刷新运行列表", exact: true }).click();
  await page.getByLabel("工作流运行").selectOption(run.id);
  await expect(page.getByLabel("运行订阅状态")).toHaveText("实时订阅中");
  await page.getByText("运行事件 · 1", { exact: true }).click();
  await expect(page.getByLabel("真实运行管理")).toContainText("运行快照已保存");
  await page.context().setOffline(true);
  await expect(page.getByLabel("运行订阅状态")).toContainText("重连", { timeout: 15000 });
  await page.context().setOffline(false);
  await expect(page.getByLabel("运行订阅状态")).toHaveText("实时订阅中", { timeout: 15000 });
  await expect(page.getByText("运行事件 · 1", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("button", { name: "运行", exact: true }).click();
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("button", { name: "核对运行状态与事件", exact: true }).click();
  await expect(page.getByText("运行状态与事件快照", { exact: true })).toBeVisible();
  await expect(page.getByLabel("真实运行管理")).toContainText(run.id);
});
