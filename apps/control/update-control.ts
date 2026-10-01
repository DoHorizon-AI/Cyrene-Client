// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 update-control.ts                                                │
// │  Module: apps/control                                                │
// │  Role: Authorize and dispatch fixed component-update operations.     │
// │                                                                      │
// │  模块职责：授权并分发受限的本机组件更新命令。                            │
// └─────────────────────────────────────────────────────────────────────┘
import { z } from "zod";
import {
  updateCommands,
  updateHelperResultSchema,
  type UpdateHelperRequest,
  type UpdateHelperResult,
} from "../../packages/component-updates/contracts";
import { ControlError, type Actor } from "../../packages/server-control/contracts";

const commandRequest = z.object({
  name: z.enum(["updates.status", "updates.check", "updates.stage", "updates.apply"]),
  input: z.unknown(),
  requestId: z.string().min(1).max(100),
  idempotencyKey: z.string().min(1).max(100).optional(),
}).strict();

type Helper = (request: UpdateHelperRequest) => Promise<UpdateHelperResult>;

/** Bind local-only update commands to the OS-scoped helper implementation. */
export function createUpdateControl(helper: Helper) {
  async function execute(raw: unknown, actor: Actor): Promise<UpdateHelperResult> {
    const request = commandRequest.parse(raw);
    const definition = updateCommands[request.name];
    if (!actor.scopes.includes(definition.scope)) throw new ControlError("FORBIDDEN", "没有本机组件更新权限。", 403);

    const input = definition.input.parse(request.input);
    const operation = request.name.slice("updates.".length) as UpdateHelperRequest["operation"];
    const helperRequest = {
      protocolVersion: "cyrene.component-updates.helper.v1",
      operation,
      ...input,
    } as UpdateHelperRequest;

    // The helper must atomically re-read the authenticated maintenance gate during apply.
    // Control never turns a stale UI snapshot into permission to restart a service.
    return updateHelperResultSchema.parse(await helper(helperRequest));
  }

  return {
    commands: updateCommands,
    execute,
  };
}
