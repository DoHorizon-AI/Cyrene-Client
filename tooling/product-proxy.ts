const id = "[A-Za-z0-9_-]+";
const workId = "(?:[A-Za-z0-9_.:-]|%3[Aa])+";
const taskId = "[A-Za-z0-9](?:[A-Za-z0-9_.:-]|%3[Aa]){0,199}";
const defaultBodyLimit = 1_048_576;

export interface ProxyBodyViolation { code: string; message: string; status: number }
interface NavigatorPolicyOptions {
  workspace?: "host" | "path";
  browserOnly?: boolean;
  maxBodyBytes?: number;
  upstream?: "tasks" | "approvals";
  validateBody?: (input: unknown, mode: "local" | "team") => ProxyBodyViolation | null;
}
export interface NavigatorProxyPolicy extends NavigatorPolicyOptions {
  method: string;
  path: RegExp;
  permission: string | null;
  maxBodyBytes: number;
}

function taskBodyViolation(input: unknown, mode: "local" | "team"): ProxyBodyViolation | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { code: "TASK_INPUT_INVALID", message: "任务请求必须是 JSON 对象。", status: 400 };
  }
  const body = input as Record<string, unknown>;
  if (mode === "team" && ("execution" in body || "runtime" in body)) {
    return { code: "PERSONAL_RUNTIME_LOCAL_ONLY", message: "团队任务使用已配置的 Navigator 执行器；不能在请求中选择运行时。", status: 403 };
  }
  if (["cwd", "agentPreset", "timeoutMs", "executionClass"].some(field => Object.hasOwn(input, field))) {
    return { code: "RESERVED_EXECUTION_FIELD", message: "执行目录、预设和超时由宿主管理，不能通过浏览器任务指定。", status: 403 };
  }
  if ("metadata" in body) {
    return { code: "RESERVED_EXECUTION_METADATA", message: "任务来源和执行 metadata 由 Navigator 管理，浏览器不能提交 metadata。", status: 403 };
  }
  if ("execution" in body || "runtime" in body) {
    return { code: "RUNTIME_SELECTION_UNAVAILABLE", message: "运行时选择由已配置的 Navigator 宿主负责，Client 不接收逐任务选择。", status: 403 };
  }
  const allowed = new Set(["prompt", "taskId", "sessionId", "stream"]);
  if (Object.keys(body).some(field => !allowed.has(field))) {
    return { code: "TASK_FIELD_UNSUPPORTED", message: "任务请求包含 Navigator 当前传输不支持的字段。", status: 400 };
  }
  if (typeof body.prompt !== "string" || body.prompt.length === 0
    || (body.taskId !== undefined && (typeof body.taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(body.taskId)))
    || (body.sessionId !== undefined && (typeof body.sessionId !== "string" || body.sessionId.length < 1 || body.sessionId.length > 200))
    || (body.stream !== undefined && typeof body.stream !== "boolean")) {
    return { code: "TASK_INPUT_INVALID", message: "任务提示词或可选会话字段格式无效。", status: 400 };
  }
  return null;
}

function conversationTurnBodyViolation(input: unknown, _mode: "local" | "team"): ProxyBodyViolation | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { code: "CONVERSATION_TURN_INVALID", message: "对话轮次必须是 JSON 对象。", status: 400 };
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || !Object.hasOwn(body, "conversationId") || !Object.hasOwn(body, "text")) {
    return { code: "CONVERSATION_TURN_INVALID", message: "只接受 conversationId 和 text；主体、人格和来源由 Navigator 推导。", status: 400 };
  }
  if (typeof body.conversationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(body.conversationId)
    || typeof body.text !== "string" || body.text.trim().length === 0 || body.text.length > 20_000) {
    return { code: "CONVERSATION_TURN_INVALID", message: "会话 ID 或消息文本超出对话入口限制。", status: 400 };
  }
  return null;
}

function policy(method: string, path: string, access: string | null, options: NavigatorPolicyOptions = {}): NavigatorProxyPolicy {
  return { method, path: new RegExp(`^/api/v1/${path}$`), permission: access === null ? null : `products.${access}`, maxBodyBytes: defaultBodyLimit, ...options };
}

function conversationPolicy(method: string, path: string, access: "read" | "write" | "operate", options: NavigatorPolicyOptions = {}): NavigatorProxyPolicy {
  return policy(method, `workspaces/(${workId})/work/conversation-memory/${path}`, access, { workspace: "path", ...options });
}

const conversationWorkPolicies: readonly NavigatorProxyPolicy[] = [
  policy("GET", `workspaces/(${workId})/work/operations/${workId}`, "read", { workspace: "path" }),
  conversationPolicy("GET", "overview", "read"),
  conversationPolicy("GET", "messages", "read"),
  conversationPolicy("GET", "memories", "read"),
  conversationPolicy("POST", "memories/query", "read"),
  conversationPolicy("POST", "memories", "write"),
  conversationPolicy("PATCH", `memories/${workId}`, "write"),
  conversationPolicy("DELETE", `memories/${workId}`, "write"),
  conversationPolicy("GET", "sources", "read"),
  conversationPolicy("POST", `sources/${workId}/revoke`, "write"),
  conversationPolicy("POST", `sources/${workId}/grants`, "write"),
  conversationPolicy("DELETE", `sources/${workId}/grants/${workId}`, "write"),
  conversationPolicy("GET", "personas", "read"),
  conversationPolicy("PUT", "personas", "write"),
  conversationPolicy("GET", "profile-candidates", "read"),
  conversationPolicy("POST", "profile-candidates", "write"),
  conversationPolicy("GET", "profiles", "read"),
  conversationPolicy("POST", `profile-candidates/${workId}/activate`, "write"),
  conversationPolicy("POST", `profiles/${workId}/rollback`, "write"),
  conversationPolicy("POST", "graph/proposals", "write"),
  conversationPolicy("GET", "graph/changesets", "read"),
  conversationPolicy("POST", `graph/changesets/${workId}/apply`, "write"),
  conversationPolicy("POST", "graph/query", "read"),
  conversationPolicy("GET", "maintenance/jobs", "read"),
  conversationPolicy("POST", "maintenance/jobs", "write"),
  conversationPolicy("GET", `maintenance/jobs/${workId}`, "read"),
  conversationPolicy("PATCH", `maintenance/jobs/${workId}/checkpoint`, "write"),
  conversationPolicy("POST", `maintenance/jobs/${workId}/cancel`, "write"),
  conversationPolicy("GET", "research/notes", "read"),
  conversationPolicy("POST", "research/notes", "write"),
  conversationPolicy("GET", "research/skills", "read"),
  conversationPolicy("GET", "watches", "read"),
  conversationPolicy("POST", "watches", "write"),
  conversationPolicy("POST", `watches/${workId}/cancel`, "write"),
  conversationPolicy("GET", "focus-items", "read"),
  conversationPolicy("POST", "focus-items", "write"),
  conversationPolicy("POST", `focus-items/${workId}/transition`, "write"),
  conversationPolicy("POST", "handoffs", "write"),
  conversationPolicy("GET", `handoffs/${workId}`, "read"),
  conversationPolicy("GET", "policies/active-behavior", "read"),
  conversationPolicy("PUT", "policies/active-behavior", "write"),
  conversationPolicy("GET", "review-events", "read"),
  conversationPolicy("POST", "review-events", "write"),
  conversationPolicy("POST", "imports/preview", "write", { maxBodyBytes: 12_000_000 }),
  conversationPolicy("POST", "imports", "write", { maxBodyBytes: 12_000_000 }),
  conversationPolicy("POST", `imports/${workId}/rollback`, "write"),
  conversationPolicy("POST", "backups", "write"),
  conversationPolicy("GET", "backups/attachments/[a-f0-9]{64}", "read"),
  conversationPolicy("GET", "media/assets", "read"),
  conversationPolicy("GET", `media/assets/${workId}`, "read"),
  conversationPolicy("GET", `media/assets/${workId}/attachment`, "read"),
  conversationPolicy("POST", "media/assets/import", "write"),
  conversationPolicy("DELETE", `media/assets/${workId}`, "write"),
  conversationPolicy("POST", `media/assets/${workId}/restore`, "write"),
  conversationPolicy("POST", "media/cards/render", "write"),
  conversationPolicy("GET", "speech/config", "read"),
  conversationPolicy("PUT", "speech/config", "write"),
  conversationPolicy("GET", "speech/status", "read"),
  conversationPolicy("POST", "speech/transcriptions", "write"),
  conversationPolicy("GET", "bilibili/accounts", "read"),
  conversationPolicy("POST", "bilibili/accounts/link", "operate"),
  conversationPolicy("POST", "bilibili/link-status", "operate"),
  conversationPolicy("GET", "bilibili/connections", "read"),
  conversationPolicy("GET", "bilibili/operations/by-idempotency-key", "read"),
  conversationPolicy("GET", `bilibili/connections/${workId}/read-operations`, "read"),
  conversationPolicy("POST", `bilibili/connections/${workId}/reads/${workId}`, "operate"),
  conversationPolicy("POST", `bilibili/connections/${workId}/writes/${workId}`, "operate"),
  conversationPolicy("GET", `operations/${workId}`, "read"),
];

/** One policy owns admission, workspace checks, body checks, limits and rewrites. */
export const navigatorProxyPolicies: readonly NavigatorProxyPolicy[] = [
  policy("POST", "conversation-assistant/turns", "operate", {
    workspace: "host",
    maxBodyBytes: 96 * 1024,
    validateBody: conversationTurnBodyViolation,
  }),
  policy("GET", "navigator/active-route", "read"),
  policy("POST", "navigator/active-route", "operate"),
  policy("GET", `navigator/harness/workspaces/(${id})/sessions`, "read", { workspace: "path" }),
  // The settings bridge accepts other opaque workspace IDs. Keep its original
  // admission while enforcing the same workspace boundary before forwarding.
  policy("GET", "navigator/harness/workspaces/([^/]+)/sessions", null, { workspace: "path" }),
  policy("GET", "navigator/tasks", "read", { workspace: "host", upstream: "tasks" }),
  policy("POST", "navigator/tasks", "operate", { workspace: "host", upstream: "tasks", validateBody: taskBodyViolation }),
  policy("GET", `navigator/tasks/${taskId}(?:/events)?`, "read", { workspace: "host", upstream: "tasks" }),
  policy("POST", `navigator/tasks/${taskId}/cancel`, "operate", { workspace: "host", upstream: "tasks" }),
  policy("GET", "navigator/approvals", "read", { workspace: "host", upstream: "approvals" }),
  policy("POST", `navigator/approvals/${id}/resolve`, "operate", { workspace: "host", upstream: "approvals" }),
  ...conversationWorkPolicies,
  policy("GET", `workspaces/(${workId})/work/approvals(?:/${workId})?`, "read", { workspace: "path" }),
  policy("POST", `workspaces/(${workId})/work/approvals/${workId}/resolve`, "operate", { workspace: "path" }),
  policy("GET", `workspaces/(${workId})/work/inputs(?:/${workId})?`, "read", { workspace: "path" }),
  policy("POST", `workspaces/(${workId})/work/inputs/${workId}/resolve`, "operate", { workspace: "path" }),
  policy("GET", `workspaces/(${workId})/work/tasks(?:/${workId}(?:/events)?)?`, "read", { workspace: "path" }),
  policy("POST", `workspaces/(${workId})/work/tasks/${workId}/approvals`, "operate", { workspace: "path" }),
  policy("GET", `workspaces/(${workId})/work/memory/facts`, "read", { workspace: "path" }),
  policy("POST", `workspaces/(${workId})/work/memory/facts`, "write", { workspace: "path" }),
  policy("POST", `workspaces/(${workId})/work/memory/query`, "read", { workspace: "path" }),
  policy("GET", `workspaces/(${workId})/work/notifications`, "read", { workspace: "path" }),
  policy("POST", `workspaces/(${workId})/work/attachments`, "write", { workspace: "path", maxBodyBytes: 16 * 1024 * 1024 }),
  policy("GET", `workspaces/(${workId})/work/attachments/${workId}`, "read", { workspace: "path" }),
  policy("GET", `workspaces/(${workId})/work/connectors`, "read", { workspace: "path" }),
  policy("GET", `workspaces/(${workId})/work/connectors/${workId}/health`, "read", { workspace: "path" }),
  policy("GET", `workspaces/(${workId})/work/connectors/${workId}/events`, "read", { workspace: "path" }),
  policy("POST", `workspaces/(${workId})/work/connectors/${workId}/login/qr`, "operate", { workspace: "path" }),
  policy("POST", `workspaces/(${workId})/work/connectors/${workId}/login/poll`, "operate", { workspace: "path" }),
];

function safePath(path: string): boolean {
  return !/%(?:2f|5c|2e|25|00)/i.test(path) && !path.includes("..") && !path.includes("\\");
}

export function navigatorProxyPolicy(method: string, path: string): NavigatorProxyPolicy | undefined {
  return safePath(path) ? navigatorProxyPolicies.find(rule => rule.method === method && rule.path.test(path)) : undefined;
}

export function navigatorPolicyWorkspace(rule: NavigatorProxyPolicy, path: string, hostWorkspace: string): string | undefined {
  return rule.workspace === "host" ? hostWorkspace : rule.workspace === "path" ? rule.path.exec(path)?.[1] : undefined;
}

export function navigatorProxyUpstreamPath(requestUrl: string, hostWorkspace: string, rule?: NavigatorProxyPolicy): string {
  if (!rule?.upstream) return requestUrl;
  const prefix = `/api/v1/navigator/${rule.upstream}`;
  const target = rule.upstream === "approvals" ? `/api/v1/workspaces/${encodeURIComponent(hostWorkspace)}/work/approvals` : `/api/v1/${rule.upstream}`;
  return target + requestUrl.slice(prefix.length);
}

export function productBodyLimit(path: string, navigatorRule?: NavigatorProxyPolicy): number {
  if (navigatorRule) return navigatorRule.maxBodyBytes;
  if (/^\/api\/v1\/catalyst\/datasets\/[^/]+\/preparations$/.test(path)
    || /^\/api\/v1\/catalyst\/api\/v1\/datasets\/[^/]+\/sources$/.test(path)) return 32 * 1024 * 1024;
  if (/^\/api\/v1\/catalyst\/api\/v1\/datasets\/[^/]+\/sources\/batch$/.test(path)) return 129 * 1024 * 1024;
  return path === "/api/v1/echo/api/v1/session-artifacts" ? 16 * 1024 * 1024 : defaultBodyLimit;
}

// Product operations exposed by the migrated management pages. No arbitrary paths.
import { isIP } from "node:net";

export type DirectProductId = "catalyst" | "echo";

/** Admit only a loopback HTTP(S) origin for an explicitly configured local Product service. */
export function admittedLoopbackTarget(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  if (raw !== raw.trim()) throw new Error("Product service URL must not contain surrounding whitespace.");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Product service URL must be an HTTP(S) origin without credentials, path, query, or fragment.");
  }
  if (!isLoopbackHost(url.hostname)) throw new Error("Direct Product services must use a loopback URL.");
  return url.origin;
}

/** Accept only literal loopback addresses or the exact localhost name. */
export function isLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost") return true;
  const address = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const version = isIP(address);
  if (version === 4) return Number(address.split(".")[0]) === 127;
  return version === 6 && address.toLowerCase() === "::1";
}

/** Return the fixed Product namespace from a path admitted by productPermission. */
export function directProductId(path: string): DirectProductId | null {
  if (path === "/api/v1/catalyst" || path.startsWith("/api/v1/catalyst/")) return "catalyst";
  if (path === "/api/v1/echo" || path.startsWith("/api/v1/echo/")) return "echo";
  return null;
}

/** Map the Client's fixed service facade to the corresponding Product API root. */
export function directProductUpstreamPath(requestUrl: string): string {
  const queryIndex = requestUrl.indexOf("?");
  const pathname = queryIndex < 0 ? requestUrl : requestUrl.slice(0, queryIndex);
  const query = queryIndex < 0 ? "" : requestUrl.slice(queryIndex);
  const product = directProductId(pathname);
  if (!product || /%(?:2f|5c|2e|25|00)/i.test(pathname) || pathname.includes("..") || pathname.includes("\\")) throw new Error("Request is outside a direct Product facade.");
  const prefix = `/api/v1/${product}`;
  const suffix = pathname.slice(prefix.length);
  const apiPath = suffix.startsWith("/api/v1/") ? suffix.slice("/api/v1".length) : suffix;
  return `/api/v1${apiPath}${query}`;
}

export function productPermission(method: string, path: string): string | null {
  if (!safePath(path)) return null;
  const navigator = navigatorProxyPolicy(method, path);
  if (navigator) return navigator.permission;
  const rules: [string, string, string][] = [
    ["GET", "system/status", "read"],
    ["GET", "credentials", "admin"], ["POST", "credentials", "admin"], ["DELETE", `credentials/${id}`, "admin"],
    ["GET", "reactor/(model-imports|serving-bindings|deployments)", "read"],
    ["POST", "reactor/model-imports", "write"],
    ["GET", `reactor/deployments/${id}/events`, "read"],
    ["POST", `reactor/deployments/${id}/actions/stop`, "operate"],
    ["GET", "catalyst/datasets", "read"], ["POST", "catalyst/datasets", "write"],
    ["GET", "catalyst/api/v1/datasets", "read"],
    ["GET", `catalyst/datasets/${id}/(preparations|versions)`, "read"],
    ["POST", `catalyst/datasets/${id}/preparations`, "write"],
    ["GET", `catalyst/dataset-versions/${id}(?:/preview)?`, "read"],
    ["PATCH", `catalyst/preparations/${id}/mapping`, "write"],
    ["POST", `catalyst/preparations/${id}/(confirm|publish|yield-draft)`, "operate"],
    ["POST", `catalyst/api/v1/datasets/${id}/sources`, "write"],
    ["POST", `catalyst/api/v1/datasets/${id}/sources/batch`, "write"],
    ["GET", `catalyst/api/v1/datasets/${id}/sources`, "read"],
    ["GET", `catalyst/api/v1/datasets/${id}/source-parse-reports`, "read"],
    ["GET", `catalyst/api/v1/datasets/${id}/review-queue`, "read"],
    ["POST", `catalyst/api/v1/review-items/${workId}/resolve`, "operate"],
    ["POST", `catalyst/api/v1/datasets/${id}/processing-runs`, "operate"],
    ["GET", `catalyst/api/v1/datasets/${id}/processing-runs`, "read"],
    ["GET", `catalyst/api/v1/processing-runs/${id}`, "read"],
    ["POST", `catalyst/api/v1/processing-runs/${id}/(cancel|retry)`, "operate"],
    ["GET", `catalyst/api/v1/datasets/${id}/content-revisions`, "read"],
    ["GET", `catalyst/api/v1/content-revisions/${id}/blocks`, "read"],
    ["GET", `catalyst/api/v1/content-revisions/${id}/training-records`, "read"],
    ["POST", `catalyst/api/v1/content-revisions/${id}/training-records:edit`, "write"],
    ["POST", `catalyst/api/v1/content-revisions/${id}/blocks/${workId}/edits`, "write"],
    ["POST", `catalyst/api/v1/content-revisions/${id}/review`, "operate"],
    ["POST", `catalyst/api/v1/datasets/${id}/data-tools/versions`, "operate"],
    ["GET", `catalyst/api/v1/datasets/${id}/data-tools/versions`, "read"],
    ["GET", `catalyst/api/v1/dataset-versions/${id}/data-tools/export`, "read"],
    ["GET", `yield/training-drafts(?:/${id})?`, "read"],
    ["PATCH", `yield/training-drafts/${id}`, "write"],
    ["POST", `yield/training-drafts/${id}/actions/start`, "operate"],
    ["GET", `yield/(?:api/v1/)?training-runs/${id}(?:/attempts|/events/stream)?`, "read"],
    ["POST", `yield/training-runs/${id}/actions/(resume|cancel)`, "operate"],
    ["POST", `yield/training-results/${id}/actions/send-to-reactor`, "operate"],
    ["GET", `echo/evaluation-suites/${id}`, "read"], ["POST", "echo/evaluation-suites", "write"],
    ["GET", `echo/api/v1/evaluation-suites/${id}`, "read"],
    ["POST", "echo/api/v1/evaluation-suites", "write"],
    ["POST", "echo/api/v1/session-artifacts", "write"],
    ["GET", "echo/api/v1/evaluation-inputs", "read"],
    ["POST", "echo/api/v1/evaluation-inputs", "write"],
    ["GET", `echo/api/v1/evaluation-inputs/${id}(?:/samples)?`, "read"],
    ["POST", `echo/api/v1/evaluation-inputs/${id}/actions/evaluate`, "operate"],
    ["GET", `echo/api/v1/evaluation-runs/${id}(?:/samples)?`, "read"],
    ["GET", `echo/api/v1/evaluation-results/${id}(?:/export)?`, "read"],
    ["GET", "exchange/api/v1/(gateway-routes|gateway-endpoints)", "read"],
    ["GET", "exchange/api/v1/api-keys", "admin"], ["POST", "exchange/api/v1/api-keys", "admin"],
    ["POST", `exchange/api/v1/api-keys/${id}/actions/revoke`, "admin"],
    ["POST", `exchange/api/v1/gateway-route-drafts/${id}/actions/confirm`, "admin"],
    ["GET", "integrations/connections", "read"],
    ["GET", `integrations/connections/${workId}/(authorization-health|resources)`, "read"],
    ["POST", `accounts/authorizations/${workId}/renewal-sessions`, "operate"],
    ["GET", `accounts/renewal-sessions/${workId}`, "read"],
    ["POST", `integrations/connections/${workId}/actions/refresh`, "operate"],
    ["GET", "integrations/notifications(?:/events)?", "read"],
    ["POST", `integrations/notifications/${workId}/ack`, "operate"],
    ["GET", `integrations/operations/${workId}`, "read"],
  ];
  if (method === "POST" && path === "/api/proxy/exchange-gateway/v1/chat/completions") return "products.operate";
  const rule = rules.find(([verb, pattern]) => verb === method && new RegExp(`^/api/v1/${pattern}$`).test(path));
  return rule ? `products.${rule[2]}` : null;
}
