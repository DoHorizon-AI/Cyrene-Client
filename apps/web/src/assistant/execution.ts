import type {
  AssistantExecution,
  NavigatorTaskRecord,
} from "../../services/navigator/src/api";

export function executionFor(
  task?: NavigatorTaskRecord,
): Partial<AssistantExecution> & { providerId?: string } {
  const navigator = task?.metadata.navigator;
  const owned =
    navigator && typeof navigator === "object" && !Array.isArray(navigator)
      ? (navigator as Record<string, unknown>)
      : {};
  const value = owned.execution ?? task?.execution ?? task?.metadata.execution;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<AssistantExecution>)
    : {};
}
