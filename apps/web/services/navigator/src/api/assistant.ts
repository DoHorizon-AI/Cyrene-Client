import type { NavigatorTransport } from "./transport";
import type { ExecutorTaskCreateInput, NavigatorTaskRecord, NavigatorTaskPage } from "./types";
import { NavigatorContractError } from "./errors";
import { parseTaskRecord, parseTaskPage, parseTaskCancellation } from "./parsers/assistant";
import { jsonRequest, makeIdempotencyKey, toHttpError } from "./requests";

export class AssistantApi {
  constructor(private readonly transport: NavigatorTransport) {}

  /**
   * Read the server-owned assistant task ledger through Control and Web Host.
   * 中文：经 Control 与 Web Host 读取服务端管理的助手任务记录。
   */
  async getAssistantTasks(cursor?: string, limit = 50): Promise<NavigatorTaskPage> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    return this.transport.requestJson(
      `/api/v1/navigator/tasks?${query}`,
      { method: "GET" },
      parseTaskPage,
    );
  }

  /**
   * Submit a prompt; omitting sessionId asks Navigator to create a fresh agent session.
   * 中文：提交提示词；省略 sessionId 时由 Navigator 创建新的 agent 会话。
   */
  async createAssistantTask(input: ExecutorTaskCreateInput, requestId?: string): Promise<NavigatorTaskRecord> {
    if (requestId && input.taskId && requestId !== input.taskId) {
      throw new NavigatorContractError("Task request id must match the task id.");
    }
    const taskId = input.taskId ?? requestId ?? makeIdempotencyKey();
    return this.transport.requestJson(
      "/api/v1/navigator/tasks",
      jsonRequest("POST", { ...input, taskId }, taskId),
      parseTaskRecord,
    );
  }

  /** Read the latest server-owned projection for one task. 中文：读取单项任务的最新服务端投影。 */
  async getAssistantTask(id: string, signal?: AbortSignal): Promise<NavigatorTaskRecord> {
    return this.transport.requestJson(
      `/api/v1/navigator/tasks/${encodeURIComponent(id)}`,
      { method: "GET", signal },
      parseTaskRecord,
    );
  }

  /** Request cancellation and let the owner publish the resulting status. 中文：请求取消，并由所属服务发布最终状态。 */
  async cancelAssistantTask(id: string): Promise<{ taskId: string; cancelled: boolean }> {
    return this.transport.requestJson(
      `/api/v1/navigator/tasks/${encodeURIComponent(id)}/cancel`,
      jsonRequest("POST", {}, true),
      parseTaskCancellation,
    );
  }

  /**
   * Open the resumable event stream for one task without making the browser its state owner.
   * 中文：打开单项任务的可续传事件流；浏览器不会因此成为任务状态权威。
   */
  async openAssistantTaskEvents(id: string, afterSequence: number, signal: AbortSignal): Promise<Response> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new NavigatorContractError("Invalid assistant task event cursor.");
    }
    const path = `/api/v1/navigator/tasks/${encodeURIComponent(id)}/events?after=${afterSequence}`;
    const response = await this.transport.requestResponse(path, {
      method: "GET",
      signal,
      headers: { Accept: "text/event-stream", "Last-Event-ID": String(afterSequence) },
    });
    if (!response.ok) {
      let problem: unknown;
      try { problem = await response.json(); } catch { problem = undefined; }
      throw toHttpError(response.status, problem);
    }
    if (!response.body || response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/event-stream") {
      await response.body?.cancel();
      throw new NavigatorContractError("Navigator did not return an assistant task event stream.");
    }
    return response;
  }
}
