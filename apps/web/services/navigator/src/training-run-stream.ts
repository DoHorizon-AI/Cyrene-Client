// Role: Read durable Yield events and reconnect from the last accepted sequence.
// 中文：读取 Yield 持久事件，并从最后已接受的序号恢复连接。

import { NavigatorContractError, NavigatorHttpError, type JsonRecord } from "./api";

export type TrainingStreamState = "connecting" | "connected" | "reconnecting" | "offline" | "finished" | "error";

export interface TrainingStreamOptions {
  runId: string;
  signal: AbortSignal;
  open: (cursor: number, signal: AbortSignal) => Promise<Response>;
  onEvent: (event: JsonRecord) => void;
  onState: (state: TrainingStreamState, error?: unknown) => void;
  onConnected?: () => void;
  onDone?: () => void;
}

const MAX_FRAME_CHARACTERS = 1_048_576;
const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

/** Parse complete SSE frames; never advance a cursor for a partial or foreign event.
 * 中文：只解析完整 SSE 帧；不为截断事件或其他任务的事件推进游标。
 */
export async function readTrainingEvents(
  response: Response,
  runId: string,
  initialCursor: number,
  signal: AbortSignal,
  accept: (event: JsonRecord) => void,
): Promise<{ cursor: number; terminal: boolean }> {
  if (!response.body) throw new NavigatorContractError("Yield returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", eventKind = "", eventId = "", data: string[] = [], frameSize = 0;
  let cursor = initialCursor;
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
        // A CRLF may be split between transport chunks.
        // 中文：CRLF 可以分布在两个传输块中。
        if (!chunk.done && buffer[newline] === "\r" && newline === buffer.length - 1) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer[newline] === "\r" && buffer[newline + 1] === "\n" ? 2 : 1));
        frameSize += line.length;
        if (frameSize > MAX_FRAME_CHARACTERS) throw new NavigatorContractError("Training event exceeds the frame limit.");
        if (line === "") {
          if (data.length > 0) {
            let value: unknown;
            try { value = JSON.parse(data.join("\n")) as unknown; }
            catch { throw new NavigatorContractError("Yield returned an invalid training event."); }
            if (!isRecord(value) || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0 ||
              !/^\d+$/.test(eventId) || Number(eventId) !== value.sequence) {
              throw new NavigatorContractError("Yield returned an invalid event sequence.");
            }
            const sequence = Number(value.sequence);
            if (eventKind === "done") {
              if (sequence !== cursor || !TERMINAL_STATES.has(String(value.state))) {
                throw new NavigatorContractError("Yield returned an inconsistent stream completion.");
              }
              return { cursor, terminal: true };
            }
            if (value.trainingRunId !== runId || sequence < 1 || value.kind !== eventKind) {
              throw new NavigatorContractError("Yield returned an event for a different run or event kind.");
            }
            if (sequence > cursor) {
              accept(value);
              cursor = sequence;
            }
          }
          eventKind = ""; eventId = ""; data = []; frameSize = 0;
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") eventKind = value;
        else if (field === "id") eventId = value;
        else if (field === "data") data.push(value);
      }
      if (buffer.length + frameSize > MAX_FRAME_CHARACTERS) {
        throw new NavigatorContractError("Training event exceeds the frame limit.");
      }
      if (chunk.done) return { cursor, terminal: false };
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Observe without submitting work; reconnecting uses only authenticated reads.
 * 中文：观察过程不提交任务；重连只执行经过认证的读取请求。
 */
export async function watchTrainingEvents(options: TrainingStreamOptions): Promise<void> {
  let cursor = 0, failures = 0;
  while (!options.signal.aborted) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline) {
      options.onState("offline");
      await waitForRetry(30_000, options.signal);
      continue;
    }
    options.onState(failures ? "reconnecting" : "connecting");
    const connection = new AbortController();
    const abort = () => connection.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    // Quiet runs have no SSE heartbeat. Periodic reconnect also refreshes authorization.
    // 中文：空闲任务没有 SSE 心跳；定期重连也会重新检查授权。
    const timeout = setTimeout(() => connection.abort(), 45_000);
    const before = cursor;
    try {
      const response = await options.open(cursor, connection.signal);
      options.signal.throwIfAborted();
      options.onState("connected");
      options.onConnected?.();
      const result = await readTrainingEvents(response, options.runId, cursor, connection.signal, (event) => {
        options.onEvent(event);
        // Retain progress even if the stream throws after some complete frames.
        // 中文：完整帧后的读取失败不能丢失已经消费的游标。
        cursor = Number(event.sequence);
      });
      if (result.terminal) {
        options.onState("finished");
        options.onDone?.();
        return;
      }
    } catch (error) {
      if (options.signal.aborted) return;
      if (!isRetryableTrainingRead(error) && !connection.signal.aborted) {
        options.onState("error", error);
        return;
      }
    } finally {
      clearTimeout(timeout);
      connection.abort();
      options.signal.removeEventListener("abort", abort);
    }
    if (options.signal.aborted) return;
    failures = cursor > before ? 1 : Math.min(failures + 1, 6);
    options.onState("reconnecting");
    await waitForRetry(Math.min(30_000, 1000 * 2 ** (failures - 1)), options.signal);
  }
}

export function isRetryableTrainingRead(error: unknown): boolean {
  if (error instanceof NavigatorContractError) return false;
  if (error instanceof NavigatorHttpError) return error.status >= 500 || [408, 429].includes(error.status);
  return true;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      globalThis.removeEventListener?.("online", finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
    globalThis.addEventListener?.("online", finish, { once: true });
  });
}
