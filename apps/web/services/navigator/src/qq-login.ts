// -----------------------------------------------------------------------------
// Module: src/qq-login.ts
// Role: Enforce local expiry for short-lived QQ login challenges.
// 中文：模块职责：在本地校验短时 QQ 登录挑战的有效期。
// -----------------------------------------------------------------------------

/** Treat missing, malformed, and elapsed expiry timestamps as unusable. | 缺失、无效和已过期时间一律不可用。 */
export function isQqQrExpired(expiresAtUtc: string, now = Date.now()): boolean {
  const expiresAt = Date.parse(expiresAtUtc);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}
