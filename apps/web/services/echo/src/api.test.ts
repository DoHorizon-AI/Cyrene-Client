// -----------------------------------------------------------------------------
// Module: services/echo/src/api.test.ts
// Role: Verify stable JSONL identity and the Echo Product HTTP workflow.
// -----------------------------------------------------------------------------
// 中文：模块职责：验证稳定 JSONL 样本标识和 Echo Product HTTP 流程。

import { describe, expect, it } from "vitest";
import { EchoApi, inspectReferenceActualJsonl, type EchoTransport } from "./api";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("Echo client", () => {
  it("validates stable sample ids while retaining missing values for coverage", () => {
    expect(inspectReferenceActualJsonl([
      '{"sampleId":"s-1","reference":"yes","actual":"yes"}',
      '{"sampleId":"s-2","reference":"no"}',
      '{"sampleId":"s-3","actual":"maybe"}',
    ].join("\n"))).toEqual({
      sampleIds: ["s-1", "s-2", "s-3"], total: 3, evaluable: 1,
      missingReference: 1, missingActual: 1,
    });
    expect(() => inspectReferenceActualJsonl('{"sampleId":"same"}\n{"sampleId":"same"}'))
      .toThrow("repeats sampleId");
    expect(() => inspectReferenceActualJsonl('{"reference":"yes","actual":"yes"}'))
      .toThrow("sampleId");
    expect(() => inspectReferenceActualJsonl('{"sampleId":"s-4","reference":42,"actual":"yes"}'))
      .toThrow("reference must be a string");
    expect(inspectReferenceActualJsonl('{"sampleId":" s-5 ","reference":"yes","actual":"yes"}').sampleIds)
      .toEqual([" s-5 "]);
  });

  it("imports a bound reference/actual input and evaluates it through Echo Product routes", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const transport: EchoTransport = {
      requestProductResponse: async (path, init = {}) => {
        const method = init.method ?? "GET";
        calls.push({ path, method, body: typeof init.body === "string" ? JSON.parse(init.body) as unknown : undefined });
        if (path.endsWith("/evaluation-suites")) return jsonResponse({
          id: "suite-1", name: "pairs", evaluator: "exact_match.v1", expectedField: "reference", actualField: "actual", threshold: 1,
        }, 201);
        if (path.endsWith("/evaluation-suites/suite-1")) return jsonResponse({
          id: "suite-1", name: "pairs", evaluator: "exact_match.v1", expectedField: "reference", actualField: "actual", threshold: 1,
        });
        if (path.endsWith("/session-artifacts")) return jsonResponse({
          uri: "artifact://sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          size_bytes: 64,
          kind: "dataset",
        }, 201);
        if (path.endsWith("/evaluation-inputs")) return jsonResponse({ id: "input-1", state: "DRAFT" }, 201);
        if (path.endsWith("/actions/evaluate")) return jsonResponse({ id: "run-1", state: "SUCCEEDED", resultId: "result-1" }, 201);
        return jsonResponse({});
      },
    };
    const api = new EchoApi(transport);
    const suite = await api.createSuite({
      name: "pairs", evaluator: "exact_match.v1", expectedField: "reference", actualField: "actual", threshold: 1,
    });
    await api.getSuite(suite.id);
    const artifact = await api.uploadJsonl(new File(['{"sampleId":"s-1","reference":"yes","actual":"yes"}\n'], "pairs.jsonl"));
    const input = await api.createInput({
      sourceRef: { uri: "cyrene://catalyst/dataset-versions/version-1", id: "version-1", resourceVersion: 2 },
      artifact,
      format: "CYRENE_REFERENCE_ACTUAL_JSONL_V1",
      contentRefs: ["s-1"],
      provenanceRefs: ["catalyst://dataset-versions/version-1"],
      targetDatasetVersion: "catalyst://dataset-versions/version-1",
      targetPackageArtifact: artifact,
    });
    const run = await api.evaluateInput(input.id, suite.id);

    expect(run.resultId).toBe("result-1");
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual([
      "POST /api/v1/echo/evaluation-suites",
      "GET /api/v1/echo/evaluation-suites/suite-1",
      "POST /api/v1/echo/api/v1/session-artifacts",
      "POST /api/v1/echo/api/v1/evaluation-inputs",
      "POST /api/v1/echo/api/v1/evaluation-inputs/input-1/actions/evaluate",
    ]);
    expect(calls[3]?.body).toMatchObject({
      format: "CYRENE_REFERENCE_ACTUAL_JSONL_V1",
      targetDatasetVersion: "catalyst://dataset-versions/version-1",
      sourceRef: { uri: "cyrene://catalyst/dataset-versions/version-1" },
      targetPackageArtifact: { digest: artifact.digest },
    });
    expect(calls[4]?.body).toEqual({ suiteId: "suite-1", engineBindingId: "exact-match-plugin" });
  });

  it("fetches and downloads the persisted report export route", async () => {
    const paths: string[] = [];
    const body = {
      schemaVersion: "cyrene.echo.evaluation-report.v1",
      resultId: "result-1",
      target: { versionRef: "catalyst://dataset-versions/v1", packageDigest: "sha256:a" },
      inputDigest: "sha256:b",
      evaluator: { id: "exact_match.v1", version: "1" },
      coverage: { total: 1, evaluated: 1, failed: 0, skipped: 0 },
      metrics: [{ name: "exact_match", matched: 1, evaluated: 1, value: 1 }],
      samples: [{ sampleId: "s-1", status: "EVALUATED", exactMatch: true }],
    };
    const transport: EchoTransport = {
      requestProductResponse: async path => {
        paths.push(path);
        return jsonResponse(body);
      },
    };
    const api = new EchoApi(transport);
    expect((await api.getReport("result-1")).metrics[0]?.name).toBe("exact_match");
    expect(await (await api.downloadReport("result-1")).text()).toContain("evaluation-report.v1");
    expect(paths).toEqual([
      "/api/v1/echo/api/v1/evaluation-results/result-1/export",
      "/api/v1/echo/api/v1/evaluation-results/result-1/export",
    ]);
  });
});
