import type { WorkApproval, WorkInput, MemoryFact, WorkNotification, WorkAttachment, WorkConnector, QqConnectorHealth, QqLoginChallenge, QqLoginState } from "../types";
import { NavigatorContractError } from "../errors";
import { requireRecord, requireArray, requireString, requireNumber, requireBoolean, readString, readBoolean, readNullableString, isRecord } from "./validation";

export function parseApprovalList(value: unknown): WorkApproval[] {
  // The Work API publishes list[ApprovalRecord]. Accept the old fixture
  // envelope as well while existing clients move to the real wire format.
  if (Array.isArray(value)) return value.map(parseApproval);
  const record = requireRecord(value, "approval list");
  return requireArray(record.items, "approvals").map(parseApproval);
}

export function parseApproval(value: unknown): WorkApproval {
  const record = requireRecord(value, "approval");
  const status = requireString(record, "status", "approval");
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    throw new NavigatorContractError("Navigator returned an unknown approval status.");
  }
  return {
    ...record,
    id: requireString(record, "id", "approval"),
    taskId: requireString(record, "taskId", "approval"),
    kind: requireString(record, "kind", "approval"),
    summary: requireString(record, "summary", "approval"),
    details: isRecord(record.details) ? record.details : {},
    status,
  };
}

export function parseWorkInputList(value: unknown): WorkInput[] {
  const record = requireRecord(value, "user-input list");
  return requireArray(record.items, "user-input requests").map(parseWorkInput);
}

export function parseWorkInput(value: unknown): WorkInput {
  const record = requireRecord(value, "user-input request");
  const status = requireString(record, "status", "user-input request");
  if (status !== "pending" && status !== "answered") {
    throw new NavigatorContractError("Navigator returned an unknown user-input status.");
  }
  return {
    ...record,
    id: requireString(record, "id", "user-input request"),
    taskId: requireString(record, "taskId", "user-input request"),
    summary: requireString(record, "summary", "user-input request"),
    details: isRecord(record.details) ? record.details : {},
    status,
    createdAt: requireNumber(record, "createdAt", "user-input request"),
    answeredAt: typeof record.answeredAt === "number" ? record.answeredAt : null,
    answeredBy: readNullableString(record, "answeredBy"),
    ...(isRecord(record.answer) ? { answer: record.answer } : {}),
    ...(typeof record.messageId === "string" ? { messageId: record.messageId } : {}),
  };
}

export function parseMemoryFacts(value: unknown): MemoryFact[] {
  const record = requireRecord(value, "memory facts");
  return requireArray(record.items, "memory facts").map(parseMemoryFact);
}

export function parseMemoryFact(value: unknown): MemoryFact {
  const record = requireRecord(value, "memory fact");
  return {
    ...record,
    id: requireString(record, "id", "memory fact"),
    namespace: requireString(record, "namespace", "memory fact"),
    key: requireString(record, "key", "memory fact"),
    value: isRecord(record.value) ? record.value : {},
    observedAt: requireNumber(record, "observedAt", "memory fact"),
    freshUntil: typeof record.freshUntil === "number" ? record.freshUntil : null,
    missing: requireBoolean(record, "missing", "memory fact"),
    stale: requireBoolean(record, "stale", "memory fact"),
    sourceId: readNullableString(record, "sourceId"),
  };
}

export function parseNotificationList(value: unknown): WorkNotification[] {
  const record = requireRecord(value, "notifications");
  return requireArray(record.items, "notifications").map((value) => {
    const notification = requireRecord(value, "notification");
    const status = requireString(notification, "status", "notification");
    const statuses: WorkNotification["status"][] = ["queued", "leased", "started", "uncertain", "delivered", "failed"];
    if (!statuses.includes(status as WorkNotification["status"])) throw new NavigatorContractError("Navigator returned an unknown notification status.");
    return {
      ...notification,
      id: requireString(notification, "id", "notification"),
      type: requireString(notification, "type", "notification"),
      status: status as WorkNotification["status"],
      payload: isRecord(notification.payload) ? notification.payload : {},
      createdAt: requireNumber(notification, "createdAt", "notification"),
    };
  });
}

export function parseAttachment(value: unknown): WorkAttachment {
  const record = requireRecord(value, "attachment");
  return {
    ...record,
    id: requireString(record, "id", "attachment"),
    sha256: requireString(record, "sha256", "attachment"),
    name: requireString(record, "name", "attachment"),
    mediaType: requireString(record, "mediaType", "attachment"),
    size: requireNumber(record, "size", "attachment"),
    createdAt: requireNumber(record, "createdAt", "attachment"),
  };
}

export function parseConnectorList(value: unknown): WorkConnector[] {
  const record = requireRecord(value, "connector list");
  return requireArray(record.items, "connectors").map((value) => {
    const connector = requireRecord(value, "connector");
    const status = requireString(connector, "status", "connector");
    const statuses: WorkConnector["status"][] = ["unknown", "disconnected", "authenticating", "login_required", "connected", "degraded", "error"];
    if (!statuses.includes(status as WorkConnector["status"])) throw new NavigatorContractError("Navigator returned an unknown connector status.");
    return {
      ...connector,
      connectorId: requireString(connector, "connectorId", "connector"),
      status: status as WorkConnector["status"],
      ...(typeof connector.configured === "boolean" ? { configured: connector.configured } : {}),
      accountId: readNullableString(connector, "accountId"),
      detail: readNullableString(connector, "detail"),
      updatedAt: requireNumber(connector, "updatedAt", "connector"),
      lastEventAt: typeof connector.lastEventAt === "number" ? connector.lastEventAt : null,
    };
  });
}

export function parseQqHealth(value: unknown): QqConnectorHealth {
  const record = requireRecord(value, "QQ connector health");
  return {
    ...record,
    status: readString(record, "status", "UNKNOWN"),
    hostState: readString(record, "hostState", readString(record, "host_state", "UNKNOWN")),
    apiReady: readBoolean(record, "apiReady", readBoolean(record, "api_ready", false)),
    accountConfirmed: readBoolean(record, "accountConfirmed", readBoolean(record, "dedicated_account_confirmed", readBoolean(record, "account_confirmed", false))),
    generation: typeof record.generation === "number" ? record.generation : null,
    clientVersion: typeof record.clientVersion === "string" ? record.clientVersion : typeof record.client_version === "string" ? record.client_version : null,
    hostAbi: typeof record.hostAbi === "string" ? record.hostAbi : typeof record.host_abi === "string" ? record.host_abi : null,
    failureCode: typeof record.failureCode === "string" ? record.failureCode : typeof record.failure_code === "string" ? record.failure_code : null,
  };
}

export function parseQqLoginChallenge(value: unknown): QqLoginChallenge {
  const record = requireRecord(value, "QQ login challenge");
  const payload = isRecord(record.result) ? record.result : record;
  const qrPayload = readString(payload, "qrPayload", readString(payload, "qr_payload", ""));
  const expiresAtUtc = readString(payload, "expiresAtUtc", readString(payload, "expires_at_utc", ""));
  const loginId = readString(payload, "loginId", readString(payload, "login_id", ""));
  const expiry = Date.parse(expiresAtUtc);
  if (!loginId || !qrPayload || qrPayload.length > 4096 || /[\u0000-\u001f\u007f]/.test(qrPayload) ||
      !/(?:Z|\+00:00)$/i.test(expiresAtUtc) || !Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new NavigatorContractError("Navigator returned an invalid or expired QQ login QR.");
  }
  const state = parseQqLoginStatus(payload.state);
  return {
    loginId,
    qrPayload,
    expiresAtUtc,
    state,
    ...(state === "authorized" && typeof (payload.accountId ?? payload.account_id) === "string"
      ? { accountId: String(payload.accountId ?? payload.account_id) }
      : {}),
  };
}

export function parseQqLoginState(value: unknown): QqLoginState {
  const record = requireRecord(value, "QQ login state");
  const payload = isRecord(record.result) ? record.result : isRecord(record.payload) ? record.payload : record;
  const loginId = readString(payload, "loginId", readString(payload, "login_id", ""));
  if (!loginId) throw new NavigatorContractError("Navigator returned an invalid QQ login id.");
  const state = parseQqLoginStatus(payload.state);
  return {
    loginId,
    state,
    ...(state === "authorized" && typeof (payload.accountId ?? payload.account_id) === "string"
      ? { accountId: String(payload.accountId ?? payload.account_id) }
      : {}),
  };
}

export function parseQqLoginStatus(value: unknown): QqLoginChallenge["state"] {
  if (value === "pending" || value === "scanned" || value === "authorized" || value === "expired" || value === "failed") return value;
  throw new NavigatorContractError("Navigator returned an unknown QQ login state.");
}
