import { z } from "zod";
import { logError } from "../logger";
import {
  bindingSchema, datasetSchema, datasetVersionSchema, hostStatusSchema, modelImportSchema,
  navigatorSessionsSchema, pathId, sessionSchema, suiteInputSchema, suiteSchema, trainingConfigurationSchema, trainingDraftSchema,
  type HostSession,
} from "../../../../packages/service-settings/contracts";
import {
  WORKSPACE_PRODUCT_REFERENCES,
  WorkspaceBffClient,
  WorkspaceBffError,
  type WorkspaceProductReference,
  type WorkspaceSummary,
} from "./workspace-bff-client";

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

    try {
      logError("studio.service.request_failed", code, message, {
        status,
        trace_id: diagnostics?.traceId,
        request_id: diagnostics?.requestId,
        recovery_action: diagnostics?.recoveryAction,
        retryable: diagnostics?.retryable,
      });
    } catch {
      // logging failure should never break error propagation
      // 日志记录失败不得中断错误传播。
    }
  }
}

/**
 * Route shape for diagnostics.
 *
 * Resource ids are legitimate log attributes, but these clients only need the
 * route shape, so id-looking segments are replaced before a record is written.
 *
 * 用于诊断记录的路由形态。resource ID 可以作为合法日志属性，但这些客户端只需要路由形态，
 * 因此写入记录前会将类似 ID 的路径段替换为占位符。
 */
function pathShape(path: string): string {
  return path.split("/").map((segment) => (/^[0-9a-f-]{8,}$/i.test(segment) ? ":id" : segment)).join("/");
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
  private readonly workspaceBff: WorkspaceBffClient;
  onExpired: (() => void) | undefined;
  constructor(
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
    private readonly timeoutMs = 10000,
    workspaceBff?: WorkspaceBffClient,
    private readonly navigator?: import("../../services/navigator/src/api").NavigatorApi,
  ) {
    this.workspaceBff = workspaceBff ?? new WorkspaceBffClient({ fetcher, timeoutMs });
  }

  get workspaceBffEnabled(): boolean { return this.workspaceBff.enabled; }
  discoverWorkspaceBffWorkspaces(signal?: AbortSignal): Promise<readonly WorkspaceSummary[]> {
    return this.workspaceBff.discoverWorkspaces(signal);
  }

  connection(signal?: AbortSignal) { return this.read("/studio-api/connection", connectionSchema, signal); }
  async session(signal?: AbortSignal) {
    if (this.navigator) { signal?.throwIfAborted(); return sessionSchema.parse(await this.navigator.restoreSession()); }
    const s = await this.request("/api/v1/auth/session", sessionSchema, { signal }); this.accept(s);
    if (!s.authenticated && s.refreshable) return this.refresh();
    return s;
  }
  async pair(code: string) {
    if (this.navigator) return sessionSchema.parse(await this.navigator.pair(code));
    const value = code.trim(); if (!value) throw new Error("请输入 Web Host 的一次性配对码。");
    const s = await this.request("/api/v1/auth/pair", sessionSchema, { method: "POST", body: JSON.stringify({ pairingCode: value }) });
    this.accept(s); return s;
  }
  async disconnect() {
    if (this.navigator) { await this.navigator.logout(); return; }
    await this.request("/api/v1/auth/session", z.unknown(), { method: "DELETE" }); this.csrf = null;
  }
  private accept(s: HostSession) { this.csrf = s.csrfToken ?? (s.refreshable ? this.cookieCsrf() : null); }
  private cookieCsrf() {
    if (typeof document === "undefined") return null;
    const value = document.cookie.split("; ").find((c) => c.startsWith("cyrene_csrf="))?.slice("cyrene_csrf=".length);
    return value ? decodeURIComponent(value) : null;
  }
  private refresh() {
    if (this.navigator) return this.navigator.refreshSession().then(session => sessionSchema.parse(session));
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.request("/api/v1/auth/session/refresh", sessionSchema, { method: "POST" })
        .then((s) => { this.accept(s); return s; })
        .finally(() => { this.refreshInFlight = null; });
    }
    return this.refreshInFlight;
  }
  status(signal?: AbortSignal) { return this.read("/api/v1/system/status", hostStatusSchema, signal); }
  datasets(signal?: AbortSignal, workspaceId?: string) {
    if (!this.workspaceBff.enabled) return this.read("/api/v1/catalyst/datasets", z.array(datasetSchema), signal);
    return this.invokeWorkspaceProduct(workspaceId, WORKSPACE_PRODUCT_REFERENCES.listDatasets, z.array(datasetSchema), { signal });
  }
  datasetVersion(id: string, signal?: AbortSignal) { return this.read(`/api/v1/catalyst/dataset-versions/${pathId(id)}`, datasetVersionSchema, signal); }
  models(signal?: AbortSignal, workspaceId?: string) {
    if (!this.workspaceBff.enabled) return this.read("/api/v1/reactor/model-imports", z.array(modelImportSchema), signal);
    return this.invokeWorkspaceProduct(workspaceId, WORKSPACE_PRODUCT_REFERENCES.listModelImports, z.array(modelImportSchema), { signal });
  }
  bindings(signal?: AbortSignal) { return this.read("/api/v1/reactor/serving-bindings", z.array(bindingSchema), signal); }
  drafts(signal?: AbortSignal) { return this.read("/api/v1/yield/training-drafts", z.array(trainingDraftSchema), signal); }
  draft(id: string, signal?: AbortSignal, workspaceId?: string) {
    const resourceId = id.trim();
    const safeId = pathId(resourceId);
    if (!this.workspaceBff.enabled) return this.read(`/api/v1/yield/training-drafts/${safeId}`, trainingDraftSchema, signal);
    return this.invokeWorkspaceProduct(workspaceId, WORKSPACE_PRODUCT_REFERENCES.getTrainingDraft, trainingDraftSchema, { resourceId, signal });
  }
  async prepareDraft(id: string, body: unknown) {
    const payload = trainingConfigurationSchema.parse(body);
    return this.request(`/api/v1/yield/training-drafts/${pathId(id)}`, trainingDraftSchema, { method: "PATCH", body: JSON.stringify(payload) });
  }
  suite(id: string, signal?: AbortSignal, workspaceId?: string) {
    const resourceId = id.trim();
    const safeId = pathId(resourceId);
    if (!this.workspaceBff.enabled) return this.read(`/api/v1/echo/evaluation-suites/${safeId}`, suiteSchema, signal);
    return this.invokeWorkspaceProduct(workspaceId, WORKSPACE_PRODUCT_REFERENCES.getEvaluationSuite, suiteSchema, { resourceId, signal });
  }
  createSuite(body: unknown, idempotencyKey: string, workspaceId?: string) {
    const payload = suiteInputSchema.parse(body);
    if (!this.workspaceBff.enabled) {
      return this.request("/api/v1/echo/evaluation-suites", suiteSchema, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      });
    }
    return this.invokeWorkspaceProduct(workspaceId, WORKSPACE_PRODUCT_REFERENCES.createEvaluationSuite, suiteSchema, {
      body: payload,
      idempotencyKey,
    });
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
      catch {
        this.csrf = null;
        logError("studio.services.session_refresh_failed", "STUDIO.SESSION.REFRESH_FAILED", "设置会话刷新失败，请求未重试。", {
          path_shape: pathShape(path),
          http_status: 401,
          outcome: "rejected",
        });
        this.onExpired?.();
        throw e;
      }
      return this.request(path, schema, { signal }, traceId);
    }
  }
  private async invokeWorkspaceProduct<T extends z.ZodTypeAny>(
    workspaceId: string | undefined,
    operation: WorkspaceProductReference,
    schema: T,
    options: { resourceId?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<z.infer<T>> {
    if (!workspaceId) {
      throw new WorkspaceBffError("workspace_selection_required", "请先从当前登录 session 的 Workspace 发现结果中选择 Workspace。", 0);
    }
    const payload = await this.workspaceBff.invoke(workspaceId, operation, options);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new WorkspaceBffError("invalid_upstream_response", "Product 响应与已核对的设置契约不符；本地配置未被替换。", 502);
    }
    return parsed.data;
  }

  private async request<T extends z.ZodTypeAny>(path: string, schema: T, init: RequestInit, traceId?: string): Promise<z.infer<T>> {
    if (this.workspaceBff.enabled && isDirectProductPath(path)) {
      throw new WorkspaceBffError("unsupported_operation", "Workspace BFF 当前没有投影此 Product operation；已阻止直接 Product 请求。", 0);
    }
    const headers = new Headers(init.headers); headers.set("Accept", "application/json");
    const method = init.method ?? "GET";
    if (init.body) headers.set("Content-Type", "application/json");
    const csrf = this.navigator ? this.navigator.sessionCsrfToken : this.csrf;
    if (method !== "GET" && csrf) headers.set("X-CSRF-Token", csrf);
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

const DIRECT_PRODUCT_PATHS = [
  "/api/v1/catalyst/",
  "/api/v1/reactor/",
  "/api/v1/yield/",
  "/api/v1/echo/",
  "/api/v1/exchange/",
  "/api/v1/navigator/harness/",
];

function isDirectProductPath(path: string): boolean {
  return DIRECT_PRODUCT_PATHS.some((prefix) => path.startsWith(prefix));
}
