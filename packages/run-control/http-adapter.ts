import { capabilitiesSchema, observationSchema } from "./contracts";
import type { Assignment, ExecutionAdapter } from "./adapter";
import type { PipelineNode } from "../pipeline-model";
import type { Placement } from "./contracts";
import { ControlError, type ResolvedServer } from "../server-control/contracts";

/** Only administrator-configured Product origins are accepted. Node input never
 * chooses a URL, bearer credential, Docker endpoint, or launch command. */
export class ProductExecutionAdapter implements ExecutionAdapter {
  constructor(private origin: string, private bearer: string) {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Product origin must not contain a path or credentials");
    if (!bearer) throw new Error("Product execution requires a service credential");
    this.origin = url.origin;
  }
  private async call(path: string, body?: unknown) {
    const response = await fetch(`${this.origin}/api/v1/studio-execution${path}`, { method: body === undefined ? "GET" : "POST", redirect: "error", headers: { authorization: `Bearer ${this.bearer}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    let result: any = {};
    try { result = await response.json(); } catch { /* Preserve the HTTP status for non-JSON gateway errors. */ }
    if (!response.ok) throw new ControlError(
      result.error?.code ?? result.code ?? result.title ?? "EXECUTION_REJECTED",
      result.error?.message ?? result.detail ?? "Product 执行接口拒绝请求。",
      response.status,
    );
    return result;
  }
  async preflight(node: PipelineNode, placement: Placement, workspaceId: string, targets?: ResolvedServer[]) { return capabilitiesSchema.parse(await this.call("/preflight", { workspaceId, node, placement, targets: targets ?? [] })); }
  async start(assignment: Assignment) { return observationSchema.parse(await this.call("/attempts", assignment)); }
  async lookup(attemptId: string, workspaceId: string) { return observationSchema.parse(await this.call(`/attempts/${encodeURIComponent(attemptId)}?workspaceId=${encodeURIComponent(workspaceId)}`)); }
  async stop(attemptId: string, workspaceId: string, idempotencyKey: string) { return observationSchema.parse(await this.call(`/attempts/${encodeURIComponent(attemptId)}/stop`, { workspaceId, idempotencyKey })); }
  async change(attemptId: string, workspaceId: string, config: PipelineNode["config"], idempotencyKey: string) { return observationSchema.parse(await this.call(`/attempts/${encodeURIComponent(attemptId)}/change`, { workspaceId, config, idempotencyKey })); }
}
