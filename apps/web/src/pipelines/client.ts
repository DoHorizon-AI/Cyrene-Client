import { z } from "zod";
import { logError } from "../logger";
import { pipelineCommands, type PipelineCommand, type PipelineOutput } from "../../../../packages/pipeline-control/contracts";

class PipelineClient {
  private token = "";
  async execute<N extends PipelineCommand>(name: N, input: z.input<(typeof pipelineCommands)[N]["input"]>, idempotencyKey?: string): Promise<PipelineOutput<N>> {
    if (!this.token) {
      const r = await fetch("/studio-pipelines/v1/session", { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) {
        logError("studio.pipelines.session_unavailable", "STUDIO.PIPELINES.SESSION_UNAVAILABLE", "流水线控制服务会话不可用。", {
          operation: "session",
          http_method: "GET",
          http_status: r.status,
          timeout_ms: 10_000,
        });
        throw new Error("流水线控制服务不可用。");
      }
      try {
        this.token = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await r.json()).token;
      } catch (e) {
        logError("studio.pipelines.session_response_invalid", "STUDIO.PIPELINES.SESSION_RESPONSE_INVALID", "流水线控制服务返回的会话与本地契约不符。", {
          operation: "session",
          http_status: r.status,
        });
        throw e;
      }
    }
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch("/studio-pipelines/v1/commands", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { "content-type": "application/json", "x-studio-control-token": this.token },
        body: JSON.stringify({ name, input: pipelineCommands[name].input.parse(input), requestId: crypto.randomUUID(), ...(idempotencyKey ? { idempotencyKey } : {}) }),
      });
    } catch (e) {
      // A timeout or transport failure says nothing about whether the command ran.
      // 超时或传输失败并不能说明命令是否实际运行。
      logError("studio.pipelines.command_unreachable", "STUDIO.PIPELINES.COMMAND_UNREACHABLE", "流水线命令请求失败或超时；命令是否生效未知。", {
        operation: name,
        http_method: "POST",
        timeout_ms: 30_000,
        duration_ms: Math.round(performance.now() - startedAt),
        has_idempotency_key: Boolean(idempotencyKey),
        outcome: "unknown",
      });
      throw e;
    }
    if (response.status === 403) {
      logError("studio.pipelines.token_rejected", "STUDIO.PIPELINES.TOKEN_REJECTED", "流水线控制令牌被拒绝，本地令牌已清除。", {
        operation: name,
        http_status: 403,
      });
      this.token = "";
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (e) {
      logError("studio.pipelines.response_invalid", "STUDIO.PIPELINES.RESPONSE_INVALID", "流水线控制服务没有返回 JSON 响应。", {
        operation: name,
        http_status: response.status,
      });
      throw e;
    }
    if (!response.ok) {
      logError("studio.pipelines.command_rejected", "STUDIO.PIPELINES.COMMAND_REJECTED", "流水线命令被服务拒绝。", {
        operation: name,
        http_status: response.status,
        duration_ms: Math.round(performance.now() - startedAt),
        outcome: "rejected",
      });
      throw new Error(z.object({ error: z.object({ message: z.string() }) }).parse(body).error.message);
    }
    return pipelineCommands[name].output.parse((body as { result: unknown }).result) as PipelineOutput<N>;
  }
}
export const pipelineClient = new PipelineClient();
