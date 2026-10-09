import { useEffect, useRef, useState } from "react";
import { Button, formatDate, PageHeader, Panel, ResourceTable, StateBlock, StatusPill, text } from "../components";
import { type JsonRecord, NavigatorContractError, NavigatorHttpError, makeIdempotencyKey, type TrainingParametersInput } from "../api";
import { pushRunRoute } from "../router";
import { useI18n } from "../i18n";
import { type PageProps, resourceId, nestedRecord, datasetVersionLabel, errorMessage } from "./shared";

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
