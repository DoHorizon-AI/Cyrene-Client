// -----------------------------------------------------------------------------
// Module: services/echo/src/EchoWorkbench.tsx
// Role: Real Echo suite, JSONL import, evaluation, and report workflow.
// -----------------------------------------------------------------------------
// 中文：模块职责：通过 Echo Product API 创建套件、导入 JSONL、运行评测和查看报告。

import { useEffect, useMemo, useState } from "react";
import type { JsonRecord, NavigatorApi } from "../../navigator/src/api";
import { useI18n } from "../../../src/i18n";
import {
  EchoApi,
  inspectReferenceActualJsonl,
  type EvaluationInput,
  type EvaluationReport,
  type EvaluationRun,
  type EvaluationSample,
  type EvaluationSuite,
  type ArtifactRef,
} from "./api";
import "./echo.css";

interface EchoWorkbenchProps {
  api: Pick<NavigatorApi, "requestProductResponse">;
}

interface TargetPackageChoice {
  key: string;
  versionId: string;
  versionRef: string;
  resourceVersion: number;
  profile: "knowledge" | "sft";
  stale: boolean;
  artifact: ArtifactRef;
}

/**
 * Present the published package selected for each real Echo API run.
 * 中文：通过 Catalyst 已发布的版本与包选择器绑定真实 Echo 评测目标。
 */
export function EchoWorkbench({ api: transport }: EchoWorkbenchProps) {
  const { locale } = useI18n();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const api = useMemo(() => new EchoApi(transport), [transport]);
  const [datasets, setDatasets] = useState<JsonRecord[]>([]);
  const [versions, setVersions] = useState<JsonRecord[]>([]);
  const [inputs, setInputs] = useState<EvaluationInput[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInfo, setFileInfo] = useState<ReturnType<typeof inspectReferenceActualJsonl> | null>(null);
  const [activeInput, setActiveInput] = useState<EvaluationInput | null>(null);
  const [suiteName, setSuiteName] = useState("Reference vs actual exact match");
  const [threshold, setThreshold] = useState("1");
  const [suiteIdDraft, setSuiteIdDraft] = useState("");
  const [suite, setSuite] = useState<EvaluationSuite | null>(null);
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [samples, setSamples] = useState<EvaluationSample[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([api.listCatalystDatasets(), api.listInputs()]).then(([datasetResult, inputResult]) => {
      if (!active) return;
      const problems: string[] = [];
      if (datasetResult.status === "fulfilled") setDatasets(datasetResult.value.filter(isRecord));
      else { setDatasets([]); problems.push(`${tx("Catalyst 目标不可用", "Catalyst targets unavailable")}: ${String(datasetResult.reason)}`); }
      if (inputResult.status === "fulfilled") setInputs(inputResult.value.filter(isRecord));
      else { setInputs([]); problems.push(`${tx("Echo 输入记录不可用", "Echo input history unavailable")}: ${String(inputResult.reason)}`); }
      setError(problems.join(" "));
    });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!datasetId) { setVersions([]); setSelectedTarget(""); return; }
    let active = true;
    const controller = new AbortController();
    setVersions([]);
    setSelectedTarget("");
    void api.listDataToolsVersions(datasetId, controller.signal).then(values => {
      if (active) setVersions(values.filter(isRecord));
    }, reason => { if (active && !controller.signal.aborted) setError(String(reason)); });
    return () => { active = false; controller.abort(); };
  }, [api, datasetId]);

  const targetChoices = versions.flatMap(version => packageChoices(version));
  const target = targetChoices.find(choice => choice.key === selectedTarget) ?? null;

  async function refreshInputs() {
    setInputs((await api.listInputs()).filter(isRecord));
  }

  async function readSelectedFile(next: File | null) {
    setFile(next);
    setFileInfo(null);
    setActiveInput(null);
    setRun(null);
    setReport(null);
    setSamples([]);
    setError("");
    if (!next) return;
    if (next.size > 16 * 1024 * 1024) {
      setError(tx("JSONL 文件超过 16 MiB 上限。", "The JSONL file exceeds the 16 MiB limit."));
      return;
    }
    try { setFileInfo(inspectReferenceActualJsonl(await next.text())); }
    catch (reason) { setError(String(reason)); }
  }

  async function createSuite() {
    const parsedThreshold = Number(threshold);
    if (!suiteName.trim() || !Number.isFinite(parsedThreshold) || parsedThreshold < 0 || parsedThreshold > 1) {
      setError(tx("请输入套件名称和 0 到 1 之间的阈值。", "Enter a suite name and a threshold from 0 to 1."));
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const created = await api.createSuite({
        name: suiteName.trim(), evaluator: "exact_match.v1", expectedField: "reference",
        actualField: "actual", threshold: parsedThreshold,
      });
      setSuite(created);
      setSuiteIdDraft(created.id);
      setRun(null); setReport(null); setSamples([]);
      setNotice(tx(`已创建评测套件 ${created.name}。`, `Created evaluation suite ${created.name}.`));
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function loadSuite() {
    setBusy(true); setError(""); setNotice("");
    try {
      const loaded = await api.getSuite(suiteIdDraft.trim());
      setSuite(loaded);
      setRun(null); setReport(null); setSamples([]);
      setNotice(tx(`已载入评测套件 ${loaded.name}。`, `Loaded evaluation suite ${loaded.name}.`));
    } catch (reason) { setSuite(null); setRun(null); setReport(null); setSamples([]); setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function importInput() {
    if (!file || !fileInfo || !target) {
      setError(tx("请选择有效 JSONL 文件和已发布的 Catalyst 目标包。", "Choose a valid JSONL file and a published Catalyst target package."));
      return;
    }
    setBusy(true); setError(""); setNotice(""); setActiveInput(null); setRun(null); setReport(null); setSamples([]);
    try {
      const artifact = await api.uploadJsonl(file);
      const imported = await api.createInput({
        sourceRef: { uri: `cyrene://catalyst/dataset-versions/${target.versionId}`, id: target.versionId, resourceVersion: target.resourceVersion },
        artifact,
        format: "CYRENE_REFERENCE_ACTUAL_JSONL_V1",
        contentRefs: fileInfo.sampleIds,
        provenanceRefs: [target.versionRef, target.artifact.uri],
        targetDatasetVersion: target.versionRef,
        targetPackageArtifact: target.artifact,
      });
      setActiveInput(imported);
      await refreshInputs();
      setNotice(tx(`已导入 ${fileInfo.total} 条样本。`, `Imported ${fileInfo.total} samples.`));
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function selectSavedInput(value: string) {
    const next = inputs.find(item => item.id === value) ?? null;
    setActiveInput(next);
    setRun(null); setReport(null); setSamples([]); setError(""); setNotice("");
  }

  async function evaluate() {
    if (!suite || !activeInput) {
      setError(tx("先创建/载入评测套件并导入 reference/actual JSONL。", "Create or load a suite and import reference/actual JSONL first."));
      return;
    }
    setBusy(true); setError(""); setNotice(""); setLoading(true);
    try {
      const createdRun = await api.evaluateInput(activeInput.id, suite.id);
      setRun(createdRun);
      if (createdRun.resultId) {
        const [loadedReport, evidence] = await Promise.all([
          api.getReport(createdRun.resultId),
          api.getRunSamples(createdRun.id),
        ]);
        setReport(loadedReport);
        setSamples(evidence.filter(isRecord));
        setNotice(tx("Echo 已完成真实 Product API 评测，报告与样本证据已读取。", "Echo completed a Product API evaluation; its report and sample evidence are loaded."));
      } else {
        setNotice(tx(`Echo 运行状态：${createdRun.state}`, `Echo run state: ${createdRun.state}`));
      }
      await refreshInputs();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); setLoading(false); }
  }

  async function refreshRun() {
    if (!run) return;
    setBusy(true); setError("");
    try {
      const latest = await api.getRun(run.id);
      setRun(latest);
      if (latest.resultId) {
        const [loadedReport, evidence] = await Promise.all([api.getReport(latest.resultId), api.getRunSamples(latest.id)]);
        setReport(loadedReport); setSamples(evidence.filter(isRecord));
      }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function downloadReport() {
    if (!report) return;
    setBusy(true); setError("");
    try {
      const blob = await api.downloadReport(report.resultId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `echo-report-${report.resultId}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  const sampleEvidence = mergeSamples(report, samples);
  const activeTargetRef = activeInput
    ? stringValue(activeInput.targetDatasetVersion) ?? stringValue(asRecord(activeInput.sourceRef)?.uri)
    : null;
  const activePackageDigest = stringValue(asRecord(activeInput?.targetPackageArtifact)?.digest);

  return <div className="echo-workbench">
    <header className="echo-header">
      <div>
        <span className="echo-eyebrow">ECHO / EXACT MATCH</span>
        <h1>{tx("评测工作台", "Evaluation workbench")}</h1>
        <p>{tx("导入独立的 reference/actual JSONL，通过 Echo Product API 运行精确匹配，并查看绑定目标版本与输入摘要的报告。", "Import independent reference/actual JSONL, run exact match through the Echo Product API, and inspect a report bound to the target version and input digest.")}</p>
      </div>
      <div className="echo-badge">{tx("真实 Echo API", "Live Echo API")}</div>
    </header>

    {error && <p className="echo-alert" role="alert">{error}</p>}
    {notice && <p className="echo-notice" role="status">{notice}</p>}

    <section className="echo-section-grid">
      <section className="echo-card" aria-labelledby="echo-suite-title">
        <div className="echo-section-heading"><span>01</span><div><h2 id="echo-suite-title">{tx("评测套件", "Evaluation suite")}</h2><p>{tx("定义 exact_match 使用的字段和通过阈值。", "Set the fields and pass threshold for exact_match.")}</p></div></div>
        <label className="echo-field">{tx("套件名称", "Suite name")}<input value={suiteName} onChange={event => setSuiteName(event.target.value)} maxLength={200} disabled={busy} /></label>
        <div className="echo-form-row">
          <label className="echo-field">{tx("参考字段", "Reference field")}<input value="reference" readOnly /></label>
          <label className="echo-field">{tx("实际字段", "Actual field")}<input value="actual" readOnly /></label>
        </div>
        <label className="echo-field">{tx("通过阈值", "Pass threshold")}<input type="number" min="0" max="1" step="0.01" value={threshold} onChange={event => setThreshold(event.target.value)} disabled={busy} /></label>
        <p className="echo-hint">{tx("指标定义：exact_match 按 reference 与 actual 的精确相等计数，matched / evaluated 得出指标值；缺少任一字段的样本标记为跳过并排除分母，评测错误单独计入失败。阈值只用于套件门禁。", "Metric definition: exact_match counts exact reference/actual equality; matched / evaluated is the metric value. Rows missing either field are skipped and excluded from the denominator; evaluation errors count as failures. The threshold applies only to the suite gate.")}</p>
        <button className="echo-primary" type="button" disabled={busy} onClick={() => void createSuite()}>{tx("创建 exact-match 套件", "Create exact-match suite")}</button>
        <div className="echo-divider"><span>{tx("或载入已有套件", "or load an existing suite")}</span></div>
        <div className="echo-inline-action"><input aria-label={tx("已有套件 ID", "Existing suite ID")} placeholder={tx("粘贴 EvaluationSuite UUID", "Paste an EvaluationSuite UUID")} value={suiteIdDraft} onChange={event => { setSuiteIdDraft(event.target.value); setSuite(null); setRun(null); setReport(null); setSamples([]); }} disabled={busy} /><button type="button" disabled={busy || !suiteIdDraft.trim()} onClick={() => void loadSuite()}>{tx("载入", "Load")}</button></div>
        {suite && <div className="echo-resource"><span className="echo-state">{suite.evaluator}</span><strong>{suite.name}</strong><code>{suite.id}</code><small>{tx("门禁阈值", "Gate threshold")}: {suite.threshold}</small></div>}
      </section>

      <section className="echo-card" aria-labelledby="echo-input-title">
        <div className="echo-section-heading"><span>02</span><div><h2 id="echo-input-title">{tx("目标与输入", "Target and input")}</h2><p>{tx("报告会绑定 Catalyst DatasetVersion、包摘要和原始评测输入摘要。", "Reports bind the Catalyst DatasetVersion, package digest, and immutable evaluation input digest.")}</p></div></div>
        <label className="echo-field">{tx("Catalyst 数据集", "Catalyst dataset")}<select value={datasetId} onChange={event => setDatasetId(event.target.value)} disabled={busy}>
          <option value="">{tx("选择数据集", "Select a dataset")}</option>
          {datasets.map(dataset => {
            const id = resourceId(dataset);
            return id ? <option key={id} value={id}>{resourceName(dataset, id)}</option> : null;
          })}
        </select></label>
        <label className="echo-field">{tx("已发布版本 / 包", "Published version / package")}<select value={selectedTarget} onChange={event => setSelectedTarget(event.target.value)} disabled={busy || !versions.length}>
          <option value="">{versions.length ? tx("选择数据工具包", "Select a data-tools package") : tx("该数据集尚无可用数据工具包", "No data-tools package is available for this dataset")}</option>
          {targetChoices.map(choice => <option key={choice.key} value={choice.key}>{choice.versionId} · {choice.profile.toUpperCase()} · {shortDigest(choice.artifact.digest)}{choice.stale ? ` · ${tx("已过期", "stale")}` : ""}</option>)}
        </select></label>
        {target && <div className="echo-target-summary"><small>{tx("目标版本", "Target version")}</small><code>{target.versionRef}</code><small>{tx("包摘要", "Package digest")}</small><code>{target.artifact.digest}</code></div>}

        <label className="echo-field">{tx("Reference / actual JSONL", "Reference / actual JSONL")}<input type="file" accept=".jsonl,.ndjson,application/jsonl,application/x-ndjson" onChange={event => void readSelectedFile(event.target.files?.[0] ?? null)} disabled={busy} /></label>
        <p className="echo-hint">{tx("每行需有唯一 sampleId；reference 或 actual 可缺失，以便 Echo 将未评估样本计入覆盖报告。单次最多 1,000 条、16 MiB。", "Each row needs a unique sampleId. Missing reference or actual values are retained for Echo coverage reporting. Limit: 1,000 rows and 16 MiB per input.")}</p>
        {fileInfo && <div className="echo-preview-counts"><span>{tx("样本", "Samples")} <strong>{fileInfo.total}</strong></span><span>{tx("可评估", "Evaluable")} <strong>{fileInfo.evaluable}</strong></span><span>{tx("缺 reference", "Missing reference")} <strong>{fileInfo.missingReference}</strong></span><span>{tx("缺 actual", "Missing actual")} <strong>{fileInfo.missingActual}</strong></span></div>}
        {inputs.length > 0 && <label className="echo-field">{tx("已导入评测输入", "Imported evaluation input")}<select value={activeInput?.id ?? ""} onChange={event => void selectSavedInput(event.target.value)} disabled={busy}>
          <option value="">{tx("选择本次输入", "Choose the input for this run")}</option>
          {inputs.filter(isReferenceActualInput).map(item => <option key={item.id} value={item.id}>{item.id} · {item.state}</option>)}
        </select></label>}
        {activeInput && <div className="echo-resource"><span className="echo-state">{activeInput.state}</span><strong>{tx("已绑定评测目标", "Target bound")}</strong><code>{activeInput.id}</code>{activeTargetRef && <><small>{tx("数据集版本", "Dataset version")}</small><code>{activeTargetRef}</code></>}{activePackageDigest && <><small>{tx("目标包摘要", "Target package digest")}</small><code>{activePackageDigest}</code></>}</div>}
        <button className="echo-secondary" type="button" disabled={busy || !file || !fileInfo || !target} onClick={() => void importInput()}>{tx("上传并保存评测输入", "Upload and save evaluation input")}</button>
      </section>
    </section>

    <section className="echo-card echo-run-card" aria-labelledby="echo-run-title">
      <div className="echo-section-heading"><span>03</span><div><h2 id="echo-run-title">{tx("运行真实评测", "Run evaluation")}</h2><p>{tx("Echo 会调用已配置的 evaluation.runner.v1；不会把本地或 Studio 预演标为评测结果。", "Echo calls the configured evaluation.runner.v1. A local or Studio pipeline preview is never reported as an evaluation result.")}</p></div></div>
      <div className="echo-run-actions"><div>{suite ? <strong>{suite.name}</strong> : <span>{tx("尚未选择套件", "No suite selected")}</span>}<small>{activeInput ? `${tx("输入", "Input")}: ${activeInput.id}` : tx("尚未选择输入", "No input selected")}</small></div><div className="echo-button-group"><button className="echo-primary" type="button" disabled={busy || !suite || !activeInput} onClick={() => void evaluate()}>{busy ? tx("正在处理…", "Working…") : tx("运行 Echo", "Run Echo")}</button>{run && !report && <button type="button" disabled={busy} onClick={() => void refreshRun()}>{tx("刷新状态", "Refresh status")}</button>}</div></div>
      {run && <div className="echo-run-state"><span className={`echo-state ${run.state.toLowerCase()}`}>{run.state}</span><code>{run.id}</code>{run.failure && <span>{String(run.failure.message ?? run.failure.code ?? "")}</span>}</div>}
    </section>

    {report && <section className="echo-card echo-report-card" aria-labelledby="echo-report-title">
      <div className="echo-report-heading"><div><span className="echo-eyebrow">PERSISTED EVALUATION REPORT</span><h2 id="echo-report-title">{tx("评测报告", "Evaluation report")}</h2><p>{tx("评测目标、输入摘要、指标与逐样本状态均来自 Echo 导出的 JSON 报告。", "Target, input digest, metrics, and per-sample states come from the JSON report exported by Echo.")}</p></div><button className="echo-primary" type="button" disabled={busy} onClick={() => void downloadReport()}>{tx("下载 JSON 报告", "Download JSON report")}</button></div>
      <div className="echo-coverage-grid">
        <CoverageCard label={tx("总样本", "Total samples")} value={report.coverage.total} />
        <CoverageCard label={tx("已评估", "Evaluated")} value={report.coverage.evaluated} />
        <CoverageCard label={tx("失败", "Failed")} value={report.coverage.failed} />
        <CoverageCard label={tx("跳过", "Skipped")} value={report.coverage.skipped} />
      </div>
      <div className="echo-report-meta"><span>{tx("目标版本", "Target version")} <code>{report.target.versionRef}</code></span><span>{tx("包摘要", "Package digest")} <code>{report.target.packageDigest}</code></span><span>{tx("输入摘要", "Input digest")} <code>{report.inputDigest}</code></span><span>{tx("评估器", "Evaluator")} <code>{report.evaluator.id} v{report.evaluator.version}</code></span></div>
      <h3>{tx("命名指标", "Named metrics")}</h3>
      <div className="echo-metrics">
        {report.metrics.map(metric => <article key={metric.name}><span>{metric.name}</span><strong>{formatRatio(metric.value)}</strong><small>{metric.matched} / {metric.evaluated} {tx("匹配", "matched")}</small></article>)}
      </div>
      <h3>{tx("逐样本证据", "Per-sample evidence")}</h3>
      <div className="echo-table-scroll"><table className="echo-samples-table"><thead><tr><th>{tx("Sample ID", "Sample ID")}</th><th>{tx("状态", "Status")}</th><th>reference</th><th>actual</th><th>{tx("说明", "Detail")}</th></tr></thead><tbody>
        {sampleEvidence.map(sample => <tr key={sample.sampleId}><td><code>{sample.sampleId}</code></td><td><span className={`echo-state ${sample.status.toLowerCase()}`}>{sample.status}</span></td><td>{formatValue(sample.reference)}</td><td>{formatValue(sample.actual)}</td><td>{sample.message ?? sample.code ?? (sample.exactMatch === true ? tx("完全匹配", "Exact match") : sample.exactMatch === false ? tx("未匹配", "No exact match") : "—")}</td></tr>)}
      </tbody></table></div>
      {loading && <p className="echo-hint">{tx("正在加载样本证据…", "Loading sample evidence…")}</p>}
    </section>}
  </div>;
}

function CoverageCard({ label, value }: { label: string; value: number }) {
  return <article className="echo-coverage-card"><span>{label}</span><strong>{value}</strong></article>;
}

function packageChoices(version: JsonRecord): TargetPackageChoice[] {
  const versionId = resourceId(version);
  if (!versionId) return [];
  const resourceRef = asRecord(version.resourceRef);
  const versionRef = stringValue(resourceRef?.uri) ?? `catalyst://dataset-versions/${versionId}`;
  const resourceVersion = numberValue(version.resourceVersion) ?? numberValue(resourceRef?.resourceVersion);
  if (typeof resourceVersion !== "number" || !Number.isSafeInteger(resourceVersion) || resourceVersion < 1) return [];
  const projection = asRecord(version.dataTools);
  if (!projection) return [];
  const choices: TargetPackageChoice[] = [];
  for (const profile of ["knowledge", "sft"] as const) {
    const key = profile === "knowledge" ? "knowledgeArtifact" : "sftArtifact";
    const artifact = asRecord(projection[key]);
    if (!artifact || typeof artifact.uri !== "string" || typeof artifact.digest !== "string" || typeof artifact.size_bytes !== "number" || typeof artifact.kind !== "string") continue;
    choices.push({
      key: `${versionId}:${profile}`,
      versionId,
      versionRef,
      resourceVersion,
      profile,
      stale: projection.stale === true,
      artifact: artifact as ArtifactRef,
    });
  }
  return choices;
}

function mergeSamples(report: EvaluationReport | null, evidence: EvaluationSample[]) {
  const byId = new Map<string, EvaluationSample>();
  for (const sample of evidence) {
    const id = sample.sampleId ?? stringValue(sample.inputRecord?.sampleId);
    if (id) byId.set(id, sample);
  }
  if (!report) return [];
  return report.samples.map(sample => {
    const row = byId.get(sample.sampleId);
    return {
      ...sample,
      reference: row?.expected ?? row?.inputRecord?.reference,
      actual: row?.actual ?? row?.inputRecord?.actual,
    };
  });
}

function isReferenceActualInput(value: EvaluationInput): boolean {
  return value.format === "CYRENE_REFERENCE_ACTUAL_JSONL_V1";
}

function resourceId(value: JsonRecord): string | null {
  return stringValue(value.id) ?? stringValue(asRecord(value.resourceRef)?.id);
}

function resourceName(value: JsonRecord, fallback: string): string {
  return stringValue(value.name) ?? stringValue(value.displayName) ?? fallback;
}

function shortDigest(value: string): string {
  return value.length > 19 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

function formatRatio(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value as JsonRecord : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
