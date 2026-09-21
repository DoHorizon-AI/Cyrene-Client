import { z } from "zod";
import { pipelineCommands, type PipelineCommand, type PipelineOutput } from "../../../../packages/pipeline-control/contracts";

class PipelineClient {
  private token = "";
  async execute<N extends PipelineCommand>(name: N, input: z.input<(typeof pipelineCommands)[N]["input"]>, idempotencyKey?: string): Promise<PipelineOutput<N>> {
    if (!this.token) {
      const r = await fetch("/studio-pipelines/v1/session", { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error("流水线控制服务不可用。");
      this.token = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await r.json()).token;
    }
    const r = await fetch("/studio-pipelines/v1/commands", { method: "POST", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", "x-studio-control-token": this.token },
      body: JSON.stringify({ name, input: pipelineCommands[name].input.parse(input), requestId: crypto.randomUUID(), ...(idempotencyKey ? { idempotencyKey } : {}) }),
    });
    if (r.status === 403) this.token = "";
    const body = await r.json();
    if (!r.ok) throw new Error(z.object({ error: z.object({ message: z.string() }) }).parse(body).error.message);
    return pipelineCommands[name].output.parse(body.result) as PipelineOutput<N>;
  }
}
export const pipelineClient = new PipelineClient();
