import type { DatasetPreview } from "../types";
import { requireRecord, requireArray, isRecord } from "./validation";

export function parseDatasetPreview(value: unknown): DatasetPreview {
  const record = requireRecord(value, "dataset preview");
  const versionId = String(record.versionId ?? record.version_id ?? "");
  const totalRows = typeof record.totalRows === "number" ? record.totalRows : typeof record.total_rows === "number" ? record.total_rows : 0;
  const rows = requireArray(record.rows, "preview rows").map((row, index) => {
    const r = requireRecord(row, "preview row");
    return {
      index: typeof r.index === "number" ? r.index : index,
      mapped: isRecord(r.mapped) ? r.mapped : {},
      raw: isRecord(r.raw) ? r.raw : {},
    };
  });
  return { versionId, totalRows, rows };
}
