import { z } from "zod";
import {
  bindingSchema, datasetSchema, datasetVersionSchema, hostStatusSchema, modelImportSchema,
  navigatorSessionsSchema, pathId, sessionSchema, suiteInputSchema, suiteSchema, trainingConfigurationSchema, trainingDraftSchema,
  type HostSession,
} from "../../../../packages/service-settings/contracts";

export interface DiagnosticInfo {
  readonly traceId?: string;
  readonly requestId?: string;
  readonly recoveryAction?: string;
  readonly retryable?: boolean;
}

export class ServiceError extends Error {
  public readonly traceId?: string;
  public readonly requestId?: string;
  public readonly recoveryAction?: string;
  public readonly retryable?: boolean;

  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 0,
    diagnostics?: DiagnosticInfo,
  ) {
    super(message);
    this.name = "ServiceError";
    this.traceId = diagnostics?.traceId;
    this.requestId = diagnostics?.requestId;
    this.recoveryAction = diagnostics?.recoveryAction;
    this.retryable = diagnostics?.retryable;
  }
}

export function formatDiagnosticSummary(error: ServiceError): string {
  const parts: string[] = [error.message];
  if (error.recoveryAction) parts.push(`建议操作: ${error.recoveryAction}`);
  if (error.requestId) parts.push(`Request ID: ${error.requestId}`);
  if (error.traceId) parts.push(`Trace ID: ${error.traceId}`);
  return parts.join(" | ");
}
/**
 * W3C trace context helpers.
 *
 * The trace id is 16 random bytes and the span id 8; neither may be all zeros,
 * so the leading nibble is forced non-zero. The Web Host forwards `traceparent`
 * unchanged, which is what makes one browser action followable end to end.
 *
 * W3C trace 上下文辅助函数。trace ID 由 16 个随机字节组成，span ID 由 8 个组成；二者都不能全为零，
 * 因此会将首个 nibble 强制设为非零。Web Host 原样转发 `traceparent`，让一次浏览器操作能够端到端追踪。
 */
function randomHex(bytes: number): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("");
}

function withNonZeroPrefix(value: string): string {
  return value.startsWith("0") && /^0+$/.test(value) ? `1${value.slice(1)}` : value;
}

export function newTraceId(): string {
  return withNonZeroPrefix(randomHex(16));
}

export function newSpanId(): string {
  return withNonZeroPrefix(randomHex(8));
}

export function formatTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

type Fetcher = typeof fetch;
const connectionSchema = z.object({ configured: z.boolean(), target: z.string().nullable() });

export class SettingsClient {
  private csrf: string | null = null;
  private refreshInFlight: Promise<HostSession> | null = null;
  onExpired: (() => void) | undefined;
  constructor(private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis), private readonly timeoutMs = 10000) {}

  connection(signal?: AbortSignal) { return this.request("/studio-api/connection", connectionSchema, { signal }); }
  async session(signal?: AbortSignal) {
    const s = await this.request("/api/v1/auth/session", sessionSchema, { signal }); this.accept(s);
    if (!s.authenticated && s.refreshable) return this.refresh();
    return s;
  }
  async pair(code: string) {
    const value = code.trim(); if (!value) throw new Error("请输入 Web Host 的一次性配对码。");
    const s = await this.request("/api/v1/auth/pair", sessionSchema, { method: "POST", body: JSON.stringify({ pairingCode: value }) });
    this.accept(s); return s;
  }
  async disconnect() {
    await this.request("/api/v1/auth/session", z.unknown(), { method: "DELETE" }); this.csrf = null;
  }
  private accept(s: HostSession) { this.csrf = s.csrfToken ?? (s.refreshable ? this.cookieCsrf() : null); }
  private cookieCsrf() {
    if (typeof document === "undefined") return null;
    const value = document.cookie.split("; ").find((c) => c.startsWith("cyrene_csrf="))?.slice("cyrene_csrf=".length);
    return value ? decodeURIComponent(value) : null;
  }
  private refresh() {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.request("/api/v1/auth/session/refresh", sessionSchema, { method: "POST" })
        .then((s) => { this.accept(s); return s; })
        .finally(() => { this.refreshInFlight = null; });
    }
    return this.refreshInFlight;
  }
  status(signal?: AbortSignal) { return this.request("/api/v1/system/status", hostStatusSchema, { signal }); }
  datasets(signal?: AbortSignal) { return this.read("/api/v1/catalyst/datasets", z.array(datasetSchema), signal); }
  datasetVersion(id: string, signal?: AbortSignal) { return this.read(`/api/v1/catalyst/dataset-versions/${pathId(id)}`, datasetVersionSchema, signal); }
  models(signal?: AbortSignal) { return this.read("/api/v1/reactor/model-imports", z.array(modelImportSchema), signal); }
  bindings(signal?: AbortSignal) { return this.read("/api/v1/reactor/serving-bindings", z.array(bindingSchema), signal); }
  drafts(signal?: AbortSignal) { return this.read("/api/v1/yield/training-drafts", z.array(trainingDraftSchema), signal); }
  draft(id: string, signal?: AbortSignal) { return this.read(`/api/v1/yield/training-drafts/${pathId(id)}`, trainingDraftSchema, signal); }
  async prepareDraft(id: string, body: unknown) {
    const payload = trainingConfigurationSchema.parse(body);
    return this.request(`/api/v1/yield/training-drafts/${pathId(id)}`, trainingDraftSchema, { method: "PATCH", body: JSON.stringify(payload) });
  }
  suite(id: string, signal?: AbortSignal) { return this.read(`/api/v1/echo/evaluation-suites/${pathId(id)}`, suiteSchema, signal); }
  createSuite(body: unknown, idempotencyKey: string) {
    const payload = suiteInputSchema.parse(body);
    return this.request("/api/v1/echo/evaluation-suites", suiteSchema, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) });
  }
  sessions(workspace: string, signal?: AbortSignal) {
    return this.read(`/api/v1/navigator/harness/workspaces/${pathId(workspace)}/sessions`, navigatorSessionsSchema, signal);
  }
  private async read<T extends z.ZodTypeAny>(path: string, schema: T, signal?: AbortSignal): Promise<z.infer<T>> {
    // One trace id per operation: a refresh-and-retry keeps the same trace so the
    // two attempts stay linkable, while each attempt carries its own span.
    // 每个操作使用一个 trace ID：刷新并重试时保留同一 trace，以关联两次尝试；每次尝试仍使用各自的 span。
    const traceId = newTraceId();
    try { return await this.request(path, schema, { signal }, traceId); }
    catch (e) {
      if (!(e instanceof ServiceError) || e.status !== 401 || signal?.aborted) throw e;
      try { if (!(await this.refresh()).authenticated) throw e; }
      catch { this.csrf = null; this.onExpired?.(); throw e; }
      return this.request(path, schema, { signal }, traceId);
    }
  }
  private async request<T extends z.ZodTypeAny>(path: string, schema: T, init: RequestInit, traceId?: string): Promise<z.infer<T>> {
    const headers = new Headers(init.headers); headers.set("Accept", "application/json");
    const method = init.method ?? "GET";
    if (init.body) headers.set("Content-Type", "application/json");
    if (method !== "GET" && this.csrf) headers.set("X-CSRF-Token", this.csrf);
    if (!headers.has("X-Request-ID")) {
      headers.set("X-Request-ID", `req-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`);
    }
    // W3C trace context: the Web Host forwards this unchanged, so one browser
    // action is followable through every Product it touches.
    // W3C trace 上下文会由 Web Host 原样转发，因此一次浏览器操作可以贯穿其访问的所有 Product。
    if (!headers.has("traceparent")) {
      headers.set("traceparent", formatTraceparent(traceId ?? newTraceId(), newSpanId()));
    }
    let response: Response;
    try {
      const signal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(init.signal ? [init.signal] : [])]);
      response = await this.fetcher(path, { ...init, headers, credentials: "same-origin", signal, redirect: "error" });
    } catch (e) {
      if (init.signal?.aborted) throw e;
      throw new ServiceError("UNREACHABLE", "服务请求失败或超时，请检查连接；未返回可用设置。");
    }
    if (response.status === 204 && response.ok) return undefined;
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new ServiceError("NON_JSON", `服务没有返回 JSON 设置（HTTP ${response.status}）。`, response.status); }
    if (!response.ok) {
      const problem = z.object({
        code: z.string().max(128).regex(/^[A-Za-z0-9_.-]+$/).optional(),
        traceId: z.string().max(128).optional(),
        requestId: z.string().max(128).optional(),
        recoveryAction: z.string().max(64).optional(),
        retryable: z.boolean().optional(),
      }).safeParse(payload);
      const code = problem.success && problem.data.code ? problem.data.code : `HTTP_${response.status}`;
      const diagnostics: DiagnosticInfo = problem.success ? {
        traceId: problem.data.traceId,
        requestId: problem.data.requestId,
        recoveryAction: problem.data.recoveryAction,
        retryable: problem.data.retryable,
      } : {};
      // No arbitrary upstream payloads (possibly containing credentials) enter UI errors.
      // UI 错误不会包含任意上游载荷（其中可能含有凭据）。
      const text: Record<number, string> = { 401: "会话已过期，请重新连接或配对。", 403: "没有此接口权限，或 Web Host 未开放该服务。", 404: "资源或设置接口不存在。", 409: "资源状态已变化，请重新读取。", 422: "服务端拒绝了设置参数。", 502: "Web Host 无法访问目标服务。", 503: "服务尚未配置或暂不可用。" };
      if (response.status === 401 && method !== "GET" && !path.startsWith("/api/v1/auth/")) this.onExpired?.();
      throw new ServiceError(code, `${text[response.status] ?? "服务请求失败。"}（${code}）`, response.status, diagnostics);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ServiceError("CONTRACT", "服务响应与已核对的设置契约不符；本地配置未被替换。");
    return parsed.data;
  }
}
