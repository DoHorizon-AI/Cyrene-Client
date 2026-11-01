// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-operations API tests                 │
// │ Role: Verify owner-scoped maintenance and conversation workflows.   │
// │ 中文：模块职责：验证维护和对话工作流的所属 API。                     │
// └─────────────────────────────────────────────────────────────────────┘

import { describe, expect, it } from "vitest";
import { NavigatorApi } from "../api";

const job = {
  id: "job-1", taskId: "task-1", idempotencyKey: "job-key", kind: "dream", conversationId: "chat-1", conversationKind: "group", personaId: null,
  state: "queued", cursor: null, processedCount: 0, checkpointDigest: null, details: {}, version: 1, queuedVersion: 1, createdAt: 1000, updatedAt: 1000,
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("conversation operations Work API", () => {
  it("preserves scope when queueing and cancelling a maintenance job", async () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = [];
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input), method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path, method, body });
      if (path.endsWith("/conversation-memory/maintenance/jobs") && method === "POST") return response({ job, duplicate: false }, 201);
      if (path.endsWith("/conversation-memory/maintenance/jobs/job-1/cancel")) return response({ job: { ...job, state: "cancelled", version: 2 } });
      if (path.includes("/conversation-memory/maintenance/jobs?")) return response({ items: [job] });
      if (path.endsWith("/conversation-memory/maintenance/jobs/job-1")) return response(job);
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const queued = await api.createMaintenanceJob("workspace-1", { idempotencyKey: "job-key", kind: "dream", conversationId: "chat-1", conversationKind: "group" });
    expect(queued.job.conversationKind).toBe("group");
    expect(calls[0]?.body).toMatchObject({ idempotencyKey: "job-key", conversationId: "chat-1", conversationKind: "group" });
    expect((await api.listMaintenanceJobs("workspace-1", { state: "queued" }))[0]?.id).toBe("job-1");
    expect((await api.getMaintenanceJob("workspace-1", "job-1")).version).toBe(1);
    expect((await api.cancelMaintenanceJob("workspace-1", "job-1", 1)).job.state).toBe("cancelled");
    expect(calls.at(-1)?.body).toEqual({ expectedVersion: 1 });
  });

  it("surfaces provider failures and does not synthesize research results", async () => {
    const api = new NavigatorApi(async () => response({ code: "PORT_UNAVAILABLE", detail: "No provider is configured." }, 503));
    await expect(api.listResearchNotes("workspace-1", { conversationId: "chat-1" })).rejects.toMatchObject({ status: 503, code: "PORT_UNAVAILABLE" });
  });
});
