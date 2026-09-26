import { expect, test } from "@playwright/test";
import { examplePipeline } from "../../packages/pipeline-model";

for (const overlap of [false, true]) {
  test(`recovered server baseline ${overlap ? "rejects overlapping changes" : "merges independent changes"}`, async ({ page }) => {
    const document = examplePipeline(); document.id = `recovery-base-${crypto.randomUUID()}`; document.name = `基线恢复-${overlap}`;
    await page.goto("/");
    await page.getByLabel("导入流程文件").setInputFiles({ name: "pipeline.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
    await page.getByRole("button", { name: "保存到服务端", exact: true }).click();
    await expect(page.locator(".footer [role=status]")).toContainText("服务端草稿已保存");
    await page.locator(".node-list summary").click();
    await page.locator(".node-list").getByRole("button", { name: /模型微调/ }).click();
    await page.getByLabel("训练轮数", { exact: true }).fill("9");
    await expect(page.getByLabel("编辑恢复状态")).toHaveText("编辑可恢复");
    const { token } = await (await page.request.get("/studio-pipelines/v1/session")).json();
    const call = async (name: string, input: object) => {
      const response = await page.request.post("/studio-pipelines/v1/commands", { headers: { "x-studio-control-token": token }, data: { name, input, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() } });
      expect(response.ok()).toBeTruthy(); return (await response.json()).result;
    };
    await call("pipelines.patch", { workspaceId: "local", pipelineId: document.id, expectedGraphRevision: 1, expectedLayoutRevision: 1, edits: [overlap ? { op: "update_node", nodeId: "training", config: { epochs: 8 } } : { op: "update_node", nodeId: "model", label: "外部客户端的模型节点" }] });
    page.on("dialog", dialog => dialog.accept()); await page.reload();
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByText("恢复未保存编辑", { exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`${document.name} ·`) }).first().click();
    await expect(page.getByLabel("训练轮数", { exact: true })).toHaveValue("9");
    await page.getByRole("button", { name: "保存到服务端", exact: true }).click();
    await expect(page.locator(".footer [role=status]")).toContainText(overlap ? "版本差异" : "服务端草稿已保存");
    const record = await call("pipelines.get", { workspaceId: "local", pipelineId: document.id });
    expect(record.document.nodes.find((n: any) => n.id === "training").config.epochs).toBe(overlap ? 8 : 9);
    await expect(page.getByLabel("训练轮数", { exact: true })).toHaveValue("9");
    if (!overlap) expect(record.document.nodes.find((n: any) => n.id === "model").label).toBe("外部客户端的模型节点");
  });
}

test("refresh restores unsaved edits and their undo history", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("流水线名称").fill("可恢复的未保存编辑");
  await page.getByLabel("训练轮数", { exact: true }).fill("9");
  await expect(page.getByLabel("编辑恢复状态")).toHaveText("编辑可恢复");
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByText("恢复未保存编辑", { exact: true }).click();
  await page.getByRole("button", { name: /可恢复的未保存编辑 ·/ }).first().click();
  await expect(page.getByLabel("流水线名称")).toHaveValue("可恢复的未保存编辑");
  await expect(page.getByLabel("训练轮数", { exact: true })).toHaveValue("9");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "撤销本地修改", exact: true }).click();
  await expect(page.getByLabel("训练轮数", { exact: true })).not.toHaveValue("9");
});

test("recovery preserves incomplete configuration instead of silently replacing it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("流水线名称").fill("未完成的参数");
  await page.getByLabel("训练轮数", { exact: true }).fill("");
  await expect(page.getByLabel("编辑恢复状态")).toHaveText("编辑可恢复");
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.getByText("恢复未保存编辑", { exact: true }).click();
  await page.getByRole("button", { name: /未完成的参数 ·/ }).first().click();
  await expect(page.getByLabel("训练轮数", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("流水线名称")).toHaveValue("未完成的参数");
});
