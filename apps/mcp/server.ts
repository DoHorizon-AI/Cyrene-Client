import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandExecutor } from "../../packages/control-client";
import { pipelineCommands } from "../../packages/pipeline-control/contracts";
import { ControlError, identifier, type Actor } from "../../packages/server-control/contracts";
import { runCommands } from "../../packages/run-control/contracts";
import { buildCommands } from "../../packages/build-control/contracts";
import { catalogCommands } from "../../packages/node-registry/commands";
import { commands as serverCommands } from "../../packages/server-control/contracts";

export function createMcpServer(control: CommandExecutor, actor: Actor, runs?: CommandExecutor, extra: { builds?: CommandExecutor; catalog?: CommandExecutor; servers?: CommandExecutor; readOnly?: boolean } = {}) {
  const server = new McpServer({ name: "cyrene-studio", version: "0.1.0" });
  for (const [name, command] of Object.entries(pipelineCommands)) {
    if (command.readOnly && !actor.scopes.includes("pipelines.read")) continue;
    const writable = actor.scopes.includes("pipelines.write");
    if (!command.readOnly && (!writable || extra.readOnly)) continue;
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
  type Definition = { input: z.AnyZodObject; output: z.AnyZodObject; readOnly: boolean; description?: string; scope?: string };
  const groups: [CommandExecutor | undefined, Record<string, Definition>, string][] = [[runs, runCommands, "runs"], [extra.builds, buildCommands, "builds"], [extra.catalog, catalogCommands, "catalog"], [extra.servers, serverCommands, "servers"]];
  for (const [executor, definitions, domain] of groups) {
  if (!executor) continue;
  for (const [name, command] of Object.entries(definitions)) {
    if ((extra.readOnly && !command.readOnly) || !actor.scopes.includes(command.scope ?? `${domain}.${command.readOnly ? "read" : "write"}`)) continue;
    server.registerTool(name, {
      description: command.description,
      inputSchema: command.readOnly ? command.input : command.input.extend({ idempotencyKey: identifier }), outputSchema: command.output,
      annotations: { readOnlyHint: command.readOnly, destructiveHint: !command.readOnly, idempotentHint: true, openWorldHint: true },
    }, async (args: Record<string, unknown>) => {
      try {
        const { idempotencyKey, ...input } = args;
        const structuredContent = command.output.parse(await executor.execute({ name, input, requestId: crypto.randomUUID(), ...(idempotencyKey ? { idempotencyKey } : {}) }, actor));
        return { content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }], structuredContent };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(error instanceof ControlError ? { code: error.code, message: error.message } : { code: "CONTROL_ERROR", message: "操作未确认，请读取当前状态后重试。" }) }] };
      }
    });
  }
  }
  return server;
}
