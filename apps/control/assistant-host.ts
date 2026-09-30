import type { Actor } from '../../packages/server-control/contracts';
import { ControlError } from '../../packages/server-control/contracts';

export interface AssistantHost { url: string; token: string; connectionId: string }
export function validateAssistantHost(host: AssistantHost): AssistantHost {
  const url = new URL(host.url);
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || host.token.length < 32) throw new Error('Assistant host must use authenticated loopback HTTP');
  return host;
}
export async function assistantHostRequest(host: AssistantHost | undefined, actor: Actor, workspaceId: string, method: string, path: string, input: unknown) {
  if (!host) throw new ControlError('ASSISTANT_UNAVAILABLE', '请使用本机启动器连接 Navigator 助手 / Start the local Navigator assistant', 503);
  if (!actor.workspaceIds.includes(workspaceId)) throw new ControlError('FORBIDDEN', 'Workspace is not authorized', 403);
  let response: Response;
  try { response = await fetch(new URL('/rpc', host.url), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` }, body: JSON.stringify({ scope: { actorId: actor.id, workspaceId, connectionId: host.connectionId, scopes: actor.scopes }, method, path, input }), signal: AbortSignal.timeout(30000), redirect: 'error' }); }
  catch { throw new ControlError('ASSISTANT_DISCONNECTED', '本机助手连接断开；已发送的任务不会自动重试 / Local assistant disconnected; submitted tasks are not retried', 503); }
  const body = await response.json();
  if (!response.ok) throw new ControlError('ASSISTANT_REQUEST_FAILED', body.error?.message ?? 'Assistant request failed', response.status);
  return body;
}
