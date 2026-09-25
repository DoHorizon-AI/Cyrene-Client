/**
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  📄 logger.ts                                                       │
 * │  Module: @cyrene/client/logger                                      │
 * │  Role: Structured NDJSON DevTools & console error emitter.          │
 * │  模块：@cyrene/client/logger                                         │
 * │  职责：向 DevTools 与控制台输出结构化 NDJSON 错误事件。                  │
 * │                                                                     │
 * │  模块职责：Client 前端向控制台输出符合 Cyrene 规范的结构化错误日志。         │
 * └─────────────────────────────────────────────────────────────────────┘
 */

const SENSITIVE_KEYS = [
  "authorization",
  "auth",
  "token",
  "api_key",
  "apikey",
  "secret",
  "password",
  "cookie",
  "client_secret",
  "private_key",
  "pairing_code",
];

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase().replaceAll("-", "_");
  if (lower === "tokens" || lower.endsWith("_tokens") || lower === "token_count") {
    return false;
  }
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitive(k)) {
      result[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null) {
      result[k] = redact(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

const INSTANCE_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export interface LogAttributes {
  trace_id?: string;
  span_id?: string;
  [key: string]: unknown;
}

export function formatCyreneErrorLog(
  eventName: string,
  errorCode: string,
  message: string,
  attributes?: LogAttributes,
): string {
  const rawAttrs: Record<string, unknown> = {
    "error.code": errorCode,
    ...(attributes ? (redact(attributes) as Record<string, unknown>) : {}),
  };

  const record: Record<string, unknown> = {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    level: "ERROR",
    "event.name": eventName,
    "service.name": "cyrene-client",
    "service.instance.id": INSTANCE_ID,
    message,
    attributes: rawAttrs,
  };

  if (attributes?.trace_id) {
    record.trace_id = attributes.trace_id;
  }
  if (attributes?.span_id) {
    record.span_id = attributes.span_id;
  }

  return JSON.stringify(record);
}

export function logError(
  eventName: string,
  errorCode: string,
  message: string,
  attributes?: LogAttributes,
): void {
  const jsonStr = formatCyreneErrorLog(eventName, errorCode, message, attributes);
  console.error(jsonStr);
}
