// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Conversation peripheral browser tests                       │
// │ Role: Exercise media, speech, Bilibili connection, and receipts.    │
// │ 中文：模块职责：验证媒体、语音、哔哩哔哩连接与操作回执交互。            │
// └─────────────────────────────────────────────────────────────────────┘

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pS8AAAAASUVORK5CYII=", "base64");
const imageDigest = createHash("sha256").update(imageBytes).digest("hex");
const audioBytes = Buffer.from("local audio fixture");
const audioDigest = createHash("sha256").update(audioBytes).digest("hex");
const qrDigest = imageDigest;
const attachment = (name: string, mediaType: string, sha256: string, size: number) => ({ id: sha256, workspaceId: "local", sha256, name, mediaType, size, createdAt: 1000 });
const imageAsset = { assetId: "asset-image-1", digest: imageDigest, mimeType: "image/png", byteSize: imageBytes.length, title: "sample", altText: "Sample picture", tags: ["test"], width: 1, height: 1, createdAt: 1000, deletedAt: null };
const cardAsset = { ...imageAsset, assetId: "card-image-1", title: "Rendered card" };
const readIds = ["bilibili.search", "bilibili.user.find", "bilibili.video.read", "bilibili.comments.list", "bilibili.dynamics.list", "bilibili.dynamic.read", "bilibili.dm.list", "bilibili.dm.read"];
const writeIds = ["bilibili.comment.create", "bilibili.dynamic.publish", "bilibili.dm.send"];

async function mountPeripheral(page: Page) {
  const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  const calls: Array<{ method: string; path: string; body: unknown; csrf?: string; idempotencyKey?: string }> = [];
  let asset = imageAsset;
  let deleted = false;
  let linked = false;
  let receipt: Record<string, unknown> | null = null;
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = request.postDataJSON() as unknown;
    calls.push({ method, path, body, csrf: request.headers()["x-csrf-token"], idempotencyKey: request.headers()["idempotency-key"] });
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === "/api/v1/auth/session") return reply({ authenticated: true, state: "AUTHENTICATED", sessionId: "paired-session", expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "paired-csrf", refreshed: false });
    if (path === "/api/v1/system/status") return reply({ service: "Navigator", status: "OK", version: "fixture", workspaceId: "local", authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString() });
    if (path.endsWith("/conversation-memory/media/assets") && method === "GET") return reply({ items: deleted ? [{ ...asset, deletedAt: 2000 }] : [asset], nextCursor: null });
    if (path.endsWith("/work/attachments") && method === "POST") {
      const input = body as Record<string, unknown>, mediaType = String(input["mediaType"]), name = String(input["name"]);
      return reply(attachment(name, mediaType, mediaType.startsWith("image/") ? imageDigest : audioDigest, mediaType.startsWith("image/") ? imageBytes.length : audioBytes.length), 201);
    }
    if (path.endsWith("/conversation-memory/media/assets/import")) { asset = imageAsset; deleted = false; return reply(asset, 201); }
    if (path.endsWith("/conversation-memory/media/assets/asset-image-1") && method === "GET") return reply({ asset: deleted ? { ...asset, deletedAt: 2000 } : asset, attachment: attachment("sample.png", "image/png", imageDigest, imageBytes.length), downloadPath: `/api/v1/workspaces/local/work/conversation-memory/media/assets/asset-image-1/attachment` });
    if (path.endsWith("/conversation-memory/media/assets/asset-image-1/attachment")) return route.fulfill({ status: 200, body: imageBytes, headers: { "Content-Type": "image/png", "X-Content-SHA256": imageDigest } });
    if (path.endsWith("/conversation-memory/media/assets/asset-image-1") && method === "DELETE") { deleted = true; return reply({ assetId: "asset-image-1", deleted: true }); }
    if (path.endsWith("/conversation-memory/media/assets/asset-image-1/restore")) { deleted = false; return reply({ ...asset, deletedAt: null }); }
    if (path.endsWith("/conversation-memory/media/cards/render")) return reply({ asset: cardAsset, attachment: attachment("card.png", "image/png", imageDigest, imageBytes.length), downloadPath: `/api/v1/workspaces/local/work/conversation-memory/media/assets/card-image-1/attachment` }, 201);
    if (path.endsWith("/conversation-memory/media/assets/card-image-1/attachment")) return route.fulfill({ status: 200, body: imageBytes, headers: { "Content-Type": "image/png", "X-Content-SHA256": imageDigest } });
    if (path.endsWith("/conversation-memory/speech/config") && method === "GET") return reply({ enabled: true, defaultLanguageHint: "en", maxUploadBytes: 10_000_000, allowedMediaTypes: ["audio/wav"] });
    if (path.endsWith("/conversation-memory/speech/config") && method === "PUT") return reply({ enabled: true, defaultLanguageHint: "en", maxUploadBytes: 10_000_000, allowedMediaTypes: ["audio/wav"] });
    if (path.endsWith("/conversation-memory/speech/status")) return reply({ available: true, model: "sensevoice-local", reasonCode: null });
    if (path.endsWith("/conversation-memory/speech/transcriptions")) return reply({ status: "succeeded", text: "Turn left at the next street.", detectedLanguage: "en", durationMs: 2300, model: "sensevoice-local", segments: [{ startMs: 100, endMs: 1900, text: "Turn left at the next street." }] });
    if (path.endsWith("/conversation-memory/bilibili/accounts") && method === "GET") return reply({ items: linked ? [{ profileRef: "profile-1", provider: "bilibili", identityRef: "bili-1", targetScope: { workspaceId: "local" }, authStatus: "ready", externalSubject: "uid-1", displayName: "Bili test", authMode: "oauth", accessMode: "actor_owned", expiresAt: 2_000_000_000, credentialRevision: 1 }] : [] });
    if (path.endsWith("/conversation-memory/bilibili/connections") && method === "GET") return reply({ items: linked ? [{ connectionRef: "connection-1", provider: "bilibili", displayName: "Bili test connection", enabled: true }] : [] });
    if (path.endsWith("/conversation-memory/bilibili/accounts/link")) return reply({ loginFlowId: "flow-1", qrCodeBase64: imageBytes.toString("base64"), qrCodeSha256: qrDigest, expiresAt: "2030-01-01T00:00:00Z", status: "pending" });
    if (path.endsWith("/conversation-memory/bilibili/link-status")) { linked = true; return reply({ status: "linked", loginFlowId: "flow-1", profile: { profileRef: "profile-1", externalSubject: "uid-1", displayName: "Bili test" }, reloginRequired: false }); }
    if (path.endsWith("/conversation-memory/bilibili/connections/connection-1/read-operations")) return reply({ readOperations: readIds, writeOperations: writeIds });
    if (path.endsWith("/conversation-memory/bilibili/connections/connection-1/reads/bilibili.search")) return reply({ items: [{ title: "Returned provider result", bvid: "BV1" }], nextPage: null });
    if (path.endsWith("/conversation-memory/bilibili/connections/connection-1/writes/bilibili.comment.create")) {
      receipt = { id: "operation-1", idempotencyKey: request.headers()["idempotency-key"], operationType: "tool.provider.v1:bilibili.comment.create", request: { operationId: "bilibili.comment.create" }, status: "uncertain", evidence: { status: "UNKNOWN", replay: "NOT_REPLAYED" }, createdAt: 3000, updatedAt: 3000 };
      return reply({ operation: receipt, duplicate: false }, 202);
    }
    if (path.endsWith("/work/operations/operation-1")) return reply({ operation: receipt });
    return reply({ code: "NOT_FOUND", detail: `No fixture route for ${method} ${path}.` }, 404);
  });
  await page.goto("/?fixture=conversation-assistant");
  return { calls };
}

test("SIMULATED browser flow uploads media, reads speech, and records Bilibili receipts", async ({ page }) => {
  const { calls } = await mountPeripheral(page);
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("tab", { name: "Media & Bilibili" }).click();
  await page.getByRole("tab", { name: "Media & speech" }).click();

  await page.locator("input[type=file]").setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: imageBytes });
  await page.getByRole("button", { name: "Upload to Work" }).click();
  await expect(page.getByRole("status")).toContainText(imageDigest);
  await page.getByLabel("Title", { exact: true }).fill("Sample image");
  await page.getByLabel("Alt text").fill("A one pixel test image");
  await page.getByRole("button", { name: "Import asset" }).click();
  await expect(page.getByText("Media asset imported: asset-image-1")).toBeVisible();
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(page.getByRole("heading", { name: "Asset details" })).toBeVisible();
  await page.getByRole("button", { name: "Soft delete" }).click();
  await expect(page.getByText("Media asset soft-deleted.")).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Media asset restored.")).toBeVisible();

  const files = page.locator("input[type=file]");
  await files.setInputFiles({ name: "voice.wav", mimeType: "audio/wav", buffer: audioBytes });
  await page.getByRole("button", { name: "Upload to Work" }).click();
  await page.getByRole("button", { name: "Transcribe uploaded audio" }).click();
  await expect(page.getByText("Turn left at the next street.", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Bilibili", exact: true }).click();
  await page.getByRole("button", { name: "Start QR link" }).click();
  await expect(page.getByRole("heading", { name: "Scan to link Bilibili" })).toBeVisible();
  await page.getByRole("button", { name: "Poll link status" }).click();
  await expect(page.getByText("Bilibili profile is linked.", { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "Connection", exact: true }).first().selectOption("connection-1");
  await page.getByRole("combobox", { name: "Operation" }).selectOption("bilibili.search");
  await page.getByLabel("Provider arguments JSON").fill(JSON.stringify({ keyword: "hello", search_type: "video", page: 1 }));
  await page.getByRole("button", { name: "Run read operation" }).click();
  await expect(page.getByText("Returned provider result")).toBeVisible();
  await page.getByRole("combobox", { name: "Operation" }).selectOption("bilibili.comment.create");
  await page.getByLabel("Provider arguments JSON").fill(JSON.stringify({ video_id: "BV1", root_comment_id: "0", parent_comment_id: "0", content: "Test comment" }));
  await page.getByRole("button", { name: "Run write operation" }).click();
  await expect(page.getByText("Bilibili write result is uncertain.", { exact: false })).toBeVisible();
  await expect(page.getByText("operation-1")).toBeVisible();
  await page.getByRole("textbox", { name: "Receipt ID", exact: true }).fill("operation-1");
  await page.getByRole("button", { name: "Read receipt" }).click();
  await expect(page.getByText("Operation receipt read back: uncertain")).toBeVisible();

  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/media/assets/import"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/speech/transcriptions") && (call.body as Record<string, unknown>)["attachmentDigest"] === audioDigest)).toBe(true);
  expect(calls.some(call => call.method === "GET" && call.path.endsWith("/bilibili/connections"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/connections/connection-1/reads/bilibili.search"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/connections/connection-1/writes/bilibili.comment.create"))).toBe(true);
  expect(calls.some(call => call.method === "GET" && call.path.endsWith("/work/operations/operation-1"))).toBe(true);
  expect(calls.filter(call => call.method !== "GET").every(call => call.csrf === "paired-csrf")).toBe(true);
});
