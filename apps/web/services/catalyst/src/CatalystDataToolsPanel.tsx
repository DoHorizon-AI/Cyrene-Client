// -----------------------------------------------------------------------------
// Module: services/catalyst/src/CatalystDataToolsPanel.tsx
// Role: Source review, dual-recipe preparation, publication, and download UI.
// 中文：提供来源审核、双 recipe 准备、发布与下载界面。
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";

import { Button, Field, Panel, StateBlock, StatusPill, statusTone, WorkflowSteps, type WorkflowStep, type WorkflowStepState } from "../../navigator/src/components";
import { useI18n } from "../../navigator/src/i18n";
import {
  CatalystDataToolsClient,
  contentApprovalBlockReason,
  isRunActive,
  MAX_BATCH_REQUEST_BYTES,
  MAX_BATCH_SOURCE_COUNT,
  MAX_BATCH_STORED_BYTES,
  MAX_SOURCE_BYTES,
  userFacingCatalystError,
  userFacingParseFailure,
  userFacingRunFailure,
  userFacingSourceItemError,
  type ContentBlock,
  type ContentPolicy,
  type ContentApprovalBlockReason,
  type ContentRevision,
  type ContentRevisionSummary,
  type CreateProcessingRunRequest,
  type DatasetVersion,
  type ProcessingRun,
  type ProductResponseTransport,
  type ReviewItem,
  type ReviewQueue,
  type RunOperation,
  type SourceBatchItem,
  type SourceParseReport,
  type SourceRevision,
} from "./api";
import { catalystText } from "./copy";
import "./catalyst.css";

type LoadErrors = { sources: string | null; revisions: string | null; runs: string | null; versions: string | null; parseReports: string | null; reviewQueue: string | null };
type BlockEdit = { text: string; policy: ContentPolicy };

/**
 * Catalyst-owned document lifecycle embedded in the existing Datasets page.
 * 将 Catalyst 文档生命周期嵌入既有数据集页面，工作状态始终由 Product API 管理。
 */
export function CatalystDataToolsPanel({
  datasets,
  datasetsLoading = false,
  datasetsError = null,
  onRefreshDatasets,
  transport,
}: {
  datasets: readonly Record<string, unknown>[] | null;
  datasetsLoading?: boolean;
  datasetsError?: string | null;
  onRefreshDatasets?: () => void;
  transport: ProductResponseTransport;
}) {
  const { locale } = useI18n();
  const l = (value: string) => catalystText(value, locale);
  const client = useMemo(() => new CatalystDataToolsClient(transport), [transport]);
  const [datasetId, setDatasetId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [sources, setSources] = useState<SourceRevision[] | null>(null);
  const [revisions, setRevisions] = useState<ContentRevision[] | null>(null);
  const [runs, setRuns] = useState<ProcessingRun[] | null>(null);
  const [versions, setVersions] = useState<DatasetVersion[] | null>(null);
  const [parseReports, setParseReports] = useState<SourceParseReport[] | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueue | null>(null);
  const [uploadResults, setUploadResults] = useState<SourceBatchItem[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [loadErrors, setLoadErrors] = useState<LoadErrors>({ sources: null, revisions: null, runs: null, versions: null, parseReports: null, reviewQueue: null });
  const [pollErrors, setPollErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [blockTotal, setBlockTotal] = useState(0);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [blocksError, setBlocksError] = useState<string | null>(null);
  const [blockReloadKey, setBlockReloadKey] = useState(0);
  const [edits, setEdits] = useState<Record<string, BlockEdit>>({});
  const [reviewNote, setReviewNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [sftMode, setSftMode] = useState<"instruction" | "conversation">("instruction");
  const [trainPercent, setTrainPercent] = useState(70);
  const [validationPercent, setValidationPercent] = useState(15);
  const [testPercent, setTestPercent] = useState(15);
  const [maxExamples, setMaxExamples] = useState(20);
  const [maxCalls, setMaxCalls] = useState(3);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const selectedRevision = revisions?.find((revision) => revision.id === selectedRevisionId) ?? null;
  const approvedRevision = selectedRevision?.state === "APPROVED" ? selectedRevision : null;
  const selectedRuns = runs?.filter((run) => run.contentRevisionId === selectedRevisionId) ?? [];
  const knowledgeRuns = selectedRuns.filter((run) => run.operation === "buildKnowledge" && run.state === "SUCCEEDED");
  const sftRuns = selectedRuns.filter((run) => run.operation === "prepareSft" && run.state === "SUCCEEDED");
  const selectedKnowledgeRunId = knowledgeRuns[0]?.id ?? "";
  const selectedSftRunId = sftRuns[0]?.id ?? "";
  const splitIsValid = trainPercent + validationPercent + testPercent === 100;
  const approvalGateReason = contentApprovalBlockReason(
    selectedRevisionId,
    selectedRevision?.sourceRevisionIds ?? [],
    parseReports,
    reviewQueue,
    Boolean(loadErrors.reviewQueue || loadErrors.parseReports),
  );
  const approvalBlocked = approvalGateReason !== null;
  const approvalBlockReason = approvalGateCopy(approvalGateReason);
  const workflow = catalystWorkflow({
    locale,
    sources,
    runs,
    revisions,
    versions,
    unavailable: loadErrors,
    selectedRevision,
    approvedRevision,
    selectedRuns,
    knowledgeReady: selectedKnowledgeRunId !== "",
    sftReady: selectedSftRunId !== "",
  });

  useEffect(() => {
    if (!datasetId) {
      setSources(null);
      setRevisions(null);
      setRuns(null);
      setVersions(null);
      setParseReports(null);
      setReviewQueue(null);
      setUploadResults([]);
      setReviewNotes({});
      setSelectedRevisionId("");
      setLoadErrors({ sources: null, revisions: null, runs: null, versions: null, parseReports: null, reviewQueue: null });
      return;
    }

    let active = true;
    setLoading(true);
    setLoadErrors({ sources: null, revisions: null, runs: null, versions: null, parseReports: null, reviewQueue: null });
    void Promise.allSettled([
      client.listSources(datasetId),
      client.listContentRevisions(datasetId),
      client.listProcessingRuns(datasetId),
      client.listVersions(datasetId),
      client.listSourceParseReports(datasetId),
      client.getReviewQueue(datasetId),
    ]).then(([sourceResult, revisionResult, runResult, versionResult, parseReportResult, reviewQueueResult]) => {
      if (!active) return;
      const errors: LoadErrors = { sources: null, revisions: null, runs: null, versions: null, parseReports: null, reviewQueue: null };
      if (sourceResult.status === "fulfilled") setSources(sourceResult.value);
      else { setSources(null); errors.sources = userFacingCatalystError(sourceResult.reason); }
      if (revisionResult.status === "fulfilled") {
        setRevisions(revisionResult.value);
        setSelectedRevisionId((current) => revisionResult.value.some((revision) => revision.id === current)
          ? current
          : revisionResult.value[0]?.id ?? "");
      } else { setRevisions(null); errors.revisions = userFacingCatalystError(revisionResult.reason); }
      if (runResult.status === "fulfilled") setRuns(runResult.value);
      else { setRuns(null); errors.runs = userFacingCatalystError(runResult.reason); }
      if (versionResult.status === "fulfilled") setVersions(versionResult.value);
      else { setVersions(null); errors.versions = userFacingCatalystError(versionResult.reason); }
      if (parseReportResult.status === "fulfilled") setParseReports(parseReportResult.value);
      else { setParseReports(null); errors.parseReports = userFacingCatalystError(parseReportResult.reason); }
      if (reviewQueueResult.status === "fulfilled") setReviewQueue(reviewQueueResult.value);
      else { setReviewQueue(null); errors.reviewQueue = userFacingCatalystError(reviewQueueResult.reason); }
      setLoadErrors(errors);
      setLoading(false);
    });
    return () => { active = false; };
  }, [client, datasetId, reloadKey]);

  useEffect(() => {
    if (!selectedRevisionId) {
      setBlocks([]);
      setBlockTotal(0);
      setBlocksError(null);
      setEdits({});
      return;
    }
    let active = true;
    setBlocksLoading(true);
    setBlocksError(null);
    setEdits({});
    void client.getBlocks(selectedRevisionId, 0, 50).then(
      (page) => {
        if (!active) return;
        setBlocks(page.blocks);
        setBlockTotal(page.total);
        setBlocksLoading(false);
      },
      (error: unknown) => {
        if (!active) return;
        setBlocksError(userFacingCatalystError(error));
        setBlocksLoading(false);
      },
    );
    return () => { active = false; };
  }, [client, selectedRevisionId, blockReloadKey]);

  const activeRunIds = runs?.filter(isRunActive).map((run) => run.id).sort().join("|") ?? "";
  useEffect(() => {
    if (!activeRunIds) return;
    let active = true;
    const timer = window.setInterval(() => {
      const ids = activeRunIds.split("|").filter(Boolean);
      void Promise.allSettled(ids.map((id) => client.getProcessingRun(id))).then((results) => {
        if (!active) return;
        setPollErrors((current) => {
          const next = { ...current };
          results.forEach((result, index) => {
            const id = ids[index];
            if (result.status === "fulfilled") delete next[id];
            else next[id] = `Could not refresh this run's status. ${userFacingCatalystError(result.reason)}`;
          });
          return next;
        });
        const completedRuns = results.flatMap((result) => result.status === "fulfilled" && !isRunActive(result.value) ? [result.value] : []);
        const newReviewAvailable = completedRuns.some((run) => run.state === "SUCCEEDED" && (run.operation === "parse" || run.operation === "generateQa"));
        setRuns((current) => {
          if (!current) return current;
          const next = [...current];
          for (const result of results) {
            if (result.status !== "fulfilled") continue;
            const index = next.findIndex((run) => run.id === result.value.id);
            if (index < 0) next.unshift(result.value);
            else next[index] = result.value;
          }
          return next.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
        });
        if (completedRuns.length > 0) {
          if (newReviewAvailable) setSelectedRevisionId("");
          setReloadKey((value) => value + 1);
        }
      });
    }, 1800);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeRunIds, client]);

  const refresh = () => setReloadKey((value) => value + 1);

  const perform = async (key: string, task: () => Promise<void>) => {
    setBusyAction(key);
    setActionError(null);
    setNotice(null);
    try { await task(); }
    catch (error) { setActionError(userFacingCatalystError(error)); }
    finally { setBusyAction(null); }
  };

  const startRun = async (request: CreateProcessingRunRequest) => {
    if (!datasetId) throw new Error("Choose a dataset first.");
    const run = await client.createProcessingRun(datasetId, request);
    setRuns((current) => [run, ...(current ?? []).filter((item) => item.id !== run.id)]);
    setNotice(locale === "zh-CN"
      ? `${l(operationLabel(run.operation))}已启动，状态会在此更新。`
      : `${operationLabel(run.operation)} started. Its status will update here.`);
  };

  const handleBatchUpload = async (files: readonly File[]) => {
    if (!datasetId) { setActionError("Choose a dataset before uploading."); return; }
    if (files.length === 0) return;
    setBusyAction("upload");
    setActionError(null);
    setNotice(null);
    setUploadResults([]);
    try {
      const response = await client.uploadSourcesBatch(datasetId, files);
      setUploadResults(response.items);
      const uploaded = response.items.flatMap((item) => item.source ? [item.source] : []);
      if (uploaded.length > 0) {
        setSources((current) => [...uploaded, ...(current ?? []).filter((source) => !uploaded.some((item) => item.id === source.id))]);
      }
      const failedItems = response.items.filter((item) => item.error !== null);
      if (uploaded.length > 0) {
        try {
          const run = await client.createProcessingRun(datasetId, {
            operation: "parse",
            sourceRevisionIds: uploaded.map((source) => source.id),
          });
          setRuns((current) => [run, ...(current ?? []).filter((item) => item.id !== run.id)]);
          setNotice(locale === "zh-CN"
            ? `${uploaded.length} 个文件已保存，文档解析与校对已启动。${failedItems.length ? `另有 ${failedItems.length} 个文件未能保存，请查看逐项结果。` : ""}`
            : `${uploaded.length} files were stored and document review has started.${failedItems.length ? ` ${failedItems.length} other files could not be stored; see the per-file results.` : ""}`);
        } catch (parseError) {
          setActionError(locale === "zh-CN"
            ? `文件已保存，但无法启动文档解析与校对。${l(userFacingCatalystError(parseError))}`
            : `The files were stored, but document review could not start. ${userFacingCatalystError(parseError)}`);
          refresh();
        }
      } else if (failedItems.length > 0) {
        setNotice(locale === "zh-CN" ? "没有文件保存成功；请查看逐项失败原因。" : "No files were stored. Review the per-file failure reasons.");
      } else {
        setActionError(locale === "zh-CN" ? "Catalyst 未确认任何文件结果，请刷新来源列表核实。" : "Catalyst did not confirm any file results. Refresh the source list to verify.");
        refresh();
      }
    } catch (error) {
      setActionError(userFacingCatalystError(error));
      refresh();
    } finally {
      setBusyAction(null);
    }
  };

  const openRevision = (revisionId: string) => {
    setSelectedRevisionId(revisionId);
    window.requestAnimationFrame(() => document.querySelector(".catalyst-tools__revision-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const openGeneratedDraft = async (draft: ContentRevisionSummary) => {
    const existing = revisions?.find((revision) => revision.id === draft.id);
    if (existing) { openRevision(existing.id); return; }
    await perform(`open-draft:${draft.id}`, async () => {
      const latest = await client.listContentRevisions(datasetId);
      setRevisions(latest);
      const found = latest.find((revision) => revision.id === draft.id);
      if (!found) throw new Error("The generated draft is no longer available. Refresh the review queue.");
      openRevision(found.id);
    });
  };

  const openReviewItem = async (item: ReviewItem) => {
    const revisionId = item.contentRevisionId
      ?? revisions?.find((revision) => revision.sourceRevisionIds.includes(item.sourceRevisionId))?.id;
    if (revisionId && revisions?.some((revision) => revision.id === revisionId)) { openRevision(revisionId); return; }
    if (!revisionId) return;
    await perform(`open-review:${item.id}`, async () => {
      const latest = await client.listContentRevisions(datasetId);
      setRevisions(latest);
      if (!latest.some((revision) => revision.id === revisionId)) throw new Error("The related content revision is no longer available. Refresh the review queue.");
      openRevision(revisionId);
    });
  };

  const updateBlockEdit = (block: ContentBlock, update: Partial<BlockEdit>) => {
    setEdits((current) => ({
      ...current,
      [block.id]: {
        text: current[block.id]?.text ?? block.text,
        policy: current[block.id]?.policy ?? { ...block.policy },
        ...update,
      },
    }));
  };

  const saveBlock = async (block: ContentBlock) => {
    if (!selectedRevision) return;
    const edit = edits[block.id] ?? { text: block.text, policy: block.policy };
    const textChanged = edit.text !== block.text;
    const policyChanged = !samePolicy(edit.policy, block.policy);
    if (!textChanged && !policyChanged) return;
    await perform(`edit:${block.id}`, async () => {
      const nextRevision = await client.editBlock(selectedRevision.id, block.id, {
        expectedRevisionId: selectedRevision.id,
        ...(textChanged ? { text: edit.text } : {}),
        ...(policyChanged ? { policy: normalizePolicy(edit.policy) } : {}),
      });
      setRevisions((current) => [nextRevision, ...(current ?? []).filter((revision) => revision.id !== nextRevision.id)]);
      setSelectedRevisionId(nextRevision.id);
      setEdits({});
      setNotice(locale === "zh-CN"
        ? `已保存为内容修订 ${nextRevision.revision}。先前修订仍可查看。`
        : `Saved as content revision ${nextRevision.revision}. Previous revisions remain available.`);
    });
  };

  const loadMoreBlocks = async () => {
    if (!selectedRevisionId || blocksLoading) return;
    setBlocksLoading(true);
    setBlocksError(null);
    try {
      const page = await client.getBlocks(selectedRevisionId, blocks.length, 50);
      setBlocks((current) => [...current, ...page.blocks]);
      setBlockTotal(page.total);
    } catch (error) { setBlocksError(userFacingCatalystError(error)); }
    finally { setBlocksLoading(false); }
  };

  const download = async (versionId: string, profile: "knowledge" | "sft") => {
    setDownloadError(null);
    setBusyAction(`download:${versionId}:${profile}`);
    try {
      const { blob, filename } = await client.downloadExport(versionId, profile);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename || `${profile}.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setDownloadError(userFacingCatalystError(error)); }
    finally { setBusyAction(null); }
  };

  const selectedDatasetName = datasets?.find((row) => String(row["id"] ?? row["datasetId"] ?? "") === datasetId)?.["name"];

  const selectDataset = (nextDatasetId: string) => {
    setDatasetId(nextDatasetId);
    setSources(null);
    setRevisions(null);
    setRuns(null);
    setVersions(null);
    setParseReports(null);
    setReviewQueue(null);
    setUploadResults([]);
    setReviewNotes({});
    setSelectedRevisionId("");
    setBlocks([]);
    setBlockTotal(0);
    setBlocksError(null);
    setEdits({});
    setLoadErrors({ sources: null, revisions: null, runs: null, versions: null, parseReports: null, reviewQueue: null });
    setActionError(null);
    setNotice(null);
    setDownloadError(null);
    setLoading(Boolean(nextDatasetId));
  };

  return (
    <div className="catalyst-tools">
      <Panel
        title={l("Review original documents and prepare both outputs")}
        meta={<span className="mono-label">{l("CATALYST DATA TOOLS")}</span>}
      >
        <div className="catalyst-tools__intro">
          <p>{l("Keep original source files, review extracted passages, then build knowledge and training packages from approved content.")}</p>
          <p className="catalyst-tools__limit">{l("Supported source formats and batch limits")}: PDF, DOCX, PPTX, XLSX, Markdown, TXT, CSV, PNG, JPEG, JSONL · {MAX_BATCH_SOURCE_COUNT} files · {formatBytes(MAX_SOURCE_BYTES)} per file · {formatBytes(MAX_BATCH_STORED_BYTES)} stored per batch · {formatBytes(MAX_BATCH_REQUEST_BYTES)} request cap</p>
        </div>

        {datasets === null ? (
          datasetsLoading
            ? <StateBlock kind="loading" title={l("Loading datasets")} detail={l("Reading the dataset list from Catalyst.")} />
            : <StateBlock kind="error" title={l("Dataset list unavailable")} detail={l(datasetsError ?? "Reconnect to Catalyst, then refresh this page.")} action={onRefreshDatasets ? <Button onClick={onRefreshDatasets}>{l("Try again")}</Button> : undefined} />
        ) : datasets.length === 0 ? (
          <StateBlock kind="empty" title={l("Create a dataset first")} detail={l("Create a dataset container above to start a document review.")} />
        ) : (
          <div className="catalyst-tools__selector-grid">
            <Field label={l("Dataset")} hint={l("Documents and published versions belong to this dataset.")}>
              <select value={datasetId} disabled={busyAction !== null} onChange={(event) => selectDataset(event.target.value)}>
                <option value="">{l("Select a dataset")}</option>
                {datasets.map((row, index) => {
                  const id = String(row["id"] ?? row["datasetId"] ?? "");
                  if (!id) return null;
                  return <option key={id || index} value={id}>{String(row["name"] ?? "Unnamed dataset")}</option>;
                })}
              </select>
            </Field>
            <div className="catalyst-tools__upload">
              <label className="field">
                <span className="field__label">{l("Upload source files")}</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.pptx,.xlsx,.md,.txt,.csv,.png,.jpg,.jpeg,.jsonl,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/markdown,text/plain,text/csv,image/png,image/jpeg,application/json"
                  disabled={!datasetId || busyAction !== null}
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    if (files.length > 0) void handleBatchUpload(files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <div className="catalyst-tools__selector-action">
              <Button onClick={refresh} disabled={!datasetId || loading} loading={loading && datasetId !== ""}>{loading ? l("Refreshing...") : l("Refresh data")}</Button>
            </div>
          </div>
        )}

        {busyAction === "upload" ? <p className="dh-notice catalyst-tools__uploading" role="status"><span className="button__spinner" aria-hidden="true" />{l("Uploading the file and starting document review...")}</p> : null}
        {actionError ? <p className="dh-notice dh-notice--danger" role="alert">{l(actionError)}</p> : null}
        {notice ? <p className="dh-notice dh-notice--success" role="status">{l(notice)}</p> : null}
        {uploadResults.length > 0 ? (
          <div className="catalyst-tools__source-list" aria-label={l("Batch upload results")}>
            {uploadResults.map((item, index) => <article className="catalyst-tools__source" key={item.source?.id ?? String(index)}>
              <div className="catalyst-tools__source-main">
                <strong>{item.filename}</strong>
                {item.source ? <span>{l("Stored source revision")} {item.source.revision} · {formatBytes(item.source.byteLength)}</span> : null}
                {item.error ? <p className="catalyst-tools__run-message" role="alert">{l(userFacingSourceItemError(item.error))}</p> : null}
              </div>
              <div className="catalyst-tools__source-status"><StatusPill value={l(item.source ? "UPLOADED" : "FAILED")} tone={statusTone(item.source ? "UPLOADED" : "FAILED")} />{item.error?.retryable ? <small>{l("This upload can be retried.")}</small> : null}</div>
            </article>)}
          </div>
        ) : null}
        {datasetId ? (
          <div className="catalyst-tools__progress">
            {selectedDatasetName ? <p className="catalyst-tools__current-dataset">{l("Working in")} <strong>{String(selectedDatasetName)}</strong></p> : null}
            <WorkflowSteps steps={workflow} label={l("Document workflow progress")} />
          </div>
        ) : null}
      </Panel>

      {datasetId ? (
        <>
          <Panel id="catalyst-sources" title={l("Original documents")} meta={sources ? `${sources.length} ${l("sources")}` : l("SOURCE FILES")}>
            {loadErrors.sources ? <StateBlock kind="error" title={l("Sources unavailable")} detail={l(loadErrors.sources)} action={<Button onClick={refresh}>{l("Try again")}</Button>} />
              : loading && sources === null ? <StateBlock kind="loading" title={l("Loading original files")} detail={l("Reading the source ledger from Catalyst.")} />
                : sources && sources.length > 0 ? (
                  <div className="catalyst-tools__source-list">
                    {sources.map((source) => {
                      const run = (runs ?? []).find((item) => item.operation === "parse" && item.sourceRevisionIds.includes(source.id));
                      const report = latestReportForSource(parseReports ?? [], source.id);
                      const rawStatus = report?.status ?? sourceStatus(run);
                      return (
                        <article className="catalyst-tools__source" key={source.id}>
                          <div className="catalyst-tools__source-main">
                            <strong>{source.filename}</strong>
                            <span>{source.mediaType} · {formatBytes(source.byteLength)} · revision {source.revision} · {formatDate(source.createdAt)}</span>
                            <span className="catalyst-tools__digest dh-id">{source.digest}</span>
                          </div>
                          <div className="catalyst-tools__source-status">
                            <StatusPill value={l(rawStatus)} tone={statusTone(rawStatus)} />
                            {report?.failure ? <p className="catalyst-tools__run-message">{l(userFacingParseFailure(report.failure))}</p> : null}
                            {!report?.failure && (run?.state === "FAILED" || run?.state === "INTERRUPTED") && run.failure ? <p>{l(userFacingRunFailure(run.failure))}</p> : null}
                            {report?.contentRevisionId ? <small>{l("Content revision")} {report.contentRevisionId}</small> : null}
                          </div>
                          {report && reportNeedsReview(report) ? <div className="catalyst-tools__source-main">
                            {report.warnings.length > 0 || report.diagnostics.length > 0 ? <ul className="catalyst-tools__warnings">
                              {[...report.warnings, ...report.diagnostics].map((warning, index) => <li key={String(index)}>
                                {l(userFacingWarning(warning.code, warning.message))}
                                {"kind" in warning ? <span> · {l(warning.kind === "ocr" ? "OCR review" : "Parser review")}</span> : null}
                                {"confidence" in warning && typeof warning.confidence === "number" ? <span> · {l("Confidence")} {formatPercent(warning.confidence)}</span> : null}
                                {"locator" in warning && warning.locator ? <small>{formatCatalystLocator(warning.locator, locale).join(" · ")}</small> : null}
                              </li>)}
                            </ul> : null}
                            {report.unsupportedContent.length > 0 ? <p>{l("Some embedded content could not be read.")} {report.unsupportedContent.map((item) => describeUnsupportedContent(item, locale)).filter(Boolean).join(" · ")}</p> : null}
                          </div> : null}
                        </article>
                      );
                    })}
                  </div>
                ) : <StateBlock kind="empty" title={l("No original documents yet")} detail={l("Upload supported source files. Catalyst retains the exact original bytes.")} />}
            {loadErrors.parseReports ? <StateBlock kind="error" title={l("Parse reports unavailable")} detail={l(loadErrors.parseReports)} action={<Button onClick={refresh}>{l("Try again")}</Button>} /> : null}
          </Panel>

          <Panel id="catalyst-activity" title={l("Processing activity")} meta={runs ? `${runs.length} ${l("runs")}` : l("LIVE STATUS")}>
            {loadErrors.runs ? <StateBlock kind="error" title={l("Processing status unavailable")} detail={l(loadErrors.runs)} action={<Button onClick={refresh}>{l("Try again")}</Button>} />
              : loading && runs === null ? <StateBlock kind="loading" title={l("Loading processing status")} detail={l("Reading recent work from Catalyst.")} />
                : runs && runs.length > 0 ? (
                  <div className="catalyst-tools__run-list">
                    {runs.slice(0, 12).map((run) => (
                      <article className="catalyst-tools__run" key={run.id}>
                        <div className="catalyst-tools__run-heading">
                          <strong>{l(operationLabel(run.operation))}</strong>
                          <StatusPill value={l(run.state)} tone={statusTone(run.state)} />
                        </div>
                        <p>{formatDate(run.updatedAt)}{run.progress ? ` · ${run.progress.completed}${run.progress.total ? ` of ${run.progress.total}` : ""} complete` : ""}</p>
                        {run.failure ? <p className="catalyst-tools__run-message">{l(userFacingRunFailure(run.failure))}</p> : null}
                        {pollErrors[run.id] ? <p className="catalyst-tools__run-message" role="alert">{l(pollErrors[run.id])}</p> : null}
                        {run.warnings.length > 0 ? (
                          <ul className="catalyst-tools__warnings">
                            {run.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{l(userFacingWarning(warning.code, warning.message))}</li>)}
                          </ul>
                        ) : null}
                        <div className="catalyst-tools__run-actions">
                          {isRunActive(run) ? <Button disabled={busyAction !== null} loading={busyAction === `cancel:${run.id}`} onClick={() => void perform(`cancel:${run.id}`, async () => {
                            const cancelled = await client.cancelProcessingRun(run.id);
                            setRuns((current) => replaceRun(current, cancelled));
                            setNotice("Cancellation was requested. The final status will appear here.");
                          })}>{l("Cancel")}</Button> : null}
                          {(run.state === "FAILED" || run.state === "INTERRUPTED") && run.failure?.retryable ? <Button disabled={busyAction !== null} loading={busyAction === `retry:${run.id}`} onClick={() => void perform(`retry:${run.id}`, async () => {
                            const retry = await client.retryProcessingRun(run.id);
                            setRuns((current) => [retry, ...(current ?? []).filter((item) => item.id !== retry.id)]);
                            setNotice("A new run was created. The earlier run remains in the activity list.");
                          })}>{l("Retry")}</Button> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : <StateBlock kind="empty" title={l("No processing activity")} detail={l("Uploading a document will start its first review run.")} />}
          </Panel>

          <Panel id="catalyst-queue" title={l("Review queue")} meta={reviewQueue ? `${reviewQueue.items.length} ${l("review items")}` : l("PARSER AND GENERATED DRAFTS")}>
            {loadErrors.reviewQueue ? <StateBlock kind="error" title={l("Review queue unavailable")} detail={l(loadErrors.reviewQueue)} action={<Button onClick={refresh}>{l("Try again")}</Button>} />
              : loading && reviewQueue === null ? <StateBlock kind="loading" title={l("Loading review queue")} detail={l("Reading parser warnings and generated drafts.")} />
                : reviewQueue ? (
                  <>
                    {reviewQueue.items.length > 0 ? <div className="catalyst-tools__run-list">
                      {reviewQueue.items.map((item) => {
                        const relatedRevisionId = item.contentRevisionId
                          ?? revisions?.find((revision) => revision.sourceRevisionIds.includes(item.sourceRevisionId))?.id;
                        return <article className="catalyst-tools__run" key={item.id}>
                          <div className="catalyst-tools__run-heading">
                            <strong>{l(reviewItemLabel(item.kind))}</strong>
                            <StatusPill value={l(item.state)} tone={statusTone(item.state)} />
                          </div>
                          <p>{l(userFacingWarning(item.code, item.message))}</p>
                          <p>{l("Source revision")} {item.sourceRevisionId} · {l("Processing run")} {item.processingRunId}</p>
                          <p>{l("Severity")}: {l(item.severity)}</p>
                          {item.confidence !== undefined ? <p>{l("Confidence")} {formatPercent(item.confidence)} · {l("Review required before approval.")}</p> : <p>{l("Review required before approval.")}</p>}
                          {item.locator ? <p>{formatCatalystLocator(item.locator, locale).join(" · ") || l("Location not provided")}</p> : <p>{l("Location not provided")}</p>}
                          {item.note ? <p className="catalyst-tools__review-note">{l("Review note:")} {item.note}</p> : null}
                          {item.state === "REJECTED" ? <p className="inline-error">{l("This issue still blocks approval. Reprocess or exclude its source.")}</p> : null}
                          <div className="catalyst-tools__run-actions">
                            {relatedRevisionId ? <Button disabled={busyAction !== null} onClick={() => void openReviewItem(item)}>{l("Open related revision")}</Button> : null}
                            {item.state === "OPEN" ? <>
                              <Field label={l("Review note")} hint={l("Optional; kept with the review record.")}>
                                <textarea rows={2} value={reviewNotes[item.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={l("Add a note for the review record")} />
                              </Field>
                              <Button disabled={busyAction !== null} onClick={() => void perform(`acknowledge:${item.id}`, async () => {
                                const resolved = await client.resolveReviewItem(item.id, "ACKNOWLEDGE", reviewNotes[item.id]);
                                setReviewQueue((current) => current ? { ...current, items: current.items.map((candidate) => candidate.id === resolved.id ? resolved : candidate) } : current);
                                setReviewNotes((current) => ({ ...current, [item.id]: "" }));
                                setNotice(locale === "zh-CN" ? "已记录审核结论；可重新检查内容批准条件。" : "Review decision recorded. Content approval conditions were refreshed.");
                                refresh();
                              })}>{l("Acknowledge issue")}</Button>
                              <Button tone="danger" disabled={busyAction !== null} onClick={() => void perform(`reject-review:${item.id}`, async () => {
                                const resolved = await client.resolveReviewItem(item.id, "REJECT", reviewNotes[item.id]);
                                setReviewQueue((current) => current ? { ...current, items: current.items.map((candidate) => candidate.id === resolved.id ? resolved : candidate) } : current);
                                setNotice(locale === "zh-CN" ? "已记录拒绝结论；此问题仍会阻止内容批准。" : "Rejection recorded. This issue will continue to block content approval.");
                                refresh();
                              })}>{l("Reject issue")}</Button>
                            </> : null}
                          </div>
                        </article>;
                      })}
                    </div> : null}
                    {reviewQueue.generatedDrafts.length > 0 ? <div className="catalyst-tools__run-list">
                      {reviewQueue.generatedDrafts.map((draft) => <article className="catalyst-tools__run" key={draft.id}>
                        <div className="catalyst-tools__run-heading"><strong>{l("Generated draft")} · {l("Revision")} {draft.revision}</strong><StatusPill value={l("DRAFT")} tone={statusTone("DRAFT")} /></div>
                        <p>{draft.blockCount} {l("draft passages")} · {formatDate(draft.createdAt)}</p>
                        {draft.processingRunId ? <p>{l("Processing run")} {draft.processingRunId}</p> : null}
                        <Button disabled={busyAction !== null} onClick={() => void openGeneratedDraft(draft)}>{l("Review generated draft")}</Button>
                      </article>)}
                    </div> : null}
                    {reviewQueue.items.length === 0 && reviewQueue.generatedDrafts.length === 0
                      ? <StateBlock kind="empty" title={l("No open review items")} detail={l("Parser warnings and generated drafts will appear here.")} />
                      : null}
                  </>
                ) : <StateBlock kind="empty" title={l("No open review items")} detail={l("Parser warnings and generated drafts will appear here.")} />}
          </Panel>

          <Panel id="catalyst-review" title={l("Review passages and generated drafts")} meta={revisions ? `${revisions.length} ${l("revisions")}` : l("IMMUTABLE REVISIONS")} className="catalyst-tools__revision-panel">
            {loadErrors.revisions ? <StateBlock kind="error" title={l("Content revisions unavailable")} detail={l(loadErrors.revisions)} action={<Button onClick={refresh}>{l("Try again")}</Button>} />
              : loading && revisions === null ? <StateBlock kind="loading" title={l("Loading content")} detail={l("Reading revision history from Catalyst.")} />
                : revisions && revisions.length > 0 ? (
                  <>
                    <div className="catalyst-tools__revision-toolbar">
                      <Field label={l("Content revision")}>
                        <select value={selectedRevisionId} onChange={(event) => setSelectedRevisionId(event.target.value)}>
                          {revisions.map((revision) => {
                            const generatedCount = revision.blocks.filter((block) => block.origin === "GENERATED").length;
                            const generated = generatedCount > 0 ? ` · ${generatedCount} ${l("generated drafts")}` : "";
                            return <option key={revision.id} value={revision.id}>{`${l("Revision")} ${revision.revision} · ${l(revision.state)}${generated}`}</option>;
                          })}
                        </select>
                      </Field>
                      {selectedRevision ? <StatusPill value={l(selectedRevision.state)} tone={statusTone(selectedRevision.state)} /> : null}
                    </div>
                    {selectedRevision?.reviewNote ? <p className="catalyst-tools__review-note">{l("Review note:")} {selectedRevision.reviewNote}</p> : null}
                    <p className="catalyst-tools__policy-guidance">{l("Content use is blocked by default. Choose the package and allowed use for each passage, add its allowed people or groups, and approve the revision when review is complete.")}</p>
                    {approvalBlocked ? <p className="inline-error" role="status">{l(approvalBlockReason)}</p> : null}
                    {blocksLoading && blocks.length === 0 ? <StateBlock kind="loading" title={l("Loading passages")} detail={l("Reading document text and page locations.")} />
                      : blocksError ? <StateBlock kind="error" title={l("Passages unavailable")} detail={l(blocksError)} action={<Button onClick={() => setBlockReloadKey((value) => value + 1)}>{l("Try again")}</Button>} />
                        : blocks.length === 0 ? <StateBlock kind="empty" title={l("No passages in this revision")} detail={l("The processing run may have failed or the document may contain no readable text.")} />
                          : (
                            <div className="catalyst-tools__blocks">
                              {blocks.map((block) => <BlockEditor
                                key={`${selectedRevisionId}:${block.id}`}
                                block={block}
                                locale={locale}
                                edit={edits[block.id]}
                                disabled={selectedRevision?.state === "REJECTED" || busyAction !== null}
                                saving={busyAction === `edit:${block.id}`}
                                onChange={(next) => updateBlockEdit(block, next)}
                                onSave={() => void saveBlock(block)}
                              />)}
                              {blocks.length < blockTotal ? <Button className="catalyst-tools__load-more" disabled={blocksLoading} loading={blocksLoading} onClick={() => void loadMoreBlocks()}>{blocksLoading ? l("Loading...") : l("Load more passages")}</Button> : null}
                            </div>
                          )}

                    {selectedRevision?.state === "DRAFT" ? (
                      <div className="catalyst-tools__review">
                        <Field label={l("Review note")} hint={l("Optional; kept with the revision for reviewers.")}>
                          <textarea value={reviewNote} rows={2} onChange={(event) => setReviewNote(event.target.value)} placeholder={l("Add a note for the review record")} />
                        </Field>
                        <div className="form-actions">
                          <Button tone="primary" disabled={busyAction !== null || approvalBlocked} loading={busyAction === "approve"} onClick={() => void perform("approve", async () => {
                            const reviewed = await client.reviewContent(selectedRevision.id, "APPROVE", reviewNote);
                            setRevisions((current) => replaceRevision(current, reviewed));
                            setReviewNote("");
                            setNotice(locale === "zh-CN" ? `内容修订 ${reviewed.revision} 已批准。` : `Content revision ${reviewed.revision} is approved.`);
                          })}>{l("Approve content")}</Button>
                          <Button tone="danger" disabled={busyAction !== null} loading={busyAction === "reject"} onClick={() => void perform("reject", async () => {
                            const reviewed = await client.reviewContent(selectedRevision.id, "REJECT", reviewNote);
                            setRevisions((current) => replaceRevision(current, reviewed));
                            setReviewNote("");
                            setNotice(locale === "zh-CN" ? `内容修订 ${reviewed.revision} 已拒绝。` : `Content revision ${reviewed.revision} was rejected.`);
                          })}>{l("Reject revision")}</Button>
                        </div>
                      </div>
                    ) : selectedRevision?.state === "APPROVED" ? (
                      <p className="catalyst-tools__approved-note">{l("Approved content is ready for both recipes. Changes create a new revision.")}</p>
                    ) : null}
                  </>
                ) : <StateBlock kind="empty" title={l("No content to review yet")} detail={l("Upload and process a PDF or DOCX file to create the first content revision.")} />}
          </Panel>

          <Panel id="catalyst-build" title={l("Build knowledge and training packages")} meta={<span className="mono-label">{l("TWO EXPLICIT RECIPES")}</span>}>
            {!approvedRevision ? (
              <StateBlock kind="empty" title={l("Approve content before building")} detail={l("Select an approved revision or review and approve the current passages first.")} />
            ) : (
              <>
                <p className="catalyst-tools__recipe-context">{locale === "zh-CN"
                  ? `两个数据包将使用已批准的内容修订 ${approvedRevision.revision}。修改段落会创建新修订，旧输出可能过期。`
                  : `Both outputs use approved content revision ${approvedRevision.revision}. A change to the passages creates a new revision and can make earlier outputs out of date.`}</p>
                <div className="catalyst-tools__recipe-grid">
                  <div className="catalyst-tools__recipe-card">
                    <span className="eyebrow">{l("KNOWLEDGE")}</span>
                    <h3>{l("Searchable knowledge package")}</h3>
                    <p>{l("Build cited passages with page locations, source history, and use policies.")}</p>
                    <Button disabled={busyAction !== null} loading={busyAction === "buildKnowledge"} onClick={() => void perform("buildKnowledge", () => startRun({ operation: "buildKnowledge", contentRevisionId: approvedRevision.id }))}>
                      {busyAction === "buildKnowledge" ? l("Starting...") : l("Build knowledge package")}
                    </Button>
                    {selectedKnowledgeRunId ? <small>{l("Ready to publish from the latest successful run.")}</small> : null}
                  </div>
                  <div className="catalyst-tools__recipe-card">
                    <span className="eyebrow">{l("TRAINING")}</span>
                    <h3>{l("Train, validation, and test data")}</h3>
                    <p>{l("Create a deterministic split by source or conversation family.")}</p>
                    <Field label={l("SFT format")}>
                      <select value={sftMode} onChange={(event) => setSftMode(event.target.value as "instruction" | "conversation")}>
                        <option value="instruction">{l("Instruction")}</option>
                        <option value="conversation">{l("Conversation")}</option>
                      </select>
                    </Field>
                    <div className="catalyst-tools__split-grid">
                      <PercentField label={l("Train %")} value={trainPercent} onChange={setTrainPercent} />
                      <PercentField label={l("Validation %")} value={validationPercent} onChange={setValidationPercent} />
                      <PercentField label={l("Test %")} value={testPercent} onChange={setTestPercent} />
                    </div>
                    {!splitIsValid ? <p className="inline-error">{l("Split percentages must add up to 100.")}</p> : null}
                    <Button disabled={busyAction !== null || !splitIsValid} loading={busyAction === "prepareSft"} onClick={() => void perform("prepareSft", () => startRun({
                      operation: "prepareSft",
                      contentRevisionId: approvedRevision.id,
                      config: {
                        sftMode,
                        split: { train: trainPercent / 100, validation: validationPercent / 100, test: testPercent / 100 },
                      },
                    }))}>{busyAction === "prepareSft" ? l("Starting...") : l("Build training package")}</Button>
                    {selectedSftRunId ? <small>{l("Ready to publish from the latest successful run.")}</small> : null}
                  </div>
                </div>

                <div className="catalyst-tools__generation">
                  <div>
                    <span className="eyebrow">{l("OPTIONAL DRAFT GENERATION")}</span>
                    <h3>{l("Generate questions and answers for review")}</h3>
                    <p>{l("Generation is an explicit action with a visible budget. Generated passages remain drafts until you approve them.")}</p>
                  </div>
                  <div className="catalyst-tools__budget-grid">
                    <label className="field"><span className="field__label">{l("Maximum examples")}</span><input type="number" min={1} max={500} value={maxExamples} onChange={(event) => setMaxExamples(Number(event.target.value))} /></label>
                    <label className="field"><span className="field__label">{l("Maximum model calls")}</span><input type="number" min={1} max={100} value={maxCalls} onChange={(event) => setMaxCalls(Number(event.target.value))} /></label>
                  </div>
                  <Button disabled={busyAction !== null || maxExamples < 1 || maxCalls < 1} loading={busyAction === "generateQa"} onClick={() => void perform("generateQa", () => startRun({
                    operation: "generateQa",
                    contentRevisionId: approvedRevision.id,
                    config: { generation: { maxExamples, maxCalls } },
                  }))}>{busyAction === "generateQa" ? l("Starting...") : l("Generate draft questions")}</Button>
                </div>
              </>
            )}
          </Panel>

          <Panel id="catalyst-versions" title={l("Published data versions")} meta={versions ? `${versions.length} ${l("versions")}` : l("IMMUTABLE VERSIONS")}>
            {approvedRevision && selectedKnowledgeRunId && selectedSftRunId ? (
              <div className="catalyst-tools__publish-bar">
                <div><strong>{l("Ready to publish")}</strong><span>{l("One version will include both approved package artifacts.")}</span></div>
                <Button tone={selectedRevision?.state === "DRAFT" ? undefined : "primary"} disabled={busyAction !== null} loading={busyAction === "publish"} onClick={() => void perform("publish", async () => {
                  const version = await client.publishVersion(datasetId, {
                    contentRevisionId: approvedRevision.id,
                    knowledgeRunId: selectedKnowledgeRunId,
                    sftRunId: selectedSftRunId,
                  });
                  setVersions((current) => [version, ...(current ?? []).filter((item) => item.id !== version.id)]);
                  setNotice(locale === "zh-CN" ? `已发布数据版本 ${version.id}。` : `Published data version ${version.id}.`);
                })}>{l("Publish both packages")}</Button>
              </div>
            ) : null}
            {loadErrors.versions ? <StateBlock kind="error" title={l("Published versions unavailable")} detail={l(loadErrors.versions)} action={<Button onClick={refresh}>{l("Try again")}</Button>} />
              : loading && versions === null ? <StateBlock kind="loading" title={l("Loading published versions")} detail={l("Reading immutable versions from Catalyst.")} />
                : versions && versions.length > 0 ? (
                  <div className="catalyst-tools__versions">
                    {versions.map((version) => <VersionCard
                      key={version.id}
                      version={version}
                      locale={locale}
                      busyAction={busyAction}
                      onDownload={(profile) => void download(version.id, profile)}
                    />)}
                  </div>
                ) : <StateBlock kind="empty" title={l("No published data versions")} detail={l("Build both packages from approved content, then publish them together.")} />}
            {downloadError ? <p className="inline-error" role="alert">{l(downloadError)}</p> : null}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function BlockEditor({
  block,
  locale,
  edit,
  disabled,
  saving,
  onChange,
  onSave,
}: {
  block: ContentBlock;
  locale: "zh-CN" | "en-US";
  edit?: BlockEdit;
  disabled: boolean;
  saving: boolean;
  onChange: (edit: Partial<BlockEdit>) => void;
  onSave: () => void;
}) {
  const l = (value: string) => catalystText(value, locale);
  const text = edit?.text ?? block.text;
  const policy = edit?.policy ?? block.policy;
  return (
    <article className="catalyst-tools__block">
      <div className="catalyst-tools__block-heading">
        <strong>{`${l(blockKindLabel(block.kind))} · ${l("Block")} ${block.ordinal + 1}`}</strong>
        <span>{blockLocation(block, locale)}</span>
        <StatusPill value={l(blockOriginLabel(block.origin))} tone={block.origin === "GENERATED" ? "warn" : "muted"} />
      </div>
      <label className="field catalyst-tools__block-text">
        <span className="field__label">{l("Passage text")}</span>
        <textarea value={text} rows={Math.min(8, Math.max(3, Math.ceil(text.length / 120)))} disabled={disabled} onChange={(event) => onChange({ text: event.target.value })} />
      </label>
      {block.origin === "GENERATED" ? <details>
        <summary>{l("Generation lineage")}</summary>
        {block.generationReceipt ? <dl>
          <dt>{l("Model")}</dt><dd>{block.generationReceipt.model}</dd>
          <dt>{l("Recipe")}</dt><dd>{block.generationReceipt.recipeId} · {block.generationReceipt.recipeVersion}</dd>
          <dt>{l("Recipe digest")}</dt><dd>{block.generationReceipt.recipeDigest}</dd>
          <dt>{l("Budget")}</dt><dd>{formatReceiptRecord(block.generationReceipt.budget, locale).join(" · ") || l("Not reported")}</dd>
          <dt>{l("Usage")}</dt><dd>{formatReceiptRecord(block.generationReceipt.usage, locale).join(" · ") || l("Not reported")}</dd>
          <dt>{l("Generated at")}</dt><dd>{formatDate(block.generationReceipt.generatedAt)}</dd>
          <dt>{l("Source passages")}</dt><dd>{block.generationReceipt.sourceBlockIds.join(", ") || l("Not reported")}</dd>
        </dl> : <p>{l("Generation lineage is unavailable.")}</p>}
      </details> : null}
      <div className="catalyst-tools__policy" aria-label={l("Package inclusion")}>
        <label><input type="checkbox" checked={policy.allowKnowledge} disabled={disabled} onChange={(event) => onChange({ policy: { ...policy, allowKnowledge: event.target.checked } })} /> {l("Include in knowledge")}</label>
        <label><input type="checkbox" checked={policy.allowTraining} disabled={disabled} onChange={(event) => onChange({ policy: { ...policy, allowTraining: event.target.checked } })} /> {l("Include in training")}</label>
        <label><input type="checkbox" checked={policy.allowedUsePurposes.includes("knowledge_retrieval")} disabled={disabled} onChange={(event) => onChange({ policy: {
          ...policy,
          allowedUsePurposes: event.target.checked
            ? [...new Set([...policy.allowedUsePurposes, "knowledge_retrieval"])]
            : policy.allowedUsePurposes.filter((purpose) => purpose !== "knowledge_retrieval"),
        } })} /> {l("Allow knowledge retrieval use")}</label>
        <label><input type="checkbox" checked={policy.allowedUsePurposes.includes("model_training")} disabled={disabled} onChange={(event) => onChange({ policy: {
          ...policy,
          allowedUsePurposes: event.target.checked
            ? [...new Set([...policy.allowedUsePurposes, "model_training"])]
            : policy.allowedUsePurposes.filter((purpose) => purpose !== "model_training"),
        } })} /> {l("Allow model training use")}</label>
      </div>
      <label className="field catalyst-tools__policy-list">
        <span className="field__label">{l("Allowed people or groups")}</span>
        <textarea
          value={policy.allowedPrincipalRefs.join("\n")}
          rows={2}
          disabled={disabled}
          placeholder={l("One allowed principal reference per line")}
          onChange={(event) => onChange({ policy: { ...policy, allowedPrincipalRefs: lines(event.target.value) } })}
        />
        <small>{l("Leave blank to deny access to this passage.")}</small>
      </label>
      {!disabled ? <div className="catalyst-tools__block-actions"><Button disabled={saving || !edit || (edit.text === block.text && samePolicy(edit.policy, block.policy))} loading={saving} onClick={onSave}>{saving ? l("Saving...") : l("Save new revision")}</Button></div> : null}
    </article>
  );
}

function PercentField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field"><span className="field__label">{label}</span><input type="number" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function VersionCard({ version, locale, busyAction, onDownload }: { version: DatasetVersion; locale: "zh-CN" | "en-US"; busyAction: string | null; onDownload: (profile: "knowledge" | "sft") => void }) {
  const l = (value: string) => catalystText(value, locale);
  const tools = version.dataTools;
  const versionState = tools?.stale ? "OUT OF DATE" : tools ? "CURRENT" : "LEGACY VERSION";
  return (
    <article className="catalyst-tools__version">
      <div className="catalyst-tools__version-heading">
        <div><strong>{l("Dataset version")}</strong><span className="catalyst-tools__version-id dh-id">{version.id}</span></div>
        <StatusPill value={l(versionState)} tone={statusTone(versionState)} />
      </div>
      <p>{formatDate(version.publishedAt ?? version.createdAt)}</p>
      {tools ? <p>{l("Content revision")} <span className="dh-id">{tools.contentRevisionId}</span> · {tools.sourceRevisionIds.length} {l("source revisions")}</p> : <p>{l("This version was published through the existing preparation flow.")}</p>}
      {tools ? <div className="catalyst-tools__download-actions">
        <Button disabled={busyAction !== null} loading={busyAction === `download:${version.id}:knowledge`} onClick={() => onDownload("knowledge")}>{l("Download knowledge package")}</Button>
        <Button disabled={busyAction !== null} loading={busyAction === `download:${version.id}:sft`} onClick={() => onDownload("sft")}>{l("Download training package")}</Button>
      </div> : <span className="catalyst-tools__legacy-note">{l("Package downloads are available for data-tools versions.")}</span>}
    </article>
  );
}

interface CatalystWorkflowInput {
  locale: "zh-CN" | "en-US";
  sources: SourceRevision[] | null;
  runs: ProcessingRun[] | null;
  revisions: ContentRevision[] | null;
  versions: DatasetVersion[] | null;
  unavailable: LoadErrors;
  selectedRevision: ContentRevision | null;
  approvedRevision: ContentRevision | null;
  selectedRuns: ProcessingRun[];
  knowledgeReady: boolean;
  sftReady: boolean;
}

/**
 * Derive the document workflow horizon from data already loaded by the panel.
 * A list that is still loading or failed to load never reads as an empty result.
 * 中文：仅根据面板已读取的数据推导文档流程进度，不额外请求接口；读取中或读取失败
 *       的列表不会被显示成“没有数据”。
 */
function catalystWorkflow(input: CatalystWorkflowInput): WorkflowStep[] {
  const zh = input.locale === "zh-CN";
  const tx = (chinese: string, english: string) => zh ? chinese : english;
  const isFailed = (run: ProcessingRun) => run.state === "FAILED" || run.state === "INTERRUPTED";
  const mark = (step: WorkflowStep, state: WorkflowStepState, detail: string) => { step.state = state; step.detail = detail; };
  const loadingText = tx("读取中…", "Loading…");
  const unavailableText = tx("无法读取", "Unavailable");

  const upload: WorkflowStep = { id: "upload", label: tx("上传原文", "Upload"), targetId: "catalyst-sources", state: "pending", detail: tx("尚无文件", "No files yet") };
  if (input.unavailable.sources) mark(upload, "attention", unavailableText);
  else if (input.sources === null) upload.detail = loadingText;
  else if (input.sources.length > 0) {
    const count = input.sources.length;
    mark(upload, "done", tx(`${count} 个文件`, `${count} ${count === 1 ? "file" : "files"}`));
  }

  const extract: WorkflowStep = { id: "extract", label: tx("解析校对", "Extract"), targetId: "catalyst-activity", state: "pending", detail: tx("未开始", "Not started") };
  if (input.unavailable.runs) mark(extract, "attention", unavailableText);
  else if (input.runs === null) extract.detail = loadingText;
  else {
    const parseRuns = input.runs.filter((run) => run.operation === "parse");
    const parsed = parseRuns.filter((run) => run.state === "SUCCEEDED").length;
    const parseFailed = parseRuns.filter(isFailed).length;
    if (parseRuns.some(isRunActive)) mark(extract, "running", tx("处理中", "Processing"));
    else if (parsed > 0 && parseFailed > 0) mark(extract, "attention", tx(`${parseFailed} 个失败`, `${parseFailed} failed`));
    else if (parsed > 0) mark(extract, "done", tx(`已解析 ${parsed} 个`, `${parsed} extracted`));
    else if (parseFailed > 0) mark(extract, "blocked", tx("解析失败", "Failed"));
  }

  const revision = input.selectedRevision;
  const review: WorkflowStep = { id: "review", label: tx("审核批准", "Review"), targetId: "catalyst-review", state: "pending", detail: tx("尚无修订", "No revision") };
  if (input.unavailable.revisions) mark(review, "attention", unavailableText);
  else if (input.revisions === null) review.detail = loadingText;
  else if (revision?.state === "APPROVED") mark(review, "done", tx(`修订 ${revision.revision} 已批准`, `Rev ${revision.revision} approved`));
  else if (revision?.state === "DRAFT") mark(review, "current", tx(`修订 ${revision.revision} 待审核`, `Rev ${revision.revision} · draft`));
  else if (revision?.state === "REJECTED") mark(review, "blocked", tx(`修订 ${revision.revision} 已拒绝`, `Rev ${revision.revision} rejected`));
  else if (input.revisions.length > 0) review.detail = tx(`${input.revisions.length} 个修订`, `${input.revisions.length} revisions`);

  const buildRuns = input.selectedRuns.filter((run) => run.operation === "buildKnowledge" || run.operation === "prepareSft");
  const built = Number(input.knowledgeReady) + Number(input.sftReady);
  const buildFailed = !input.knowledgeReady && buildRuns.some((run) => run.operation === "buildKnowledge" && isFailed(run))
    || !input.sftReady && buildRuns.some((run) => run.operation === "prepareSft" && isFailed(run));
  const build: WorkflowStep = { id: "build", label: tx("构建数据包", "Build"), targetId: "catalyst-build", state: "pending", detail: tx("需先批准", "Needs approval") };
  if (input.approvedRevision) {
    if (input.runs === null && !input.unavailable.runs) build.detail = loadingText;
    else if (buildRuns.some(isRunActive)) mark(build, "running", tx("构建中", "Building"));
    else if (built === 2) mark(build, "done", tx("两个数据包已就绪", "Both packages built"));
    else if (buildFailed) mark(build, built === 0 ? "blocked" : "attention", tx("构建失败", "Build failed"));
    else mark(build, "current", tx(`已构建 ${built}/2`, `${built} of 2 built`));
  } else if (input.revisions === null && !input.unavailable.revisions) {
    build.detail = loadingText;
  }

  const publish: WorkflowStep = { id: "publish", label: tx("发布版本", "Publish"), targetId: "catalyst-versions", state: "pending", detail: tx("尚未发布", "Not published") };
  if (input.unavailable.versions) mark(publish, "attention", unavailableText);
  else if (input.versions === null) publish.detail = loadingText;
  else if (input.approvedRevision && input.versions.some((version) => version.dataTools?.contentRevisionId === input.approvedRevision!.id)) mark(publish, "done", tx("已发布", "Published"));
  else if (input.approvedRevision && built === 2) mark(publish, "current", tx("可以发布", "Ready to publish"));
  else if (input.versions.length > 0) {
    const count = input.versions.length;
    publish.detail = tx(`${count} 个历史版本`, `${count} earlier ${count === 1 ? "version" : "versions"}`);
  }

  return [upload, extract, review, build, publish];
}

function sourceStatus(run: ProcessingRun | undefined): string {
  if (!run) return "UPLOADED";
  if (run.state === "QUEUED" || run.state === "RUNNING") return "PROCESSING";
  if (run.state === "SUCCEEDED") return "READY TO REVIEW";
  if (run.state === "FAILED") return "FAILED";
  if (run.state === "INTERRUPTED") return "INTERRUPTED";
  return "CANCELLED";
}

function operationLabel(operation: RunOperation): string {
  return {
    parse: "Document review",
    buildKnowledge: "Build knowledge package",
    prepareSft: "Build training package",
    generateQa: "Generate draft questions",
  }[operation];
}

function userFacingWarning(code: string, message: string): string {
  const normalized = `${code} ${message}`.toLowerCase();
  if (normalized.includes("page") && normalized.includes("unreadable")) return "Some page content could not be read. Review the extracted passages before approving.";
  if (/traceback|toolchain|pip install|docling|plugin entrypoint/i.test(normalized)) return "Some document content may be missing. Review the extracted passages before approving.";
  return message || "Review the extracted content before approving.";
}

function latestReportForSource(reports: readonly SourceParseReport[], sourceRevisionId: string): SourceParseReport | undefined {
  return reports
    .filter((report) => report.sourceRevisionId === sourceRevisionId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

function reportNeedsReview(report: SourceParseReport): boolean {
  return report.status === "WARNING"
    || report.warnings.length > 0
    || report.diagnostics.length > 0
    || report.unsupportedContent.length > 0
    || report.failure !== undefined;
}

function reviewItemLabel(kind: ReviewItem["kind"]): string {
  switch (kind) {
    case "PARSER_WARNING": return "Parser warning";
    case "OCR_WARNING": return "OCR warning";
    case "PARSE_FAILURE": return "Document could not be read";
    case "UNSUPPORTED_SOURCE": return "Unsupported file content";
  }
}

function approvalGateCopy(reason: ContentApprovalBlockReason | null): string {
  switch (reason) {
    case "review_status_unavailable": return "Parser review status is unavailable. Refresh before approving content.";
    case "unresolved_review_items": return "Resolve every applicable parser or OCR review item before approving.";
    case "parser_report_missing_review_item": return "A parser warning has no review record yet. Refresh the queue before approving.";
    case "parse_in_progress": return "Document parsing is still running for this revision.";
    case null: return "";
  }
}

function formatPercent(value: number): string {
  return String(Math.round(Math.min(1, Math.max(0, value)) * 100)) + "%";
}

export function formatCatalystLocator(locator: unknown, locale: "zh-CN" | "en-US"): string[] {
  if (!isRecord(locator)) return [];
  const details: string[] = [];
  const pages = locator["sourcePages"] ?? locator["source_pages"] ?? locator["pages"];
  if (Array.isArray(pages) && pages.length > 0) {
    const value = pages.map(safeLocationValue).filter(Boolean).join(locale === "zh-CN" ? "、" : ", ");
    if (value) details.push(locale === "zh-CN" ? "第 " + value + " 页" : (pages.length === 1 ? "Page " : "Pages ") + value);
  } else {
    const page = safeLocationValue(locator["page"] ?? locator["page_number"]);
    if (page) details.push(locale === "zh-CN" ? "第 " + page + " 页" : "Page " + page);
  }
  const sectionPath = locator["sectionPath"] ?? locator["section_path"];
  if (Array.isArray(sectionPath)) {
    const value = sectionPath.map(safeLocationValue).filter(Boolean).join(" / ");
    if (value) details.push(value);
  }
  const tableIndex = safeLocationValue(locator["tableIndex"] ?? locator["table_index"]);
  if (tableIndex) details.push((locale === "zh-CN" ? "表格 " : "Table ") + tableIndex);
  const itemRef = safeLocationValue(locator["itemRef"] ?? locator["item_ref"]);
  if (itemRef) details.push((locale === "zh-CN" ? "位置 " : "Location ") + itemRef);
  const start = safeLocationValue(locator["startOffset"] ?? locator["start_offset"]);
  const end = safeLocationValue(locator["endOffset"] ?? locator["end_offset"]);
  if (start || end) details.push((locale === "zh-CN" ? "文本偏移 " : "Text offset ") + (start || "?") + "–" + (end || "?"));

  const provenance = locator["provenance"];
  const nested = Array.isArray(provenance) ? provenance.filter(isRecord) : isRecord(provenance) ? [provenance] : [];
  const records = [locator, ...nested];
  for (const record of records) {
    const fields: Array<[string, string]> = [
      ["slide_number", locale === "zh-CN" ? "幻灯片" : "Slide"],
      ["shape_id", locale === "zh-CN" ? "形状" : "Shape"],
      ["index", locale === "zh-CN" ? "索引" : "Index"],
      ["name", locale === "zh-CN" ? "名称" : "Name"],
      ["type", locale === "zh-CN" ? "类型" : "Type"],
      ["sheet_name", locale === "zh-CN" ? "工作表" : "Sheet"],
      ["cell_ref", locale === "zh-CN" ? "单元格" : "Cell"],
      ["table_name", locale === "zh-CN" ? "表格" : "Table"],
      ["ref", locale === "zh-CN" ? "引用" : "Reference"],
      ["formula", locale === "zh-CN" ? "公式" : "Formula"],
      ["cached_value", locale === "zh-CN" ? "缓存值" : "Cached value"],
      ["availability", locale === "zh-CN" ? "可用性" : "Availability"],
      ["data_type", locale === "zh-CN" ? "数据类型" : "Data type"],
      ["number_format", locale === "zh-CN" ? "数字格式" : "Number format"],
      ["engine", locale === "zh-CN" ? "OCR 引擎" : "OCR engine"],
      ["language", locale === "zh-CN" ? "语言" : "Language"],
      ["confidence", locale === "zh-CN" ? "置信度" : "Confidence"],
      ["text_origin", locale === "zh-CN" ? "文本来源" : "Text origin"],
      ["bbox_emu", locale === "zh-CN" ? "位置框" : "Position"],
      ["bbox", locale === "zh-CN" ? "位置框" : "Bounds"],
    ];
    for (const [key, label] of fields) {
      const value = safeLocationValue(record[key]);
      if (value) details.push(label + " " + value);
    }
  }
  return details.slice(0, 12);
}

function describeUnsupportedContent(value: unknown, locale: "zh-CN" | "en-US"): string {
  if (!isRecord(value)) return "";
  const location = formatCatalystLocator(value["locator"] ?? value, locale);
  const name = safeLocationValue(value["name"] ?? value["type"]);
  const reason = safeLocationValue(value["reason"]);
  const separator = locale === "zh-CN" ? "：" : ": ";
  return [name, reason, ...location].filter(Boolean).join(separator);
}

function safeLocationValue(value: unknown): string {
  if (typeof value === "string") return value.trim().slice(0, 140);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(safeLocationValue).filter(Boolean).join(", ").slice(0, 140);
  if (isRecord(value)) {
    const coordinates = ["x", "y", "width", "height", "left", "top", "right", "bottom"]
      .map((key) => value[key])
      .filter((item) => typeof item === "number" || typeof item === "string");
    return coordinates.length > 0 ? coordinates.map(String).join(", ") : "";
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatReceiptRecord(value: Record<string, unknown>, locale: "zh-CN" | "en-US"): string[] {
  return Object.entries(value).flatMap(([key, item]) => {
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") return [];
    return [receiptMetricLabel(key, locale) + ": " + String(item)];
  }).slice(0, 10);
}

function receiptMetricLabel(value: string, locale: "zh-CN" | "en-US"): string {
  const normalized = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  const known: Record<string, [string, string]> = {
    "max examples": ["Max examples", "最多样例数"],
    "max calls": ["Max model calls", "最多模型调用次数"],
    "model calls": ["Model calls", "模型调用次数"],
    "input tokens": ["Input tokens", "输入 Token 数"],
    "output tokens": ["Output tokens", "输出 Token 数"],
    "prompt tokens": ["Prompt tokens", "提示 Token 数"],
    "completion tokens": ["Completion tokens", "补全 Token 数"],
  };
  return known[normalized]?.[locale === "zh-CN" ? 1 : 0] ?? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function replaceRun(current: ProcessingRun[] | null, run: ProcessingRun): ProcessingRun[] {
  return [run, ...(current ?? []).filter((item) => item.id !== run.id)];
}

function replaceRevision(current: ContentRevision[] | null, revision: ContentRevision): ContentRevision[] {
  return [revision, ...(current ?? []).filter((item) => item.id !== revision.id)];
}

function samePolicy(left: ContentPolicy, right: ContentPolicy): boolean {
  return left.allowKnowledge === right.allowKnowledge
    && left.allowTraining === right.allowTraining
    && stableList(left.allowedPrincipalRefs) === stableList(right.allowedPrincipalRefs)
    && stableList(left.allowedUsePurposes) === stableList(right.allowedUsePurposes);
}

function normalizePolicy(policy: ContentPolicy): ContentPolicy {
  return {
    allowKnowledge: policy.allowKnowledge,
    allowTraining: policy.allowTraining,
    allowedPrincipalRefs: policy.allowedPrincipalRefs ?? [],
    allowedUsePurposes: policy.allowedUsePurposes ?? [],
  };
}

function stableList(value: string[] | undefined): string {
  return [...(value ?? [])].sort().join("\u0000");
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
}

function blockKindLabel(kind: string): string {
  const normalized = kind.trim().toLowerCase().replace(/[ _-]+/g, "");
  if (["paragraph", "text", "heading", "title"].includes(normalized)) return "Paragraph";
  if (normalized.includes("table")) return "Table";
  if (["picture", "image", "figure"].includes(normalized)) return "Picture";
  if (normalized.includes("form")) return "Form";
  if (normalized === "qa" || normalized.includes("questionanswer")) return "Question and answer";
  return "Block";
}

function blockOriginLabel(origin: ContentBlock["origin"]): string {
  switch (origin) {
    case "EXTRACTED": return "EXTRACTED";
    case "NORMALIZED": return "NORMALIZED";
    case "HUMAN_EDITED": return "HUMAN EDITED";
    case "GENERATED": return "GENERATED DRAFT";
  }
}

function blockLocation(block: ContentBlock, locale: "zh-CN" | "en-US"): string {
  const l = (value: string) => catalystText(value, locale);
  const details = formatCatalystLocator(block.locator, locale);
  return details.length > 0 ? details.join(" · ") : l("Location not provided");
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDate(value: string | undefined): string {
  if (!value) return "Date not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not reported" : date.toLocaleString();
}
