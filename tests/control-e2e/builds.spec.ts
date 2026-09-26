import { expect, test } from "@playwright/test";
import { menuAction } from "../e2e/ide-helpers";

test("build menu and panel share one persisted task; activation remains explicit", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("团队用户名").fill("owner"); await page.getByLabel("团队密码").fill("browser-fixture-owner-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".ide-menubar > .ide-menu > button")).toHaveText(["文件", "编辑", "视图", "构建", "运行", "工具"]);
  await menuAction(page, "构建", "刷新构建任务");
  await page.getByLabel("节点构建来源").selectOption("fixture");
  await page.getByLabel("构建源码引用").selectOption("develop");
  await menuAction(page, "构建", "预览节点镜像构建");
  const panel = page.getByRole("region", { name: "构建与节点版本" });
  await expect(panel).toContainText("a".repeat(40));
  await panel.getByRole("button", { name: "提交节点镜像构建", exact: true }).click();
  await expect(panel).toContainText("succeeded", { timeout: 15000 });
  const before = await (await page.request.get("/studio-catalog/v1/packages")).json(); expect(before.active).not.toContain("fixture@1");
  await page.getByLabel("收起底部窗口").click();
  await menuAction(page, "构建", "预览启用构建版本");
  await expect(panel).toContainText("将启用 fixture@1");
  await menuAction(page, "构建", "启用所示节点版本");
  await expect(page.locator(".footer [role=status]")).toContainText("已启用 fixture@1");
  const after = await (await page.request.get("/studio-catalog/v1/packages")).json(); expect(after.active).toContain("fixture@1");
  const session = await (await page.request.get("/studio-commands/v1/session")).json();
  expect(session.commands.map((c: any) => c.name)).toEqual(expect.arrayContaining(["builds.start", "catalog.activate", "servers.status", "runs.artifacts", "pipelines.compile"]));
  const builds = await (await page.request.post("/studio-builds/v1/commands", { headers: { "x-studio-control-token": session.token }, data: { name: "builds.list", input: { workspaceId: "local" }, requestId: crypto.randomUUID() } })).json();
  expect(builds.result.items).toHaveLength(1);
});
