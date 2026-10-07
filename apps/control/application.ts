import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline as pipe } from "node:stream/promises";
import { productPermission } from "../../tooling/product-proxy";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { StoreFactory } from "../../packages/control-storage";
import { PipelineControl, pipelineDatabase, emptyPipelineDatabase } from "../../packages/pipeline-control/service";
import { pipelineCommands } from "../../packages/pipeline-control/contracts";
import { ServerControl, databaseSchema, emptyDatabase, type ServerObserver } from "../../packages/server-control/service";
import { RegisteredPlacementResolver } from "../../packages/run-control/placement";
import { commands, ControlError, type Actor } from "../../packages/server-control/contracts";
import { TeamControl, teamDatabase, emptyTeamDatabase } from "../../packages/team-control/service";
import { allowedSettingsRequest } from "../../tooling/settings-proxy";
import { NodeRegistry, catalogDatabase, emptyCatalogDatabase } from "../../packages/node-registry/service";
import { RunControl } from "../../packages/run-control/service";
import { runCommands, runDatabase, emptyRunDatabase } from "../../packages/run-control/contracts";
import type { ExecutionAdapter } from "../../packages/run-control/adapter";
import { BuildControl } from "../../packages/build-control/service";
import { buildCommands, buildDatabase, emptyBuildDatabase, type BuildProfile } from "../../packages/build-control/contracts";
import type { BuildAdapter } from "../../packages/build-control/adapter";
import { catalogCommands } from "../../packages/node-registry/commands";
import { MonitoringControl } from "../../packages/monitoring/service";
import { monitoringCommands } from "../../packages/monitoring/contracts";
import { streamRun } from "./run-stream";
import { createMcpServer } from "../mcp/server";
import { serveMcp } from "../mcp/http";
import { assistantTurn, type AssistantProvider } from "./assistant";
import { LocalDiagnosticAdapter, diagnosticDatabase, emptyDiagnosticDatabase } from "../../packages/local-diagnostics/adapter";
import { createUpdateControl } from "./update-control";
import { createUpdateHelper } from "./update-helper";
import type { UpdateHelperRequest, UpdateHelperResult } from "../../packages/component-updates/contracts";

export interface ControlOptions {
  stores: StoreFactory;
  mode: "local" | "team";
  publicOrigins: string[];
  workspaceId?: string;
  navigatorUrl?: string;
  /** Dedicated local stdio clients; never exposed through a browser endpoint. */
  localApiToken?: string;
  loadPackages?: () => Promise<unknown[]>;
  adapters?: Map<string, ExecutionAdapter>;
  serverObservers?: ReadonlyMap<string, ServerObserver>;
  buildProfiles?: BuildProfile[];
  buildAdapter?: BuildAdapter;
  localDiagnostics?: boolean;
  mcpReadOnly?: boolean;
  assistantProvider?: AssistantProvider;
  updateHelper?: (request: UpdateHelperRequest) => Promise<UpdateHelperResult>;
}
const localScopes = ["products.read", "products.write", "products.operate", "products.admin", "pipelines.read", "pipelines.write", "servers.read", "servers.write", "runs.read", "runs.write", "builds.read", "builds.write", "catalog.write", "updates.read", "updates.apply"];
const cookieName = "studio_session";
function cookie(req: IncomingMessage) { return (req.headers.cookie ?? "").split(";").map(p => p.trim()).find(p => p.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? ""; }
function secretEqual(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(value));
}
export async function readJson(req: IncomingMessage, limit = 1_048_576) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new ControlError("CONTENT_TYPE", "需要 JSON 请求。", 415);
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const data of req) { const chunk = Buffer.from(data); bytes += chunk.length; if (bytes > limit) throw new ControlError("TOO_LARGE", "请求超过大小限制。", 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new ControlError("INVALID_JSON", "请求不是有效 JSON。"); }
}

function navigatorUpstreamPath(requestUrl: string, workspaceId: string): string {
  const queryIndex = requestUrl.indexOf("?");
  const pathname = queryIndex < 0 ? requestUrl : requestUrl.slice(0, queryIndex);
  const query = queryIndex < 0 ? "" : requestUrl.slice(queryIndex);
  const tasksPrefix = "/api/v1/navigator/tasks";
  if (pathname === tasksPrefix || pathname.startsWith(`${tasksPrefix}/`)) {
    return `/api/v1/tasks${pathname.slice(tasksPrefix.length)}${query}`;
  }
  const approvalsPrefix = "/api/v1/navigator/approvals";
  if (pathname === approvalsPrefix || pathname.startsWith(`${approvalsPrefix}/`)) {
    return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/work/approvals${pathname.slice(approvalsPrefix.length)}${query}`;
  }
  return requestUrl;
}

export function createControlApplication(options: ControlOptions) {
  const origins = options.publicOrigins.map(raw => new URL(raw).origin);
  if (!origins.length) throw new Error("At least one public origin is required");
  if (options.mode === "local" && origins.some(origin => !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname))) throw new Error("Local mode only admits loopback origins");
  const workspaceId = options.workspaceId ?? "local";
  const localToken = randomBytes(32).toString("hex");
  const pipelineStore = options.stores.state("pipelines", pipelineDatabase, emptyPipelineDatabase);
  const pipelines = new PipelineControl(pipelineStore, { maxReceipts: Infinity });
  const servers = new ServerControl(options.stores.state("servers", databaseSchema, emptyDatabase), options.serverObservers);
  const team = new TeamControl(options.stores.state("team", teamDatabase, emptyTeamDatabase));
  const builds = new BuildControl(options.stores.state("builds", buildDatabase, emptyBuildDatabase), options.buildProfiles ?? [], options.buildAdapter);
  const registry = new NodeRegistry(options.stores.state("catalog", catalogDatabase, emptyCatalogDatabase), options.loadPackages ?? (async () => []), (id, workspace) => builds.verifiedResult(id, workspace));
  const ready = registry.restore();
  const runStore = options.stores.state("runs", runDatabase, emptyRunDatabase);
  const adapters = new Map(options.adapters);
  if (options.localDiagnostics) adapters.set("local-diagnostic", new LocalDiagnosticAdapter(options.stores.state("local-diagnostics", diagnosticDatabase, emptyDiagnosticDatabase)));
  const runs = new RunControl(runStore, pipelines, adapters, () => Date.now(), new RegisteredPlacementResolver(servers));
  const monitoring = new MonitoringControl(pipelineStore, runStore, new Set(adapters.keys()));
  const mcp = (actor: Actor) => createMcpServer(pipelines, actor, runs, { monitoring, builds, catalog: registry, servers, readOnly: options.mcpReadOnly });
  const updates = options.mode === "local" ? createUpdateControl(options.updateHelper ?? createUpdateHelper()) : undefined;
  const failures = new Map<string, { count: number; until: number }>();
  const activeAssistantTurns = new Set<string>();
  function originBoundary(req: IncomingMessage) {
    // Do not trust Forwarded/X-Forwarded-* supplied by clients. The gateway
    // preserves Host and Origin, and only explicitly configured origins pass.
    if (!origins.some(origin => new URL(origin).host === req.headers.host) ||
      (req.headers.origin && !origins.includes(req.headers.origin)) || req.headers["sec-fetch-site"] === "cross-site") throw new ControlError("FORBIDDEN", "访问来源不受信任。", 403);
  }
  async function authorize(req: IncomingMessage, mutation: boolean) {
    const authorization = req.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      const token = authorization.slice(7);
      if (options.mode === "local") {
        if (!options.localApiToken || !secretEqual(token, options.localApiToken)) throw new ControlError("UNAUTHENTICATED", "无效的本地 API 凭据。", 401);
        return { actor: { id: "local-mcp", workspaceIds: [workspaceId], scopes: localScopes }, csrf: "", username: "local-mcp" };
      }
      return team.authenticate(token, "api");
    }
    originBoundary(req);
    if (options.mode === "local") {
      if (mutation && (typeof req.headers["x-studio-control-token"] !== "string" || !secretEqual(req.headers["x-studio-control-token"], localToken))) throw new ControlError("FORBIDDEN", "控制会话已失效，请重新连接。", 403);
      return { actor: { id: "local-user", workspaceIds: [workspaceId], scopes: localScopes }, csrf: localToken, username: "local-user" };
    }
    const context = await team.authenticate(cookie(req), "browser");
    if (mutation && (typeof req.headers["x-studio-control-token"] !== "string" || !secretEqual(req.headers["x-studio-control-token"], context.csrf))) throw new ControlError("FORBIDDEN", "缺少有效的会话 CSRF 凭据。", 403);
    return context;
  }
  const groups = new Map<string, { commands: Record<string, { readOnly: boolean; scope?: string; description?: string }>; execute(raw: unknown, actor: Actor): Promise<unknown> }>([
    ["/studio-pipelines", { commands: pipelineCommands, execute: (raw, actor) => pipelines.execute(raw, actor) }],
    ["/studio-control", { commands, execute: (raw, actor) => servers.execute(raw, actor) }],
    ["/studio-monitoring", { commands: monitoringCommands, execute: (raw, actor) => monitoring.execute(raw, actor) }],
    ["/studio-runs", { commands: runCommands, execute: (raw, actor) => runs.execute(raw, actor) }],
    ["/studio-builds", { commands: buildCommands, execute: (raw, actor) => builds.execute(raw, actor) }],
    ["/studio-catalog", { commands: catalogCommands, execute: (raw, actor) => registry.execute(raw, actor) }],
  ]);
  if (updates) groups.set("/studio-updates", { commands: updates.commands, execute: (raw, actor) => updates.execute(raw, actor) });
  const permittedCommands = (prefix: string, definitions: Record<string, { readOnly: boolean; scope?: string; description?: string }>, actor: Actor) => Object.entries(definitions).filter(([name, command]) => (name !== "monitoring.snapshot" || actor.scopes.includes("pipelines.read")) && actor.scopes.includes(command.scope ?? `${prefix === "/studio-runs" ? "runs" : "pipelines"}.${command.readOnly ? "read" : "write"}`)).map(([name, command]) => ({ name, readOnly: command.readOnly, description: command.description, endpoint: `${prefix}/v1/commands` }));
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "GET" && path === "/health/live") return send(res, 200, { status: "alive" });
      await ready;
      if (path === "/studio-mcp/v1/info" && req.method === "GET") {
        const { actor } = await authorize(req, false);
        return send(res, 200, { endpoint: "/studio-mcp", protocolVersion: "2025-11-25", transport: "streamable-http", readOnly: !!options.mcpReadOnly, diagnostics: !!options.localDiagnostics, assistant: { configured: !!options.assistantProvider, model: options.assistantProvider?.model }, actor });
      }
      if (path === "/studio-assistant/v1/turn" && req.method === "POST") {
        const { actor } = await authorize(req, true);
        if (activeAssistantTurns.has(actor.id) || activeAssistantTurns.size >= 16) throw new ControlError("ASSISTANT_BUSY", "助手仍在处理请求，请稍后重试。", 429);
        const input = await readJson(req, 262144);
        if (activeAssistantTurns.has(actor.id) || activeAssistantTurns.size >= 16) throw new ControlError("ASSISTANT_BUSY", "助手仍在处理请求，请稍后重试。", 429);
        activeAssistantTurns.add(actor.id);
        const abort = new AbortController(), closed = () => abort.abort();
        res.once("close", closed);
        try { return send(res, 200, await assistantTurn(input, actor, options.assistantProvider, mcp(actor), AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]))); }
        finally { activeAssistantTurns.delete(actor.id); res.off("close", closed); }
      }
      if (path === "/studio-mcp") {
        // Validate Origin even with bearer credentials; browser POSTs need CSRF.
        if (req.headers.origin && !origins.includes(req.headers.origin)) throw new ControlError("FORBIDDEN", "访问来源不受信任。", 403);
        const { actor } = await authorize(req, req.method === "POST");
        const body = req.method === "POST" ? await readJson(req) : undefined;
        return await serveMcp(req, res, mcp(actor), body);
      }
      if (req.method === "GET" && path === "/studio-commands/v1/session") {
        const context = await authorize(req, false);
        return send(res, 200, { token: context.csrf, actor: context.actor, workspaceId, mode: options.mode, commands: [...groups].flatMap(([prefix, group]) => permittedCommands(prefix, group.commands, context.actor)) });
      }
      if (req.method === "GET" && path === "/health/ready") { await pipelineStore.read(); return send(res, 200, { status: "ready" }); }
      if (path === "/studio-catalog/v1/packages" && req.method === "GET") {
        const { actor } = await authorize(req, false);
        if (!actor.scopes.includes("pipelines.read")) throw new ControlError("FORBIDDEN", "缺少目录读取权限。", 403);
        return send(res, 200, await registry.list());
      }
      if (path === "/studio-catalog/v1/reload" && req.method === "POST") {
        const { actor } = await authorize(req, true);
        return send(res, 200, await registry.reload(actor));
      }
      if (path === "/studio-runs/v1/stream" && req.method === "GET") return await streamRun(req, res, runs, () => authorize(req, false));
      if (path === "/studio-events/v1/stream" && req.method === "GET") {
        const initial = await authorize(req, false);
        if (!initial.actor.scopes.includes("pipelines.read")) throw new ControlError("FORBIDDEN", "缺少订阅权限。", 403);
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
        let cursor = req.headers["last-event-id"] ?? "", pending = false, closed = false;
        const push = async () => {
          if (pending || closed) return; pending = true;
          try {
            const { actor } = await authorize(req, false), db = await pipelineStore.read();
            if (!actor.scopes.includes("pipelines.read")) throw new ControlError("FORBIDDEN", "订阅权限已失效。", 403);
            const records = db.records.filter(record => actor.workspaceIds.includes(record.workspaceId)).map(record => ({ workspaceId: record.workspaceId, pipelineId: record.document.id, graphRevision: record.graphRevision, layoutRevision: record.layoutRevision, updatedBy: record.updatedBy }));
            const data = JSON.stringify(records), next = createHash("sha256").update(data).digest("hex");
            if (!closed && next !== cursor) { cursor = next; res.write(`id: ${next}\nevent: snapshot\ndata: ${data}\n\n`); }
            else if (!closed) res.write(": heartbeat\n\n");
          } catch { if (!closed) res.end(); }
          finally { pending = false; }
        };
        const timer = setInterval(() => void push(), 1500), expiry = setTimeout(() => res.end(), 60000);
        res.on("close", () => { closed = true; clearInterval(timer); clearTimeout(expiry); }); void push(); return;
      }
      if (path.startsWith("/studio-team/")) {
        originBoundary(req);
        if (path === "/studio-team/v1/session" && req.method === "GET") {
          try { const context = await authorize(req, false); return send(res, 200, { mode: options.mode, authenticated: true, username: context.username, actor: context.actor, token: context.csrf }); }
          catch (error) { if (error instanceof ControlError && error.status === 401) return send(res, 200, { mode: options.mode, authenticated: false }); throw error; }
        }
        if (path === "/studio-team/v1/login" && req.method === "POST" && options.mode === "team") {
          const key = req.socket.remoteAddress ?? "unknown", now = Date.now();
          for (const [id, failure] of failures) if (failure.until <= now) failures.delete(id);
          if ((failures.get(key)?.count ?? 0) >= 10 || failures.size >= 10000) throw new ControlError("RATE_LIMITED", "登录尝试过多，请稍后重试。", 429);
          failures.set(key, { count: (failures.get(key)?.count ?? 0) + 1, until: now + 60_000 });
          const input = z.object({ username: z.string(), password: z.string() }).strict().parse(await readJson(req, 4096));
          const issued = await team.login(input.username, input.password);
          failures.delete(key);
          const secure = origins.every(origin => origin.startsWith("https:"));
          res.setHeader("set-cookie", `${cookieName}=${issued.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? "; Secure" : ""}`);
          return send(res, 200, { token: issued.csrf, expiresAt: issued.expiresAt });
        }
        const { actor } = await authorize(req, req.method !== "GET");
        if (path === "/studio-team/v1/logout" && req.method === "POST") { await team.logout(cookie(req)); res.setHeader("set-cookie", `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`); return send(res, 200, { ok: true }); }
        if (path === "/studio-team/v1/members" && req.method === "GET") return send(res, 200, { items: await team.list(actor) });
        if (path === "/studio-team/v1/members" && req.method === "POST") return send(res, 201, await team.createMember(await readJson(req, 16384), actor));
        if (path === "/studio-team/v1/tokens" && req.method === "POST") {
          const input = z.object({ scopes: z.array(z.string()).max(20) }).strict().parse(await readJson(req, 4096));
          return send(res, 201, await team.issueApiToken(actor, input.scopes));
        }
        if (path === "/studio-team/v1/tokens" && req.method === "GET") return send(res, 200, { items: await team.listApiTokens(actor) });
        if (path === "/studio-team/v1/tokens/revoke" && req.method === "POST") {
          const { id } = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await readJson(req, 4096));
          return send(res, 200, await team.revokeApiToken(id, actor));
        }
      }
      for (const [prefix, group] of groups) {
        if (req.url === `${prefix}/v1/session` && req.method === "GET") {
          const context = await authorize(req, false);
          return send(res, 200, { token: context.csrf, workspaceId, mode: options.mode, actor: context.actor, commands: permittedCommands(prefix, group.commands, context.actor) });
        }
        if (req.url === `${prefix}/v1/commands` && req.method === "POST") {
          const { actor } = await authorize(req, true);
          return send(res, 200, { result: await group.execute(await readJson(req), actor) });
        }
      }
      if (path === "/studio-api/connection" && req.method === "GET") {
        await authorize(req, false); return send(res, 200, { configured: !!options.navigatorUrl, target: options.navigatorUrl ?? null });
      }
      if (path.startsWith("/api")) {
        const permission = productPermission(req.method ?? "GET", path);
        const legacy = allowedSettingsRequest(req.method ?? "GET", path);
        if (!permission && !legacy) throw new ControlError("STUDIO_SETTINGS_ONLY", "此代理只允许节点设置接口。", 403);
        const { actor } = await authorize(req, !!permission && !legacy && req.method !== "GET");
        if (permission && !actor.scopes.includes(permission)) throw new ControlError("FORBIDDEN", "没有此产品操作权限。", 403);
        // Product settings already use Navigator's CSRF protocol. Team writes
        // additionally require Studio editor permission; browser Origin is checked.
        if (!permission && !path.startsWith("/api/v1/auth/") && req.method !== "GET" && !actor.scopes.includes("pipelines.write")) throw new ControlError("FORBIDDEN", "没有设置编辑权限。", 403);
        const productWorkspace = path.match(/^\/api\/v1\/navigator\/harness\/workspaces\/([^/]+)\/sessions$/)?.[1];
        if (productWorkspace && !actor.workspaceIds.includes(productWorkspace)) throw new ControlError("FORBIDDEN", "没有此工作空间权限。", 403);
        const workWorkspace = path.match(/^\/api\/v1\/workspaces\/([^/]+)\/work\//)?.[1];
        if (workWorkspace && !actor.workspaceIds.includes(workWorkspace)) throw new ControlError("FORBIDDEN", "没有此工作空间权限。", 403);
        if (path === "/api/v1/navigator/approvals" || path.startsWith("/api/v1/navigator/approvals/")
          || path === "/api/v1/navigator/tasks" || path.startsWith("/api/v1/navigator/tasks/")) {
          if (!actor.workspaceIds.includes(workspaceId)) throw new ControlError("FORBIDDEN", "没有此工作空间权限。", 403);
        }
        if (!options.navigatorUrl) throw new ControlError("STUDIO_HOST_NOT_CONFIGURED", "尚未配置 Navigator。", 503);
        const headers = new Headers();
        for (const name of ["content-type", "accept", "last-event-id", "x-csrf-token", "idempotency-key", "origin", "host"]) {
          const value = req.headers[name]; if (typeof value === "string") headers.set(name, value);
        }
        const upstreamCookies = (req.headers.cookie ?? "").split(";").filter(p => !p.trim().startsWith(`${cookieName}=`)).join(";");
        if (upstreamCookies) headers.set("cookie", upstreamCookies);
        if (path === "/api/proxy/exchange-gateway/v1/chat/completions" && typeof req.headers["x-product-authorization"] === "string") headers.set("authorization", req.headers["x-product-authorization"]);
        let body: Buffer | undefined;
        if (req.method !== "GET" && req.method !== "HEAD") {
          const limit = /^\/api\/v1\/catalyst\/datasets\/[^/]+\/preparations$/.test(path)
            || /^\/api\/v1\/catalyst\/api\/v1\/datasets\/[^/]+\/sources$/.test(path) ? 32 * 1024 * 1024
            : /^\/api\/v1\/catalyst\/api\/v1\/datasets\/[^/]+\/sources\/batch$/.test(path) ? 129 * 1024 * 1024
            : path === "/api/v1/echo/api/v1/session-artifacts" ? 16 * 1024 * 1024
            : /^\/api\/v1\/workspaces\/[^/]+\/work\/attachments$/.test(path) ? 16 * 1024 * 1024
              : 1_048_576;
          let bytes = 0; const chunks: Buffer[] = [];
          for await (const chunk of req) { const part = Buffer.from(chunk); bytes += part.length; if (bytes > limit) throw new ControlError("TOO_LARGE", "请求超过大小限制。", 413); chunks.push(part); }
          if (chunks.length) body = Buffer.concat(chunks);
        }
        const abort = new AbortController();
        const closed = () => abort.abort(); res.once("close", closed);
        const deadline = setTimeout(() => abort.abort(), 10000);
        let upstream: Response;
        try { upstream = await fetch(`${options.navigatorUrl}${navigatorUpstreamPath(req.url ?? path, workspaceId)}`, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined, redirect: "manual", signal: abort.signal }); }
        catch (error) { res.off("close", closed); throw error; }
        finally { clearTimeout(deadline); }
        res.statusCode = upstream.status;
        res.setHeader("cache-control", "no-store");
        res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
        const cookies = upstream.headers.getSetCookie(); if (cookies.length) res.setHeader("set-cookie", cookies);
        if (upstream.headers.get("content-type")?.includes("text/event-stream")) res.setHeader("x-accel-buffering", "no");
        try { if (upstream.body) await pipe(Readable.fromWeb(upstream.body as any), res); else res.end(); }
        finally { res.off("close", closed); abort.abort(); }
        return;
      }
      throw new ControlError("NOT_FOUND", "不存在此接口。", 404);
    } catch (error) {
      const failure = error instanceof ControlError ? error : error instanceof z.ZodError ? new ControlError("INVALID_INPUT", "请求不符合接口契约。") : new ControlError("CONTROL_UNAVAILABLE", "控制操作未完成，请核对状态后重试。", 503);
      if (!res.headersSent) send(res, failure.status, { error: { code: failure.code, message: failure.message } }); else res.end();
    }
  };
  const server = createServer((req, res) => { void handler(req, res); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return { server, handler, team, pipelines, servers, registry, runs, monitoring, builds, updates, ready, groups, authorize, stores: options.stores };
}
