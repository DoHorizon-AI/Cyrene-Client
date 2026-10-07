// -----------------------------------------------------------------------------
// Module: src/api.ts
// Role: Typed same-origin client for the Navigator Web Host and Product proxies.
// -----------------------------------------------------------------------------
// 中文：模块职责：为 Navigator Web Host 与 Product 代理提供同源类型化客户端。

/**
 * A JSON object received from a Product API after boundary validation.
 * 中文：经过边界校验后，从 Product API 接收的 JSON 对象。
 */
export type JsonRecord = Record<string, unknown>;

/**
 * The browser-visible session projection returned by Navigator Web Host.
 * 中文：由 Navigator Web Host 返回、可供浏览器访问的会话投影。
 */
export interface SessionPayload {
  authenticated: boolean;
  state: "AUTHENTICATED" | "ANONYMOUS";
  sessionId: string | null;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  refreshable: boolean;
  csrfToken: string | null;
  refreshed: boolean;
}

export interface GpuDeviceStatus {
  name: string;
  totalMib: number;
  usedMib: number;
  utilizationPct: number;
}

export interface GpuStatus {
  available: boolean;
  gpus?: GpuDeviceStatus[];
}

export interface DiskStatus {
  available?: boolean;
  totalGib?: number;
  usedGib?: number;
  freeGib?: number;
  usedPct?: number;
}

export interface ServiceHealthStatus {
  name: string;
  url: string;
  status: "UP" | "DOWN";
  latencyMs: number;
}

export interface BlockerInfo {
  code: string;
  message: string;
}

export interface PluginInfo {
  name: string;
  kind?: string;
  state: string;
}

export interface ActiveRoutePayload {
  gatewayEndpointId: string;
  modelId: string;
  baseUrl: string;
  apiKeyHint?: string;
}

export interface PreviewRow {
  index: number;
  mapped: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface DatasetPreview {
  versionId: string;
  totalRows: number;
  rows: PreviewRow[];
}

export interface DeploymentEvent {
  sequence: number;
  phase: string;
  message: string;
  occurredAt: string;
  failureCode?: string | null;
}

export interface DeploymentEventsResponse {
  deploymentId: string;
  events: DeploymentEvent[];
}

/**
 * Server-owned assistant task returned by Navigator's task API.
 * 中文：由 Navigator task API 管理并返回的助手任务。
 */
export interface NavigatorTaskRecord extends JsonRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  prompt: string;
  status: "queued" | "running" | "completed" | "failed" | "aborted" | "waiting_approval" | "waiting_input";
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  output: string;
  reasoning: string;
  error: string | null;
  durationMs: number;
  sequence: number;
  title?: string | null;
  description?: string | null;
  metadata: JsonRecord;
}

/** A durable task event with its server-assigned sequence. 中文：带服务端序号的持久任务事件。 */
export interface NavigatorTaskEvent {
  sequence: number;
  name: string;
  data: JsonRecord;
}

export interface NavigatorTaskPage {
  items: NavigatorTaskRecord[];
  nextCursor: string | null;
}

export interface WorkApproval extends JsonRecord {
  id: string;
  taskId: string;
  kind: string;
  summary: string;
  details: JsonRecord;
  status: "pending" | "approved" | "rejected";
}

export interface WorkInput extends JsonRecord {
  id: string;
  taskId: string;
  summary: string;
  details: JsonRecord;
  status: "pending" | "answered";
  createdAt: number;
  answeredAt: number | null;
  answeredBy: string | null;
  answer?: JsonRecord;
  messageId?: string;
}

export interface MemoryFact extends JsonRecord {
  id: string;
  namespace: string;
  key: string;
  value: JsonRecord;
  observedAt: number;
  freshUntil: number | null;
  missing: boolean;
  stale: boolean;
  sourceId: string | null;
}

export interface WorkNotification extends JsonRecord {
  id: string;
  type: string;
  status: "queued" | "leased" | "started" | "uncertain" | "delivered" | "failed";
  payload: JsonRecord;
  createdAt: number;
}

export interface WorkAttachment extends JsonRecord {
  id: string;
  sha256: string;
  name: string;
  mediaType: string;
  size: number;
  createdAt: number;
}

export interface WorkConnector extends JsonRecord {
  connectorId: string;
  status: "unknown" | "disconnected" | "authenticating" | "login_required" | "connected" | "degraded" | "error";
  configured?: boolean;
  accountId: string | null;
  detail: string | null;
  updatedAt: number;
  lastEventAt: number | null;
}

export interface QqConnectorHealth extends JsonRecord {
  status: string;
  hostState: string;
  apiReady: boolean;
  accountConfirmed: boolean;
  generation: number | null;
  clientVersion: string | null;
  hostAbi: string | null;
  failureCode: string | null;
}

export interface QqLoginChallenge {
  loginId: string;
  qrPayload: string;
  expiresAtUtc: string;
  state: "pending" | "scanned" | "authorized" | "expired" | "failed";
  accountId?: string;
}

export interface QqLoginState {
  loginId: string;
  state: "pending" | "scanned" | "authorized" | "expired" | "failed";
  accountId?: string;
}

/**
 * Safe host status; it intentionally contains no credential material.
 * 中文：安全的 Host 状态；其中有意不包含任何凭据材料。
 */
export interface SystemStatus {
  service: string;
  status: string;
  version: string;
  workspaceId?: string;
  authenticated: boolean;
  proxyPrefixes: string[];
  credentials: {
    active: number;
    revoked: number;
  };
  gpu?: GpuStatus;
  disk?: DiskStatus;
  services?: ServiceHealthStatus[];
  blockers?: BlockerInfo[];
  plugins?: PluginInfo[];
  /**
   * Base URL of the Exchange OpenAI-compatible gateway, published by the Web
   * Host. Optional so an older Web Host keeps working; consumers must fall back
   * to their previous behaviour when it is absent. The port differs between the
   * dev stack and packaged deployments, so it must never be hardcoded.
      * 中文：由 Web Host 发布的 Exchange OpenAI 兼容网关基础 URL。此字段为可选项，以便兼容较旧的 Web Host；缺失时，调用方必须回退到此前行为。开发环境与打包部署使用的端口不同，因此绝不能硬编码。
   */
  gatewayBaseUrl?: string;
  observedAt: string;
}

/**
 * Write-only credential metadata returned by the Web Host.
 * 中文：Web Host 返回的只写凭据元数据。
 */
export interface CredentialMetadata {
  id: string;
  name: string;
  provider: string;
  kind: string;
  state: string;
  credentialRef: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Gateway API key metadata returned by Exchange.
 * 中文：Exchange 返回的网关 API key 元数据。
 */
export interface ApiKeyMetadata {
  id: string;
  name: string;
  credentialRef: string;
  state: "ACTIVE" | "REVOKED";
  modelScope: string[];
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  resourceVersion?: number;
}

export interface CreateApiKeyInput {
  name: string;
  expiresAt?: string | null;
  modelScope?: string[];
}

/**
 * Model import command accepted by the Reactor Product API.
 * 中文：Reactor Product API 接受的模型导入命令。
 */
export interface CreateModelImportInput {
  name: string;
  servingBindingId: string;
  source: {
    kind: "HUGGING_FACE" | "LOCAL_PATH";
    repository?: string;
    revision?: string;
    path?: string;
  };
  credentialRef?: string;
  trustRemoteCode: false;
}

/**
 * Dataset creation command accepted by Catalyst.
 * 中文：Catalyst 接受的数据集创建命令。
 */
export interface CreateDatasetInput {
  name: string;
  description: string;
}

/**
 * Hyperparameters accepted by Yield's `TrainingParameters` model.
 *
 * Property names are camelCase because Yield's ContractModel generates aliases
 * with `to_camel`. The model is declared with `extra="forbid"`, so a typo here
 * is rejected with 422 rather than quietly ignored.
  * 中文：Yield 的 `TrainingParameters` 模型接受的超参数。
 *
 * 中文：属性名称采用 camelCase，因为 Yield 的 ContractModel 会通过 `to_camel` 生成别名。该模型声明了 `extra="forbid"`，因此字段拼写错误会返回 422，而不会被悄然忽略。
 */
export interface TrainingParametersInput {
  epochs: number;
  perDeviceBatchSize: number;
  gradientAccumulationSteps: number;
  learningRate: number;
  maxSequenceLength: number;
  loraRank: number;
  loraAlpha: number;
  loraDropout: number;
}

/**
 * Body of `PATCH /api/v1/training-drafts/{id}` (Yield "Prepare Draft").
 *
 * `baseModel` is required by Yield, so it is echoed back from the draft's
 * existing configuration rather than being re-selected on every launch.
  * 中文：`PATCH /api/v1/training-drafts/{id}` 的请求正文（Yield 的“Prepare Draft”操作）。
 *
 * 中文：Yield 要求提供 `baseModel`，因此这里会从草稿的现有配置中回传该值，而不是每次启动时重新选择。
 */
export interface TrainingDraftSpecInput {
  baseModel: JsonRecord;
  parameters: TrainingParametersInput;
}

/**
 * A stable set of same-origin proxy prefixes exposed by Navigator.
 * 中文：Navigator 暴露的一组稳定同源代理前缀。
 */
export const NAVIGATOR_PROXY_PATHS = {
  catalyst: "/api/v1/catalyst",
  echo: "/api/v1/echo",
  exchange: "/api/v1/exchange",
  navigator: "/api/v1/navigator",
  reactor: "/api/v1/reactor",
  yield: "/api/v1/yield",
} as const;

const AUTH_SESSION_PATH = "/api/v1/auth/session";
const AUTH_REFRESH_PATH = "/api/v1/auth/session/refresh";
const AUTH_PAIR_PATH = "/api/v1/auth/pair";
const AUTH_LOGOUT_PATH = "/api/v1/auth/session";

/**
 * An RFC 9457 or Web Host error raised before a page can render a result.
 * 中文：页面渲染结果之前发生的 RFC 9457 或 Web Host 错误。
 */
export class NavigatorHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly retryable: boolean;

  constructor(
    status: number,
    code: string,
    detail: string,
    retryable: boolean,
  ) {
    super(detail);
    this.name = "NavigatorHttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryable = retryable;
  }
}

/**
 * Raised when a response does not satisfy the small client-side wire contract.
 * 中文：响应不符合精简客户端 wire contract 时抛出的错误。
 */
export class NavigatorContractError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "NavigatorContractError";
  }
}

type ResponseParser<T> = (value: unknown) => T;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Own browser session material in memory and route every Product request through
 * Navigator's configured same-origin prefixes. No API origin is accepted from
 * page code and no session token is written to browser storage.
  * 中文：在内存中管理浏览器会话材料，并通过 Navigator 配置的同源前缀路由所有 Product 请求。页面代码不能指定 API origin，也不会将会话令牌写入浏览器存储。
 */
export class NavigatorApi {
  private csrfToken: string | null = null;
  private refreshInFlight: Promise<SessionPayload> | null = null;
  private sessionExpiredHandler: (() => void) | null = null;

  constructor(private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {}

  /**
   * Register the App-level response for an exhausted Web Host session.
   * 中文：为会话耗尽的 Web Host 响应注册 App 级处理函数。
   */
  setSessionExpiredHandler(handler: (() => void) | null): void {
    this.sessionExpiredHandler = handler;
  }

  /**
   * Read current session state and rotate it when only refresh state remains.
   * 中文：读取当前会话状态；如果只剩刷新凭据，则轮换会话。
   */
  async restoreSession(): Promise<SessionPayload> {
    const session = await this.getSession();
    if (!session.authenticated && session.refreshable) {
      try {
        return await this.refreshSession();
      } catch (error) {
        if (error instanceof NavigatorHttpError && error.status === 401) {
          return session;
        }
        throw error;
      }
    }
    return session;
  }

  /**
   * Pair the browser with the one-time code printed by the Web Host launcher.
   * 中文：使用 Web Host 启动器打印的一次性代码关联当前浏览器会话。
   */
  async pair(pairingCode: string): Promise<SessionPayload> {
    const value = pairingCode.trim();
    if (!value) {
      throw new NavigatorContractError("Enter the one-time Navigator pairing code.");
    }
    return this.requestJson(
      AUTH_PAIR_PATH,
      jsonRequest("POST", { pairingCode: value }),
      parseSession,
      false,
    );
  }

  /**
   * Return session state without converting anonymous access into an error.
   * 中文：读取会话状态，不会将匿名访问转换为错误。
   */
  async getSession(): Promise<SessionPayload> {
    return this.requestJson(AUTH_SESSION_PATH, { method: "GET" }, parseSession, false);
  }

  /**
   * Rotate the refresh cookie and its CSRF token, coalescing concurrent calls.
   * 中文：轮换刷新 cookie 和 CSRF token，并合并并发调用。
   */
  async refreshSession(): Promise<SessionPayload> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.requestJson(
      AUTH_REFRESH_PATH,
      { method: "POST" },
      parseSession,
      false,
    );
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  /**
   * Revoke the browser session and clear the in-memory CSRF token.
   * 中文：撤销浏览器会话并清除内存中的 CSRF token。
   */
  async logout(): Promise<void> {
    await this.requestJson<void>(
      AUTH_LOGOUT_PATH,
      { method: "DELETE" },
      () => undefined,
      false,
    );
    this.csrfToken = null;
  }

  /**
   * Read non-secret Web Host readiness and credential lifecycle counts.
   * 中文：读取不含密钥的 Web Host 就绪状态和凭据生命周期计数。
   */
  async getSystemStatus(): Promise<SystemStatus> {
    return this.requestJson(
      "/api/v1/system/status",
      { method: "GET" },
      parseSystemStatus,
    );
  }

  /**
   * Read write-only credential metadata.
   * 中文：读取只写凭据元数据。
   */
  async getCredentials(): Promise<CredentialMetadata[]> {
    return this.requestJson(
      "/api/v1/credentials",
      { method: "GET" },
      parseCredentialArray,
    );
  }

  /**
   * Create a credential without ever echoing its secret in the UI response.
   * 中文：创建凭据，且绝不在 UI 响应中回传密钥。
   */
  async createCredential(input: {
    name: string;
    provider: string;
    kind: string;
    secret: string;
  }): Promise<CredentialMetadata> {
    return this.requestJson(
      "/api/v1/credentials",
      jsonRequest("POST", input, true),
      parseCredential,
    );
  }

  /**
   * Revoke one Web Host credential by metadata identifier.
   * 中文：按元数据标识撤销一个 Web Host 凭据。
   */
  async revokeCredential(id: string): Promise<CredentialMetadata> {
    return this.requestJson(
      `/api/v1/credentials/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      parseCredential,
    );
  }

  /**
   * List Reactor-owned model imports through the Navigator proxy.
   * 中文：通过 Navigator 代理列出 Reactor 管理的模型导入项。
   */
  async getModelImports(): Promise<JsonRecord[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/model-imports`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * List serving bindings available to the current Reactor installation.
   * 中文：列出当前 Reactor 安装可用的 serving binding。
   */
  async getServingBindings(): Promise<JsonRecord[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/serving-bindings`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Start a model import with a stable mutation key.
   * 中文：使用稳定的 mutation key 启动模型导入。
   */
  async createModelImport(input: CreateModelImportInput): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/model-imports`,
      jsonRequest("POST", input, true),
      parseResource,
    );
  }

  /**
   * List Catalyst-owned dataset containers through the Navigator proxy.
   * 中文：通过 Navigator 代理列出 Catalyst 管理的数据集容器。
   */
  async getDatasets(): Promise<JsonRecord[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/datasets`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * List Preparations of one Catalyst dataset in insertion order.
   * 中文：按插入顺序列出一个 Catalyst 数据集的 Preparations。
   */
  async getPreparations(datasetId: string): Promise<JsonRecord[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/datasets/${encodeURIComponent(datasetId)}/preparations`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Upload a source file as a new Preparation.
   *
   * Catalyst reads the raw request body (not multipart) and takes the display
   * name and original filename from the query string.
      * 中文：将源文件上传为新的 Preparation。
   *
   * 中文：Catalyst 读取原始请求正文（不是 multipart），并从 query string 获取显示名称和原始文件名。
   */
  async createPreparation(
    datasetId: string,
    name: string,
    filename: string,
    body: string,
    contentType: string,
  ): Promise<JsonRecord> {
    const query = new URLSearchParams({ name, filename });
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/datasets/${encodeURIComponent(datasetId)}/preparations?${query}`,
      {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      },
      parseResource,
    );
  }

  /**
   * Declare how imported fields map onto the SFT training shape.
   * 中文：声明导入字段如何映射到 SFT 训练数据结构。
   */
  async configurePreparationMapping(
    preparationId: string,
    command: Record<string, unknown>,
  ): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/preparations/${encodeURIComponent(preparationId)}/mapping`,
      jsonRequest("PATCH", command, true),
      parseResource,
    );
  }

  /**
   * Run preparation (validate + deduplicate) on a mapped Preparation.
   * 中文：对已映射的 Preparation 执行预处理（校验并去重）。
   */
  async confirmPreparation(preparationId: string): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/preparations/${encodeURIComponent(preparationId)}/confirm`,
      jsonRequest("POST", {}, true),
      parseResource,
    );
  }

  /**
   * Publish a confirmed Preparation into an immutable DatasetVersion.
   * 中文：将已确认的 Preparation 发布为不可变 DatasetVersion。
   */
  async publishPreparation(preparationId: string): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/preparations/${encodeURIComponent(preparationId)}/publish`,
      jsonRequest("POST", {}, true),
      parseResource,
    );
  }

  /**
   * Hand the published version to Yield as a training draft.
   * 中文：将已发布的数据集版本交给 Yield，作为训练草稿使用。
   */
  async sendPreparationToYield(preparationId: string): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/preparations/${encodeURIComponent(preparationId)}/yield-draft`,
      jsonRequest("POST", {}, true),
      parseResource,
    );
  }

  /**
   * List the DatasetVersions of one Catalyst dataset, newest first.
   *
   * Lets the console offer a picker instead of making the user paste a UUID.
      * 中文：按从新到旧的顺序列出一个 Catalyst 数据集的 DatasetVersions。
   *
   * 这样控制台可以提供选择器，而不必让用户手动粘贴 UUID。
   */
  async getDatasetVersions(datasetId: string): Promise<JsonRecord[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/datasets/${encodeURIComponent(datasetId)}/versions`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Create a dataset container; file preparation remains Catalyst-owned.
   * 中文：创建数据集容器；文件预处理仍由 Catalyst 管理。
   */
  async createDataset(input: CreateDatasetInput): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/datasets`,
      jsonRequest("POST", input, true),
      parseResource,
    );
  }

  /**
   * List Yield-owned training drafts through the Navigator proxy.
   * 中文：通过 Navigator 代理列出 Yield 管理的训练草稿。
   */
  async getTrainingDrafts(): Promise<JsonRecord[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-drafts`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Persist a draft's base model and hyperparameters before launch.
   *
   * Yield owns these values; without this call the training run starts with
   * whatever the draft already carried and any UI edits are silently lost.
      * 中文：在启动前，将草稿的基础模型和超参数持久化保存到 Yield。
   *
   * 中文：这些值由 Yield 管理；如果不调用此接口，训练会使用草稿当前已有的值，UI 中的修改会被静默丢弃。
   */
  async updateTrainingDraft(id: string, spec: TrainingDraftSpecInput): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-drafts/${encodeURIComponent(id)}`,
      jsonRequest("PATCH", spec, true),
      parseResource,
    );
  }

  /**
   * Start one prepared training draft.
   * 中文：启动一个已准备好的训练草稿。
   */
  async startTrainingDraft(id: string, idempotencyKey?: string): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-drafts/${encodeURIComponent(id)}/actions/start`,
      jsonRequest("POST", {}, idempotencyKey ?? true),
      parseResource,
    );
  }

  /**
   * Read a Yield training run by its owning Product identifier.
   * 中文：按其所属 Product 标识读取一项 Yield 训练运行。
   */
  async getTrainingRun(id: string, signal?: AbortSignal): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-runs/${encodeURIComponent(id)}`,
      { method: "GET", signal },
      parseResource,
    );
  }

  /** Read the durable draft link before retrying a launch. 中文：重试启动前读取持久化草稿关联。 */
  async getTrainingDraft(id: string): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-drafts/${encodeURIComponent(id)}`,
      { method: "GET" },
      parseResource,
    );
  }

  /** Resume ordered events through the authenticated proxy. 中文：通过认证代理按游标续读事件。 */
  async openTrainingRunEvents(id: string, afterSequence: number, signal: AbortSignal): Promise<Response> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new NavigatorContractError("Invalid training event cursor.");
    }
    const path = `${NAVIGATOR_PROXY_PATHS.yield}/training-runs/${encodeURIComponent(id)}/events/stream?after_sequence=${afterSequence}`;
    const response = await this.requestResponse(path, {
      method: "GET", signal,
      headers: { Accept: "text/event-stream", "Last-Event-ID": String(afterSequence) },
    });
    if (!response.ok) {
      // Keep the HTTP status even when a proxy returns a non-JSON error page.
      // 中文：代理返回非 JSON 错误页时仍保留 HTTP 状态。
      let problem: unknown;
      try { problem = await response.json(); } catch { problem = undefined; }
      throw toHttpError(response.status, problem);
    }
    if (!response.body || response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/event-stream") {
      await response.body?.cancel();
      throw new NavigatorContractError("Yield did not return an event stream.");
    }
    return response;
  }

  /**
   * Resume a stopped run from a complete checkpoint.
   *
   * Yield requires an explicit checkpoint, so the caller passes the name
   * observed in the event stream rather than relying on an implicit "latest".
      * 中文：从完整检查点恢复一项已停止的运行。
   *
   * 中文：Yield 要求显式指定检查点，因此调用方应传入从事件流中观察到的名称，而不能依赖隐式的“最新”检查点。
   */
  async resumeTrainingRun(
    runId: string,
    checkpointName?: string,
    idempotencyKey?: string,
  ): Promise<JsonRecord> {
    const body = checkpointName ? { checkpointName } : {};
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-runs/${encodeURIComponent(runId)}/actions/resume`,
      jsonRequest("POST", body, idempotencyKey ?? true),
      parseResource,
    );
  }

  /**
   * Hand a completed training result to Reactor for deployment.
   * 中文：将已完成的训练结果交给 Reactor 部署。
   */
  async sendResultToReactor(resultId: string): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-results/${encodeURIComponent(resultId)}/actions/send-to-reactor`,
      jsonRequest("POST", {}, false),
      parseResource,
    );
  }

  /**
   * Read public attempt diagnostics for one training run.
   * 中文：读取某次训练运行公开的尝试诊断信息。
   */
  async getTrainingRunAttempts(id: string, signal?: AbortSignal): Promise<JsonRecord[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-runs/${encodeURIComponent(id)}/attempts`,
      { method: "GET", signal },
      parseResourceArray,
    );
  }

  /**
   * Request cancellation without pretending that cancellation is synchronous.
   * 中文：请求取消操作；不会假装取消是同步完成的。
   */
  async cancelTrainingRun(id: string): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.yield}/training-runs/${encodeURIComponent(id)}/actions/cancel`,
      jsonRequest("POST", {}, true),
      parseResource,
    );
  }

  /**
   * List Reactor deployment intent and observed lifecycle projections.
   * 中文：列出 Reactor 的部署意图和观测到的生命周期投影。
   */
  async getDeployments(): Promise<JsonRecord[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/deployments`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Stop one deployment through Reactor's explicit lifecycle action.
   * 中文：通过 Reactor 的显式生命周期操作停止一项部署。
   */
  async stopDeployment(id: string): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/deployments/${encodeURIComponent(id)}/actions/stop`,
      jsonRequest("POST", {}, true),
      parseResource,
    );
  }

  /**
   * Read Gateway routes configured on Exchange.
   * 中文：读取 Exchange 配置的网关路由。
   */
  async getGatewayRoutes(): Promise<JsonRecord[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/gateway-routes`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Read Gateway endpoints configured on Exchange.
   * 中文：读取 Exchange 配置的网关 Endpoint。
   */
  async getGatewayEndpoints(): Promise<JsonRecord[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/gateway-endpoints`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Confirm and publish a draft gateway route.
   * 中文：确认并发布一条草稿网关路由。
   */
  async confirmGatewayRoute(routeId: string, resourceVersion: number): Promise<JsonRecord> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/gateway-route-drafts/${encodeURIComponent(routeId)}/actions/confirm`,
      jsonRequest("POST", { resourceVersion }, true),
      parseResource,
    );
  }

  /**
   * List Exchange gateway API keys.
   * 中文：列出 Exchange 网关 API key。
   */
  async listApiKeys(): Promise<ApiKeyMetadata[]> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/api-keys`,
      { method: "GET" },
      parseApiKeyArray,
    );
  }

  /**
   * Create an Exchange gateway API key; secret is returned exactly once.
   * 中文：创建 Exchange 网关 API key；密钥只会返回一次。
   */
  async createApiKey(
    routeId: string,
    input: CreateApiKeyInput | JsonRecord,
  ): Promise<{ key: ApiKeyMetadata; secret: string }> {
    void routeId;
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/api-keys`,
      jsonRequest("POST", input, true),
      parseCreatedApiKey,
    );
  }

  /**
   * Revoke an Exchange gateway API key.
   * 中文：撤销一个 Exchange 网关 API key。
   */
  async revokeApiKey(id: string): Promise<ApiKeyMetadata> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/api-keys/${encodeURIComponent(id)}/actions/revoke`,
      jsonRequest("POST", {}, true),
      parseApiKey,
    );
  }

  /**
   * Read dataset version sample preview through Catalyst proxy.
   * 中文：通过 Catalyst 代理读取数据集版本的样本预览。
   */
  async getDatasetVersionPreview(
    versionId: string,
    limit: number = 10,
    offset: number = 0,
  ): Promise<DatasetPreview> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/dataset-versions/${encodeURIComponent(versionId)}/preview?limit=${limit}&offset=${offset}`,
      { method: "GET" },
      parseDatasetPreview,
    );
  }

  /**
   * Send a raw response request to the published Catalyst or Echo API through
   * the same-origin Navigator proxy. Use this for new Product contract routes
   * and binary downloads while keeping session refresh and CSRF in one place.
   * 中文：通过 Navigator 同源代理请求 Catalyst 或 Echo API 原始响应；新 Product 路由和二进制下载仍复用会话轮换与 CSRF 处理。
   */
  async requestProductResponse(path: string, init: RequestInit = {}): Promise<Response> {
    if (!isPublishedProductPath(path)) {
      throw new NavigatorContractError("Product requests must use a published Catalyst or Echo same-origin path.");
    }
    return this.requestResponse(path, init);
  }

  /**
   * Read deployment loading phase events through Reactor proxy.
   * 中文：通过 Reactor 代理读取部署加载阶段事件。
   */
  async getDeploymentEvents(deploymentId: string): Promise<DeploymentEventsResponse> {
    return this.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/deployments/${encodeURIComponent(deploymentId)}/events`,
      { method: "GET" },
      parseDeploymentEventsResponse,
    );
  }

  /**
   * Read active gateway route from Navigator Web Host session.
   * 中文：从 Navigator Web Host 会话读取当前网关路由。
   */
  async getActiveRoute(): Promise<ActiveRoutePayload> {
    return this.requestJson(
      "/api/v1/navigator/active-route",
      { method: "GET" },
      parseActiveRoute,
    );
  }

  /**
   * Store active gateway route into Navigator Web Host session.
   * 中文：将当前网关路由写入 Navigator Web Host 会话。
   */
  async setActiveRoute(payload: ActiveRoutePayload): Promise<ActiveRoutePayload> {
    return this.requestJson(
      "/api/v1/navigator/active-route",
      jsonRequest("POST", payload, true),
      parseActiveRoute,
    );
  }

  /**
   * Read the server-owned assistant task ledger through Control and Web Host.
   * 中文：经 Control 与 Web Host 读取服务端管理的助手任务记录。
   */
  async getAssistantTasks(cursor?: string, limit = 50): Promise<NavigatorTaskPage> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    return this.requestJson(
      `/api/v1/navigator/tasks?${query}`,
      { method: "GET" },
      parseTaskPage,
    );
  }

  /**
   * Submit a prompt; omitting sessionId asks Navigator to create a fresh agent session.
   * 中文：提交提示词；省略 sessionId 时由 Navigator 创建新的 agent 会话。
   */
  async createAssistantTask(input: {
    prompt: string;
    sessionId?: string;
    title?: string;
    description?: string;
    metadata?: JsonRecord;
  }): Promise<NavigatorTaskRecord> {
    return this.requestJson(
      "/api/v1/navigator/tasks",
      jsonRequest("POST", input, true),
      parseTaskRecord,
    );
  }

  /** Read the latest server-owned projection for one task. 中文：读取单项任务的最新服务端投影。 */
  async getAssistantTask(id: string, signal?: AbortSignal): Promise<NavigatorTaskRecord> {
    return this.requestJson(
      `/api/v1/navigator/tasks/${encodeURIComponent(id)}`,
      { method: "GET", signal },
      parseTaskRecord,
    );
  }

  /** Request cancellation and let the owner publish the resulting status. 中文：请求取消，并由所属服务发布最终状态。 */
  async cancelAssistantTask(id: string): Promise<{ taskId: string; cancelled: boolean }> {
    return this.requestJson(
      `/api/v1/navigator/tasks/${encodeURIComponent(id)}/cancel`,
      jsonRequest("POST", {}, true),
      parseTaskCancellation,
    );
  }

  /**
   * Open the resumable event stream for one task without making the browser its state owner.
   * 中文：打开单项任务的可续传事件流；浏览器不会因此成为任务状态权威。
   */
  async openAssistantTaskEvents(id: string, afterSequence: number, signal: AbortSignal): Promise<Response> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new NavigatorContractError("Invalid assistant task event cursor.");
    }
    const path = `/api/v1/navigator/tasks/${encodeURIComponent(id)}/events?after=${afterSequence}`;
    const response = await this.requestResponse(path, {
      method: "GET",
      signal,
      headers: { Accept: "text/event-stream", "Last-Event-ID": String(afterSequence) },
    });
    if (!response.ok) {
      let problem: unknown;
      try { problem = await response.json(); } catch { problem = undefined; }
      throw toHttpError(response.status, problem);
    }
    if (!response.body || response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/event-stream") {
      await response.body?.cancel();
      throw new NavigatorContractError("Navigator did not return an assistant task event stream.");
    }
    return response;
  }

  /** Read pending approval records from the configured durable workspace. 中文：读取工作空间中的待审批记录。 */
  async getWorkApprovals(workspaceId: string): Promise<WorkApproval[]> {
    const query = new URLSearchParams({ status: "pending", limit: "100" });
    return this.requestJson(workPath(workspaceId, `approvals?${query}`), { method: "GET" }, parseApprovalList);
  }

  /** Resolve an approval exactly once through its owning work service. 中文：通过所属工作服务一次性完成审批。 */
  async resolveWorkApproval(workspaceId: string, approvalId: string, decision: "approved" | "rejected"): Promise<JsonRecord> {
    return this.requestJson(
      workPath(workspaceId, `approvals/${workId(approvalId)}/resolve`),
      jsonRequest("POST", { decision, messageId: makeIdempotencyKey() }, true),
      parseResource,
    );
  }

  /** Read pending user-input requests owned by the configured workspace. 中文：读取当前工作空间中的待补充信息请求。 */
  async getWorkInputs(workspaceId: string): Promise<WorkInput[]> {
    const query = new URLSearchParams({ status: "pending", limit: "100" });
    return this.requestJson(workPath(workspaceId, `inputs?${query}`), { method: "GET" }, parseWorkInputList);
  }

  /** Answer one durable user-input request through its workspace owner. 中文：通过工作空间服务回答一项持久化的信息请求。 */
  async resolveWorkInput(workspaceId: string, inputId: string, answer: string, messageId = makeIdempotencyKey()): Promise<JsonRecord> {
    return this.requestJson(
      workPath(workspaceId, `inputs/${workId(inputId)}/resolve`),
      jsonRequest("POST", { answer: { text: answer }, messageId }, messageId),
      parseResource,
    );
  }

  /** Read fresh and stale structured facts with provenance metadata. 中文：读取带来源信息的新旧结构化事实。 */
  async getMemoryFacts(workspaceId: string): Promise<MemoryFact[]> {
    const query = new URLSearchParams({ includeStale: "true", limit: "100" });
    return this.requestJson(workPath(workspaceId, `memory/facts?${query}`), { method: "GET" }, parseMemoryFacts);
  }

  /** Search durable memory using the Work API's explicit text query. 中文：按明确查询读取持久记忆。 */
  async queryMemory(workspaceId: string, queryText: string): Promise<MemoryFact[]> {
    return this.requestJson(
      workPath(workspaceId, "memory/query"),
      jsonRequest("POST", { query: queryText, limit: 100, includeStale: true }),
      parseMemoryFacts,
    );
  }

  /** Store one user-provided fact with an explicit provenance label. 中文：以明确来源标签保存用户提供的事实。 */
  async saveMemoryFact(workspaceId: string, input: { namespace: string; key: string; value: JsonRecord; sourceId?: string }): Promise<MemoryFact> {
    return this.requestJson(
      workPath(workspaceId, "memory/facts"),
      jsonRequest("POST", input, true),
      parseMemoryFact,
    );
  }

  /** Read the workspace notification outbox without claiming or sending anything. 中文：只读通知发件箱，不租用或发送通知。 */
  async getWorkNotifications(workspaceId: string): Promise<WorkNotification[]> {
    const query = new URLSearchParams({ limit: "100" });
    return this.requestJson(workPath(workspaceId, `notifications?${query}`), { method: "GET" }, parseNotificationList);
  }

  /** Upload one bounded attachment as base64 through the same-origin work proxy. 中文：通过同源 work 代理上传有大小上限的附件。 */
  async uploadWorkAttachment(workspaceId: string, input: { name: string; mediaType: string; contentBase64: string }): Promise<WorkAttachment> {
    return this.requestJson(workPath(workspaceId, "attachments"), jsonRequest("POST", input, true), parseAttachment);
  }

  /** Download by content digest; no arbitrary URL can be supplied. 中文：按内容摘要下载，不接受任意 URL。 */
  async downloadWorkAttachment(workspaceId: string, sha256: string): Promise<Response> {
    if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new NavigatorContractError("Invalid attachment digest.");
    const response = await this.requestResponse(workPath(workspaceId, `attachments/${sha256}`), { method: "GET" });
    if (!response.ok) {
      let problem: unknown;
      try { problem = await response.json(); } catch { problem = undefined; }
      throw toHttpError(response.status, problem);
    }
    return response;
  }

  /** Read safe connector projections without exposing host credentials. 中文：读取安全连接器投影，不暴露主机凭据。 */
  async getWorkConnectors(workspaceId: string): Promise<WorkConnector[]> {
    return this.requestJson(workPath(workspaceId, "connectors"), { method: "GET" }, parseConnectorList);
  }

  /** Probe the configured QQ binding on the Navigator host. 中文：检查 Navigator 主机上配置的 QQ binding。 */
  async getQqHealth(workspaceId: string, bindingId: string): Promise<QqConnectorHealth> {
    return this.requestJson(workPath(workspaceId, `connectors/${workId(bindingId)}/health`), { method: "GET" }, parseQqHealth);
  }

  /** Request a short-lived QR challenge for the configured QQ binding. 中文：为已配置 QQ binding 请求短时二维码。 */
  async startQqLogin(workspaceId: string, bindingId: string): Promise<QqLoginChallenge> {
    return this.requestJson(
      workPath(workspaceId, `connectors/${workId(bindingId)}/login/qr`),
      jsonRequest("POST", {}, true),
      parseQqLoginChallenge,
    );
  }

  /** Poll the binding-local login state without resubmitting QR data. 中文：查询 binding 本地登录状态，不重传二维码内容。 */
  async pollQqLogin(workspaceId: string, bindingId: string, loginId: string): Promise<QqLoginState> {
    return this.requestJson(
      workPath(workspaceId, `connectors/${workId(bindingId)}/login/poll`),
      jsonRequest("POST", { loginId }, true),
      parseQqLoginState,
    );
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    parser: ResponseParser<T>,
    retryAuth = true,
  ): Promise<T> {
    const response = await this.requestResponse(path, init, retryAuth);
    return readResponse(response, path, parser, this.acceptSession.bind(this));
  }

  private async requestResponse(path: string, init: RequestInit, retryAuth = true): Promise<Response> {
    init.signal?.throwIfAborted();
    const response = await this.send(path, init);
    if (response.status === 401 && retryAuth && !path.startsWith("/api/v1/auth/")) {
      let authenticated = false;
      try {
        const refreshed = await this.refreshSession();
        authenticated = refreshed.authenticated;
      } catch {
        // The original response contains the useful Product/Web Host problem.
                // 中文：原始响应包含有用的 Product/Web Host 错误信息。
      }
      init.signal?.throwIfAborted();
      if (authenticated) {
        await response.body?.cancel();
        return this.requestResponse(path, init, false);
      }
    }
    if (response.status === 401 && !path.startsWith("/api/v1/auth/")) {
      this.sessionExpiredHandler?.();
      this.csrfToken = null;
    }
    return response;
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    const method = (init.method || "GET").toUpperCase();
    const isMutation = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
    if (isMutation && this.csrfToken && !headers.has("X-CSRF-Token")) {
      headers.set("X-CSRF-Token", this.csrfToken);
    }
    if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return this.fetcher(path, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  }

  private acceptSession(payload: SessionPayload): void {
    if (payload.csrfToken) {
      this.csrfToken = payload.csrfToken;
      return;
    }
    if (!payload.refreshable) {
      this.csrfToken = null;
    } else if (!this.csrfToken) {
      this.csrfToken = readCookie("cyrene_csrf");
    }
  }
}

/**
 * Create a JSON request and an idempotency key for a Product mutation.
 * 中文：为 Product mutation 创建 JSON 请求和幂等键。
 */
function jsonRequest(method: string, body: unknown, idempotent: boolean | string = false): RequestInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotent) {
    headers["Idempotency-Key"] = typeof idempotent === "string" ? idempotent : makeIdempotencyKey();
  }
  return { method, headers, body: JSON.stringify(body) };
}

/** Reject absolute URLs and ambiguous encoded paths before Product proxy dispatch. */
function isPublishedProductPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://") || path.includes("\\")) return false;
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  if (!/^\/api\/v1\/(?:catalyst|echo)\//.test(pathname)) return false;
  if (/%(?:2f|5c|2e|25|00)/i.test(pathname) || pathname.split("/").includes("..")) return false;
  return true;
}

/** Keep one key for each explicit command and its retries. 中文：每次显式命令及其重试使用同一幂等键。 */
export function makeIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `navigator-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readResponse<T>(
  response: Response,
  path: string,
  parser: ResponseParser<T>,
  acceptSession: (payload: SessionPayload) => void,
): Promise<T> {
  const text = await response.text();
  const body: unknown = text ? parseJson(text, path) : undefined;
  if (!response.ok) {
    throw toHttpError(response.status, body);
  }
  const parsed = parser(body);
  if (isSessionPayload(parsed)) {
    acceptSession(parsed);
  }
  return parsed;
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new NavigatorContractError(`Navigator returned non-JSON data for ${path}.`);
  }
}

function toHttpError(status: number, body: unknown): NavigatorHttpError {
  const record = isRecord(body) ? body : {};
  return new NavigatorHttpError(
    status,
    readString(record, "code", `HTTP_${status}`),
    readString(record, "detail", `Navigator request failed with HTTP ${status}.`),
    readBoolean(record, "retryable", status >= 500),
  );
}

function parseSession(value: unknown): SessionPayload {
  const record = requireRecord(value, "auth session");
  const state = readString(record, "state", "");
  if (state !== "AUTHENTICATED" && state !== "ANONYMOUS") {
    throw new NavigatorContractError("Navigator returned an unknown session state.");
  }
  return {
    authenticated: requireBoolean(record, "authenticated", "auth session"),
    state,
    sessionId: readNullableString(record, "sessionId"),
    expiresAt: readNullableString(record, "expiresAt"),
    refreshExpiresAt: readNullableString(record, "refreshExpiresAt"),
    refreshable: requireBoolean(record, "refreshable", "auth session"),
    csrfToken: readNullableString(record, "csrfToken"),
    refreshed: requireBoolean(record, "refreshed", "auth session"),
  };
}

function parseSystemStatus(value: unknown): SystemStatus {
  const record = requireRecord(value, "system status");
  const credentials = requireRecord(record.credentials, "system status credentials");
  const prefixes = record.proxyPrefixes;
  if (!Array.isArray(prefixes) || !prefixes.every((prefix) => typeof prefix === "string")) {
    throw new NavigatorContractError("Navigator returned invalid proxy prefix metadata.");
  }

  let gpu: GpuStatus | undefined;
  if (record.gpu && typeof record.gpu === "object") {
    const gpuRec = record.gpu as Record<string, unknown>;
    const gpus = Array.isArray(gpuRec.gpus)
      ? gpuRec.gpus.map((g) => {
          const gr = requireRecord(g, "gpu device");
          return {
            name: requireString(gr, "name", "gpu name"),
            totalMib: requireNumber(gr, "totalMib", "gpu totalMib"),
            usedMib: requireNumber(gr, "usedMib", "gpu usedMib"),
            utilizationPct: requireNumber(gr, "utilizationPct", "gpu utilizationPct"),
          };
        })
      : undefined;
    gpu = {
      available: Boolean(gpuRec.available),
      gpus,
    };
  }

  let disk: DiskStatus | undefined;
  if (record.disk && typeof record.disk === "object") {
    const diskRec = record.disk as Record<string, unknown>;
    disk = {
      available: diskRec.available !== undefined ? Boolean(diskRec.available) : undefined,
      totalGib: typeof diskRec.totalGib === "number" ? diskRec.totalGib : undefined,
      usedGib: typeof diskRec.usedGib === "number" ? diskRec.usedGib : undefined,
      freeGib: typeof diskRec.freeGib === "number" ? diskRec.freeGib : undefined,
      usedPct: typeof diskRec.usedPct === "number" ? diskRec.usedPct : undefined,
    };
  }

  let services: ServiceHealthStatus[] | undefined;
  if (Array.isArray(record.services)) {
    services = record.services.map((s) => {
      const sr = requireRecord(s, "service health");
      return {
        name: requireString(sr, "name", "service name"),
        url: requireString(sr, "url", "service url"),
        status: sr.status === "UP" ? ("UP" as const) : ("DOWN" as const),
        latencyMs: requireNumber(sr, "latencyMs", "service latencyMs"),
      };
    });
  }

  let blockers: BlockerInfo[] | undefined;
  if (Array.isArray(record.blockers)) {
    blockers = record.blockers.map((b) => {
      const br = requireRecord(b, "blocker");
      return {
        code: requireString(br, "code", "blocker code"),
        message: requireString(br, "message", "blocker message"),
      };
    });
  }

  let plugins: PluginInfo[] | undefined;
  if (Array.isArray(record.plugins)) {
    plugins = record.plugins.map((p) => {
      const pr = requireRecord(p, "plugin");
      return {
        name: requireString(pr, "name", "plugin name"),
        kind: typeof pr.kind === "string" ? pr.kind : undefined,
        state: requireString(pr, "state", "plugin state"),
      };
    });
  }

  return {
    service: requireString(record, "service", "system status"),
    status: requireString(record, "status", "system status"),
    version: requireString(record, "version", "system status"),
    workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : typeof record.workspace_id === "string" ? record.workspace_id : undefined,
    authenticated: requireBoolean(record, "authenticated", "system status"),
    proxyPrefixes: prefixes,
    credentials: {
      active: requireNumber(credentials, "active", "credential counts"),
      revoked: requireNumber(credentials, "revoked", "credential counts"),
    },
    gpu,
    disk,
    services,
    blockers,
    plugins,
    observedAt: requireString(record, "observedAt", "system status"),
  };
}

function parseDatasetPreview(value: unknown): DatasetPreview {
  const record = requireRecord(value, "dataset preview");
  const versionId = String(record.versionId ?? record.version_id ?? "");
  const totalRows = typeof record.totalRows === "number" ? record.totalRows : typeof record.total_rows === "number" ? record.total_rows : 0;
  const rows = requireArray(record.rows, "preview rows").map((row, index) => {
    const r = requireRecord(row, "preview row");
    return {
      index: typeof r.index === "number" ? r.index : index,
      mapped: isRecord(r.mapped) ? r.mapped : {},
      raw: isRecord(r.raw) ? r.raw : {},
    };
  });
  return { versionId, totalRows, rows };
}

function parseDeploymentEventsResponse(value: unknown): DeploymentEventsResponse {
  const record = requireRecord(value, "deployment events response");
  const deploymentId = String(record.deploymentId ?? record.deployment_id ?? "");
  const events = requireArray(record.events, "deployment events").map((evt) => {
    const e = requireRecord(evt, "deployment event");
    return {
      sequence: typeof e.sequence === "number" ? e.sequence : 0,
      phase: requireString(e, "phase", "event phase"),
      message: requireString(e, "message", "event message"),
      occurredAt: String(e.occurredAt ?? e.occurred_at ?? ""),
      failureCode: typeof (e.failureCode ?? e.failure_code) === "string" ? String(e.failureCode ?? e.failure_code) : null,
    };
  });
  return { deploymentId, events };
}

function parseActiveRoute(value: unknown): ActiveRoutePayload {
  const record = requireRecord(value, "active route");
  return {
    gatewayEndpointId: String(record.gatewayEndpointId ?? record.gateway_endpoint_id ?? ""),
    modelId: String(record.modelId ?? record.model_id ?? ""),
    baseUrl: String(record.baseUrl ?? record.base_url ?? ""),
    apiKeyHint: typeof (record.apiKeyHint ?? record.api_key_hint) === "string" ? String(record.apiKeyHint ?? record.api_key_hint) : undefined,
  };
}

function parseApiKey(value: unknown): ApiKeyMetadata {
  const record = requireRecord(value, "api key");
  const rawState = requireString(record, "state", "api key state");
  const state: "ACTIVE" | "REVOKED" = rawState === "REVOKED" ? "REVOKED" : "ACTIVE";
  const modelScopeRaw = record.modelScope ?? record.model_scope;
  const modelScope = Array.isArray(modelScopeRaw)
    ? modelScopeRaw.map((item) => String(item))
    : [];

  return {
    id: requireString(record, "id", "api key id"),
    name: requireString(record, "name", "api key name"),
    credentialRef: String(record.credentialRef ?? record.credential_ref ?? ""),
    state,
    modelScope,
    createdAt: String(record.createdAt ?? record.created_at ?? ""),
    expiresAt: readNullableString(record, "expiresAt") ?? readNullableString(record, "expires_at"),
    revokedAt: readNullableString(record, "revokedAt") ?? readNullableString(record, "revoked_at"),
    resourceVersion: typeof record.resourceVersion === "number" ? record.resourceVersion : undefined,
  };
}

function parseApiKeyArray(value: unknown): ApiKeyMetadata[] {
  return requireArray(value, "api keys").map((item) => parseApiKey(item));
}

function parseCreatedApiKey(value: unknown): { key: ApiKeyMetadata; secret: string } {
  const record = requireRecord(value, "created api key");
  const key = parseApiKey(record);
  const secret = requireString(record, "secret", "api key secret");
  return { key, secret };
}

function parseCredentialArray(value: unknown): CredentialMetadata[] {
  return requireArray(value, "credentials").map((item) => parseCredential(item));
}

function parseCredential(value: unknown): CredentialMetadata {
  const record = requireRecord(value, "credential metadata");
  return {
    id: requireString(record, "id", "credential metadata"),
    name: requireString(record, "name", "credential metadata"),
    provider: requireString(record, "provider", "credential metadata"),
    kind: requireString(record, "kind", "credential metadata"),
    state: requireString(record, "state", "credential metadata"),
    credentialRef: requireString(record, "credentialRef", "credential metadata"),
    createdAt: requireString(record, "createdAt", "credential metadata"),
    updatedAt: requireString(record, "updatedAt", "credential metadata"),
  };
}

function parseResourceArray(value: unknown): JsonRecord[] {
  return requireArray(value, "Product resource list").map((item) =>
    requireRecord(item, "Product resource"),
  );
}

function parseResource(value: unknown): JsonRecord {
  return requireRecord(value, "Product resource");
}

function parseTaskRecord(value: unknown): NavigatorTaskRecord {
  const record = requireRecord(value, "assistant task");
  const metadata = requireRecord(record.metadata, "assistant task metadata");
  const status = requireString(record, "status", "assistant task");
  const statuses: NavigatorTaskRecord["status"][] = ["queued", "running", "completed", "failed", "aborted", "waiting_approval", "waiting_input"];
  if (!statuses.includes(status as NavigatorTaskRecord["status"])) {
    throw new NavigatorContractError("Navigator returned an unknown assistant task status.");
  }
  return {
    ...record,
    id: requireString(record, "id", "assistant task"),
    workspaceId: requireString(record, "workspaceId", "assistant task"),
    sessionId: requireString(record, "sessionId", "assistant task"),
    prompt: requireString(record, "prompt", "assistant task"),
    status: status as NavigatorTaskRecord["status"],
    createdAt: requireNumber(record, "createdAt", "assistant task"),
    startedAt: readNullableNumber(record, "startedAt", "assistant task"),
    endedAt: readNullableNumber(record, "endedAt", "assistant task"),
    output: requireString(record, "output", "assistant task"),
    reasoning: requireString(record, "reasoning", "assistant task"),
    error: readNullableString(record, "error"),
    durationMs: requireNumber(record, "durationMs", "assistant task"),
    sequence: requireNumber(record, "sequence", "assistant task"),
    title: readNullableString(record, "title"),
    description: readNullableString(record, "description"),
    metadata,
  };
}

function parseTaskPage(value: unknown): NavigatorTaskPage {
  const record = requireRecord(value, "assistant task page");
  return {
    items: requireArray(record.items, "assistant tasks").map(parseTaskRecord),
    nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : null,
  };
}

function parseTaskCancellation(value: unknown): { taskId: string; cancelled: boolean } {
  const record = requireRecord(value, "assistant task cancellation");
  return {
    taskId: requireString(record, "taskId", "assistant task cancellation"),
    cancelled: requireBoolean(record, "cancelled", "assistant task cancellation"),
  };
}

function parseApprovalList(value: unknown): WorkApproval[] {
  const record = requireRecord(value, "approval list");
  return requireArray(record.items, "approvals").map(parseApproval);
}

function parseApproval(value: unknown): WorkApproval {
  const record = requireRecord(value, "approval");
  const status = requireString(record, "status", "approval");
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    throw new NavigatorContractError("Navigator returned an unknown approval status.");
  }
  return {
    ...record,
    id: requireString(record, "id", "approval"),
    taskId: requireString(record, "taskId", "approval"),
    kind: requireString(record, "kind", "approval"),
    summary: requireString(record, "summary", "approval"),
    details: isRecord(record.details) ? record.details : {},
    status,
  };
}

function parseWorkInputList(value: unknown): WorkInput[] {
  const record = requireRecord(value, "user-input list");
  return requireArray(record.items, "user-input requests").map(parseWorkInput);
}

function parseWorkInput(value: unknown): WorkInput {
  const record = requireRecord(value, "user-input request");
  const status = requireString(record, "status", "user-input request");
  if (status !== "pending" && status !== "answered") {
    throw new NavigatorContractError("Navigator returned an unknown user-input status.");
  }
  return {
    ...record,
    id: requireString(record, "id", "user-input request"),
    taskId: requireString(record, "taskId", "user-input request"),
    summary: requireString(record, "summary", "user-input request"),
    details: isRecord(record.details) ? record.details : {},
    status,
    createdAt: requireNumber(record, "createdAt", "user-input request"),
    answeredAt: typeof record.answeredAt === "number" ? record.answeredAt : null,
    answeredBy: readNullableString(record, "answeredBy"),
    ...(isRecord(record.answer) ? { answer: record.answer } : {}),
    ...(typeof record.messageId === "string" ? { messageId: record.messageId } : {}),
  };
}

function parseMemoryFacts(value: unknown): MemoryFact[] {
  const record = requireRecord(value, "memory facts");
  return requireArray(record.items, "memory facts").map(parseMemoryFact);
}

function parseMemoryFact(value: unknown): MemoryFact {
  const record = requireRecord(value, "memory fact");
  return {
    ...record,
    id: requireString(record, "id", "memory fact"),
    namespace: requireString(record, "namespace", "memory fact"),
    key: requireString(record, "key", "memory fact"),
    value: isRecord(record.value) ? record.value : {},
    observedAt: requireNumber(record, "observedAt", "memory fact"),
    freshUntil: typeof record.freshUntil === "number" ? record.freshUntil : null,
    missing: requireBoolean(record, "missing", "memory fact"),
    stale: requireBoolean(record, "stale", "memory fact"),
    sourceId: readNullableString(record, "sourceId"),
  };
}

function parseNotificationList(value: unknown): WorkNotification[] {
  const record = requireRecord(value, "notifications");
  return requireArray(record.items, "notifications").map((value) => {
    const notification = requireRecord(value, "notification");
    const status = requireString(notification, "status", "notification");
    const statuses: WorkNotification["status"][] = ["queued", "leased", "started", "uncertain", "delivered", "failed"];
    if (!statuses.includes(status as WorkNotification["status"])) throw new NavigatorContractError("Navigator returned an unknown notification status.");
    return {
      ...notification,
      id: requireString(notification, "id", "notification"),
      type: requireString(notification, "type", "notification"),
      status: status as WorkNotification["status"],
      payload: isRecord(notification.payload) ? notification.payload : {},
      createdAt: requireNumber(notification, "createdAt", "notification"),
    };
  });
}

function parseAttachment(value: unknown): WorkAttachment {
  const record = requireRecord(value, "attachment");
  return {
    ...record,
    id: requireString(record, "id", "attachment"),
    sha256: requireString(record, "sha256", "attachment"),
    name: requireString(record, "name", "attachment"),
    mediaType: requireString(record, "mediaType", "attachment"),
    size: requireNumber(record, "size", "attachment"),
    createdAt: requireNumber(record, "createdAt", "attachment"),
  };
}

function parseConnectorList(value: unknown): WorkConnector[] {
  const record = requireRecord(value, "connector list");
  return requireArray(record.items, "connectors").map((value) => {
    const connector = requireRecord(value, "connector");
    const status = requireString(connector, "status", "connector");
    const statuses: WorkConnector["status"][] = ["unknown", "disconnected", "authenticating", "login_required", "connected", "degraded", "error"];
    if (!statuses.includes(status as WorkConnector["status"])) throw new NavigatorContractError("Navigator returned an unknown connector status.");
    return {
      ...connector,
      connectorId: requireString(connector, "connectorId", "connector"),
      status: status as WorkConnector["status"],
      ...(typeof connector.configured === "boolean" ? { configured: connector.configured } : {}),
      accountId: readNullableString(connector, "accountId"),
      detail: readNullableString(connector, "detail"),
      updatedAt: requireNumber(connector, "updatedAt", "connector"),
      lastEventAt: typeof connector.lastEventAt === "number" ? connector.lastEventAt : null,
    };
  });
}

function parseQqHealth(value: unknown): QqConnectorHealth {
  const record = requireRecord(value, "QQ connector health");
  return {
    ...record,
    status: readString(record, "status", "UNKNOWN"),
    hostState: readString(record, "hostState", readString(record, "host_state", "UNKNOWN")),
    apiReady: readBoolean(record, "apiReady", readBoolean(record, "api_ready", false)),
    accountConfirmed: readBoolean(record, "accountConfirmed", readBoolean(record, "dedicated_account_confirmed", readBoolean(record, "account_confirmed", false))),
    generation: typeof record.generation === "number" ? record.generation : null,
    clientVersion: typeof record.clientVersion === "string" ? record.clientVersion : typeof record.client_version === "string" ? record.client_version : null,
    hostAbi: typeof record.hostAbi === "string" ? record.hostAbi : typeof record.host_abi === "string" ? record.host_abi : null,
    failureCode: typeof record.failureCode === "string" ? record.failureCode : typeof record.failure_code === "string" ? record.failure_code : null,
  };
}

function parseQqLoginChallenge(value: unknown): QqLoginChallenge {
  const record = requireRecord(value, "QQ login challenge");
  const payload = isRecord(record.result) ? record.result : record;
  const qrPayload = readString(payload, "qrPayload", readString(payload, "qr_payload", ""));
  const expiresAtUtc = readString(payload, "expiresAtUtc", readString(payload, "expires_at_utc", ""));
  const loginId = readString(payload, "loginId", readString(payload, "login_id", ""));
  const expiry = Date.parse(expiresAtUtc);
  if (!loginId || !qrPayload || qrPayload.length > 4096 || /[\u0000-\u001f\u007f]/.test(qrPayload) ||
      !/(?:Z|\+00:00)$/i.test(expiresAtUtc) || !Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new NavigatorContractError("Navigator returned an invalid or expired QQ login QR.");
  }
  const state = parseQqLoginStatus(payload.state);
  return {
    loginId,
    qrPayload,
    expiresAtUtc,
    state,
    ...(state === "authorized" && typeof (payload.accountId ?? payload.account_id) === "string"
      ? { accountId: String(payload.accountId ?? payload.account_id) }
      : {}),
  };
}

function parseQqLoginState(value: unknown): QqLoginState {
  const record = requireRecord(value, "QQ login state");
  const payload = isRecord(record.result) ? record.result : isRecord(record.payload) ? record.payload : record;
  const loginId = readString(payload, "loginId", readString(payload, "login_id", ""));
  if (!loginId) throw new NavigatorContractError("Navigator returned an invalid QQ login id.");
  const state = parseQqLoginStatus(payload.state);
  return {
    loginId,
    state,
    ...(state === "authorized" && typeof (payload.accountId ?? payload.account_id) === "string"
      ? { accountId: String(payload.accountId ?? payload.account_id) }
      : {}),
  };
}

function parseQqLoginStatus(value: unknown): QqLoginChallenge["state"] {
  if (value === "pending" || value === "scanned" || value === "authorized" || value === "expired" || value === "failed") return value;
  throw new NavigatorContractError("Navigator returned an unknown QQ login state.");
}

function workId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,511}$/.test(normalized) || normalized.includes("..")) {
    throw new NavigatorContractError("Invalid workspace resource identifier.");
  }
  return normalized;
}

function workPath(workspaceId: string, suffix: string): string {
  return `/api/v1/workspaces/${workId(workspaceId)}/work/${suffix}`;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new NavigatorContractError(`Navigator returned an invalid ${label}.`);
  }
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new NavigatorContractError(`Navigator returned an invalid ${label}.`);
  }
  return value;
}

function requireString(record: JsonRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  }
  return value;
}

function requireNumber(record: JsonRecord, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  }
  return value;
}

function readNullableNumber(record: JsonRecord, key: string, label: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  }
  return value;
}

function requireBoolean(record: JsonRecord, key: string, label: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  }
  return value;
}

function readString(record: JsonRecord, key: string, fallback: string): string {
  return typeof record[key] === "string" ? record[key] : fallback;
}

function readBoolean(record: JsonRecord, key: string, fallback: boolean): boolean {
  return typeof record[key] === "boolean" ? record[key] : fallback;
}

function readNullableString(record: JsonRecord, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionPayload(value: unknown): value is SessionPayload {
  return isRecord(value) && (value.state === "AUTHENTICATED" || value.state === "ANONYMOUS");
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const prefix = `${name}=`;
  const cookie = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}
