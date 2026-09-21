import { z } from "zod";
import { commands, type CommandName, type Output } from "../../../../packages/server-control/contracts";

export class ServerClient {
  private token = "";
  async execute<N extends CommandName>(name: N, input: z.input<(typeof commands)[N]["input"]>, idempotencyKey?: string): Promise<Output<N>> {
    if (!this.token) {
      const response = await fetch("/studio-control/v1/session", { credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("服务器管理入口不可用。");
      this.token = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await response.json()).token;
    }
    const response = await fetch("/studio-control/v1/commands", {
      method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", "x-studio-control-token": this.token },
      body: JSON.stringify({ name, input: commands[name].input.parse(input), requestId: crypto.randomUUID(), ...(idempotencyKey ? { idempotencyKey } : {}) }),
    });
    if (response.status === 403) this.token = "";
    const body = await response.json();
    if (!response.ok) throw new Error(z.object({ error: z.object({ message: z.string() }) }).parse(body).error.message);
    return commands[name].output.parse(body.result) as Output<N>;
  }
}
export const serverClient = new ServerClient();
