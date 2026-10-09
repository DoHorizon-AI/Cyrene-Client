const id = "[A-Za-z0-9_-]+";
const workId = "(?:[A-Za-z0-9_.:-]|%3[Aa])+";
const providerId = "[a-z][a-z0-9-]{0,63}";
const defaultBodyLimit = 1_048_576;

export interface ProxyBodyViolation { code: string; message: string; status: number }
interface NavigatorPolicyOptions {
  workspace?: "host" | "path";
  browserOnly?: boolean;
  maxBodyBytes?: number;
  upstream?: "tasks" | "assistant" | "approvals";
  validateBody?: (input: unknown, mode: "local" | "team") => ProxyBodyViolation | null;
}
export interface NavigatorProxyPolicy extends NavigatorPolicyOptions {
  method: string;
  path: RegExp;
  permission: string;
  maxBodyBytes: number;
}

function taskBodyViolation(input: unknown, mode: "local" | "team"): ProxyBodyViolation | null {
  if (!input || typeof input !== "object") return null;
  if (["cwd", "agentPreset", "timeoutMs"].some(field => Object.hasOwn(input, field))) {
    return { code: "RESERVED_EXECUTION_FIELD", message: "执行目录、预设和超时由宿主管理，不能通过浏览器任务指定。", status: 403 };
  }
  if ("metadata" in input && input.metadata && typeof input.metadata === "object" && "navigator" in input.metadata) {
    return { code: "RESERVED_EXECUTION_METADATA", message: "Navigator 执行配置由宿主管理，不能通过任务 metadata 修改。", status: 403 };
  }
  if (mode === "team" && ("execution" in input || "runtime" in input)) {
    return { code: "PERSONAL_RUNTIME_LOCAL_ONLY", message: "个人智能体执行需要 local 模式；团队任务使用已配置的 Navigator 执行器。", status: 403 };
  }
  return null;
}

function policy(method: string, path: string, access: string, options: NavigatorPolicyOptions = {}): NavigatorProxyPolicy {
  return { method, path: new RegExp(`^/api/v1/${path}$`), permission: `products.${access}`, maxBodyBytes: defaultBodyLimit, ...options };
}

/** One policy owns admission, workspace checks, body checks, limits and rewrites. */
export const navigatorProxyPolicies: readonly NavigatorProxyPolicy[] = [
  policy("GET", "navigator/active-route", "read"),
  policy("POST", "navigator/active-route", "operate"),
  policy("GET", "navigator/assistant/capabilities", "read", { workspace: "host", upstream: "assistant" }),
  policy("GET", "navigator/assistant/providers", "admin", { workspace: "host", upstream: "assistant" }),
  policy("PUT", `navigator/assistant/providers/${providerId}`, "admin", { workspace: "host", browserOnly: true, upstream: "assistant" }),
  policy("DELETE", `navigator/assistant/providers/${providerId}`, "admin", { workspace: "host", browserOnly: true, upstream: "assistant" }),
  policy("GET", `navigator/harness/workspaces/(${id})/sessions`, "read", { workspace: "path" }),
  policy("GET", "navigator/tasks", "read", { workspace: "host", upstream: "tasks" }),
  policy("POST", "navigator/tasks", "operate", { workspace: "host", upstream: "tasks", validateBody: taskBodyViolation }),
  policy("GET", `navigator/tasks/${id}(?:/events)?`, "read", { workspace: "host", upstream: "tasks" }),
  policy("POST", `navigator/tasks/${id}/cancel`, "operate", { workspace: "host", upstream: "tasks" }),
  policy("GET", "navigator/approvals", "read", { workspace: "host", upstream: "approvals" }),
  policy("POST", `navigator/approvals/${id}/resolve`, "operate", { workspace: "host", upstream: "approvals" }),
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
  ];
  if (method === "POST" && path === "/api/proxy/exchange-gateway/v1/chat/completions") return "products.operate";
  const rule = rules.find(([verb, pattern]) => verb === method && new RegExp(`^/api/v1/${pattern}$`).test(path));
  return rule ? `products.${rule[2]}` : null;
}
