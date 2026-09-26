import { menuAction } from "./ide-helpers";
import { expect, test, type Page } from "@playwright/test";
import { artifact, authSession, draft, hostStatus, ids, models, sessions, suite, version } from "../fixtures/settings";
import { examplePipeline } from "../../packages/pipeline-model";

async function fixtures(page: Page) {
  const writes: { path: string; method: string; body: any; headers: Record<string, string> }[] = [];
  let currentDraft = structuredClone(draft);
  await page.route("**/studio-api/connection", (r) => r.fulfill({ json: { configured: true, target: "http://127.0.0.1:8100" } }));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (method !== "GET") writes.push({ path, method, body: request.postData() ? request.postDataJSON() : null, headers: request.headers() });
    if (path === "/api/v1/auth/session") return route.fulfill({ json: authSession });
    if (path === "/api/v1/system/status") return route.fulfill({ json: hostStatus });
    if (path === "/api/v1/catalyst/datasets") return route.fulfill({ json: [{ id: ids.dataset, name: "Fixture dataset", state: "ACTIVE" }] });
    if (path === `/api/v1/catalyst/dataset-versions/${ids.version}`) return route.fulfill({ json: version });
    if (path === "/api/v1/reactor/model-imports") return route.fulfill({ json: models });
    if (path === "/api/v1/reactor/serving-bindings") return route.fulfill({ json: [{ bindingId: "fixture-binding" }] });
    if (path === "/api/v1/yield/training-drafts") return route.fulfill({ json: [currentDraft] });
    if (path === `/api/v1/yield/training-drafts/${ids.draft}`) {
      if (method === "PATCH") currentDraft = { ...currentDraft, configuration: request.postDataJSON() };
      return route.fulfill({ json: currentDraft });
    }
    if (path === `/api/v1/echo/evaluation-suites/${ids.suite}`) return route.fulfill({ json: suite });
    if (path === "/api/v1/echo/evaluation-suites" && method === "POST") return route.fulfill({ status: 201, json: { ...suite, ...request.postDataJSON() } });
    if (path === "/api/v1/navigator/harness/workspaces/workspace-one/sessions") return route.fulfill({ json: sessions });
    return route.fulfill({ status: 404, json: { code: "UNEXPECTED_TEST_ROUTE" } });
  });
  return writes;
}
async function connect(page: Page) {
  await page.goto("/"); await page.getByRole("button", { name: "服务连接", exact: true }).click();
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(page.getByRole("button", { name: "设置服务已连接", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置服务已连接", exact: true }).click();
}
async function select(page: Page, label: string) {
  if (!(await page.locator(".node-list").evaluate((el) => (el as HTMLDetailsElement).open))) await page.locator(".node-list summary").click();
  await page.locator(".node-list").getByRole("button", { name: new RegExp(label) }).click();
}
const panel = (page: Page) => page.getByRole("region", { name: "节点服务设置" });

test("all seven nodes use settings APIs; only explicit saves write, and never start jobs", async ({ page }) => {
  const writes = await fixtures(page), errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await connect(page);
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await panel(page).getByRole("button", { name: /Fixture LoRA draft/ }).click();
  await expect(page.getByLabel("训练轮数")).toHaveValue("2");
  await expect(page.getByLabel("LoRA Dropout")).toHaveValue("0.1");
  await page.getByLabel("训练轮数").fill("4");
  expect(writes).toHaveLength(0);
  await panel(page).getByRole("button", { name: "保存参数到 Yield" }).click();
  await expect(panel(page).getByRole("status")).toContainText("Yield 已确认保存");
  expect(writes[0].method).toBe("PATCH");
  expect(writes[0].body.parameters.epochs).toBe(4);
  expect(writes[0].body.parameters.maxSteps).toBe(20);
  expect(writes[0].body.parameters.loraDropout).toBe(0.1);
  expect(writes[0].headers["x-csrf-token"]).toBe("fixture-csrf");

  await select(page, "数据集版本");
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await expect(panel(page).getByText(/Fixture dataset/)).toBeVisible();
  await panel(page).getByLabel("数据版本 ID（留空读取数据集）").fill(ids.version);
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await expect(page.getByLabel("数据集版本引用")).toHaveValue(artifact.uri);

  await select(page, "基础模型");
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await panel(page).getByRole("button", { name: /Fixture base model/ }).click();
  await expect(page.getByLabel("模型版本引用")).toHaveValue(models[0].modelArtifact.uri);

  await select(page, "算力配置");
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await expect(panel(page).getByText(/Fixture GPU/)).toBeVisible();
  await expect(panel(page).getByRole("status")).toContainText("不代表资源已分配");

  await select(page, "质量评估");
  await panel(page).getByLabel("评估配置 ID", { exact: true }).fill(ids.suite);
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await expect(page.getByLabel("通过阈值")).toHaveValue("0.85");
  await page.getByLabel("评估集名称").fill("My new evaluation");
  await panel(page).getByRole("button", { name: "另存到 Echo" }).click();
  await expect(panel(page).getByRole("status")).toContainText("Echo 已创建评估配置");
  expect(writes[1].body.name).toBe("My new evaluation");
  expect(writes[1].headers["idempotency-key"]).toBeTruthy();

  await select(page, "推理部署");
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await panel(page).getByRole("button", { name: /fixture-binding/ }).click();
  await expect(page.getByLabel("推理服务绑定", { exact: true })).toHaveValue("fixture-binding");

  await select(page, "Agent 测试");
  await panel(page).getByLabel("Navigator 工作空间 ID").fill("workspace-one");
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await panel(page).getByRole("button", { name: /session-one/ }).click();
  await expect(panel(page).getByRole("status")).toContainText("已绑定现有会话");

  await menuAction(page, "文件", "保存草稿");
  const document = await page.evaluate(() => JSON.parse(localStorage.getItem("cyrene.studio.prototype.v1.draft")!));
  expect(document.nodes.filter((n: any) => n.settingsBinding)).toHaveLength(6);
  expect(JSON.stringify(document)).not.toContain("fixture-csrf");
  expect(JSON.stringify(document)).not.toContain("must-not-enter-pipeline");
  expect(JSON.stringify(document)).not.toContain("private-not-in-settings");
  expect(writes).toHaveLength(2);
  expect(writes.every((w) => !w.path.includes("/actions/"))).toBe(true);
  expect(errors).toEqual([]);
  await select(page, "模型微调");
  await page.locator(".inspector").evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: "test-results/studio-settings.png", fullPage: true });
});

test("an unavailable or malformed service cannot silently overwrite local parameters", async ({ page }) => {
  await fixtures(page); await connect(page);
  await page.route("**/api/v1/yield/training-drafts", (r) => r.fulfill({ status: 503, json: { code: "YIELD_OFFLINE" } }));
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await expect(panel(page).getByRole("status")).toContainText("YIELD_OFFLINE");
  await expect(page.getByLabel("训练轮数")).toHaveValue("3");
  await page.route("**/api/v1/yield/training-drafts", (r) => r.fulfill({ json: { items: [draft] } }));
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await expect(panel(page).getByRole("status")).toContainText("契约不符");
  await expect(page.getByLabel("训练轮数")).toHaveValue("3");
});

test("switching nodes ignores a late response and a missing proxy is explicit", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/v1/system/status", (r) => r.fulfill({ json: { ...hostStatus, proxyPrefixes: hostStatus.proxyPrefixes.filter((p) => !p.endsWith("/echo")) } }));
  await connect(page);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/yield/training-drafts", async (r) => { await gate; await r.fulfill({ json: [draft] }).catch(() => {}); });
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await select(page, "质量评估"); release();
  await expect(panel(page).getByText("入口未开放")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "读取服务设置" })).toBeDisabled();
  await expect(panel(page).getByText(/Fixture LoRA/)).toHaveCount(0);
  await expect(page.getByLabel("评估集名称")).toHaveValue("示例指令遵循评估");
});

test("pairing is in-memory and a started draft cannot be saved", async ({ page }) => {
  const writes = await fixtures(page);
  await page.route("**/api/v1/auth/session", (r) => r.fulfill({ json: { authenticated: false, refreshable: false, csrfToken: null } }));
  await page.route("**/api/v1/auth/pair", async (r) => {
    expect(r.request().postDataJSON()).toEqual({ pairingCode: "one-time-code" });
    await r.fulfill({ json: authSession });
  });
  await page.route("**/api/v1/yield/training-drafts", (r) => r.fulfill({ json: [{ ...draft, state: "STARTED" }] }));
  await page.goto("/"); await page.getByRole("button", { name: "服务连接", exact: true }).click();
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await page.getByLabel("一次性配对码").fill("one-time-code"); await page.getByRole("button", { name: "配对", exact: true }).click();
  await expect(page.getByRole("button", { name: "设置服务已连接", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置服务已连接", exact: true }).click();
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await panel(page).getByRole("button", { name: /Fixture LoRA/ }).click();
  await expect(panel(page).getByRole("button", { name: "保存参数到 Yield" })).toBeDisabled();
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("one-time-code");
});

test("unconfigured local bridge fails explicitly and blocks execution routes", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "服务连接", exact: true }).click();
  await page.getByRole("button", { name: "检查连接", exact: true }).click();
  await expect(page.getByRole("region", { name: "服务连接设置" }).getByRole("status")).toContainText("尚未配置 Web Host");
  const denied = await page.request.post("/api/v1/yield/training-drafts/example/actions/start");
  expect(denied.status()).toBe(403);
});

for (const change of ["binding", "parameters"] as const) test(`training save cancels when MCP changes ${change} during its preflight read`, async ({ page }) => {
  const writes = await fixtures(page); await connect(page);
  const document = examplePipeline(); document.id = `training-race-${change}-${Date.now()}`;
  await page.getByLabel("导入流程文件").setInputFiles({ name: "pipeline.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await select(page, "模型微调");
  await panel(page).getByRole("button", { name: "读取服务设置" }).click();
  await panel(page).getByRole("button", { name: /Fixture LoRA draft/ }).click();
  await page.getByRole("button", { name: "保存到服务端", exact: true }).click();
  await expect(page.locator(".footer [role=status]")).toContainText("服务端草稿已保存");

  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>(r => { release = r; }), requested = new Promise<void>(r => { arrived = r; });
  await page.route(`**/api/v1/yield/training-drafts/${ids.draft}`, async route => {
    if (route.request().method() !== "GET") return route.fallback();
    arrived(); await gate; await route.fulfill({ json: draft });
  });
  await panel(page).getByRole("button", { name: "保存参数到 Yield" }).click(); await requested;
  const { token } = await (await page.request.get("/studio-pipelines/v1/session")).json();
  const response = await page.request.post("/studio-pipelines/v1/commands", {
    headers: { "x-studio-control-token": token },
    data: { name: "pipelines.patch", requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), input: {
      workspaceId: "local", pipelineId: document.id, expectedGraphRevision: 1, expectedLayoutRevision: 1,
      edits: [{ op: "update_node", nodeId: "training", config: { epochs: 77 },
        ...(change === "binding" ? { settingsBinding: { kind: "training-draft", resourceId: "66666666-6666-4666-8666-666666666666" } } : {}),
      }],
    } },
  });
  expect(response.ok()).toBeTruthy();
  await expect(page.getByLabel("训练轮数")).toHaveValue("77", { timeout: 8000 }); release();
  await expect(panel(page).getByRole("status")).toContainText("旧操作已取消");
  expect(writes).toEqual([]);
  await expect(page.getByLabel("训练轮数")).toHaveValue("77");
});
