// -----------------------------------------------------------------------------
// Module: src/qq-login.test.ts
// Role: Verify that missing, malformed and expired QQ QR challenges are rejected.
// 中文：模块职责：验证缺失、无效和过期的 QQ 二维码挑战会被拒绝。
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { isQqQrExpired } from "./qq-login";

describe("QQ login QR expiry", () => {
  it("rejects missing, malformed, and elapsed timestamps", () => {
    expect(isQqQrExpired("", 1_000)).toBe(true);
    expect(isQqQrExpired("not-a-date", 1_000)).toBe(true);
    expect(isQqQrExpired(new Date(999).toISOString(), 1_000)).toBe(true);
  });

  it("keeps a QR challenge usable only until its expiry instant", () => {
    const expiry = new Date(2_000).toISOString();
    expect(isQqQrExpired(expiry, 1_999)).toBe(false);
    expect(isQqQrExpired(expiry, 2_000)).toBe(true);
  });
});
