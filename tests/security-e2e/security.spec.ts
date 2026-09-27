import { generateKeyPairSync } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, loseComplete = false) {
  let completeCount = 0; const bodies: Record<string, unknown>[] = [];
  const authorization = { authorizationId: "a".repeat(22), deviceId: "test-device-123456", scope: { organizationId: "test-org", workspaceId: "ws" }, csrSpkiSha256: "A".repeat(43) + "=", csrSha256: "A".repeat(43) + "=", expiresAt: new Date(Date.now() + 300_000).toISOString(), authorizationGeneration: 1 };
  const identity = { issuer: "https://fixture.example", subject: "test-user" };
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "der" });
  const cdp = await page.context().newCDPSession(page); await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: { credentialId: Buffer.from("security-fixture-credential").toString("base64"), isResidentCredential: true, rpId: "localhost", privateKey: key.toString("base64"), userHandle: Buffer.from("test-user").toString("base64"), signCount: 0 } });
  await page.route("**/api/workspace/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session")) return route.fulfill({ json: { ...identity, organizationId: "test-org", expiresAt: new Date(Date.now() + 300_000).toISOString(), csrfToken: "v1.123." + "a".repeat(40) } });
    if (path.endsWith("/workspaces")) return route.fulfill({ json: { workspaces: [{ workspaceId: "ws", organizationId: "test-org", displayName: "Test workspace" }] } });
    const body = route.request().postDataJSON(); bodies.push({ path, body });
    expect(route.request().headers()["x-csrf-token"]).toBe("v1.123." + "a".repeat(40));
    if (path.endsWith("/approval-challenges")) return route.fulfill({ json: { authorization, approvalId: "approval-fixture-1234", challengeExpiresAt: new Date(Date.now() + 60_000).toISOString(), webauthnOptions: { challenge: Buffer.from("test challenge with thirty two bytes").toString("base64url"), rpId: "localhost", userVerification: "required" } } });
    if (path.endsWith("/complete")) { completeCount++; if (loseComplete && completeCount === 1) return route.abort("failed"); return route.fulfill({ json: { authorization, state: "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_ISSUING", approvedBy: identity, approvedAt: new Date().toISOString() } }); }
    if (path.endsWith("/denials")) return route.fulfill({ json: { authorization, deniedBy: identity, deniedAt: new Date().toISOString() } });
    return route.fulfill({ status: 503, json: { code: "upstream_unavailable" } });
  });
  await page.goto("/"); await page.getByRole("button", { name: "账号与安全", exact: true }).click();
  await page.getByRole("button", { name: "读取登录状态与工作空间" }).click(); await expect(page.getByLabel("组织工作空间").first()).toHaveValue("ws");
  return { bodies, cdp, authenticatorId };
}
test("review and approve using a real browser virtual authenticator without exposing credentials", async ({ page }) => {
  const f = await fixture(page);
  await page.getByLabel("设备授权码").fill("TEST-CODE"); await page.getByRole("button", { name: "查看设备请求" }).click();
  await expect(page.getByText("test-device-123456", { exact: true })).toBeVisible(); expect(f.bodies).toHaveLength(1);
  await page.getByRole("button", { name: "安全验证并批准" }).click(); await expect(page.getByRole("status").filter({ hasText: "正在签发" })).toBeVisible();
  const assertion = (f.bodies[1].body as { webauthnAssertion: { response: { signature: string; clientDataJSON: string } } }).webauthnAssertion;
  expect(assertion.response.signature.length).toBeGreaterThan(50);
  expect(JSON.parse(Buffer.from(assertion.response.clientDataJSON, "base64url").toString()).type).toBe("webauthn.get");
  expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toMatch(/TEST-CODE|csrfToken|webauthnAssertion/);
  await page.screenshot({ path: ".studio/workspace-security.png", fullPage: true });
});
test("lost approval response is reconciled without a second authenticator assertion", async ({ page }) => {
  const f = await fixture(page, true);
  await page.getByLabel("设备授权码").fill("TEST-CODE"); await page.getByRole("button", { name: "查看设备请求" }).click(); await page.getByRole("button", { name: "安全验证并批准" }).click();
  await expect(page.getByRole("button", { name: "核对原审批结果" })).toBeEnabled();
  await page.getByRole("button", { name: "项目文件", exact: true }).click(); await page.getByRole("button", { name: "账号与安全", exact: true }).click();
  await page.getByRole("button", { name: "读取登录状态与工作空间" }).click();
  await expect(page.getByText("test-device-123456", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "核对原审批结果" }).click(); await expect(page.getByRole("status").filter({ hasText: "正在签发" })).toBeVisible();
  expect(f.bodies).toHaveLength(3); expect(f.bodies[2].body).toEqual({}); expect(f.bodies[1].path).toBe(f.bodies[2].path);
});
test("denial never requests a credential and the English view fits narrow panels", async ({ page }) => {
  const f = await fixture(page);
  await page.getByLabel("设备授权码").fill("TEST-CODE"); await page.getByRole("button", { name: "查看设备请求" }).click(); await page.getByRole("button", { name: "拒绝此设备" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已拒绝" })).toBeVisible(); expect(f.bodies.some(r => String(r.path).endsWith("/complete"))).toBe(false);
  await page.getByLabel("语言", { exact: true }).selectOption("en-US");
  await expect(page.getByRole("button", { name: "Account & security", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = page.getByRole("button", { name: "Account & security", exact: true });
  if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
  await expect(page.getByRole("heading", { name: "Organization sign-in" })).toBeVisible();
  expect(await page.locator(".ide-left-dock .ide-dock-content").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("local development refuses identity endpoints instead of proxying or serving the SPA", async ({ request }) => {
  for (const path of ["/api/workspace/v1/session", "/.auth/login/aad"]) {
    const response = await request.get(path); expect(response.status()).toBe(503); expect(await response.json()).toEqual({ code: "workspace_identity_not_configured" });
  }
});
