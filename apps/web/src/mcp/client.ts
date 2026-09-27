import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function controlFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch("/studio-team/v1/session", { credentials: "same-origin", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Control session HTTP ${response.status}`);
  const session = await response.json();
  if (!session.authenticated || !session.token) throw new Error("Control session unavailable / 控制会话不可用");
  const headers = new Headers(init?.headers); headers.set("x-studio-control-token", session.token);
  return fetch(input, { ...init, headers, credentials: "same-origin", redirect: "error", signal: init?.signal ?? AbortSignal.timeout(30000) });
}
export async function connectMcp() {
  const client = new Client({ name: "cyrene-workbench", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL("/studio-mcp", window.location.origin), { fetch: controlFetch });
  try { await client.connect(transport); return client; } catch (error) { await client.close(); throw error; }
}
