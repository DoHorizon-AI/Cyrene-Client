// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 workload-control.ts                                              │
// │  Module: apps/control                                                │
// │  Role: Authorize and dispatch fixed local workload-plan operations. │
// │                                                                      │
// │  模块职责：授权并分发受限的本机工作负载安装计划命令。                   │
// └─────────────────────────────────────────────────────────────────────┘
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  stableJson,
  workloadCommands,
  type WorkloadPlanHelperRequest,
  type WorkloadPlanResult,
} from "../../packages/workload-plan/contracts";
import { ControlError, type Actor } from "../../packages/server-control/contracts";

const commandRequest = z.object({
  name: z.enum(["workloads.status", "workloads.check", "workloads.stage", "workloads.apply"]),
  input: z.unknown(),
  requestId: z.string().min(1).max(100),
  idempotencyKey: z.string().min(1).max(100).optional(),
}).strict();

type Helper = (request: WorkloadPlanHelperRequest) => Promise<WorkloadPlanResult>;

/** Bind local-only workload commands to the trusted OS-scoped CLI implementation. */
export function createWorkloadControl(helper: Helper) {
  async function execute(raw: unknown, actor: Actor): Promise<WorkloadPlanResult> {
    const request = commandRequest.parse(raw);
    const definition = workloadCommands[request.name];
    if (!actor.scopes.includes(definition.scope)) throw new ControlError("FORBIDDEN", "没有本机工作负载安装权限。", 403);

    const input = definition.input.parse(request.input);
    const operation = request.name.slice("workloads.".length) as WorkloadPlanHelperRequest["operation"];
    const helperRequest = {
      protocolVersion: "cyrene.workload-plan.v1",
      operation,
      ...input,
    } as WorkloadPlanHelperRequest;

    const result = definition.output.parse(await helper(helperRequest)) as WorkloadPlanResult;
    if (result.workloadId !== helperRequest.workloadId || result.targetId !== helperRequest.targetId) {
      throw new ControlError("WORKLOAD_RESULT_MISMATCH", "本机 workload CLI 返回的工作负载或目标与请求不匹配。", 502);
    }
    if ("resolution" in result) {
      const actualDigest = `sha256:${createHash("sha256").update(stableJson(result.resolution.planDigestMaterial), "utf8").digest("hex")}`;
      if (actualDigest !== result.resolution.planDigest) {
        throw new ControlError("WORKLOAD_PLAN_DIGEST", "本机 workload CLI 返回的计划摘要与解析内容不匹配。", 502);
      }
      const requestedAction = "action" in helperRequest ? helperRequest.action : undefined;
      if (requestedAction && requestedAction !== result.resolution.action) {
        throw new ControlError("WORKLOAD_ACTION_MISMATCH", "本机 workload CLI 返回的计划操作与请求不匹配。", 502);
      }
      const selectionBinding = {
        includeComponentIds: [...helperRequest.selections.includeComponentIds].sort(),
        excludeComponentIds: [...helperRequest.selections.excludeComponentIds].sort(),
        choices: Object.fromEntries(Object.entries(helperRequest.selections.choices).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
      };
      if (stableJson(selectionBinding) !== stableJson(result.resolution.selectionBinding)) {
        throw new ControlError("WORKLOAD_SELECTION_MISMATCH", "本机 workload CLI 返回的计划选择与请求不匹配。", 502);
      }
      const requestedPlan = "planId" in helperRequest ? helperRequest : undefined;
      if (requestedPlan && (requestedPlan.planId !== result.planId || requestedPlan.planDigest !== result.planDigest || requestedPlan.action !== result.resolution.action)) {
        throw new ControlError("WORKLOAD_PLAN_CHANGED", "计划已变化；请重新检查并确认最新计划。", 409);
      }
    }
    return result;
  }

  return { commands: workloadCommands, execute };
}
