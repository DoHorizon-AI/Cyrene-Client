// -----------------------------------------------------------------------------
// Module: services/echo/src/api.ts
// Role: Same-origin HTTP adapter for the Echo evaluation workbench.
// -----------------------------------------------------------------------------
// 中文：模块职责：为 Echo 评测工作台提供同源 HTTP 适配。

import { NAVIGATOR_PROXY_PATHS, type JsonRecord, type NavigatorApi } from "../../navigator/src/api";

export type EchoTransport = Pick<NavigatorApi, "requestProductResponse">;

export interface ArtifactRef extends JsonRecord {
  uri: string;
  digest: string;
  size_bytes: number;
  kind: string;
  manifest_digest?: string;
}

export interface EvaluationSuite extends JsonRecord {
  id: string;
  name: string;
  evaluator: string;
  expectedField: string;
  actualField: string;
  threshold: number;
}

export interface EvaluationInput extends JsonRecord {
  id: string;
  state: string;
  sourceRef?: JsonRecord;
  targetDatasetVersion?: string;
  targetPackageArtifact?: ArtifactRef;
  evaluationRun?: JsonRecord | null;
}

export interface EvaluationRun extends JsonRecord {
  id: string;
  state: string;
  resultId?: string | null;
  failure?: JsonRecord | null;
}

export interface EvaluationSample extends JsonRecord {
  id?: string;
  sampleId?: string;
  sampleIndex?: number;
  inputRecord?: JsonRecord;
  expected?: unknown;
  actual?: unknown;
  passed?: boolean;
  score?: number;
}

export interface EvaluationReport extends JsonRecord {
  schemaVersion: "cyrene.echo.evaluation-report.v1";
  resultId: string;
  target: { versionRef: string; packageDigest: string };
  inputDigest: string;
  evaluator: { id: string; version: string };
  coverage: { total: number; evaluated: number; failed: number; skipped: number };
  metrics: { name: string; matched: number; evaluated: number; value: number }[];
  samples: { sampleId: string; status: string; exactMatch?: boolean; code?: string; message?: string }[];
}

const ECHO_API = `${NAVIGATOR_PROXY_PATHS.echo}/api/v1`;
const ECHO_LEGACY_API = NAVIGATOR_PROXY_PATHS.echo;
const CATALYST_API = `${NAVIGATOR_PROXY_PATHS.catalyst}/api/v1`;

/**
 * Encapsulate the trial APIs behind Navigator's paired same-origin transport.
 * Product service tokens are never accepted by this browser module.
 * 中文：通过 Navigator 配对的同源传输封装试用 API；浏览器模块不接收 Product 服务令牌。
 */
export class EchoApi {
  constructor(private readonly transport: EchoTransport) {}

  async listCatalystDatasets(signal?: AbortSignal): Promise<JsonRecord[]> {
    return this.json(`${CATALYST_API}/datasets`, { method: "GET", signal });
  }

  async listDataToolsVersions(datasetId: string, signal?: AbortSignal): Promise<JsonRecord[]> {
    return this.json(`${CATALYST_API}/datasets/${pathId(datasetId)}/data-tools/versions`, { method: "GET", signal });
  }

  async createSuite(input: {
    name: string;
    evaluator: "exact_match.v1";
    expectedField: "reference";
    actualField: "actual";
    threshold: number;
  }): Promise<EvaluationSuite> {
    return this.json(`${ECHO_LEGACY_API}/evaluation-suites`, jsonRequest("POST", input));
  }

  async getSuite(suiteId: string, signal?: AbortSignal): Promise<EvaluationSuite> {
    return this.json(`${ECHO_LEGACY_API}/evaluation-suites/${pathId(suiteId)}`, { method: "GET", signal });
  }

  async uploadJsonl(file: File): Promise<ArtifactRef> {
    const response = await this.transport.requestProductResponse(`${ECHO_API}/session-artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/jsonl", Accept: "application/json" },
      body: file,
    });
    return readJsonResponse<ArtifactRef>(response);
  }

  async createInput(input: {
    sourceRef: { uri: string; id: string; resourceVersion: number };
    artifact: ArtifactRef;
    format: "CYRENE_REFERENCE_ACTUAL_JSONL_V1";
    contentRefs: string[];
    provenanceRefs: string[];
    targetDatasetVersion: string;
    targetPackageArtifact: ArtifactRef;
  }): Promise<EvaluationInput> {
    return this.json(`${ECHO_API}/evaluation-inputs`, jsonRequest("POST", input));
  }

  async listInputs(signal?: AbortSignal): Promise<EvaluationInput[]> {
    return this.json(`${ECHO_API}/evaluation-inputs`, { method: "GET", signal });
  }

  async getInputSamples(inputId: string, signal?: AbortSignal): Promise<JsonRecord> {
    return this.json(`${ECHO_API}/evaluation-inputs/${pathId(inputId)}/samples`, { method: "GET", signal });
  }

  async evaluateInput(inputId: string, suiteId: string): Promise<EvaluationRun> {
    return this.json(`${ECHO_API}/evaluation-inputs/${pathId(inputId)}/actions/evaluate`, jsonRequest("POST", {
      suiteId,
      engineBindingId: "exact-match-plugin",
    }));
  }

  async getRun(runId: string, signal?: AbortSignal): Promise<EvaluationRun> {
    return this.json(`${ECHO_API}/evaluation-runs/${pathId(runId)}`, { method: "GET", signal });
  }

  async getRunSamples(runId: string, signal?: AbortSignal): Promise<EvaluationSample[]> {
    return this.json(`${ECHO_API}/evaluation-runs/${pathId(runId)}/samples?limit=1000&offset=0`, { method: "GET", signal });
  }

  async getReport(resultId: string, signal?: AbortSignal): Promise<EvaluationReport> {
    const response = await this.transport.requestProductResponse(`${ECHO_API}/evaluation-results/${pathId(resultId)}/export`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    return readJsonResponse<EvaluationReport>(response);
  }

  async downloadReport(resultId: string): Promise<Blob> {
    const response = await this.transport.requestProductResponse(`${ECHO_API}/evaluation-results/${pathId(resultId)}/export`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw await responseError(response);
    return response.blob();
  }

  private async json<T>(path: string, init: RequestInit): Promise<T> {
    return readJsonResponse<T>(await this.transport.requestProductResponse(path, init));
  }
}

/** Validate JSONL shape and stable sample identity before the immutable upload. */
export function inspectReferenceActualJsonl(text: string): {
  sampleIds: string[];
  total: number;
  evaluable: number;
  missingReference: number;
  missingActual: number;
} {
  const sampleIds: string[] = [];
  const seen = new Set<string>();
  let evaluable = 0, missingReference = 0, missingActual = 0;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); }
    catch { throw new Error(`Line ${index + 1} is not valid JSON.`); }
    if (!isRecord(value) || typeof value.sampleId !== "string" || !value.sampleId.trim()) {
      throw new Error(`Line ${index + 1} must include a non-empty string sampleId.`);
    }
    for (const field of ["reference", "actual"] as const) {
      if (value[field] !== undefined && value[field] !== null && typeof value[field] !== "string") {
        throw new Error(`Line ${index + 1} field ${field} must be a string when present.`);
      }
    }
    const sampleId = value.sampleId;
    if (seen.has(sampleId)) throw new Error(`Line ${index + 1} repeats sampleId ${sampleId}.`);
    seen.add(sampleId);
    sampleIds.push(sampleId);
    const hasReference = value.reference !== undefined && value.reference !== null;
    const hasActual = value.actual !== undefined && value.actual !== null;
    if (!hasReference) missingReference += 1;
    if (!hasActual) missingActual += 1;
    if (hasReference && hasActual) evaluable += 1;
  }
  if (sampleIds.length === 0) throw new Error("The JSONL file has no sample records.");
  if (sampleIds.length > 1000) throw new Error("Echo accepts at most 1,000 samples in one input.");
  return { sampleIds, total: sampleIds.length, evaluable, missingReference, missingActual };
}

/** Read a JSON Product response and preserve RFC 9457 detail on failure. */
async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) as unknown : undefined; }
  catch { throw new Error(`Product returned an invalid JSON response (HTTP ${response.status}).`); }
  if (!response.ok) throw formatProblem(response.status, payload);
  return payload as T;
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text();
  try { return formatProblem(response.status, JSON.parse(text) as unknown); }
  catch { return new Error(`Product request failed (HTTP ${response.status}).`); }
}

function formatProblem(status: number, value: unknown): Error {
  if (!isRecord(value)) return new Error(`Product request failed (HTTP ${status}).`);
  const detail = typeof value.detail === "string" ? value.detail
    : typeof value.message === "string" ? value.message
      : typeof value.title === "string" ? value.title : `Product request failed (HTTP ${status}).`;
  const code = typeof value.code === "string" ? `${value.code}: ` : "";
  return new Error(`${code}${detail}`);
}

function jsonRequest(method: "POST", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify(body),
  };
}

function pathId(value: string): string {
  const id = value.trim();
  if (!id || /[\\/]/.test(id)) throw new Error("Product resource identifier is invalid.");
  return encodeURIComponent(id);
}

function idempotencyKey(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `echo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
