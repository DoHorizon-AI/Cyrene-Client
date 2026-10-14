// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 integration-notification-feed.ts                                 │
// │  Module: apps/web/src/products                                      │
// │  Role: Recover and deduplicate the actor-scoped Exchange feed by     │
// │        server sequence across SSE reconnects and offline periods.    │
// │                                                                      │
// │  模块职责：按服务端序号恢复通知，并在 SSE 重连时去重。                   │
// │  · 首次列表只填充页面，不发送旧通知的浏览器提示                          │
// │  · 后续恢复事件与新事件复用同一序号游标                                 │
// └─────────────────────────────────────────────────────────────────────┘

import { IntegrationApiError, parseIntegrationNotification, type IntegrationNotification, type NotificationPage } from "./integrations-client";

/** Minimal authenticated endpoint surface required by the feed loop. */
export interface NotificationFeedApi {
  listNotifications(after: number, signal?: AbortSignal): Promise<NotificationPage>;
  openNotificationEvents(after: number, signal: AbortSignal): Promise<Response>;
}

/** Tells the page whether a new event may create a native notification. */
export interface NotificationDeliveryHint {
  /** Browser notification is allowed only for events arriving after the first durable snapshot. */
  readonly showBrowserNotification: boolean;
}

/** Dependencies and callbacks for one page-scoped feed subscription. */
export interface NotificationFeedOptions {
  api: NotificationFeedApi;
  signal: AbortSignal;
  onNotification(notification: IntegrationNotification, hint: NotificationDeliveryHint): void;
  onSnapshot?(): void;
  onError?(error: unknown): void;
  reconnectDelayMs?: number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

/** Keeps one cursor for both SSE IDs and the durable list, dropping replayed IDs and sequences. */
export class NotificationDeduplicator {
  private readonly ids = new Set<string>();
  private readonly sequences = new Set<number>();
  private lastSequence = 0;

  get cursor(): number { return this.lastSequence; }

  accept(notification: IntegrationNotification): boolean {
    if (this.ids.has(notification.id) || this.sequences.has(notification.sequence)) return false;
    this.ids.add(notification.id);
    this.sequences.add(notification.sequence);
    this.lastSequence = Math.max(this.lastSequence, notification.sequence);
    return true;
  }
}

/** Recover the durable feed, stream sequenced events, and resume after offline or interrupted reads. */
export async function followIntegrationNotifications(options: NotificationFeedOptions): Promise<void> {
  const deduplicator = new NotificationDeduplicator();
  let initialSnapshot = true;
  const delay = options.sleep ?? waitForReconnect;

  while (!options.signal.aborted) {
    try {
      const page = await options.api.listNotifications(deduplicator.cursor, options.signal);
      options.onSnapshot?.();
      for (const notification of [...page.notifications].sort((left, right) => left.sequence - right.sequence)) {
        if (deduplicator.accept(notification)) options.onNotification(notification, { showBrowserNotification: !initialSnapshot });
      }
      initialSnapshot = false;
      if (options.signal.aborted) return;

      const response = await options.api.openNotificationEvents(deduplicator.cursor, options.signal);
      await readNotificationEvents(response, async notification => {
        if (notification.sequence > deduplicator.cursor + 1) {
          const recovered = await options.api.listNotifications(deduplicator.cursor, options.signal);
          for (const item of [...recovered.notifications].sort((left, right) => left.sequence - right.sequence)) {
            if (deduplicator.accept(item)) options.onNotification(item, { showBrowserNotification: true });
          }
        }
        if (deduplicator.accept(notification)) options.onNotification(notification, { showBrowserNotification: true });
      }, options.signal);
    } catch (error) {
      if (options.signal.aborted) return;
      options.onError?.(error);
    }

    if (!options.signal.aborted) await delay(options.reconnectDelayMs ?? 2000, options.signal);
  }
}

async function readNotificationEvents(
  response: Response,
  onNotification: (notification: IntegrationNotification) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (!response.body) throw new IntegrationApiError(502, "INVALID_EVENT_STREAM");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (!signal.aborted) {
      const result = await reader.read();
      pending += decoder.decode(result.value, { stream: !result.done });
      pending = pending.replace(/\r\n/g, "\n");
      if (pending.length > 65536) throw new IntegrationApiError(502, "EVENT_FRAME_TOO_LARGE");
      let boundary = pending.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        await dispatchFrame(frame, onNotification);
        boundary = pending.indexOf("\n\n");
      }
      if (result.done) {
        if (pending.trim()) await dispatchFrame(pending, onNotification);
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function dispatchFrame(
  frame: string,
  onNotification: (notification: IntegrationNotification) => Promise<void>,
): Promise<void> {
  let eventId: string | undefined;
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const rawValue = colon < 0 ? "" : line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "id") eventId = value;
    if (field === "data") data.push(value);
  }
  if (!data.length) return;
  let payload: unknown;
  try { payload = JSON.parse(data.join("\n")); }
  catch { throw new IntegrationApiError(502, "INVALID_EVENT_PAYLOAD"); }
  const notification = parseIntegrationNotification(payload);
  if (!notification) throw new IntegrationApiError(502, "INVALID_EVENT_PAYLOAD");
  if (eventId !== String(notification.sequence)) throw new IntegrationApiError(502, "EVENT_SEQUENCE_MISMATCH");
  await onNotification(notification);
}

function waitForReconnect(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
  });
}
