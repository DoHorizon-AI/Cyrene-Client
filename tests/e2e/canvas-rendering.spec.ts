import { expect, test } from "@playwright/test";

test.use({ deviceScaleFactor: 2 });

test("high-DPI canvas keeps detailed nodes and CSS-pixel interactions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("7 节点 · 9 连接")).toBeVisible();
  const canvas = page.locator(".canvas-container canvas");
  await expect.poll(() => canvas.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return Math.abs(element.width / bounds.width - 2) < 0.02 && Math.abs(element.height / bounds.height - 2) < 0.02;
  })).toBe(true);

  const detail = await canvas.evaluate(element => {
    const view = (element as HTMLCanvasElement & { data: any }).data;
    const context = view.ctx as CanvasRenderingContext2D;
    const arc = context.arc, fillText = context.fillText;
    let circles = 0;
    const labels: string[] = [];
    context.arc = function (...args) { circles++; return arc.apply(this, args); };
    context.fillText = function (text, ...args) { labels.push(text); return fillText.call(this, text, ...args); };
    try {
      view.ds.scale = 0.45;
      view.setDirty(true, true);
      view.draw(true, true);
      return { circles, labels };
    } finally {
      context.arc = arc;
      context.fillText = fillText;
    }
  });
  expect(detail.circles).toBeGreaterThan(0);
  expect(detail.labels).toContain("模型微调");
  await page.screenshot({ path: "test-results/canvas-high-dpi-zoomed-out.png" });

  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  const before = await canvas.evaluate(element => {
    const view = (element as HTMLCanvasElement & { data: any }).data;
    const node = view.graph._nodes.find((item: any) => item.properties.document.id === "training");
    const bounds = element.getBoundingClientRect();
    return {
      nodeX: node.pos[0],
      x: bounds.left + (node.pos[0] + 100 + view.ds.offset[0]) * view.ds.scale,
      y: bounds.top + (node.pos[1] - 15 + view.ds.offset[1]) * view.ds.scale,
    };
  });
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 40, before.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => canvas.evaluate(element => {
    const view = (element as HTMLCanvasElement & { data: any }).data;
    return view.graph._nodes.find((item: any) => item.properties.document.id === "training").pos[0];
  })).toBeGreaterThan(before.nodeX + 20);
});
