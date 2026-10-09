import { text } from "../components";
import { type JsonRecord, NavigatorApi, NavigatorContractError, NavigatorHttpError, type SessionPayload } from "../api";
import { runIdForLocation } from "../router";
import { useI18n } from "../i18n";

export interface PageProps {
  api: NavigatorApi;
}

export interface SettingsPageProps extends PageProps {
  session: SessionPayload;
}

export function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="detail-item">
      <dt>{t(label)}</dt>
      <dd className={mono ? "input-mono" : undefined}>{t(value)}</dd>
    </div>
  );
}

export function settledValue<T>(result: PromiseSettledResult<T>, label: string, failures: string[]): T | null {
  if (result.status === "fulfilled") {
    return result.value;
  }
  failures.push(`${label}: ${errorMessage(result.reason)}`);
  return null;
}

export function resourceId(row: JsonRecord, index = 0): string {
  return typeof row["id"] === "string" ? row["id"] : `resource-${index}`;
}

export function nestedRecord(row: JsonRecord, key: string): JsonRecord | null {
  const value = row[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

export function datasetVersionLabel(row: JsonRecord): string {
  const version = nestedRecord(row, "datasetVersion");
  return text(version?.["id"], "Not attached");
}

export function validationSummary(row: JsonRecord): string {
  const validation = nestedRecord(row, "validation");
  if (!validation) {
    return "Pending evidence";
  }
  const checks = ["weights", "config", "tokenizer", "chatTemplate"];
  const passed = checks.filter((key) => validation[key] === true).length;
  const issues = Array.isArray(validation["issues"]) ? validation["issues"].length : 0;
  return `${passed}/${checks.length} checks${issues ? ` | ${issues} issue${issues === 1 ? "" : "s"}` : ""}`;
}

export function endpointSummary(row: JsonRecord) {
  const endpoint = row["endpointId"];
  return typeof endpoint === "string" ? <span className="input-mono">{endpoint}</span> : <span className="muted">Not ready</span>;
}

export function initialRunId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return runIdForLocation(window.location);
}

export function errorMessage(error: unknown): string {
  if (error instanceof NavigatorHttpError) {
    return `${error.detail} (${error.code})`;
  }
  if (error instanceof NavigatorContractError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "The Navigator request failed without a readable error.";
}
