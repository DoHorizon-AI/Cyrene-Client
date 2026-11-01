// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-turn API                            │
// │ Role: Admit private Web turns and read their owned Task/SSE receipts.│
// │ 中文：模块职责：提交私有 Web 对话轮次并读取任务与 SSE 回执。        │
// └─────────────────────────────────────────────────────────────────────┘

import type { NavigatorTransport } from "./transport";
import type { NavigatorTaskRecord } from "./types";
import { NavigatorContractError, NavigatorHttpError } from "./errors";
import { requireRecord, requireString } from "./parsers/validation";
import { parseTaskRecord } from "./parsers/assistant";
import { jsonRequest, toHttpError } from "./requests";

export interface ConversationTurnAdmission {
  conversationId: string;
  taskId: string;
  sessionId: string;
  status: NavigatorTaskRecord["status"];
  eventsUrl: string;
  statusUrl: string;
}

const TURN_PATH = "/api/v1/conversation-assistant/turns";
const TASK_STATUSES = new Set<NavigatorTaskRecord["status"]>([
  "queued", "running", "completed", "failed", "aborted", "waiting_approval", "waiting_input", "awaiting_user_authorization",
]);

function taskEventPath(taskId: string): string {
  return `/api/v1/tasks/${encodeURIComponent(taskId)}/events`;
}

function taskStatusPath(taskId: string): string {
  return `/api/v1/tasks/${encodeURIComponent(taskId)}/status`;
}

function assertAdmissionLinks(admission: ConversationTurnAdmission): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,511}$/.test(admission.taskId)
    || admission.eventsUrl !== `${taskEventPath(admission.taskId)}?after=0`
    || admission.statusUrl !== taskStatusPath(admission.taskId)) {
    throw new NavigatorContractError("Navigator returned an invalid conversation task link.");
  }
}

function parseAdmission(value: unknown, expectedConversationId: string): ConversationTurnAdmission {
  const row = requireRecord(value, "conversation turn admission");
  const conversationId = requireString(row, "conversationId", "conversation turn admission");
  const taskId = requireString(row, "taskId", "conversation turn admission");
  const status = requireString(row, "status", "conversation turn admission");
  if (conversationId !== expectedConversationId || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,511}$/.test(taskId)
    || !TASK_STATUSES.has(status as NavigatorTaskRecord["status"])) {
    throw new NavigatorContractError("Navigator returned a conversation turn outside the requested scope.");
  }
  const eventsUrl = requireString(row, "eventsUrl", "conversation turn admission");
  const statusUrl = requireString(row, "statusUrl", "conversation turn admission");
  if (eventsUrl !== `${taskEventPath(taskId)}?after=0` || statusUrl !== taskStatusPath(taskId)) {
    throw new NavigatorContractError("Navigator returned an invalid conversation task link.");
  }
  return {
    conversationId,
    taskId,
    sessionId: requireString(row, "sessionId", "conversation turn admission"),
    status: status as NavigatorTaskRecord["status"],
    eventsUrl,
    statusUrl,
  };
}

async function readConversationTurnJson<T>(response: Response, path: string, parser: (value: unknown) => T): Promise<T> {
  let value: unknown;
  try { value = await response.json() as unknown; }
  catch { throw new NavigatorContractError(`Navigator returned non-JSON data for ${path}.`); }
  if (!response.ok) {
    const row = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const detail = typeof row["error"] === "string" ? row["error"] : typeof row["detail"] === "string" ? row["detail"] : `Conversation turn request failed with HTTP ${response.status}.`;
    throw new NavigatorHttpError(response.status, typeof row["code"] === "string" ? row["code"] : `HTTP_${response.status}`, detail, response.status >= 500);
  }
  return parser(value);
}

/** Same-origin adapter for the trusted, direct/private conversation ingress. */
export class ConversationTurnsApi {
  constructor(private readonly transport: NavigatorTransport) {}

  async submitTurn(input: { conversationId: string; text: string; idempotencyKey: string }): Promise<ConversationTurnAdmission> {
    const conversationId = input.conversationId.trim();
    const text = input.text.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(conversationId)) {
      throw new NavigatorContractError("Conversation ID must be 1–200 ASCII letters, digits, dot, underscore, colon, or hyphen.");
    }
    if (!text || text.length > 20_000) throw new NavigatorContractError("Conversation text must contain 1–20,000 characters.");
    if (!/^[\x21-\x7e]{1,200}$/.test(input.idempotencyKey)) throw new NavigatorContractError("Conversation turn idempotency key is invalid.");
    const response = await this.transport.requestResponse(TURN_PATH, jsonRequest("POST", { conversationId, text }, input.idempotencyKey));
    return readConversationTurnJson(response, TURN_PATH, (value) => parseAdmission(value, conversationId));
  }

  async getTask(admission: ConversationTurnAdmission, signal?: AbortSignal): Promise<NavigatorTaskRecord> {
    assertAdmissionLinks(admission);
    const response = await this.transport.requestResponse(admission.statusUrl, { method: "GET", signal });
    return readConversationTurnJson(response, admission.statusUrl, parseTaskRecord);
  }

  async openTaskEvents(admission: ConversationTurnAdmission, afterSequence: number, signal: AbortSignal): Promise<Response> {
    assertAdmissionLinks(admission);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new NavigatorContractError("Invalid conversation task event cursor.");
    const path = `${taskEventPath(admission.taskId)}?after=${afterSequence}`;
    const response = await this.transport.requestResponse(path, {
      method: "GET", signal,
      headers: { Accept: "text/event-stream", "Last-Event-ID": String(afterSequence) },
    });
    if (!response.ok) {
      let body: unknown;
      try { body = await response.json() as unknown; } catch { body = undefined; }
      if (typeof body === "object" && body !== null && !Array.isArray(body) && typeof (body as Record<string, unknown>)["error"] === "string") {
        const row = body as Record<string, unknown>;
        throw new NavigatorHttpError(response.status, typeof row["code"] === "string" ? row["code"] : `HTTP_${response.status}`, row["error"] as string, response.status >= 500);
      }
      throw toHttpError(response.status, body);
    }
    if (!response.body || response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/event-stream") {
      await response.body?.cancel();
      throw new NavigatorContractError("Navigator did not return a conversation task event stream.");
    }
    return response;
  }
}
