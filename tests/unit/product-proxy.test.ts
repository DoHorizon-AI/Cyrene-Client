import { afterEach, expect, it } from "vitest";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import { createControlApplication } from "../../apps/control/application";
import { productPermission } from "../../tooling/product-proxy";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const received: { url: string; body: string; authorization?: string; cookie?: string }[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const part of req) chunks.push(part);
    received.push({ url: req.url!, body: Buffer.concat(chunks).toString(), authorization: req.headers.authorization, cookie: req.headers.cookie });
    if (req.url?.endsWith("events/stream")) {
      res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: first\n\n");
      const timer = setTimeout(() => res.end("data: second\n\n"), 5000); res.on("close", () => clearTimeout(timer)); return;
    }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
  const stores = new SqliteStoreFactory(":memory:");
  const app = createControlApplication({ stores, mode: "team", publicOrigins: ["http://127.0.0.1:5180"], navigatorUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}` });
  await app.ready; await app.team.bootstrap("owner", "test-owner-long-password");
  const ownerSession = await app.team.login("owner", "test-owner-long-password"), owner = await app.team.authenticate(ownerSession.token, "browser");
  for (const role of ["viewer", "editor", "operator"] as const) await app.team.createMember({ username: role, password: `test-${role}-long-password`, workspaceIds: ["local"], roles: [role] }, owner.actor);
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); await stores.close(); });
  const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const request = (path: string, headers: Record<string, string>, method = "GET", body?: string) => new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = httpRequest(origin + path, { method, headers: { host: "127.0.0.1:5180", ...headers } }, res => {
      const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => resolve({ status: res.statusCode!, text: Buffer.concat(chunks).toString() }));
    }); req.on("error", reject); req.end(body);
  });
  const login = async (role: "viewer" | "editor" | "operator") => {
    const session = await app.team.login(role, `test-${role}-long-password`);
    return { cookie: `studio_session=${session.token}; product_session=upstream-only`, "x-studio-control-token": session.csrf };
  };
  return { app, received, request, login, origin };
}
it("rejects privilege and CSRF violations before forwarding, preserves raw uploads and isolates gateway credentials", async () => {
  const f = await fixture(), viewer = await f.login("viewer"), editor = await f.login("editor"), operator = await f.login("operator");
  expect((await f.request("/api/v1/yield/training-drafts/x/actions/start", viewer, "POST", "{}")).status).toBe(403);
  expect((await f.request("/api/v1/credentials", viewer)).status).toBe(403);
  expect((await f.request("/api/v1/yield/training-drafts/x/actions/start", { cookie: operator.cookie }, "POST", "{}")).status).toBe(403);
  expect((await f.request("/api/v1/yield/unknown", operator)).status).toBe(403);
  expect(f.received).toHaveLength(0);
  const data = '{"instruction":"中文样本"}\n';
  expect((await f.request("/api/v1/catalyst/datasets/data/preparations?name=sample&filename=data.jsonl", { ...editor, "content-type": "application/x-ndjson" }, "POST", data)).status).toBe(200);
  expect(f.received[0].body).toBe(data);
  expect(f.received[0].cookie).toBe("product_session=upstream-only");
  expect((await f.request("/api/proxy/exchange-gateway/v1/chat/completions", { ...operator, "content-type": "application/json", "x-product-authorization": "Bearer gateway-secret" }, "POST", '{"stream":true}')).status).toBe(200);
  expect(f.received[1].authorization).toBe("Bearer gateway-secret");
  expect((await f.request("/api/v1/yield/training-drafts/x/actions/start", editor, "POST", "{}")).status).toBe(403);
  expect(f.received).toHaveLength(2);
  expect((await f.request("/api/v1/navigator/harness/workspaces/other/sessions", viewer)).status).toBe(403);
  expect((await f.request("/api/v1/navigator/harness/workspaces/other:tenant/sessions", viewer)).status).toBe(403);
  expect(f.received).toHaveLength(2);
  expect((await f.request("/api/v1/auth/pair", { ...viewer, "content-type": "application/json" }, "POST", '{"code":"one-time-code"}')).status).toBe(200);
  expect(f.received[2].url).toBe("/api/v1/auth/pair");
});
it("forwards the first SSE event before upstream completion and closes on unsubscribe", async () => {
  const f = await fixture(), headers = await f.login("viewer");
  await new Promise<void>((resolve, reject) => {
    const req = httpRequest(`${f.origin}/api/v1/yield/training-runs/job/events/stream`, { headers: { host: "127.0.0.1:5180", ...headers } }, res => {
      expect(res.statusCode).toBe(200);
      res.once("data", chunk => { try { expect(String(chunk)).toContain("data: first"); res.destroy(); clearTimeout(deadline); resolve(); } catch (e) { reject(e); } });
    });
    const deadline = setTimeout(() => { req.destroy(); reject(new Error("Proxy buffered the stream")); }, 2000);
    req.on("error", error => { clearTimeout(deadline); reject(error); }); req.end();
  });
});

it("allows only scoped Echo trial routes and carries the bounded JSONL upload", async () => {
  const f = await fixture(), viewer = await f.login("viewer"), editor = await f.login("editor"), operator = await f.login("operator");
  expect((await f.request("/api/v1/echo/evaluation-suites", editor, "POST", "{}")).status).toBe(200);
  expect((await f.request("/api/v1/echo/evaluation-suites", viewer, "POST", "{}")).status).toBe(403);
  const jsonl = "x".repeat(1_100_000);
  expect((await f.request("/api/v1/echo/api/v1/session-artifacts", { ...editor, "content-type": "application/jsonl" }, "POST", jsonl)).status).toBe(200);
  expect(f.received[1]?.body).toBe(jsonl);
  expect((await f.request("/api/v1/echo/api/v1/evaluation-inputs/input-1/actions/evaluate", viewer, "POST", "{}")).status).toBe(403);
  expect((await f.request("/api/v1/echo/api/v1/evaluation-inputs/input-1/actions/evaluate", operator, "POST", "{}")).status).toBe(200);
  expect((await f.request("/api/v1/echo/api/v1/evaluation-results/result-1/export", viewer)).status).toBe(200);
  expect(f.received.map(entry => entry.url)).toEqual([
    "/api/v1/echo/evaluation-suites",
    "/api/v1/echo/api/v1/session-artifacts",
    "/api/v1/echo/api/v1/evaluation-inputs/input-1/actions/evaluate",
    "/api/v1/echo/api/v1/evaluation-results/result-1/export",
  ]);
});

it("forwards a multipart Catalyst batch larger than the single-source cap", async () => {
  const f = await fixture(), editor = await f.login("editor");
  const boundary = "----catalyst-v02-boundary";
  const fileBytes = "x".repeat(33 * 1024 * 1024);
  const multipart = `--${boundary}\r\nContent-Disposition: form-data; name=\"files[]\"; filename=\"large.pdf\"\r\nContent-Type: application/pdf\r\n\r\n${fileBytes}\r\n--${boundary}--\r\n`;

  const result = await f.request(
    "/api/v1/catalyst/api/v1/datasets/ds-1/sources/batch",
    { ...editor, "content-type": `multipart/form-data; boundary=${boundary}` },
    "POST",
    multipart,
  );

  expect(result.status).toBe(200);
  expect(f.received).toHaveLength(1);
  expect(f.received[0]?.url).toBe("/api/v1/catalyst/api/v1/datasets/ds-1/sources/batch");
  expect(Buffer.byteLength(f.received[0]?.body ?? "")).toBe(Buffer.byteLength(multipart));
  expect(f.received[0]?.body.startsWith(`--${boundary}\r\n`)).toBe(true);
  expect(f.received[0]?.body.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
});

it("allowlists the Catalyst trial collection and encoded opaque block identifiers", () => {
  expect(productPermission("GET", "/api/v1/catalyst/api/v1/datasets")).toBe("products.read");
  expect(productPermission("GET", "/api/v1/catalyst/api/v1/datasets/ds-1/processing-runs")).toBe("products.read");
  expect(productPermission("POST", "/api/v1/catalyst/api/v1/content-revisions/rev-1/blocks/block%3A4/edits")).toBe("products.write");
  expect(productPermission("POST", "/api/v1/catalyst/api/v1/datasets/ds-1/sources/batch")).toBe("products.write");
  expect(productPermission("GET", "/api/v1/catalyst/api/v1/datasets/ds-1/source-parse-reports")).toBe("products.read");
  expect(productPermission("GET", "/api/v1/catalyst/api/v1/datasets/ds-1/review-queue")).toBe("products.read");
  expect(productPermission("POST", "/api/v1/catalyst/api/v1/review-items/review%3A1/resolve")).toBe("products.operate");
  expect(productPermission("DELETE", "/api/v1/catalyst/api/v1/datasets/ds-1/sources")).toBeNull();
});
