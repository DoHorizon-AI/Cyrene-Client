import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { CommandExecutor } from "../../packages/control-client";
import { type CommandDefinition, wireToolName } from "../../packages/control-client/commands";
import { ControlError, identifier, type Actor } from "../../packages/server-control/contracts";
import { logError } from "../web/src/logger";

export const writeKey = identifier.describe("Required idempotency key for this write. Reuse the SAME key and SAME parameters after an unknown result: the original receipt is replayed. Different parameters with the same key are rejected as IDEMPOTENCY_CONFLICT. Use a new key only for a new intent after reading current state.");
type Handler = (args: unknown) => Promise<CallToolResult>;
const handlers = new WeakMap<McpServer, Map<string, Handler>>();

function recovery(name: string, outcome: "rejected" | "unknown", readOnly: boolean) {
  const domain = name.split(/[._]/)[0];
  const reads = domain === "nodes" || domain === "pipelines" ? ["pipelines_get", "pipelines_list"]
    : domain === "catalog" ? ["catalog_list_packages"]
    : domain === "monitoring" ? ["monitoring_snapshot"]
    : domain === "servers" ? ["servers_list", "servers_status", "servers_events"]
    : [`${domain}_get`, `${domain}_list`];
  return { readTools: reads, action: outcome === "unknown"
    ? readOnly ? "Read current state; retry this read if needed."
      : "Read current state and retained events first. The write may have completed. If retrying this same intent, reuse the original idempotency key AND parameters; never generate a replacement key to resolve uncertainty."
    : "Read current state and correct the rejected request. A new intent or changed parameters requires a new idempotency key." };
}

function errorResult(name: string, definition: CommandDefinition, requestId: string, error: unknown, started: boolean): CallToolResult {
  const controlled = error instanceof ControlError;
  const outcome = controlled ? error.outcome : started ? "unknown" : "rejected";
  const code = controlled ? error.code : !started && error instanceof z.ZodError ? "INVALID_INPUT" : "CONTROL_ERROR";
  const message = controlled ? error.message : !started && error instanceof z.ZodError
    ? error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")
    : "操作结果尚未确认，请读取当前状态；重试同一写入时保留原幂等键和参数。";
  const response = { code, message, outcome, retryable: outcome === "unknown" || controlled && [429, 502, 503, 504].includes(error.status), requestId,
    recovery: recovery(name, outcome, definition.readOnly), ...(controlled && error.details ? { details: error.details } : {}) };
  logError(`studio.mcp.tool_${outcome}`, outcome === "unknown" ? "STUDIO.MCP.TOOL_UNKNOWN" : "STUDIO.MCP.TOOL_REJECTED", message,
    { tool: name, request_id: requestId, control_code: code, outcome, cause_kind: error instanceof Error ? error.name : "unknown" });
  return { isError: true, content: [{ type: "text", text: JSON.stringify(response) }] };
}

/** Public MCP discovery and execution share one command contract and error envelope. */
export function registerCommand(server: McpServer, name: string, definition: CommandDefinition, executor: CommandExecutor, actor: Actor) {
  const wireName = wireToolName(name);
  if (!/^[a-z0-9_]{1,64}$/.test(wireName)) throw new Error(`Invalid MCP tool name: ${wireName}`);
  let registered = handlers.get(server);
  if (!registered) { registered = new Map(); handlers.set(server, registered); }
  if (registered.has(wireName)) throw new Error(`Duplicate MCP tool name: ${wireName}`);
  if (definition.readOnly !== (definition.effects === "read")) throw new Error(`Inconsistent effects for ${name}`);
  const inputSchema = definition.readOnly ? definition.input : definition.input.extend({ idempotencyKey: writeKey });
  const handler: Handler = async args => {
    const requestId = crypto.randomUUID();
    let started = false;
    try {
      const parsed = inputSchema.parse(args ?? {});
      const { idempotencyKey, ...input } = parsed;
      if (!actor.workspaceIds.includes(input.workspaceId) || !definition.requiredScopes.every(scope => actor.scopes.includes(scope))) {
        throw new ControlError("FORBIDDEN", "没有此工作空间或命令权限。", 403);
      }
      started = true;
      const result = await executor.execute({ name, input, requestId, ...(idempotencyKey ? { idempotencyKey } : {}) }, actor);
      const structuredContent = definition.output.parse(result);
      return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
    } catch (error) { return errorResult(name, definition, requestId, error, started); }
  };
  server.registerTool(wireName, {
    title: name, description: definition.description, inputSchema, outputSchema: definition.output,
    annotations: { title: name, readOnlyHint: definition.readOnly, destructiveHint: definition.effects === "destructive", idempotentHint: true, openWorldHint: definition.external },
  }, handler);
  registered.set(wireName, handler);
  // Keep SDK JSON-RPC validation, but validate command arguments ourselves so SDK
  // cannot replace pre-callback schema errors with unstructured text. No task tools.
  server.server.setRequestHandler(CallToolRequestSchema, request => {
    const handle = registered.get(request.params.name);
    if (request.params.task) return Promise.resolve(errorResult(request.params.name, definition, crypto.randomUUID(), new ControlError("TASK_UNSUPPORTED", "此工具不支持 MCP task augmentation。"), false));
    return handle ? handle(request.params.arguments) : Promise.resolve(errorResult(request.params.name, definition, crypto.randomUUID(), new ControlError("UNKNOWN_COMMAND", "工具不存在或当前身份无权调用。", 403), false));
  });
}
