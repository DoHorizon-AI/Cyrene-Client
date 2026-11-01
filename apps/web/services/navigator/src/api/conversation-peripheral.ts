// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation peripheral API                      │
// │ Role: Call owner-backed media, speech, Bilibili, and backup routes. │
// │ 中文：模块职责：调用媒体、语音、B站和备份所属 API。                   │
// └─────────────────────────────────────────────────────────────────────┘

import type { WorkSchemas } from "./../generated/contracts";
import type { NavigatorTransport } from "./transport";
import { NavigatorContractError } from "./errors";
import { requireArray, requireBoolean, requireNumber, requireRecord, requireString } from "./parsers/validation";
import { jsonRequest, toHttpError, workId, workPath } from "./requests";
import type { ResponseParser } from "./types";

export interface WorkAttachmentRef {
  id: string;
  workspaceId: string;
  sha256: string;
  name: string;
  mediaType: string;
  size: number;
  createdAt: number;
}

export interface ConversationMediaAsset {
  assetId: string;
  digest: string;
  mimeType: string;
  byteSize: number;
  title: string;
  altText: string | null;
  tags: string[];
  width: number | null;
  height: number | null;
  createdAt: number;
  deletedAt: number | null;
}

export interface ConversationMediaAssetRead {
  asset: ConversationMediaAsset;
  attachment: WorkAttachmentRef;
  downloadPath: string;
}

export interface ActorBackupAttachment {
  attachment: WorkAttachmentRef;
  downloadPath: string;
}

export interface SpeechConfig {
  enabled: boolean;
  defaultLanguageHint: string | null;
  maxUploadBytes: number;
  allowedMediaTypes: string[];
}

export interface SpeechStatus {
  available: boolean;
  model: string | null;
  reasonCode: string | null;
}

export interface SpeechTranscription {
  status: "succeeded" | "no_speech";
  text: string;
  detectedLanguage: string | null;
  durationMs: number | null;
  model: string | null;
  segments: Array<{ startMs: number; endMs: number; text: string }>;
}

export interface BilibiliAccount {
  profileRef: string;
  provider: "bilibili";
  identityRef: string;
  targetScope: Record<string, unknown>;
  authStatus: string;
  externalSubject: string | null;
  displayName: string | null;
  authMode: string | null;
  accessMode: string;
  expiresAt: number | null;
  credentialRevision: number;
}

export interface BilibiliConnection {
  connectionRef: string;
  provider: "bilibili";
  displayName: string;
  enabled: boolean;
}

export interface BilibiliLinkFlow {
  loginFlowId: string;
  qrCodeBase64: string | null;
  qrCodeSha256: string | null;
  expiresAt: string;
  status: "pending" | "expired";
}

export interface BilibiliLinkStatus {
  status: "pending" | "scanned" | "linked" | "expired" | "failed" | "unknown_result" | "not_found";
  loginFlowId: string;
  profile: { profileRef: string; externalSubject: string | null; displayName: string | null } | null;
  reloginRequired: boolean;
}

export type BilibiliReadOperationId =
  | "bilibili.search"
  | "bilibili.user.find"
  | "bilibili.video.read"
  | "bilibili.comments.list"
  | "bilibili.dynamics.list"
  | "bilibili.dynamic.read"
  | "bilibili.dm.list"
  | "bilibili.dm.read";

export type BilibiliWriteOperationId = "bilibili.comment.create" | "bilibili.dynamic.publish" | "bilibili.dm.send";
export interface BilibiliOperationCatalog { readOperations: BilibiliReadOperationId[]; writeOperations: BilibiliWriteOperationId[] }
export type WorkOperationRecord = WorkSchemas["OperationRecord"];
export type WorkOperationReceipt = WorkSchemas["OperationReceipt"];

const parseIdentity: ResponseParser<unknown> = (value) => value;

function itemArray(value: unknown, label: string): unknown[] {
  return requireArray(requireRecord(value, label)["items"], `${label} items`);
}

function stringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item) => {
    if (typeof item !== "string") throw new NavigatorContractError(`Navigator returned an invalid ${label}.`);
    return item;
  });
}

function nullableString(row: Record<string, unknown>, key: string, label: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  return value;
}

function nullableNumber(row: Record<string, unknown>, key: string, label: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  return value;
}

function parseAttachment(value: unknown): WorkAttachmentRef {
  const row = requireRecord(value, "Work attachment reference");
  const attachment = {
    id: requireString(row, "id", "Work attachment reference"),
    workspaceId: requireString(row, "workspaceId", "Work attachment reference"),
    sha256: requireString(row, "sha256", "Work attachment reference"),
    name: requireString(row, "name", "Work attachment reference"),
    mediaType: requireString(row, "mediaType", "Work attachment reference"),
    size: requireNumber(row, "size", "Work attachment reference"),
    createdAt: requireNumber(row, "createdAt", "Work attachment reference"),
  };
  if (attachment.id !== attachment.sha256 || !/^[a-f0-9]{64}$/.test(attachment.sha256)) throw new NavigatorContractError("Navigator returned an invalid Work attachment digest.");
  return attachment;
}

function parseAsset(value: unknown): ConversationMediaAsset {
  const row = requireRecord(value, "conversation media asset");
  return {
    assetId: requireString(row, "assetId", "conversation media asset"), digest: requireString(row, "digest", "conversation media asset"),
    mimeType: requireString(row, "mimeType", "conversation media asset"), byteSize: requireNumber(row, "byteSize", "conversation media asset"),
    title: requireString(row, "title", "conversation media asset"), altText: nullableString(row, "altText", "conversation media asset"),
    tags: stringArray(row["tags"], "media asset tags"), width: nullableNumber(row, "width", "conversation media asset"),
    height: nullableNumber(row, "height", "conversation media asset"), createdAt: requireNumber(row, "createdAt", "conversation media asset"),
    deletedAt: nullableNumber(row, "deletedAt", "conversation media asset"),
  };
}

function parseAccount(value: unknown): BilibiliAccount {
  const row = requireRecord(value, "Bilibili account");
  if (row["provider"] !== "bilibili") throw new NavigatorContractError("Navigator returned a non-Bilibili provider profile.");
  return {
    profileRef: requireString(row, "profileRef", "Bilibili account"), provider: "bilibili",
    identityRef: requireString(row, "identityRef", "Bilibili account"), targetScope: requireRecord(row["targetScope"], "Bilibili account target scope"), authStatus: requireString(row, "authStatus", "Bilibili account"),
    externalSubject: nullableString(row, "externalSubject", "Bilibili account"), displayName: nullableString(row, "displayName", "Bilibili account"),
    authMode: nullableString(row, "authMode", "Bilibili account"), accessMode: requireString(row, "accessMode", "Bilibili account"),
    expiresAt: nullableNumber(row, "expiresAt", "Bilibili account"), credentialRevision: requireNumber(row, "credentialRevision", "Bilibili account"),
  };
}

function parseSpeechConfig(value: unknown): SpeechConfig {
  const row = requireRecord(value, "speech configuration");
  return { enabled: requireBoolean(row, "enabled", "speech configuration"), defaultLanguageHint: nullableString(row, "defaultLanguageHint", "speech configuration"), maxUploadBytes: requireNumber(row, "maxUploadBytes", "speech configuration"), allowedMediaTypes: stringArray(row["allowedMediaTypes"], "speech allowed media types") };
}

function parseSpeechStatus(value: unknown): SpeechStatus {
  const row = requireRecord(value, "speech status");
  return { available: requireBoolean(row, "available", "speech status"), model: nullableString(row, "model", "speech status"), reasonCode: nullableString(row, "reasonCode", "speech status") };
}

function parseTranscription(value: unknown): SpeechTranscription {
  const row = requireRecord(value, "speech transcription");
  const status = requireString(row, "status", "speech transcription");
  if (status !== "succeeded" && status !== "no_speech") throw new NavigatorContractError("Navigator returned an invalid transcription status.");
  const segments = requireArray(row["segments"], "transcription segments").map((value) => {
    const segment = requireRecord(value, "transcription segment");
    return { startMs: requireNumber(segment, "startMs", "transcription segment"), endMs: requireNumber(segment, "endMs", "transcription segment"), text: requireString(segment, "text", "transcription segment") };
  });
  return { status, text: requireString(row, "text", "speech transcription"), detectedLanguage: nullableString(row, "detectedLanguage", "speech transcription"), durationMs: nullableNumber(row, "durationMs", "speech transcription"), model: nullableString(row, "model", "speech transcription"), segments };
}

function parseAccounts(value: unknown): BilibiliAccount[] { return itemArray(value, "Bilibili accounts").map(parseAccount); }
function parseBilibiliConnections(value: unknown): BilibiliConnection[] {
  return itemArray(value, "Bilibili connections").map((value) => {
    const row = requireRecord(value, "Bilibili connection");
    if (row["provider"] !== "bilibili") throw new NavigatorContractError("Navigator returned a non-Bilibili connection.");
    return { connectionRef: requireString(row, "connectionRef", "Bilibili connection"), provider: "bilibili", displayName: requireString(row, "displayName", "Bilibili connection"), enabled: requireBoolean(row, "enabled", "Bilibili connection") };
  });
}
function parseBilibiliOperationCatalog(value: unknown): BilibiliOperationCatalog {
  const row = requireRecord(value, "Bilibili operation catalog");
  const reads = stringArray(row["readOperations"], "Bilibili read operations"), writes = stringArray(row["writeOperations"], "Bilibili write operations");
  const allowedReads = new Set<BilibiliReadOperationId>(["bilibili.search", "bilibili.user.find", "bilibili.video.read", "bilibili.comments.list", "bilibili.dynamics.list", "bilibili.dynamic.read", "bilibili.dm.list", "bilibili.dm.read"]);
  const allowedWrites = new Set<BilibiliWriteOperationId>(["bilibili.comment.create", "bilibili.dynamic.publish", "bilibili.dm.send"]);
  if (reads.some((id) => !allowedReads.has(id as BilibiliReadOperationId)) || writes.some((id) => !allowedWrites.has(id as BilibiliWriteOperationId))) throw new NavigatorContractError("Navigator returned an operation outside the fixed Bilibili allowlist.");
  return { readOperations: reads as BilibiliReadOperationId[], writeOperations: writes as BilibiliWriteOperationId[] };
}
function parseAssetDetail(value: unknown): ConversationMediaAssetRead {
  const row = requireRecord(value, "media asset detail");
  const asset = parseAsset(row["asset"]), attachment = parseAttachment(row["attachment"]);
  if (asset.digest !== attachment.sha256) throw new NavigatorContractError("Navigator returned an attachment outside the media asset digest.");
  return { asset, attachment, downloadPath: requireString(row, "downloadPath", "media asset detail") };
}
function parseCard(value: unknown): ConversationMediaAssetRead { return parseAssetDetail(value); }
function parseAssetSearch(value: unknown): { items: ConversationMediaAsset[]; nextCursor: string | null } {
  const row = requireRecord(value, "media asset search");
  return { items: itemArray(row, "media asset search").map(parseAsset), nextCursor: nullableString(row, "nextCursor", "media asset search") };
}

function parseLinkFlow(value: unknown): BilibiliLinkFlow {
  const row = requireRecord(value, "Bilibili link flow");
  const status = requireString(row, "status", "Bilibili link flow");
  if (status !== "pending" && status !== "expired") throw new NavigatorContractError("Navigator returned an invalid QR link status.");
  const flow: BilibiliLinkFlow = { loginFlowId: requireString(row, "loginFlowId", "Bilibili link flow"), qrCodeBase64: nullableString(row, "qrCodeBase64", "Bilibili link flow"), qrCodeSha256: nullableString(row, "qrCodeSha256", "Bilibili link flow"), expiresAt: requireString(row, "expiresAt", "Bilibili link flow"), status };
  if (!Number.isFinite(Date.parse(flow.expiresAt)) || ((flow.qrCodeBase64 === null) !== (flow.qrCodeSha256 === null)) || (flow.qrCodeSha256 !== null && !/^[a-f0-9]{64}$/.test(flow.qrCodeSha256))) throw new NavigatorContractError("Navigator returned an invalid QR payload reference.");
  return flow;
}

function parseLinkStatus(value: unknown): BilibiliLinkStatus {
  const row = requireRecord(value, "Bilibili link status"), status = requireString(row, "status", "Bilibili link status");
  if (!["pending", "scanned", "linked", "expired", "failed", "unknown_result", "not_found"].includes(status)) throw new NavigatorContractError("Navigator returned an invalid Bilibili login status.");
  const profile = row["profile"] === null || row["profile"] === undefined ? null : requireRecord(row["profile"], "Bilibili linked profile");
  return { status: status as BilibiliLinkStatus["status"], loginFlowId: requireString(row, "loginFlowId", "Bilibili link status"), profile: profile ? { profileRef: requireString(profile, "profileRef", "Bilibili linked profile"), externalSubject: nullableString(profile, "externalSubject", "Bilibili linked profile"), displayName: nullableString(profile, "displayName", "Bilibili linked profile") } : null, reloginRequired: requireBoolean(row, "reloginRequired", "Bilibili link status") };
}

function parseOperation(value: unknown): WorkOperationRecord {
  const row = requireRecord(value, "Work operation");
  const status = requireString(row, "status", "Work operation");
  if (!["started", "uncertain", "verified"].includes(status)) throw new NavigatorContractError("Navigator returned an invalid Work operation status.");
  return {
    id: requireString(row, "id", "Work operation"), idempotencyKey: requireString(row, "idempotencyKey", "Work operation"),
    operationType: requireString(row, "operationType", "Work operation"), request: requireRecord(row["request"], "Work operation request"),
    status: status as WorkOperationRecord["status"], evidence: requireRecord(row["evidence"], "Work operation evidence"),
    createdAt: requireNumber(row, "createdAt", "Work operation"), updatedAt: requireNumber(row, "updatedAt", "Work operation"),
    ...(row["taskId"] === undefined || row["taskId"] === null ? {} : { taskId: requireString(row, "taskId", "Work operation") }),
    ...(row["target"] === undefined || row["target"] === null ? {} : { target: requireString(row, "target", "Work operation") }),
    ...(row["scopeLock"] === undefined || row["scopeLock"] === null ? {} : { scopeLock: requireString(row, "scopeLock", "Work operation") }),
  };
}

function parseOperationReceipt(value: unknown): WorkOperationReceipt {
  const row = requireRecord(value, "Work operation receipt");
  return { operation: parseOperation(row["operation"]), ...(typeof row["duplicate"] === "boolean" ? { duplicate: row["duplicate"] } : {}) };
}

/** Owner-scoped same-origin adapter for media, speech, Bilibili, and backups. */
export class ConversationPeripheralApi {
  constructor(private readonly transport: NavigatorTransport) {}

  searchMediaAssets(workspaceId: string, input: { query?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: ConversationMediaAsset[]; nextCursor: string | null }> {
    const query = new URLSearchParams({ limit: String(input.limit ?? 20) });
    if (input.query?.trim()) query.set("q", input.query.trim());
    if (input.cursor) query.set("cursor", input.cursor);
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/media/assets?${query}`), { method: "GET", signal }, parseAssetSearch);
  }
  getMediaAsset(workspaceId: string, assetId: string, signal?: AbortSignal): Promise<ConversationMediaAssetRead> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/media/assets/${workId(assetId)}`), { method: "GET", signal }, parseAssetDetail).then((value) => {
      if (value.attachment.workspaceId !== workspaceId) throw new NavigatorContractError("Navigator returned a media attachment outside the selected workspace.");
      return value;
    });
  }
  importMediaAsset(workspaceId: string, input: { attachmentDigest: string; title: string; altText?: string; tags?: string[] }): Promise<ConversationMediaAsset> {
    if (!/^[a-f0-9]{64}$/.test(input.attachmentDigest)) throw new NavigatorContractError("Select an existing Work attachment by its SHA-256 digest.");
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/media/assets/import"), jsonRequest("POST", input, true), parseAsset);
  }
  deleteMediaAsset(workspaceId: string, assetId: string): Promise<{ assetId: string; deleted: boolean }> {
    const parser: ResponseParser<{ assetId: string; deleted: boolean }> = (value) => { const row = requireRecord(value, "media asset deletion receipt"); return { assetId: requireString(row, "assetId", "media asset deletion receipt"), deleted: requireBoolean(row, "deleted", "media asset deletion receipt") }; };
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/media/assets/${workId(assetId)}`), { method: "DELETE" }, parser);
  }
  restoreMediaAsset(workspaceId: string, assetId: string): Promise<ConversationMediaAsset> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/media/assets/${workId(assetId)}/restore`), jsonRequest("POST", {}, true), parseAsset);
  }
  renderMediaCard(workspaceId: string, input: { title: string; content: string; theme?: string }): Promise<ConversationMediaAssetRead> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/media/cards/render"), jsonRequest("POST", input, true), parseCard).then((value) => {
      if (value.attachment.workspaceId !== workspaceId) throw new NavigatorContractError("Navigator returned a rendered attachment outside the selected workspace.");
      return value;
    });
  }

  getSpeechConfig(workspaceId: string, signal?: AbortSignal): Promise<SpeechConfig> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/speech/config"), { method: "GET", signal }, parseSpeechConfig);
  }
  putSpeechConfig(workspaceId: string, input: { enabled: boolean; defaultLanguageHint?: string }): Promise<SpeechConfig> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/speech/config"), jsonRequest("PUT", input), parseSpeechConfig);
  }
  getSpeechStatus(workspaceId: string, signal?: AbortSignal): Promise<SpeechStatus> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/speech/status"), { method: "GET", signal }, parseSpeechStatus);
  }
  transcribeAttachment(workspaceId: string, input: { attachmentDigest: string; languageHint?: string }): Promise<SpeechTranscription> {
    if (!/^[a-f0-9]{64}$/.test(input.attachmentDigest)) throw new NavigatorContractError("Select an existing Work attachment by its SHA-256 digest.");
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/speech/transcriptions"), jsonRequest("POST", input), parseTranscription);
  }

  getBilibiliAccounts(workspaceId: string, signal?: AbortSignal): Promise<BilibiliAccount[]> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/bilibili/accounts"), { method: "GET", signal }, parseAccounts);
  }
  getBilibiliConnections(workspaceId: string, signal?: AbortSignal): Promise<BilibiliConnection[]> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/bilibili/connections"), { method: "GET", signal }, parseBilibiliConnections);
  }
  beginBilibiliLink(workspaceId: string): Promise<BilibiliLinkFlow> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/bilibili/accounts/link"), jsonRequest("POST", {}), parseLinkFlow);
  }
  getBilibiliLinkStatus(workspaceId: string, loginFlowId: string): Promise<BilibiliLinkStatus> {
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/bilibili/link-status"), jsonRequest("POST", { loginFlowId: workId(loginFlowId) }), parseLinkStatus);
  }
  listBilibiliReadOperations(workspaceId: string, connectionRef: string, signal?: AbortSignal): Promise<BilibiliOperationCatalog> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/bilibili/connections/${workId(connectionRef)}/read-operations`), { method: "GET", signal }, parseBilibiliOperationCatalog);
  }
  runBilibiliRead(workspaceId: string, connectionRef: string, operationId: BilibiliReadOperationId, args: Record<string, unknown>): Promise<unknown> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/bilibili/connections/${workId(connectionRef)}/reads/${workId(operationId)}`), jsonRequest("POST", { arguments: args }), parseIdentity);
  }
  runBilibiliWrite(workspaceId: string, connectionRef: string, operationId: BilibiliWriteOperationId, input: { idempotencyKey: string; arguments: Record<string, unknown> }): Promise<WorkOperationReceipt> {
    return this.transport.requestJson(workPath(workspaceId, `conversation-memory/bilibili/connections/${workId(connectionRef)}/writes/${workId(operationId)}`), jsonRequest("POST", { arguments: input.arguments }, input.idempotencyKey), parseOperationReceipt);
  }
  /** Read an existing Bilibili receipt by key without dispatching another provider operation. */
  getBilibiliOperationByIdempotencyKey(workspaceId: string, idempotencyKey: string, signal?: AbortSignal): Promise<WorkOperationReceipt> {
    if (!/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new NavigatorContractError("Invalid Bilibili operation idempotency key.");
    return this.transport.requestJson(
      workPath(workspaceId, "conversation-memory/bilibili/operations/by-idempotency-key"),
      { method: "GET", headers: { "Idempotency-Key": idempotencyKey }, signal },
      parseOperationReceipt,
    ).then((receipt) => {
      if (receipt.duplicate !== true || receipt.operation.idempotencyKey !== idempotencyKey) {
        throw new NavigatorContractError("Navigator returned a receipt outside the requested idempotency key.");
      }
      return receipt;
    });
  }

  getWorkOperation(workspaceId: string, operationId: string, signal?: AbortSignal): Promise<WorkOperationReceipt> {
    return this.transport.requestJson(workPath(workspaceId, `operations/${workId(operationId)}`), { method: "GET", signal }, parseOperationReceipt);
  }

  createActorBackup(workspaceId: string): Promise<ActorBackupAttachment> {
    const parse: ResponseParser<ActorBackupAttachment> = (value) => {
      const row = requireRecord(value, "actor backup receipt");
      return { attachment: parseAttachment(row["attachment"]), downloadPath: requireString(row, "downloadPath", "actor backup receipt") };
    };
    return this.transport.requestJson(workPath(workspaceId, "conversation-memory/backups"), jsonRequest("POST", {}, true), parse).then((value) => {
      if (value.attachment.workspaceId !== workspaceId) throw new NavigatorContractError("Navigator returned a backup attachment outside the selected workspace.");
      return value;
    });
  }

  downloadMediaAsset(workspaceId: string, assetId: string, downloadPath: string, expectedDigest: string): Promise<Blob> {
    const expectedPrefix = `${workPath(workspaceId, `conversation-memory/media/assets/${workId(assetId)}`)}/attachment`;
    return this.downloadPrivateArtifact(downloadPath, expectedPrefix, expectedDigest);
  }

  downloadActorBackup(workspaceId: string, downloadPath: string, expectedDigest: string): Promise<Blob> {
    const expectedPrefix = workPath(workspaceId, `conversation-memory/backups/attachments/${expectedDigest}`);
    return this.downloadPrivateArtifact(downloadPath, expectedPrefix, expectedDigest);
  }

  private async downloadPrivateArtifact(downloadPath: string, expectedPath: string, expectedDigest: string): Promise<Blob> {
    if (downloadPath !== expectedPath || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new NavigatorContractError("Navigator returned an invalid private artifact path.");
    const response = await this.transport.requestResponse(downloadPath, { method: "GET" });
    if (!response.ok) {
      let problem: unknown;
      try { problem = await response.json(); } catch { problem = undefined; }
      throw toHttpError(response.status, problem);
    }
    const advertisedDigest = response.headers.get("X-Content-SHA256");
    if (advertisedDigest !== expectedDigest) throw new NavigatorContractError("Private artifact digest header did not match its record.");
    const data = await response.arrayBuffer();
    if (data.byteLength > 10_000_000) throw new NavigatorContractError("Private artifact exceeded the 10 MB download bound.");
    if (!globalThis.crypto?.subtle) throw new NavigatorContractError("This browser cannot verify the private artifact digest.");
    const actualDigest = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (actualDigest !== expectedDigest) throw new NavigatorContractError("Private artifact bytes did not match the recorded SHA-256 digest.");
    return new Blob([data], { type: response.headers.get("Content-Type") ?? "application/octet-stream" });
  }
}
