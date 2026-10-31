import type { NavigatorTransport } from "./transport";
import type { JsonRecord, TrainingDraftSpecInput } from "./types";
import { NavigatorContractError } from "./errors";
import { NAVIGATOR_PROXY_PATHS } from "./constants";
import { parseResourceArray, parseResource } from "./parsers/validation";
import { jsonRequest, toHttpError } from "./requests";

export class TrainingApi {
  constructor(private readonly transport: NavigatorTransport) {}

  /**
   * List Yield-owned training drafts through the Navigator proxy.
   * 中文：通过 Navigator 代理列出 Yield 管理的训练草稿。
   */
  async getTrainingDrafts(): Promise<JsonRecord[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-drafts`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Persist a draft's base model and hyperparameters before launch.
   *
   * Yield owns these values; without this call the training run starts with
   * whatever the draft already carried and any UI edits are silently lost.
      * 中文：在启动前，将草稿的基础模型和超参数持久化保存到 Yield。
   *
   * 中文：这些值由 Yield 管理；如果不调用此接口，训练会使用草稿当前已有的值，UI 中的修改会被静默丢弃。
   */
  async updateTrainingDraft(id: string, spec: TrainingDraftSpecInput): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-drafts/${encodeURIComponent(id)}`,
      jsonRequest("PATCH", spec, true),
      parseResource,
    );
  }

  /**
   * Start one prepared training draft.
   * 中文：启动一个已准备好的训练草稿。
   */
  async startTrainingDraft(id: string, idempotencyKey?: string): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-drafts/${encodeURIComponent(id)}/actions/start`,
      jsonRequest("POST", {}, idempotencyKey ?? true),
      parseResource,
    );
  }

  /**
   * Read a Yield training run by its owning Product identifier.
   * 中文：按其所属 Product 标识读取一项 Yield 训练运行。
   */
  async getTrainingRun(id: string, signal?: AbortSignal): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-runs/${encodeURIComponent(id)}`,
      { method: "GET", signal },
      parseResource,
    );
  }

  /** Read the durable draft link before retrying a launch. 中文：重试启动前读取持久化草稿关联。 */
  async getTrainingDraft(id: string): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-drafts/${encodeURIComponent(id)}`,
      { method: "GET" },
      parseResource,
    );
  }

  /** Resume ordered events through the authenticated proxy. 中文：通过认证代理按游标续读事件。 */
  async openTrainingRunEvents(id: string, afterSequence: number, signal: AbortSignal): Promise<Response> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new NavigatorContractError("Invalid training event cursor.");
    }
    const path = `${NAVIGATOR_PROXY_PATHS.yield}/training-runs/${encodeURIComponent(id)}/events/stream?after_sequence=${afterSequence}`;
    const response = await this.transport.requestResponse(path, {
      method: "GET", signal,
      headers: { Accept: "text/event-stream", "Last-Event-ID": String(afterSequence) },
    });
    if (!response.ok) {
      // Keep the HTTP status even when a proxy returns a non-JSON error page.
      // 中文：代理返回非 JSON 错误页时仍保留 HTTP 状态。
      let problem: unknown;
      try { problem = await response.json(); } catch { problem = undefined; }
      throw toHttpError(response.status, problem);
    }
    if (!response.body || response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/event-stream") {
      await response.body?.cancel();
      throw new NavigatorContractError("Yield did not return an event stream.");
    }
    return response;
  }

  /**
   * Resume a stopped run from a complete checkpoint.
   *
   * Yield requires an explicit checkpoint, so the caller passes the name
   * observed in the event stream rather than relying on an implicit "latest".
      * 中文：从完整检查点恢复一项已停止的运行。
   *
   * 中文：Yield 要求显式指定检查点，因此调用方应传入从事件流中观察到的名称，而不能依赖隐式的“最新”检查点。
   */
  async resumeTrainingRun(
    runId: string,
    checkpointName?: string,
    idempotencyKey?: string,
  ): Promise<JsonRecord> {
    const body = checkpointName ? { checkpointName } : {};
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-runs/${encodeURIComponent(runId)}/actions/resume`,
      jsonRequest("POST", body, idempotencyKey ?? true),
      parseResource,
    );
  }

  /**
   * Hand a completed training result to Reactor for deployment.
   * 中文：将已完成的训练结果交给 Reactor 部署。
   */
  async sendResultToReactor(resultId: string): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-results/${encodeURIComponent(resultId)}/actions/send-to-reactor`,
      jsonRequest("POST", {}, false),
      parseResource,
    );
  }

  /**
   * Read public attempt diagnostics for one training run.
   * 中文：读取某次训练运行公开的尝试诊断信息。
   */
  async getTrainingRunAttempts(id: string, signal?: AbortSignal): Promise<JsonRecord[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-runs/${encodeURIComponent(id)}/attempts`,
      { method: "GET", signal },
      parseResourceArray,
    );
  }

  /**
   * Request cancellation without pretending that cancellation is synchronous.
   * 中文：请求取消操作；不会假装取消是同步完成的。
   */
  async cancelTrainingRun(id: string): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-runs/${encodeURIComponent(id)}/actions/cancel`,
      jsonRequest("POST", {}, true),
      parseResource,
    );
  }
}
