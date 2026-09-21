import { menuAction } from "./ide-helpers";
import { expect, test, type Page } from "@playwright/test";

// Inspect the canvas instance attached by LiteGraph itself; no test-only app API.
async function canvasNode(page: Page, id: string, part: "title" | "input" | "output" = "title", slot = 0) {
  return page.locator("canvas").evaluate((el, args) => {
    const canvas = el as HTMLCanvasElement & { data: any };
    const view = canvas.data, node = view.graph._nodes.find((n: any) => n.properties.document.id === args.id);
    const point = args.part === "title" ? [node.pos[0] + 100, node.pos[1] - 15] : node.getConnectionPos(args.part === "input", args.slot);
    const bounds = el.getBoundingClientRect();
    return { x: bounds.left + (point[0] + view.ds.offset[0]) * view.ds.scale, y: bounds.top + (point[1] + view.ds.offset[1]) * view.ds.scale };
  }, { id, part, slot });
}

test("editing, persistence, typed connections and a local-only preview", async ({ page }) => {
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (new URL(r.url()).hostname !== "127.0.0.1") external.push(r.url()); });
  await page.goto("/");
  await expect(page.getByText("结构检查通过")).toBeVisible();
  await expect(page.getByText("7 节点 · 9 连接")).toBeVisible();
  await page.getByLabel("流水线名称").fill("我的训练流程");
  await page.getByLabel("训练轮数").fill("5");
  await menuAction(page, "文件", "保存草稿");
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cyrene.studio.prototype.v1.draft")!));
  expect(saved.nodes.find((n: any) => n.type === "training").config.epochs).toBe(5);
  expect(saved.name).toBe("我的训练流程");
  expect(saved.last_node_id).toBeUndefined();

  const title = await canvasNode(page, "training");
  await page.mouse.move(title.x, title.y); await page.mouse.down(); await page.mouse.move(title.x + 40, title.y + 30, { steps: 8 }); await page.mouse.up();
  await menuAction(page, "文件", "保存草稿");
  const moved = await page.evaluate(() => JSON.parse(localStorage.getItem("cyrene.studio.prototype.v1.draft")!).presentation.nodes.training);
  expect(moved.x).toBeGreaterThan(380);
  await page.reload();
  await menuAction(page, "文件", "载入草稿");
  await page.locator(".node-list summary").click();
  await page.locator(".node-list").getByRole("button", { name: /模型微调/ }).click();
  await expect(page.getByLabel("训练轮数")).toHaveValue("5");
  await page.getByRole("button", { name: "适应画布", exact: true }).click();

  // An incompatible model -> dataset connection cannot replace a typed input.
  const source = await canvasNode(page, "model", "output", 0), incompatible = await canvasNode(page, "training", "input", 0);
  await page.mouse.move(source.x, source.y); await page.mouse.down(); await page.mouse.move(incompatible.x, incompatible.y, { steps: 8 }); await page.mouse.up();
  await expect(page.getByText("结构检查通过")).toBeVisible();

  await page.getByRole("button", { name: "本地预演" }).click();
  await expect(page.getByText("已预演 7 / 7 步")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "添加基础模型", exact: true }).click();
  await expect(page.getByText("8 节点 · 9 连接")).toBeVisible();
  await page.getByLabel("节点名称").fill("额外模型");
  await page.getByRole("button", { name: "删除此节点" }).click();
  await expect(page.getByText("7 节点 · 9 连接")).toBeVisible();
  expect(errors).toEqual([]); expect(external).toEqual([]);
  await page.getByRole("button", { name: /流程检查/ }).click();
  await page.locator(".node-list").getByRole("button", { name: /模型微调/ }).click();
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await page.screenshot({ path: "test-results/studio-desktop.png", fullPage: true });
});

test("invalid import preserves current work; a valid export can be imported", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("导入流程文件");
  await input.setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"schemaVersion":"cyrene.pipeline.v999"}') });
  await expect(page.getByRole("status")).toContainText("操作未完成");
  await expect(page.getByText("7 节点 · 9 连接")).toBeVisible();
  const download = page.waitForEvent("download");
  await menuAction(page, "文件", "导出 JSON");
  const file = await download; const path = await file.path();
  await input.setInputFiles(path!);
  await expect(page.getByRole("status")).toContainText("已导入流程");
  await expect(page.getByText("结构检查通过")).toBeVisible();
});

test("deleting a prerequisite blocks preview, and stop cancels the timer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "本地预演" }).click();
  await page.getByRole("button", { name: "停止预演" }).click();
  const before = await page.locator(".preview-heading").innerText();
  await page.waitForTimeout(700);
  expect(await page.locator(".preview-heading").innerText()).toBe(before);
  await page.locator(".node-list summary").click();
  await page.locator(".node-list").getByRole("button", { name: /数据集版本/ }).click();
  await page.getByRole("button", { name: "删除此节点" }).click();
  await page.getByRole("button", { name: "本地预演" }).click();
  await expect(page.getByRole("status")).toContainText("修正后可预演");
  await expect(page.getByRole("button", { name: /缺少「训练数据」/ })).toBeVisible();
});

test("narrow viewport keeps document controls accessible", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 1000 }); await page.goto("/");
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await expect(page.getByRole("button", { name: "导出 JSON", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/studio-narrow.png", fullPage: true });
});

test("a newly added dataset can reconnect required ports through pointer interaction", async ({ page }) => {
  await page.goto("/");
  await page.locator(".node-list summary").click();
  await page.locator(".node-list").getByRole("button", { name: /数据集版本/ }).click();
  await page.getByRole("button", { name: "删除此节点" }).click();
  await page.getByRole("button", { name: "添加数据集版本", exact: true }).click();
  const id = await page.locator("canvas").evaluate((el) => (el as HTMLCanvasElement & { data: any }).data.graph._nodes.find((n: any) => n.properties.document.type === "dataset").properties.document.id);
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  for (const [targetId, slot] of [["training", 0], ["evaluation", 1]] as const) {
    const source = await canvasNode(page, id, "output"), target = await canvasNode(page, targetId, "input", slot);
    await page.mouse.move(source.x, source.y); await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 }); await page.mouse.up();
  }
  await expect(page.getByText("7 节点 · 9 连接")).toBeVisible();
  await expect(page.getByText("结构检查通过")).toBeVisible();
  const before = await page.locator("canvas").evaluate((el) => (el as HTMLCanvasElement & { data: any }).data.ds.scale);
  await page.locator("canvas").hover(); await page.mouse.wheel(0, -200);
  await expect.poll(() => page.locator("canvas").evaluate((el) => (el as HTMLCanvasElement & { data: any }).data.ds.scale)).toBeGreaterThan(before);
});
