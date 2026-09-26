import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { PipelineNode } from "../../../../packages/pipeline-model";
import { trainingParametersSchema, type HostStatus, type TrainingDraft } from "../../../../packages/service-settings/contracts";
import { SettingsClient } from "./client";
import type { WorkspaceSummary } from "./workspace-bff-client";

interface Choice { id: string; label: string; apply(): void }
interface Props { node: PipelineNode; client: SettingsClient; status: HostStatus | null; disabled: boolean; onUpdate(node: PipelineNode): void }
const prefix: Record<string, string | undefined> = { dataset: "catalyst", model: "reactor", training: "yield", evaluation: "echo", deployment: "reactor", agent: "navigator" };
const description: Record<string, string> = {
  dataset: "读取已发布数据版本并绑定到节点。数据集列表用于查找容器；版本需按 ID 查询。",
  model: "读取 Reactor 已导入的模型，选择 READY 模型制品。这里只选择已有模型。",
  compute: "读取 Web Host 所在机器的 GPU 观测。云资源目录与分配接口尚未接入，算力规格保存在流程草稿。",
  training: "读取 Yield 训练草稿；可将参数保存回未启动的草稿。保存不会启动训练。Full 模式暂不能同步。",
  evaluation: "按 ID 读取 Echo 评估配置，或新建一份配置；不会发起评估。现有配置没有更新接口。",
  deployment: "选择 Reactor 已配置的推理绑定。部署名称和选择保存在流程草稿，不会创建部署。",
  agent: "读取 Navigator 工作空间中的已有会话。通用 Agent 配置接口尚未提供；测试任务保存在流程草稿。",
};

export function NodeServiceSettings({ node, client, status, disabled, onUpdate }: Props) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [choices, setChoices] = useState<Choice[]>([]);
  const [resourceId, setResourceId] = useState(node.settingsBinding?.resourceId ?? "");
  const [workspaceId, setWorkspaceId] = useState(node.settingsBinding?.workspaceId ?? "");
  const [workspaceChoices, setWorkspaceChoices] = useState<readonly WorkspaceSummary[]>([]);
  const [workspaceDiscovery, setWorkspaceDiscovery] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [workspaceDiscoveryError, setWorkspaceDiscoveryError] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [draft, setDraft] = useState<TrainingDraft | null>(null);
  const [facts, setFacts] = useState<string[]>([]);
  const latest = useRef(node); latest.current = node;
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const suiteRequest = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    request.current?.abort(); setBusy(false); setChoices([]); setFacts([]); setDraft(null); setMessage("");
  }, [status]);
  const workspaceBffEnabled = client.workspaceBffEnabled;
  useEffect(() => {
    if (!workspaceBffEnabled) return;
    const controller = new AbortController();
    setWorkspaceDiscovery("loading"); setWorkspaceDiscoveryError("");
    void client.discoverWorkspaceBffWorkspaces(controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      setWorkspaceChoices(items);
      setSelectedWorkspaceId((previous) => {
        if (items.length === 1) return items[0].workspaceId;
        return items.some((item) => item.workspaceId === previous) ? previous : "";
      });
      setWorkspaceDiscovery("ready");
    }, (error: unknown) => {
      if (controller.signal.aborted) return;
      setWorkspaceChoices([]); setSelectedWorkspaceId("");
      setWorkspaceDiscoveryError(error instanceof Error ? error.message : "Workspace 发现失败。");
      setWorkspaceDiscovery("failed");
    });
    return () => controller.abort();
  }, [client, workspaceBffEnabled]);
  const service = prefix[node.type];
  const hostAvailable = !!status && (!service || status.proxyPrefixes.some((p) => p === `/api/v1/${service}`));
  const selectedWorkspace = workspaceChoices.find((item) => item.workspaceId === selectedWorkspaceId);
  const workspaceReady = workspaceDiscovery === "ready" && !!selectedWorkspace;
  const bffReadSupported = node.type === "dataset"
    ? !resourceId.trim()
    : node.type === "model"
      ? true
      : node.type === "training"
        ? !!resourceId.trim()
        : node.type === "evaluation"
          ? !!resourceId.trim()
          : node.type === "compute";
  const bffCreateSupported = node.type === "evaluation";
  const available = workspaceBffEnabled
    ? node.type === "compute" ? hostAvailable : workspaceReady && (bffReadSupported || bffCreateSupported)
    : hostAvailable;
  const locked = disabled || busy || !available;
  const readLocked = locked || (workspaceBffEnabled && !bffReadSupported);
  const createLocked = locked || (workspaceBffEnabled && !bffCreateSupported);

  function apply(config: PipelineNode["config"], binding?: PipelineNode["settingsBinding"]) {
    if (!mounted.current) return;
    onUpdate({ ...latest.current, config: { ...latest.current.config, ...config }, ...(binding ? { settingsBinding: binding } : {}) });
    if (binding) setResourceId(binding.resourceId);
  }
  async function perform(operation: (signal: AbortSignal) => Promise<void>) {
    if (locked) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage(""); setChoices([]); setFacts([]);
    try { await operation(controller.signal); }
    catch (e) {
      if (!mounted.current || controller.signal.aborted) return;
      setMessage(e instanceof z.ZodError ? "设置参数不符合服务契约，请检查字段范围。" : e instanceof Error ? e.message : "读取设置失败。");
    } finally { if (mounted.current && request.current === controller) setBusy(false); }
  }
  const active = (signal: AbortSignal) => mounted.current && !signal.aborted;

  async function load(signal: AbortSignal) {
    if (node.type === "dataset") {
      if (resourceId.trim()) {
        const item = await client.datasetVersion(z.string().uuid().parse(resourceId.trim()), signal);
        if (!active(signal)) return;
        if (item.state !== "PUBLISHED" || !item.output) throw new Error("该数据版本尚未发布，或没有输出制品，未应用到节点。");
        apply({ datasetRef: item.id }, { kind: "dataset-version", resourceId: item.id });
        setFacts([`数据集：${item.datasetId}`, `版本：${item.version} · ${item.state}`, `行数：${item.rowCount ?? "未报告"}`]);
        setMessage("已读取已发布版本并更新本地节点。");
      } else {
        const items = await client.datasets(signal, selectedWorkspaceId); if (!active(signal)) return;
        setFacts(items.map((x) => `${x.name} · ${x.id} · ${x.state}`));
        setMessage(items.length ? "以下是数据集容器；请填写需要使用的数据版本 ID 后读取。" : "服务返回空数据集列表。");
      }
    } else if (node.type === "model") {
      const items = await client.models(signal, selectedWorkspaceId); if (!active(signal)) return;
      const ready = items.filter((x) => x.state === "READY" && x.modelArtifact);
      setChoices(ready.map((x) => ({ id: x.id, label: x.name, apply: () => {
        apply({ modelRef: x.modelArtifact!.uri }, { kind: "model-import", resourceId: x.id });
        setMessage(`已选择 ${x.name}，模型制品引用已写入本地节点。`);
      } })));
      setMessage(`已读取 ${items.length} 个模型，其中 ${ready.length} 个可选择。`);
    } else if (node.type === "compute") {
      const result = await client.status(signal); if (!active(signal)) return;
      setFacts((result.gpu?.gpus ?? []).map((x) => `${x.name} · ${x.usedMib}/${x.totalMib} MiB · ${x.utilizationPct}%`));
      setMessage(result.gpu?.available ? "已读取本机 GPU 观测；这不代表资源已分配。" : "Web Host 未报告可用 GPU；没有云端资源数据。");
    } else if (node.type === "training") {
      if (workspaceBffEnabled) {
        const draftId = z.string().uuid().parse(resourceId.trim());
        const item = await client.draft(draftId, signal, selectedWorkspaceId); if (!active(signal)) return;
        setDraft(item);
        const params = item.configuration?.parameters;
        const editable = params ? Object.fromEntries(Object.entries(params).filter(([key, value]) => key !== "maxSteps" && value != null)) : {};
        apply({ ...editable, method: "LoRA" }, { kind: "training-draft", resourceId: item.id });
        setMessage(item.configuration ? "已通过 Workspace BFF 读取草稿参数。参数写回尚未纳入当前投影。" : "已通过 Workspace BFF 读取草稿；该草稿没有已准备的基础模型配置。");
        return;
      }
      const items = await client.drafts(signal); if (!active(signal)) return;
      setChoices(items.map((x) => ({ id: x.id, label: `${x.name} · ${x.state}`, apply: () => {
        setDraft(x);
        const params = x.configuration?.parameters;
        const editable = params ? Object.fromEntries(Object.entries(params).filter(([key, value]) => key !== "maxSteps" && value != null)) : {};
        apply({ ...editable, method: "LoRA" }, { kind: "training-draft", resourceId: x.id });
        setMessage(x.configuration ? "已读取草稿参数。参数修改后须点击保存到 Yield 才会写回。" : "此草稿还没有基础模型配置，请先在 Yield 准备基础模型后再保存参数。");
      } })));
      setMessage(items.length ? "选择一份训练草稿以读取其参数。" : "Yield 尚无训练草稿。先从数据集创建草稿后再连接。");
    } else if (node.type === "evaluation") {
      const item = await client.suite(z.string().uuid().parse(resourceId.trim()), signal, selectedWorkspaceId); if (!active(signal)) return;
      if (item.state !== "ACTIVE") throw new Error("评估配置已归档，未应用。");
      apply({ suite: item.name, evaluator: item.evaluator, expectedField: item.expectedField, actualField: item.actualField, threshold: item.threshold, judgeProfileId: item.judgeProfileId ?? "" }, { kind: "evaluation-suite", resourceId: item.id });
      setMessage("已读取评估配置。修改只保存在本地；可另存为新配置。");
    } else if (node.type === "deployment") {
      const items = await client.bindings(signal); if (!active(signal)) return;
      setChoices(items.map((x) => ({ id: x.bindingId, label: x.bindingId, apply: () => {
        apply({ servingBindingId: x.bindingId }, { kind: "serving-binding", resourceId: x.bindingId }); setMessage("推理服务绑定已写入本地节点，尚未创建部署。");
      } })));
      setMessage(items.length ? "选择已配置的推理服务绑定。" : "Reactor 未配置推理服务绑定。");
    } else if (node.type === "agent") {
      const result = await client.sessions(workspaceId, signal); if (!active(signal)) return;
      if (result.items.some((x) => x.productMetadata.workspaceId !== workspaceId.trim())) throw new Error("会话响应的工作空间不匹配，未应用。");
      setChoices(result.items.map((x) => ({ id: x.productMetadata.sessionId, label: `${x.productMetadata.sessionId} · ${x.eventCount} 事件`, apply: () => {
        apply({}, { kind: "navigator-session", resourceId: x.productMetadata.sessionId, workspaceId: workspaceId.trim() }); setMessage("已绑定现有会话；没有创建 AgentRun 或发送任务。");
      } })));
      setMessage(result.items.length ? "选择已有会话作为后续 Agent 设置的上下文。" : "此工作空间没有已保存会话。");
    }
  }
  async function saveTraining(signal: AbortSignal) {
    if (workspaceBffEnabled) throw new Error("Workspace BFF 当前没有 Yield 草稿更新（PATCH）投影；未发送写请求。");
    const id = latest.current.settingsBinding?.resourceId;
    if (!id || latest.current.settingsBinding?.kind !== "training-draft") throw new Error("请先选择训练草稿。");
    if (latest.current.config.method !== "LoRA") throw new Error("当前 Yield 设置契约仅支持 SFT / LoRA，Full 参数未发送。");
    const fresh = await client.draft(id, signal);
    if (!active(signal)) return;
    if (fresh.state === "STARTED" || fresh.trainingRun) throw new Error("草稿已启动，不能修改训练设置。");
    if (!fresh.configuration) throw new Error("草稿缺少已准备的基础模型配置。");
    const edits = Object.fromEntries(Object.entries(latest.current.config).filter(([key]) => key !== "method"));
    const parameters = trainingParametersSchema.parse({ ...fresh.configuration.parameters, ...edits });
    const result = await client.prepareDraft(id, { ...fresh.configuration, parameters });
    if (!active(signal)) return;
    setDraft(result); setMessage(`Yield 已确认保存（${result.state}）；未启动训练。`);
  }
  async function createSuite(signal: AbortSignal) {
    const config = latest.current.config;
    const payload = { name: config.suite, evaluator: config.evaluator ?? "exact_match.v1", expectedField: config.expectedField ?? "expected", actualField: config.actualField ?? "actual", threshold: config.threshold ?? 0.8, ...(config.judgeProfileId ? { judgeProfileId: config.judgeProfileId } : {}) };
    const serialized = JSON.stringify(payload);
    if (suiteRequest.current?.payload !== serialized) suiteRequest.current = { payload: serialized, key: crypto.randomUUID() };
    const item = await client.createSuite(payload, suiteRequest.current!.key, selectedWorkspaceId);
    if (!active(signal)) return;
    apply({}, { kind: "evaluation-suite", resourceId: item.id }); setMessage(`Echo 已创建评估配置「${item.name}」；未发起评估。`);
  }

  return <section className="service-settings" aria-label="节点服务设置">
    <div className="settings-heading"><strong>服务端设置</strong><span>{workspaceBffEnabled ? "Workspace BFF" : !status ? "未连接" : available ? "可请求" : "入口未开放"}</span></div>
    <p>{description[node.type]}</p>
    {workspaceBffEnabled ? <div className="settings-hint" role="status">
      {workspaceDiscovery === "loading" && "正在读取当前登录 session 与成员 Workspace 列表…"}
      {workspaceDiscovery === "failed" && workspaceDiscoveryError}
      {workspaceDiscovery === "ready" && workspaceChoices.length === 0 && "当前登录账号没有可用的成员 Workspace；服务请求保持不可用。"}
      {workspaceDiscovery === "ready" && workspaceChoices.length === 1 && selectedWorkspace && `已从成员发现中选择：${selectedWorkspace.displayName}（${selectedWorkspace.workspaceId}）`}
      {workspaceDiscovery === "ready" && workspaceChoices.length > 1 && <label className="field"><span>Workspace（来自当前登录账号的成员发现）</span><select value={selectedWorkspaceId} onChange={(event) => setSelectedWorkspaceId(event.target.value)} disabled={disabled || busy}><option value="">请选择 Workspace</option>{workspaceChoices.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{item.displayName}（{item.workspaceId}）</option>)}</select></label>}
      {workspaceBffEnabled && node.type === "training" && "BFF 合同只支持按 ID 读取 Yield 草稿；不包含草稿列表、参数写回或启动。"}
      {workspaceBffEnabled && node.type === "dataset" && resourceId.trim() && "BFF 合同支持数据集列表，不支持按 ID 读取 DatasetVersion；请清空 ID 后读取列表。"}
      {workspaceBffEnabled && node.type === "evaluation" && !resourceId.trim() && "按 ID 读取 Echo suite 需要填写配置 ID；当前也可创建一份新配置。"}
      {workspaceBffEnabled && node.type === "deployment" && "当前 BFF 合同没有 Reactor serving bindings 投影；不会直接访问 Product。"}
      {workspaceBffEnabled && node.type === "agent" && "当前 BFF 合同没有 Navigator session 列表投影；append events 也不允许浏览器调用。"}
    </div> : null}
    {!workspaceBffEnabled && !status && <p className="settings-hint">请先从页面右上角连接 Web Host。</p>}
    {!workspaceBffEnabled && status && !available && <p className="settings-hint">Web Host 未开放 {service} 入口，此节点保留本地设置。</p>}
    {(node.type === "dataset" || node.type === "evaluation" || (workspaceBffEnabled && node.type === "training")) && <label className="field"><span>{node.type === "dataset" ? "数据版本 ID（留空读取数据集）" : node.type === "evaluation" ? "评估配置 ID" : "Yield 训练草稿 ID"}</span><input value={resourceId} onChange={(e) => setResourceId(e.target.value)} disabled={disabled || busy} /></label>}
    {node.type === "agent" && !workspaceBffEnabled && <label className="field"><span>Navigator 工作空间 ID</span><input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} disabled={disabled || busy} /></label>}
    <div className="settings-actions"><button disabled={readLocked} onClick={() => void perform(load)}>{busy ? "请求中…" : "读取服务设置"}</button>{node.type === "training" && <button disabled={locked || workspaceBffEnabled || !draft || draft.state === "STARTED" || !draft.configuration} title={workspaceBffEnabled ? "当前 BFF 合同没有 Yield 草稿更新操作。" : undefined} onClick={() => void perform(saveTraining)}>保存参数到 Yield</button>}{node.type === "evaluation" && <button disabled={createLocked} onClick={() => void perform(createSuite)}>另存到 Echo</button>}</div>
    {choices.length > 0 && <div className="resource-choices">{choices.map((c) => <button key={c.id} disabled={locked} onClick={c.apply}>{c.label}<small>{c.id}</small></button>)}</div>}
    {!!facts.length && <ul className="resource-facts">{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>}
    {message && <p role="status" className="settings-message">{message}</p>}
    {node.settingsBinding && <div className="settings-binding"><small>已绑定 · {node.settingsBinding.kind}</small><code>{node.settingsBinding.resourceId}</code><button disabled={disabled || busy} onClick={() => { const { settingsBinding: _, ...rest } = latest.current; onUpdate(rest); setResourceId(""); setDraft(null); setMessage("已解除服务资源绑定，节点本地参数保留。"); }}>解除绑定</button></div>}
  </section>;
}
