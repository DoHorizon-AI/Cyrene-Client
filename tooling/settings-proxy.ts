import type { Plugin, ProxyOptions } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

// Allow only settings operations in this development bridge. In particular,
// /actions/start, /actions/deploy and arbitrary cloud/provider URLs are absent.
// 此开发桥接层仅允许设置相关操作。尤其不开放 /actions/start、/actions/deploy 或任意云服务商 URL。
export function allowedSettingsRequest(method: string, pathname: string) {
  const rules: [string, RegExp][] = [
    ["GET", /^\/api\/v1\/(auth\/session|system\/status)$/],
    ["POST", /^\/api\/v1\/auth\/(pair|session\/refresh)$/],
    ["DELETE", /^\/api\/v1\/auth\/session$/],
    ["GET", /^\/api\/v1\/catalyst\/(datasets|dataset-versions\/[A-Za-z0-9-]+)$/],
    ["GET", /^\/api\/v1\/reactor\/(model-imports|serving-bindings)$/],
    ["GET", /^\/api\/v1\/yield\/training-drafts(?:\/[A-Za-z0-9-]+)?$/],
    ["PATCH", /^\/api\/v1\/yield\/training-drafts\/[A-Za-z0-9-]+$/],
    ["GET", /^\/api\/v1\/echo\/evaluation-suites\/[A-Za-z0-9-]+$/],
    ["POST", /^\/api\/v1\/echo\/evaluation-suites$/],
    ["GET", /^\/api\/v1\/navigator\/harness\/workspaces\/[^/]+\/sessions$/],
  ];
  if (/%(?:2f|5c|2e|25|00)/i.test(pathname) || pathname.includes("..") || pathname.includes("\\")) return false;
  return rules.some(([m, path]) => m === method && path.test(pathname));
}
export function admittedTarget(raw?: string) {
  if (!raw?.trim()) return undefined;
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("STUDIO_NAVIGATOR_URL must be an HTTP(S) origin without credentials or a path.");
  return url.origin;
}
export function settingsProxy(target?: string): Record<string, ProxyOptions> | undefined {
  if (!target) return undefined;
  return { "/api": {
    target, changeOrigin: false, secure: true, timeout: 10000, proxyTimeout: 10000,
    configure(proxy) {
      proxy.on("error", (_error, _req, res) => {
        if ("writeHead" in res && !res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ code: "STUDIO_HOST_UNAVAILABLE" }));
        }
      });
    },
  } };
}
export function settingsBridge(target?: string): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? "").split("?")[0];
    const respond = (status: number, payload: unknown) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(payload)); };
    if (path === "/studio-api/connection") { respond(200, { configured: !!target, target: target ?? null }); return; }
    // Match the proxy's entire raw prefix. Encoded separators such as /api%2f
    // must reach the allowlist too, before an upstream decodes the path.
    if (!path.startsWith("/api")) { next(); return; }
    if (!allowedSettingsRequest(req.method ?? "GET", path)) { respond(403, { code: "STUDIO_SETTINGS_ONLY" }); return; }
    if (!target) { respond(503, { code: "STUDIO_HOST_NOT_CONFIGURED" }); return; }
    next();
  };
  return { name: "client-settings-bridge", configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
