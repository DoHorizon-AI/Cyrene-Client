// Module: apps/web/src/device-approval/bff-transport.ts
// Role: Same-origin, CSRF-protected browser transport for device approval.
// 中文：模块职责：通过同源、受 CSRF 保护的 BFF 路由传输设备审批请求。

import { z } from "zod";
import {
  completeDeviceApprovalRequestSchema,
  createDeviceApprovalChallengeRequestSchema,
  denyDeviceAuthorizationRequestSchema,
  type CreateDeviceApprovalChallengeRequest,
  type DenyDeviceAuthorizationRequest,
  type DeviceApprovalTransport,
} from "./client";

const SESSION_PATH = "/api/workspace/v1/session";
const APPROVAL_CHALLENGE_PATH = "/api/workspace/v1/device-authorizations/approval-challenges";
const DEVICE_AUTHORIZATION_PATH = "/api/workspace/v1/device-authorizations";
const MAX_JSON_BYTES = 4 * 1024 * 1024;

const sessionSchema = z.object({
  issuer: z.string().url(),
  subject: z.string().min(1).max(512),
  organizationId: z.string().min(1).max(200),
  expiresAt: z.string().datetime({ offset: true }),
  csrfToken: z.string().min(32).max(256).regex(/^v1\.[0-9]+\.[A-Za-z0-9_-]+$/u),
}).strict();

type VerifiedSessionProjection = z.infer<typeof sessionSchema>;
export type DeviceApprovalBffSessionState = "authenticated" | "anonymous" | "unavailable";

export type DeviceApprovalBffErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "session_changed"
  | "request_failed"
  | "invalid_response"
  | "unavailable";

/**
 * Keeps BFF failures typed without exposing response bodies or request data.
 * 中文：保留 BFF 错误类型，但不暴露响应正文或请求数据。
 */
export class DeviceApprovalBffError extends Error {
  constructor(
    public readonly code: DeviceApprovalBffErrorCode,
    public readonly status: number,
  ) {
    super("The same-origin device approval service could not complete the request.");
    this.name = "DeviceApprovalBffError";
  }
}

interface TransportOptions {
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Calls only fixed same-origin Workspace BFF routes and never submits browser-supplied identity.
 * 中文：只调用固定的同源 Workspace BFF 路由，绝不提交浏览器提供的身份声明。
 */
export class SameOriginDeviceApprovalTransport implements DeviceApprovalTransport {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private sessionIdentity: Pick<VerifiedSessionProjection, "issuer" | "subject" | "organizationId"> | null = null;

  constructor(options: TransportOptions = {}) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Probe the verified BFF session used to gate the approval page.
   * 中文：读取并验证 BFF 会话，用于决定是否开放审批页面。
   */
  async checkSession(signal?: AbortSignal): Promise<DeviceApprovalBffSessionState> {
    try {
      await this.readSession(signal);
      return "authenticated";
    } catch (error) {
      this.clearSession();
      if (error instanceof DeviceApprovalBffError && error.code === "unauthenticated") return "anonymous";
      return "unavailable";
    }
  }

  async createDeviceApprovalChallenge(request: CreateDeviceApprovalChallengeRequest): Promise<unknown> {
    const body = createDeviceApprovalChallengeRequestSchema.parse(request);
    return this.postJson(APPROVAL_CHALLENGE_PATH, body);
  }

  async completeDeviceApproval(
    approvalId: string,
    request: z.infer<typeof completeDeviceApprovalRequestSchema>,
  ): Promise<unknown> {
    const id = z.string().min(16).max(128).parse(approvalId);
    const body = completeDeviceApprovalRequestSchema.parse(request);
    return this.postJson(`${APPROVAL_CHALLENGE_PATH}/${encodeURIComponent(id)}/complete`, body);
  }

  async denyDeviceAuthorization(request: DenyDeviceAuthorizationRequest): Promise<unknown> {
    const body = denyDeviceAuthorizationRequestSchema.parse(request);
    return this.postJson(`${DEVICE_AUTHORIZATION_PATH}/denials`, body);
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const requestBody = serializeRequestJson(body);
    const session = await this.readSession();
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    });
    let response: Response;
    try {
      // The browser supplies Origin; this client adds only same-origin credentials and CSRF.
      // Origin 由浏览器自动设置；此客户端只使用同源凭据并添加 CSRF token。
      response = await this.fetcher(path, {
        method: "POST",
        headers,
        body: requestBody,
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new DeviceApprovalBffError("unavailable", 0);
    }
    if (!response.ok) {
      if (response.status === 401) this.clearSession();
      throw this.responseError(response.status);
    }
    return readJsonResponse(response);
  }

  private async readSession(signal?: AbortSignal): Promise<VerifiedSessionProjection> {
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      response = await this.fetcher(SESSION_PATH, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      throw new DeviceApprovalBffError("unavailable", 0);
    }
    if (!response.ok) {
      if (response.status === 401) this.clearSession();
      throw this.responseError(response.status);
    }

    const parsed = sessionSchema.safeParse(await readJsonResponse(response));
    if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) {
      this.clearSession();
      throw new DeviceApprovalBffError("invalid_response", 502);
    }
    const nextIdentity = {
      issuer: parsed.data.issuer,
      subject: parsed.data.subject,
      organizationId: parsed.data.organizationId,
    };
    if (this.sessionIdentity && !sameIdentity(this.sessionIdentity, nextIdentity)) {
      this.clearSession();
      throw new DeviceApprovalBffError("session_changed", 401);
    }
    this.sessionIdentity = nextIdentity;
    return parsed.data;
  }

  private responseError(status: number): DeviceApprovalBffError {
    if (status === 401) return new DeviceApprovalBffError("unauthenticated", status);
    if (status === 403) return new DeviceApprovalBffError("forbidden", status);
    if (status === 503 || status === 504) return new DeviceApprovalBffError("unavailable", status);
    if (status === 400 || status === 409) return new DeviceApprovalBffError("request_failed", status);
    return new DeviceApprovalBffError("request_failed", status);
  }

  private clearSession(): void {
    this.sessionIdentity = null;
  }
}

function sameIdentity(
  left: Pick<VerifiedSessionProjection, "issuer" | "subject" | "organizationId">,
  right: Pick<VerifiedSessionProjection, "issuer" | "subject" | "organizationId">,
): boolean {
  return left.issuer === right.issuer
    && left.subject === right.subject
    && left.organizationId === right.organizationId;
}

function contentType(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

function serializeRequestJson(value: unknown): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new DeviceApprovalBffError("request_failed", 400);
  }
  if (json === undefined || new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES) {
    throw new DeviceApprovalBffError("request_failed", 400);
  }
  return json;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  if (contentType(response) !== "application/json") {
    throw new DeviceApprovalBffError("invalid_response", 502);
  }
  const announcedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(announcedLength) && announcedLength > MAX_JSON_BYTES) {
    throw new DeviceApprovalBffError("invalid_response", 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DeviceApprovalBffError("invalid_response", 502);
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new DeviceApprovalBffError("invalid_response", 502);
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
    throw new DeviceApprovalBffError("invalid_response", 502);
  }
}
