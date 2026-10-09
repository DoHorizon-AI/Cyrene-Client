import type { ExecutorSchemas, WorkSchemas } from "../generated/contracts";

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
export type NavigatorTaskRecord = Omit<WorkSchemas["TaskRecord"], "startedAt" | "endedAt" | "error"> & JsonRecord & {
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
};

/** A durable task event with its server-assigned sequence. 中文：带服务端序号的持久任务事件。 */
export interface NavigatorTaskEvent {
  sequence: number;
  name: string;
  data: JsonRecord;
}

export type NavigatorTaskPage = Omit<ExecutorSchemas["TaskPage"], "items"> & { items: NavigatorTaskRecord[] };

export type AssistantPermission = ExecutorSchemas["Permission"];

export type AssistantModel = ExecutorSchemas["Model"];

export type AssistantProtocol = ExecutorSchemas["ApiProtocol"];

export type AssistantProvider = ExecutorSchemas["ApiProvider"];

export type AssistantRuntime = ExecutorSchemas["RuntimeInfo"] & { name: string; permissions: AssistantPermission[]; resume: boolean };

export type AssistantCapabilities = Omit<ExecutorSchemas["AssistantCapabilities"], "runtimes"> & { runtimes: AssistantRuntime[] };

export type AssistantExecution = ExecutorSchemas["ExecutionSelection"];

export type WorkApproval = Pick<WorkSchemas["ApprovalRecord"], "id" | "taskId" | "kind" | "summary" | "details" | "status"> & Partial<WorkSchemas["ApprovalRecord"]> & JsonRecord;

export type WorkInput = Omit<WorkSchemas["InputRecord"], "answeredAt" | "answeredBy" | "answer" | "messageId"> & JsonRecord & {
  answeredAt: number | null;
  answeredBy: string | null;
  answer?: JsonRecord;
  messageId?: string;
};

export type MemoryFact = WorkSchemas["MemoryFact"] & JsonRecord & { freshUntil: number | null; sourceId: string | null };

export type WorkNotification = Pick<WorkSchemas["NotificationRecord"], "id" | "type" | "status" | "payload" | "createdAt"> & Partial<WorkSchemas["NotificationRecord"]> & JsonRecord;

export type WorkAttachment = Omit<WorkSchemas["AttachmentRecord"], "workspaceId"> & Partial<Pick<WorkSchemas["AttachmentRecord"], "workspaceId">> & JsonRecord;

export type WorkConnector = WorkSchemas["ConnectorRecord"] & JsonRecord & { accountId: string | null; detail: string | null; lastEventAt: number | null };

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

export type ResponseParser<T> = (value: unknown) => T;

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
