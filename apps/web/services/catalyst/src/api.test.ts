// -----------------------------------------------------------------------------
// Module: services/catalyst/src/api.test.ts
// Role: Verify Catalyst wire paths, binary upload, and user-facing API errors.
// 中文：校验 Catalyst 路由、二进制上传与面向用户的 API 错误。
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  CatalystClientError,
  CatalystDataToolsClient,
  contentApprovalBlockReason,
  MAX_BATCH_SOURCE_COUNT,
  MAX_SOURCE_BYTES,
  userFacingCatalystError,
  userFacingParseFailure,
  userFacingSourceItemError,
} from "./api";

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

  it("sends repeated files[] FormData and preserves per-file successes and failures", async () => {
    let capturedPath = "";
    let capturedInit: RequestInit | undefined;
    const goodFile = new File([new Uint8Array([0x50, 0x4b])], "slides.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    const overFile = new File(["x"], "oversized.pdf", { type: "application/pdf" });
    Object.defineProperty(overFile, "size", { value: MAX_SOURCE_BYTES + 1 });
    const client = new CatalystDataToolsClient({
      async requestProductResponse(path, init) {
        capturedPath = path;
        capturedInit = init;
        return jsonResponse({ items: [
          { filename: "slides.pptx", source: { id: "source-1", filename: "slides.pptx" }, error: null },
          { filename: "oversized.pdf", source: null, error: { code: "CATALYST_SOURCE_FILE_TOO_LARGE", message: "The file exceeds the per-file limit.", retryable: false } },
        ] }, 200);
      },
    });

    const result = await client.uploadSourcesBatch("dataset-1", [goodFile, overFile]);

    expect(capturedPath).toBe("/api/v1/catalyst/api/v1/datasets/dataset-1/sources/batch");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBeInstanceOf(FormData);
    expect(new Headers(capturedInit?.headers).has("content-type")).toBe(false);
    const form = capturedInit?.body as FormData;
    const files = form.getAll("files[]");
    expect(files).toHaveLength(2);
    expect(files.map((file) => (file as File).name)).toEqual(["slides.pptx", "oversized.pdf"]);
    expect(result.items.map((item) => [item.filename, item.source?.id ?? null, item.error?.code ?? null])).toEqual([
      ["slides.pptx", "source-1", null],
      ["oversized.pdf", null, "CATALYST_SOURCE_FILE_TOO_LARGE"],
    ]);
    expect(userFacingSourceItemError(result.items[1]!.error!)).toContain("32 MiB per-file");
    expect(userFacingSourceItemError({
      code: "CATALYST_SOURCE_BATCH_TOO_LARGE",
      message: "Accepted files reached the batch limit.",
      retryable: false,
    })).toContain("128 MiB stored-file limit");
  });

  it("validates the batch item count without imposing client-side byte limits", async () => {
    let calls = 0;
    const client = new CatalystDataToolsClient({
      async requestProductResponse() {
        calls += 1;
        return jsonResponse({ items: [] });
      },
    });
    await expect(client.uploadSourcesBatch("dataset-1", [])).rejects.toMatchObject({ code: "empty_batch" });
    const files = Array.from({ length: MAX_BATCH_SOURCE_COUNT + 1 }, (_, index) => new File(["x"], `${index}.txt`));
    await expect(client.uploadSourcesBatch("dataset-1", files)).rejects.toMatchObject({ code: "too_many_files" });
    expect(calls).toBe(0);
  });

  it("reports the request cap when the multipart body itself is rejected", async () => {
    const client = new CatalystDataToolsClient({
      async requestProductResponse() {
        return jsonResponse({ code: "request_body_too_large", detail: "Request too large." }, 413);
      },
    });
    const file = new File(["content"], "source.pdf", { type: "application/pdf" });

    await expect(client.uploadSourcesBatch("dataset-1", [file]))
      .rejects.toMatchObject({ code: "batch_request_too_large", message: "The batch request exceeds the 129 MiB upload limit. Select fewer or smaller files." });
  });

  it("reads parse reports as a filtered direct array", async () => {
    let capturedPath = "";
    const client = new CatalystDataToolsClient({
      async requestProductResponse(path) {
        capturedPath = path;
        return jsonResponse([]);
      },
    });

    await expect(client.listSourceParseReports("dataset-1", { sourceRevisionId: "source/1", processingRunId: "run 2" }))
      .resolves.toEqual([]);

    expect(capturedPath).toBe("/api/v1/catalyst/api/v1/datasets/dataset-1/source-parse-reports?sourceRevisionId=source%2F1&processingRunId=run+2");
  });

  it("loads the review queue and resolves an item with a trimmed note", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const client = new CatalystDataToolsClient({
      async requestProductResponse(path, init) {
        calls.push({ path, init });
        return jsonResponse(path.endsWith("/review-queue")
          ? { items: [], generatedDrafts: [{ id: "revision-draft", datasetId: "dataset-1", revision: 4, state: "DRAFT", blockCount: 2, sourceRevisionIds: ["source-1"], createdAt: "2026-10-07T00:00:00Z", resourceVersion: 1, processingRunId: "run-1" }] }
          : { id: "review-1", state: "ACKNOWLEDGED" });
      },
    });

    const queue = await client.getReviewQueue("dataset-1");
    await client.resolveReviewItem("review:1", "ACKNOWLEDGE", "  inspected page 3  ");

    expect(calls[0]?.path).toBe("/api/v1/catalyst/api/v1/datasets/dataset-1/review-queue");
    expect(queue.generatedDrafts[0]?.processingRunId).toBe("run-1");
    expect(calls[1]?.path).toBe("/api/v1/catalyst/api/v1/review-items/review%3A1/resolve");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ action: "ACKNOWLEDGE", note: "inspected page 3" });
  });

  it("fails closed on unresolved low-confidence parser warnings and missing review records", () => {
    const report = parseReportFixture();
    const openLowConfidenceItem = reviewItemFixture({ state: "OPEN", confidence: 0.18 });
    const queue = { items: [openLowConfidenceItem], generatedDrafts: [] };

    expect(contentApprovalBlockReason("revision-1", ["source-1"], [report], queue))
      .toBe("unresolved_review_items");
    expect(contentApprovalBlockReason("revision-1", ["source-1"], [report], {
      items: [{ ...openLowConfidenceItem, state: "ACKNOWLEDGED" }],
      generatedDrafts: [],
    })).toBeNull();
    expect(contentApprovalBlockReason("revision-1", ["source-1"], [report], {
      items: [{ ...openLowConfidenceItem, state: "REJECTED" }],
      generatedDrafts: [],
    })).toBe("unresolved_review_items");
    expect(contentApprovalBlockReason("revision-1", ["source-1"], [report], { items: [], generatedDrafts: [] }))
      .toBe("parser_report_missing_review_item");
    expect(contentApprovalBlockReason("revision-1", ["source-1"], null, null))
      .toBe("review_status_unavailable");
    expect(contentApprovalBlockReason("revision-1", ["other-source"], [report], { items: [], generatedDrafts: [] }))
      .toBeNull();
  });

  it("keeps model lineage on generated blocks and gives parser failures usable messages", async () => {
    const receipt = {
      recipeId: "grounded-qa",
      recipeVersion: "1.2",
      recipeDigest: "sha256:abc",
      bindingId: "model-binding",
      model: "test-model",
      budget: { maxExamples: 8 },
      usage: { modelCalls: 2 },
      generatedAt: "2026-10-07T00:00:00Z",
      sourceBlockIds: ["block-1"],
    };
    const client = new CatalystDataToolsClient({
      async requestProductResponse() {
        return jsonResponse({ revisionId: "revision-1", offset: 0, limit: 50, total: 1, blocks: [{ id: "block-2", kind: "text", text: "Question? Answer.", origin: "GENERATED", generationReceipt: receipt }] });
      },
    });

    const page = await client.getBlocks("revision-1");

    expect(page.blocks[0]?.generationReceipt).toEqual(receipt);
    expect(userFacingParseFailure({ code: "CATALYST_SOURCE_UNSUPPORTED", message: "unsupported", retryable: false })).toContain("cannot be extracted");
    expect(userFacingParseFailure({ code: "CATALYST_SOURCE_PARSE_FAILED", message: "failed", retryable: false })).toContain("No readable content");
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

  it("starts training curation with source policy and the versioned recipe", async () => {
    let capturedPath = "";
    let capturedBody: unknown;
    const client = new CatalystDataToolsClient({
      async requestProductResponse(path, init) {
        capturedPath = path;
        capturedBody = JSON.parse(String(init?.body));
        return jsonResponse({ id: "curation-run", operation: "curateTrainingData", state: "QUEUED" }, 202);
      },
    });

    await client.createProcessingRun("dataset-1", {
      operation: "curateTrainingData",
      sourceRevisionIds: ["source-1"],
      config: {
        sourcePolicies: { "source-1": { allowKnowledge: false, allowTraining: true, allowedPrincipalRefs: [], allowedUsePurposes: ["model_training"] } },
        curation: {
          id: "training-curation-v1",
          version: "1",
          format: "auto",
          fieldMapping: {},
          roleMapping: {},
          maxCharacters: 100000,
          minCharacters: 2,
          unicodeNormalization: "NFC",
        },
      },
    });

    expect(capturedPath).toBe("/api/v1/catalyst/api/v1/datasets/dataset-1/processing-runs");
    expect(capturedBody).toMatchObject({
      operation: "curateTrainingData",
      sourceRevisionIds: ["source-1"],
      config: { sourcePolicies: { "source-1": { allowTraining: true, allowedUsePurposes: ["model_training"] } }, curation: { format: "auto", unicodeNormalization: "NFC" } },
    });
  });

  it("pages training records and creates an immutable child revision for a record decision", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const client = new CatalystDataToolsClient({
      async requestProductResponse(path, init) {
        calls.push({ path, init });
        return jsonResponse(path.includes("training-records:edit")
          ? { id: "revision-2", revision: 2, state: "DRAFT", resourceVersion: 4, blocks: [] }
          : { revisionId: "revision-1", offset: 25, limit: 25, total: 51, records: [{ id: "record-1", sampleId: "external-1", sourceRevisionId: "source-1", sourceFamilyId: "family-1", ordinal: 26, locator: { itemRef: "line:27" }, detectedFormat: "messages", normalized: { messages: [{ role: "user", content: "问题" }, { role: "assistant", content: "回答" }] }, disposition: "review", issues: [], contentDigest: "sha256:record", recipeDigest: "sha256:recipe", processingHistory: [] }] });
      },
    });

    const page = await client.listTrainingRecords("revision-1", { offset: 25, limit: 25, disposition: "review", issueCode: "ROLE_ORDER" });
    const child = await client.editTrainingRecords("revision-1", {
      resourceVersion: 3,
      edits: [{ recordId: "record-1", action: "approve", note: "Reviewed original and turns." }],
    });

    expect(calls[0]?.path).toBe("/api/v1/catalyst/api/v1/content-revisions/revision-1/training-records?offset=25&limit=25&disposition=review&issueCode=ROLE_ORDER");
    expect(page.records[0]?.normalized?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(page.total).toBe(51);
    expect(calls[1]?.path).toBe("/api/v1/catalyst/api/v1/content-revisions/revision-1/training-records:edit");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ resourceVersion: 3, edits: [{ recordId: "record-1", action: "approve", note: "Reviewed original and turns." }] });
    expect(child.id).toBe("revision-2");
  });

  it("encodes Review Queue filters as a typed query", async () => {
    let capturedPath = "";
    const client = new CatalystDataToolsClient({
      async requestProductResponse(path) {
        capturedPath = path;
        return jsonResponse({ items: [], generatedDrafts: [], offset: 10, limit: 10, total: 11 });
      },
    });

    const queue = await client.getReviewQueue("dataset-1", { kind: "TRAINING_STRUCTURE", code: "MISSING_FIELD", offset: 10, limit: 10 });

    expect(capturedPath).toBe("/api/v1/catalyst/api/v1/datasets/dataset-1/review-queue?kind=TRAINING_STRUCTURE&code=MISSING_FIELD&offset=10&limit=10");
    expect(queue.total).toBe(11);
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

function parseReportFixture() {
  return {
    id: "report-1",
    datasetId: "dataset-1",
    sourceRevisionId: "source-1",
    processingRunId: "run-1",
    status: "WARNING" as const,
    blockCount: 2,
    warnings: [],
    diagnostics: [{ code: "LOW_CONFIDENCE_OCR", message: "Text needs review.", kind: "ocr" as const, severity: "warning" as const, confidence: 0.18 }],
    unsupportedContent: [],
    outputArtifacts: [],
    createdAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:00Z",
    resourceVersion: 1,
  };
}

function reviewItemFixture(overrides: Partial<{
  state: "OPEN" | "ACKNOWLEDGED" | "REJECTED";
  confidence: number;
}> = {}) {
  return {
    id: "review-1",
    datasetId: "dataset-1",
    sourceParseReportId: "report-1",
    sourceRevisionId: "source-1",
    processingRunId: "run-1",
    kind: "OCR_WARNING" as const,
    code: "LOW_CONFIDENCE_OCR",
    message: "Text needs review.",
    severity: "warning",
    state: "OPEN" as const,
    createdAt: "2026-10-07T00:00:00Z",
    resourceVersion: 1,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
