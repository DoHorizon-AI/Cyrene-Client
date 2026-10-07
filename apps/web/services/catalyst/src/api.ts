// -----------------------------------------------------------------------------
// Module: services/catalyst/src/api.ts
// Role: Typed Catalyst data-tools client over the authenticated same-origin bridge.
// 中文：通过已认证的同源桥接访问 Catalyst 数据工具 API。
// -----------------------------------------------------------------------------

const CATALYST_PROXY = "/api/v1/catalyst";
export const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

export interface ProductResponseTransport {
  requestProductResponse(path: string, init?: RequestInit): Promise<Response>;
}

export interface ArtifactRef {
  uri: string;
  digest: string;
  size_bytes: number;
  kind: string;
  manifest_digest?: string;
}

export interface SourceRevision {
  id: string;
  datasetId: string;
  sourceId: string;
  revision: number;
  filename: string;
  mediaType: string;
  byteLength: number;
  digest: string;
  artifact: ArtifactRef;
  createdAt: string;
  resourceVersion: number;
}

export interface ContentPolicy {
  allowKnowledge: boolean;
  allowTraining: boolean;
  allowedPrincipalRefs: string[];
  allowedUsePurposes: string[];
}

export interface ContentBlock {
  id: string;
  sourceRevisionId: string;
  ordinal: number;
  kind: string;
  text: string;
  locator: {
    sourcePages?: number[];
    sectionPath?: string[];
    itemRef?: string;
    treeLevel?: number;
    startOffset?: number;
    endOffset?: number;
    tableIndex?: number;
    provenance?: unknown[];
  };
  origin: "EXTRACTED" | "NORMALIZED" | "HUMAN_EDITED" | "GENERATED";
  policy: ContentPolicy;
}

export interface ContentRevision {
  id: string;
  datasetId: string;
  revision: number;
  parentRevisionId?: string;
  sourceRevisionIds: string[];
  state: "DRAFT" | "APPROVED" | "REJECTED";
  blocks: ContentBlock[];
  createdAt: string;
  reviewedAt?: string;
  reviewNote?: string;
  resourceVersion: number;
}

export interface ContentBlockPage {
  revisionId: string;
  offset: number;
  limit: number;
  total: number;
  blocks: ContentBlock[];
}

export type RunOperation = "parse" | "buildKnowledge" | "prepareSft" | "generateQa";
export type RunState = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "INTERRUPTED";

export interface ProcessingFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ProcessingWarning {
  code: string;
  message: string;
}

export interface ProcessingRun {
  id: string;
  datasetId: string;
  operation: RunOperation;
  state: RunState;
  sourceRevisionIds: string[];
  contentRevisionId?: string;
  recipe: Record<string, unknown>;
  recipeDigest: string;
  progress?: { completed: number; total?: number };
  outputArtifacts: ArtifactRef[];
  warnings: ProcessingWarning[];
  failure?: ProcessingFailure;
  retryOfRunId?: string;
  createdAt: string;
  updatedAt: string;
  resourceVersion: number;
}

export interface DatasetVersion {
  id: string;
  datasetId: string;
  createdAt?: string;
  publishedAt?: string;
  resourceVersion?: number;
  dataTools?: {
    contentRevisionId: string;
    sourceRevisionIds: string[];
    knowledgeProfile: string;
    knowledgeArtifact: ArtifactRef;
    sftProfile: string;
    sftArtifact: ArtifactRef;
    stale: boolean;
  };
}

export interface CreateProcessingRunRequest {
  operation: RunOperation;
  sourceRevisionIds?: string[];
  contentRevisionId?: string;
  config?: {
    sftMode?: "instruction" | "conversation";
    split?: { train: number; validation: number; test: number };
    generation?: {
      maxExamples: number;
      maxCalls: number;
      maxInputTokens?: number;
      maxOutputTokens?: number;
    };
  };
}

export interface EditBlockRequest {
  text?: string;
  expectedRevisionId: string;
  policy?: ContentPolicy;
}

export class CatalystClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CatalystClientError";
  }
}

/**
 * Calls Catalyst data-tools routes through Navigator's authenticated same-origin bridge.
 * 所有 Catalyst 数据工具写操作都经由 Navigator 会话桥接，避免绕开认证与 CSRF。
 */
export class CatalystDataToolsClient {
  constructor(private readonly transport: ProductResponseTransport) {}

  listSources(datasetId: string): Promise<SourceRevision[]> {
    return this.json(this.datasetPath(datasetId, "sources"));
  }

  async createSource(datasetId: string, file: File): Promise<SourceRevision> {
    assertSupportedSource(file);
    if (file.size > MAX_SOURCE_BYTES) {
      throw new CatalystClientError("Files must be 32 MiB or smaller.", 413, "file_too_large");
    }
    const query = new URLSearchParams({ filename: file.name });
    return this.json(this.datasetPath(datasetId, `sources?${query}`), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
  }

  listProcessingRuns(datasetId: string): Promise<ProcessingRun[]> {
    return this.json(this.datasetPath(datasetId, "processing-runs"));
  }

  createProcessingRun(datasetId: string, request: CreateProcessingRunRequest): Promise<ProcessingRun> {
    return this.json(this.datasetPath(datasetId, "processing-runs"), jsonRequest("POST", request));
  }

  getProcessingRun(runId: string): Promise<ProcessingRun> {
    return this.json(this.route(`/api/v1/processing-runs/${pathId(runId)}`));
  }

  cancelProcessingRun(runId: string): Promise<ProcessingRun> {
    return this.json(this.route(`/api/v1/processing-runs/${pathId(runId)}/cancel`), { method: "POST" });
  }

  retryProcessingRun(runId: string): Promise<ProcessingRun> {
    return this.json(this.route(`/api/v1/processing-runs/${pathId(runId)}/retry`), { method: "POST" });
  }

  listContentRevisions(datasetId: string): Promise<ContentRevision[]> {
    return this.json(this.datasetPath(datasetId, "content-revisions"));
  }

  getBlocks(revisionId: string, offset = 0, limit = 100): Promise<ContentBlockPage> {
    const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    return this.json(this.route(`/api/v1/content-revisions/${pathId(revisionId)}/blocks?${query}`));
  }

  editBlock(revisionId: string, blockId: string, request: EditBlockRequest): Promise<ContentRevision> {
    return this.json(
      this.route(`/api/v1/content-revisions/${pathId(revisionId)}/blocks/${pathId(blockId)}/edits`),
      jsonRequest("POST", request),
    );
  }

  reviewContent(revisionId: string, decision: "APPROVE" | "REJECT", note?: string): Promise<ContentRevision> {
    return this.json(
      this.route(`/api/v1/content-revisions/${pathId(revisionId)}/review`),
      jsonRequest("POST", { decision, ...(note?.trim() ? { note: note.trim() } : {}) }),
    );
  }

  listVersions(datasetId: string): Promise<DatasetVersion[]> {
    return this.json(this.datasetPath(datasetId, "data-tools/versions"));
  }

  publishVersion(
    datasetId: string,
    request: { contentRevisionId: string; knowledgeRunId: string; sftRunId: string },
  ): Promise<DatasetVersion> {
    return this.json(this.datasetPath(datasetId, "data-tools/versions"), jsonRequest("POST", request));
  }

  async downloadExport(versionId: string, profile: "knowledge" | "sft"): Promise<{ blob: Blob; filename: string }> {
    const query = new URLSearchParams({ profile });
    const response = await this.transport.requestProductResponse(
      this.route(`/api/v1/dataset-versions/${pathId(versionId)}/data-tools/export?${query}`),
      { method: "GET", headers: { Accept: "application/zip" } },
    );
    if (!response.ok) throw await responseError(response);
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/zip" && mediaType !== "application/x-zip-compressed") {
      throw new CatalystClientError("Catalyst did not return a downloadable package.", response.status, "invalid_export_response");
    }
    return { blob: await response.blob(), filename: responseFilename(response) ?? `${profile}.zip` };
  }

  private datasetPath(datasetId: string, suffix: string): string {
    return this.route(`/api/v1/datasets/${pathId(datasetId)}/${suffix}`);
  }

  private route(path: string): string {
    return `${CATALYST_PROXY}${path}`;
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.transport.requestProductResponse(path, init);
    if (!response.ok) throw await responseError(response);
    try {
      return await response.json() as T;
    } catch {
      throw new CatalystClientError("Catalyst returned an unreadable response.", response.status);
    }
  }
}

/** Returns concise user-facing language without exposing machine codes or executor details. */
export function userFacingCatalystError(error: unknown): string {
  if (!(error instanceof CatalystClientError)) {
    return error instanceof Error && error.message ? error.message : "The request could not be completed. Try again.";
  }
  return messageForCode(error.code, error.message, error.status);
}

/** Converts persisted run failures to user-facing copy without showing internal codes. */
export function userFacingRunFailure(failure: ProcessingFailure | undefined): string {
  if (!failure) return "This step did not finish. Review the status and try again if the action is available.";
  return messageForCode(failure.code, failure.message, 500);
}

export function isRunActive(run: ProcessingRun): boolean {
  return run.state === "QUEUED" || run.state === "RUNNING";
}

function assertSupportedSource(file: File): void {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (extension !== ".pdf" && extension !== ".docx") {
    throw new CatalystClientError("Choose a PDF or Word document (.docx).", 415, "unsupported_media_type");
  }
}

function pathId(value: string): string {
  return encodeURIComponent(value);
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function responseError(response: Response): Promise<CatalystClientError> {
  let code: string | undefined;
  let detail = "The request could not be completed.";
  try {
    const value: unknown = await response.json();
    if (isRecord(value)) {
      if (typeof value["code"] === "string") code = value["code"];
      if (typeof value["detail"] === "string") detail = value["detail"];
      else if (typeof value["title"] === "string") detail = value["title"];
    }
  } catch {
    // Keep the public message generic when a proxy returns a non-JSON body.
  }
  return new CatalystClientError(messageForCode(code, detail, response.status), response.status, code);
}

function messageForCode(code: string | undefined, detail: string, status: number): string {
  const normalized = `${code ?? ""} ${detail}`.toLowerCase();
  if (normalized.includes("unsupported") || normalized.includes("unsupported_media") || status === 415) {
    return "This file type is unsupported. Choose a PDF or Word document (.docx).";
  }
  if (normalized.includes("too_large") || normalized.includes("file_too_large") || status === 413) {
    return "This file exceeds the 32 MiB upload limit.";
  }
  if (["not_configured", "configuration_missing", "binding_missing", "connection_ref", "provider_unavailable", "not_available"]
    .some((hint) => normalized.includes(hint))) {
    return "This capability is not configured for this workspace. Ask an administrator to enable it.";
  }
  if (status === 401 || status === 403) return "You do not have permission to make this change. Sign in again or ask an administrator.";
  if (/traceback|stack trace|toolchain|pip install|python executable|plugin entrypoint/i.test(detail)) {
    return "This step could not run because a workspace capability is unavailable. Ask an administrator to check the configuration.";
  }
  return detail;
}

function responseFilename(response: Response): string | null {
  const disposition = response.headers.get("content-disposition");
  if (!disposition) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (utf8) {
    try { return decodeURIComponent(utf8); } catch { return null; }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  return plain ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
