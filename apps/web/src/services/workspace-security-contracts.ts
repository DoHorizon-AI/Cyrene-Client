import { z } from "zod";

const id = z.string().min(1).max(200);
export const scopeSchema = z.object({ organizationId: id, workspaceId: id }).strict();
const identity = z.object({ issuer: z.string().url(), subject: z.string().min(1).max(512) }).strict();
const base64url = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/);
export const assertionOptionsSchema = z.object({
  challenge: base64url.max(1024), rpId: z.string().min(1).max(255).optional(),
  timeout: z.number().int().positive().optional(),
  allowCredentials: z.array(z.object({ type: z.literal("public-key"), id: base64url,
    transports: z.array(z.enum(["usb", "nfc", "ble", "internal", "hybrid", "smart-card"])).optional(),
  }).strict()).optional(),
  userVerification: z.enum(["required", "preferred", "discouraged"]).optional(),
  hints: z.array(z.string()).optional(), extensions: z.record(z.unknown()).optional(),
}).strict();
const digest = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
export const authorizationSchema = z.object({
  authorizationId: z.string().regex(/^[A-Za-z0-9_-]{22}$/), deviceId: z.string().min(16).max(128),
  scope: scopeSchema, csrSpkiSha256: digest, csrSha256: digest,
  expiresAt: z.string().datetime({ offset: true }), authorizationGeneration: z.number().int().positive().safe(),
}).strict();
export const approvalSchema = z.object({
  authorization: authorizationSchema, approvalId: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
  webauthnOptions: assertionOptionsSchema, challengeExpiresAt: z.string().datetime({ offset: true }),
}).strict();
export const completionSchema = z.object({
  authorization: authorizationSchema,
  state: z.enum(["DEVICE_AUTHORIZATION_LIFECYCLE_STATE_ISSUING", "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_DELIVERY_PENDING", "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_DELIVERED"]),
  approvedBy: identity, approvedAt: z.string().datetime({ offset: true }),
}).strict();
export const denialSchema = z.object({ authorization: authorizationSchema, deniedBy: identity, deniedAt: z.string().datetime({ offset: true }) }).strict();
export type DeviceApproval = z.infer<typeof approvalSchema>;

export function decodeBase64url(value: string): ArrayBuffer {
  base64url.parse(value);
  const text = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(text, char => char.charCodeAt(0)).buffer;
}
function encode(value: ArrayBuffer): string {
  let text = "";
  for (const byte of new Uint8Array(value)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// Only the browser authenticator creates assertions. The server verifies the
// signature, challenge, RP, origin, user verification and session binding.
export async function requestDeviceAssertion(approval: DeviceApproval, signal: AbortSignal) {
  if (!globalThis.isSecureContext || !navigator.credentials?.get) throw new Error("WEBAUTHN_UNAVAILABLE");
  if (Date.parse(approval.challengeExpiresAt) <= Date.now()) throw new Error("CHALLENGE_EXPIRED");
  const options = assertionOptionsSchema.parse(approval.webauthnOptions);
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options, challenge: decodeBase64url(options.challenge),
    timeout: Math.min(options.timeout ?? 60_000, Math.max(1, Date.parse(approval.challengeExpiresAt) - Date.now())),
    userVerification: "required",
    allowCredentials: options.allowCredentials?.map(item => ({ ...item, id: decodeBase64url(item.id), transports: item.transports?.filter((transport): transport is AuthenticatorTransport => transport !== "smart-card") })),
  };
  const credential = await navigator.credentials.get({ publicKey, signal }) as PublicKeyCredential | null;
  if (!credential || credential.type !== "public-key") throw new Error("WEBAUTHN_CANCELLED");
  const response = credential.response as AuthenticatorAssertionResponse;
  return { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    response: { authenticatorData: encode(response.authenticatorData), clientDataJSON: encode(response.clientDataJSON), signature: encode(response.signature), userHandle: response.userHandle ? encode(response.userHandle) : null },
    extensions: credential.getClientExtensionResults(),
  };
}
