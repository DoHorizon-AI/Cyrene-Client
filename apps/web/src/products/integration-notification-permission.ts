// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 integration-notification-permission.ts                           │
// │  Module: apps/web/src/products                                      │
// │  Role: Keep browser notification permission behind a deliberate      │
// │        user action and report unsupported/denied states honestly.    │
// │                                                                      │
// │  模块职责：只有用户主动操作后才请求浏览器通知权限。                       │
// │  · 不因页面加载或 SSE 连接而弹出权限提示                                │
// └─────────────────────────────────────────────────────────────────────┘

/** Browser permission state plus an explicit unsupported state. */
export type BrowserNotificationPermission = NotificationPermission | "unsupported";

/** Narrow native browser notifications to the operations used by this UI. */
export interface BrowserNotificationPort {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  notify(title: string, options: { body: string; tag: string }): void;
}

/** Return the browser port without causing a permission prompt. */
export function getBrowserNotificationPort(): BrowserNotificationPort | null {
  return nativeNotificationPort();
}

/** Read current browser support without asking for permission. */
export function readBrowserNotificationPermission(port: BrowserNotificationPort | null = nativeNotificationPort()): BrowserNotificationPermission {
  return port?.permission ?? "unsupported";
}

/** Ask the browser only when the caller invokes this from an explicit user action. */
export async function requestBrowserNotificationPermission(
  port: BrowserNotificationPort | null = nativeNotificationPort(),
): Promise<BrowserNotificationPermission> {
  if (!port) return "unsupported";
  return port.requestPermission();
}

/** Send plain text through a previously granted native browser notification channel. */
export function sendBrowserNotification(
  port: BrowserNotificationPort | null,
  permission: BrowserNotificationPermission,
  title: string,
  body: string,
  tag: string,
): boolean {
  if (!port || permission !== "granted") return false;
  port.notify(title, { body, tag });
  return true;
}

function nativeNotificationPort(): BrowserNotificationPort | null {
  if (typeof globalThis.Notification === "undefined") return null;
  const notification = globalThis.Notification;
  return {
    get permission() { return notification.permission; },
    requestPermission: () => notification.requestPermission(),
    notify: (title, options) => { new notification(title, options); },
  };
}
