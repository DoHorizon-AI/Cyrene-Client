import { expect, test } from "@playwright/test";

test.use({ deviceScaleFactor: 2 });

test("high-DPI canvas keeps detailed nodes and CSS-pixel interactions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("7 节点 · 9 连接")).toBeVisible();
  const canvas = page.locator(".canvas-container canvas");
  await expect.poll(() => canvas.evaluate(element => {
    const backingCanvas = element as HTMLCanvasElement;
    const bounds = element.getBoundingClientRect();
    return Math.abs(backingCanvas.width / bounds.width - 2) < 0.02 && Math.abs(backingCanvas.height / bounds.height - 2) < 0.02;
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
  const sockets = await canvas.evaluate(element => {
    const view = (element as HTMLCanvasElement & { data: any }).data;
    const node = view.graph._nodes.find((item: any) => item.properties.document.id === "training");
    const input = node.getConnectionPos(true, 0);
    const nextInput = node.getConnectionPos(true, 1);
    const output = node.getConnectionPos(false, 0);
    return { inputX: input[0], outputX: output[0], left: node.pos[0], right: node.pos[0] + node.size[0] + 1,
      inputRowSpacing: nextInput[1] - input[1],
      inputColor: node.inputs[0].color_on, outputColor: node.outputs[0].color_on,
      datasetLinkColor: view.constructor.link_type_colors.dataset, modelLinkColor: view.constructor.link_type_colors.model };
  });
  expect(sockets.inputX).toBe(sockets.left);
  expect(sockets.outputX).toBe(sockets.right);
  expect(sockets.inputRowSpacing).toBe(24);
  expect(sockets.inputColor).toBe(sockets.datasetLinkColor);
  expect(sockets.outputColor).toBe(sockets.modelLinkColor);
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
  await page.screenshot({ path: "test-results/canvas-selected.png" });
});

test("dragged links keep their socket color and have no midpoint action", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator(".canvas-container canvas");
  await expect(canvas).toBeVisible();
  const start = await canvas.evaluate(element => {
    const view = (element as HTMLCanvasElement & { data: any }).data;
    const node = view.graph._nodes.find((item: any) => item.properties.document.id === "compute");
    const [x, y] = node.getConnectionPos(false, 0);
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left + (x + view.ds.offset[0]) * view.ds.scale,
      y: bounds.top + (y + view.ds.offset[1]) * view.ds.scale };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 115, start.y + 100, { steps: 5 });
  const preview = await canvas.evaluate(element => {
    const view = (element as HTMLCanvasElement & { data: any }).data;
    const context = view.ctx as CanvasRenderingContext2D;
    const stroke = context.stroke;
    const colors: string[] = [];
    context.stroke = function (path?: Path2D) {
      colors.push(String(this.strokeStyle));
      if (path) stroke.call(this, path);
      else (stroke as () => void).call(this);
    };
    try { view.setDirty(true, true); view.draw(true, true); }
    finally { context.stroke = stroke; }
    return { type: view.connecting_output?.type, colors, expected: view.constructor.link_type_colors.compute };
  });
  expect(preview.type).toBe("compute");
  expect(preview.colors).toContain(preview.expected);
  await page.screenshot({ path: "test-results/canvas-dragged-link.png" });
  await page.mouse.up();

  const midpoint = await canvas.evaluate(element => {
    const view = (element as HTMLCanvasElement & { data: any }).data;
    const link = Object.values(view.graph.links).find((item: any) => item._pos) as any;
    const bounds = element.getBoundingClientRect();
    (window as any).__linkMenuCalls = 0;
    view.showLinkMenu = () => { (window as any).__linkMenuCalls++; return false; };
    return { x: bounds.left + (link._pos[0] + view.ds.offset[0]) * view.ds.scale,
      y: bounds.top + (link._pos[1] + view.ds.offset[1]) * view.ds.scale,
      edgeCount: Object.keys(view.graph.links).length };
  });
  await page.mouse.move(midpoint.x, midpoint.y);
  await page.mouse.click(midpoint.x, midpoint.y);
  const afterClick = await canvas.evaluate(element => {
    const view = (element as HTMLCanvasElement & { data: any }).data;
    return { menuCalls: (window as any).__linkMenuCalls,
      hover: view.over_link_center, edgeCount: Object.keys(view.graph.links).length };
  });
  expect(afterClick.menuCalls).toBe(0);
  expect(afterClick.hover).toBeNull();
  expect(afterClick.edgeCount).toBe(midpoint.edgeCount);
});
