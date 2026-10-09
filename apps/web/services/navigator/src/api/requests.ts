import type { SessionPayload, ResponseParser } from "./types";
import { NavigatorHttpError, NavigatorContractError } from "./errors";
import { readString, readBoolean, isRecord } from "./parsers/validation";

/**
 * Create a JSON request and an idempotency key for a Product mutation.
 * 中文：为 Product mutation 创建 JSON 请求和幂等键。
 */
export function jsonRequest(method: string, body: unknown, idempotent: boolean | string = false): RequestInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotent) {
    headers["Idempotency-Key"] = typeof idempotent === "string" ? idempotent : makeIdempotencyKey();
  }
  return { method, headers, body: JSON.stringify(body) };
}

/** Keep one key for each explicit command and its retries. 中文：每次显式命令及其重试使用同一幂等键。 */
export function makeIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `navigator-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function workId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,511}$/.test(normalized) || normalized.includes("..")) {
    throw new NavigatorContractError("Invalid workspace resource identifier.");
  }
  return normalized;
}

export function workPath(workspaceId: string, suffix: string): string {
  return `/api/v1/workspaces/${workId(workspaceId)}/work/${suffix}`;
}

/** Reject absolute URLs and ambiguous encoded paths before Product proxy dispatch. */
export function isPublishedProductPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://") || path.includes("\\")) return false;
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  if (!/^\/api\/v1\/(?:catalyst|echo)\//.test(pathname)) return false;
  if (/%(?:2f|5c|2e|25|00)/i.test(pathname) || pathname.split("/").includes("..")) return false;
  return true;
}

export async function readResponse<T>(
  response: Response,
  path: string,
  parser: ResponseParser<T>,
  acceptSession: (payload: SessionPayload) => void,
): Promise<T> {
  const text = await response.text();
  const body: unknown = text ? parseJson(text, path) : undefined;
  if (!response.ok) {
    throw toHttpError(response.status, body);
  }
  const parsed = parser(body);
  if (isSessionPayload(parsed)) {
    acceptSession(parsed);
  }
  return parsed;
}

export function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new NavigatorContractError(`Navigator returned non-JSON data for ${path}.`);
  }
}

export function toHttpError(status: number, body: unknown): NavigatorHttpError {
  const record = isRecord(body) ? body : {};
  return new NavigatorHttpError(
    status,
    readString(record, "code", `HTTP_${status}`),
    readString(record, "detail", `Navigator request failed with HTTP ${status}.`),
    readBoolean(record, "retryable", status >= 500),
  );
}

export function isSessionPayload(value: unknown): value is SessionPayload {
  return isRecord(value) && (value.state === "AUTHENTICATED" || value.state === "ANONYMOUS");
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const prefix = `${name}=`;
  const cookie = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}
