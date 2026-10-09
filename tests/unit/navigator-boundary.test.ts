import { afterEach, expect, it } from "vitest";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createControlApplication } from "../../apps/control/application";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(mode: "local" | "team" = "team") {
  const forwarded: { path: string; method: string; body: string; cookie?: string; authorization?: string }[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const data of req) chunks.push(Buffer.from(data));
    forwarded.push({ path: req.url!, method: req.method!, body: Buffer.concat(chunks).toString(), cookie: req.headers.cookie, authorization: req.headers.authorization });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ workspaceId: "local", runtimes: [], providers: [] }));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
  const stores = new SqliteStoreFactory(":memory:");
  const app = createControlApplication({ mode, stores, publicOrigins: ["http://127.0.0.1:5180"], navigatorUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}` });
  await app.ready;
  await app.team.bootstrap("owner", "owner-test-long-password");
  const owner = await app.team.authenticate((await app.team.login("owner", "owner-test-long-password")).token, "browser");
  for (const role of ["operator", "viewer"] as const) await app.team.createMember({ username: role, password: `${role}-test-long-password`, roles: [role], workspaceIds: ["local"] }, owner.actor);
  await app.team.createMember({ username: "other", password: "other-test-long-password", roles: ["admin"], workspaceIds: ["other"] }, { ...owner.actor, workspaceIds: ["local", "other"] });
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); await stores.close(); });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const requestJson = (path: string, headers: Record<string, string>, method = "GET", body?: unknown) => new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = httpRequest(url + path, { method, headers: { host: "127.0.0.1:5180", "content-type": "application/json", ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const login = async (name: string) => {
    const session = await app.team.login(name, `${name}-test-long-password`);
    return { cookie: `studio_session=${session.token}; cyrene_session=paired`, "x-studio-control-token": session.csrf };
  };
  const request = async (path: string, headers: Record<string, string>, method = "GET", body?: unknown) => (await requestJson(path, headers, method, body)).status;
  return { app, forwarded, owner, request, requestJson, login };
}

for (const mode of ["local", "team"] as const) {
  it(`rejects host-owned task fields and executor write routes before forwarding in ${mode} mode`, async () => {
    const f = await fixture(mode);
    const headers = mode === "team" ? await f.login("operator") : { "x-studio-control-token": (await f.requestJson("/studio-commands/v1/session", {})).body.token };
    for (const [field, value] of [["cwd", "C:/private"], ["agentPreset", "navigator-native-codex"], ["timeoutMs", 86400000], ["cwd", null], ["timeoutMs", 0]] as const) {
      const result = await f.requestJson("/api/v1/navigator/tasks", headers, "POST", { prompt: "inspect", [field]: value });
      expect(result).toMatchObject({ status: 403, body: { error: { code: "RESERVED_EXECUTION_FIELD" } } });
    }
    for (const [method, path] of [["PATCH", "/api/v1/workspaces/local/work/tasks/task-1"], ["POST", "/api/v1/workspaces/local/work/tasks/task-1/events"]]) {
      expect(await f.request(path, headers, method, { type: "harness.completed", status: "done" })).toBe(403);
    }
    expect(f.forwarded).toHaveLength(0);
    expect(await f.request("/api/v1/navigator/tasks", headers, "POST", { prompt: "normal task" })).toBe(200);
    expect(f.forwarded).toHaveLength(1);
  });
}

it("uses the paired Navigator configuration boundary and keeps models separate from tool permissions", async () => {
  const f = await fixture();
  const viewer = await f.login("viewer"), operator = await f.login("operator"), admin = await f.login("owner"), other = await f.login("other");
  const caps = "/api/v1/navigator/assistant/capabilities", providers = "/api/v1/navigator/assistant/providers";
  expect(await f.request(caps, viewer)).toBe(200);
  expect(f.forwarded[0]).toMatchObject({ path: "/api/v1/assistant/capabilities", cookie: "cyrene_session=paired" });
  expect(await f.request(caps, other)).toBe(403);
  expect(await f.request(providers, viewer)).toBe(403);
  expect(await f.request(providers + "/private", operator, "PUT", {})).toBe(403);
  expect(await f.request(providers + "/private", { cookie: admin.cookie }, "PUT", {})).toBe(403);
  const token = await f.app.team.issueApiToken(f.owner, ["products.admin", "products.read"]);
  expect(await f.request(providers + "/private", { authorization: `Bearer ${token.token}` }, "PUT", {})).toBe(403);
  expect(f.forwarded).toHaveLength(1);
  const config = { name: "Personal provider", protocol: "openai-completions", baseURL: "https://api.example/v1", models: [{ id: "model" }], apiKey: "fixture-write-only-key" };
  expect(await f.request(providers + "/personal", admin, "PUT", config)).toBe(200);
  expect(f.forwarded[1]).toMatchObject({ path: "/api/v1/assistant/providers/personal", method: "PUT", body: JSON.stringify(config), authorization: undefined });
  expect(await f.request(providers + "/personal", admin, "DELETE")).toBe(200);
  expect(f.forwarded[2].path).toBe("/api/v1/assistant/providers/personal");
  expect(await f.request("/api/v1/navigator/assistant/arbitrary-command", admin, "POST", {})).toBe(403);
  const before = f.forwarded.length;
  expect(await f.request("/api/v1/navigator/tasks", operator, "POST", { prompt: "inspect", execution: { runtime: "codex", permission: "full-access" } })).toBe(403);
  expect(f.forwarded).toHaveLength(before);
  const forged = { metadata: { navigator: { execution: { runtime: "codex", permission: "full-access" }, cwd: "C:/private" } } };
  expect(await f.request("/api/v1/navigator/tasks", operator, "POST", { prompt: "inspect", ...forged })).toBe(403);
  expect(await f.request("/api/v1/workspaces/local/work/tasks/task-1", operator, "PATCH", forged)).toBe(403);
  expect(f.forwarded).toHaveLength(before);
  expect(await f.request("/api/v1/navigator/tasks", operator, "POST", { prompt: "existing cloud task" })).toBe(200);
  expect(f.forwarded.at(-1)?.path).toBe("/api/v1/tasks");
});
