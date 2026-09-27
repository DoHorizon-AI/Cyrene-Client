import type { PipelineNode } from "../pipeline-model";
import type { Capabilities, Observation, Outputs, Placement } from "./contracts";
import type { ResolvedServer } from "../server-control/contracts";
export interface Assignment {
  workspaceId: string; runId: string; node: PipelineNode; attemptId: string; generation: number;
  inputs: Outputs; placement: Placement; image: string; checkpoint?: Outputs[string];
  targets?: ResolvedServer[];
}
/** Product owns the task; its implementation obtains Platform Lease/Fence.
 * start must durably deduplicate attemptId BEFORE creating external work.
 * lookup(absent) must be authoritative, including after provider restart.
 */
export interface ExecutionAdapter {
  preflight(node: PipelineNode, placement: Placement, workspaceId: string, targets?: ResolvedServer[]): Promise<Capabilities>;
  start(assignment: Assignment): Promise<Observation>;
  lookup(attemptId: string, workspaceId: string): Promise<Observation>;
  stop(attemptId: string, workspaceId: string, idempotencyKey: string): Promise<Observation>;
  change(attemptId: string, workspaceId: string, config: PipelineNode["config"], idempotencyKey: string): Promise<Observation>;
}
