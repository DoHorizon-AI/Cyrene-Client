import type { NavigatorTaskRecord, NavigatorTaskPage, AssistantPermission, AssistantModel, AssistantProtocol, AssistantProvider, AssistantCapabilities, AssistantRuntime } from "../types";
import { NavigatorContractError } from "../errors";
import { requireRecord, requireArray, requireString, requireNumber, readNullableNumber, requireBoolean, readNullableString } from "./validation";

export function parseAssistantProvider(value: unknown): AssistantProvider {
  const record = requireRecord(value, "assistant provider");
  const protocol = record.protocol ?? "openai-completions";
  if (!["openai-completions", "openai-responses", "anthropic-messages"].includes(String(protocol))) throw new NavigatorContractError("Unknown API protocol.");
  return { id: requireString(record, "id", "assistant provider"), name: requireString(record, "name", "assistant provider"),
    protocol: protocol as AssistantProtocol,
    baseUrl: requireString(record, "baseUrl", "assistant provider"), configured: requireBoolean(record, "configured", "assistant provider"),
    models: requireArray(record.models, "assistant models").map(parseAssistantModel) };
}

export function parseAssistantModel(value: unknown): AssistantModel {
  const record = requireRecord(value, "assistant model");
  const efforts = requireArray(record.efforts, "model efforts");
  if (!efforts.every(value => typeof value === "string")) throw new NavigatorContractError("Invalid model efforts.");
  return { id: requireString(record, "id", "assistant model"), name: requireString(record, "name", "assistant model"),
    efforts: efforts as string[], images: record.images === true };
}

export function parseAssistantCapabilities(value: unknown): AssistantCapabilities {
  const record = requireRecord(value, "assistant capabilities");
  const permissions = new Set(["read-only", "ask", "auto", "full-access"]);
  if (record.defaultRuntime !== "harness") throw new NavigatorContractError("Unknown default assistant runtime.");
  return { defaultRuntime: "harness", workspaceId: requireString(record, "workspaceId", "assistant capabilities"), mcpConfigured: record.mcpConfigured === true,
    providers: requireArray(record.providers, "assistant providers").map(parseAssistantProvider),
    runtimes: requireArray(record.runtimes, "assistant runtimes").map(value => {
      const runtime = requireRecord(value, "assistant runtime");
      const id = requireString(runtime, "id", "assistant runtime");
      if (!["harness", "codex", "claude", "cursor", "codebuddy", "workbuddy"].includes(id)) throw new NavigatorContractError("Unknown assistant runtime.");
      const supported = requireArray(runtime.permissions, "runtime permissions");
      if (!supported.every(value => typeof value === "string" && permissions.has(value))) throw new NavigatorContractError("Unknown runtime permission.");
      return { id: id as AssistantRuntime["id"], name: requireString(runtime, "name", "assistant runtime"),
        available: requireBoolean(runtime, "available", "assistant runtime"), resume: requireBoolean(runtime, "resume", "assistant runtime"),
        ...(typeof runtime.reason === "string" ? { reason: runtime.reason } : {}),
        permissions: supported as AssistantPermission[], models: requireArray(runtime.models, "runtime models").map(parseAssistantModel),
        approvalScopes: Array.isArray(runtime.approvalScopes)
          ? runtime.approvalScopes.filter((scope): scope is "once" | "task" => scope === "once" || scope === "task") : ["once"] };
    }) };
}

export function parseTaskRecord(value: unknown): NavigatorTaskRecord {
  const record = requireRecord(value, "assistant task");
  const metadata = requireRecord(record.metadata, "assistant task metadata");
  const status = requireString(record, "status", "assistant task");
  const statuses: NavigatorTaskRecord["status"][] = ["queued", "running", "completed", "failed", "aborted", "waiting_approval", "waiting_input"];
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
