import type { runCommands } from "../../../../packages/run-control/contracts";

export async function controlCommand(prefix: string, name: string, input: unknown, key?: string) {
  const session = await fetch(`${prefix}/v1/session`, { signal: AbortSignal.timeout(10000) });
  if (!session.ok) throw new Error(`Control session unavailable (${session.status})`);
  const { token } = await session.json();
  const response = await fetch(`${prefix}/v1/commands`, { method: "POST", headers: { "content-type": "application/json", "x-studio-control-token": token }, body: JSON.stringify({ name, input, requestId: crypto.randomUUID(), ...(key ? { idempotencyKey: key } : {}) }), signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Control request failed (${response.status})`);
  return body.result;
}
export const executeRun = (name: keyof typeof runCommands, input: unknown, key?: string) => controlCommand("/studio-runs", name, input, key);
