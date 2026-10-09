// -----------------------------------------------------------------------------
// Module: src/api.test.ts
// Role: Session rotation and same-origin Product proxy client tests.
// -----------------------------------------------------------------------------
// 中文：// 中文：模块职责：测试会话轮换与同源 Product 代理客户端。

import { NavigatorApi } from "./api";
import { describe, expect, it } from "vitest";

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("NavigatorApi", () => {
  it("serializes refresh, pair, and logout including the rotating CSRF token", async () => {
    const session = { authenticated: true, state: "AUTHENTICATED", sessionId: "session", expiresAt: null,
      refreshExpiresAt: null, refreshable: true, csrfToken: "old-csrf", refreshed: false };
    const calls: { path: string; csrf: string | null }[] = [];
    let release!: (value: Response) => void;
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input);
      calls.push({ path, csrf: new Headers(init?.headers).get("X-CSRF-Token") });
      if (path.endsWith("/refresh")) return new Promise(resolve => { release = resolve; });
      if (path.endsWith("/pair")) return response({ ...session, csrfToken: "paired-csrf" });
      if (init?.method === "DELETE") return response(undefined, 204);
      return response(session);
    });
    await api.getSession();
    const refreshing = api.refreshSession();
    await Promise.resolve();
    const pairing = api.pair("one-time-code");
    const logout = api.logout();
    await Promise.resolve();
    expect(calls.map(call => call.path)).toEqual(["/api/v1/auth/session", "/api/v1/auth/session/refresh"]);
    release(response({ ...session, csrfToken: "rotated-csrf", refreshed: true }));
    await Promise.all([refreshing, pairing, logout]);
    expect(calls.slice(2)).toEqual([
      { path: "/api/v1/auth/pair", csrf: "rotated-csrf" },
      { path: "/api/v1/auth/session", csrf: "paired-csrf" },
    ]);
    expect(api.sessionCsrfToken).toBeNull();
  });

  for (const method of ["GET", "POST"] as const) it(`does not expire a newly paired session on a late Product ${method} denial`, async () => {
    const session = { authenticated: true, state: "AUTHENTICATED", sessionId: "new-session", expiresAt: null,
      refreshExpiresAt: null, refreshable: true, csrfToken: "new-csrf", refreshed: false };
    let release!: (value: Response) => void;
    let productReads = 0, refreshes = 0, expirations = 0;
    const api = new NavigatorApi(async (input) => {
      const path = String(input);
      if (path.endsWith("/pair")) return response(session);
      if (path.endsWith("/refresh")) { refreshes++; return response({}, 401); }
      if (productReads++ === 0) return new Promise(resolve => { release = resolve; });
      return response([]);
    });
    api.setSessionExpiredHandler(() => { expirations++; });
    const pending = api.requestProductResponse("/api/v1/echo/status", { method });
    await api.pair("one-time-code");
    release(response({ detail: "old session denied" }, 401));
    expect((await pending).status).toBe(method === "GET" ? 200 : 401);
    expect(api.sessionCsrfToken).toBe("new-csrf");
    expect(refreshes).toBe(0);
    expect(expirations).toBe(0);
  });

  it("coalesces simultaneous Product denials into one refresh", async () => {
    let refreshes = 0, reads = 0;
    let release!: (value: Response) => void;
    const api = new NavigatorApi(async input => {
      if (String(input).endsWith("/refresh")) {
        refreshes++;
        return new Promise(resolve => { release = resolve; });
      }
      return reads++ < 2 ? response({ detail: "expired" }, 401) : response([]);
    });
    const first = api.getModelImports(), second = api.getModelImports();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(refreshes).toBe(1);
    release(response({ authenticated: true, state: "AUTHENTICATED", sessionId: "session", expiresAt: null,
      refreshExpiresAt: null, refreshable: true, csrfToken: "rotated-csrf", refreshed: true }));
    expect(await Promise.all([first, second])).toEqual([[], []]);
    expect(refreshes).toBe(1);
    expect(api.sessionCsrfToken).toBe("rotated-csrf");
  });

  for (const command of ["refresh", "logout"] as const) it(`ignores an old session GET after ${command}`, async () => {
    const old = { authenticated: true, state: "AUTHENTICATED", sessionId: "old-session", expiresAt: null,
      refreshExpiresAt: null, refreshable: true, csrfToken: "old-csrf", refreshed: false };
    let release!: (response: Response) => void;
    const states: boolean[] = [];
    const api = new NavigatorApi(async (input, init) => {
      if (String(input).endsWith("/refresh")) return response({ ...old, csrfToken: "rotated-csrf", refreshed: true });
      if (init?.method === "DELETE") return response(undefined, 204);
      return new Promise(resolve => { release = resolve; });
    });
    api.subscribeSession(session => states.push(session.authenticated));
    const pending = api.getSession();
    if (command === "refresh") await api.refreshSession(); else await api.logout();
    release(response(old));
    const restored = await pending;
    expect(restored.authenticated).toBe(command === "refresh");
    expect(api.sessionCsrfToken).toBe(command === "refresh" ? "rotated-csrf" : null);
    expect(states).toEqual([command === "refresh"]);
  });
  it("reads the Work API bare approval array while retaining legacy envelope compatibility", async () => {
    const approval = { id: "approval-1", taskId: "task-1", kind: "cyrene_mcp_write", summary: "pipelines.patch", details: { pipelineId: "flow-1" }, status: "pending" };
    let body: unknown = [approval];
    const api = new NavigatorApi(async () => response(body));
    expect(await api.getWorkApprovals("local")).toEqual([approval]);
    body = { items: [approval] };
    expect(await api.getWorkApprovals("local")).toEqual([approval]);
    body = [{ ...approval, status: "guessed" }];
    await expect(api.getWorkApprovals("local")).rejects.toMatchObject({ name: "NavigatorContractError" });
  });
  it("uses the same task request identity for retries and forwards the chosen execution backend", async () => {
    const calls: { key: string | null; body: unknown }[] = [];
    const task = { id: "request-1", sessionId: "session-1", workspaceId: "local", prompt: "Hello", status: "queued", createdAt: 1,
      startedAt: null, endedAt: null, output: "", reasoning: "", error: null, durationMs: 0, sequence: 1, metadata: {} };
    const api = new NavigatorApi(async (_input, init) => {
      calls.push({ key: new Headers(init?.headers).get("Idempotency-Key"), body: JSON.parse(String(init?.body)) });
      return response(task);
    });
    const input = { prompt: "Hello", execution: { runtime: "codex", model: "model-1", effort: "high", permission: "ask" as const } };
    await api.createAssistantTask(input, "request-1"); await api.createAssistantTask(input, "request-1");
    expect(calls).toEqual([{ key: "request-1", body: input }, { key: "request-1", body: input }]);
  });

  it("rejects unsupported capability permission values and omits provider credentials from parsed capabilities", async () => {
    const body = { defaultRuntime: "harness", workspaceId: "local", providers: [{ id: "provider", name: "Provider", baseUrl: "https://example.invalid/v1", models: [], configured: true, apiKey: "secret" }],
      runtimes: [{ id: "harness", name: "Harness", available: true, models: [], permissions: ["ask"], resume: true }] };
    const api = new NavigatorApi(async () => response(body));
    const caps = await api.getAssistantCapabilities();
    expect(JSON.stringify(caps)).not.toContain("secret");
    body.runtimes[0].permissions = ["unrestricted-magic"];
    await expect(api.getAssistantCapabilities()).rejects.toMatchObject({ name: "NavigatorContractError" });
  });
  it("refreshes an event stream once and preserves the cursor, Accept header and cancellation", async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    let opened = 0;
    const signal = new AbortController().signal;
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input);
      calls.push({ path, init: init ?? {} });
      if (path === "/api/v1/auth/session/refresh") return response({
        authenticated: true, state: "AUTHENTICATED", sessionId: "session-1",
        expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "new", refreshed: true,
      });
      if (opened++ === 0) return response({ code: "EXPIRED", detail: "expired" }, 401);
      return new Response("id: 7\nevent: done\ndata: {}\n\n", { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
    });
    const result = await api.openTrainingRunEvents("run-1", 7, signal);
    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/yield/training-runs/run-1/events/stream?after_sequence=7",
      "/api/v1/auth/session/refresh",
      "/api/v1/yield/training-runs/run-1/events/stream?after_sequence=7",
    ]);
    const retried = calls[2]?.init;
    expect(new Headers(retried?.headers).get("Accept")).toBe("text/event-stream");
    expect(new Headers(retried?.headers).get("Last-Event-ID")).toBe("7");
    expect(retried?.signal).toBe(signal);
    await result.body?.cancel();
  });

  it("preserves an explicit start or resume idempotency key across user retries", async () => {
    const keys: Array<string | null> = [];
    const api = new NavigatorApi(async (_input, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key"));
      return response({ id: "run-1" });
    });
    await api.startTrainingDraft("draft-1", "start-key");
    await api.startTrainingDraft("draft-1", "start-key");
    await api.resumeTrainingRun("run-1", "checkpoint-1", "resume-key");
    expect(keys).toEqual(["start-key", "start-key", "resume-key"]);
  });

  it("keeps proxy HTTP error status and rejects a non-stream success", async () => {
    const signal = new AbortController().signal;
    const denied = new NavigatorApi(async () => new Response("Forbidden", { status: 403 }));
    await expect(denied.openTrainingRunEvents("run-1", 0, signal)).rejects.toMatchObject({ status: 403 });
    const html = new NavigatorApi(async () => new Response("<html/>", { headers: { "Content-Type": "text/html" } }));
    await expect(html.openTrainingRunEvents("run-1", 0, signal)).rejects.toMatchObject({ name: "NavigatorContractError" });
  });

  it("refreshes once after an expired access session and retries the Product read", async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    let modelRead = 0;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = String(input);
      calls.push({ path, init: init ?? {} });
      if (path === "/api/v1/auth/session") {
        return response({
          authenticated: true,
          state: "AUTHENTICATED",
          sessionId: "session-1",
          expiresAt: "2030-01-01T00:00:00Z",
          refreshExpiresAt: "2030-01-02T00:00:00Z",
          refreshable: true,
          csrfToken: "csrf-old",
          refreshed: false,
        });
      }
      if (path === "/api/v1/reactor/model-imports" && modelRead === 0) {
        modelRead += 1;
        return response({ code: "NAVIGATOR_AUTH_REQUIRED", detail: "expired", retryable: false }, 401);
      }
      if (path === "/api/v1/auth/session/refresh") {
        return response({
          authenticated: true,
          state: "AUTHENTICATED",
          sessionId: "session-1",
          expiresAt: "2030-01-01T01:00:00Z",
          refreshExpiresAt: "2030-01-02T00:00:00Z",
          refreshable: true,
          csrfToken: "csrf-new",
          refreshed: true,
        });
      }
      if (path === "/api/v1/reactor/model-imports") {
        return response([]);
      }
      throw new Error(`Unexpected request: ${path}`);
    };

    const api = new NavigatorApi(fetcher);
    await api.getSession();
    expect(await api.getModelImports()).toEqual([]);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/auth/session",
      "/api/v1/reactor/model-imports",
      "/api/v1/auth/session/refresh",
      "/api/v1/reactor/model-imports",
    ]);
    const refreshCall = calls[2];
    const retryCall = calls[3];
    expect(new Headers(refreshCall?.init.headers).get("X-CSRF-Token")).toBe("csrf-old");
    expect(new Headers(retryCall?.init.headers).get("X-CSRF-Token")).toBeNull();
    expect(retryCall?.init.credentials).toBe("same-origin");
  });

  it("pairs through the Web Host auth path and does not use a Product origin", async () => {
    let request: { path: string; init: RequestInit } | undefined;
    const api = new NavigatorApi(async (input, init) => {
      request = { path: String(input), init: init ?? {} };
      return response({
        authenticated: true,
        state: "AUTHENTICATED",
        sessionId: "session-1",
        expiresAt: "2030-01-01T00:00:00Z",
        refreshExpiresAt: "2030-01-02T00:00:00Z",
        refreshable: true,
        csrfToken: "csrf",
        refreshed: false,
      });
    });

    await api.pair("one-time-code");
    expect(request?.path).toBe("/api/v1/auth/pair");
    expect(request?.init.credentials).toBe("same-origin");
    expect(JSON.parse(String(request?.init.body)) as unknown).toEqual({ pairingCode: "one-time-code" });
  });

  it("adds the rotating CSRF token and idempotency key to mutations", async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    const api = new NavigatorApi(async (input, init) => {
      calls.push({ path: String(input), init: init ?? {} });
      if (String(input) === "/api/v1/auth/session") {
        return response({
          authenticated: true,
          state: "AUTHENTICATED",
          sessionId: "session-1",
          expiresAt: "2030-01-01T00:00:00Z",
          refreshExpiresAt: "2030-01-02T00:00:00Z",
          refreshable: true,
          csrfToken: "csrf-token",
          refreshed: false,
        });
      }
      return response({ id: "dataset-1", name: "dataset" });
    });

    await api.getSession();
    await api.createDataset({ name: "dataset", description: "" });
    const mutation = calls[1];
    const headers = new Headers(mutation?.init.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token");
    expect(headers.get("Idempotency-Key")).toBeTruthy();
    expect(mutation?.path).toBe("/api/v1/catalyst/datasets");
  });

  it("parses system status including GPU, disk, and service reachability", async () => {
    const api = new NavigatorApi(async () => {
      return response({
        service: "cyrene-navigator-web-host",
        status: "ok",
        version: "1.0.0",
        authenticated: true,
        proxyPrefixes: ["/api/v1/yield", "/api/v1/exchange"],
        credentials: { active: 2, revoked: 1 },
        gpu: {
          available: true,
          gpus: [{ name: "RTX 5070", totalMib: 12227, usedMib: 4200, utilizationPct: 15 }],
        },
        disk: {
          available: true,
          totalGib: 1000,
          usedGib: 250,
          freeGib: 750,
          usedPct: 25,
        },
        services: [
          { name: "yield", url: "http://127.0.0.1:8001/health", status: "UP", latencyMs: 2.5 },
        ],
        observedAt: "2026-09-21T00:00:00Z",
      });
    });

    const status = await api.getSystemStatus();
    expect(status.status).toBe("ok");
    expect(status.gpu?.available).toBe(true);
    expect(status.gpu?.gpus?.[0]?.name).toBe("RTX 5070");
    expect(status.disk?.totalGib).toBe(1000);
    expect(status.services?.[0]?.status).toBe("UP");
  });

  it("parses system status blockers and installed plugins", async () => {
    const api = new NavigatorApi(async () => {
      return response({
        service: "cyrene-navigator-web-host",
        status: "ok",
        version: "1.0.0",
        authenticated: true,
        proxyPrefixes: ["/api/v1/yield"],
        credentials: { active: 1, revoked: 0 },
        blockers: [
          { code: "GPU_VRAM_INSUFFICIENT", message: "GPU VRAM is less than 12 GiB." },
        ],
        plugins: [
          { name: "llama-factory", kind: "training.engine", state: "READY" },
          { name: "vllm-runtime", kind: "serving.engine", state: "READY" },
        ],
        observedAt: "2026-09-21T00:00:00Z",
      });
    });

    const status = await api.getSystemStatus();
    expect(status.blockers).toHaveLength(1);
    expect(status.blockers?.[0]?.code).toBe("GPU_VRAM_INSUFFICIENT");
    expect(status.plugins).toHaveLength(2);
    expect(status.plugins?.[0]?.name).toBe("llama-factory");
    expect(status.plugins?.[0]?.state).toBe("READY");
  });

  it("fetches dataset version sample preview through Catalyst proxy", async () => {
    let requestedPath = "";
    const api = new NavigatorApi(async (input) => {
      requestedPath = String(input);
      return response({
        versionId: "11111111-2222-3333-4444-555555555555",
        totalRows: 100,
        rows: [
          {
            index: 0,
            mapped: { instruction: "Say hi", output: "Hi" },
            raw: { prompt: "Say hi", response: "Hi" },
          },
        ],
      });
    });

    const preview = await api.getDatasetVersionPreview("11111111-2222-3333-4444-555555555555", 10, 0);
    expect(requestedPath).toBe("/api/v1/catalyst/dataset-versions/11111111-2222-3333-4444-555555555555/preview?limit=10&offset=0");
    expect(preview.versionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(preview.totalRows).toBe(100);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]?.mapped["instruction"]).toBe("Say hi");
  });

  it("fetches deployment loading phase events through Reactor proxy", async () => {
    let requestedPath = "";
    const api = new NavigatorApi(async (input) => {
      requestedPath = String(input);
      return response({
        deploymentId: "dep-123",
        events: [
          {
            sequence: 1,
            phase: "QUEUED",
            message: "Queued for scheduling",
            occurredAt: "2026-09-21T00:00:00Z",
          },
          {
            sequence: 2,
            phase: "LOADING",
            message: "Loading model weights",
            occurredAt: "2026-09-21T00:00:01Z",
          },
        ],
      });
    });

    const eventsRes = await api.getDeploymentEvents("dep-123");
    expect(requestedPath).toBe("/api/v1/reactor/deployments/dep-123/events");
    expect(eventsRes.deploymentId).toBe("dep-123");
    expect(eventsRes.events).toHaveLength(2);
    expect(eventsRes.events[0]?.phase).toBe("QUEUED");
    expect(eventsRes.events[1]?.phase).toBe("LOADING");
  });

  it("reads and sets active gateway route in Navigator session", async () => {
    let lastMethod = "";
    let lastPath = "";
    let lastBody: unknown;
    const api = new NavigatorApi(async (input, init) => {
      lastPath = String(input);
      lastMethod = init?.method ?? "GET";
      lastBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return response({
        gatewayEndpointId: "gw-1",
        modelId: "qwen-2.5",
        baseUrl: "http://localhost:8003/v1",
        apiKeyHint: "qwen-hint",
      });
    });

    const getRes = await api.getActiveRoute();
    expect(lastPath).toBe("/api/v1/navigator/active-route");
    expect(lastMethod).toBe("GET");
    expect(getRes.modelId).toBe("qwen-2.5");

    const setRes = await api.setActiveRoute({
      gatewayEndpointId: "gw-1",
      modelId: "qwen-2.5",
      baseUrl: "http://localhost:8003/v1",
      apiKeyHint: "qwen-hint",
    });
    expect(lastPath).toBe("/api/v1/navigator/active-route");
    expect(lastMethod).toBe("POST");
    expect(lastBody).toEqual({
      gatewayEndpointId: "gw-1",
      modelId: "qwen-2.5",
      baseUrl: "http://localhost:8003/v1",
      apiKeyHint: "qwen-hint",
    });
    expect(setRes.modelId).toBe("qwen-2.5");
  });

  it("lists, creates, reads, and cancels server-owned assistant tasks through Control", async () => {
    const calls: Array<{ path: string; method: string; headers: Headers; body?: unknown }> = [];
    const task = {
      id: "task-1", workspaceId: "workspace-1", sessionId: "agent-session-1", prompt: "check status", status: "queued",
      createdAt: 1_000, startedAt: null, endedAt: null, output: "", reasoning: "", error: null, durationMs: 0,
      sequence: 1, title: null, description: null, metadata: {},
    };
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input), method = init?.method ?? "GET", headers = new Headers(init?.headers);
      calls.push({ path, method, headers, body: typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined });
      if (path.startsWith("/api/v1/navigator/tasks?") && method === "GET") return response({ items: [task], nextCursor: null });
      if (path === "/api/v1/navigator/tasks" && method === "POST") return response(task, 202);
      if (path === "/api/v1/navigator/tasks/task-2" && method === "GET") return response({ ...task, id: "task-2" });
      if (path === "/api/v1/navigator/tasks/task-1/cancel" && method === "POST") return response({ taskId: "task-1", cancelled: true });
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const page = await api.getAssistantTasks(undefined, 20);
    const created = await api.createAssistantTask({ prompt: "check status" });
    const detail = await api.getAssistantTask("task-2");
    const cancelled = await api.cancelAssistantTask("task-1");

    expect(page.items[0]?.status).toBe("queued");
    expect(created.sessionId).toBe("agent-session-1");
    expect(detail.id).toBe("task-2");
    expect(cancelled).toEqual({ taskId: "task-1", cancelled: true });
    expect(calls[0]?.path).toBe("/api/v1/navigator/tasks?limit=20");
    expect(calls[1]?.body).toEqual({ prompt: "check status" });
    expect(calls[1]?.headers.get("Idempotency-Key")).toBeTruthy();
    expect(calls[2]?.path).toBe("/api/v1/navigator/tasks/task-2");
    expect(calls[3]?.headers.get("Idempotency-Key")).toBeTruthy();
  });

  it("resumes assistant task events with the sequence cursor and rejects non-stream replies", async () => {
    let call: { path: string; headers: Headers; signal?: AbortSignal } | undefined;
    const controller = new AbortController();
    const api = new NavigatorApi(async (input, init) => {
      call = { path: String(input), headers: new Headers(init?.headers), signal: init?.signal ?? undefined };
      return new Response("id: 11\nevent: task.status_changed\ndata: {\"status\":\"running\"}\n\n", {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      });
    });
    const stream = await api.openAssistantTaskEvents("task-1", 10, controller.signal);
    expect(call?.path).toBe("/api/v1/navigator/tasks/task-1/events?after=10");
    expect(call?.headers.get("Last-Event-ID")).toBe("10");
    expect(call?.headers.get("Accept")).toBe("text/event-stream");
    expect(call?.signal).toBe(controller.signal);
    await stream.body?.cancel();

    const invalid = new NavigatorApi(async () => response({ status: "ok" }));
    await expect(invalid.openAssistantTaskEvents("task-1", 0, controller.signal)).rejects.toMatchObject({ name: "NavigatorContractError" });
  });

  it("rejects unknown assistant task states instead of guessing the current state", async () => {
    const api = new NavigatorApi(async () => response({ items: [{
      id: "task-1", workspaceId: "workspace-1", sessionId: "session-1", prompt: "p", status: "maybe",
      createdAt: 1_000, startedAt: null, endedAt: null, output: "", reasoning: "", error: null, durationMs: 0,
      sequence: 1, title: null, description: null, metadata: {},
    }], nextCursor: null }));
    await expect(api.getAssistantTasks()).rejects.toMatchObject({ name: "NavigatorContractError" });
  });

  it("uses the configured workspace API for approvals, memory, notifications, attachments, and QQ", async () => {
    const calls: Array<{ path: string; method: string; body?: unknown; headers: Headers }> = [];
    const digest = "a".repeat(64);
    const future = new Date(Date.now() + 60_000).toISOString();
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input), method = init?.method ?? "GET";
      calls.push({ path, method, body: typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined, headers: new Headers(init?.headers) });
      if (path.endsWith("/approvals?status=pending&limit=100")) return response({ items: [] });
      if (path.endsWith("/approvals/approval-1/resolve")) return response({ id: "approval-1", status: "approved" });
      if (path.endsWith("/inputs?status=pending&limit=100")) return response({ items: [{ id: "input-1", taskId: "task-1", summary: "Choose a deployment region", details: { options: ["east", "west"] }, status: "pending", createdAt: 1, answeredAt: null, answeredBy: null, answer: null, messageId: "input-request-1" }] });
      if (path.endsWith("/inputs/input-1/resolve")) return response({ input: { id: "input-1", taskId: "task-1", status: "answered" }, task: { id: "task-1" }, duplicate: false });
      if (path.endsWith("/memory/facts?includeStale=true&limit=100")) return response({ items: [] });
      if (path.endsWith("/memory/query")) return response({ items: [] });
      if (path.endsWith("/memory/facts") && method === "POST") return response({ id: "fact-1", namespace: "work", key: "k", value: { text: "v" }, observedAt: Date.now(), freshUntil: null, missing: false, stale: false, sourceId: "manual" });
      if (path.endsWith("/notifications?limit=100")) return response({ items: [] });
      if (path.endsWith("/attachments") && method === "POST") return response({ id: "attachment-1", sha256: digest, name: "note.txt", mediaType: "text/plain", size: 1, createdAt: Date.now() });
      if (path.endsWith(`/attachments/${digest}`)) return new Response("x", { headers: { "Content-Type": "application/octet-stream" } });
      if (path.endsWith("/connectors")) return response({ items: [{ connectorId: "qq-main", status: "unknown", configured: true, accountId: null, detail: "Health has not been probed.", updatedAt: 1, lastEventAt: null }] });
      if (path.endsWith("/connectors/qq-main/health")) return response({ status: "READY", host_state: "NATIVE_READY", api_ready: true, dedicated_account_confirmed: true, generation: 4, client_version: "1.2.3", host_abi: "v1", failure_code: null });
      if (path.endsWith("/connectors/qq-main/login/qr")) return response({ operation: "qq.login.qr", status: "accepted", result: { login_id: "login-1", qr_payload: "local-opaque-payload", expires_at_utc: future, state: "pending" } });
      if (path.endsWith("/connectors/qq-main/login/poll")) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as { loginId?: string } : {};
        return response(body.loginId === "login-1"
          ? { login_id: "login-1", state: "authorized", account_id: "confirmed-account" }
          : { login_id: body.loginId, state: "scanned", account_id: "unconfirmed-account" });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    await api.getWorkApprovals("workspace-1");
    await api.resolveWorkApproval("workspace-1", "approval-1", "approved");
    const inputs = await api.getWorkInputs("workspace-1");
    await api.resolveWorkInput("workspace-1", "input-1", "east", "input-message-1");
    await api.getMemoryFacts("workspace-1");
    await api.queryMemory("workspace-1", "query text");
    await api.saveMemoryFact("workspace-1", { namespace: "work", key: "k", value: { text: "v" }, sourceId: "manual" });
    await api.getWorkNotifications("workspace-1");
    const connectors = await api.getWorkConnectors("workspace-1");
    const health = await api.getQqHealth("workspace-1", "qq-main");
    const challenge = await api.startQqLogin("workspace-1", "qq-main");
    const login = await api.pollQqLogin("workspace-1", "qq-main", challenge.loginId);
    const scannedLogin = await api.pollQqLogin("workspace-1", "qq-main", "login-scanned");
    const attachment = await api.uploadWorkAttachment("workspace-1", { name: "note.txt", mediaType: "text/plain", contentBase64: "eA==" });
    await api.downloadWorkAttachment("workspace-1", attachment.sha256);

    expect(health).toMatchObject({ hostState: "NATIVE_READY", accountConfirmed: true });
    expect(connectors[0]).toMatchObject({ connectorId: "qq-main", status: "unknown", configured: true });
    expect(inputs[0]).toMatchObject({ id: "input-1", status: "pending", summary: "Choose a deployment region" });
    expect(challenge.qrPayload).toBe("local-opaque-payload");
    expect(login).toMatchObject({ state: "authorized", accountId: "confirmed-account" });
    expect(scannedLogin).toMatchObject({ state: "scanned" });
    expect(scannedLogin).not.toHaveProperty("accountId");
    expect(calls.map(call => call.path)).toEqual([
      "/api/v1/workspaces/workspace-1/work/approvals?status=pending&limit=100",
      "/api/v1/workspaces/workspace-1/work/approvals/approval-1/resolve",
      "/api/v1/workspaces/workspace-1/work/inputs?status=pending&limit=100",
      "/api/v1/workspaces/workspace-1/work/inputs/input-1/resolve",
      "/api/v1/workspaces/workspace-1/work/memory/facts?includeStale=true&limit=100",
      "/api/v1/workspaces/workspace-1/work/memory/query",
      "/api/v1/workspaces/workspace-1/work/memory/facts",
      "/api/v1/workspaces/workspace-1/work/notifications?limit=100",
      "/api/v1/workspaces/workspace-1/work/connectors",
      "/api/v1/workspaces/workspace-1/work/connectors/qq-main/health",
      "/api/v1/workspaces/workspace-1/work/connectors/qq-main/login/qr",
      "/api/v1/workspaces/workspace-1/work/connectors/qq-main/login/poll",
      "/api/v1/workspaces/workspace-1/work/connectors/qq-main/login/poll",
      "/api/v1/workspaces/workspace-1/work/attachments",
      `/api/v1/workspaces/workspace-1/work/attachments/${digest}`,
    ]);
    expect(calls[3]?.body).toMatchObject({ answer: { text: "east" }, messageId: "input-message-1" });
    expect(calls[3]?.headers.get("Idempotency-Key")).toBe("input-message-1");
    expect(calls[10]?.body).toEqual({});
    expect(calls[11]?.body).toEqual({ loginId: "login-1" });
    expect(calls.every(call => call.headers.get("Authorization") === null)).toBe(true);
    expect(calls[13]?.headers.get("Idempotency-Key")).toBeTruthy();
  });

  it("rejects an expired QQ QR challenge without including its payload in the error", async () => {
    const payload = "private-qr-content";
    const api = new NavigatorApi(async () => response({ result: { login_id: "login-1", qr_payload: payload, expires_at_utc: new Date(Date.now() - 1000).toISOString(), state: "pending" } }));
    let message = "";
    try { await api.startQqLogin("workspace-1", "qq-main"); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    expect(message).toContain("expired");
    expect(message).not.toContain(payload);
  });

  it("handles Gateway API routes, endpoints, and API key management", async () => {
    const calls: Array<{ path: string; method?: string }> = [];
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input);
      calls.push({ path, method: init?.method });
      if (path === "/api/v1/auth/session") {
        return response({
          authenticated: true,
          state: "AUTHENTICATED",
          sessionId: "session-1",
          expiresAt: "2030-01-01T00:00:00Z",
          refreshExpiresAt: "2030-01-02T00:00:00Z",
          refreshable: true,
          csrfToken: "csrf-token",
          refreshed: false,
        });
      }
      if (path === "/api/v1/exchange/api/v1/gateway-routes") {
        return response([
          { id: "route-1", modelPattern: "llama-3-8b", targetBindingId: "local-gpu", state: "ACTIVE" },
        ]);
      }
      if (path === "/api/v1/exchange/api/v1/api-keys") {
        if (init?.method === "POST") {
          return response({
            id: "key-1",
            name: "test-key",
            credentialRef: "api-key://uuid-1",
            state: "ACTIVE",
            modelScope: ["llama-3-8b"],
            createdAt: "2026-09-21T00:00:00Z",
            secret: "test-secret",
          });
        }
        return response([
          {
            id: "key-1",
            name: "test-key",
            credentialRef: "api-key://uuid-1",
            state: "ACTIVE",
            modelScope: ["llama-3-8b"],
            createdAt: "2026-09-21T00:00:00Z",
          },
        ]);
      }
      if (path === "/api/v1/exchange/api/v1/api-keys/key-1/actions/revoke") {
        return response({
          id: "key-1",
          name: "test-key",
          credentialRef: "api-key://uuid-1",
          state: "REVOKED",
          modelScope: ["llama-3-8b"],
          createdAt: "2026-09-21T00:00:00Z",
        });
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await api.getSession();
    const routes = await api.getGatewayRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0]?.["modelPattern"]).toBe("llama-3-8b");

    const created = await api.createApiKey("route-1", { name: "test-key" });
    expect(created.secret).toBe("test-secret");
    expect(created.key.name).toBe("test-key");

    const keys = await api.listApiKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]?.state).toBe("ACTIVE");

    const revoked = await api.revokeApiKey("key-1");
    expect(revoked.state).toBe("REVOKED");
  });

  it("limits raw Product transport to Catalyst/Echo and refreshes paired sessions for uploads", async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    let uploadCount = 0;
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input);
      calls.push({ path, init: init ?? {} });
      if (path === "/api/v1/auth/session") return response({
        authenticated: true, state: "AUTHENTICATED", sessionId: "session-1",
        expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "csrf-old", refreshed: false,
      });
      if (path === "/api/v1/auth/session/refresh") return response({
        authenticated: true, state: "AUTHENTICATED", sessionId: "session-1",
        expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "csrf-new", refreshed: true,
      });
      if (path === "/api/v1/echo/api/v1/session-artifacts" && uploadCount++ === 0) return response({ detail: "expired" }, 401);
      if (path === "/api/v1/echo/api/v1/session-artifacts") return new Response("report", { status: 200 });
      throw new Error(`Unexpected request: ${path}`);
    });

    await api.getSession();
    const result = await api.requestProductResponse("/api/v1/echo/api/v1/session-artifacts", {
      method: "POST", headers: { "Content-Type": "application/jsonl" }, body: "sample\n",
    });
    expect(await result.text()).toBe("report");
    expect(calls.map(call => call.path)).toEqual([
      "/api/v1/auth/session",
      "/api/v1/echo/api/v1/session-artifacts",
      "/api/v1/auth/session/refresh",
      "/api/v1/echo/api/v1/session-artifacts",
    ]);
    expect(new Headers(calls[1]?.init.headers).get("X-CSRF-Token")).toBe("csrf-old");
    expect(new Headers(calls[3]?.init.headers).get("X-CSRF-Token")).toBe("csrf-new");
    expect(calls[3]?.init.credentials).toBe("same-origin");
    await expect(api.requestProductResponse("https://attacker.invalid/api/v1/echo/api/v1/session-artifacts"))
      .rejects.toMatchObject({ name: "NavigatorContractError" });
    await expect(api.requestProductResponse("/api/v1/reactor/model-imports"))
      .rejects.toMatchObject({ name: "NavigatorContractError" });
    await expect(api.requestProductResponse("/api/v1/echo/api/v1/%2e%2e/secret"))
      .rejects.toMatchObject({ name: "NavigatorContractError" });
    expect(calls).toHaveLength(4);
  });
});
