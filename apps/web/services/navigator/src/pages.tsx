// -----------------------------------------------------------------------------
// Module: src/pages.tsx
// Role: The seven Navigator console pages and their owning Product reads.
// -----------------------------------------------------------------------------
// 中文：// 中文：模块职责：实现 Navigator 控制台的七个页面及其所属 Product 的读取操作。

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import {
  count,
  Button,
  Field,
  formatDate,
  MetricCard,
  PageHeader,
  Panel,
  ResourceTable,
  StateBlock,
  StatusPill,
  statusTone,
  text,
  WorkflowSteps,
  type WorkflowStep,
} from "./components";
import {
  type ActiveRoutePayload,
  type ApiKeyMetadata,
  type CredentialMetadata,
  type CreateModelImportInput,
  type DatasetPreview,
  type DeploymentEvent,
  type JsonRecord,
  NAVIGATOR_PROXY_PATHS,
  NavigatorApi,
  NavigatorContractError,
  NavigatorHttpError,
  makeIdempotencyKey,
  type SessionPayload,
  type SystemStatus,
  type TrainingParametersInput,
} from "./api";
import { studioProductFetch } from "../../../src/products/transport";
import { pushRoute, pushRunRoute, runIdForLocation, routeForPath } from "./router";
import { useTrainingRun, type TrainingRunClient } from "./use-training-run";
import { useI18n } from "./i18n";
import { CatalystDataToolsPanel } from "../../catalyst/src/CatalystDataToolsPanel";

export interface PageProps {
  api: NavigatorApi;
}

interface SettingsPageProps extends PageProps {
  session: SessionPayload;
}

/**
 * Workspace-level status cards and independently refreshed service observations.
 * 展示 Workspace 级状态卡片和分别刷新的服务观测信息。
 */
export function OverviewPage({ api }: PageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [models, setModels] = useState<JsonRecord[] | null>(null);
  const [datasets, setDatasets] = useState<JsonRecord[] | null>(null);
  const [drafts, setDrafts] = useState<JsonRecord[] | null>(null);
  const [deployments, setDeployments] = useState<JsonRecord[] | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled([
      api.getSystemStatus(),
      api.getModelImports(),
      api.getDatasets(),
      api.getTrainingDrafts(),
      api.getDeployments(),
    ]).then(([systemResult, modelsResult, datasetsResult, draftsResult, deploymentsResult]) => {
      if (!active) {
        return;
      }
      const nextFailures: string[] = [];
      const nextSystem = settledValue(systemResult, "Host status", nextFailures);
      const nextModels = settledValue(modelsResult, "Models", nextFailures);
      const nextDatasets = settledValue(datasetsResult, "Datasets", nextFailures);
      const nextDrafts = settledValue(draftsResult, "Training", nextFailures);
      const nextDeployments = settledValue(deploymentsResult, "Deployments", nextFailures);
      setSystem(nextSystem);
      setModels(nextModels);
      setDatasets(nextDatasets);
      setDrafts(nextDrafts);
      setDeployments(nextDeployments);
      setFailures(nextFailures);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const refresh = () => setReloadKey((value) => value + 1);

  return (
    <div className="page-stack overview-page">
      <PageHeader
        eyebrow="System / Overview"
        title={t("Workspace status")}
        description="Current service availability and host resources reported by the configured Product endpoints."
        action={
          <Button onClick={refresh} disabled={loading} aria-label={t("Refresh overview")}>
            {loading ? t("Refreshing...") : t("Refresh")}
          </Button>
        }
      />

      <div className="metric-grid">
        <MetricCard
          label="Model imports"
          value={loading ? "..." : count(models?.length ?? null)}
          detail={models === null ? "Reactor unavailable" : "Reactor"}
          accent="lime"
        />
        <MetricCard
          label="Dataset containers"
          value={loading ? "..." : count(datasets?.length ?? null)}
          detail={datasets === null ? "Catalyst unavailable" : "Catalyst"}
          accent="blue"
        />
        <MetricCard
          label="Training drafts"
          value={loading ? "..." : count(drafts?.length ?? null)}
          detail={drafts === null ? "Yield unavailable" : "Yield"}
          accent="orange"
        />
        <MetricCard
          label="Deployments"
          value={loading ? "..." : count(deployments?.length ?? null)}
          detail={deployments === null ? "Reactor unavailable" : "Reactor"}
          accent="gray"
        />
      </div>

      {loading ? (
        <StateBlock kind="loading" title={t("Refreshing status")} detail="Reading the host and configured Product endpoints." />
      ) : (
        <div className="overview-grid">
          <Panel
            title={t("Services")}
            meta={<StatusPill value={system?.status ?? "UNKNOWN"} />}
          >
            <div className="service-list">
              {[
                ["Navigator Web Host", system !== null],
                ["Reactor / models + serving", models !== null && deployments !== null],
                ["Catalyst / datasets", datasets !== null],
                ["Yield / training", drafts !== null],
              ].map(([label, available]) => (
                <div className="service-row" key={String(label)}>
                  <span className={`service-dot ${available ? "service-dot--good" : "service-dot--bad"}`} aria-hidden="true" />
                  <span>{t(String(label))}</span>
                  <strong>{t(available ? "Available" : "Unavailable")}</strong>
                </div>
              ))}
            </div>
            <div className="panel-footnote">
              {system
                ? `${system.proxyPrefixes.length} routes · Updated ${formatDate(system.observedAt)}`
                : "Host status is unavailable."}
            </div>
          </Panel>

          <Panel title={t("Issues")} meta={<span className="mono-label">{failures.length} {t("FAILED")}</span>}>
            {failures.length === 0 ? (
              <StateBlock
                kind="empty"
                title={t("No reported issues")}
                detail="All configured status requests completed successfully."
              />
            ) : (
              <div className="attention-list">
                {failures.map((failure) => (
                  <div className="attention-item" key={failure}>
                    <span className="attention-item__icon" aria-hidden="true">!</span>
                    <div>
                      <strong>{failure}</strong>
                      <p>{t("Check the service endpoint and its current binding, then refresh.")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title={t("Accelerators")}
            meta={<StatusPill value={system?.gpu?.available ? "AVAILABLE" : "UNAVAILABLE"} />}
          >
            {system?.gpu?.available && system.gpu.gpus && system.gpu.gpus.length > 0 ? (
              <div className="service-list">
                {system.gpu.gpus.map((gpu, idx) => (
                  <div className="service-row" key={idx}>
                    <span className="service-dot service-dot--good" aria-hidden="true" />
                    <span><strong>{gpu.name}</strong></span>
                    <span>{gpu.usedMib} / {gpu.totalMib}{t("MiB (")}{gpu.utilizationPct}{t("% util)")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <StateBlock
                kind="empty"
                title={t("No accelerator data")}
                detail={system?.gpu?.available === false ? "nvidia-smi is unavailable or no supported GPU was found." : "The host did not report hardware information."}
              />
            )}
          </Panel>

          <Panel
            title={t("Storage")}
            meta={<StatusPill value={system?.disk?.available !== false ? "MOUNTED" : "UNAVAILABLE"} />}
          >
            {system?.disk?.totalGib ? (
              <dl className="detail-grid">
                <Detail label="Total space" value={`${system.disk.totalGib} GiB`} />
                <Detail label="Used space" value={`${system.disk.usedGib ?? "-"} GiB`} />
                <Detail label="Free space" value={`${system.disk.freeGib ?? "-"} GiB`} />
                <Detail label="Utilization" value={`${system.disk.usedPct ?? "-"}%`} />
              </dl>
            ) : (
              <StateBlock kind="empty" title={t("Storage usage unavailable")} detail="Filesystem statistics not reported by host." />
            )}
          </Panel>

          <Panel
            title={t("Readiness")}
            meta={
              system?.blockers && system.blockers.length > 0 ? (
                <StatusPill value="BLOCKED" />
              ) : (
                <StatusPill value="READY" />
              )
            }
          >
            {system?.blockers && system.blockers.length > 0 ? (
              <div className="attention-list">
                {system.blockers.map((blocker) => (
                  <div className="attention-item attention-item--danger" key={blocker.code}>
                    <span className="attention-item__icon" aria-hidden="true">!</span>
                    <div>
                      <strong className="input-mono">{blocker.code}</strong>
                      <p>{blocker.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <StateBlock
                kind="empty"
                title={t("No reported blockers")}
                detail="The host status endpoint did not report any readiness blockers."
              />
            )}
          </Panel>

          <Panel
            title={t("Installed plugins")}
            meta={<span className="mono-label">{t("RUNTIME")}</span>}
          >
            {system?.plugins && system.plugins.length > 0 ? (
              <div className="service-list">
                {system.plugins.map((plugin) => (
                  <div className="service-row" key={plugin.name}>
                    <span
                      className={`service-dot service-dot--${statusTone(plugin.state)}`}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{plugin.name}</strong>
                      {plugin.kind ? <small className="service-row__kind">({plugin.kind})</small> : null}
                    </div>
                    <StatusPill value={plugin.state} />
                  </div>
                ))}
              </div>
            ) : (
              <StateBlock
                kind="empty"
                title={t("No plugins detected")}
                detail="No runtime plugins currently registered or reported by host."
              />
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

/**
 * Reactor model imports, binding choices, validation evidence, and import form.
 * 提供 Reactor 模型导入、binding 选择、校验依据和导入表单。
 */
export function ModelsPage({ api }: PageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [models, setModels] = useState<JsonRecord[] | null>(null);
  const [bindings, setBindings] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sourceKind, setSourceKind] = useState<CreateModelImportInput["source"]["kind"]>("HUGGING_FACE");
  const [repository, setRepository] = useState("");
  const [revision, setRevision] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [servingBindingId, setServingBindingId] = useState("");
  const [credentialRef, setCredentialRef] = useState("");
  const [credentials, setCredentials] = useState<CredentialMetadata[] | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled([
      api.getModelImports(),
      api.getServingBindings(),
      api.getCredentials().catch(() => []),
    ]).then(([modelResult, bindingResult, credentialResult]) => {
      if (!active) {
        return;
      }
      if (modelResult.status === "fulfilled") {
        setModels(modelResult.value);
        setError(null);
      } else {
        setModels(null);
        setError(errorMessage(modelResult.reason));
      }
      if (bindingResult.status === "fulfilled") {
        setBindings(bindingResult.value);
        setBindingError(null);
      } else {
        setBindings([]);
        setBindingError(errorMessage(bindingResult.reason));
      }
      // Credentials are metadata only; the select exposes names, never secrets.
      // 中文：凭据只保留元数据；选择框只显示名称，绝不显示密钥。
      setCredentials(credentialResult.status === "fulfilled" ? credentialResult.value : null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const submitImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    const cleanName = name.trim();
    const cleanBinding = servingBindingId.trim();
    if (!cleanName || !cleanBinding) {
      setFormError("A model name and serving binding are required.");
      return;
    }
    const source =
      sourceKind === "HUGGING_FACE"
        ? { kind: "HUGGING_FACE" as const, repository: repository.trim(), revision: revision.trim() }
        : { kind: "LOCAL_PATH" as const, path: localPath.trim() };
    if (sourceKind === "HUGGING_FACE" && (!source.repository || !/^[a-f0-9]{40}$/i.test(source.revision))) {
      setFormError("Hugging Face imports require owner/name and a pinned 40-character revision.");
      return;
    }
    if (sourceKind === "LOCAL_PATH" && !localPath.trim().startsWith("/")) {
      setFormError("Local imports require an absolute path admitted by Reactor.");
      return;
    }
    const input: CreateModelImportInput = {
      name: cleanName,
      servingBindingId: cleanBinding,
      source,
      trustRemoteCode: false,
      ...(credentialRef.trim() ? { credentialRef: credentialRef.trim() } : {}),
    };
    setSubmitting(true);
    try {
      await api.createModelImport(input);
      setName("");
      setRepository("");
      setRevision("");
      setLocalPath("");
      setCredentialRef("");
      setNotice("Model import submitted. Reactor owns validation progress.");
      setReloadKey((value) => value + 1);
    } catch (submitError) {
      setFormError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Reactor / 01"
        title={t("Models with receipts.")}
        description="Import a pinned source, then read Reactor's validation evidence before handing the artifact onward."
        action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{t("Refresh models")}</Button>}
      />

      <Panel title={t("Import a model")} meta={<span className="mono-label">{t("TRUST REMOTE CODE: OFF")}</span>}>
        <form className="form-grid" onSubmit={submitImport}>
          <Field label="Display name">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Qwen 2.5 1.5B Instruct")} />
          </Field>
          <Field label="Serving binding" hint={bindingError ?? "The binding is selected from Reactor's live list."}>
            <input
              value={servingBindingId}
              onChange={(event) => setServingBindingId(event.target.value)}
              list="serving-bindings"
              placeholder={t("llama-factory-serving-v1")}
            />
            <datalist id="serving-bindings">
              {bindings.map((binding, index) => (
                <option key={resourceId(binding, index)} value={text(binding["bindingId"] ?? binding["id"])} />
              ))}
            </datalist>
          </Field>
          <Field label="Source kind">
            <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as CreateModelImportInput["source"]["kind"])}>
              <option value="HUGGING_FACE">{t("Hugging Face repository")}</option>
              <option value="LOCAL_PATH">{t("Local absolute path")}</option>
            </select>
          </Field>
          {sourceKind === "HUGGING_FACE" ? (
            <>
              <Field label="Repository" hint="owner/name">
                <input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder={t("Qwen/Qwen2.5-1.5B-Instruct")} />
              </Field>
              <Field label="Pinned revision" hint="40 hexadecimal characters">
                <input className="input-mono" value={revision} onChange={(event) => setRevision(event.target.value)} placeholder={t("5fee7c4e...")} />
              </Field>
            </>
          ) : (
            <Field label="Absolute path" hint="Reactor validates access on the configured host.">
              <input className="input-mono" value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder={t("/models/weights")} />
            </Field>
          )}
          <Field
            label="Credential"
            hint="Optional. Private repositories need one; names are shown, secrets never are."
          >
            <select
              className="input-mono"
              value={credentialRef}
              onChange={(event) => setCredentialRef(event.target.value)}
            >
              <option value="">{t("No credential (public repository)")}</option>
              {credentials?.map((credential) => (
                <option key={credential.id} value={credential.credentialRef}>
                  {credential.name} ({credential.provider})
                </option>
              ))}
            </select>
            {credentials === null ? (
              <span className="field__hint">{t("Credentials could not be loaded — add one on the Settings page first.")}</span>
            ) : null}
          </Field>
          <div className="form-actions">
            <Button tone="primary" type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Start import"}</Button>
            {formError ? <span className="form-message form-message--error" role="alert">{formError}</span> : null}
            {notice ? <span className="form-message form-message--success">{notice}</span> : null}
          </div>
        </form>
      </Panel>

      <Panel title={t("Import ledger")} meta={models ? `${models.length} records` : "LIVE READ"}>
        {loading ? (
          <StateBlock kind="loading" title={t("Reading model imports")} detail="Reactor is the authority for import state and validation evidence." />
        ) : error ? (
          <StateBlock kind="error" title={t("Model imports unavailable")} detail={error} action={<Button onClick={() => setReloadKey((value) => value + 1)}>{t("Try again")}</Button>} />
        ) : models && models.length > 0 ? (
          <ResourceTable
            rows={models}
            rowKey={resourceId}
            caption="Reactor model imports"
            columns={[
              { label: "Model", render: (row) => <strong>{text(row["name"], "Unnamed import")}</strong> },
              { label: "State", render: (row) => <StatusPill value={text(row["state"], "UNKNOWN")} /> },
              { label: "Binding", render: (row) => <span className="input-mono">{text(row["servingBindingId"])}</span> },
              { label: "Evidence", render: (row) => validationSummary(row) },
              { label: "Updated", render: (row) => formatDate(row["updatedAt"]) },
            ]}
          />
        ) : (
          <StateBlock kind="empty" title={t("No imports yet")} detail="Submit a pinned model source above. Reactor will publish validation evidence here." />
        )}
      </Panel>
    </div>
  );
}

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
  // Default section keeps the dataset name field visible for the editor-tab flow.
  // 中文：默认停在「数据集与版本」，名称输入保持可见，文档工作台单独成页以缩短长页面。
  const [datasetSection, setDatasetSection] = useState<"registry" | "prepare" | "documents">("registry");

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

      <div className="dh-segmented dataset-sections" role="tablist" aria-label={t("Dataset workspace")}>
        {([
          ["registry", "Datasets and versions"],
          ["prepare", "Structured preparation"],
          ["documents", "Document workbench"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`button${datasetSection === id ? " button--primary" : ""}`}
            role="tab"
            aria-selected={datasetSection === id}
            onClick={() => setDatasetSection(id)}
          >{t(label)}</button>
        ))}
      </div>

      <div hidden={datasetSection !== "registry"}>
      <Panel title={t("New dataset container")} meta={<span className="mono-label">{t("CATALYST OWNS STATE")}</span>}>
        <form className="form-grid form-grid--compact" onSubmit={submitDataset}>
          <Field label="Name">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("instruction-tuning-v1")} />
          </Field>
          <Field label="Description" hint="Optional context for the preparation team.">
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("Curated instruction examples")} />
          </Field>
          <div className="form-actions">
            <Button tone={datasets && datasets.length > 0 ? undefined : "primary"} type="submit" disabled={submitting}>{submitting ? t("Creating...") : t("Create dataset")}</Button>
            {formError ? <span className="form-message form-message--error" role="alert">{formError}</span> : null}
            {notice ? <span className="form-message form-message--success">{notice}</span> : null}
          </div>
        </form>
      </Panel>
      </div>

      <div hidden={datasetSection !== "prepare"}>
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
          <Button disabled={!preparationId || workflowBusy} onClick={() => void handleMap()}>
            {workflowBusy ? t("Working...") : t("Save mapping")}
          </Button>
          <Button
            disabled={!preparationId || workflowBusy}
            onClick={() => void runWorkflow("Preparation", () => api.confirmPreparation(preparationId))}
          >{t("Prepare")}</Button>
          <Button
            tone={preparationId ? "primary" : undefined}
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
      </div>

      <div hidden={datasetSection !== "documents"}>
      <CatalystDataToolsPanel
        datasets={datasets}
        datasetsLoading={loading}
        datasetsError={error}
        onRefreshDatasets={() => setReloadKey((value) => value + 1)}
        transport={api}
      />
      </div>

      <div hidden={datasetSection !== "registry"}>
      <Panel title={t("Dataset containers")} meta={datasets ? `${datasets.length} ${t("records")}` : t("LIVE READ")}>
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
        meta={previewData ? `${previewData.totalRows} ${t("total rows")}` : t("CATALYST DUCKDB")}
      >
        <form
          className="form-grid form-grid--compact"
          onSubmit={(e) => {
            e.preventDefault();
            void loadPreview(previewVersionId, previewLimit, previewOffset);
          }}
        >
          <div className="dh-inline-form">
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
            <div className="dh-inline-form__action">
              <Button
                type="submit"
                disabled={previewLoading || !previewVersionId.trim()}
                loading={previewLoading}
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
          <div className="dh-preview">
            <p className="dh-preview__summary">{t("Displaying")}{previewData.rows.length}{t("rows (out of")}{previewData.totalRows}{t("total rows) for version")}<code className="input-mono">{previewData.versionId}</code>
            </p>
            <div className="dh-record-list">
              {previewData.rows.map((row) => (
                <div className="dh-record" key={row.index}>
                  <div className="dh-record__head">
                    <span className="mono-label">{t("ROW #")}{row.index + 1}</span>
                  </div>
                  <div className="dh-record__fields">
                    {row.mapped["instruction"] !== undefined ? (
                      <div>
                        <strong>{t("Instruction:")}</strong>
                        <span>{String(row.mapped["instruction"])}</span>
                      </div>
                    ) : null}
                    {row.mapped["input"] ? (
                      <div>
                        <strong>{t("Input:")}</strong>
                        <span>{String(row.mapped["input"])}</span>
                      </div>
                    ) : null}
                    {row.mapped["output"] !== undefined ? (
                      <div>
                        <strong>{t("Output:")}</strong>
                        <span>{String(row.mapped["output"])}</span>
                      </div>
                    ) : null}
                  </div>
                  <details>
                    <summary>{t("Raw record JSON")}</summary>
                    <pre className="dh-code-block">{JSON.stringify(row.raw, null, 2)}</pre>
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
    </div>
  );
}

export interface ParamFieldProps {
  label: string;
  hint: string;
  /**
   * Omitted for fields that are not LLaMA Factory parameters, such as pickers.
   * 对于非 LLaMA Factory 参数（例如选择器），此属性会省略。
   */
  llamaKey?: string;
  children: React.ReactNode;
}

/**
 * Parameter field with user-friendly hint and toggleable LLaMA Factory key.
 * 参数字段：显示用户友好提示，并可切换 LLaMA Factory 参数键。
 */
export function ParamField({ label, hint, llamaKey, children }: ParamFieldProps) {
  const { t } = useI18n();
  const [showKey, setShowKey] = useState(false);
  return (
    <div className="field">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <span className="field__label">{t(label)}</span>
        {llamaKey ? (
          <button
            type="button"
            className="button button--quiet"
            style={{ padding: "2px 6px", fontSize: "11px", height: "auto" }}
            onClick={() => setShowKey((v) => !v)}
          >
            {t(showKey ? "Hide LLaMA key" : "LLaMA Factory key")}
          </button>
        ) : null}
      </div>
      {children}
      <span className="field__hint">
        {t(hint)}
        {showKey && llamaKey && (
          <code style={{ marginLeft: "8px", color: "var(--lime)", fontFamily: "var(--mono)" }}>
            ({llamaKey})
          </code>
        )}
      </span>
    </div>
  );
}

/**
 * Read a prepared draft's base model so a relaunch does not have to re-choose one.
 * 读取已准备草稿的基础模型，使重新启动时无需再次选择模型。
 */
function draftBaseModel(row: JsonRecord): JsonRecord | null {
  const configuration = row["configuration"];
  if (typeof configuration !== "object" || configuration === null) {
    return null;
  }
  const baseModel = (configuration as JsonRecord)["baseModel"];
  if (typeof baseModel !== "object" || baseModel === null) {
    return null;
  }
  return baseModel as JsonRecord;
}

/**
 * Training draft list with explicit launch actions and hyperparameter reference.
 * 展示训练草稿列表、明确的启动操作和超参数参考。
 */
export function TrainingPage({ api }: PageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [drafts, setDrafts] = useState<JsonRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const launchLock = useRef(false);
  const launchActive = useRef(true);
  const pendingLaunches = useRef(new Map<string, { spec: string; key: string }>());
  useEffect(() => {
    launchActive.current = true;
    return () => { launchActive.current = false; };
  }, [api]);

  // Hyperparameter fields state
  // 中文：超参数字段状态。
  const [epochs, setEpochs] = useState("3");
  const [learningRate, setLearningRate] = useState("0.0002");
  const [batchSize, setBatchSize] = useState("2");
  const [gradAccum, setGradAccum] = useState("4");
  const [cutoffLen, setCutoffLen] = useState("2048");
  const [loraRank, setLoraRank] = useState("8");
  const [loraAlpha, setLoraAlpha] = useState("16");
  const [loraDropout, setLoraDropout] = useState("0.05");

  // Picker sources: a draft is launched from a chosen dataset version and base
  // model rather than from identifiers typed by hand.
  // 中文：选择器的数据来源：启动草稿时选择数据集版本和基础模型，不要求用户手动输入标识。
  const [datasets, setDatasets] = useState<JsonRecord[] | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [versions, setVersions] = useState<JsonRecord[] | null>(null);
  const [versionId, setVersionId] = useState("");
  const [modelImports, setModelImports] = useState<JsonRecord[] | null>(null);
  const [baseModelId, setBaseModelId] = useState("");

  useEffect(() => {
    let active = true;
    void api.getDatasets().then(
      (value) => {
        if (active) setDatasets(value);
      },
      () => {
        if (active) setDatasets(null);
      },
    );
    void api.getModelImports().then(
      (value) => {
        if (active) setModelImports(value);
      },
      () => {
        if (active) setModelImports(null);
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!datasetId) {
      setVersions(null);
      setVersionId("");
      return;
    }
    let active = true;
    setVersions(null);
    setVersionId("");
    void api.getDatasetVersions(datasetId).then(
      (value) => {
        if (!active) return;
        setVersions(value);
        const published = value.find((row) => text(row["state"]) === "PUBLISHED");
        setVersionId(text((published ?? value[0])?.["id"], ""));
      },
      () => {
        if (active) setVersions(null);
      },
    );
    return () => {
      active = false;
    };
  }, [api, datasetId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api.getTrainingDrafts().then(
      (value) => {
        if (active) {
          setDrafts(value);
          setError(null);
          setLoading(false);
        }
      },
      (reason: unknown) => {
        if (active) {
          setDrafts(null);
          setError(errorMessage(reason));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  /**
   * The chosen base model, but only when Reactor published everything Yield
   * needs. `PrepareTrainingDraft.baseModel` requires both a portable model
   * artifact and a pinned {repository, revision} source, and the model is
   * declared with extra="forbid", so a partial payload would be rejected.
   * 仅当 Reactor 已发布 Yield 所需的全部信息时，才提供所选基础模型。`PrepareTrainingDraft.baseModel` 同时要求可移植模型制品和已固定的 `{repository, revision}` 来源；模型声明了 `extra="forbid"`，因此不完整的负载会被拒绝。
   */
  const selectedBaseModel = (() => {
    if (!baseModelId || !modelImports) return null;
    const row = modelImports.find((candidate) => text(candidate["id"]) === baseModelId);
    if (!row) return null;
    const artifact = row["artifact"];
    const source = row["source"];
    if (typeof artifact !== "object" || artifact === null) return null;
    if (typeof source !== "object" || source === null) return null;
    const typedSource = source as JsonRecord;
    if (!text(typedSource["repository"], "") || !text(typedSource["revision"], "")) return null;
    return { artifact: artifact as JsonRecord, source: typedSource } as JsonRecord;
  })();

  const collectParameters = (): TrainingParametersInput => ({
    epochs: Number(epochs),
    perDeviceBatchSize: Number(batchSize),
    gradientAccumulationSteps: Number(gradAccum),
    learningRate: Number(learningRate),
    maxSequenceLength: Number(cutoffLen),
    loraRank: Number(loraRank),
    loraAlpha: Number(loraAlpha),
    loraDropout: Number(loraDropout),
  });

  /**
   * Persist the edited hyperparameters to Yield, then launch.
   *
   * Launching without the PATCH silently trains with whatever the draft already
   * carried, so every value edited here would be discarded with no error.
   * 先将编辑后的超参数持久化到 Yield，再启动训练。
   * 如果没有 PATCH 就启动，训练会静默使用草稿原有的参数，因此这里编辑的所有值都会无错误地丢失。
   */
  const startDraft = async (id: string, row: JsonRecord) => {
    if (launchLock.current) return;
    launchLock.current = true;
    setActionId(id);
    setActionError(null);
    try {
      // Recover an accepted launch before validating edits or submitting again.
      // 中文：校验编辑内容或再次提交前，先找回可能已经接受的训练任务。
      const draft = await api.getTrainingDraft(id);
      if (!launchActive.current) return;
      if (draft["id"] !== id) throw new NavigatorContractError("Yield returned a different training draft.");
      const acceptedId = text(nestedRecord(draft, "trainingRun")?.["id"], "");
      if (acceptedId) { pendingLaunches.current.delete(id); pushRunRoute(acceptedId); return; }
      const parameters = collectParameters();
      const invalid = Object.entries(parameters)
        .filter(([, value]) => !Number.isFinite(value))
        .map(([name]) => name);
      if (invalid.length > 0) {
        throw new Error(`Invalid hyperparameter value(s): ${invalid.join(", ")}`);
      }
      const baseModel = selectedBaseModel ?? draftBaseModel(draft) ?? draftBaseModel(row);
      if (!baseModel) {
        throw new Error("This draft has no base model configured; prepare it in Yield first.");
      }
      const spec = { baseModel, parameters };
      const serialized = JSON.stringify(spec);
      let pending = pendingLaunches.current.get(id);
      if (pending && pending.spec !== serialized) {
        throw new Error(t("The previous launch outcome is unknown. Restore its parameters and retry this draft before changing them."));
      }
      if (!pending) {
        await api.updateTrainingDraft(id, spec);
        if (!launchActive.current) return;
        pending = { spec: serialized, key: makeIdempotencyKey() };
        pendingLaunches.current.set(id, pending);
      }
      const started = await api.startTrainingDraft(id, pending.key).catch((failure: unknown) => {
        // A definitive input rejection permits edits; uncertain outcomes keep the key.
        // 中文：明确的输入拒绝允许修改参数；不确定的结果继续保留原命令键。
        if (failure instanceof NavigatorHttpError && !failure.retryable && [400, 422].includes(failure.status)) {
          pendingLaunches.current.delete(id);
        }
        throw failure;
      });
      if (!launchActive.current) return;
      const acceptedRunId = text(started["id"], "");
      if (!acceptedRunId) throw new NavigatorContractError("Yield accepted the launch without returning a run id.");
      pendingLaunches.current.delete(id);
      setReloadKey((value) => value + 1);
      pushRunRoute(acceptedRunId);
    } catch (launchError) {
      if (launchActive.current) setActionError(errorMessage(launchError));
    } finally {
      launchLock.current = false;
      if (launchActive.current) setActionId(null);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Yield / 03"
        title={t("Train only from prepared intent.")}
        description="Training drafts are owned by Yield. This console can launch a prepared draft and then hands run observation to the Runs page."
        action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{t("Refresh drafts")}</Button>}
      />

      <div className="callout callout--orange">
        <span className="callout__mark" aria-hidden="true">{t("i")}</span>
        <p><strong>{t("Preflight belongs to the owner.")}</strong>{t("The UI never infers GPU readiness from browser state; Yield returns the authoritative preflight and launch result.")}</p>
      </div>

      <Panel
        title={t("Training hyperparameters & LLaMA Factory mapping")}
        meta={<span className="mono-label">{t("LLAMA-FACTORY ENGINE")}</span>}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
          <ParamField
            label="Epochs / 训练轮数"
            hint="完整遍历数据集的次数"
            llamaKey="num_train_epochs"
          >
            <input
              type="number"
              min="1"
              step="1"
              value={epochs}
              onChange={(e) => setEpochs(e.target.value)}
              className="input-mono"
            />
          </ParamField>

          <ParamField
            label="Learning rate / 学习率"
            hint="每步权重更新幅度"
            llamaKey="learning_rate"
          >
            <input
              type="text"
              value={learningRate}
              onChange={(e) => setLearningRate(e.target.value)}
              className="input-mono"
            />
          </ParamField>

          <ParamField
            label="Batch size / 批次大小"
            hint="每步处理的样本数（越大越快但 VRAM 更多）"
            llamaKey="per_device_train_batch_size"
          >
            <input
              type="number"
              min="1"
              step="1"
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
              className="input-mono"
            />
          </ParamField>

          <ParamField
            label="Gradient accumulation / 梯度累积"
            hint="累积梯度的步数（等效放大 batch size）"
            llamaKey="gradient_accumulation_steps"
          >
            <input
              type="number"
              min="1"
              step="1"
              value={gradAccum}
              onChange={(e) => setGradAccum(e.target.value)}
              className="input-mono"
            />
          </ParamField>

          <ParamField
            label="Sequence length / 截断长度"
            hint="单条样本最大 token 数"
            llamaKey="cutoff_len"
          >
            <input
              type="number"
              min="128"
              step="128"
              value={cutoffLen}
              onChange={(e) => setCutoffLen(e.target.value)}
              className="input-mono"
            />
          </ParamField>

          <ParamField
            label="LoRA rank / LoRA 秩"
            hint="LoRA 矩阵秩（越大参数越多）"
            llamaKey="lora_rank"
          >
            <input
              type="number"
              min="1"
              step="1"
              value={loraRank}
              onChange={(e) => setLoraRank(e.target.value)}
              className="input-mono"
            />
          </ParamField>

          <ParamField
            label="LoRA alpha / LoRA 缩放系数"
            hint="LoRA 缩放因子（通常 = 2 × rank）"
            llamaKey="lora_alpha"
          >
            <input
              type="number"
              min="1"
              step="1"
              value={loraAlpha}
              onChange={(e) => setLoraAlpha(e.target.value)}
              className="input-mono"
            />
          </ParamField>

          <ParamField
            label="LoRA dropout / LoRA 丢弃率"
            hint="LoRA 层丢弃率（防过拟合）"
            llamaKey="lora_dropout"
          >
            <input
              type="text"
              value={loraDropout}
              onChange={(e) => setLoraDropout(e.target.value)}
              className="input-mono"
            />
          </ParamField>
        </div>
        <p className="field__hint">{t("These values are submitted to Yield when you press")}<strong>{t("Save and start")}</strong>{t("on a draft. Nothing here edits anything until that button is used.")}</p>
      </Panel>

      <Panel title={t("Choose the training inputs")} meta="PICKERS, NOT IDENTIFIERS">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
          <ParamField label="Dataset" hint="Catalyst owns preparation and publishing.">
            <select
              className="input-mono"
              value={datasetId}
              onChange={(event) => setDatasetId(event.target.value)}
            >
              <option value="">{datasets ? "Select a dataset" : "Loading datasets..."}</option>
              {datasets?.map((row, index) => (
                <option key={text(row["id"], `dataset-${index}`)} value={text(row["id"], "")}>
                  {text(row["name"], "Unnamed dataset")}
                </option>
              ))}
            </select>
          </ParamField>

          <ParamField label="Dataset version" hint="Published versions only; newest first.">
            <select
              className="input-mono"
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
              disabled={!datasetId}
            >
              <option value="">
                {!datasetId
                  ? "Choose a dataset first"
                  : versions
                    ? "Select a version"
                    : "Loading versions..."}
              </option>
              {versions?.map((row, index) => (
                <option key={text(row["id"], `version-${index}`)} value={text(row["id"], "")}>
                  {`v${text(row["version"], "?")} — ${text(row["state"], "UNKNOWN")}`}
                </option>
              ))}
            </select>
          </ParamField>

          <ParamField
            label="Base model"
            hint="Selecting one overrides the draft's current base model at launch."
          >
            <select
              className="input-mono"
              value={baseModelId}
              onChange={(event) => setBaseModelId(event.target.value)}
            >
              <option value="">{modelImports ? "Keep the draft's base model" : "Loading models..."}</option>
              {modelImports?.map((row, index) => (
                <option key={text(row["id"], `model-${index}`)} value={text(row["id"], "")}>
                  {text(row["name"], text(row["id"], `model-${index}`))}
                </option>
              ))}
            </select>
          </ParamField>
        </div>
        {baseModelId && !selectedBaseModel ? (
          <p className="inline-error" role="alert">{t("This model import does not expose a portable artifact and source yet, so the draft's existing base model will be used.")}</p>
        ) : null}
      </Panel>

      <Panel title={t("Training drafts")} meta={drafts ? `${drafts.length} records` : "LIVE READ"}>
        {loading ? (
          <StateBlock kind="loading" title={t("Reading training drafts")} detail="Yield is the authority for draft readiness and launch intent." />
        ) : error ? (
          <StateBlock kind="error" title={t("Training drafts unavailable")} detail={error} action={<Button onClick={() => setReloadKey((value) => value + 1)}>{t("Try again")}</Button>} />
        ) : drafts && drafts.length > 0 ? (
          <>
            <ResourceTable
              rows={drafts}
              rowKey={resourceId}
              caption="Yield training drafts"
              columns={[
                { label: "Draft", render: (row) => <strong>{text(row["name"], "Unnamed draft")}</strong> },
                { label: "State", render: (row) => <StatusPill value={text(row["state"], "UNKNOWN")} /> },
                { label: "Dataset version", render: (row) => datasetVersionLabel(row) },
                { label: "Workspace", render: (row) => text(row["workspaceId"], "default") },
                { label: "Created", render: (row) => formatDate(row["createdAt"]) },
                {
                  label: "Action",
                  render: (row) => {
                    const id = text(row["id"], "");
                    const prepared = text(row["state"], "") === "PREPARED";
                    const baseModel = draftBaseModel(row);
                    const launchable = prepared && baseModel !== null;
                    const busy = actionId === id;
                    return (
                      <Button
                        tone="primary"
                        disabled={!launchable || actionId !== null}
                        onClick={() => void startDraft(id, row)}
                        title={
                          !prepared
                            ? "Prepare this draft in Yield first"
                            : !baseModel
                              ? "This draft has no base model; prepare it in Yield first"
                              : "Save these hyperparameters to Yield, then start the run"
                        }
                      >
                        {busy ? "Saving and launching..." : launchable ? "Save and start" : "Not ready"}
                      </Button>
                    );
                  },
                },
              ]}
            />
            {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          </>
        ) : (
          <StateBlock kind="empty" title={t("No training drafts")} detail="Publish a DatasetVersion and create a draft in Yield before launching training." />
        )}
      </Panel>
    </div>
  );
}

/**
 * Run lookup and attempt diagnostics, reflecting the published Yield API shape.
 * 展示运行查询和尝试诊断信息，并遵循已发布的 Yield API 结构。
 */
/**
 * Minimal canvas loss curve so the console needs no charting dependency.
 * 使用最精简的 canvas 绘制损失曲线，使控制台无需引入图表依赖。
 */
function LossChart({ series }: { series: number[] }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || series.length < 2) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    context.beginPath();
    series.forEach((value, index) => {
      const x = (index / (series.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((value - min) / span) * (height - 2);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    // The stroke follows the canvas CSS color so the chart stays on the design tokens.
    // 中文：折线颜色取自 canvas 的 CSS color，保持与设计 token 一致。
    context.strokeStyle = getComputedStyle(canvas).color || "currentColor";
    context.lineWidth = 1.5;
    context.stroke();
  }, [series]);

  if (series.length < 2) return null;
  return (
    <canvas
      ref={canvasRef}
      className="dh-sparkline"
      width={480}
      height={120}
      aria-label={t("Training loss over steps")}
    />
  );
}

/**
 * Human-readable duration for an ETA in seconds.
 * 将 ETA 秒数格式化为人类可读的时长。
 */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function RunsPage({ api }: { api: TrainingRunClient }) {
  const { t } = useI18n();
  const [runId, setRunId] = useState(() => initialRunId());
  const [selectedRunId, setSelectedRunId] = useState(() => initialRunId());
  const observation = useTrainingRun(api, selectedRunId);
  const { run: observedRun, attempts, loading, attemptError, events, latestLoss, currentStep, totalSteps,
    lossSeries, etaSeconds, latestCheckpoint, streamState, streamError } = observation;
  const run = observedRun?.["id"] === selectedRunId ? observedRun : null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const actionScope = useRef(0);
  const actionLock = useRef(false);
  const resumeKeys = useRef(new Map<string, string>());

  useEffect(() => {
    const navigate = () => {
      if (routeForPath(window.location.pathname) !== "runs") return;
      const id = initialRunId();
      setRunId(id);
      setSelectedRunId(id);
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);
  useEffect(() => {
    actionScope.current += 1;
    actionLock.current = false;
    setCanceling(false);
    setActionBusy(false);
    setActionNotice(null);
    setActionError(null);
    resumeKeys.current.clear();
    return () => { actionScope.current += 1; };
  }, [api, selectedRunId]);

  const currentRunId = run && run["id"] === selectedRunId ? selectedRunId : "";
  const runState = currentRunId ? text(run?.["state"], "") : "";
  const canCancel = api.capabilities?.cancel !== false && ["QUEUED", "RUNNING", "AWAITING_RETRY"].includes(runState);
  const resultId = text(nestedRecord(run ?? {}, "result")?.["id"], "");
  const canResume = api.capabilities?.resume !== false && ["FAILED", "CANCELLED"].includes(runState) && latestCheckpoint !== null;
  const canDeploy = api.capabilities?.deploy !== false && Boolean(resultId);
  const error = actionError ?? observation.error;
  const streamActive = streamState === "connected";
  const streamDone = streamState === "finished";

  const resumeRun = async () => {
    if (!currentRunId || !latestCheckpoint || !canResume || actionLock.current) return;
    actionLock.current = true;
    const scope = actionScope.current;
    const identity = JSON.stringify([currentRunId, latestCheckpoint, run?.["attemptCount"]]);
    let key = resumeKeys.current.get(identity);
    if (!key) { key = makeIdempotencyKey(); resumeKeys.current.set(identity, key); }
    setActionBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await api.resumeTrainingRun(currentRunId, latestCheckpoint, key);
      if (scope !== actionScope.current) return;
      setActionNotice(t("Resume accepted. Yield is restarting from the selected checkpoint."));
      observation.reconnect();
    } catch (resumeError) {
      if (scope === actionScope.current) setActionError(errorMessage(resumeError));
    } finally {
      if (scope === actionScope.current) { actionLock.current = false; setActionBusy(false); }
    }
  };

  const deployResult = async () => {
    if (!resultId || !currentRunId || actionLock.current) return;
    actionLock.current = true;
    const scope = actionScope.current;
    setActionBusy(true);
    setActionNotice(null);
    setActionError(null);
    try {
      await api.sendResultToReactor(resultId);
      if (scope === actionScope.current) setActionNotice(t("Sent to Reactor. Continue on the Deployments page."));
    } catch (deployError) {
      if (scope === actionScope.current) setActionError(errorMessage(deployError));
    } finally {
      if (scope === actionScope.current) { actionLock.current = false; setActionBusy(false); }
    }
  };

  const lookupRun = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = runId.trim();
    if (!value) {
      setActionError(t("Enter a training run id to read its owning Product projection."));
      return;
    }
    setActionError(null);
    if (value === selectedRunId) observation.reconnect();
    else pushRunRoute(value);
  };

  const cancelRun = async () => {
    if (!currentRunId || !canCancel || actionLock.current) return;
    actionLock.current = true;
    const scope = actionScope.current;
    setCanceling(true);
    setActionError(null);
    try {
      await api.cancelTrainingRun(currentRunId);
      if (scope === actionScope.current) observation.refresh();
    } catch (cancelError) {
      if (scope === actionScope.current) setActionError(errorMessage(cancelError));
    } finally {
      if (scope === actionScope.current) { actionLock.current = false; setCanceling(false); }
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Yield / 04"
        title={t("Follow one run to the metal.")}
        description="Yield publishes run detail and attempt diagnostics, not a browser-owned history cache. Enter an id to read the current projection."
      />

      <Panel title={t("Find a training run")} meta={<span className="mono-label">{t("OWNER: YIELD")}</span>}>
        <form className="lookup-form" onSubmit={lookupRun}>
          <Field label="Training run id" hint="Use the id returned when a prepared draft starts.">
            <input className="input-mono" value={runId} onChange={(event) => setRunId(event.target.value)} placeholder={t("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")} />
          </Field>
          <Button tone="primary" type="submit" disabled={loading}>{loading ? "Reading..." : "Read run"}</Button>
        </form>
      </Panel>

      {loading ? <StateBlock kind="loading" title={t("Reading run projection")} detail="Yield is returning current run state and public attempt diagnostics." /> : null}
      {error ? <StateBlock kind="error" title={t("Run could not be read")} detail={error} /> : null}
      {run ? (
        <>
          <Panel
            title={text(run["name"], "Training run")}
            meta={
              <div className="panel-actions">
                <StatusPill value={runState || "UNKNOWN"} />
                {canCancel ? <Button tone="danger" onClick={() => void cancelRun()} disabled={canceling || actionBusy}>{canceling ? "Canceling..." : "Request cancel"}</Button> : null}
              </div>
            }
          >
            <dl className="detail-grid">
              <Detail label="Run id" value={text(run["id"])} mono />
              <Detail label="Engine binding" value={text(run["engineBindingId"])} mono />
              <Detail label="Attempts" value={text(run["attemptCount"], "0")} />
              <Detail label="Resource version" value={text(run["resourceVersion"], "-")} />
              <Detail label="Created" value={formatDate(run["createdAt"])} />
              <Detail label="Updated" value={formatDate(run["updatedAt"])} />
            </dl>
            {nestedRecord(run, "failure") ? (
              <div className="callout callout--red">
                <span className="callout__mark" aria-hidden="true">!</span>
                <p><strong>{text(nestedRecord(run, "failure")?.["code"], "Run failure")}</strong> {text(nestedRecord(run, "failure")?.["message"])}</p>
              </div>
            ) : null}
          </Panel>

          <Panel
            title={t("Realtime execution stream")}
            meta={
              <div className="panel-actions">
                <StatusPill value={streamState.toUpperCase()} />
                {(streamDone || ["COMPLETED", "FAILED", "CANCELLED"].includes(runState)) && (
                  <Button onClick={observation.refresh}>{t("查看结果")}</Button>
                )}
                <Button onClick={observation.reconnect}>{t("Reconnect stream")}</Button>
              </div>
            }
          >
            {streamError ? <p role="alert" className="form-message form-message--error">{streamError}</p> : null}
            <div className="metric-grid">
              <MetricCard
                label="Loss"
                value={latestLoss !== null ? latestLoss.toFixed(4) : "--"}
                detail="Current training loss"
                accent="orange"
              />
              <MetricCard
                label="Progress"
                value={currentStep !== null && totalSteps !== null ? `${currentStep} / ${totalSteps}` : currentStep !== null ? `Step ${currentStep}` : "--"}
                detail={currentStep !== null && totalSteps ? `${Math.round((currentStep / totalSteps) * 100)}% steps completed` : "Step progress"}
                accent="blue"
              />
              <MetricCard
                label="Stream status"
                value={t(streamState[0]!.toUpperCase() + streamState.slice(1))}
                detail={streamDone ? t("All available events received") : streamActive ? t("SSE live connection") : t("Run state remains owned by Yield; reconnecting never restarts training.")}
                accent={streamActive ? "lime" : "gray"}
              />
              <MetricCard
                label="ETA"
                value={etaSeconds !== null ? formatDuration(etaSeconds) : "--"}
                detail="Estimated time remaining"
                accent="gray"
              />
              <MetricCard
                label="Checkpoint"
                value={latestCheckpoint ?? "--"}
                detail="Latest checkpoint reported by Yield"
                accent="gray"
              />
            </div>

            {currentStep !== null && totalSteps ? (
              <div
                className="dh-meter"
                role="progressbar"
                aria-valuenow={currentStep}
                aria-valuemin={0}
                aria-valuemax={totalSteps}
                style={{ "--dh-meter": `${Math.min(100, Math.round((currentStep / totalSteps) * 100))}%` } as CSSProperties}
              />
            ) : null}

            <div className="dh-chart">
              <LossChart series={lossSeries} />
            </div>

            <div className="form-actions" style={{ marginTop: "16px" }}>
              <Button disabled={!canResume || actionBusy || canceling} onClick={() => void resumeRun()}>
                {actionBusy ? "Working..." : "Resume from checkpoint"}
              </Button>
              <Button disabled={!canDeploy || actionBusy || canceling} onClick={() => void deployResult()}>{t("Deploy this model")}</Button>
            </div>
            {api.capabilities?.cancel === false && api.capabilities.resume === false && api.capabilities.deploy === false ? (
              <p>{t("This connection supports observation. Cancel, resume and deployment actions are available in the owning service.")}</p>
            ) : null}
            {actionNotice ? <p className="form-message form-message--success">{actionNotice}</p> : null}

            <div className="dh-chart">
              <strong className="dh-section-label">{t("Event logs (last 50):")}</strong>
              <div className="dh-log">
                {events.length === 0 ? (
                  <div className="dh-log__empty">{t("No realtime stream events captured yet.")}</div>
                ) : (
                  events.map((evt, idx) => {
                    const seq = String(evt["sequence"] ?? idx + 1);
                    const kind = String(evt["kind"] ?? evt["event"] ?? "event");
                    const payload = evt["payload"] ? JSON.stringify(evt["payload"]) : evt["message"] ?? JSON.stringify(evt);
                    return (
                      <div className="dh-log__row" key={seq}>
                        <span className="dh-log__seq">#{seq}</span>
                        <span className="dh-log__kind">[{kind}]</span>
                        <span>{String(payload)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </Panel>

          <Panel title={t("Attempt diagnostics")} meta={attempts ? `${attempts.length} attempts` : "OWNER READ"}>
            {attemptError ? (
              <StateBlock kind="error" title={t("Attempts unavailable")} detail={attemptError} />
            ) : attempts && attempts.length > 0 ? (
              <ResourceTable
                rows={attempts}
                rowKey={resourceId}
                caption="Yield training attempts"
                columns={[
                  { label: "Attempt", render: (row) => <span className="input-mono">{text(row["id"])}</span> },
                  { label: "Phase", render: (row) => text(row["phase"]) },
                  { label: "State", render: (row) => <StatusPill value={text(row["state"], "UNKNOWN")} /> },
                  { label: "Failure", render: (row) => text(nestedRecord(row, "failure")?.["message"], "No failure recorded") },
                ]}
              />
            ) : (
              <StateBlock kind="empty" title={t("No attempt diagnostics")} detail="Yield has not published attempt records for this run." />
            )}
          </Panel>
        </>
      ) : !loading && !error ? (
        <StateBlock kind="empty" title={t("No run selected")} detail="Run history stays with Yield. Enter a run id above to inspect a live projection." />
      ) : null}
    </div>
  );
}

/**
 * Reactor deployment intent, observed state, and explicit stop action.
 * 展示 Reactor 部署意图、观测状态和明确的停止操作。
 */
export function DeploymentsPage({ api }: PageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [deployments, setDeployments] = useState<JsonRecord[] | null>(null);
  const [bindings, setBindings] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Deployment events timeline state
  // 中文：部署事件时间线状态。
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [deploymentEvents, setDeploymentEvents] = useState<DeploymentEvent[] | null>(null);

  const loadDeploymentEvents = async (id: string) => {
    setSelectedDeploymentId(id);
    setEventsLoading(true);
    setEventsError(null);
    try {
      const res = await api.getDeploymentEvents(id);
      setDeploymentEvents(res.events);
    } catch (err) {
      setEventsError(errorMessage(err));
      setDeploymentEvents(null);
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled([api.getDeployments(), api.getServingBindings()]).then(([deploymentResult, bindingResult]) => {
      if (!active) {
        return;
      }
      if (deploymentResult.status === "fulfilled") {
        setDeployments(deploymentResult.value);
        setError(null);
      } else {
        setDeployments(null);
        setError(errorMessage(deploymentResult.reason));
      }
      if (bindingResult.status === "fulfilled") {
        setBindings(bindingResult.value);
        setBindingError(null);
      } else {
        setBindings([]);
        setBindingError(errorMessage(bindingResult.reason));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const stopDeployment = async (id: string) => {
    setStopId(id);
    setActionError(null);
    try {
      await api.stopDeployment(id);
      setReloadKey((value) => value + 1);
    } catch (stopError) {
      setActionError(errorMessage(stopError));
    } finally {
      setStopId(null);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Reactor / 05"
        title={t("Serve with a known edge.")}
        description="Deployments express intent; endpoints express addressability. Read both through Reactor and stop only through its explicit lifecycle action."
        action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{t("Refresh deployments")}</Button>}
      />

      <div className="callout callout--blue">
        <span className="callout__mark" aria-hidden="true">{t("i")}</span>
        <p><strong>{t("Serving bindings:")}{bindings.length || "none reported"}.</strong> {bindingError ?? "Reactor resolves node and engine identity; the UI does not infer readiness from a URL."}</p>
      </div>

      <Panel title={t("Deployment ledger")} meta={deployments ? `${deployments.length} records` : "LIVE READ"}>
        {loading ? (
          <StateBlock kind="loading" title={t("Reading deployments")} detail="Reactor is reconciling desired intent with observed serving state." />
        ) : error ? (
          <StateBlock kind="error" title={t("Deployments unavailable")} detail={error} action={<Button onClick={() => setReloadKey((value) => value + 1)}>{t("Try again")}</Button>} />
        ) : deployments && deployments.length > 0 ? (
          <>
            <ResourceTable
              rows={deployments}
              rowKey={resourceId}
              caption="Reactor deployments"
              columns={[
                { label: "Deployment", render: (row) => <strong>{text(row["name"], "Unnamed deployment")}</strong> },
                { label: "Observed", render: (row) => <StatusPill value={text(row["observedState"], "UNKNOWN")} /> },
                { label: "Desired", render: (row) => <StatusPill value={text(row["desiredState"], "UNKNOWN")} /> },
                { label: "Binding", render: (row) => <span className="input-mono">{text(row["servingBindingId"])}</span> },
                { label: "Endpoint", render: (row) => endpointSummary(row) },
                {
                  label: "Timeline",
                  render: (row) => {
                    const id = text(row["id"], "");
                    const isSelected = selectedDeploymentId === id;
                    return (
                      <Button
                        tone={isSelected ? "primary" : "quiet"}
                        onClick={() => void loadDeploymentEvents(id)}
                      >{t("加载历史")}</Button>
                    );
                  },
                },
                {
                  label: "Action",
                  render: (row) => {
                    const id = text(row["id"], "");
                    const stopped = text(row["desiredState"], "") === "STOPPED";
                    return <Button tone="danger" disabled={stopped || stopId !== null} onClick={() => void stopDeployment(id)}>{stopId === id ? "Stopping..." : stopped ? "Stopped" : "Stop"}</Button>;
                  },
                },
              ]}
            />
            {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          </>
        ) : (
          <StateBlock kind="empty" title={t("No deployments")} detail="A validated model version must be handed to Reactor before a serving deployment can exist." />
        )}
      </Panel>

      {selectedDeploymentId ? (
        <Panel
          title={`加载历史时间线: ${selectedDeploymentId}`}
          meta={
            deploymentEvents ? (
              <span className="mono-label">{deploymentEvents.length}{t("EVENTS")}</span>
            ) : undefined
          }
        >
          {eventsLoading ? (
            <StateBlock
              kind="loading"
              title={t("Loading deployment phase events")}
              detail="Reactor SQLite store is returning the phase transition timeline."
            />
          ) : eventsError ? (
            <StateBlock kind="error" title={t("Events unavailable")} detail={eventsError} />
          ) : deploymentEvents && deploymentEvents.length > 0 ? (
            <div className="dh-phase-timeline">
              <WorkflowSteps steps={deploymentPhaseSteps(deploymentEvents, t)} label={t("Deployment phases")} />

              <div className="service-list">
                {deploymentEvents.map((evt) => (
                  <div className="dh-event-row" key={evt.sequence}>
                    <span className="mono-label">#{evt.sequence}</span>
                    <StatusPill value={evt.phase} />
                    <div>
                      <span>{evt.message}</span>
                      {evt.failureCode ? (
                        <span className="dh-event-row__failure">{t("Failure:")}{evt.failureCode}</span>
                      ) : null}
                    </div>
                    <span className="dh-event-row__time">{formatDate(evt.occurredAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <StateBlock
              kind="empty"
              title={t("No events recorded")}
              detail="Reactor has not published loading events for this deployment yet."
            />
          )}
        </Panel>
      ) : null}
    </div>
  );
}

/**
 * Exchange Gateway routes, invocation snippets, and API key lifecycle administration.
 * 管理 Exchange Gateway 路由、调用示例和 API key 生命周期。
 */
export function GatewayPage({ api }: PageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [routes, setRoutes] = useState<JsonRecord[] | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<JsonRecord | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyMetadata[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeCodeTab, setActiveCodeTab] = useState<"curl" | "python" | "javascript">("curl");

  // New key form state
  // 中文：新建 API key 表单状态。
  const [keyName, setKeyName] = useState("");
  const [expiresDays, setExpiresDays] = useState("");
  const [modelScope, setModelScope] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdKeyName, setCreatedKeyName] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedBaseUrl, setCopiedBaseUrl] = useState(false);
  const [system, setSystem] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled([
      api.getGatewayRoutes(),
      api.listApiKeys().catch(() => []),
      api.getSystemStatus(),
    ]).then(([routesRes, keysRes, systemRes]) => {
      if (!active) return;
      if (routesRes.status === "fulfilled") {
        setRoutes(routesRes.value);
        if (routesRes.value.length > 0) {
          setSelectedRoute((prev) => prev ?? routesRes.value[0]);
        }
        setError(null);
      } else {
        setRoutes(null);
        setError(errorMessage(routesRes.reason));
      }

      if (keysRes.status === "fulfilled") {
        setApiKeys(keysRes.value);
      } else {
        setApiKeys([]);
      }

      // A missing status only costs us the published gateway URL; the route and
      // key panels above must still render.
      // 中文：状态缺失只会导致无法显示已发布的 Gateway URL；上方的路由和密钥面板仍必须正常显示。
      setSystem(systemRes.status === "fulfilled" ? systemRes.value : null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const refresh = () => setReloadKey((v) => v + 1);

  const confirmRoute = async (route: JsonRecord) => {
    const id = text(route["id"]);
    const version = typeof route["resourceVersion"] === "number" ? route["resourceVersion"] : 1;
    setActionError(null);
    setActionNotice(null);
    try {
      await api.confirmGatewayRoute(id, version);
      setActionNotice(`Route ${text(route["modelPattern"] || route["model_pattern"] || id)} confirmed and published.`);
      refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const handleCreateKey = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = keyName.trim();
    if (!name) return;
    setCreatingKey(true);
    setActionError(null);
    try {
      let expiresAt: string | null = null;
      const days = parseInt(expiresDays, 10);
      if (!isNaN(days) && days > 0) {
        expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      }
      const scope = modelScope
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.createApiKey(text(selectedRoute?.["id"] ?? ""), {
        name,
        expiresAt,
        modelScope: scope,
      });
      setCreatedSecret(res.secret);
      setCreatedKeyName(res.key.name);
      setKeyName("");
      setExpiresDays("");
      setModelScope("");
      refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to revoke API key "${name}"? This action is immediate and permanent.`)) {
      return;
    }
    setActionError(null);
    try {
      await api.revokeApiKey(id);
      refresh();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  // The published gateway URL wins. Deriving it in the browser assumed Exchange
  // sits on one fixed port, which is wrong for the dev stack (8000) and for any
  // HTTPS deployment, so every snippet below was pointing at a dead endpoint.
  // 中文：优先使用已发布的 Gateway URL。若在浏览器中自行推导地址，就等于假设 Exchange 固定使用一个端口；开发环境端口为 8000，HTTPS 部署也不同，因此下方所有调用示例都会指向失效 Endpoint。
  const baseUrl =
    system?.gatewayBaseUrl ??
    (typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:8003/v1`
      : "http://localhost:8003/v1");

  const handleUseInNavigator = async (route: JsonRecord) => {
    const gatewayEndpointId = text(route["gatewayEndpointId"] || route["gateway_endpoint_id"] || route["id"]);
    const model = text(route["modelPattern"] || route["model_pattern"] || route["targetModel"] || "default-model");
    try {
      await api.setActiveRoute({
        gatewayEndpointId,
        modelId: model,
        baseUrl,
        apiKeyHint: text(route["name"] || model),
      });
      pushRoute("chat");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const modelId = text(
    selectedRoute?.["modelPattern"] ?? selectedRoute?.["model_pattern"] ?? selectedRoute?.["targetModel"] ?? "default-model"
  );

  const snippets = {
    curl: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer <API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${modelId}", "messages": [{"role":"user","content":"Hello"}]}'`,
    python: `from openai import OpenAI

client = OpenAI(api_key="<API_KEY>", base_url="${baseUrl}")
response = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)`,
    javascript: `import OpenAI from 'openai';

const client = new OpenAI({ apiKey: '<API_KEY>', baseURL: '${baseUrl}' });
const response = await client.chat.completions.create({
    model: '${modelId}',
    messages: [{ role: 'user', content: 'Hello' }],
});
console.log(response.choices[0].message.content);`,
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Exchange / Gateway"
        title={t("Routes, API keys, and client configuration.")}
        description="Exchange acts as the single OpenAI-compatible data plane. Publish model routes, copy client integration code, and manage caller API keys."
        action={
          <Button onClick={refresh} disabled={loading} aria-label={t("Refresh gateway")}>
            {loading ? "Reading..." : "Refresh"}
          </Button>
        }
      />

      {actionNotice ? (
        <div className="callout callout--blue">
          <span className="callout__mark" aria-hidden="true">✓</span>
          <p>{actionNotice}</p>
        </div>
      ) : null}
      {actionError ? (
        <div className="callout callout--red">
          <span className="callout__mark" aria-hidden="true">!</span>
          <p><strong>{t("Error:")}</strong> {actionError}</p>
        </div>
      ) : null}

      {/* 1. Gateway Routes Table */}
      <Panel
        title={t("Gateway routes")}
        meta={routes ? `${routes.length} configured` : "EXCHANGE OWNER"}
      >
        {loading && !routes ? (
          <StateBlock kind="loading" title={t("Reading Gateway routes")} detail="Exchange is returning published model routes." />
        ) : error ? (
          <StateBlock kind="error" title={t("Routes unavailable")} detail={error} />
        ) : routes && routes.length > 0 ? (
          <ResourceTable
            rows={routes}
            rowKey={resourceId}
            caption="Exchange published routes"
            columns={[
              {
                label: "Model alias",
                render: (row) => {
                  const pattern = text(row["modelPattern"] || row["model_pattern"]);
                  const isSelected = selectedRoute && text(selectedRoute["id"]) === text(row["id"]);
                  return (
                    <button
                      className={isSelected ? "link-button link-button--selected" : "link-button"}
                      onClick={() => setSelectedRoute(row)}
                    >
                      {pattern} {isSelected ? "◀ (Selected)" : ""}
                    </button>
                  );
                },
              },
              {
                label: "Target binding",
                render: (row) => <span className="input-mono">{text(row["targetBindingId"] || row["target_binding_id"])}</span>,
              },
              {
                label: "Status",
                render: (row) => {
                  const state = text(row["state"], "ACTIVE");
                  return <StatusPill value={state} />;
                },
              },
              {
                label: "Action",
                render: (row) => {
                  const state = text(row["state"], "ACTIVE");
                  if (state === "DRAFT") {
                    return (
                      <Button tone="primary" onClick={() => void confirmRoute(row)}>{t("确认发布")}</Button>
                    );
                  }
                  return (
                    <div className="dh-toolbar">
                      <Button onClick={() => setSelectedRoute(row)}>{t("View detail")}</Button>
                      <Button tone="primary" onClick={() => void handleUseInNavigator(row)}>{t("在 Navigator 中使用")}</Button>
                    </div>
                  );
                },
              },
            ]}
          />
        ) : (
          <StateBlock
            kind="empty"
            title={t("No Gateway routes")}
            detail="Publish a serving deployment or add a route draft in Exchange to expose models."
          />
        )}
      </Panel>

      {/* 2. Selected Route Detail Panel */}
      {selectedRoute ? (
        <Panel
          title={`Route detail: ${modelId}`}
          meta={<StatusPill value={text(selectedRoute["state"], "ACTIVE")} />}
        >
          <dl className="detail-grid">
            <Detail label="Model ID" value={modelId} mono />
            <Detail
              label="Base URL"
              value={baseUrl}
              mono
            />
            <Detail label="Target binding" value={text(selectedRoute["targetBindingId"] || selectedRoute["target_binding_id"])} mono />
            <Detail label="Created" value={formatDate(selectedRoute["createdAt"] || selectedRoute["created_at"])} />
          </dl>

          <div className="dh-toolbar dh-toolbar--spaced">
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(baseUrl);
                setCopiedBaseUrl(true);
                setTimeout(() => setCopiedBaseUrl(false), 2000);
              }}
            >
              {copiedBaseUrl ? "Base URL Copied!" : "Copy Base URL"}
            </Button>
            <Button
              tone="primary"
              onClick={() => void handleUseInNavigator(selectedRoute)}
            >{t("在 Navigator 中使用")}</Button>
          </div>

          <div className="dh-integration">
            <div className="dh-toolbar dh-integration__bar">
              <strong className="dh-section-label">{t("Integration code:")}</strong>
              <div className="dh-segmented">
                {(["curl", "python", "javascript"] as const).map((tab) => (
                  <Button
                    key={tab}
                    tone={activeCodeTab === tab ? "primary" : "quiet"}
                    aria-pressed={activeCodeTab === tab}
                    onClick={() => setActiveCodeTab(tab)}
                  >
                    {tab === "curl" ? "cURL" : tab === "python" ? "Python" : "JavaScript"}
                  </Button>
                ))}
              </div>
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(snippets[activeCodeTab]);
                  setCopiedSnippet(true);
                  setTimeout(() => setCopiedSnippet(false), 2000);
                }}
              >
                {copiedSnippet ? "Copied!" : "Copy snippet"}
              </Button>
            </div>
            <pre className="dh-code-block">
              <code>{snippets[activeCodeTab]}</code>
            </pre>
          </div>
        </Panel>
      ) : null}

      {/* 3. API Keys Management Panel */}
      <Panel
        title={t("Gateway API keys")}
        meta={apiKeys ? `${apiKeys.filter((k) => k.state === "ACTIVE").length} active` : "EXCHANGE KEYS"}
      >
        {createdSecret ? (
          <div className="callout callout--orange callout--stacked">
            <div className="callout__title">
              <span className="callout__mark" aria-hidden="true">!</span>
              <strong>{t("API Key Created:")}{createdKeyName}</strong>
            </div>
            <p>{t("此密钥不会再次显示，请立即复制并安全保存。关闭后将无法重新查看完整明文。")}</p>
            <div className="dh-toolbar callout__secret">
              <input
                readOnly
                value={createdSecret}
                className="input-mono"
              />
              <Button
                tone="primary"
                onClick={() => {
                  void navigator.clipboard.writeText(createdSecret);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }}
              >
                {copiedKey ? "Copied!" : "Copy key"}
              </Button>
              <Button onClick={() => setCreatedSecret(null)}>{t("Close")}</Button>
            </div>
          </div>
        ) : null}

        <form className="credential-form" onSubmit={handleCreateKey} style={{ marginBottom: "24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", alignItems: "flex-end" }}>
            <Field label="Key name *" hint="Human-readable identifier">
              <input
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder={t("e.g. production-client")}
                required
              />
            </Field>
            <Field label="Expiration (days)" hint="Optional (leave blank for no expiry)">
              <input
                type="number"
                min="1"
                value={expiresDays}
                onChange={(e) => setExpiresDays(e.target.value)}
                placeholder={t("e.g. 90")}
              />
            </Field>
            <Field label="Model scope" hint="Optional comma-separated aliases">
              <input
                value={modelScope}
                onChange={(e) => setModelScope(e.target.value)}
                placeholder={t("default: all models")}
              />
            </Field>
            <div>
              <Button tone="primary" type="submit" disabled={creatingKey || !keyName.trim()}>
                {creatingKey ? "Creating..." : "Create API Key"}
              </Button>
            </div>
          </div>
        </form>

        {apiKeys && apiKeys.length > 0 ? (
          <ResourceTable
            rows={apiKeys}
            rowKey={(row) => row.id}
            caption="Exchange API keys"
            columns={[
              { label: "Name", render: (row) => <strong>{row.name}</strong> },
              {
                label: "Key",
                render: (row) => <span className="input-mono">{`cyk_...${row.id.slice(-4)}`}</span>,
              },
              {
                label: "Status",
                render: (row) => <StatusPill value={row.state} />,
              },
              {
                label: "Model scope",
                render: (row) => row.modelScope && row.modelScope.length > 0 ? row.modelScope.join(", ") : "All models",
              },
              {
                label: "Created",
                render: (row) => formatDate(row.createdAt),
              },
              {
                label: "Expires",
                render: (row) => row.expiresAt ? formatDate(row.expiresAt) : "Never",
              },
              {
                label: "Action",
                render: (row) => {
                  if (row.state === "ACTIVE") {
                    return (
                      <Button tone="danger" onClick={() => void handleRevokeKey(row.id, row.name)}>{t("Revoke")}</Button>
                    );
                  }
                  return <span className="muted">{t("Revoked")}</span>;
                },
              },
            ]}
          />
        ) : (
          <StateBlock
            kind="empty"
            title={t("No API keys")}
            detail="Create an API key above to allow client applications to authenticate with the Exchange gateway."
          />
        )}
      </Panel>
    </div>
  );
}

/**
 * Web Host session metadata and write-only credential administration.
 * 展示 Web Host 会话元数据并管理只写凭据。
 */
export function SettingsPage({ api, session }: SettingsPageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [credentials, setCredentials] = useState<CredentialMetadata[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [kind, setKind] = useState("api-token");
  const [secret, setSecret] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled([api.getSystemStatus(), api.getCredentials()]).then(([systemResult, credentialsResult]) => {
      if (!active) {
        return;
      }
      if (systemResult.status === "fulfilled") {
        setSystem(systemResult.value);
        setSystemError(null);
      } else {
        setSystem(null);
        setSystemError(errorMessage(systemResult.reason));
      }
      if (credentialsResult.status === "fulfilled") {
        setCredentials(credentialsResult.value);
        setError(null);
      } else {
        setCredentials(null);
        setError(errorMessage(credentialsResult.reason));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const createCredential = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !provider.trim() || !secret) {
      setFormError("Name, provider, and secret are required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      await api.createCredential({ name: name.trim(), provider: provider.trim(), kind: kind.trim() || "generic", secret });
      setName("");
      setProvider("");
      setSecret("");
      setNotice("Credential metadata saved. The secret was accepted write-only and cannot be recovered here.");
      setReloadKey((value) => value + 1);
    } catch (createError) {
      setFormError(errorMessage(createError));
    } finally {
      setSubmitting(false);
    }
  };

  const revokeCredential = async (credential: CredentialMetadata) => {
    if (!window.confirm(`Revoke ${credential.name}? This cannot be undone.`)) {
      return;
    }
    setRevokingId(credential.id);
    setFormError(null);
    setNotice(null);
    try {
      await api.revokeCredential(credential.id);
      setNotice(`${credential.name} was revoked.`);
      setReloadKey((value) => value + 1);
    } catch (revokeError) {
      setFormError(errorMessage(revokeError));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Web Host / 06"
        title={t("Keep the boundary boring.")}
        description="Session rotation, CSRF, proxy allowlists, and credential metadata are Web Host concerns. Secrets never become a Product read."
        action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{t("Refresh settings")}</Button>}
      />

      <div className="settings-grid">
        <Panel title={t("Current session")} meta={<StatusPill value={session.state} />}>
          <dl className="detail-grid">
            <Detail label="Access state" value={session.authenticated ? "Authenticated" : "Anonymous"} />
            <Detail label="Access expires" value={formatDate(session.expiresAt)} />
            <Detail label="Refresh window" value={formatDate(session.refreshExpiresAt)} />
            <Detail label="Refreshable" value={session.refreshable ? "Yes" : "No"} />
          </dl>
          <p className="panel-footnote">{t("Access and refresh cookies remain HttpOnly. The UI keeps only the rotating CSRF token in memory.")}</p>
        </Panel>

        <Panel title={t("Navigator Web Host")} meta={<StatusPill value={system?.status ?? "UNKNOWN"} />}>
          {systemError ? <p className="inline-error">{systemError}</p> : null}
          <dl className="detail-grid">
            <Detail label="Service" value={system?.service ?? "Not reported"} mono />
            <Detail label="Version" value={system?.version ?? "Not reported"} mono />
            <Detail label="Active credentials" value={system ? String(system.credentials.active) : "--"} />
            <Detail label="Revoked credentials" value={system ? String(system.credentials.revoked) : "--"} />
          </dl>
          <div className="proxy-list">
            <p className="eyebrow">{t("Configured proxy paths")}</p>
            {system?.proxyPrefixes.length ? system.proxyPrefixes.map((prefix) => <code key={prefix}>{prefix}</code>) : <span className="muted">{t("No proxy prefixes reported.")}</span>}
          </div>
        </Panel>
      </div>

      <Panel title={t("Add credential metadata")} meta={<span className="mono-label">{t("SECRET NEVER READ BACK")}</span>}>
        <form className="form-grid" onSubmit={createCredential}>
          <Field label="Name">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Hugging Face access")} />
          </Field>
          <Field label="Provider">
            <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder={t("huggingface")} />
          </Field>
          <Field label="Kind">
            <input value={kind} onChange={(event) => setKind(event.target.value)} placeholder={t("api-token")} />
          </Field>
          <Field label="Secret" hint="The Web Host stores this for configured proxy resolution only.">
            <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" placeholder={t("Paste once, never displayed")} />
          </Field>
          <div className="form-actions">
            <Button tone="primary" type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save credential"}</Button>
            {formError ? <span className="form-message form-message--error" role="alert">{formError}</span> : null}
            {notice ? <span className="form-message form-message--success">{notice}</span> : null}
          </div>
        </form>
      </Panel>

      <Panel title={t("Credential metadata")} meta={credentials ? `${credentials.length} records` : "LIVE READ"}>
        {loading ? (
          <StateBlock kind="loading" title={t("Reading credential metadata")} detail="Only non-secret fields are returned by the Web Host." />
        ) : error ? (
          <StateBlock kind="error" title={t("Credentials unavailable")} detail={error} action={<Button onClick={() => setReloadKey((value) => value + 1)}>{t("Try again")}</Button>} />
        ) : credentials && credentials.length > 0 ? (
          <ResourceTable
            rows={credentials}
            rowKey={(row) => row.id}
            caption="Navigator Web Host credentials"
            columns={[
              { label: "Name", render: (row) => <strong>{row.name}</strong> },
              { label: "Provider", render: (row) => row.provider },
              { label: "Kind", render: (row) => <span className="input-mono">{row.kind}</span> },
              { label: "State", render: (row) => <StatusPill value={row.state} /> },
              { label: "Updated", render: (row) => formatDate(row.updatedAt) },
              { label: "Action", render: (row) => <Button tone="danger" disabled={row.state === "REVOKED" || revokingId !== null} onClick={() => void revokeCredential(row)}>{revokingId === row.id ? "Revoking..." : row.state === "REVOKED" ? "Revoked" : "Revoke"}</Button> },
            ]}
          />
        ) : (
          <StateBlock kind="empty" title={t("No credentials configured")} detail="Add a write-only credential metadata record when a configured Product proxy needs it." />
        )}
      </Panel>
    </div>
  );
}

/**
 * Interactive test chat surface bound to the session's active Gateway route.
 * 提供绑定到当前会话活动 Gateway 路由的交互式测试聊天界面。
 */
export function ChatPage({ api }: PageProps) {
  const { t } = useI18n();
  const [activeRoute, setActiveRoute] = useState<ActiveRoutePayload | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [routeError, setRouteError] = useState<string | null>(null);

  // API Key stored in sessionStorage ONLY (never localStorage or server)
  // 中文：API key 仅存储在 sessionStorage 中，绝不写入 localStorage 或服务器。
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage.getItem("cyrene_chat_api_key") ?? "";
    }
    return "";
  });

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem("cyrene_chat_api_key", val);
    }
  };

  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant" | "system"; content: string }>>([
    { role: "system", content: "You are a helpful AI assistant." },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingRoute(true);
    void api.getActiveRoute().then(
      (res) => {
        if (!active) return;
        setActiveRoute(res);
        setRouteError(null);
        setLoadingRoute(false);
      },
      (err) => {
        if (!active) return;
        setActiveRoute(null);
        setRouteError(errorMessage(err));
        setLoadingRoute(false);
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  const sendMessage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const prompt = inputMessage.trim();
    if (!prompt || sending || !activeRoute) return;
    if (!apiKey.trim()) {
      setChatError("Please enter your Exchange API key to send messages.");
      return;
    }

    const updatedMessages = [...messages, { role: "user" as const, content: prompt }];
    setMessages(updatedMessages);
    setInputMessage("");
    setSending(true);
    setChatError(null);

    const assistantIndex = updatedMessages.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const response = await studioProductFetch("/api/proxy/exchange-gateway/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "text/event-stream, application/json",
        },
        body: JSON.stringify({
          model: activeRoute.modelId,
          messages: updatedMessages,
          stream: true,
        }),
      });

      if (!response.ok) {
        let errDetail = `HTTP ${response.status}`;
        try {
          const errJson = (await response.json()) as Record<string, unknown>;
          if (errJson && typeof errJson["detail"] === "string") {
            errDetail = errJson["detail"];
          }
        } catch {
          // ignore parse error
          // 中文：忽略解析错误。
        }
        throw new Error(errDetail);
      }

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (trimmed.startsWith("data:")) {
              const dataStr = trimmed.slice(5).trim();
              if (dataStr === "[DONE]") {
                break;
              }
              try {
                const parsed = JSON.parse(dataStr) as {
                  choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
                };
                const delta =
                  parsed.choices?.[0]?.delta?.content ??
                  parsed.choices?.[0]?.message?.content ??
                  "";
                accumulated += delta;
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[assistantIndex] = { role: "assistant", content: accumulated };
                  return copy;
                });
              } catch {
                // Ignore parse errors on stream chunks
                // 中文：忽略 SSE 数据块的解析错误。
              }
            }
          }
        }
      } else {
        const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content ?? "";
        setMessages((prev) => {
          const copy = [...prev];
          copy[assistantIndex] = { role: "assistant", content };
          return copy;
        });
      }
    } catch (err) {
      setChatError(errorMessage(err));
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[assistantIndex] && !copy[assistantIndex]?.content) {
          copy.splice(assistantIndex, 1);
        }
        return copy;
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Exchange / Interactive Chat"
        title={t("Test models with active route.")}
        description="Interact directly with the model bound to this session through Exchange Gateway proxy."
      />

      {loadingRoute ? (
        <StateBlock kind="loading" title={t("Loading active route")} detail="Checking session active route configuration." />
      ) : routeError || !activeRoute ? (
        <Panel title={t("No active route selected")}>
          <StateBlock
            kind="empty"
            title={t("Active route required")}
            detail={routeError ?? "No gateway route has been activated for this session yet. Go to Gateway to select and activate a route."}
            action={
              <Button tone="primary" onClick={() => pushRoute("gateway")}>{t("Go to Gateway")}</Button>
            }
          />
        </Panel>
      ) : (
        <>
          <Panel
            title={`Active route: ${activeRoute.modelId}`}
            meta={<StatusPill value="CONNECTED" />}
          >
            <dl className="detail-grid">
              <Detail label="Model ID" value={activeRoute.modelId} mono />
              <Detail label="Base URL" value={activeRoute.baseUrl} mono />
              <Detail label="Endpoint ID" value={activeRoute.gatewayEndpointId} mono />
              {activeRoute.apiKeyHint ? <Detail label="Key hint" value={activeRoute.apiKeyHint} /> : null}
            </dl>

            <div style={{ marginTop: "16px" }}>
              <Field
                label="Exchange API Key"
                hint="Key is held strictly in browser sessionStorage and sent via Authorization: Bearer."
              >
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder={t("cyk_live_...")}
                  className="input-mono"
                />
              </Field>
            </div>
          </Panel>

          <Panel
            title={t("Chat conversation")}
            meta={
              <Button
                onClick={() =>
                  setMessages([{ role: "system", content: "You are a helpful AI assistant." }])
                }
              >{t("Clear history")}</Button>
            }
          >
            {chatError ? (
              <div className="callout callout--red" style={{ marginBottom: "12px" }}>
                <span className="callout__mark" aria-hidden="true">!</span>
                <p><strong>{t("Error:")}</strong> {chatError}</p>
              </div>
            ) : null}

            <div className="dh-chat">
              {messages.filter((m) => m.role !== "system").length === 0 ? (
                <div className="dh-chat__empty">{t("Start conversation with")}<code>{activeRoute.modelId}</code>
                </div>
              ) : (
                messages
                  .filter((m) => m.role !== "system")
                  .map((msg, idx) => (
                    <div key={idx} className={msg.role === "user" ? "dh-chat__message dh-chat__message--user" : "dh-chat__message"}>
                      <span className="dh-chat__role">
                        {msg.role === "user" ? "YOU" : <span className="dh-mono">{activeRoute.modelId}</span>}
                      </span>
                      <div className="dh-chat__bubble">
                        {msg.content || (sending && idx === messages.length - 1 ? "..." : "")}
                      </div>
                    </div>
                  ))
              )}
            </div>

            <form className="dh-chat__composer" onSubmit={sendMessage}>
              <input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={t("Type a message...")}
                disabled={sending || !apiKey.trim()}
              />
              <Button tone="primary" type="submit" disabled={sending || !inputMessage.trim() || !apiKey.trim()}>
                {sending ? "Sending..." : "Send"}
              </Button>
            </form>
          </Panel>
        </>
      )}
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="detail-item">
      <dt>{t(label)}</dt>
      <dd className={mono ? "input-mono" : undefined} title={mono ? value : undefined}>{t(value)}</dd>
    </div>
  );
}

const DEPLOYMENT_PHASES = ["QUEUED", "LOADING", "PROBING", "READY"] as const;

/**
 * Map Reactor phase events onto the shared workflow horizon. A failed rollout
 * shows the phases it actually reached followed by a FAILED node.
 * 中文：将 Reactor 部署阶段事件映射到共享的流程地平线；失败时只显示实际到达的阶段，
 *       并在末尾追加 FAILED 节点。
 */
function deploymentPhaseSteps(events: readonly DeploymentEvent[], t: (message: string) => string): WorkflowStep[] {
  const passed = DEPLOYMENT_PHASES.map((phase) => events.some((event) => event.phase === phase));
  const reached = passed.lastIndexOf(true);
  if (events.some((event) => event.phase === "FAILED")) {
    const timeline = DEPLOYMENT_PHASES.slice(0, reached + 1).map((phase, index): WorkflowStep => ({ id: phase, label: phase, state: passed[index] ? "done" : "pending" }));
    return [...timeline, { id: "FAILED", label: t("FAILED"), state: "blocked" }];
  }
  return DEPLOYMENT_PHASES.map((phase, index): WorkflowStep => {
    if (passed[index] && index === reached && phase !== "READY") return { id: phase, label: phase, detail: t("In progress"), state: "running" };
    return { id: phase, label: phase, state: passed[index] ? "done" : "pending" };
  });
}

function settledValue<T>(result: PromiseSettledResult<T>, label: string, failures: string[]): T | null {
  if (result.status === "fulfilled") {
    return result.value;
  }
  failures.push(`${label}: ${errorMessage(result.reason)}`);
  return null;
}

function resourceId(row: JsonRecord, index = 0): string {
  return typeof row["id"] === "string" ? row["id"] : `resource-${index}`;
}

function nestedRecord(row: JsonRecord, key: string): JsonRecord | null {
  const value = row[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function datasetVersionLabel(row: JsonRecord): string {
  const version = nestedRecord(row, "datasetVersion");
  return text(version?.["id"], "Not attached");
}

function validationSummary(row: JsonRecord): string {
  const validation = nestedRecord(row, "validation");
  if (!validation) {
    return "Pending evidence";
  }
  const checks = ["weights", "config", "tokenizer", "chatTemplate"];
  const passed = checks.filter((key) => validation[key] === true).length;
  const issues = Array.isArray(validation["issues"]) ? validation["issues"].length : 0;
  return `${passed}/${checks.length} checks${issues ? ` | ${issues} issue${issues === 1 ? "" : "s"}` : ""}`;
}

function endpointSummary(row: JsonRecord) {
  const endpoint = row["endpointId"];
  return typeof endpoint === "string" ? <span className="input-mono">{endpoint}</span> : <span className="muted">Not ready</span>;
}

function initialRunId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return runIdForLocation(window.location);
}

function errorMessage(error: unknown): string {
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
