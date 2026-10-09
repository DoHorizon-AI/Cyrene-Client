import type { z } from "zod";
import type { Actor } from "../server-control/contracts";
import { commands as serverCommands } from "../server-control/contracts";
import { pipelineCommands } from "../pipeline-control/contracts";
import { runCommands } from "../run-control/contracts";
import { buildCommands } from "../build-control/contracts";
import { monitoringCommands } from "../monitoring/contracts";
import { catalogCommands } from "../node-registry/commands";

/** Shared HTTP and MCP command contract. Transport names do not grant authority. */
export interface CommandDefinition {
  input: z.AnyZodObject;
  output: z.AnyZodObject;
  description: string;
  readOnly: boolean;
  requiredScopes: readonly string[];
  effects: "read" | "additive" | "update" | "destructive";
  external: boolean;
}

export const allCommandDefinitions = {
  ...pipelineCommands, ...runCommands, ...buildCommands, ...monitoringCommands,
  ...catalogCommands, ...serverCommands,
} satisfies Record<string, CommandDefinition>;

export function permitsCommand(actor: Actor, definition: CommandDefinition, readOnly = false) {
  return (!readOnly || definition.readOnly) && definition.requiredScopes.every(scope => actor.scopes.includes(scope));
}

export function permittedCommands(actor: Actor, readOnly = false) {
  return Object.entries(allCommandDefinitions).filter(([, definition]) => permitsCommand(actor, definition, readOnly)).map(([name]) => name);
}

export const wireToolName = (name: string) => name.replaceAll(".", "_");
