/** Browser commands share the same authenticated endpoint and contracts as MCP. */
export async function controlCommand<T>(prefix: string, name: string, input: unknown, key?: string): Promise<T> {
  const session = await fetch(`${prefix}/v1/session`, { signal: AbortSignal.timeout(10000) });
  if (!session.ok || !session.headers.get("content-type")?.includes("application/json")) throw new Error("此功能需要独立控制服务；请使用 dev:services 或分容器部署。");
  const { token } = await session.json();
  const response = await fetch(`${prefix}/v1/commands`, { method: "POST", headers: { "content-type": "application/json", "x-studio-control-token": token }, body: JSON.stringify({ name, input, requestId: crypto.randomUUID(), ...(key ? { idempotencyKey: key } : {}) }), signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "操作未确认，请读取当前状态。");
  return body.result as T;
}
