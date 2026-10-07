// -----------------------------------------------------------------------------
// Module: services/catalyst/src/CatalystDataToolsPanel.tsx
// Role: Source review, dual-recipe preparation, publication, and download UI.
// 中文：提供来源审核、双 recipe 准备、发布与下载界面。
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";

import { Button, Field, Panel, StateBlock, StatusPill } from "../../navigator/src/components";
import { useI18n } from "../../navigator/src/i18n";
import {
  CatalystDataToolsClient,
  isRunActive,
  MAX_SOURCE_BYTES,
  userFacingCatalystError,
  userFacingRunFailure,
  type ContentBlock,
  type ContentPolicy,
  type ContentRevision,
  type CreateProcessingRunRequest,
  type DatasetVersion,
  type ProcessingRun,
  type ProductResponseTransport,
  type RunOperation,
  type SourceRevision,
} from "./api";
import { catalystText } from "./copy";
import "./catalyst.css";

type LoadErrors = { sources: string | null; revisions: string | null; runs: string | null; versions: string | null };
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
  const [loadErrors, setLoadErrors] = useState<LoadErrors>({ sources: null, revisions: null, runs: null, versions: null });
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

  useEffect(() => {
    if (!datasetId) {
      setSources(null);
      setRevisions(null);
      setRuns(null);
      setVersions(null);
      setSelectedRevisionId("");
      setLoadErrors({ sources: null, revisions: null, runs: null, versions: null });
      return;
    }

    let active = true;
    setLoading(true);
    setLoadErrors({ sources: null, revisions: null, runs: null, versions: null });
    void Promise.allSettled([
      client.listSources(datasetId),
      client.listContentRevisions(datasetId),
      client.listProcessingRuns(datasetId),
      client.listVersions(datasetId),
    ]).then(([sourceResult, revisionResult, runResult, versionResult]) => {
      if (!active) return;
      const errors: LoadErrors = { sources: null, revisions: null, runs: null, versions: null };
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

  const handleUpload = async (file: File) => {
    if (!datasetId) { setActionError("Choose a dataset before uploading."); return; }
    if (file.size > MAX_SOURCE_BYTES) { setActionError("This file exceeds the 32 MiB upload limit."); return; }
    setBusyAction("upload");
    setActionError(null);
    setNotice(null);
    let uploaded: SourceRevision | null = null;
    try {
      uploaded = await client.createSource(datasetId, file);
      setSources((current) => [uploaded!, ...(current ?? []).filter((source) => source.id !== uploaded!.id)]);
      try {
        const run = await client.createProcessingRun(datasetId, {
          operation: "parse",
          sourceRevisionIds: [uploaded.id],
        });
        setRuns((current) => [run, ...(current ?? []).filter((item) => item.id !== run.id)]);
        setNotice(locale === "zh-CN"
          ? `${file.name} 已上传，文档解析与校对已启动。`
          : `${file.name} was uploaded and document review has started.`);
      } catch (parseError) {
        setActionError(locale === "zh-CN"
          ? `文件已上传，但无法启动文档解析与校对。${l(userFacingCatalystError(parseError))}`
          : `The file was uploaded, but document review could not start. ${userFacingCatalystError(parseError)}`);
        refresh();
      }
    } catch (error) {
      setActionError(userFacingCatalystError(error));
    } finally {
      setBusyAction(null);
    }
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

  return (
    <div className="catalyst-tools">
      <Panel
        title={l("Review original documents and prepare both outputs")}
        meta={<span className="mono-label">CATALYST DATA TOOLS</span>}
      >
        <div className="catalyst-tools__intro">
          <p>{l("Keep the original PDF or Word file, review extracted passages, then build a knowledge package and a training package from approved content.")}</p>
          <p className="catalyst-tools__limit">{l("PDF and DOCX · up to 32 MiB per file")}</p>
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
              <select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
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
                <span className="field__label">{l("Upload PDF or Word file")}</span>
                <input
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={!datasetId || busyAction !== null}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void handleUpload(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <div className="catalyst-tools__selector-action">
              <Button onClick={refresh} disabled={!datasetId || loading}>{loading ? l("Refreshing...") : l("Refresh data")}</Button>
            </div>
          </div>
        )}

        {actionError ? <p className="inline-error" role="alert">{l(actionError)}</p> : null}
        {notice ? <p className="form-message form-message--success" role="status">{l(notice)}</p> : null}
        {datasetId && selectedDatasetName ? <p className="catalyst-tools__current-dataset">{l("Working in")} <strong>{String(selectedDatasetName)}</strong></p> : null}
      </Panel>

      {datasetId ? (
        <>
          <Panel title={l("Original documents")} meta={sources ? `${sources.length} ${l("sources")}` : l("SOURCE FILES")}>
            {loadErrors.sources ? <StateBlock kind="error" title={l("Sources unavailable")} detail={l(loadErrors.sources)} action={<Button onClick={refresh}>{l("Try again")}</Button>} />
              : loading && sources === null ? <StateBlock kind="loading" title={l("Loading original files")} detail={l("Reading the source ledger from Catalyst.")} />
                : sources && sources.length > 0 ? (
                  <div className="catalyst-tools__source-list">
                    {sources.map((source) => {
                      const run = (runs ?? []).find((item) => item.operation === "parse" && item.sourceRevisionIds.includes(source.id));
                      const status = l(sourceStatus(run));
                      return (
                        <article className="catalyst-tools__source" key={source.id}>
                          <div className="catalyst-tools__source-main">
                            <strong>{source.filename}</strong>
                            <span>{source.mediaType} · {formatBytes(source.byteLength)} · revision {source.revision} · {formatDate(source.createdAt)}</span>
                            <span className="catalyst-tools__digest">{source.digest}</span>
                          </div>
                          <div className="catalyst-tools__source-status">
                            <StatusPill value={status} />
                            {(run?.state === "FAILED" || run?.state === "INTERRUPTED") && run.failure ? <p>{l(userFacingRunFailure(run.failure))}</p> : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : <StateBlock kind="empty" title={l("No original documents yet")} detail={l("Upload a PDF or DOCX file. The exact original bytes are retained by Catalyst.")} />}
          </Panel>

          <Panel title={l("Processing activity")} meta={runs ? `${runs.length} ${l("runs")}` : l("LIVE STATUS")}>
            {loadErrors.runs ? <StateBlock kind="error" title={l("Processing status unavailable")} detail={l(loadErrors.runs)} action={<Button onClick={refresh}>{l("Try again")}</Button>} />
              : loading && runs === null ? <StateBlock kind="loading" title={l("Loading processing status")} detail={l("Reading recent work from Catalyst.")} />
                : runs && runs.length > 0 ? (
                  <div className="catalyst-tools__run-list">
                    {runs.slice(0, 12).map((run) => (
                      <article className="catalyst-tools__run" key={run.id}>
                        <div className="catalyst-tools__run-heading">
                          <strong>{l(operationLabel(run.operation))}</strong>
                          <StatusPill value={l(run.state)} />
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
                          {isRunActive(run) ? <Button disabled={busyAction !== null} onClick={() => void perform(`cancel:${run.id}`, async () => {
                            const cancelled = await client.cancelProcessingRun(run.id);
                            setRuns((current) => replaceRun(current, cancelled));
                            setNotice("Cancellation was requested. The final status will appear here.");
                          })}>{l("Cancel")}</Button> : null}
                          {(run.state === "FAILED" || run.state === "INTERRUPTED") && run.failure?.retryable ? <Button disabled={busyAction !== null} onClick={() => void perform(`retry:${run.id}`, async () => {
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

          <Panel title={l("Review passages and generated drafts")} meta={revisions ? `${revisions.length} ${l("revisions")}` : l("IMMUTABLE REVISIONS")}>
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
                      {selectedRevision ? <StatusPill value={l(selectedRevision.state)} /> : null}
                    </div>
                    {selectedRevision?.reviewNote ? <p className="catalyst-tools__review-note">{l("Review note:")} {selectedRevision.reviewNote}</p> : null}
                    <p className="catalyst-tools__policy-guidance">{l("Content use is blocked by default. Choose the package and allowed use for each passage, add its allowed people or groups, and approve the revision when review is complete.")}</p>
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
                              {blocks.length < blockTotal ? <Button disabled={blocksLoading} onClick={() => void loadMoreBlocks()}>{blocksLoading ? l("Loading...") : l("Load more passages")}</Button> : null}
                            </div>
                          )}

                    {selectedRevision?.state === "DRAFT" ? (
                      <div className="catalyst-tools__review">
                        <Field label={l("Review note")} hint={l("Optional; kept with the revision for reviewers.")}>
                          <textarea value={reviewNote} rows={2} onChange={(event) => setReviewNote(event.target.value)} placeholder={l("Add a note for the review record")} />
                        </Field>
                        <div className="form-actions">
                          <Button tone="primary" disabled={busyAction !== null} onClick={() => void perform("approve", async () => {
                            const reviewed = await client.reviewContent(selectedRevision.id, "APPROVE", reviewNote);
                            setRevisions((current) => replaceRevision(current, reviewed));
                            setReviewNote("");
                            setNotice(locale === "zh-CN" ? `内容修订 ${reviewed.revision} 已批准。` : `Content revision ${reviewed.revision} is approved.`);
                          })}>{l("Approve content")}</Button>
                          <Button tone="danger" disabled={busyAction !== null} onClick={() => void perform("reject", async () => {
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

          <Panel title={l("Build knowledge and training packages")} meta={<span className="mono-label">{l("TWO EXPLICIT RECIPES")}</span>}>
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
                    <Button tone="primary" disabled={busyAction !== null} onClick={() => void perform("buildKnowledge", () => startRun({ operation: "buildKnowledge", contentRevisionId: approvedRevision.id }))}>
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
                    <Button tone="primary" disabled={busyAction !== null || !splitIsValid} onClick={() => void perform("prepareSft", () => startRun({
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
                  <Button disabled={busyAction !== null || maxExamples < 1 || maxCalls < 1} onClick={() => void perform("generateQa", () => startRun({
                    operation: "generateQa",
                    contentRevisionId: approvedRevision.id,
                    config: { generation: { maxExamples, maxCalls } },
                  }))}>{busyAction === "generateQa" ? l("Starting...") : l("Generate draft questions")}</Button>
                </div>
              </>
            )}
          </Panel>

          <Panel title={l("Published data versions")} meta={versions ? `${versions.length} ${l("versions")}` : l("IMMUTABLE VERSIONS")}>
            {approvedRevision && selectedKnowledgeRunId && selectedSftRunId ? (
              <div className="catalyst-tools__publish-bar">
                <div><strong>{l("Ready to publish")}</strong><span>{l("One version will include both approved package artifacts.")}</span></div>
                <Button tone="primary" disabled={busyAction !== null} onClick={() => void perform("publish", async () => {
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
        <StatusPill value={l(blockOriginLabel(block.origin))} />
      </div>
      <label className="field catalyst-tools__block-text">
        <span className="field__label">{l("Passage text")}</span>
        <textarea value={text} rows={Math.min(8, Math.max(3, Math.ceil(text.length / 120)))} disabled={disabled} onChange={(event) => onChange({ text: event.target.value })} />
      </label>
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
      {!disabled ? <div className="catalyst-tools__block-actions"><Button disabled={saving || !edit || (edit.text === block.text && samePolicy(edit.policy, block.policy))} onClick={onSave}>{saving ? l("Saving...") : l("Save new revision")}</Button></div> : null}
    </article>
  );
}

function PercentField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field"><span className="field__label">{label}</span><input type="number" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function VersionCard({ version, locale, busyAction, onDownload }: { version: DatasetVersion; locale: "zh-CN" | "en-US"; busyAction: string | null; onDownload: (profile: "knowledge" | "sft") => void }) {
  const l = (value: string) => catalystText(value, locale);
  const tools = version.dataTools;
  return (
    <article className="catalyst-tools__version">
      <div className="catalyst-tools__version-heading">
        <div><strong>{l("Dataset version")}</strong><span className="catalyst-tools__version-id">{version.id}</span></div>
        <StatusPill value={l(tools?.stale ? "OUT OF DATE" : tools ? "CURRENT" : "LEGACY VERSION")} />
      </div>
      <p>{formatDate(version.publishedAt ?? version.createdAt)}</p>
      {tools ? <p>{l("Content revision")} {tools.contentRevisionId} · {tools.sourceRevisionIds.length} {l("source revisions")}</p> : <p>{l("This version was published through the existing preparation flow.")}</p>}
      {tools ? <div className="catalyst-tools__download-actions">
        <Button disabled={busyAction !== null} onClick={() => onDownload("knowledge")}>{l("Download knowledge package")}</Button>
        <Button disabled={busyAction !== null} onClick={() => onDownload("sft")}>{l("Download training package")}</Button>
      </div> : <span className="catalyst-tools__legacy-note">{l("Package downloads are available for data-tools versions.")}</span>}
    </article>
  );
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
  const pages = block.locator.sourcePages ?? [];
  if (pages.length > 0) return locale === "zh-CN"
    ? `第 ${pages.join("、")} 页`
    : `${pages.length === 1 ? "Page" : "Pages"} ${pages.join(", ")}`;
  if (block.locator.sectionPath?.length) return block.locator.sectionPath.join(" / ");
  if (block.locator.itemRef) return block.locator.itemRef;
  return l("Location not provided");
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
