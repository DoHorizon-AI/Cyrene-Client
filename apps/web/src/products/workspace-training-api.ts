// Role: Observe private Yield runs through catalog-backed Workspace invocations.
// 中文：通过目录中的 Workspace 调用观察 Yield 私有任务。

import { z } from "zod";
import { NavigatorContractError, NavigatorHttpError, type JsonRecord } from "../../services/navigator/src/api";
import type { TrainingRunClient } from "../../services/navigator/src/use-training-run";
import { WorkspaceBffClient, WorkspaceBffError } from "../services/workspace-bff-client";

const RUN_STATES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLING", "CANCELLED", "AWAITING_RETRY"] as const;
const scopeSchema = z.object({ organizationId: z.string().min(1), workspaceId: z.string().min(1), trainingRunId: z.string().uuid() });
const runSchema = scopeSchema.extend({ id: z.string().uuid(), state: z.enum(RUN_STATES) }).passthrough();
const eventSchema = z.object({ sequence: z.number().int().positive().safe(), trainingRunId: z.string().uuid(), kind: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/) }).passthrough();
const eventsSchema = scopeSchema.extend({
  events: z.array(eventSchema).max(100), afterSequence: z.number().int().nonnegative().safe(),
  nextSequence: z.number().int().nonnegative().safe(), terminal: z.boolean(), state: z.enum(RUN_STATES),
});
const attemptsSchema = scopeSchema.extend({ attempts: z.array(z.object({ trainingRunId: z.string().uuid() }).passthrough()).max(100) });

/** The adapter only accepts workspace/resource IDs; target URLs and roles stay server-owned.
 * 中文：适配器只接受 Workspace/资源 ID；目标地址与角色由服务端管理。
 */
export class WorkspaceTrainingClient implements TrainingRunClient {
  readonly capabilities = { cancel: false, resume: false, deploy: false };

  constructor(private readonly bff: WorkspaceBffClient, readonly workspaceId: string, readonly organizationId: string) {}

  async getTrainingRun(id: string, signal?: AbortSignal): Promise<JsonRecord> {
    const value = runSchema.safeParse(await this.invoke("workspaceGetRun", id, { signal }));
    if (!value.success || value.data.id !== id) throw new NavigatorContractError("Workspace returned an invalid training run.");
    this.checkScope(value.data, id);
    return value.data;
  }

  async getTrainingRunAttempts(id: string, signal?: AbortSignal): Promise<JsonRecord[]> {
    const value = attemptsSchema.safeParse(await this.invoke("workspaceListRunAttempts", id, { signal }));
    if (!value.success) throw new NavigatorContractError("Workspace returned invalid training attempts.");
    this.checkScope(value.data, id);
    if (value.data.attempts.some((attempt) => attempt.trainingRunId !== id)) throw new NavigatorContractError("Workspace returned attempts for a different run.");
    return value.data.attempts;
  }

  /** Adapt bounded JSON pages to the common event reader without a legacy SSE request.
   * 中文：将有界 JSON 事件页交给通用读取器，不请求旧版 SSE 接口。
   */
  async openTrainingRunEvents(id: string, initialCursor: number, signal: AbortSignal): Promise<Response> {
    if (!Number.isSafeInteger(initialCursor) || initialCursor < 0) throw new NavigatorContractError("Invalid training event cursor.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    let cursor = initialCursor, empty = false, closed = false;
    const cleanup = () => { closed = true; controller.abort(); signal.removeEventListener("abort", abort); };
    let firstPage: unknown;
    let hasFirstPage = true;
    try {
      firstPage = await this.invoke("workspaceListRunEvents", id, { body: { afterSequence: cursor, limit: 100 }, signal: controller.signal });
      controller.signal.throwIfAborted();
    } catch (error) { cleanup(); throw error; }
    const body = new ReadableStream<Uint8Array>({
      pull: async (stream) => {
        try {
          while (!closed) {
            if (empty) await wait(1500, controller.signal);
            controller.signal.throwIfAborted();
            const value = eventsSchema.safeParse(hasFirstPage ? firstPage : await this.invoke("workspaceListRunEvents", id, {
              body: { afterSequence: cursor, limit: 100 }, signal: controller.signal,
            }));
            hasFirstPage = false;
            controller.signal.throwIfAborted();
            if (!value.success) throw new NavigatorContractError("Workspace returned an invalid event page.");
            const page = value.data;
            this.checkScope(page, id);
            if (page.afterSequence !== cursor) throw new NavigatorContractError("Workspace returned a different event cursor.");
            let next = cursor;
            for (const event of page.events) {
              if (event.trainingRunId !== id || event.sequence <= next) throw new NavigatorContractError("Workspace returned unordered or foreign events.");
              next = event.sequence;
            }
            if (page.nextSequence !== next || page.terminal !== ["COMPLETED", "FAILED", "CANCELLED"].includes(page.state)) {
              throw new NavigatorContractError("Workspace returned inconsistent event progress.");
            }
            cursor = next;
            const encoder = new TextEncoder();
            for (const event of page.events) {
              stream.enqueue(encoder.encode(`id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`));
            }
            empty = page.events.length === 0;
            // A terminal page can still have successors. Drain to an empty page.
            // 中文：终态任务也可能还有后续页，读空后才结束。
            if (page.terminal && empty) {
              stream.enqueue(encoder.encode(`id: ${cursor}\nevent: done\ndata: ${JSON.stringify({ sequence: cursor, state: page.state })}\n\n`));
              stream.close();
              cleanup();
              return;
            }
            if (!empty) return;
          }
        } catch (error) {
          if (!closed) stream.error(error);
          cleanup();
        }
      },
      cancel: cleanup,
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  }

  async getDraft(id: string, signal?: AbortSignal): Promise<JsonRecord> {
    const result = z.object({ id: z.string().uuid(), state: z.enum(["DRAFT", "PREPARED", "STARTED"]), trainingRunId: z.string().uuid().nullable().optional() })
      .passthrough().safeParse(await this.invoke("workspaceGetDraft", id, { signal }));
    if (!result.success || result.data.id !== id) throw new NavigatorContractError("Workspace returned a different training draft.");
    return result.data;
  }

  async startDraft(id: string, idempotencyKey: string, signal?: AbortSignal): Promise<string> {
    const draft = await this.getDraft(id, signal);
    if (typeof draft.trainingRunId === "string") return draft.trainingRunId;
    signal?.throwIfAborted();
    if (draft.state !== "PREPARED") throw new NavigatorContractError("Prepare this training draft in Yield before starting it.");
    const result = z.object({ id: z.string().uuid(), draftId: z.string().uuid() }).passthrough()
      .safeParse(await this.invoke("workspaceStartRun", id, { idempotencyKey, signal }));
    if (!result.success || result.data.draftId !== id) throw new NavigatorContractError("Workspace returned a run for a different draft.");
    return result.data.id;
  }

  async cancelTrainingRun(): Promise<JsonRecord> { throw unavailable(); }
  async resumeTrainingRun(): Promise<JsonRecord> { throw unavailable(); }
  async sendResultToReactor(): Promise<JsonRecord> { throw unavailable(); }

  private checkScope(scope: z.infer<typeof scopeSchema>, runId: string): void {
    if (scope.organizationId !== this.organizationId || scope.workspaceId !== this.workspaceId || scope.trainingRunId !== runId) {
      throw new NavigatorContractError("Workspace returned training data outside the selected scope.");
    }
  }

  private async invoke(operationId: string, resourceId: string, options: { body?: unknown; signal?: AbortSignal; idempotencyKey?: string }): Promise<unknown> {
    try {
      return await this.bff.invoke(this.workspaceId, { ownerId: "yield", operationId }, { resourceId, ...options });
    } catch (error) {
      if (error instanceof WorkspaceBffError) {
        if (["session_changed", "workspace_not_discovered", "workspace_selection_required"].includes(error.code)) {
          throw new NavigatorHttpError(401, error.code, error.message, false);
        }
        if (["invalid_response", "invalid_upstream_response", "workspace_discovery_invalid", "invalid_request", "feature_disabled"].includes(error.code)) {
          throw new NavigatorContractError(error.message);
        }
        throw new NavigatorHttpError(error.status || 503, error.code, error.message, error.status >= 500 || error.status === 0);
      }
      throw error;
    }
  }
}

function unavailable(): NavigatorContractError {
  return new NavigatorContractError("This operation is not available through the selected Workspace connection.");
}

function wait(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
    signal.addEventListener("abort", abort, { once: true });
  });
}
