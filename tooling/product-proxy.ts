// Product operations exposed by the migrated management pages. No arbitrary paths.
export function productPermission(method: string, path: string): string | null {
  if (/%(?:2f|5c|2e|25|00)/i.test(path) || path.includes("..") || path.includes("\\")) return null;
  const id = "[A-Za-z0-9_-]+";
  const rules: [string, string, string][] = [
    ["GET", "system/status", "read"],
    ["GET", "credentials", "admin"], ["POST", "credentials", "admin"], ["DELETE", `credentials/${id}`, "admin"],
    ["GET", "reactor/(model-imports|serving-bindings|deployments)", "read"],
    ["POST", "reactor/model-imports", "write"],
    ["GET", `reactor/deployments/${id}/events`, "read"],
    ["POST", `reactor/deployments/${id}/actions/stop`, "operate"],
    ["GET", "catalyst/datasets", "read"], ["POST", "catalyst/datasets", "write"],
    ["GET", `catalyst/datasets/${id}/(preparations|versions)`, "read"],
    ["POST", `catalyst/datasets/${id}/preparations`, "write"],
    ["GET", `catalyst/dataset-versions/${id}(?:/preview)?`, "read"],
    ["PATCH", `catalyst/preparations/${id}/mapping`, "write"],
    ["POST", `catalyst/preparations/${id}/(confirm|publish|yield-draft)`, "operate"],
    ["GET", `yield/training-drafts(?:/${id})?`, "read"],
    ["PATCH", `yield/training-drafts/${id}`, "write"],
    ["POST", `yield/training-drafts/${id}/actions/start`, "operate"],
    ["GET", `yield/(?:api/v1/)?training-runs/${id}(?:/attempts|/events/stream)?`, "read"],
    ["POST", `yield/training-runs/${id}/actions/(resume|cancel)`, "operate"],
    ["POST", `yield/training-results/${id}/actions/send-to-reactor`, "operate"],
    ["GET", `echo/evaluation-suites/${id}`, "read"], ["POST", "echo/evaluation-suites", "write"],
    ["GET", "exchange/api/v1/(gateway-routes|gateway-endpoints)", "read"],
    ["GET", "exchange/api/v1/api-keys", "admin"], ["POST", "exchange/api/v1/api-keys", "admin"],
    ["POST", `exchange/api/v1/api-keys/${id}/actions/revoke`, "admin"],
    ["POST", `exchange/api/v1/gateway-route-drafts/${id}/actions/confirm`, "admin"],
    ["GET", "navigator/active-route", "read"], ["POST", "navigator/active-route", "operate"],
    ["GET", `navigator/harness/workspaces/${id}/sessions`, "read"],
  ];
  if (method === "POST" && path === "/api/proxy/exchange-gateway/v1/chat/completions") return "products.operate";
  const rule = rules.find(([verb, pattern]) => verb === method && new RegExp(`^/api/v1/${pattern}$`).test(path));
  return rule ? `products.${rule[2]}` : null;
}
