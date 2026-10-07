// -----------------------------------------------------------------------------
// Module: services/catalyst/src/api.test.ts
// Role: Verify Catalyst wire paths, binary upload, and user-facing API errors.
// 中文：校验 Catalyst 路由、二进制上传与面向用户的 API 错误。
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { CatalystClientError, CatalystDataToolsClient, MAX_SOURCE_BYTES, userFacingCatalystError } from "./api";

describe("CatalystDataToolsClient", () => {
  it("uploads the original PDF bytes as an octet-stream without text conversion", async () => {
    let capturedPath = "";
    let capturedInit: RequestInit | undefined;
    const transport = {
      async requestProductResponse(path: string, init?: RequestInit) {
        capturedPath = path;
        capturedInit = init;
        return jsonResponse({
          id: "source-1",
          datasetId: "dataset-1",
          sourceId: "logical-source-1",
          revision: 1,
          filename: "guide.pdf",
          mediaType: "application/pdf",
          byteLength: 4,
          digest: "sha256:abcd",
          artifact: { uri: "artifact://source-1", digest: "sha256:abcd", size_bytes: 4, kind: "source" },
          createdAt: "2026-10-07T00:00:00Z",
          resourceVersion: 1,
        }, 201);
      },
    };
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "guide.pdf", { type: "application/pdf" });
    const client = new CatalystDataToolsClient(transport);

    await client.createSource("dataset/one", file);

    expect(capturedPath.startsWith("/api/v1/catalyst/api/v1/datasets/dataset%2Fone/sources?")).toBe(true);
    expect(new URL(capturedPath, "https://client.test").searchParams.get("filename")).toBe("guide.pdf");
    expect(capturedInit?.method).toBe("POST");
    expect(new Headers(capturedInit?.headers).get("content-type")).toBe("application/octet-stream");
    expect(capturedInit?.body).toBe(file);
  });

  it("rejects unsupported and oversized files before making a request", async () => {
    let calls = 0;
    const client = new CatalystDataToolsClient({
      async requestProductResponse() {
        calls += 1;
        return jsonResponse({});
      },
    });

    await expect(client.createSource("dataset-1", new File(["text"], "notes.txt")))
      .rejects.toMatchObject({ code: "unsupported_media_type" });
    const oversized = new File([""], "large.docx");
    Object.defineProperty(oversized, "size", { value: MAX_SOURCE_BYTES + 1 });
    await expect(client.createSource("dataset-1", oversized))
      .rejects.toMatchObject({ code: "file_too_large" });
    expect(calls).toBe(0);
  });

  it("uses the frozen revision edit route and preserves policy restrictions", async () => {
    let capturedPath = "";
    let capturedBody: unknown;
    const client = new CatalystDataToolsClient({
      async requestProductResponse(path, init) {
        capturedPath = path;
        capturedBody = JSON.parse(String(init?.body));
        return jsonResponse({ id: "revision-2", state: "DRAFT", revision: 2, blocks: [] }, 201);
      },
    });

    await client.editBlock("revision-1", "block-4", {
      expectedRevisionId: "revision-1",
      policy: {
        allowKnowledge: false,
        allowTraining: true,
        allowedPrincipalRefs: ["team://legal"],
        allowedUsePurposes: ["knowledge_retrieval"],
      },
    });

    expect(capturedPath).toBe("/api/v1/catalyst/api/v1/content-revisions/revision-1/blocks/block-4/edits");
    expect(capturedBody).toMatchObject({
      expectedRevisionId: "revision-1",
      policy: {
        allowKnowledge: false,
        allowTraining: true,
        allowedPrincipalRefs: ["team://legal"],
        allowedUsePurposes: ["knowledge_retrieval"],
      },
    });
  });

  it("creates a recipe run through the dataset-scoped route", async () => {
    let capturedPath = "";
    let capturedBody: unknown;
    const client = new CatalystDataToolsClient({
      async requestProductResponse(path, init) {
        capturedPath = path;
        capturedBody = JSON.parse(String(init?.body));
        return jsonResponse({ id: "run-1", state: "QUEUED" }, 202);
      },
    });

    await client.createProcessingRun("dataset-1", {
      operation: "buildKnowledge",
      contentRevisionId: "revision-1",
    });

    expect(capturedPath).toBe("/api/v1/catalyst/api/v1/datasets/dataset-1/processing-runs");
    expect(capturedBody).toEqual({ operation: "buildKnowledge", contentRevisionId: "revision-1" });
  });

  it("sends cancel and retry commands with the contract's empty request body", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const client = new CatalystDataToolsClient({
      async requestProductResponse(path, init) {
        calls.push({ path, init });
        return jsonResponse({ id: "run-1", state: "CANCELLED" });
      },
    });

    await client.cancelProcessingRun("run-1");
    await client.retryProcessingRun("run-1");

    expect(calls.map(({ path }) => path)).toEqual([
      "/api/v1/catalyst/api/v1/processing-runs/run-1/cancel",
      "/api/v1/catalyst/api/v1/processing-runs/run-1/retry",
    ]);
    expect(calls.every(({ init }) => init?.method === "POST" && init.body === undefined)).toBe(true);
  });

  it("returns exported package bytes with a useful download filename", async () => {
    let capturedPath = "";
    let capturedInit: RequestInit | undefined;
    const client = new CatalystDataToolsClient({
      async requestProductResponse(path, init) {
        capturedPath = path;
        capturedInit = init;
        return new Response(new Uint8Array([0x50, 0x4b]), {
          status: 200,
          headers: { "content-type": "application/zip", "content-disposition": "attachment; filename=knowledge.zip" },
        });
      },
    });

    const result = await client.downloadExport("version-1", "knowledge");

    expect(capturedPath).toBe("/api/v1/catalyst/api/v1/dataset-versions/version-1/data-tools/export?profile=knowledge");
    expect(capturedInit?.method).toBe("GET");
    expect(new Headers(capturedInit?.headers).get("accept")).toBe("application/zip");
    expect(result.filename).toBe("knowledge.zip");
    expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([0x50, 0x4b]);
  });

  it("does not treat an HTML success page as an exported package", async () => {
    const client = new CatalystDataToolsClient({
      async requestProductResponse() {
        return new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } });
      },
    });

    await expect(client.downloadExport("version-1", "sft"))
      .rejects.toMatchObject({ code: "invalid_export_response" });
  });

  it("hides machine codes and executor details from visible error copy", () => {
    expect(userFacingCatalystError(new CatalystClientError("connection_ref_missing: docling", 503, "connection_ref_missing")))
      .toContain("not configured");
    expect(userFacingCatalystError(new CatalystClientError("executor toolchain install failed", 500)))
      .toContain("workspace capability is unavailable");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
