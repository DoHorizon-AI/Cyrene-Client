import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PipelineControl } from "../../packages/pipeline-control/service";
import { pipelineCommands } from "../../packages/pipeline-control/contracts";
import { ControlError, identifier, type Actor } from "../../packages/server-control/contracts";

export function createMcpServer(control: PipelineControl, actor: Actor) {
  const server = new McpServer({ name: "cyrene-studio", version: "0.1.0" });
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
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(error) }] };
      }
    });
  }
  return server;
}
