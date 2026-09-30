import { controlFetch } from '../mcp/client';
export async function assistantRequest<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', signal?: AbortSignal): Promise<T> {
  const response = await controlFetch('/studio-assistant/v1' + path, { method, signal, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('请使用本机启动器打开工作台 / Open the workbench with the local launcher');
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message ?? result.message ?? `HTTP ${response.status}`), { status: response.status });
  return result;
}
