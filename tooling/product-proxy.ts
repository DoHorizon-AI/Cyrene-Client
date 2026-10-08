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
  if (/%(?:2f|5c|2e|25|00)/i.test(path) || path.includes("..") || path.includes("\\")) return null;
  const id = "[A-Za-z0-9_-]+";
  const workId = "(?:[A-Za-z0-9_.:-]|%3[Aa])+";
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
    ["GET", "navigator/active-route", "read"], ["POST", "navigator/active-route", "operate"],
    ["GET", `navigator/harness/workspaces/${id}/sessions`, "read"],
    ["GET", "navigator/tasks", "read"],
    ["POST", "navigator/tasks", "operate"],
    ["GET", `navigator/tasks/${id}(?:/events)?`, "read"],
    ["POST", `navigator/tasks/${id}/cancel`, "operate"],
    ["GET", "navigator/approvals", "read"],
    ["POST", `navigator/approvals/${id}/resolve`, "operate"],
    ["GET", `workspaces/${workId}/work/approvals(?:/${workId})?`, "read"],
    ["POST", `workspaces/${workId}/work/approvals/${workId}/resolve`, "operate"],
    ["GET", `workspaces/${workId}/work/inputs(?:/${workId})?`, "read"],
    ["POST", `workspaces/${workId}/work/inputs/${workId}/resolve`, "operate"],
    ["GET", `workspaces/${workId}/work/tasks(?:/${workId}(?:/events)?)?`, "read"],
    ["POST", `workspaces/${workId}/work/tasks/${workId}/approvals`, "operate"],
    ["PATCH", `workspaces/${workId}/work/tasks/${workId}`, "operate"],
    ["POST", `workspaces/${workId}/work/tasks/${workId}/events`, "operate"],
    ["GET", `workspaces/${workId}/work/memory/facts`, "read"],
    ["POST", `workspaces/${workId}/work/memory/facts`, "write"],
    ["POST", `workspaces/${workId}/work/memory/query`, "read"],
    ["GET", `workspaces/${workId}/work/notifications`, "read"],
    ["POST", `workspaces/${workId}/work/attachments`, "write"],
    ["GET", `workspaces/${workId}/work/attachments/${workId}`, "read"],
    ["GET", `workspaces/${workId}/work/connectors`, "read"],
    ["GET", `workspaces/${workId}/work/connectors/${workId}/health`, "read"],
    ["GET", `workspaces/${workId}/work/connectors/${workId}/events`, "read"],
    ["POST", `workspaces/${workId}/work/connectors/${workId}/login/qr`, "operate"],
    ["POST", `workspaces/${workId}/work/connectors/${workId}/login/poll`, "operate"],
  ];
  if (method === "POST" && path === "/api/proxy/exchange-gateway/v1/chat/completions") return "products.operate";
  const rule = rules.find(([verb, pattern]) => verb === method && new RegExp(`^/api/v1/${pattern}$`).test(path));
  return rule ? `products.${rule[2]}` : null;
}
