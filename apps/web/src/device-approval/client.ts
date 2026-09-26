// Module: apps/web/src/device-approval/client.ts
// Role: OpenAPI-shaped approval client port and browser WebAuthn serialization.
// 中文：模块职责：镜像审批 OpenAPI 的请求/响应，并将浏览器断言转换为线协议。

import { z } from "zod";

const digestSchema = z.string().length(44).regex(/^[A-Za-z0-9+/]{43}=$/u).refine((value) => atob(value).length === 32);
const dateTimeSchema = z.string().datetime({ offset: true });
const scopeSchema = z.object({
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
}).strict();

export const deviceAuthorizationRefSchema = z.object({
  authorizationId: z.string().min(16).max(128),
  deviceId: z.string().min(16).max(128),
  scope: scopeSchema,
  csrSpkiSha256: digestSchema,
  csrSha256: digestSchema,
  expiresAt: dateTimeSchema,
  authorizationGeneration: z.number().int().positive(),
}).strict();

export const webAuthnRequestOptionsSchema = z.object({
  challenge: z.string().regex(/^[A-Za-z0-9_-]+$/),
  rpId: z.string().min(1).optional(),
  timeout: z.number().int().min(1).optional(),
  allowCredentials: z.array(z.object({
    type: z.literal("public-key"),
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    transports: z.array(z.enum(["usb", "nfc", "ble", "internal", "hybrid", "smart-card"])).optional(),
  }).strict()).optional(),
  userVerification: z.enum(["required", "preferred", "discouraged"]).optional(),
  hints: z.array(z.enum(["security-key", "client-device", "hybrid"])).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const webAuthnAssertionSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).nullable().optional(),
  response: z.object({
    clientDataJSON: z.string().regex(/^[A-Za-z0-9_-]+$/),
    authenticatorData: z.string().regex(/^[A-Za-z0-9_-]+$/),
    signature: z.string().regex(/^[A-Za-z0-9_-]+$/),
    userHandle: z.string().regex(/^[A-Za-z0-9_-]+$/).nullable().optional(),
  }).strict(),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const createDeviceApprovalChallengeRequestSchema = z.object({
  userCode: z.string(),
  scope: scopeSchema,
}).strict();

export const createDeviceApprovalChallengeResponseSchema = z.object({
  authorization: deviceAuthorizationRefSchema,
  approvalId: z.string().min(16).max(128),
  webauthnOptions: webAuthnRequestOptionsSchema,
  challengeExpiresAt: dateTimeSchema,
}).strict();

export const completeDeviceApprovalRequestSchema = z.object({
  webauthnAssertion: webAuthnAssertionSchema.optional(),
}).strict();

export const completeDeviceApprovalResponseSchema = z.object({
  authorization: deviceAuthorizationRefSchema,
  state: z.enum([
    "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_ISSUING",
    "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_DELIVERY_PENDING",
    "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_DELIVERED",
  ]),
  approvedBy: z.object({ issuer: z.string(), subject: z.string() }).strict(),
  approvedAt: dateTimeSchema,
}).strict();

export const denyDeviceAuthorizationRequestSchema = z.object({
  userCode: z.string(),
  scope: scopeSchema,
}).strict();

export const denyDeviceAuthorizationResponseSchema = z.object({
  authorization: deviceAuthorizationRefSchema,
  deniedBy: z.object({ issuer: z.string(), subject: z.string() }).strict(),
  deniedAt: dateTimeSchema,
}).strict();

export type DeviceAuthorizationRef = z.infer<typeof deviceAuthorizationRefSchema>;
export type WebAuthnRequestOptions = z.infer<typeof webAuthnRequestOptionsSchema>;
export type WebAuthnAssertion = z.infer<typeof webAuthnAssertionSchema>;
export type CreateDeviceApprovalChallengeRequest = z.infer<typeof createDeviceApprovalChallengeRequestSchema>;
export type CreateDeviceApprovalChallengeResponse = z.infer<typeof createDeviceApprovalChallengeResponseSchema>;
export type CompleteDeviceApprovalResponse = z.infer<typeof completeDeviceApprovalResponseSchema>;
export type DenyDeviceAuthorizationRequest = z.infer<typeof denyDeviceAuthorizationRequestSchema>;
export type DenyDeviceAuthorizationResponse = z.infer<typeof denyDeviceAuthorizationResponseSchema>;

/**
 * Same-origin Web Host adapter seam. The Web Host owns session and routing;
 * this slice does not guess a browser-facing endpoint path.
 * 中文：同源 Web Host 适配边界；会话和路由由 Host 提供，本模块不猜测浏览器 API 路径。
 */
export interface DeviceApprovalTransport {
  createDeviceApprovalChallenge(request: CreateDeviceApprovalChallengeRequest): Promise<unknown>;
  completeDeviceApproval(approvalId: string, request: z.infer<typeof completeDeviceApprovalRequestSchema>): Promise<unknown>;
  denyDeviceAuthorization(request: DenyDeviceAuthorizationRequest): Promise<unknown>;
}

function parseContract<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("The device approval response did not match the Platform OpenAPI contract.");
  return result.data;
}

/**
 * Validates inputs and exact OpenAPI response fields around an injected Host transport.
 * 中文：在注入的 Host 传输边界校验请求与 OpenAPI 响应，不自行选择网络地址。
 */
export class DeviceApprovalClient {
  constructor(private readonly transport: DeviceApprovalTransport) {}

  async createChallenge(request: CreateDeviceApprovalChallengeRequest): Promise<CreateDeviceApprovalChallengeResponse> {
    const input = createDeviceApprovalChallengeRequestSchema.parse(request);
    return parseContract(createDeviceApprovalChallengeResponseSchema, await this.transport.createDeviceApprovalChallenge(input));
  }

  async completeApproval(approvalId: string, request: z.infer<typeof completeDeviceApprovalRequestSchema>): Promise<CompleteDeviceApprovalResponse> {
    const id = z.string().min(16).max(128).parse(approvalId);
    const input = completeDeviceApprovalRequestSchema.parse(request);
    return parseContract(completeDeviceApprovalResponseSchema, await this.transport.completeDeviceApproval(id, input));
  }

  async denyAuthorization(request: DenyDeviceAuthorizationRequest): Promise<DenyDeviceAuthorizationResponse> {
    const input = denyDeviceAuthorizationRequestSchema.parse(request);
    return parseContract(denyDeviceAuthorizationResponseSchema, await this.transport.denyDeviceAuthorization(input));
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/**
 * Converts Platform's base64url options for navigator.credentials.get and serializes only its assertion.
 * 中文：把服务端选项转换为浏览器 WebAuthn 格式，只序列化断言，不包含证书或私钥。
 */
export async function requestWebAuthnAssertion(
  options: WebAuthnRequestOptions,
  getCredential: (request: CredentialRequestOptions) => Promise<Credential | null> = (request) => navigator.credentials.get(request),
): Promise<WebAuthnAssertion> {
  const publicKey = {
    challenge: decodeBase64Url(options.challenge),
    ...(options.rpId ? { rpId: options.rpId } : {}),
    ...(options.timeout ? { timeout: options.timeout } : {}),
    ...(options.allowCredentials ? {
      allowCredentials: options.allowCredentials.map((credential) => ({
        type: credential.type,
        id: decodeBase64Url(credential.id),
        ...(credential.transports ? { transports: credential.transports } : {}),
      })),
    } : {}),
    ...(options.userVerification ? { userVerification: options.userVerification } : {}),
    ...(options.hints ? { hints: options.hints } : {}),
    ...(options.extensions ? { extensions: options.extensions } : {}),
  } as PublicKeyCredentialRequestOptions;

  const credential = await getCredential({ publicKey });
  if (!credential || credential.type !== "public-key") throw new Error("A WebAuthn assertion was not returned.");
  const publicKeyCredential = credential as PublicKeyCredential;
  const response = publicKeyCredential.response as AuthenticatorAssertionResponse;
  if (!(response.clientDataJSON instanceof ArrayBuffer) || !(response.authenticatorData instanceof ArrayBuffer) || !(response.signature instanceof ArrayBuffer)) {
    throw new Error("The browser returned an invalid WebAuthn assertion.");
  }

  const assertion = {
    id: publicKeyCredential.id,
    rawId: encodeBase64Url(publicKeyCredential.rawId),
    type: "public-key" as const,
    authenticatorAttachment: publicKeyCredential.authenticatorAttachment,
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      authenticatorData: encodeBase64Url(response.authenticatorData),
      signature: encodeBase64Url(response.signature),
      userHandle: response.userHandle === null ? null : encodeBase64Url(response.userHandle),
    },
  };
  return webAuthnAssertionSchema.parse(assertion);
}
