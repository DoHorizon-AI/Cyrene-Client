import { z } from "zod";
import { logError } from "../logger";
import { commands, type CommandName, type Output } from "../../../../packages/server-control/contracts";

export class ServerClient {
  private token = "";
  async execute<N extends CommandName>(name: N, input: z.input<(typeof commands)[N]["input"]>, idempotencyKey?: string): Promise<Output<N>> {
    if (!this.token) {
      const response = await fetch("/studio-control/v1/session", { credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        logError("studio.servers.session_unavailable", "STUDIO.SERVERS.SESSION_UNAVAILABLE", "服务器管理入口会话不可用。", {
          operation: "session",
          http_method: "GET",
          http_status: response.status,
          timeout_ms: 10_000,
        });
        throw new Error("服务器管理入口不可用。");
      }
      try {
        this.token = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await response.json()).token;
      } catch (e) {
        logError("studio.servers.session_response_invalid", "STUDIO.SERVERS.SESSION_RESPONSE_INVALID", "服务器管理入口返回的会话与本地契约不符。", {
          operation: "session",
          http_status: response.status,
        });
        throw e;
      }
    }
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch("/studio-control/v1/commands", {
        method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json", "x-studio-control-token": this.token },
        body: JSON.stringify({ name, input: commands[name].input.parse(input), requestId: crypto.randomUUID(), ...(idempotencyKey ? { idempotencyKey } : {}) }),
      });
    } catch (e) {
      // A timeout or transport failure says nothing about whether the command ran.
      // 超时或传输失败并不能说明命令是否实际运行。
      logError("studio.servers.command_unreachable", "STUDIO.SERVERS.COMMAND_UNREACHABLE", "服务器管理命令请求失败或超时；命令是否生效未知。", {
        operation: name,
        http_method: "POST",
        timeout_ms: 10_000,
        duration_ms: Math.round(performance.now() - startedAt),
        has_idempotency_key: Boolean(idempotencyKey),
        outcome: "unknown",
      });
      throw e;
    }
    if (response.status === 403) {
      logError("studio.servers.token_rejected", "STUDIO.SERVERS.TOKEN_REJECTED", "服务器管理令牌被拒绝，本地令牌已清除。", {
        operation: name,
        http_status: 403,
      });
      this.token = "";
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (e) {
      logError("studio.servers.response_invalid", "STUDIO.SERVERS.RESPONSE_INVALID", "服务器管理入口没有返回 JSON 响应。", {
        operation: name,
        http_status: response.status,
      });
      throw e;
    }
    if (!response.ok) {
      logError("studio.servers.command_rejected", "STUDIO.SERVERS.COMMAND_REJECTED", "服务器管理命令被拒绝。", {
        operation: name,
        http_status: response.status,
        duration_ms: Math.round(performance.now() - startedAt),
        outcome: "rejected",
      });
      throw new Error(z.object({ error: z.object({ message: z.string() }) }).parse(body).error.message);
    }
    return commands[name].output.parse((body as { result: unknown }).result) as Output<N>;
  }
}
export const serverClient = new ServerClient();
