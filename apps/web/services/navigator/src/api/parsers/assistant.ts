import type { NavigatorTaskRecord, NavigatorTaskPage } from "../types";
import { NavigatorContractError } from "../errors";
import { requireRecord, requireArray, requireString, requireNumber, readNullableNumber, requireBoolean, readNullableString } from "./validation";

export function parseTaskRecord(value: unknown): NavigatorTaskRecord {
  const record = requireRecord(value, "assistant task");
  const metadata = requireRecord(record.metadata, "assistant task metadata");
  const status = requireString(record, "status", "assistant task");
  const statuses: NavigatorTaskRecord["status"][] = ["queued", "running", "completed", "failed", "aborted", "waiting_approval", "waiting_input", "awaiting_user_authorization"];
  if (!statuses.includes(status as NavigatorTaskRecord["status"])) {
    throw new NavigatorContractError("Navigator returned an unknown assistant task status.");
  }
  return {
    ...record,
    id: requireString(record, "id", "assistant task"),
    workspaceId: requireString(record, "workspaceId", "assistant task"),
    sessionId: requireString(record, "sessionId", "assistant task"),
    prompt: requireString(record, "prompt", "assistant task"),
    status: status as NavigatorTaskRecord["status"],
    createdAt: requireNumber(record, "createdAt", "assistant task"),
    startedAt: readNullableNumber(record, "startedAt", "assistant task"),
    endedAt: readNullableNumber(record, "endedAt", "assistant task"),
    output: requireString(record, "output", "assistant task"),
    reasoning: requireString(record, "reasoning", "assistant task"),
    error: readNullableString(record, "error"),
    durationMs: requireNumber(record, "durationMs", "assistant task"),
    sequence: requireNumber(record, "sequence", "assistant task"),
    title: readNullableString(record, "title"),
    description: readNullableString(record, "description"),
    metadata,
  };
}

export function parseTaskPage(value: unknown): NavigatorTaskPage {
  const record = requireRecord(value, "assistant task page");
  return {
    items: requireArray(record.items, "assistant tasks").map(parseTaskRecord),
    nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : null,
  };
}

export function parseTaskCancellation(value: unknown): { taskId: string; cancelled: boolean } {
  const record = requireRecord(value, "assistant task cancellation");
  return {
    taskId: requireString(record, "taskId", "assistant task cancellation"),
    cancelled: requireBoolean(record, "cancelled", "assistant task cancellation"),
  };
}
