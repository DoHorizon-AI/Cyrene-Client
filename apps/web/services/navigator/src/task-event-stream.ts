// -----------------------------------------------------------------------------
// Module: src/task-event-stream.ts
// Role: Read sequenced assistant task events from the paired Navigator host.
// 中文：模块职责：读取配对 Navigator 主机发出的有序助手任务事件。
// -----------------------------------------------------------------------------

import { NavigatorContractError, type JsonRecord, type NavigatorTaskEvent } from "./api";

const MAX_FRAME_CHARACTERS = 1_048_576;
const SAFE_TASK_EVENT_TYPES = new Set([
  "task.aborted",
  "task.cancel_requested",
  "task.completed",
  "task.created",
  "task.failed",
  "task.output",
  "task.reasoning",
  "task.status_changed",
  "task.waiting_approval",
  "task.waiting_input",
]);
const SAFE_TASK_STATUSES = new Set(["queued", "running", "completed", "failed", "aborted", "waiting_approval", "waiting_input"]);

/**
 * Consume complete, sequenced SSE frames and ignore replayed event IDs.
 * 中文：只消费完整且带序号的 SSE 帧，并忽略已读取的重复事件。
 */
export async function readAssistantTaskEvents(
  response: Response,
  initialCursor: number,
  signal: AbortSignal,
  accept: (event: NavigatorTaskEvent) => void,
): Promise<number> {
  if (!response.body) throw new NavigatorContractError("Navigator returned an empty assistant task stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", eventName = "", eventId = "", data: string[] = [], frameSize = 0, cursor = initialCursor;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let newline: number;
      while ((newline = buffer.search(/[\r\n]/)) >= 0) {
        if (!chunk.done && buffer[newline] === "\r" && newline === buffer.length - 1) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer[newline] === "\r" && buffer[newline + 1] === "\n" ? 2 : 1));
        frameSize += line.length;
        if (frameSize > MAX_FRAME_CHARACTERS) throw new NavigatorContractError("Assistant task event exceeds the frame limit.");
        if (line === "") {
          if (data.length) {
            const sequence = Number(eventId);
            let value: unknown;
            try { value = JSON.parse(data.join("\n")) as unknown; }
            catch { throw new NavigatorContractError("Navigator returned an invalid assistant task event."); }
            if (!Number.isSafeInteger(sequence) || sequence < 1 || !eventName || !isRecord(value)) {
              throw new NavigatorContractError("Navigator returned an invalid assistant task event sequence.");
            }
            if (sequence > cursor) {
              accept({ sequence, name: eventName, data: value });
              cursor = sequence;
            }
          }
          eventName = ""; eventId = ""; data = []; frameSize = 0;
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") eventName = value;
        else if (field === "id") eventId = value;
        else if (field === "data") data.push(value);
      }
      if (buffer.length + frameSize > MAX_FRAME_CHARACTERS) throw new NavigatorContractError("Assistant task event exceeds the frame limit.");
      if (chunk.done) return cursor;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Keep task event labels limited to non-sensitive fields. 中文：仅从非敏感字段生成任务事件标签。 */
export function assistantEventLabel(event: NavigatorTaskEvent): string {
  const candidate = typeof event.data.type === "string" ? event.data.type : event.name;
  const type = SAFE_TASK_EVENT_TYPES.has(candidate) ? candidate : "task.event";
  const status = typeof event.data.status === "string" && SAFE_TASK_STATUSES.has(event.data.status) ? ` · ${event.data.status}` : "";
  return `${type}${status}`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
