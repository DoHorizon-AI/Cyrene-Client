// -----------------------------------------------------------------------------
// Module: services/catalyst/src/TrainingCurationPanel.tsx
// Role: Import, inspect, correct, and review versioned training records.
// 中文：导入、检查、修正并审核带版本的训练记录。
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";

import { Button, Field, Panel, StateBlock, StatusPill, statusTone } from "../../navigator/src/components";
import { useI18n } from "../../navigator/src/i18n";
import {
  CatalystDataToolsClient,
  userFacingCatalystError,
  userFacingSourceItemError,
  type ContentRevision,
  type ContentPolicy,
  type ProcessingRun,
  type SourceRevision,
  type SourceBatchItem,
  type TrainingDataFormat,
  type TrainingDataRecord,
} from "./api";
import { catalystText } from "./copy";

const PAGE_SIZE = 25;

export function TrainingCurationPanel({
  datasetId,
  sources,
  revision,
  client,
  busy,
  onSourcesUploaded,
  onRunStarted,
  onRevisionCreated,
}: {
  datasetId: string;
  sources: readonly SourceRevision[];
  revision: ContentRevision | null;
  client: CatalystDataToolsClient;
  busy: boolean;
  onSourcesUploaded: (sources: SourceRevision[]) => void;
  onRunStarted: (run: ProcessingRun) => void;
  onRevisionCreated: (revision: ContentRevision) => void;
}) {
  const { locale } = useI18n();
  const l = (value: string) => catalystText(value, locale);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [trainingConsent, setTrainingConsent] = useState(false);
  const [format, setFormat] = useState<TrainingDataFormat>("auto");
  const [fieldMappingText, setFieldMappingText] = useState("{}");
  const [roleMappingText, setRoleMappingText] = useState("{}");
  const [maxCharacters, setMaxCharacters] = useState(100000);
  const [minCharacters, setMinCharacters] = useState(2);
  const [offset, setOffset] = useState(0);
  const [disposition, setDisposition] = useState<TrainingDataRecord["disposition"] | "all">("all");
  const [issueCode, setIssueCode] = useState("");
  const [appliedIssueCode, setAppliedIssueCode] = useState("");
  const [records, setRecords] = useState<TrainingDataRecord[]>([]);
  const [recordTotal, setRecordTotal] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [recordReloadKey, setRecordReloadKey] = useState(0);
  const [rawEdits, setRawEdits] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadFailures, setUploadFailures] = useState<Array<{ filename: string; message: string }>>([]);

  const trainingSources = useMemo(
    () => sources.filter((source) => /\.jsonl?$/i.test(source.filename)),
    [sources],
  );
  const snapshot = revision?.trainingDataSnapshot;
  const dispositionCount = snapshot
    ? snapshot.counts.eligible + snapshot.counts.pendingReview + snapshot.counts.excluded
    : 0;

  useEffect(() => {
    setSelectedSourceIds((current) => current.filter((id) => trainingSources.some((source) => source.id === id)));
  }, [trainingSources]);

  useEffect(() => {
    setSelectedSourceIds([]);
    setTrainingConsent(false);
  }, [datasetId]);

  useEffect(() => {
    if (!revision?.trainingDataSnapshot) {
      setRecords([]);
      setRecordTotal(0);
      setRecordsError(null);
      return;
    }
    let active = true;
    setRecordsLoading(true);
    setRecordsError(null);
    void client.listTrainingRecords(revision.id, {
      offset,
      limit: PAGE_SIZE,
      ...(disposition === "all" ? {} : { disposition }),
      ...(appliedIssueCode ? { issueCode: appliedIssueCode } : {}),
    }).then(
      (page) => {
        if (!active) return;
        setRecords(page.records);
        setRecordTotal(page.total);
        setRawEdits({});
        setRecordsLoading(false);
      },
      (error: unknown) => {
        if (!active) return;
        setRecordsError(userFacingCatalystError(error));
        setRecordsLoading(false);
      },
    );
    return () => { active = false; };
  }, [client, revision?.id, Boolean(revision?.trainingDataSnapshot), offset, disposition, appliedIssueCode, recordReloadKey]);

  const uploadTrainingSources = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    if (selectedFiles.some((file) => !/\.jsonl?$/i.test(file.name))) {
      setActionError(l("Choose JSON or JSONL files only."));
      return;
    }
    setAction("upload");
    setActionError(null);
    setUploadFailures([]);
    try {
      const response = await client.uploadSourcesBatch(datasetId, selectedFiles);
      const uploaded = response.items.flatMap((item) => item.source ? [item.source] : []);
      const failures = summarizeTrainingUploadFailures(response.items);
      onSourcesUploaded(uploaded);
      setSelectedSourceIds(uploaded.filter((source) => /\.jsonl?$/i.test(source.filename)).map((source) => source.id));
      setTrainingConsent(false);
      setUploadFailures(failures);
      if (uploaded.length === 0 && failures.length === 0) setActionError(l("No training files were stored."));
    } catch (error) {
      setActionError(userFacingCatalystError(error));
    } finally {
      setAction(null);
    }
  };

  const startCuration = async () => {
    if (selectedSourceIds.length === 0) {
      setActionError(l("Select at least one JSON or JSONL source."));
      return;
    }
    try {
      const fieldMapping = parseMapping(fieldMappingText, l);
      const roleMapping = parseRoleMapping(roleMappingText, l);
      if (!trainingConsent) throw new Error(l("Confirm that the selected sources are permitted for model training."));
      setAction("curate");
      setActionError(null);
      const run = await client.createProcessingRun(datasetId, {
        operation: "curateTrainingData",
        sourceRevisionIds: selectedSourceIds,
        config: {
          sourcePolicies: Object.fromEntries(selectedSourceIds.map((sourceId) => [sourceId, trainingPolicy()])),
          curation: {
            id: "training-curation-v1",
            version: "1",
            format,
            fieldMapping,
            roleMapping,
            maxCharacters,
            minCharacters,
            unicodeNormalization: "NFC",
          },
        },
      });
      onRunStarted(run);
    } catch (error) {
      setActionError(userFacingCatalystError(error));
    } finally {
      setAction(null);
    }
  };

  const editRecord = async (record: TrainingDataRecord, kind: "approve" | "exclude" | "remap") => {
    if (!revision) return;
    setAction(`${kind}:${record.id}`);
    setActionError(null);
    try {
      const edits = {
        recordId: record.id,
        action: kind,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(kind === "remap" ? {
          format,
          fieldMapping: parseMapping(fieldMappingText, l),
          roleMapping: parseRoleMapping(roleMappingText, l),
          rawRecord: parseRawRecord(rawEdits[record.id] ?? record.rawRecord, l),
        } : {}),
      } as const;
      const next = await client.editTrainingRecords(revision.id, {
        resourceVersion: revision.resourceVersion,
        edits: [edits],
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onRevisionCreated(next);
      setNote("");
      setOffset(0);
      setRecordReloadKey((value) => value + 1);
    } catch (error) {
      setActionError(userFacingCatalystError(error));
    } finally {
      setAction(null);
    }
  };

  return (
    <Panel id="catalyst-training-curation" title={l("Training data curation")} meta={<span className="mono-label">{l("JSON / JSONL · VERSIONED RECIPE")}</span>}>
      <p>{l("Import existing training rows, inspect detected formats and issues, then approve or exclude each record. Record decisions create an immutable child revision.")}</p>
      <div className="catalyst-tools__recipe-grid">
        <div className="catalyst-tools__recipe-card">
          <h3>{l("Import training files")}</h3>
          <Field label={l("JSON or JSONL files")} hint={l("Up to 20 files per batch; originals remain in the source ledger.")}>
            <input type="file" multiple accept=".json,.jsonl,application/json,application/x-ndjson" disabled={busy || action !== null} onChange={(event) => {
              void uploadTrainingSources(event.currentTarget.files);
              event.currentTarget.value = "";
            }} />
          </Field>
          {uploadFailures.length > 0 ? <div className="inline-error" role="alert">
            <strong>{l("Some training files were not stored.")}</strong>
            <ul>{uploadFailures.map((failure) => <li key={`${failure.filename}:${failure.message}`}><strong>{failure.filename}</strong>: {l(failure.message)}</li>)}</ul>
          </div> : null}
          {trainingSources.length > 0 ? <div className="catalyst-tools__source-list">
            {trainingSources.map((source) => <label className="catalyst-tools__source" key={source.id}>
              <span><input type="checkbox" checked={selectedSourceIds.includes(source.id)} disabled={busy || action !== null} onChange={(event) => {
                setSelectedSourceIds((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id));
                setTrainingConsent(false);
              }} /> <strong>{source.filename}</strong></span>
              <span>{source.byteLength.toLocaleString()} bytes · {source.digest}</span>
            </label>)}
          </div> : <StateBlock kind="empty" title={l("No JSON or JSONL sources yet")} detail={l("Choose training files above, or add JSON files in the source list.")} />}
        </div>
          <div className="catalyst-tools__recipe-card">
            <h3>{l("Detection and mapping")}</h3>
            <label className="field"><span className="field__label">{l("Training data use")}</span><span className="field__control"><input type="checkbox" checked={trainingConsent} disabled={busy || action !== null} onChange={(event) => setTrainingConsent(event.target.checked)} /> {l("I confirm the selected sources are permitted for model training.")}</span></label>
          <Field label={l("Input format")} hint={l("Auto-detect common formats, or select one when detection is ambiguous.")}>
            <select value={format} disabled={busy || action !== null} onChange={(event) => setFormat(event.target.value as TrainingDataFormat)}>
              <option value="auto">{l("Automatic detection")}</option>
              <option value="alpaca">Alpaca</option>
              <option value="promptCompletion">Prompt / completion</option>
              <option value="messages">OpenAI / TRL messages</option>
              <option value="sharegpt">ShareGPT conversations</option>
              <option value="chatml">ChatML</option>
            </select>
          </Field>
          <Field label={l("Field mapping JSON")} hint={l("Map canonical fields to source field names, for example {\"prompt\":\"question\"}.")}>
            <textarea rows={2} value={fieldMappingText} disabled={busy || action !== null} onChange={(event) => setFieldMappingText(event.target.value)} />
          </Field>
          <Field label={l("Role mapping JSON")} hint={l("Map custom source roles to system, user, or assistant explicitly.")}>
            <textarea rows={2} value={roleMappingText} disabled={busy || action !== null} onChange={(event) => setRoleMappingText(event.target.value)} />
          </Field>
          <div className="catalyst-tools__split-grid">
            <Field label={l("Minimum characters")}><input type="number" min={0} value={minCharacters} disabled={busy || action !== null} onChange={(event) => setMinCharacters(Number(event.target.value))} /></Field>
            <Field label={l("Maximum characters")}><input type="number" min={1} value={maxCharacters} disabled={busy || action !== null} onChange={(event) => setMaxCharacters(Number(event.target.value))} /></Field>
          </div>
          <Button disabled={busy || action !== null || selectedSourceIds.length === 0 || !trainingConsent || minCharacters < 0 || maxCharacters < 1 || minCharacters > maxCharacters} loading={action === "curate"} onClick={() => void startCuration()}>
            {action === "curate" ? l("Starting...") : l("Detect and normalize selected files")}
          </Button>
        </div>
      </div>

      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}

      {revision?.trainingDataSnapshot ? <section aria-label={l("Training record review")}>
        <div className="catalyst-tools__revision-toolbar">
          <div><strong>{l("Training record review")}</strong><span>{l("Content revision")} {revision.revision} · {revision.trainingDataSnapshot.recordCount.toLocaleString()} {l("records")}</span></div>
          <StatusPill value={l(revision.state)} tone={statusTone(revision.state)} />
        </div>
        <p>{l("Snapshot artifact")}: <span className="dh-id">{revision.trainingDataSnapshot.artifact.digest}</span></p>
        <dl className="catalyst-tools__counts">
          <Count label={l("Total records")} value={snapshot?.counts.total ?? 0} />
          <Count label={l("Recognized")} value={snapshot?.counts.recognized ?? 0} />
          <Count label={l("Format errors")} value={snapshot?.counts.formatErrors ?? 0} />
          <Count label={l("Duplicate candidates")} value={snapshot?.counts.duplicateCandidates ?? 0} />
          <Count label={l("Pending review")} value={snapshot?.counts.pendingReview ?? 0} />
          <Count label={l("Excluded")} value={snapshot?.counts.excluded ?? 0} />
          <Count label={l("Eligible")} value={snapshot?.counts.eligible ?? 0} />
        </dl>
        {snapshot && dispositionCount !== snapshot.counts.total ? <p className="inline-error" role="alert">{l("Record disposition counts do not reconcile with the total. Publishing remains blocked until Catalyst reports consistent counts.")}</p> : null}
        <p className="catalyst-tools__limit">{l("The recognized, format-error, and duplicate counts can overlap. Eligible, pending-review, and excluded counts add up to the total.")}</p>
        <div className="catalyst-tools__revision-toolbar">
          <Field label={l("Disposition")}>
            <select value={disposition} onChange={(event) => { setDisposition(event.target.value as typeof disposition); setOffset(0); }}>
              <option value="all">{l("All records")}</option><option value="eligible">{l("Eligible")}</option><option value="review">{l("Pending review")}</option><option value="excluded">{l("Excluded")}</option>
            </select>
          </Field>
          <Field label={l("Issue type or code")}>
            <input value={issueCode} onChange={(event) => { setIssueCode(event.target.value); setOffset(0); }} placeholder={l("Filter by issue code")} />
          </Field>
          <Button disabled={recordsLoading} onClick={() => { setOffset(0); setAppliedIssueCode(issueCode.trim()); setRecordReloadKey((value) => value + 1); }}>{l("Apply filters")}</Button>
        </div>
        {recordsError ? <StateBlock kind="error" title={l("Training records unavailable")} detail={recordsError} action={<Button onClick={() => setRecordReloadKey((value) => value + 1)}>{l("Try again")}</Button>} />
          : recordsLoading && records.length === 0 ? <StateBlock kind="loading" title={l("Loading training records")} detail={l("Reading one page of records from the immutable snapshot.")} />
            : records.length > 0 ? <div className="catalyst-tools__run-list">
              {records.map((record) => <TrainingRecordCard
                key={record.id}
                record={record}
                locale={locale}
                busy={busy || action !== null || revision.state !== "DRAFT"}
                action={action}
                note={note}
                rawEdit={rawEdits[record.id] ?? prettyJson(record.rawRecord ?? record.rawLine ?? "")}
                onNoteChange={setNote}
                onRawEditChange={(value) => setRawEdits((current) => ({ ...current, [record.id]: value }))}
                onApprove={() => void editRecord(record, "approve")}
                onExclude={() => void editRecord(record, "exclude")}
                onRemap={() => void editRecord(record, "remap")}
              />)}
              <div className="form-actions">
                <Button disabled={offset === 0 || recordsLoading} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>{l("Previous page")}</Button>
                <span>{offset + 1}–{Math.min(offset + records.length, recordTotal)} / {recordTotal.toLocaleString()}</span>
                <Button disabled={offset + records.length >= recordTotal || recordsLoading} onClick={() => setOffset((value) => value + PAGE_SIZE)}>{l("Next page")}</Button>
              </div>
            </div> : <StateBlock kind="empty" title={l("No records match these filters")} detail={l("Change the issue or disposition filters to see other records.")} />}
      </section> : null}
    </Panel>
  );
}

export function TrainingRecordCard({
  record,
  locale,
  busy,
  action,
  note,
  rawEdit,
  onNoteChange,
  onRawEditChange,
  onApprove,
  onExclude,
  onRemap,
}: {
  record: TrainingDataRecord;
  locale: "zh-CN" | "en-US";
  busy: boolean;
  action: string | null;
  note: string;
  rawEdit: string;
  onNoteChange: (note: string) => void;
  onRawEditChange: (value: string) => void;
  onApprove: () => void;
  onExclude: () => void;
  onRemap: () => void;
}) {
  const l = (value: string) => catalystText(value, locale);
  return <article id={`training-record-${record.id}`} className="catalyst-tools__run">
    <div className="catalyst-tools__run-heading">
      <strong>{record.sampleId} · {l(record.detectedFormat)}</strong>
      <StatusPill value={l(record.disposition)} tone={statusTone(record.disposition.toUpperCase())} />
    </div>
    <p>{l("Source family")} <span className="dh-id">{record.sourceFamilyId}</span> · {l("Source revision")} <span className="dh-id">{record.sourceRevisionId}</span></p>
    <p>{l("Conversation ID")} {record.conversationId || l("Not reported")} · {l("Location")} {String(record.locator.itemRef ?? record.ordinal)}</p>
    <p>{l("Training use policy")} {l(record.policy?.allowTraining ? "Allowed" : "Blocked")} · {l("Content digest")} <span className="dh-id">{record.contentDigest}</span> · {l("Recipe digest")} <span className="dh-id">{record.recipeDigest}</span></p>
    {record.issues.length > 0 ? <ul>{record.issues.map((issue, index) => <li key={`${issue.code}:${index}`}><strong>{issue.code}</strong> · {l(issue.severity)} · {issue.message}</li>)}</ul> : <p>{l("No detected issues.")}</p>}
    <details>
      <summary>{l("Compare original and normalized messages")}</summary>
      <div className="catalyst-tools__recipe-grid">
        <div><h4>{l("Original record")}</h4><pre>{prettyJson(record.rawRecord ?? record.rawLine ?? "")}</pre></div>
        <div><h4>{l("Normalized messages")}</h4><pre>{prettyJson(record.normalized ?? null)}</pre></div>
      </div>
    </details>
    <details>
      <summary>{l("Processing history and manual correction")}</summary>
      <pre>{prettyJson(record.processingHistory)}</pre>
      <Field label={l("Corrected original fields JSON")} hint={l("Keep the source fields and edit only values that need correction. The original remains in the prior revision.")}>
        <textarea rows={5} value={rawEdit} disabled={busy} onChange={(event) => onRawEditChange(event.target.value)} />
      </Field>
    </details>
    {record.disposition !== "eligible" ? <Field label={l("Review note")}><textarea rows={2} value={note} disabled={busy} onChange={(event) => onNoteChange(event.target.value)} /></Field> : null}
    <div className="catalyst-tools__run-actions">
      {record.disposition === "review" ? <Button disabled={busy} loading={action === `approve:${record.id}`} onClick={onApprove}>{l("Approve record")}</Button> : null}
      {record.disposition !== "eligible" ? <>
        <Button disabled={busy} loading={action === `remap:${record.id}`} onClick={onRemap}>{l("Apply manual field and role mapping")}</Button>
      </> : null}
      {record.disposition !== "excluded" ? <Button tone="danger" disabled={busy} loading={action === `exclude:${record.id}`} onClick={onExclude}>{l("Exclude record")}</Button> : null}
    </div>
  </article>;
}

function Count({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value.toLocaleString()}</dd></div>;
}

function parseMapping(value: string, l: (value: string) => string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error(l("Mappings must be valid JSON objects.")); }
  if (!isRecord(parsed) || Object.values(parsed).some((entry) => typeof entry !== "string")) {
    throw new Error(l("Mappings must be valid JSON objects with string values."));
  }
  return parsed as Record<string, string>;
}

function parseRoleMapping(value: string, l: (value: string) => string): Record<string, string> {
  const mapping = parseMapping(value, l);
  if (Object.values(mapping).some((role) => role !== "system" && role !== "user" && role !== "assistant")) {
    throw new Error(l("Role mappings may target only system, user, or assistant."));
  }
  return mapping;
}

function parseRawRecord(value: unknown, l: (value: string) => string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = typeof value === "string" ? JSON.parse(value) : value; }
  catch { throw new Error(l("Corrected source fields must be valid JSON.")); }
  if (!isRecord(parsed)) throw new Error(l("Corrected source fields must be a JSON object."));
  return parsed;
}

function prettyJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? "null"; }
  catch { return String(value); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trainingPolicy(): ContentPolicy {
  return {
    allowKnowledge: false,
    allowTraining: true,
    allowedPrincipalRefs: [],
    allowedUsePurposes: ["model_training"],
  };
}

export function summarizeTrainingUploadFailures(
  items: readonly Pick<SourceBatchItem, "filename" | "error">[],
): Array<{ filename: string; message: string }> {
  return items.flatMap((item) => item.error
    ? [{ filename: item.filename, message: userFacingSourceItemError(item.error) }]
    : []);
}
