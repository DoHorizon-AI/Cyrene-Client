import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Plugin, Connect } from "vite";
import { z } from "zod";
import { commands, ControlError } from "../packages/server-control/contracts";
import { ServerControl } from "../packages/server-control/service";
import { FileRegistryStore } from "./server-store";

export function controlMiddleware(control: { execute(raw: unknown, actor: import("../packages/server-control/contracts").Actor): Promise<unknown> }, options: { prefix: string; commands: Record<string, { readOnly: boolean }>; scopes: string[]; maxBytes: number } = { prefix: "/studio-control", commands, scopes: ["servers.read", "servers.write"], maxBytes: 16_384 }): Connect.NextHandleFunction {
  const token = randomBytes(32).toString("hex");
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body));
  };
  return async (req: IncomingMessage, res: ServerResponse, next) => {
    if (!req.url?.startsWith(`${options.prefix}/`)) return next();
    try {
      // Development boundary only: loopback Host, same Origin, and per-process
      // CSRF token. The future HTTP/MCP adapter must supply authenticated actors.
      const host = req.headers.host ?? "";
      if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) ||
        (req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers["sec-fetch-site"] === "cross-site") throw new ControlError("FORBIDDEN", "仅允许本机同源访问。", 403);
      if (req.method === "GET" && req.url === `${options.prefix}/v1/session`) {
        return send(res, 200, { token, workspaceId: "local", mode: "local-development", commands: Object.entries(options.commands).map(([name, c]) => ({ name, readOnly: c.readOnly })) });
      }
      const supplied = req.headers["x-studio-control-token"];
      if (typeof supplied !== "string" || supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) throw new ControlError("FORBIDDEN", "本地控制会话已失效，请刷新后重试。", 403);
      if (req.method !== "POST" || req.url !== `${options.prefix}/v1/commands`) throw new ControlError("NOT_FOUND", "不存在此操作入口。", 404);
      if (!req.headers["content-type"]?.startsWith("application/json")) throw new ControlError("CONTENT_TYPE", "需要 JSON 请求。", 415);
      let size = 0; const parts: Buffer[] = [];
      for await (const chunk of req) { const part = Buffer.from(chunk); size += part.length; if (size > options.maxBytes) throw new ControlError("TOO_LARGE", "请求超过大小限制。", 413); parts.push(part); }
      let raw: unknown;
      try { raw = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new ControlError("INVALID_JSON", "请求不是有效 JSON。"); }
      const result = await control.execute(raw, { id: "local-user", workspaceIds: ["local"], scopes: options.scopes });
      send(res, 200, { result });
    } catch (e) {
      const err = e instanceof ControlError ? e : e instanceof z.ZodError ? new ControlError("INVALID_INPUT", "请求或登记数据不符合契约。") : new ControlError("STORE_ERROR", "无法读取或保存登记库；已有文件未被重置。", 500);
      send(res, err.status, { error: { code: err.code, message: err.message } });
    }
  };
}
export function serverControlBridge(directory = resolve(".studio")): Plugin {
  const install = (server: { middlewares: Connect.Server }) => { server.middlewares.use(controlMiddleware(new ServerControl(new FileRegistryStore(resolve(directory, "server-registry.json"))))); };
  return { name: "cyrene-server-control", configureServer: install, configurePreviewServer: install };
}
