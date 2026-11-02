// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-peripheral API tests                 │
// │ Role: Verify attachment, speech, Bilibili, and backup routes.       │
// │ 中文：模块职责：验证附件、语音、B站与备份 Work 路径。                 │
// └─────────────────────────────────────────────────────────────────────┘

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { NavigatorApi } from "../api";

const digest = "a".repeat(64);
const backupBytes = new TextEncoder().encode('{"schemaVersion":1}');
const backupDigest = createHash("sha256").update(backupBytes).digest("hex");
const backupArtifact = { artifactId: "artifact-backup-1", sha256: backupDigest, size: backupBytes.length, mimeType: "application/json" };
const attachment = { id: digest, workspaceId: "workspace-1", sha256: digest, name: "voice.wav", mediaType: "audio/wav", size: 1024, createdAt: 1000 };
const asset = { assetId: "asset-1", digest, mimeType: "image/png", byteSize: 1024, title: "Card", altText: "A card", tags: ["test"], width: 320, height: 180, createdAt: 1000, deletedAt: null };
const assetWithoutOptionalMetadata = { ...asset, assetId: "asset-2", altText: null, width: null, height: null };
const account = { profileRef: "profile-1", provider: "bilibili", identityRef: "identity-1", targetScope: { actor: "actor-1" }, authStatus: "ready", externalSubject: "uid-1", displayName: "Test account", authMode: "oauth", accessMode: "actor_owned", expiresAt: 2_000, credentialRevision: 3 };
const operation = { id: "operation-1", idempotencyKey: "idem-1", operationType: "tool.provider.v1:bilibili.comment.create", request: {}, status: "uncertain", evidence: { replay: "NOT_REPLAYED" }, createdAt: 1000, updatedAt: 1000 };

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("conversation peripheral Work API", () => {
  it("uses Work attachments and owner-scoped media and speech contracts", async () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = [];
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input), method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path, method, body });
      if (path.includes("/media/assets?") && method === "GET") return response({ items: [asset, assetWithoutOptionalMetadata], nextCursor: null });
      if (path.endsWith("/media/assets/import")) return response(asset, 201);
      if (path.endsWith("/media/assets/asset-1") && method === "GET") return response({ asset, attachment, downloadPath: `/api/v1/workspaces/workspace-1/work/conversation-memory/media/assets/asset-1/attachment` });
      if (path.endsWith("/media/assets/asset-1") && method === "DELETE") return response({ assetId: "asset-1", deleted: true });
      if (path.endsWith("/media/assets/asset-1/restore")) return response(asset);
      if (path.endsWith("/media/cards/render")) return response({ asset, attachment, downloadPath: `/api/v1/workspaces/workspace-1/work/conversation-memory/media/assets/asset-1/attachment` }, 201);
      if (path.endsWith("/speech/config") && method === "GET") return response({ enabled: true, defaultLanguageHint: "en", maxUploadBytes: 10_000_000, allowedMediaTypes: ["audio/wav"] });
      if (path.endsWith("/speech/config") && method === "PUT") return response({ enabled: true, defaultLanguageHint: "en", maxUploadBytes: 10_000_000, allowedMediaTypes: ["audio/wav"] });
      if (path.endsWith("/speech/status")) return response({ available: true, model: "sensevoice-local", reasonCode: null });
      if (path.endsWith("/speech/transcriptions")) return response({ status: "succeeded", text: "Hello there.", detectedLanguage: "en", durationMs: 1200, model: "sensevoice-local", segments: [{ startMs: 0, endMs: 900, text: "Hello there." }] });
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const assets = await api.searchConversationMediaAssets("workspace-1", { query: "card", limit: 20 });
    expect(assets.items[0]?.assetId).toBe("asset-1");
    expect(assets.items[1]).toMatchObject({ assetId: "asset-2", altText: null, width: null, height: null });
    expect((await api.importConversationMediaAsset("workspace-1", { attachmentDigest: digest, title: "Card" })).title).toBe("Card");
    expect((await api.getConversationMediaAsset("workspace-1", "asset-1")).attachment.sha256).toBe(digest);
    expect((await api.deleteConversationMediaAsset("workspace-1", "asset-1")).deleted).toBe(true);
    expect((await api.restoreConversationMediaAsset("workspace-1", "asset-1")).deletedAt).toBeNull();
    expect((await api.renderConversationMediaCard("workspace-1", { title: "Card", content: "Hello" })).attachment.mediaType).toBe("audio/wav");
    expect((await api.getSpeechConfig("workspace-1")).allowedMediaTypes).toEqual(["audio/wav"]);
    expect((await api.putSpeechConfig("workspace-1", { enabled: true })).enabled).toBe(true);
    expect((await api.getSpeechStatus("workspace-1")).available).toBe(true);
    expect((await api.transcribeWorkAttachment("workspace-1", { attachmentDigest: digest })).text).toBe("Hello there.");
    expect(calls.find((call) => call.method === "POST" && call.path.endsWith("/media/assets/import"))?.body).toMatchObject({ attachmentDigest: digest, title: "Card" });
  });

  it("starts ephemeral QR login, runs allowlisted tools, and reads immutable Work receipts", async () => {
    const calls: Array<{ path: string; method: string; body: unknown; idempotencyKey?: string }> = [];
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input), method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path, method, body, idempotencyKey: new Headers(init?.headers).get("Idempotency-Key") ?? undefined });
      if (path.endsWith("/bilibili/accounts")) return response({ items: [account] });
      if (path.endsWith("/bilibili/connections")) return response({ items: [{ connectionRef: "connection-1", provider: "bilibili", displayName: "Test connection", enabled: true }] });
      if (path.endsWith("/bilibili/accounts/link")) return response({ loginFlowId: "flow-1", qrCodeBase64: "iVBORw0KGgo=", qrCodeSha256: digest, expiresAt: "2030-01-01T00:00:00Z", status: "pending" });
      if (path.endsWith("/bilibili/link-status")) return response({ status: "linked", loginFlowId: "flow-1", profile: { profileRef: "profile-1", externalSubject: "uid-1", displayName: "Test account" }, reloginRequired: false });
      if (path.endsWith("/bilibili/connections/connection-1/read-operations")) return response({ readOperations: ["bilibili.search"], writeOperations: ["bilibili.comment.create"] });
      if (path.endsWith("/bilibili/connections/connection-1/reads/bilibili.search")) return response({ items: [{ title: "Real fixture result" }], nextPage: null });
      if (path.endsWith("/bilibili/connections/connection-1/writes/bilibili.comment.create")) return response({ operation, duplicate: false }, 202);
      if (path.endsWith("/bilibili/operations/by-idempotency-key")) return response({ operation, duplicate: true });
      if (path.endsWith("/operations/operation-1")) return response({ operation });
      if (path.endsWith("/conversation-memory/backups") && method === "POST") return response(backupArtifact, 201);
      if (path.endsWith(`/conversation-memory/backups/attachments/${backupDigest}`) && method === "GET") {
        return new Response(backupBytes, { status: 200, headers: { "Content-Type": backupArtifact.mimeType, "X-Content-SHA256": backupDigest } });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    expect((await api.getBilibiliAccounts("workspace-1"))[0]?.authStatus).toBe("ready");
    expect((await api.getBilibiliConnections("workspace-1"))[0]?.connectionRef).toBe("connection-1");
    expect((await api.beginBilibiliLink("workspace-1")).loginFlowId).toBe("flow-1");
    expect((await api.getBilibiliLinkStatus("workspace-1", "flow-1")).profile?.profileRef).toBe("profile-1");
    expect((await api.listBilibiliReadOperations("workspace-1", "connection-1")).readOperations).toEqual(["bilibili.search"]);
    expect(await api.runBilibiliRead("workspace-1", "connection-1", "bilibili.search", { keyword: "hello", search_type: "video" })).toEqual({ items: [{ title: "Real fixture result" }], nextPage: null });
    expect((await api.runBilibiliWrite("workspace-1", "connection-1", "bilibili.comment.create", { idempotencyKey: "idem-1", arguments: { video_id: "BV1", content: "Hello", root_comment_id: "0", parent_comment_id: "0" } })).operation.status).toBe("uncertain");
    expect((await api.getBilibiliOperationByIdempotencyKey("workspace-1", "idem-1")).operation.id).toBe("operation-1");
    expect((await api.getWorkOperationReceipt("workspace-1", "operation-1")).operation.id).toBe("operation-1");
    expect(await api.createConversationBackup("workspace-1")).toEqual(backupArtifact);
    const backupBlob = await api.downloadConversationBackup("workspace-1", backupDigest, backupBytes.length);
    expect(await backupBlob.text()).toBe(new TextDecoder().decode(backupBytes));
    await expect(api.downloadConversationBackup("workspace-1", backupDigest, backupBytes.length + 1)).rejects.toMatchObject({ name: "NavigatorContractError" });
    expect(calls.some((call) => call.method === "GET" && call.path === `/api/v1/workspaces/workspace-1/work/conversation-memory/backups/attachments/${backupDigest}`)).toBe(true);
    expect(calls.find((call) => call.path.endsWith("/accounts/link"))?.body).toEqual({});
    expect(calls.find((call) => call.path.endsWith("/link-status"))?.body).toEqual({ loginFlowId: "flow-1" });
    expect(calls.find((call) => call.path.endsWith("/writes/bilibili.comment.create"))).toMatchObject({ path: expect.stringContaining("/connections/connection-1/"), body: { arguments: { video_id: "BV1" } }, idempotencyKey: "idem-1" });
    expect(calls.find((call) => call.path.endsWith("/operations/by-idempotency-key"))).toMatchObject({ method: "GET", idempotencyKey: "idem-1" });
  });

  it("verifies private binary downloads against the scoped path and digest header", async () => {
    const bytes = new TextEncoder().encode("private image bytes");
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    const safePath = "/api/v1/workspaces/workspace-1/work/conversation-memory/media/assets/asset-1/attachment";
    const api = new NavigatorApi(async () => new Response(bytes, { status: 200, headers: { "Content-Type": "image/png", "X-Content-SHA256": actualDigest } }));
    const blob = await api.downloadConversationMediaAsset("workspace-1", "asset-1", safePath, actualDigest);
    expect(await blob.text()).toBe("private image bytes");
    await expect(api.downloadConversationMediaAsset("workspace-1", "asset-1", "https://example.test/image.png", actualDigest)).rejects.toMatchObject({ name: "NavigatorContractError" });
  });
});
