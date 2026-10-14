// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 integration-renewal-storage.ts                                   │
// │  Module: apps/web/src/products                                      │
// │  Role: Persist only same-key renewal recovery handles in scoped      │
// │        session storage, separate from Navigator task state.          │
// │                                                                      │
// │  模块职责：仅在会话存储中保留续期同键恢复句柄。                           │
// │  · 作用域仅以哈希保存，记录不包含操作者、工作空间或授权引用                 │
// │  · 退出会话或切换工作空间时清除对应作用域                                │
// └─────────────────────────────────────────────────────────────────────┘

import { z } from "zod";

/** Recovery reason persisted only when a same-key renewal replay may be safe. */
export type RenewalRetryState = "REQUEST_OUTCOME_UNKNOWN" | "PROVIDER_START_OUTCOME_UNKNOWN" | "PROVIDER_STATUS_LOOKUP_UNAVAILABLE";

/** Minimal storage port used for sessionStorage and deterministic fixture tests. */
export interface RenewalStoragePort {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A non-authoritative UI handle; Exchange remains the renewal-session authority. */
export interface PendingRenewalRequest {
  idempotencyKey: string;
  sessionRef: string | null;
  retryState: RenewalRetryState;
}

const PREFIX = "cyrene.integration-renewal.v1";
const pendingRenewalSchema = z.object({
  idempotencyKey: z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:-]+$/),
  sessionRef: z.string().min(1).max(256).nullable(),
  retryState: z.enum(["REQUEST_OUTCOME_UNKNOWN", "PROVIDER_START_OUTCOME_UNKNOWN", "PROVIDER_STATUS_LOOKUP_UNAVAILABLE"]),
});

/** Return the browser session storage port without throwing in restricted contexts. */
export function browserRenewalStorage(): RenewalStoragePort | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; }
  catch { return null; }
}

/** Read a pending renewal only for the exact paired session, connection, and auth reference. */
export async function loadPendingRenewalRequest(
  storage: RenewalStoragePort,
  sessionScope: string,
  connectionId: string,
  authorizationRef: string,
): Promise<PendingRenewalRequest | null> {
  const key = await renewalStorageKey(sessionScope, connectionId, authorizationRef);
  if (!key) return null;
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return null; }
  if (!raw) return null;
  let payload: unknown;
  try { payload = JSON.parse(raw) as unknown; }
  catch { try { storage.removeItem(key); } catch { /* Storage may be disabled by browser policy. */ } return null; }
  const parsed = pendingRenewalSchema.safeParse(payload);
  if (!parsed.success) { try { storage.removeItem(key); } catch { /* Storage may be disabled by browser policy. */ } return null; }
  return parsed.data;
}

/** Write a retry handle before a POST so a page reload can repeat only the same idempotent action. */
export async function savePendingRenewalRequest(
  storage: RenewalStoragePort,
  sessionScope: string,
  connectionId: string,
  authorizationRef: string,
  request: PendingRenewalRequest,
): Promise<boolean> {
  const key = await renewalStorageKey(sessionScope, connectionId, authorizationRef);
  const parsed = pendingRenewalSchema.safeParse(request);
  if (!key || !parsed.success) return false;
  try { storage.setItem(key, JSON.stringify(parsed.data)); return true; }
  catch { return false; }
}

/** Clear one pending handle when Exchange reports a resolved or non-replayable session. */
export async function clearPendingRenewalRequest(
  storage: RenewalStoragePort,
  sessionScope: string,
  connectionId: string,
  authorizationRef: string,
): Promise<void> {
  const key = await renewalStorageKey(sessionScope, connectionId, authorizationRef);
  if (!key) return;
  try { storage.removeItem(key); } catch { /* Storage may be disabled by browser policy. */ }
}

/** Remove every renewal handle belonging to one session/actor/workspace scope on signout or scope change. */
export async function clearPendingRenewalScope(storage: RenewalStoragePort, sessionScope: string): Promise<void> {
  const scopeHash = await digest(sessionScope);
  if (!scopeHash) return;
  const prefix = `${PREFIX}.${scopeHash}.`;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch { /* Storage may be disabled by browser policy. */ }
}

async function renewalStorageKey(sessionScope: string, connectionId: string, authorizationRef: string): Promise<string | null> {
  const scopeHash = await digest(sessionScope);
  const recordHash = await digest(`${connectionId}\u0000${authorizationRef}`);
  return scopeHash && recordHash ? `${PREFIX}.${scopeHash}.${recordHash}` : null;
}

async function digest(value: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digestBytes = await subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digestBytes), byte => byte.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}
