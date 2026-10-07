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
});
