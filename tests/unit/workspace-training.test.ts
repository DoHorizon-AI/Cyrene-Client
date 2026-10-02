// Role: Verify private run observation stays on the authorized Workspace transport.
// 中文：验证私有任务观察始终通过已授权的 Workspace 传输。

import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTrainingClient } from "../../apps/web/src/products/workspace-training-api";
import { WorkspaceBffClient } from "../../apps/web/src/services/workspace-bff-client";
import { readTrainingEvents } from "../../apps/web/services/navigator/src/training-run-stream";

const runId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const scope = { organizationId: "org", workspaceId: "ws", trainingRunId: runId };
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

async function fixture(invoke: (operation: string, body: Record<string, unknown>) => unknown) {
  const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const bff = new WorkspaceBffClient({ enabled: true, fetcher: async (input, init) => {
    const path = String(input);
    if (path === "/api/workspace/v1/session") return response({ issuer: "https://issuer.example", subject: "alice", organizationId: "org", expiresAt: new Date(Date.now() + 120_000).toISOString(), csrfToken: `v1.123.${"a".repeat(40)}` });
    if (path === "/api/workspace/v1/workspaces") return response({ workspaces: [{ workspaceId: "ws", organizationId: "org", displayName: "Remote" }] });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path, body });
    return response(invoke(String(body.operationId), body));
  } });
  await bff.discoverWorkspaces();
  return { api: new WorkspaceTrainingClient(bff, "ws", "org"), calls };
}

afterEach(() => vi.useRealTimers());

describe("Workspace training", () => {
  it("drains terminal event pages with the exact cursor using only generic v2 invocations", async () => {
    const cursors: number[] = [];
    const { api, calls } = await fixture((operation, envelope) => {
      expect(operation).toBe("workspaceListRunEvents");
      expect(envelope.resourceId).toBe(runId);
      const body = JSON.parse(atob(String(envelope.jsonBody))) as { afterSequence: number; limit: number };
      cursors.push(body.afterSequence);
      expect(body.limit).toBe(100);
      const events = body.afterSequence < 2 ? [{ sequence: body.afterSequence + 1, trainingRunId: runId, kind: "metrics", loss: 0.1 }] : [];
      return { ...scope, events, afterSequence: body.afterSequence, nextSequence: events.at(-1)?.sequence ?? body.afterSequence, terminal: true, state: "COMPLETED" };
    });
    const signal = new AbortController().signal;
    const values: number[] = [];
    const result = await readTrainingEvents(await api.openTrainingRunEvents(runId, 0, signal), runId, 0, signal, (event) => values.push(Number(event.sequence)));
    expect(result).toEqual({ cursor: 2, terminal: true });
    expect(values).toEqual([1, 2]);
    expect(cursors).toEqual([0, 1, 2]);
    expect(calls.every((call) => call.path === "/api/workspace/v2/workspaces/ws/products/invocations")).toBe(true);
  });

  it("waits after an empty live page and later observes completion", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const { api } = await fixture(() => ({ ...scope, events: [], afterSequence: 0, nextSequence: 0, terminal: ++reads > 1, state: reads > 1 ? "COMPLETED" : "RUNNING" }));
    const signal = new AbortController().signal;
    const task = readTrainingEvents(await api.openTrainingRunEvents(runId, 0, signal), runId, 0, signal, () => undefined);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await task).toEqual({ cursor: 0, terminal: true });
    expect(reads).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects foreign workspace/run projections before showing their data", async () => {
    const { api } = await fixture(() => ({ ...scope, id: runId, state: "RUNNING", workspaceId: "another-workspace" }));
    await expect(api.getTrainingRun(runId)).rejects.toMatchObject({ name: "NavigatorContractError" });
    const foreign = await fixture(() => ({ ...scope, attempts: [{ trainingRunId: draftId }] }));
    await expect(foreign.api.getTrainingRunAttempts(runId)).rejects.toMatchObject({ name: "NavigatorContractError" });
  });

  it("rejects foreign events and inconsistent cursor progress", async () => {
    const { api } = await fixture(() => ({ ...scope, events: [{ sequence: 1, trainingRunId: draftId, kind: "log" }], afterSequence: 0, nextSequence: 1, terminal: true, state: "COMPLETED" }));
    const signal = new AbortController().signal;
    await expect(readTrainingEvents(await api.openTrainingRunEvents(runId, 0, signal), runId, 0, signal, () => undefined))
      .rejects.toMatchObject({ name: "NavigatorContractError" });
  });

  it("reads the durable draft association before start and keeps a stable command key", async () => {
    const { api, calls } = await fixture((operation) => operation === "workspaceGetDraft"
      ? { id: draftId, state: "PREPARED" }
      : { id: runId, draftId });
    expect(await api.startDraft(draftId, "explicit-start-key")).toBe(runId);
    expect(calls.map((call) => call.body?.operationId)).toEqual(["workspaceGetDraft", "workspaceStartRun"]);
    expect(calls[1]?.body?.idempotencyKey).toBe("explicit-start-key");
    expect(calls[1]?.body).not.toHaveProperty("jsonBody");
    const existing = await fixture(() => ({ id: draftId, state: "STARTED", trainingRunId: runId }));
    expect(await existing.api.startDraft(draftId, "retry-key")).toBe(runId);
    expect(existing.calls).toHaveLength(1);
    expect(api.capabilities).toEqual({ cancel: false, resume: false, deploy: false });
  });
});
