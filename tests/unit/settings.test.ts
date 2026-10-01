import { describe, it, expect, vi } from "vitest";
import { SettingsClient, ServiceError } from "../../apps/web/src/services/client";
import { WorkspaceBffClient } from "../../apps/web/src/services/workspace-bff-client";
import { trainingDraftSchema, trainingConfigurationSchema, suiteInputSchema, pathId } from "../../packages/service-settings/contracts";
import { admittedTarget, allowedSettingsRequest } from "../../tooling/settings-proxy";
import { artifact, authSession, draft, ids, models, suite } from "../fixtures/settings";
import { examplePipeline, parsePipeline } from "../../packages/pipeline-model";
import { LGraph } from "litegraph.js/build/litegraph.core.js";
import { loadGraph, snapshotGraph } from "../../apps/web/src/graph/adapter";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const workspaceSession = {
  issuer: "https://issuer.example",
  subject: "settings-user",
  organizationId: "org-1",
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  csrfToken: `v1.${Date.now()}.` + "a".repeat(40),
};

function workspaceSettingsClient(productResponses: Response[]) {
  const requests: { path: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    requests.push({ path, init });
    if (path === "/api/workspace/v1/session") return json(workspaceSession);
    if (path === "/api/workspace/v1/workspaces") {
      return json({ workspaces: [{ workspaceId: "ws-1", organizationId: "org-1", displayName: "Team" }] });
    }
    if (path.endsWith("/products/invocations")) return productResponses.shift() ?? json([]);
    throw new Error(`unexpected Workspace BFF request: ${path}`);
  });
  const bff = new WorkspaceBffClient({ enabled: true, fetcher });
  return {
    client: new SettingsClient(fetcher, 10_000, bff),
    fetcher,
    requests,
  };
}

describe("Product settings projections", () => {
  it("preserves loraDropout and maxSteps from the implemented Yield model", () => {
    const result = trainingDraftSchema.parse(draft);
    expect(result.configuration?.parameters.loraDropout).toBe(0.1);
    expect(result.configuration?.parameters.maxSteps).toBe(20);
  });
  it("rejects out-of-range parameters and a base model without a complete manifest", () => {
    expect(() => trainingConfigurationSchema.parse({ ...draft.configuration, parameters: { epochs: 101 } })).toThrow();
    expect(() => trainingConfigurationSchema.parse({ ...draft.configuration, baseModel: { ...draft.configuration.baseModel, artifact: { ...artifact, manifest_digest: null } } })).toThrow();
    expect(() => suiteInputSchema.parse({ name: "eval", evaluator: "llm_judge.v1", expectedField: "a", actualField: "b", threshold: 0.5 })).toThrow();
  });
  it("keeps service bindings across graph serialization without storing service payloads", () => {
    const p = examplePipeline(); p.nodes[3].settingsBinding = { kind: "training-draft", resourceId: draft.id };
    const graph = new LGraph(); loadGraph(graph, p);
    expect(parsePipeline(snapshotGraph(graph, p))).toEqual(p);
    p.nodes[0].settingsBinding = { kind: "training-draft", resourceId: draft.id };
    expect(() => parsePipeline(p)).toThrow(/不匹配/);
  });
});

describe("settings client", () => {
  it("uses same-origin cookies and CSRF, without starting a training run", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(authSession)).mockResolvedValueOnce(json(draft));
    const client = new SettingsClient(fetcher);
    await client.session(); await client.prepareDraft(draft.id, draft.configuration);
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe(`/api/v1/yield/training-drafts/${draft.id}`);
    expect(init?.method).toBe("PATCH"); expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("fixture-csrf");
    expect(JSON.parse(init!.body as string).parameters.loraDropout).toBe(0.1);
  });
  it("rejects HTML, malformed envelopes, and unknown API settings instead of reporting empty data", async () => {
    const { client } = workspaceSettingsClient([
      new Response("<html>SPA fallback</html>"),
      json({ items: models }),
      new Response(JSON.stringify({ title: "Unavailable", status: 503, code: "upstream_unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/problem+json" },
      }),
    ]);
    await client.discoverWorkspaceBffWorkspaces();
    await expect(client.models(undefined, "ws-1")).rejects.toMatchObject({ code: "invalid_response" });
    await expect(client.models(undefined, "ws-1")).rejects.toMatchObject({ code: "invalid_upstream_response" });
    await expect(client.models(undefined, "ws-1")).rejects.toMatchObject({ code: "upstream_unavailable", status: 503 });
  });
  it("strips unrelated fields from model projections", async () => {
    const { client } = workspaceSettingsClient([json(models)]);
    await client.discoverWorkspaceBffWorkspaces();
    expect((await client.models(undefined, "ws-1"))[0]).not.toHaveProperty("credentialRef");
  });
  it("refreshes once before retrying a read, but never retries a write", async () => {
    const status = {
      service: "cyrene-navigator-web-host",
      status: "ready",
      authenticated: true,
      proxyPrefixes: [],
      observedAt: new Date().toISOString(),
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(authSession))
      .mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json({}, 401));
    const client = new SettingsClient(fetcher); const expired = vi.fn(); client.onExpired = expired;
    expect(await client.status()).toMatchObject({ status: "ready" });
    await expect(client.prepareDraft(draft.id, draft.configuration)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(4); expect(expired).toHaveBeenCalledOnce();
  });
  it("uses a caller-stable key in the v2 invocation when creating an evaluation suite", async () => {
    const { client, requests } = workspaceSettingsClient([
      new Response(JSON.stringify({ title: "Conflict", status: 409, code: "state_conflict" }), {
        status: 409,
        headers: { "Content-Type": "application/problem+json" },
      }),
      new Response(JSON.stringify({ title: "Conflict", status: 409, code: "state_conflict" }), {
        status: 409,
        headers: { "Content-Type": "application/problem+json" },
      }),
    ]);
    await client.discoverWorkspaceBffWorkspaces();
    const input = { name: "eval", evaluator: "exact_match.v1", expectedField: "a", actualField: "b", threshold: 0.5 };
    for (let i = 0; i < 2; i++) {
      await expect(client.createSuite(input, "same-request", "ws-1")).rejects.toMatchObject({ code: "state_conflict" });
    }
    const invocations = requests.filter(({ path }) => path.endsWith("/products/invocations"));
    expect(invocations).toHaveLength(2);
    for (const { init } of invocations) expect(JSON.parse(init!.body as string).idempotencyKey).toBe("same-request");
  });
  it("keeps network errors explicit and honors cancellation", async () => {
    const client = new SettingsClient(vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network")));
    await expect(client.status()).rejects.toMatchObject({ code: "UNREACHABLE" });
    const controller = new AbortController(); controller.abort();
    await expect(client.status(controller.signal)).rejects.toBeInstanceOf(TypeError);
  });
  it("uses the explicitly selected local WebHost routes when Workspace BFF is disabled", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      if (path === "/api/v1/catalyst/datasets") return json([{ id: ids.dataset, name: "Fixture dataset", state: "ACTIVE" }]);
      if (path === "/api/v1/reactor/model-imports") return json(models);
      if (path === "/api/v1/yield/training-drafts") return json([draft]);
      if (path === `/api/v1/yield/training-drafts/${ids.draft}`) return json(draft);
      if (path === `/api/v1/echo/evaluation-suites/${ids.suite}`) return json(suite);
      if (path === "/api/v1/echo/evaluation-suites" && init?.method === "POST") return json({ ...suite, ...JSON.parse(String(init.body)) });
      throw new Error(`unexpected local WebHost request: ${path}`);
    });
    const client = new SettingsClient(fetcher, 10_000, new WorkspaceBffClient({ enabled: false, fetcher }));

    await client.datasets(undefined, "ws-1");
    await client.models(undefined, "ws-1");
    await client.drafts();
    await client.draft(draft.id, undefined, "ws-1");
    await client.suite(ids.suite, undefined, "ws-1");
    await client.createSuite({ name: "eval", evaluator: "exact_match.v1", expectedField: "a", actualField: "b", threshold: 0.5 }, "key-1", "ws-1");

    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/catalyst/datasets",
      "/api/v1/reactor/model-imports",
      "/api/v1/yield/training-drafts",
      `/api/v1/yield/training-drafts/${ids.draft}`,
      `/api/v1/echo/evaluation-suites/${ids.suite}`,
      "/api/v1/echo/evaluation-suites",
    ]);
    const createRequest = fetcher.mock.calls.at(-1)!;
    expect(createRequest[1]?.method).toBe("POST");
    expect(new Headers(createRequest[1]?.headers).get("Idempotency-Key")).toBe("key-1");
    expect(fetcher.mock.calls.some(([path]) => String(path).includes("/api/workspace/v2/"))).toBe(false);
  });
  it("does not fall back to a local Product route when a v2 invocation fails", async () => {
    const { client, requests } = workspaceSettingsClient([
      new Response(JSON.stringify({ title: "Unavailable", status: 503, code: "upstream_unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/problem+json" },
      }),
    ]);
    await client.discoverWorkspaceBffWorkspaces();
    await expect(client.datasets(undefined, "ws-1")).rejects.toMatchObject({ code: "upstream_unavailable", status: 503 });
    expect(requests.filter(({ path }) => path.endsWith("/products/invocations"))).toHaveLength(1);
    expect(requests.some(({ path }) => path.startsWith("/api/v1/catalyst/"))).toBe(false);
  });
});

describe("development settings proxy boundary", () => {
  it.each(["http://127.0.0.1:8100", "https://example.test"])("admits an explicit host %s", (url) => expect(admittedTarget(url)).toBe(url));
  it.each(["http://user:pass@example.test", "file:///tmp/host", "https://example.test/a", "https://example.test/?target=x"])("rejects ambiguous host %s", (url) => expect(() => admittedTarget(url)).toThrow());
  it("disables the proxy when no host is configured", () => expect(admittedTarget()).toBeUndefined());
  it("allows settings, and rejects run/deploy and encoded traversal", () => {
    expect(allowedSettingsRequest("PATCH", `/api/v1/yield/training-drafts/${draft.id}`)).toBe(true);
    expect(allowedSettingsRequest("POST", "/api/v1/echo/evaluation-suites")).toBe(true);
    expect(allowedSettingsRequest("POST", `/api/v1/yield/training-drafts/${draft.id}/actions/start`)).toBe(false);
    expect(allowedSettingsRequest("POST", "/api/v1/reactor/deployments")).toBe(false);
    expect(allowedSettingsRequest("GET", "/api/v1/navigator/harness/workspaces/%252e%252e/sessions")).toBe(false);
  });
  it.each(["..", "a/b", "a%2Fb", "https://elsewhere.test", ""])("rejects resource paths %s", (value) => expect(() => pathId(value)).toThrow());
});
