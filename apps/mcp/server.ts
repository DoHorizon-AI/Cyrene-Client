import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// stderr only: this process's stdout carries the MCP protocol stream.
// 仅向 stderr 写日志：此进程的 stdout 用于承载 MCP 协议流。
import { logError } from "../web/src/logger";
import { PipelineControl } from "../../packages/pipeline-control/service";
import { pipelineCommands } from "../../packages/pipeline-control/contracts";
import { ControlError, identifier, type Actor } from "../../packages/server-control/contracts";

export function createMcpServer(control: PipelineControl, actor: Actor) {
  const server = new McpServer({ name: "cyrene-client", version: "0.1.0" });
  for (const [name, command] of Object.entries(pipelineCommands)) {
    if (command.readOnly && !actor.scopes.includes("pipelines.read")) continue;
    const writable = actor.scopes.includes("pipelines.write");
    if (!command.readOnly && !writable) continue;
    const inputSchema = command.readOnly ? command.input : command.input.extend({ idempotencyKey: identifier });
    server.registerTool(name, {
      description: command.description,
      inputSchema, outputSchema: command.output,
      annotations: { readOnlyHint: command.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (args: Record<string, unknown>) => {
      try {
        const { idempotencyKey, ...input } = args;
        const result = await control.execute({ name, input, requestId: crypto.randomUUID(), ...(idempotencyKey ? { idempotencyKey } : {}) }, actor);
        const structuredContent = command.output.parse(result);
        return { content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }], structuredContent };
      } catch (e) {
        const error = e instanceof ControlError ? { code: e.code, message: e.message } : e instanceof z.ZodError ? { code: "INVALID_INPUT", message: e.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") } : { code: "CONTROL_ERROR", message: "操作未完成；草稿未被自动重置，请读取当前版本后重试。" };
        if (e instanceof ControlError) {
          logError("studio.mcp.tool_rejected", "STUDIO.MCP.CONTROL_REJECTED", "流水线工具调用被控制层拒绝。", {
            tool: name,
            control_code: e.code,
            outcome: "rejected",
          });
        } else if (e instanceof z.ZodError) {
          logError("studio.mcp.tool_input_invalid", "STUDIO.MCP.INVALID_INPUT", "流水线工具入参未通过契约校验。", {
            tool: name,
            outcome: "rejected",
          });
        } else {
          logError("studio.mcp.tool_failed", "STUDIO.MCP.TOOL_FAILED", "流水线工具调用未完成；操作结果未知。", {
            tool: name,
            outcome: "unknown",
            cause_kind: e instanceof Error ? e.name : "unknown",
          });
        }
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(error) }] };
      }
    });
  }
  return server;
}
