import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/** One authenticated server per request: credentials and permissions are never
 * cached in a protocol session. Business state lives in the control stores. */
export async function serveMcp(req: IncomingMessage, res: ServerResponse, server: McpServer, body?: unknown) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.setHeader("cache-control", "no-store");
  res.once("close", () => { void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) { await server.close(); throw error; }
}
