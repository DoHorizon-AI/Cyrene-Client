import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsClient } from "../../apps/web/src/services/client";
import { WorkspaceBffClient, WORKSPACE_PRODUCT_OPERATIONS } from "../../apps/web/src/services/workspace-bff-client";
import { decodeBase64url, requestDeviceAssertion } from "../../apps/web/src/services/workspace-security-contracts";

const expiry = () => new Date(Date.now() + 120_000).toISOString();
function fixture() {
  const session = { issuer: "https://issuer.example", subject: "alice", organizationId: "org", expiresAt: expiry(), csrfToken: "v1.123." + "a".repeat(40) };
  const authorization = { authorizationId: "a".repeat(22), deviceId: "device-1234567890", scope: { organizationId: "org", workspaceId: "ws" }, csrSpkiSha256: "A".repeat(43) + "=", csrSha256: "A".repeat(43) + "=", expiresAt: expiry(), authorizationGeneration: 1 };
  const approval = { authorization, approvalId: "approval-1234567890", webauthnOptions: { challenge: "Y2hhbGxlbmdl" }, challengeExpiresAt: new Date(Date.now() + 60_000).toISOString() };
  const requests: { path: string; init?: RequestInit }[] = [];
  let failComplete = false;
  const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input); requests.push({ path, init });
    if (path.endsWith("/session")) return response(session);
    if (path.endsWith("/workspaces")) return response({ workspaces: [{ workspaceId: "ws", organizationId: "org", displayName: "Team" }] });
    if (path.endsWith("/approval-challenges")) return response(approval);
    if (path.endsWith("/complete")) { if (failComplete) { failComplete = false; throw new Error("lost response"); } return response({ authorization, state: "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_ISSUING", approvedBy: { issuer: session.issuer, subject: session.subject }, approvedAt: new Date().toISOString() }); }
    if (path.endsWith("/denials")) return response({ authorization, deniedBy: { issuer: session.issuer, subject: session.subject }, deniedAt: new Date().toISOString() });
    return response([]);
  });
  return { client: new WorkspaceBffClient({ enabled: true, fetcher }), session, approval, requests, fetcher, response, loseComplete: () => { failComplete = true; } };
}
afterEach(() => vi.unstubAllGlobals());
describe("Workspace identity and security boundary", () => {
  it("keeps disabled adapters offline", async () => {
    const fetcher = vi.fn(); const client = new WorkspaceBffClient({ enabled: false, fetcher });
    await expect(client.discoverWorkspaces()).rejects.toMatchObject({ code: "feature_disabled" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("only dispatches operations for discovered workspaces and current principals", async () => {
    const f = fixture(); await f.client.discoverWorkspaces();
    await expect(f.client.invoke("other", WORKSPACE_PRODUCT_OPERATIONS.listDatasets)).rejects.toMatchObject({ code: "workspace_not_discovered" });
    f.session.subject = "bob";
    await expect(f.client.invoke("ws", WORKSPACE_PRODUCT_OPERATIONS.listDatasets)).rejects.toMatchObject({ code: "session_changed" });
    expect(f.requests.some(r => r.path.includes("/products/"))).toBe(false); expect(f.client.identity).toBeNull();
  });
  it("rejects expired sessions before discovery", async () => {
    const f = fixture(); f.session.expiresAt = "2020-01-01T00:00:00Z";
    await expect(f.client.discoverWorkspaces()).rejects.toMatchObject({ code: "unauthenticated" });
    expect(f.requests).toHaveLength(1);
  });
  it("does not accept another organization's discovery", async () => {
    const f = fixture(); f.session.organizationId = "foreign";
    await expect(f.client.discoverWorkspaces()).rejects.toMatchObject({ code: "workspace_discovery_invalid" });
  });
  it("does not let an obsolete discovery erase or overwrite the newer identity", async () => {
    const f = fixture(); let release!: (value: Response) => void;
    f.fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const old = f.client.discoverWorkspaces(); const rejected = expect(old).rejects.toMatchObject({ code: "session_changed" });
    await f.client.discoverWorkspaces(); release(f.response({ ...f.session, subject: "old" })); await rejected;
    expect(f.client.identity?.subject).toBe("alice");
    await expect(f.client.invoke("ws", WORKSPACE_PRODUCT_OPERATIONS.listDatasets)).resolves.toEqual([]);
  });
  it("sends fresh CSRF and scope, without bearer or browser storage", async () => {
    const f = fixture(); await f.client.discoverWorkspaces(); f.session.csrfToken = "v1.124." + "b".repeat(40);
    await f.client.beginDeviceApproval("ws", "CODE");
    const request = f.requests.at(-1)!; const headers = new Headers(request.init?.headers);
    expect(headers.get("x-csrf-token")).toBe(f.session.csrfToken); expect(headers.has("authorization")).toBe(false);
    expect(JSON.parse(String(request.init?.body))).toEqual({ userCode: "CODE", scope: { organizationId: "org", workspaceId: "ws" } });
    expect(f.client.identity).not.toHaveProperty("csrfToken");
  });
  it("validates device scope and expiry before displaying a challenge", async () => {
    const f = fixture(); await f.client.discoverWorkspaces(); f.approval.authorization.scope.workspaceId = "other";
    await expect(f.client.beginDeviceApproval("ws", "CODE")).rejects.toMatchObject({ code: "invalid_response" });
    f.approval.authorization.scope.workspaceId = "ws"; f.approval.challengeExpiresAt = "2020-01-01T00:00:00Z";
    await expect(f.client.beginDeviceApproval("ws", "CODE")).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("reconciles a lost completion with the same approval id and no new assertion", async () => {
    const f = fixture(); await f.client.discoverWorkspaces(); const approval = await f.client.beginDeviceApproval("ws", "CODE"); f.loseComplete();
    await expect(f.client.completeDeviceApproval(approval, { id: "assertion" })).rejects.toMatchObject({ code: "unreachable" });
    await expect(f.client.completeDeviceApproval(approval)).resolves.toMatchObject({ state: "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_ISSUING" });
    const writes = f.requests.filter(r => r.path.endsWith("/complete")); expect(writes).toHaveLength(2); expect(writes[0].path).toBe(writes[1].path); expect(writes[1].init?.body).toBe("{}");
    expect(f.requests.filter(r => r.path.endsWith("/approval-challenges"))).toHaveLength(1);
  });
  it("rejects identity changes before approval or denial side effects", async () => {
    const f = fixture(); await f.client.discoverWorkspaces(); const approval = await f.client.beginDeviceApproval("ws", "CODE"); f.session.subject = "bob";
    await expect(f.client.completeDeviceApproval(approval, {})).rejects.toMatchObject({ code: "session_changed" });
    await expect(f.client.denyDeviceAuthorization("ws", "CODE")).rejects.toMatchObject({ code: "workspace_not_discovered" });
    expect(f.requests.some(r => /complete|denials/.test(r.path))).toBe(false);
  });
  it("blocks unsupported Product paths instead of bypassing BFF authorization", async () => {
    const f = fixture(); const client = new SettingsClient(f.fetcher, 1000, f.client);
    await expect(client.drafts()).rejects.toMatchObject({ code: "unsupported_operation" }); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("cancellation of the system authenticator produces no assertion", async () => {
    const f = fixture(); vi.stubGlobal("isSecureContext", true);
    const get = vi.fn().mockRejectedValue(new DOMException("cancelled", "NotAllowedError")); vi.stubGlobal("navigator", { credentials: { get } });
    await expect(requestDeviceAssertion(f.approval, new AbortController().signal)).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(get.mock.calls[0][0].publicKey.userVerification).toBe("required"); expect(new TextDecoder().decode(decodeBase64url("Y2hhbGxlbmdl"))).toBe("challenge");
  });
});
