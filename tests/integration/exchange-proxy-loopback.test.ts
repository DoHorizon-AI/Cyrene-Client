// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 exchange-proxy-loopback.test.ts                                  │
// │  Module: tests/integration                                           │
// │  Role: Exercise the real Control and Navigator Web Host HTTP path     │
// │        against a local simulated Exchange endpoint.                  │
// │                                                                      │
// │  模块职责：使用本地模拟 Exchange 验证真实 Control/Web Host HTTP 路径。 │
// │  · 只使用合成 bearer 与假服务，不访问租户或外部服务                  │
// │  · 验证授权范围、SSE、feed、续期 GET 与最终身份 header                 │
// └─────────────────────────────────────────────────────────────────────┘

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import { createControlApplication } from "../../apps/control/application";

const navigatorRoot = process.env.CYRENE_NAVIGATOR_ROOT;
const navigatorPython = process.env.CYRENE_NAVIGATOR_PYTHON;
const navigatorSourceCommit = "e90288c8a4ecbcb3711d554366e7ac5227e62397";
const enabled = !!navigatorRoot && !!navigatorPython;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe.skipIf(!enabled)("SIMULATED Control → Navigator Web Host → Exchange loopback", () => {
  it("relays feed, SSE, and renewal GET with only the explicit first-party bearer", async () => {
    const sourceCommit = execFileSync("git", ["-C", navigatorRoot!, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    expect(sourceCommit).toBe(navigatorSourceCommit);
    const renewalSessionId = "00000000-0000-4000-8000-000000000001";
    const records: { method: string; path: string; authorization?: string; workspaceId?: string; dedicatedAuthorization?: string; cookie?: string; accept?: string; lastEventId?: string }[] = [];
    const fakeExchange = createHttpServer((req, res) => {
      const record = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        authorization: req.headers.authorization,
        workspaceId: req.headers["x-cyrene-workspace-id"] as string | undefined,
        dedicatedAuthorization: req.headers["x-cyrene-product-authorization"] as string | undefined,
        cookie: req.headers.cookie,
        accept: req.headers.accept,
        lastEventId: req.headers["last-event-id"] as string | undefined,
      };
      records.push(record);
      if (record.authorization !== "Bearer synthetic-platform-first-party-token" || record.workspaceId !== "exchange-workspace-1"
        || record.dedicatedAuthorization || record.cookie) {
        res.writeHead(401, { "content-type": "application/problem+json" });
        res.end(JSON.stringify({ code: "SIMULATED_EXCHANGE_AUTH_CONTEXT_INVALID" }));
        return;
      }
      if (record.path === "/api/v1/integrations/connections" || record.path === "/api/v1/integrations/notifications?after=4") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(record.path.endsWith("connections") ? "[]" : JSON.stringify({ notifications: [], nextSequence: 4 }));
        return;
      }
      if (record.path === "/api/v1/integrations/notifications/events") {
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
        res.end('id: 7\ndata: {"id":"notice-7","sequence":7}\n\n');
        return;
      }
      if (record.method === "GET" && record.path === `/api/v1/accounts/renewal-sessions/${renewalSessionId}`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionRef: renewalSessionId, authorizationRef: "auth-1", state: "WAITING_USER", createdAt: "2026-10-14T12:00:00Z", expiresAt: null, authorizationUrl: null, generation: 1 }));
        return;
      }
      res.writeHead(404, { "content-type": "application/problem+json" });
      res.end(JSON.stringify({ code: "SIMULATED_EXCHANGE_ROUTE_NOT_FOUND" }));
    });

    const fakePort = await listenEphemeral(fakeExchange);
    cleanup.push(() => closeServer(fakeExchange));
    const webPort = await unusedPort();
    const pairingCode = "local-simulated-pair-code";
    const webScript = [
      "import uvicorn",
      "from cyrene_navigator.web_host import ProxyTarget, create_web_host_app",
      `app = create_web_host_app(pairing_code=${JSON.stringify(pairingCode)}, proxy_targets={"/api/v1/exchange": ProxyTarget(base_url=${JSON.stringify(`http://127.0.0.1:${fakePort}`)}, forward_product_authorization=True)}, secure_cookies=False)`,
      `uvicorn.run(app, host="127.0.0.1", port=${webPort}, log_level="error")`,
    ].join("\n");
    const pythonPath = join(navigatorRoot!, "src");
    let stderr = "";
    const webHost = spawn(navigatorPython!, ["-c", webScript], {
      cwd: navigatorRoot,
      env: { PATH: process.env.PATH ?? "", PYTHONPATH: [pythonPath, process.env.PYTHONPATH].filter(Boolean).join(delimiter), PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    webHost.stderr?.setEncoding("utf8");
    webHost.stderr?.on("data", chunk => { stderr += String(chunk); });
    cleanup.push(() => stopChild(webHost));
    const webOrigin = `http://127.0.0.1:${webPort}`;
    await waitForHttp(`${webOrigin}/api/v1/auth/session`, webHost, () => stderr);

    const pairResponse = await fetch(`${webOrigin}/api/v1/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingCode }),
    });
    expect(pairResponse.status).toBe(200);
    const pairPayload = await pairResponse.json() as { csrfToken?: unknown };
    expect(typeof pairPayload.csrfToken).toBe("string");
    const navigatorCookies = pairResponse.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    expect(navigatorCookies).toContain("=");

    const stores = new SqliteStoreFactory(":memory:");
    const control = createControlApplication({
      stores,
      mode: "team",
      publicOrigins: ["http://127.0.0.1:5180"],
      navigatorUrl: webOrigin,
    });
    await control.ready;
    await control.team.bootstrap("owner", "test-owner-long-password");
    const ownerLogin = await control.team.login("owner", "test-owner-long-password");
    const owner = await control.team.authenticate(ownerLogin.token, "browser");
    await control.team.createMember({ username: "reader", password: "test-reader-long-password", workspaceIds: ["local"], roles: ["viewer"] }, owner.actor);
    const readerLogin = await control.team.login("reader", "test-reader-long-password");
    await new Promise<void>(resolve => control.server.listen(0, "127.0.0.1", resolve));
    const controlOrigin = `http://127.0.0.1:${(control.server.address() as AddressInfo).port}`;
    cleanup.push(async () => {
      control.server.closeAllConnections();
      await new Promise<void>(resolve => control.server.close(() => resolve()));
      await stores.close();
    });

    const browserHeaders = {
      host: "127.0.0.1:5180",
      origin: "http://127.0.0.1:5180",
      cookie: `studio_session=${readerLogin.token}; ${navigatorCookies}`,
      "x-studio-control-token": readerLogin.csrf,
      "x-csrf-token": String(pairPayload.csrfToken),
      "x-cyrene-product-authorization": "Bearer synthetic-platform-first-party-token",
      "x-cyrene-workspace-id": "exchange-workspace-1",
    };
    const connections = await request(controlOrigin, "/api/v1/integrations/connections", browserHeaders);
    expect(connections.status).toBe(200);
    expect(JSON.parse(connections.text)).toEqual([]);
    const feed = await request(controlOrigin, "/api/v1/integrations/notifications?after=4", browserHeaders);
    expect(feed.status).toBe(200);
    expect(JSON.parse(feed.text)).toMatchObject({ notifications: [], nextSequence: 4 });
    const events = await request(controlOrigin, "/api/v1/integrations/notifications/events", {
      ...browserHeaders,
      accept: "text/event-stream",
      "last-event-id": "6",
    });
    expect(events.status).toBe(200);
    expect(events.headers["content-type"]).toContain("text/event-stream");
    expect(events.text).toContain('id: 7\ndata: {"id":"notice-7","sequence":7}');
    const renewal = await request(controlOrigin, `/api/v1/accounts/renewal-sessions/${renewalSessionId}`, browserHeaders);
    expect(renewal.status).toBe(200);
    expect(JSON.parse(renewal.text)).toMatchObject({ sessionRef: renewalSessionId, authorizationRef: "auth-1", state: "WAITING_USER" });
    const deniedRenewal = await request(controlOrigin, "/api/v1/accounts/authorizations/auth-1/renewal-sessions", browserHeaders, "POST");
    expect(deniedRenewal.status).toBe(403);

    expect(records.map(({ method, path }) => [method, path])).toEqual([
      ["GET", "/api/v1/integrations/connections"],
      ["GET", "/api/v1/integrations/notifications?after=4"],
      ["GET", "/api/v1/integrations/notifications/events"],
      ["GET", `/api/v1/accounts/renewal-sessions/${renewalSessionId}`],
    ]);
    expect(records.every(record => record.authorization === "Bearer synthetic-platform-first-party-token"
      && record.workspaceId === "exchange-workspace-1" && !record.dedicatedAuthorization && !record.cookie)).toBe(true);
    expect(records[2]).toMatchObject({ accept: "text/event-stream", lastEventId: "6" });
  }, 30000);
});

async function unusedPort(): Promise<number> {
  const server = createHttpServer();
  const port = await listenEphemeral(server);
  await closeServer(server);
  return port;
}

async function listenEphemeral(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

async function request(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<{ status: number; text: string; headers: Record<string, string | string[] | undefined> }> {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(url, { method, headers }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8"), headers: response.headers }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function waitForHttp(url: string, child: ChildProcess, stderr: () => string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Navigator Web Host exited before startup: ${stderr().slice(-2000)}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      await response.body?.cancel();
      return;
    } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  throw new Error(`Navigator Web Host did not start: ${stderr().slice(-2000)}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}
