import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "vite";
import { expect, it } from "vitest";
import { settingsBridge, settingsProxy } from "../../tooling/settings-proxy";

it("forwards settings over a real HTTP bridge, retains auth headers/cookies, and blocks execution", async () => {
  const received: { method?: string; url?: string; cookie?: string; csrf?: string | string[]; body: string }[] = [];
  const upstream = createHttpServer((req, res) => {
    let body = ""; req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, cookie: req.headers.cookie, csrf: req.headers["x-csrf-token"], body });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Set-Cookie", "cyrene_session=fixture; HttpOnly; Path=/; SameSite=Lax");
      res.end(JSON.stringify({ acknowledged: true }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const vite = await createServer({ configFile: false, logLevel: "silent", appType: "custom", plugins: [settingsBridge(target)], server: { host: "127.0.0.1", port: 0, proxy: settingsProxy(target) } });
  try {
    await vite.listen(); const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
    const response = await fetch(`${origin}/api/v1/yield/training-drafts/example`, { method: "PATCH", headers: { Cookie: "cyrene_session=fixture", "X-CSRF-Token": "fixture-token", "Content-Type": "application/json" }, body: '{"parameters":{"epochs":4}}' });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(received).toEqual([{ method: "PATCH", url: "/api/v1/yield/training-drafts/example", cookie: "cyrene_session=fixture", csrf: "fixture-token", body: '{"parameters":{"epochs":4}}' }]);
    const denied = await fetch(`${origin}/api/v1/yield/training-drafts/example/actions/start`, { method: "POST" });
    expect(denied.status).toBe(403); expect(received).toHaveLength(1);
    await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
    const offline = await fetch(`${origin}/api/v1/yield/training-drafts`);
    expect(offline.status).toBe(502); expect(await offline.json()).toEqual({ code: "STUDIO_HOST_UNAVAILABLE" });
  } finally {
    await vite.close();
    if (upstream.listening) await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
