import { describe, it, expect, vi } from "vitest";
import { SettingsClient, ServiceError } from "../../apps/web/src/services/client";
import { trainingDraftSchema, trainingConfigurationSchema, suiteInputSchema, pathId } from "../../packages/service-settings/contracts";
import { admittedTarget, allowedSettingsRequest } from "../../tooling/settings-proxy";
import { artifact, authSession, draft, models } from "../fixtures/settings";
import { examplePipeline, parsePipeline } from "../../packages/pipeline-model";
import { LGraph } from "litegraph.js/build/litegraph.core.js";
import { loadGraph, snapshotGraph } from "../../apps/web/src/graph/adapter";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

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
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("<html>SPA fallback</html>"))
      .mockResolvedValueOnce(json({ items: models })).mockResolvedValueOnce(json({ code: "OFFLINE" }, 503));
    const client = new SettingsClient(fetcher);
    await expect(client.models()).rejects.toMatchObject({ code: "NON_JSON" });
    await expect(client.models()).rejects.toMatchObject({ code: "CONTRACT" });
    await expect(client.models()).rejects.toMatchObject({ status: 503 });
  });
  it("strips unrelated fields from model projections", async () => {
    const client = new SettingsClient(vi.fn<typeof fetch>().mockResolvedValue(json(models)));
    expect((await client.models())[0]).not.toHaveProperty("credentialRef");
  });
  it("refreshes once before retrying a read, but never retries a write", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(authSession))
      .mockResolvedValueOnce(json(models)).mockResolvedValueOnce(json({}, 401));
    const client = new SettingsClient(fetcher); const expired = vi.fn(); client.onExpired = expired;
    expect(await client.models()).toHaveLength(1);
    await expect(client.prepareDraft(draft.id, draft.configuration)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(4); expect(expired).toHaveBeenCalledOnce();
  });
  it("uses a caller-stable key when creating an evaluation suite", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, 503)); const client = new SettingsClient(fetcher);
    const input = { name: "eval", evaluator: "exact_match.v1", expectedField: "a", actualField: "b", threshold: 0.5 };
    for (let i = 0; i < 2; i++) await expect(client.createSuite(input, "same-request")).rejects.toBeInstanceOf(ServiceError);
    for (const [, init] of fetcher.mock.calls) expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("same-request");
  });
  it("keeps network errors explicit and honors cancellation", async () => {
    const client = new SettingsClient(vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network")));
    await expect(client.models()).rejects.toMatchObject({ code: "UNREACHABLE" });
    const controller = new AbortController(); controller.abort();
    await expect(client.models(controller.signal)).rejects.toBeInstanceOf(TypeError);
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
