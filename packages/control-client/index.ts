import type { Actor } from "../server-control/contracts";
import { ControlError } from "../server-control/contracts";

export interface CommandExecutor { execute(raw: unknown, actor: Actor): Promise<unknown> }
/** The server authenticates the token; client-supplied actor never crosses HTTP. */
export class RemoteControl implements CommandExecutor {
  constructor(private origin: string, private token: string, private prefix = "/studio-pipelines", private publicOrigin?: string) {
    const url = new URL(origin);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !["https:", "http:"].includes(url.protocol)) throw new Error("Control URL must be an HTTP(S) origin");
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]", "studio-control"].includes(url.hostname)) throw new Error("Remote control connections require HTTPS");
    if (!token) throw new Error("A dedicated STUDIO_API_TOKEN is required");
  }
  async session() {
    const response = await fetch(`${this.origin}/studio-commands/v1/session`, { redirect: "error", signal: AbortSignal.timeout(10000), headers: { authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new ControlError("UNAUTHENTICATED", "无法读取 MCP 凭据的实际权限。", response.status);
    const body = await response.json();
    if (!body.actor || typeof body.actor.id !== "string" || !Array.isArray(body.actor.scopes) || !Array.isArray(body.actor.workspaceIds)) throw new Error("Invalid control identity");
    return body.actor as Actor;
  }
  async execute(raw: unknown, _actor: Actor) {
    const response = await fetch(`${this.origin}${this.prefix}/v1/commands`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000), headers: { "content-type": "application/json", authorization: `Bearer ${this.token}`, ...(this.publicOrigin ? { origin: this.publicOrigin } : {}) }, body: JSON.stringify(raw) });
    const body = await response.json();
    if (!response.ok) throw new ControlError(body.error?.code ?? "CONTROL_ERROR", body.error?.message ?? "控制服务不可用。", response.status);
    return body.result;
  }
}
