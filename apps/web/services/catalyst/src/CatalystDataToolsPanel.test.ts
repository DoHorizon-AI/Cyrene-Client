// -----------------------------------------------------------------------------
// Module: services/catalyst/src/CatalystDataToolsPanel.test.ts
// Role: Verify the multi-format batch upload control exposed to dataset users.
// 中文：校验数据集界面向用户提供的多格式批量上传控件。
// -----------------------------------------------------------------------------

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ControlledLocaleProvider } from "../../navigator/src/i18n";
import { CatalystDataToolsPanel, formatCatalystLocator } from "./CatalystDataToolsPanel";
import { CatalystDataToolsClient } from "./api";
import { TrainingCurationPanel, TrainingRecordCard } from "./TrainingCurationPanel";

describe("CatalystDataToolsPanel", () => {
  it("offers the contract formats and displays the server-aligned batch limits", () => {
    const html = renderToStaticMarkup(createElement(
      ControlledLocaleProvider,
      {
        locale: "en-US",
        setLocale: () => undefined,
        children: createElement(CatalystDataToolsPanel, {
          datasets: [{ id: "dataset-1", name: "Knowledge" }],
          transport: { async requestProductResponse() { throw new Error("Not called during static render."); } },
        }),
      },
    ));
    const fileInput = /<input\b[^>]*type="file"[^>]*>/.exec(html)?.[0] ?? "";

    expect(fileInput).toContain("multiple");
    for (const extension of [".pdf", ".docx", ".pptx", ".xlsx", ".md", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".jsonl"]) {
      expect(fileInput).toContain(extension);
    }
    expect(html).toContain("20 files");
    expect(html).toContain("32.0 MiB per file");
    expect(html).toContain("128.0 MiB stored per batch");
    expect(html).toContain("129.0 MiB request cap");
  });

  it("shows structured page, slide, sheet, and OCR locations without parser codes", () => {
    const officeDetails = formatCatalystLocator({
      sourcePages: [4],
      provenance: [
        { slide_number: 2, shape_id: "shape-7", name: "Title", type: "text", bbox_emu: [1, 2, 3, 4] },
        { sheet_name: "Quarterly", cell_ref: "B6", formula: "=SUM(A1:A2)", cached_value: 12 },
      ],
      internal_code: "PARSER_TRACE_9",
    }, "en-US").join(" · ");
    const ocrDetails = formatCatalystLocator({
      provenance: [{ engine: "ocr-engine", language: "en", confidence: 0.42, text_origin: "recognized", bbox: { x: 1, y: 2, width: 3, height: 4 } }],
    }, "zh-CN").join(" · ");

    expect(officeDetails).toContain("Page 4");
    expect(officeDetails).toContain("Slide 2");
    expect(officeDetails).toContain("Shape shape-7");
    expect(officeDetails).toContain("Sheet Quarterly");
    expect(officeDetails).toContain("Cell B6");
    expect(officeDetails).not.toContain("PARSER_TRACE_9");
    expect(ocrDetails).toContain("OCR 引擎 ocr-engine");
    expect(ocrDetails).toContain("置信度 0.42");
    expect(ocrDetails).toContain("文本来源 recognized");
  });

  it("renders format mapping, explicit training consent, counts, and record comparison controls", () => {
    const html = renderToStaticMarkup(createElement(
      ControlledLocaleProvider,
      {
        locale: "en-US",
        setLocale: () => undefined,
        children: createElement(TrainingCurationPanel, {
          datasetId: "dataset-1",
          sources: [{
            id: "source-1", datasetId: "dataset-1", sourceId: "source", revision: 1,
            filename: "mixed.jsonl", mediaType: "application/jsonl", byteLength: 120,
            digest: "sha256:source", artifact: { uri: "artifact://source", digest: "sha256:source", size_bytes: 120, kind: "source" },
            createdAt: "2026-10-08T00:00:00Z", resourceVersion: 1,
          }],
          revision: {
            id: "revision-1", datasetId: "dataset-1", revision: 1, sourceRevisionIds: ["source-1"],
            state: "DRAFT", blocks: [], createdAt: "2026-10-08T00:00:00Z", resourceVersion: 2,
            trainingDataSnapshot: {
              schemaVersion: "cyrene.training-record.v1",
              artifact: { uri: "artifact://records", digest: "sha256:records", size_bytes: 500, kind: "training-records" },
              recordCount: 4,
              counts: { total: 4, recognized: 3, formatErrors: 1, duplicateCandidates: 1, pendingReview: 2, excluded: 1, eligible: 1 },
            },
          },
          client: new CatalystDataToolsClient({ async requestProductResponse() { throw new Error("Not called during static render."); } }),
          busy: false,
          onSourcesUploaded: () => undefined,
          onRunStarted: () => undefined,
          onRevisionCreated: () => undefined,
        }),
      },
    ));

    expect(html).toContain("Automatic detection");
    expect(html).toContain("Field mapping JSON");
    expect(html).toContain("Role mapping JSON");
    expect(html).toContain("I confirm the selected sources are permitted for model training.");
    expect(html).toContain("Duplicate candidates");
    expect(html).toContain("The recognized, format-error, and duplicate counts can overlap.");
    expect(html).toContain("Filter by issue code");
    expect(html).toContain("Record decisions create an immutable child revision.");
  });

  it("shows every conversation turn beside the untouched source record", () => {
    const html = renderToStaticMarkup(createElement(
      ControlledLocaleProvider,
      {
        locale: "en-US",
        setLocale: () => undefined,
        children: createElement(TrainingRecordCard, {
          record: {
            schemaVersion: "cyrene.training-record.v1",
            id: "record-1", sampleId: "sample-7", sourceRevisionId: "source-1", sourceFamilyId: "family-1",
            conversationId: "conversation-2", ordinal: 6, locator: { itemRef: "line:7" },
            rawRecord: { messages: [{ role: "user", content: "你好" }, { role: "assistant", content: "Hello" }] },
            detectedFormat: "messages",
            normalized: { messages: [{ role: "system", content: "Be helpful." }, { role: "user", content: "你好" }, { role: "assistant", content: "Hello" }] },
            disposition: "review", issues: [{ code: "CUSTOM_ROLE", message: "Map role explicitly.", severity: "warning" }],
            contentDigest: "sha256:content", recipeDigest: "sha256:recipe", processingHistory: [{ operation: "normalize" }],
            policy: { allowKnowledge: false, allowTraining: true, allowedPrincipalRefs: [], allowedUsePurposes: ["model_training"] },
          },
          locale: "en-US", busy: false, action: null, note: "", rawEdit: "{}",
          onNoteChange: () => undefined, onRawEditChange: () => undefined,
          onApprove: () => undefined, onExclude: () => undefined, onRemap: () => undefined,
        }),
      },
    ));

    expect(html).toContain("Original record");
    expect(html).toContain("Normalized messages");
    expect(html).toContain("system");
    expect(html).toContain("user");
    expect(html).toContain("assistant");
    expect(html).toContain("line:7");
    expect(html).toContain("family-1");
    expect(html).toContain("sha256:recipe");
  });
});
