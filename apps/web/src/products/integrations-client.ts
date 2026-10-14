// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 integrations-client.ts                                           │
// │  Module: apps/web/src/products                                      │
// │  Role: Typed, paired-session client for Exchange integration health, │
// │        renewal, cloud observations, and durable notifications.       │
// │                                                                      │
// │  模块职责：通过已配对会话访问 Exchange 集成状态与通知。                  │
// │  · 仅接受服务端投影的连接 ID，不接收任意目标或身份参数                   │
// │  · 解析安全字段，UI 不保留或展示绑定引用、目标引用与属性 JSON              │
// └─────────────────────────────────────────────────────────────────────┘

import { z } from "zod";
import type { NavigatorApi } from "../../services/navigator/src/api";

const productIdSchema = z.string().min(1).max(256);
const shortTextSchema = z.string().max(512);
const rfc3339UtcSchema = z.string().datetime();
const nullableTimeSchema = rfc3339UtcSchema.nullable();
const loginStateSchema = z.enum(["PRESENT", "MISSING", "UNKNOWN", "UNAVAILABLE"]);
const authorizationStateSchema = z.enum(["VALID", "REAUTHORIZATION_REQUIRED", "PERMISSION_DENIED", "UNKNOWN", "UNAVAILABLE"]);

const connectionListRowSchema = z.object({
  id: productIdSchema,
  provider: shortTextSchema,
  displayName: shortTextSchema,
});

const connectionListSchema = z.array(connectionListRowSchema);

const authorizationCapabilitySchema = z.object({
  capabilityId: shortTextSchema,
  state: authorizationStateSchema,
  lastVerifiedAt: nullableTimeSchema,
  expiresAt: nullableTimeSchema,
  reasonCode: z.string().max(128).nullable(),
});

const authorizationHealthSchema = z.object({
  connectionId: productIdSchema,
  provider: shortTextSchema,
  authorizationRef: productIdSchema.nullable(),
  loginState: loginStateSchema,
  authorizationState: authorizationStateSchema,
  checkedAt: nullableTimeSchema,
  expiresAt: nullableTimeSchema,
  generation: z.number().int().nonnegative(),
  capabilities: z.array(authorizationCapabilitySchema),
  reasonCode: z.string().max(128).nullable().optional(),
});

const renewalSessionSchema = z.object({
  sessionRef: productIdSchema,
  authorizationRef: productIdSchema,
  state: z.enum(["WAITING_USER", "VERIFYING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"]),
  createdAt: rfc3339UtcSchema,
  expiresAt: nullableTimeSchema,
  authorizationUrl: z.string().url().nullable(),
  qrAttachmentRef: z.string().max(256).nullable().optional(),
  reasonCode: z.enum(["provider_start_pending", "provider_start_outcome_unknown", "provider_binding_unavailable", "provider_status_unavailable"]).nullable().optional(),
  generation: z.number().int().nonnegative(),
});

const observationKindSchema = z.enum([
  "azure.vm", "gcp.instance", "hf.model", "hf.dataset", "hf.space", "runpod.pod", "tailscale.device",
]);
const observationStatusSchema = z.enum(["RUNNING", "STOPPED", "AVAILABLE", "UNAVAILABLE", "DEGRADED", "UNKNOWN"]);
const freshnessSchema = z.enum(["FRESH", "STALE", "UNKNOWN"]);
const cloudObservationSchema = z.object({
  externalRef: productIdSchema,
  kind: observationKindSchema,
  displayName: shortTextSchema,
  status: observationStatusSchema,
  providerStatus: z.string().max(256).nullable(),
  collectedAt: rfc3339UtcSchema,
  observedAt: nullableTimeSchema,
  attributes: z.record(z.string(), z.unknown()),
  platformResourceRef: productIdSchema.nullable(),
  platformGeneration: z.number().int().nonnegative().nullable(),
  source: shortTextSchema,
  freshness: freshnessSchema,
});

const cloudQueryResultSchema = z.object({
  connectionId: productIdSchema,
  provider: shortTextSchema,
  checkedAt: nullableTimeSchema,
  resources: z.array(cloudObservationSchema),
});

const notificationSchema = z.object({
  id: productIdSchema,
  sequence: z.number().int().nonnegative(),
  connectionId: productIdSchema,
  kind: z.enum([
    "authorization.expiring", "authorization.required", "connection.unavailable",
    "cloud.resource.changed", "delivery.failed",
  ]),
  severity: shortTextSchema,
  title: shortTextSchema,
  description: z.string().max(4096),
  createdAt: rfc3339UtcSchema,
  actionRef: z.string().max(512).nullable(),
  acknowledgedAt: nullableTimeSchema,
});

const notificationPageSchema = z.object({
  notifications: z.array(notificationSchema),
  nextSequence: z.number().int().nonnegative(),
});

const refreshOperationSchema = z.object({
  operationId: productIdSchema,
  state: shortTextSchema,
  createdAt: rfc3339UtcSchema,
  updatedAt: rfc3339UtcSchema,
});

/** Login presence reported by Exchange, separate from authorization validity. */
export type LoginState = z.infer<typeof loginStateSchema>;
/** Permission health reported by Exchange for a connection or capability. */
export type AuthorizationState = z.infer<typeof authorizationStateSchema>;
/** Server-filtered connection fields safe for a Client selector. */
export type ConnectionSummary = Pick<z.infer<typeof connectionListRowSchema>, "id" | "provider" | "displayName">;
/** Authorization health fields consumed by the Client page. */
export type AuthorizationHealth = z.infer<typeof authorizationHealthSchema>;
/** Renewal state without native QR references. */
export type RenewalSession = Omit<z.infer<typeof renewalSessionSchema>, "authorizationUrl" | "qrAttachmentRef"> & {
  authorizationUrl: string | null;
};
/** Cloud fields intentionally retained for presentation; raw metadata is discarded. */
export type CloudObservationView = Pick<z.infer<typeof cloudObservationSchema>, "kind" | "displayName" | "status" | "providerStatus" | "collectedAt" | "observedAt" | "freshness">;
/** Exchange-owned cloud observation summary returned to the page. */
export type CloudQueryResult = {
  connectionId: string;
  provider: string;
  checkedAt: string | null;
  resources: CloudObservationView[];
};
/** Durable Exchange notification shown in the in-app feed. */
export type IntegrationNotification = z.infer<typeof notificationSchema>;
/** Notification rows returned after a sequence cursor. */
export type NotificationPage = z.infer<typeof notificationPageSchema>;
/** Accepted asynchronous Product resource refresh. */
export type RefreshOperation = z.infer<typeof refreshOperationSchema>;

/** A sanitized integration request failure that never includes arbitrary upstream response text. */
export class IntegrationApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`Integration request failed (HTTP ${status}, ${code}).`);
    this.name = "IntegrationApiError";
  }
}

/** Validate one notification frame and drop uncontracted fields before UI delivery. */
export function parseIntegrationNotification(value: unknown): IntegrationNotification | null {
  const parsed = notificationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Safe, actor-scoped facade over the existing paired Navigator API client. */
export class IntegrationsClient {
  constructor(private readonly api: Pick<NavigatorApi, "requestProductResponse">) {}

  /** Read only the server-filtered connection labels; private refs are discarded before UI state. */
  async listConnections(signal?: AbortSignal): Promise<ConnectionSummary[]> {
    const payload = await this.readJson("/api/v1/integrations/connections", connectionListSchema, signal);
    return payload.map(({ id, provider, displayName }) => ({ id, provider, displayName }));
  }

  /** Read login, authorization, capability, and expiry states for one listed connection. */
  async getAuthorizationHealth(connectionId: string, signal?: AbortSignal): Promise<AuthorizationHealth> {
    const result = await this.readJson(
      `/api/v1/integrations/connections/${encodeURIComponent(connectionId)}/authorization-health`,
      authorizationHealthSchema,
      signal,
    );
    if (result.connectionId !== connectionId) throw new IntegrationApiError(502, "CONNECTION_SCOPE_MISMATCH");
    return result;
  }

  /** Start an explicitly requested renewal and require the Product-owned status Location. */
  async beginRenewal(authorizationRef: string, idempotencyKey: string): Promise<RenewalSession> {
    const path = `/api/v1/accounts/authorizations/${encodeURIComponent(authorizationRef)}/renewal-sessions`;
    const response = await this.api.requestProductResponse(path, {
      method: "POST",
      headers: { Accept: "application/json", "Idempotency-Key": idempotencyKey },
    });
    const payload = await this.acceptedJson(response, renewalSessionSchema);
    this.requireLocation(response, `/api/v1/accounts/authorizations/${encodeURIComponent(authorizationRef)}/renewal-sessions/${encodeURIComponent(payload.sessionRef)}`);
    if (payload.authorizationRef !== authorizationRef) throw new IntegrationApiError(502, "AUTHORIZATION_SCOPE_MISMATCH");
    return {
      sessionRef: payload.sessionRef,
      authorizationRef: payload.authorizationRef,
      state: payload.state,
      createdAt: payload.createdAt,
      expiresAt: payload.expiresAt,
      authorizationUrl: payload.authorizationUrl,
      reasonCode: payload.reasonCode,
      generation: payload.generation,
    };
  }

  /** Poll the renewal session by its Product-owned references. */
  async getRenewal(authorizationRef: string, sessionRef: string, signal?: AbortSignal): Promise<RenewalSession> {
    const result = await this.readJson(
      `/api/v1/accounts/authorizations/${encodeURIComponent(authorizationRef)}/renewal-sessions/${encodeURIComponent(sessionRef)}`,
      renewalSessionSchema,
      signal,
    );
    if (result.authorizationRef !== authorizationRef || result.sessionRef !== sessionRef) {
      throw new IntegrationApiError(502, "RENEWAL_SCOPE_MISMATCH");
    }
    return {
      sessionRef: result.sessionRef,
      authorizationRef: result.authorizationRef,
      state: result.state,
      createdAt: result.createdAt,
      expiresAt: result.expiresAt,
      authorizationUrl: result.authorizationUrl,
      reasonCode: result.reasonCode,
      generation: result.generation,
    };
  }

  /** Read a Product projection of cloud observations; Platform remains the resource registry authority. */
  async getResources(connectionId: string, signal?: AbortSignal): Promise<CloudQueryResult> {
    const result = await this.readJson(
      `/api/v1/integrations/connections/${encodeURIComponent(connectionId)}/resources`,
      cloudQueryResultSchema,
      signal,
    );
    if (result.connectionId !== connectionId) throw new IntegrationApiError(502, "CONNECTION_SCOPE_MISMATCH");
    return {
      connectionId: result.connectionId,
      provider: result.provider,
      checkedAt: result.checkedAt,
      resources: result.resources.map(({ kind, displayName, status, providerStatus, collectedAt, observedAt, freshness }) => ({
        kind, displayName, status, providerStatus, collectedAt, observedAt, freshness,
      })),
    };
  }

  /** Queue a durable read-only refresh with an idempotency key; no arbitrary provider or target is accepted. */
  async refreshResources(connectionId: string, idempotencyKey: string): Promise<RefreshOperation> {
    const response = await this.api.requestProductResponse(
      `/api/v1/integrations/connections/${encodeURIComponent(connectionId)}/actions/refresh`,
      { method: "POST", headers: { Accept: "application/json", "Idempotency-Key": idempotencyKey } },
    );
    const result = await this.acceptedJson(response, refreshOperationSchema);
    this.requireLocation(response, `/api/v1/integrations/operations/${encodeURIComponent(result.operationId)}`);
    return result;
  }

  /** Read the durable notification feed after its last accepted sequence. */
  listNotifications(after: number, signal?: AbortSignal): Promise<NotificationPage> {
    if (!Number.isSafeInteger(after) || after < 0) throw new IntegrationApiError(0, "INVALID_SEQUENCE");
    const query = new URLSearchParams({ after: String(after) });
    return this.readJson(`/api/v1/integrations/notifications?${query}`, notificationPageSchema, signal);
  }

  /** Acknowledge a notification once through Exchange's idempotent actor-bound operation. */
  async acknowledge(notificationId: string, idempotencyKey: string): Promise<IntegrationNotification> {
    const response = await this.api.requestProductResponse(
      `/api/v1/integrations/notifications/${encodeURIComponent(notificationId)}/ack`,
      { method: "POST", headers: { Accept: "application/json", "Idempotency-Key": idempotencyKey } },
    );
    return this.parseJson(response, notificationSchema);
  }

  /** Open an authenticated resumable SSE stream using the same sequence cursor as the feed. */
  async openNotificationEvents(after: number, signal: AbortSignal): Promise<Response> {
    if (!Number.isSafeInteger(after) || after < 0) throw new IntegrationApiError(0, "INVALID_SEQUENCE");
    const response = await this.api.requestProductResponse("/api/v1/integrations/notifications/events", {
      method: "GET",
      signal,
      headers: { Accept: "text/event-stream", "Last-Event-ID": String(after) },
    });
    if (!response.ok) throw await this.errorFor(response);
    if (!response.body || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/event-stream") {
      await response.body?.cancel();
      throw new IntegrationApiError(502, "INVALID_EVENT_STREAM");
    }
    return response;
  }

  private async readJson<T extends z.ZodTypeAny>(path: string, schema: T, signal?: AbortSignal): Promise<z.infer<T>> {
    const response = await this.api.requestProductResponse(path, { method: "GET", signal, headers: { Accept: "application/json" } });
    return this.parseJson(response, schema);
  }

  private async acceptedJson<T extends z.ZodTypeAny>(response: Response, schema: T): Promise<z.infer<T>> {
    if (response.status !== 202) throw await this.errorFor(response);
    return this.parseJson(response, schema);
  }

  private async parseJson<T extends z.ZodTypeAny>(response: Response, schema: T): Promise<z.infer<T>> {
    if (!response.ok) throw await this.errorFor(response);
    let value: unknown;
    try { value = await response.json(); } catch { throw new IntegrationApiError(response.status, "INVALID_JSON"); }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new IntegrationApiError(502, "INVALID_RESPONSE_CONTRACT");
    return parsed.data;
  }

  private async errorFor(response: Response): Promise<IntegrationApiError> {
    let code = `HTTP_${response.status}`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "code" in body && typeof body.code === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(body.code)) code = body.code;
      if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "code" in body.error && typeof body.error.code === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(body.error.code)) code = body.error.code;
    } catch { /* The HTTP status remains enough; response bodies are never surfaced. */ }
    return new IntegrationApiError(response.status, code);
  }

  private requireLocation(response: Response, expectedPath: string): void {
    const location = response.headers.get("location");
    if (!location) throw new IntegrationApiError(502, "MISSING_OPERATION_LOCATION");
    try {
      const resolved = new URL(location, "https://cyrene.invalid");
      if (resolved.origin !== "https://cyrene.invalid" || resolved.pathname !== expectedPath || resolved.hash) {
        throw new Error("Unexpected operation Location.");
      }
    } catch { throw new IntegrationApiError(502, "INVALID_OPERATION_LOCATION"); }
  }
}

/** Generate one browser-local idempotency key per explicit user action. */
export function newIntegrationIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `integration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
