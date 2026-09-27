// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 workspace-bff-client.ts                                         │
// │  Module: services/workspace-bff-client                              │
// │  Role: Same-origin, closed-operation client for the Workspace BFF.   │
// │                                                                      │
// │  模块职责：提供同源 Workspace BFF 客户端                              │
// │  · 仅调用固定 session、discovery 和 Product invocation 路由            │
// │  · 默认关闭，校验可信发现结果、CSRF 与有界 JSON 响应                    │
// └─────────────────────────────────────────────────────────────────────┘
import { z } from "zod";
import { approvalSchema, completionSchema, denialSchema, type DeviceApproval } from "./workspace-security-contracts";

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const SESSION_PATH = "/api/workspace/v1/session";
const WORKSPACES_PATH = "/api/workspace/v1/workspaces";

const problemSchema = z.object({
  type: z.string().max(2048).optional(),
  title: z.string().min(1).max(256),
  status: z.number().int().min(400).max(599),
  detail: z.string().max(2048).optional(),
  instance: z.string().max(2048).optional(),
  code: z.enum([
    "unauthenticated", "invalid_principal", "forbidden", "workspace_not_found",
    "invalid_request", "unsupported_media_type", "payload_too_large",
    "unsupported_operation", "internal_error", "csrf_failed", "rate_limited",
    "invalid_upstream_response", "upstream_unavailable", "upstream_timeout", "state_conflict",
  ]),
  traceId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
}).strict();

const sessionSchema = z.object({
  issuer: z.string().url(),
  subject: z.string().min(1).max(512),
  organizationId: z.string().min(1).max(200),
  expiresAt: z.string().datetime({ offset: true }),
  csrfToken: z.string().min(32).max(256).regex(/^v1\.[0-9]+\.[A-Za-z0-9_-]+$/),
}).strict();

export type WorkspaceSession = z.infer<typeof sessionSchema>;

const workspaceListSchema = z.object({
  workspaces: z.array(z.object({
    workspaceId: z.string().min(1).max(200),
    organizationId: z.string().min(1).max(200),
    displayName: z.string().min(1).max(256),
  }).strict()),
}).strict();

/**
 * Closed Product operation keys that have real callers in the Studio settings UI.
 * 中文：Studio 设置界面当前确有调用者的封闭 Product operation key。
 */
export const WORKSPACE_PRODUCT_OPERATIONS = {
  listDatasets: "WORKSPACE_PRODUCT_API_OPERATION_01",
  getTrainingDraft: "WORKSPACE_PRODUCT_API_OPERATION_03",
  listModelImports: "WORKSPACE_PRODUCT_API_OPERATION_05",
  getEvaluationSuite: "WORKSPACE_PRODUCT_API_OPERATION_09",
  createEvaluationSuite: "WORKSPACE_PRODUCT_API_OPERATION_10",
} as const;

export type WorkspaceProductOperation = typeof WORKSPACE_PRODUCT_OPERATIONS[keyof typeof WORKSPACE_PRODUCT_OPERATIONS];

const commandOperations = new Set<WorkspaceProductOperation>([
  WORKSPACE_PRODUCT_OPERATIONS.createEvaluationSuite,
]);

export interface WorkspaceSummary {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly displayName: string;
}

export type WorkspaceBffErrorCode =
  | z.infer<typeof problemSchema>["code"]
  | "feature_disabled"
  | "workspace_not_discovered"
  | "workspace_selection_required"
  | "workspace_discovery_invalid"
  | "session_changed"
  | "unsupported_operation"
  | "invalid_request"
  | "invalid_response"
  | "product_error"
  | "unreachable";

/**
 * Typed failure for local validation, BFF RFC 9457 errors, and Product status errors.
 * 中文：区分本地校验、BFF RFC 9457 错误和 Product HTTP 错误的类型化异常。
 */
export class WorkspaceBffError extends Error {
  constructor(
    public readonly code: WorkspaceBffErrorCode,
    message: string,
    public readonly status = 0,
    public readonly traceId?: string,
  ) {
    super(message);
    this.name = "WorkspaceBffError";
  }
}

interface InvocationOptions {
  readonly resourceId?: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

interface ClientOptions {
  readonly enabled?: boolean;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

function envGateEnabled(): boolean {
  return import.meta.env.VITE_WORKSPACE_BFF_ENABLED === "true";
}

function traceparent(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const traceId = Array.from(bytes.subarray(0, 16), (value) => value.toString(16).padStart(2, "0")).join("");
  const spanId = Array.from(bytes.subarray(16), (value) => value.toString(16).padStart(2, "0")).join("");
  return `00-${traceId.startsWith("0") && /^0+$/.test(traceId) ? `1${traceId.slice(1)}` : traceId}-${spanId.startsWith("0") && /^0+$/.test(spanId) ? `1${spanId.slice(1)}` : spanId}-01`;
}

function contentType(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const announcedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(announcedLength) && announcedLength > MAX_JSON_BYTES) {
    throw new WorkspaceBffError("invalid_response", "Workspace BFF 响应超过 4 MiB 上限。", 502);
  }
  if (contentType(response) !== "application/json" && contentType(response) !== "application/problem+json") {
    throw new WorkspaceBffError("invalid_response", `Workspace BFF 返回了非 JSON 响应（HTTP ${response.status}）。`, 502);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new WorkspaceBffError("invalid_response", "Workspace BFF 未返回 JSON 响应正文。", 502);
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new WorkspaceBffError("invalid_response", "Workspace BFF 响应超过 4 MiB 上限。", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new WorkspaceBffError("invalid_response", `Workspace BFF 返回了无效 JSON（HTTP ${response.status}）。`, 502);
  }
}

/**
 * Same-origin Workspace BFF adapter. It sends no Product URLs, methods, bearer tokens, or device keys.
 * 中文：同源 Workspace BFF 适配器；不发送 Product URL、method、Bearer token 或设备密钥。
 */
export class WorkspaceBffClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly discoveredWorkspaceIds = new Set<string>();
  // The matching cookie is HttpOnly and browser-managed; keep only its JSON token in memory.
  // 配套 cookie 为 HttpOnly 并由浏览器管理；JSON token 仅保存在内存中。
  private csrfToken: string | null = null;
  private sessionScope: Pick<WorkspaceSession, "issuer" | "subject" | "organizationId"> | null = null;
  private generation = 0;
  private session: WorkspaceSession | null = null;
  readonly enabled: boolean;

  get identity() { const s = this.session; return s ? { issuer: s.issuer, subject: s.subject, organizationId: s.organizationId, expiresAt: s.expiresAt } : null; }
  reset() { this.clearSessionState(); }

  constructor(options: ClientOptions = {}) {
    this.enabled = options.enabled ?? envGateEnabled();
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Return only workspaces proven by the current BFF session and member discovery response.
   * 中文：只返回当前 BFF session 与成员发现响应共同证明的 Workspace。
   */
  async discoverWorkspaces(signal?: AbortSignal): Promise<readonly WorkspaceSummary[]> {
    this.requireEnabled();
    this.clearSessionState();
    const generation = this.generation;
    try {
      const session = await this.readSession(signal);
      const discoveryResult = workspaceListSchema.safeParse(await this.getJson(WORKSPACES_PATH, signal));
      if (!discoveryResult.success) throw new WorkspaceBffError("invalid_response", "Workspace BFF 发现响应不符合契约。", 502);
      const discovery = discoveryResult.data;
      if (generation !== this.generation || signal?.aborted) throw new WorkspaceBffError("session_changed", "Workspace discovery was superseded.");
      if (discovery.workspaces.some((workspace) => workspace.organizationId !== session.organizationId)) {
        throw new WorkspaceBffError("workspace_discovery_invalid", "Workspace 发现结果与已验证 session 的组织范围不符。", 502);
      }
      const uniqueIds = new Set(discovery.workspaces.map((workspace) => workspace.workspaceId));
      if (uniqueIds.size !== discovery.workspaces.length) {
        throw new WorkspaceBffError("workspace_discovery_invalid", "Workspace 发现结果包含重复标识。", 502);
      }
      for (const workspace of discovery.workspaces) this.discoveredWorkspaceIds.add(workspace.workspaceId);
      this.sessionScope = {
        issuer: session.issuer,
        subject: session.subject,
        organizationId: session.organizationId,
      };
      this.csrfToken = session.csrfToken;
      this.session = session;
      return discovery.workspaces;
    } catch (error) {
      if (generation === this.generation) this.clearSessionState();
      throw error;
    }
  }

  /**
   * Invoke one typed projection through the selected, previously discovered Workspace.
   * 中文：通过已发现并由调用者明确选择的 Workspace 调用一个封闭投影。
   */
  async invoke(
    workspaceId: string,
    operation: WorkspaceProductOperation,
    options: InvocationOptions = {},
  ): Promise<unknown> {
    this.requireEnabled();
    const workspace = workspaceId.trim();
    if (!workspace || workspace.length > 200 || !this.discoveredWorkspaceIds.has(workspace)) {
      throw new WorkspaceBffError("workspace_not_discovered", "请先从当前登录 session 的成员发现结果中选择 Workspace。", 0);
    }
    if (options.resourceId !== undefined && (!options.resourceId.trim() || options.resourceId.length > 512)) {
      throw new WorkspaceBffError("invalid_request", "Product resource ID 为空或超过 512 个字符。", 0);
    }
    if (options.idempotencyKey !== undefined && (options.idempotencyKey.length < 1 || options.idempotencyKey.length > 200 || /[\u0000-\u001f\u007f]/.test(options.idempotencyKey))) {
      throw new WorkspaceBffError("invalid_request", "Idempotency-Key 必须为 1 到 200 个字符。", 0);
    }
    if (operation === WORKSPACE_PRODUCT_OPERATIONS.createEvaluationSuite && !options.idempotencyKey) {
      throw new WorkspaceBffError("invalid_request", "创建 Echo evaluation suite 必须提供 Idempotency-Key。", 0);
    }
    if (operation === WORKSPACE_PRODUCT_OPERATIONS.createEvaluationSuite && options.body === undefined) {
      throw new WorkspaceBffError("invalid_request", "创建 Echo evaluation suite 必须提供 JSON 请求正文。", 0);
    }

    let body: string | undefined;
    if (options.body !== undefined) {
      try {
        body = JSON.stringify(options.body);
      } catch {
        throw new WorkspaceBffError("invalid_request", "Product JSON 请求无法序列化。", 0);
      }
      if (body === undefined) throw new WorkspaceBffError("invalid_request", "Product JSON 请求无法序列化。", 0);
      if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
        throw new WorkspaceBffError("payload_too_large", "Product JSON 请求超过 4 MiB 上限。", 413);
      }
    }

    const headers = new Headers({ Accept: "application/json, application/problem+json", "traceparent": traceparent() });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (options.idempotencyKey !== undefined) headers.set("Idempotency-Key", options.idempotencyKey);
    await this.refreshCsrfToken(options.signal);
    if (commandOperations.has(operation)) {
      if (!this.csrfToken) throw new WorkspaceBffError("csrf_failed", "Workspace BFF 未提供有效 CSRF token；命令未发送。", 403);
      headers.set("X-CSRF-Token", this.csrfToken);
    }

    const query = new URLSearchParams();
    if (options.resourceId !== undefined) query.set("resourceId", options.resourceId);
    const querySuffix = query.size ? `?${query.toString()}` : "";
    const path = `${WORKSPACES_PATH}/${encodeURIComponent(workspace)}/products/${operation}${querySuffix}`;
    const init: RequestInit = {
      method: "POST",
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      ...(body !== undefined ? { body } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    };
    // The browser supplies Origin on same-origin POST; JavaScript cannot set this forbidden header.
    // 同源 POST 的 Origin 由浏览器自动附加；JavaScript 不能手动设置此受限 header。
    const generation = this.generation;
    const response = await this.send(path, init, options.signal);
    const payload = await readBoundedJson(response);
    if (generation !== this.generation || options.signal?.aborted || !this.discoveredWorkspaceIds.has(workspace)) throw new WorkspaceBffError("session_changed", "Workspace session changed.");
    if (!response.ok) {
      if (response.status === 401) this.clearSessionState();
      const problem = problemSchema.safeParse(payload);
      if (problem.success && problem.data.status === response.status) {
        throw new WorkspaceBffError(problem.data.code, problem.data.detail ?? problem.data.title, response.status, problem.data.traceId);
      }
      const code = contentType(response) === "application/problem+json" ? "product_error" : "invalid_upstream_response";
      throw new WorkspaceBffError(code, `Workspace Product 请求失败（HTTP ${response.status}）。`, response.status);
    }
    if (contentType(response) === "application/problem+json") {
      throw new WorkspaceBffError("invalid_upstream_response", `Workspace Product 成功响应使用了错误媒体类型（HTTP ${response.status}）。`, 502);
    }
    return payload;
  }

  /**
   * Reject use of the adapter when its build-time feature gate is off.
   * 中文：构建期 feature gate 关闭时拒绝使用适配器。
   */
  private requireEnabled(): void {
    if (!this.enabled) throw new WorkspaceBffError("feature_disabled", "Workspace BFF 功能当前未启用。", 0);
  }

  private async getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const headers = new Headers({ Accept: "application/json", traceparent: traceparent() });
    const response = await this.send(path, {
      method: "GET",
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      ...(signal ? { signal } : {}),
    }, signal);
    const payload = await readBoundedJson(response);
    if (!response.ok) {
      const problem = problemSchema.safeParse(payload);
      if (problem.success && problem.data.status === response.status) {
        throw new WorkspaceBffError(problem.data.code, problem.data.detail ?? problem.data.title, response.status, problem.data.traceId);
      }
      const code = contentType(response) === "application/problem+json" ? "product_error" : "invalid_upstream_response";
      throw new WorkspaceBffError(code, `Workspace session 请求失败（HTTP ${response.status}）。`, response.status);
    }
    if (contentType(response) !== "application/json") {
      throw new WorkspaceBffError("invalid_response", "Workspace session 返回了错误 JSON 媒体类型。", 502);
    }
    return payload;
  }

  private async readSession(signal?: AbortSignal): Promise<WorkspaceSession> {
    const result = sessionSchema.safeParse(await this.getJson(SESSION_PATH, signal));
    if (!result.success) throw new WorkspaceBffError("invalid_response", "Workspace BFF session 响应不符合契约。", 502);
    if (Date.parse(result.data.expiresAt) <= Date.now()) throw new WorkspaceBffError("unauthenticated", "Workspace session expired.", 401);
    return result.data;
  }

  private async refreshCsrfToken(signal?: AbortSignal): Promise<void> {
    const generation = this.generation;
    const discoveredScope = this.sessionScope;
    if (!discoveredScope) {
      this.clearSessionState();
      throw new WorkspaceBffError("workspace_not_discovered", "当前登录 session 尚未发现 Workspace；请重新发现后再执行命令。", 0);
    }

    try {
      const session = await this.readSession(signal);
      if (generation !== this.generation || signal?.aborted) throw new WorkspaceBffError("session_changed", "Workspace session changed.");
      if (session.issuer !== discoveredScope.issuer
        || session.subject !== discoveredScope.subject
        || session.organizationId !== discoveredScope.organizationId) {
        throw new WorkspaceBffError("session_changed", "登录身份或组织范围已变化；请重新发现并选择 Workspace。", 0);
      }
      this.csrfToken = session.csrfToken;
      this.session = session;
    } catch (error) {
      if (generation === this.generation) this.clearSessionState();
      throw error;
    }
  }

  private clearSessionState(): void {
    this.generation++;
    this.discoveredWorkspaceIds.clear();
    this.session = null;
    this.csrfToken = null;
    this.sessionScope = null;
  }

  private scope(workspaceId: string) {
    this.requireEnabled();
    if (!this.sessionScope || !this.discoveredWorkspaceIds.has(workspaceId)) throw new WorkspaceBffError("workspace_not_discovered", "Select a discovered Workspace.");
    return { organizationId: this.sessionScope.organizationId, workspaceId };
  }
  private async securityPost<T>(path: string, body: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    await this.refreshCsrfToken(signal);
    const generation = this.generation;
    const response = await this.send(path, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": this.csrfToken!, traceparent: traceparent() }, body: JSON.stringify(body),
    }, signal);
    const payload = await readBoundedJson(response);
    if (generation !== this.generation || signal?.aborted) throw new WorkspaceBffError("session_changed", "Workspace session changed.");
    if (!response.ok) {
      const problem = problemSchema.safeParse(payload);
      if (response.status === 401) this.clearSessionState();
      throw new WorkspaceBffError(problem.success ? problem.data.code : "product_error", `Workspace request failed (HTTP ${response.status}).`, response.status, problem.success ? problem.data.traceId : undefined);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new WorkspaceBffError("invalid_response", "Workspace security response does not match its contract.", 502);
    return parsed.data;
  }
  async beginDeviceApproval(workspaceId: string, userCode: string, signal?: AbortSignal) {
    const scope = this.scope(workspaceId);
    const user_code = z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/).parse(userCode);
    const result = await this.securityPost("/api/workspace/v1/device-authorizations/approval-challenges", { userCode: user_code, scope }, approvalSchema, signal);
    this.assertScope(result.authorization.scope, scope);
    const expiry = Date.parse(result.challengeExpiresAt);
    if (expiry <= Date.now() || expiry > Date.parse(result.authorization.expiresAt) || expiry > Date.parse(this.session!.expiresAt)) throw new WorkspaceBffError("invalid_response", "Device challenge expiry is invalid.", 502);
    return result;
  }
  async completeDeviceApproval(approval: DeviceApproval, webauthnAssertion?: unknown, signal?: AbortSignal) {
    approvalSchema.parse(approval);
    const scope = this.scope(approval.authorization.scope.workspaceId);
    this.assertScope(approval.authorization.scope, scope);
    const result = await this.securityPost(`/api/workspace/v1/device-authorizations/approval-challenges/${encodeURIComponent(approval.approvalId)}/complete`, webauthnAssertion === undefined ? {} : { webauthnAssertion }, completionSchema, signal);
    this.assertScope(result.authorization.scope, scope);
    if (JSON.stringify(result.authorization) !== JSON.stringify(approval.authorization) || result.approvedBy.issuer !== this.session!.issuer || result.approvedBy.subject !== this.session!.subject) throw new WorkspaceBffError("invalid_response", "Approval identity changed.", 502);
    return result;
  }
  async denyDeviceAuthorization(workspaceId: string, userCode: string, signal?: AbortSignal) {
    const scope = this.scope(workspaceId);
    const code = z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/).parse(userCode);
    const result = await this.securityPost("/api/workspace/v1/device-authorizations/denials", { userCode: code, scope }, denialSchema, signal);
    this.assertScope(result.authorization.scope, scope);
    if (result.deniedBy.issuer !== this.session!.issuer || result.deniedBy.subject !== this.session!.subject) throw new WorkspaceBffError("invalid_response", "Denial identity changed.", 502);
    return result;
  }
  private assertScope(actual: { organizationId: string; workspaceId: string }, expected: { organizationId: string; workspaceId: string }) {
    if (actual.organizationId !== expected.organizationId || actual.workspaceId !== expected.workspaceId) throw new WorkspaceBffError("invalid_response", "Device authorization scope changed.", 502);
  }

  private async send(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    try {
      const requestSignal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]);
      return await this.fetcher(path, { ...init, signal: requestSignal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new WorkspaceBffError("unreachable", "Workspace BFF 无法访问或请求超时。", 0);
    }
  }
}
