// Module: tests/unit/device-approval.test.ts
// Role: Contract-shape and browser assertion tests for device approvals.
// 中文：模块职责：验证设备审批字段合同和浏览器断言序列化。

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DeviceApprovalClient,
  type DeviceApprovalTransport,
  createDeviceApprovalChallengeResponseSchema,
  requestWebAuthnAssertion,
} from "../../apps/web/src/device-approval/client";
import { DeviceApprovalPage } from "../../apps/web/src/device-approval/DeviceApprovalPage";

const authorization = {
  authorizationId: "authorization-id-0001",
  deviceId: "workspace-device-0001",
  scope: { organizationId: "org-one", workspaceId: "workspace-one" },
  csrSpkiSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  csrSha256: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
  expiresAt: "2026-09-26T21:00:00Z",
  authorizationGeneration: 1,
};

const challenge = {
  authorization,
  approvalId: "approval-id-0001",
  webauthnOptions: { challenge: "AQIDBA", userVerification: "required" },
  challengeExpiresAt: "2026-09-26T20:55:00Z",
};

describe("device approval OpenAPI client", () => {
  it("keeps the page disabled when the trusted identity and Host adapter are absent", () => {
    const markup = renderToStaticMarkup(createElement(DeviceApprovalPage, { sessionStatus: "unavailable" }));
    expect(markup).toContain("Local Web Host pairing does not prove organization membership");
    expect(markup).toContain("same-origin device approval service is not configured");
    expect(markup).toContain('aria-label="Device authorization review"');
    expect(markup).toMatch(/button[^>]*disabled/);
  });

  it("accepts only the declared challenge response fields", () => {
    expect(createDeviceApprovalChallengeResponseSchema.parse(challenge)).toEqual(challenge);
    expect(() => createDeviceApprovalChallengeResponseSchema.parse({ ...challenge, deviceCode: "secret" })).toThrow();
  });

  it("validates exact transport responses without inventing endpoint paths", async () => {
    const transport: DeviceApprovalTransport = {
      createDeviceApprovalChallenge: vi.fn().mockResolvedValue(challenge),
      completeDeviceApproval: vi.fn().mockResolvedValue({
        authorization,
        state: "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_ISSUING",
        approvedBy: { issuer: "https://identity.example", subject: "user-1" },
        approvedAt: "2026-09-26T20:50:00Z",
      }),
      denyDeviceAuthorization: vi.fn(),
    };
    const client = new DeviceApprovalClient(transport);
    await expect(client.createChallenge({ userCode: "ABCD-EFGH-JKLM", scope: authorization.scope })).resolves.toEqual(challenge);
    await expect(client.completeApproval(challenge.approvalId, {})).resolves.toMatchObject({
      state: "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_ISSUING",
    });
    expect(transport.createDeviceApprovalChallenge).toHaveBeenCalledWith({ userCode: "ABCD-EFGH-JKLM", scope: authorization.scope });
    expect(transport.completeDeviceApproval).toHaveBeenCalledWith(challenge.approvalId, {});
  });

  it("passes converted public-key options to the browser and serializes only the assertion", async () => {
    const rawId = Uint8Array.from([5, 6, 7]).buffer;
    const field = Uint8Array.from([1, 2, 3]).buffer;
    const getCredential = vi.fn().mockResolvedValue({
      type: "public-key",
      id: "credential-1",
      rawId,
      authenticatorAttachment: "platform",
      response: { clientDataJSON: field, authenticatorData: field, signature: field, userHandle: null },
    } as unknown as Credential);

    const assertion = await requestWebAuthnAssertion({
      challenge: "AQIDBA",
      rpId: "cyrene.example",
      allowCredentials: [{ type: "public-key", id: "BQYH", transports: ["internal"] }],
      userVerification: "required",
    }, getCredential);

    const request = getCredential.mock.calls[0][0] as CredentialRequestOptions;
    expect(Array.from(new Uint8Array(request.publicKey!.challenge as ArrayBuffer))).toEqual([1, 2, 3, 4]);
    expect(Array.from(new Uint8Array(request.publicKey!.allowCredentials![0].id as ArrayBuffer))).toEqual([5, 6, 7]);
    expect(assertion).toMatchObject({ type: "public-key", rawId: "BQYH", response: { userHandle: null } });
    expect(assertion).not.toHaveProperty("certificate");
    expect(assertion).not.toHaveProperty("privateKey");
  });
});
