import type { DeploymentEventsResponse } from "../types";
import { requireRecord, requireArray, requireString } from "./validation";

export function parseDeploymentEventsResponse(value: unknown): DeploymentEventsResponse {
  const record = requireRecord(value, "deployment events response");
  const deploymentId = String(record.deploymentId ?? record.deployment_id ?? "");
  const events = requireArray(record.events, "deployment events").map((evt) => {
    const e = requireRecord(evt, "deployment event");
    return {
      sequence: typeof e.sequence === "number" ? e.sequence : 0,
      phase: requireString(e, "phase", "event phase"),
      message: requireString(e, "message", "event message"),
      occurredAt: String(e.occurredAt ?? e.occurred_at ?? ""),
      failureCode: typeof (e.failureCode ?? e.failure_code) === "string" ? String(e.failureCode ?? e.failure_code) : null,
    };
  });
  return { deploymentId, events };
}
