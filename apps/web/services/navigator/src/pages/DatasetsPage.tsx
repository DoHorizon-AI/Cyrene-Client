import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Field, formatDate, PageHeader, Panel, ResourceTable, StateBlock, StatusPill, text } from "../components";
import { type DatasetPreview, type JsonRecord } from "../api";
import { useI18n } from "../i18n";
import { CatalystDataToolsPanel } from "../../../catalyst/src/CatalystDataToolsPanel";
import { type PageProps, resourceId, errorMessage } from "./shared";

/**
 * Catalyst dataset containers with a deliberately small create surface.
 * 提供有意保持精简创建流程的 Catalyst 数据集容器。
 */
/**
 * Media type to send when the browser reports none.
 * 浏览器未报告媒体类型时应发送的默认值。
 */
function contentTypeFor(filename: string): string {
  const suffix = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (suffix === ".csv") return "text/csv";
  if (suffix === ".jsonl" || suffix === ".ndjson") return "application/x-ndjson";
  if (suffix === ".json") return "application/json";
  if (suffix === ".parquet") return "application/vnd.apache.parquet";
  return "text/plain";
}

export function DatasetsPage({ api }: PageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [datasets, setDatasets] = useState<JsonRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Sample preview state
  // 中文：样本预览状态。
  const [previewVersionId, setPreviewVersionId] = useState("");
  const [previewLimit, setPreviewLimit] = useState(10);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DatasetPreview | null>(null);

  // Preparation workflow: upload -> map -> confirm -> publish -> hand to Yield.
  // 中文：预处理流程：上传 → 映射 → 确认 → 发布 → 交给 Yield。
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [preparations, setPreparations] = useState<JsonRecord[] | null>(null);
  const [preparationId, setPreparationId] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowNotice, setWorkflowNotice] = useState<string | null>(null);
  const [instructionField, setInstructionField] = useState("");
  const [inputField, setInputField] = useState("");
  const [outputField, setOutputField] = useState("");

  const detectedFields = (() => {
    const row = preparations?.find((item) => text(item["id"]) === preparationId);
    const raw = row?.["detectedFields"];
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  })();

  const loadPreview = async (versionId: string, limit = 10, offset = 0) => {
    const vid = versionId.trim();
    if (!vid) {
      setPreviewError("Enter or select a DatasetVersion ID to preview samples.");
      return;
    }
    setPreviewVersionId(vid);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.getDatasetVersionPreview(vid, limit, offset);
      setPreviewData(result);
    } catch (err) {
      setPreviewError(errorMessage(err));
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api.getDatasets().then(
      (value) => {
        if (active) {
          setDatasets(value);
          setError(null);
          setLoading(false);
        }
      },
      (reason: unknown) => {
        if (active) {
          setDatasets(null);
          setError(errorMessage(reason));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const submitDataset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setFormError("A dataset name is required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      await api.createDataset({ name: cleanName, description: description.trim() });
      setName("");
      setDescription("");
      setNotice("Dataset container created. Upload and preparation remain Catalyst-owned steps.");
      setReloadKey((value) => value + 1);
    } catch (submitError) {
      setFormError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const runWorkflow = async (label: string, action: () => Promise<JsonRecord>) => {
    setWorkflowBusy(true);
    setWorkflowError(null);
    setWorkflowNotice(null);
    try {
      const result = await action();
      const refreshed = await api.getPreparations(selectedDatasetId);
      setPreparations(refreshed);
      const nextId = text(result["id"], preparationId);
      if (nextId) setPreparationId(nextId);
      setWorkflowNotice(`${label} completed.${result["state"] ? ` State: ${text(result["state"])}.` : ""}`);
    } catch (workflowErr) {
      setWorkflowError(errorMessage(workflowErr));
    } finally {
      setWorkflowBusy(false);
    }
  };

  const onDatasetChosen = (id: string) => {
    setSelectedDatasetId(id);
    setPreparationId("");
    setPreparations(null);
    if (!id) return;
    void api.getPreparations(id).then(setPreparations, () => setPreparations(null));
  };

  const handleUpload = async (file: File) => {
    if (!selectedDatasetId) {
      setWorkflowError("Choose a dataset before uploading.");
      return;
    }
    setWorkflowBusy(true);
    setWorkflowError(null);
    setWorkflowNotice(null);
    try {
      // Catalyst reads the raw body, so the text is sent as-is. Browsers often
      // report no MIME type for .jsonl, and Catalyst derives CSV/Parquet from
      // the media type, so fall back to the suffix instead of assuming JSON.
      // 中文：Catalyst 读取原始请求正文，因此会原样发送文本。浏览器通常不会为 `.jsonl` 报告媒体类型；Catalyst 会根据媒体类型推断 CSV/Parquet，所以这里根据文件后缀回退，而不是假定内容一定是 JSON。
      const content = await file.text();
      const created = await api.createPreparation(
        selectedDatasetId,
        uploadName.trim() || file.name,
        file.name,
        content,
        file.type || contentTypeFor(file.name),
      );
      const refreshed = await api.getPreparations(selectedDatasetId);
      setPreparations(refreshed);
      setPreparationId(text(created["id"], ""));
      setWorkflowNotice(`Uploaded ${file.name}. Map the detected fields next.`);
    } catch (uploadError) {
      setWorkflowError(errorMessage(uploadError));
    } finally {
      setWorkflowBusy(false);
    }
  };

  const handleMap = () =>
    runWorkflow("Mapping", () =>
      api.configurePreparationMapping(preparationId, {
        mapping: {
          mode: "instruction",
          instruction: instructionField ? { field: instructionField } : null,
          input: inputField ? { field: inputField } : null,
          output: outputField ? { field: outputField } : null,
        },
        normalization: { trimWhitespace: true, collapseWhitespace: true, unicodeNfc: true },
      }),
    );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Catalyst / 02"
        title={t("Make the data legible.")}
        description="Create the owned container first. Preparation, mapping, quality, and split decisions stay visible at Catalyst rather than being guessed here."
        action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{t("Refresh datasets")}</Button>}
      />

      <Panel title={t("New dataset container")} meta={<span className="mono-label">{t("CATALYST OWNS STATE")}</span>}>
        <form className="form-grid form-grid--compact" onSubmit={submitDataset}>
          <Field label="Name">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("instruction-tuning-v1")} />
          </Field>
          <Field label="Description" hint="Optional context for the preparation team.">
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("Curated instruction examples")} />
          </Field>
          <div className="form-actions">
            <Button tone="primary" type="submit" disabled={submitting}>{submitting ? "Creating..." : "Create dataset"}</Button>
            {formError ? <span className="form-message form-message--error" role="alert">{formError}</span> : null}
            {notice ? <span className="form-message form-message--success">{notice}</span> : null}
          </div>
        </form>
      </Panel>

      <Panel title={t("Prepare data")} meta={<span className="mono-label">{t("UPLOAD → MAP → PREPARE → PUBLISH")}</span>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
          <Field label="Dataset" hint="Preparation always belongs to one dataset.">
            <select
              className="input-mono"
              value={selectedDatasetId}
              onChange={(event) => onDatasetChosen(event.target.value)}
            >
              <option value="">{t("Select a dataset")}</option>
              {datasets?.map((row, index) => (
                <option key={text(row["id"], `dataset-${index}`)} value={text(row["id"], "")}>
                  {text(row["name"], "Unnamed dataset")}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Preparation name" hint="Optional; defaults to the filename.">
            <input
              className="input-mono"
              value={uploadName}
              onChange={(event) => setUploadName(event.target.value)}
              placeholder={t("instruction-tuning-v1")}
            />
          </Field>

          <Field label="Upload source file" hint="JSONL / JSON / CSV / TEXT. The file is sent as the request body.">
            <input
              type="file"
              accept=".jsonl,.json,.csv,.txt,application/json,text/csv,text/plain"
              disabled={!selectedDatasetId || workflowBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
                event.target.value = "";
              }}
            />
          </Field>
        </div>

        <Field label="Preparation" hint="Pick the uploaded preparation to map and publish.">
          <select
            className="input-mono"
            value={preparationId}
            onChange={(event) => setPreparationId(event.target.value)}
            disabled={!preparations?.length}
          >
            <option value="">
              {preparations ? (preparations.length ? "Select a preparation" : "No preparations yet") : "Choose a dataset first"}
            </option>
            {preparations?.map((row, index) => (
              <option key={text(row["id"], `prep-${index}`)} value={text(row["id"], "")}>
                {`${text(row["name"], "unnamed")} — ${text(row["state"], "UNKNOWN")}`}
              </option>
            ))}
          </select>
        </Field>

        {preparationId ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            <Field label="Instruction field" hint="Detected columns from the upload.">
              <select className="input-mono" value={instructionField} onChange={(event) => setInstructionField(event.target.value)}>
                <option value="">{t("(none)")}</option>
                {detectedFields.map((field) => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </Field>
            <Field label="Input field" hint="Optional context column.">
              <select className="input-mono" value={inputField} onChange={(event) => setInputField(event.target.value)}>
                <option value="">{t("(none)")}</option>
                {detectedFields.map((field) => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </Field>
            <Field label="Output field" hint="Target completion column.">
              <select className="input-mono" value={outputField} onChange={(event) => setOutputField(event.target.value)}>
                <option value="">{t("(none)")}</option>
                {detectedFields.map((field) => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}

        <div className="form-actions">
          <Button tone="primary" disabled={!preparationId || workflowBusy} onClick={() => void handleMap()}>
            {workflowBusy ? "Working..." : "Save mapping"}
          </Button>
          <Button
            disabled={!preparationId || workflowBusy}
            onClick={() => void runWorkflow("Preparation", () => api.confirmPreparation(preparationId))}
          >{t("Prepare")}</Button>
          <Button
            disabled={!preparationId || workflowBusy}
            onClick={() => void runWorkflow("Publish", () => api.publishPreparation(preparationId))}
          >{t("Publish version")}</Button>
          <Button
            disabled={!preparationId || workflowBusy}
            onClick={() => void runWorkflow("Handoff", () => api.sendPreparationToYield(preparationId))}
          >{t("Send to Yield")}</Button>
        </div>
        {workflowError ? <p className="inline-error" role="alert">{workflowError}</p> : null}
        {workflowNotice ? <p className="form-message form-message--success">{workflowNotice}</p> : null}
      </Panel>

      <CatalystDataToolsPanel
        datasets={datasets}
        datasetsLoading={loading}
        datasetsError={error}
        onRefreshDatasets={() => setReloadKey((value) => value + 1)}
        transport={api}
      />

      <Panel title={t("Dataset containers")} meta={datasets ? `${datasets.length} records` : "LIVE READ"}>
        {loading ? (
          <StateBlock kind="loading" title={t("Reading datasets")} detail="Catalyst is the authority for containers and their lifecycle." />
        ) : error ? (
          <StateBlock kind="error" title={t("Datasets unavailable")} detail={error} action={<Button onClick={() => setReloadKey((value) => value + 1)}>{t("Try again")}</Button>} />
        ) : datasets && datasets.length > 0 ? (
          <ResourceTable
            rows={datasets}
            rowKey={resourceId}
            caption="Catalyst datasets"
            columns={[
              { label: "Dataset", render: (row) => <strong>{text(row["name"], "Unnamed dataset")}</strong> },
              { label: "State", render: (row) => <StatusPill value={text(row["state"], "UNKNOWN")} /> },
              { label: "Description", render: (row) => text(row["description"], "No description") },
              { label: "Version", render: (row) => <span className="input-mono">{t("v")}{text(row["resourceVersion"], "-")}</span> },
              { label: "Updated", render: (row) => formatDate(row["updatedAt"]) },
              {
                label: "Action",
                render: (row) => {
                  const id = text(row["id"] || row["datasetId"]);
                  return (
                    <Button
                      onClick={() => {
                        setPreviewVersionId(id);
                        void loadPreview(id, previewLimit, previewOffset);
                      }}
                    >{t("预览样本")}</Button>
                  );
                },
              },
            ]}
          />
        ) : (
          <StateBlock kind="empty" title={t("No dataset containers")} detail="Create the container that will own your next preparation flow." />
        )}
      </Panel>

      <Panel
        title={t("Dataset version sample preview")}
        meta={previewData ? `${previewData.totalRows} total rows` : "CATALYST DUCKDB"}
      >
        <form
          className="form-grid form-grid--compact"
          onSubmit={(e) => {
            e.preventDefault();
            void loadPreview(previewVersionId, previewLimit, previewOffset);
          }}
        >
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 300px" }}>
              <Field label="Dataset version ID" hint="UUID of the prepared dataset version">
                <input
                  className="input-mono"
                  value={previewVersionId}
                  onChange={(e) => setPreviewVersionId(e.target.value)}
                  placeholder={t("e.g. 11111111-2222-3333-4444-555555555555")}
                />
              </Field>
            </div>
            <div style={{ width: "100px" }}>
              <Field label="Limit">
                <select
                  value={previewLimit}
                  onChange={(e) => setPreviewLimit(Number(e.target.value))}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                </select>
              </Field>
            </div>
            <div style={{ width: "100px" }}>
              <Field label="Offset">
                <input
                  type="number"
                  min="0"
                  value={previewOffset}
                  onChange={(e) => setPreviewOffset(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="input-mono"
                />
              </Field>
            </div>
            <div>
              <Button
                tone="primary"
                type="submit"
                disabled={previewLoading || !previewVersionId.trim()}
              >
                {previewLoading ? "Loading..." : "预览样本"}
              </Button>
            </div>
          </div>
        </form>

        {previewLoading ? (
          <StateBlock
            kind="loading"
            title={t("Loading sample preview")}
            detail="Catalyst DuckDB is reading sample rows from the CAS parquet/jsonl artifact."
          />
        ) : previewError ? (
          <StateBlock kind="error" title={t("Preview unavailable")} detail={previewError} />
        ) : previewData ? (
          <div style={{ marginTop: "16px" }}>
            <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "12px" }}>{t("Displaying")}{previewData.rows.length}{t("rows (out of")}{previewData.totalRows}{t("total rows) for version")}<code className="input-mono">{previewData.versionId}</code>
            </p>
            <div style={{ display: "grid", gap: "12px" }}>
              {previewData.rows.map((row) => (
                <div
                  key={row.index}
                  style={{
                    background: "rgba(17, 29, 34, 0.6)",
                    border: "1px solid var(--line)",
                    borderRadius: "6px",
                    padding: "12px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span className="mono-label">{t("ROW #")}{row.index + 1}</span>
                  </div>
                  <div style={{ display: "grid", gap: "6px", fontSize: "13px" }}>
                    {row.mapped["instruction"] !== undefined ? (
                      <div>
                        <strong style={{ color: "var(--blue)" }}>{t("Instruction:")}</strong>
                        <span>{String(row.mapped["instruction"])}</span>
                      </div>
                    ) : null}
                    {row.mapped["input"] ? (
                      <div>
                        <strong style={{ color: "var(--muted)" }}>{t("Input:")}</strong>
                        <span>{String(row.mapped["input"])}</span>
                      </div>
                    ) : null}
                    {row.mapped["output"] !== undefined ? (
                      <div>
                        <strong style={{ color: "var(--lime)" }}>{t("Output:")}</strong>
                        <span>{String(row.mapped["output"])}</span>
                      </div>
                    ) : null}
                  </div>
                  <details style={{ marginTop: "8px", fontSize: "12px", color: "var(--faint)" }}>
                    <summary style={{ cursor: "pointer", userSelect: "none" }}>{t("Raw record JSON")}</summary>
                    <pre
                      style={{
                        background: "var(--ink-soft)",
                        padding: "8px",
                        borderRadius: "4px",
                        overflowX: "auto",
                        marginTop: "6px",
                        color: "var(--text)",
                        fontFamily: "var(--mono)",
                        fontSize: "11px",
                      }}
                    >
                      {JSON.stringify(row.raw, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <StateBlock
            kind="empty"
            title={t("No samples loaded")}
            detail="Enter a version ID above or click preview on a dataset container to inspect mapped samples."
          />
        )}
      </Panel>
    </div>
  );
}
