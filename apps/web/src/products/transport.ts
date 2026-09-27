// The gateway key must not be interpreted as a Studio bearer credential.
export const studioProductFetch: typeof fetch = async (input, init = {}) => {
  const headers = new Headers(init.headers), method = (init.method ?? "GET").toUpperCase();
  if (headers.has("authorization")) {
    headers.set("x-product-authorization", headers.get("authorization")!); headers.delete("authorization");
  }
  if (!["GET", "HEAD"].includes(method)) {
    const response = await fetch("/studio-team/v1/session", { credentials: "same-origin", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Studio session unavailable");
    const session = await response.json();
    if (!session.authenticated) throw new Error("Studio authentication required");
    headers.set("x-studio-control-token", session.token);
  }
  return fetch(input, { ...init, headers, credentials: "same-origin", redirect: "error" });
};
