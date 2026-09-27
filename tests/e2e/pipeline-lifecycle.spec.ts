import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const [command, button] of [
  ["pipelines.create", "保存到服务端"],
  ["pipelines.preview_layout", "自动排版"],
  ["pipelines.list", "读取流程列表"],
]) test(`${command} ignores its result after the workbench unmounts`, async ({ page }) => {
  const entry = `/@fs/${resolve("tests/fixtures/pipeline-lifecycle.tsx").replaceAll("\\", "/")}`;
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  let arrived!: () => void, release!: () => void;
  const requested = new Promise<void>(r => { arrived = r; }), gate = new Promise<void>(r => { release = r; });
  await page.route("**/studio-pipelines/v1/commands", async route => {
    expect(route.request().postDataJSON().name).toBe(command);
    const response = await route.fetch(); arrived(); await gate; await route.fulfill({ response });
  });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: button, exact: true }).click(); await requested;
  await page.getByRole("button", { name: "关闭工作台", exact: true }).click(); release();
  await page.waitForFunction(() => window.pipelineLifecycle.completed === 1);
  expect(await page.evaluate(() => window.pipelineLifecycle.callbacks)).toEqual([]);
  expect(errors).toEqual([]);
});
