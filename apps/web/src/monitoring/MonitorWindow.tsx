import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Pipeline } from "../../../../packages/pipeline-model";
import { monitoringSnapshotSchema, type MonitoringSnapshot } from "../../../../packages/monitoring/contracts";
import { useTeamIdentity } from "../team/TeamGate";
import { useI18n } from "../i18n";
import { controlCommand } from "../runs/client";
import { useRunObservation } from "../runs/observation";
import { monitorRows } from "./model";
import "./monitoring.css";

const status: Record<string, [string, string]> = {
  pending: ["等待依赖", "Pending"], dispatching: ["派发中", "Dispatching"], queued: ["排队中", "Queued"], running: ["运行中", "Running"],
  succeeded: ["已完成", "Succeeded"], failed: ["失败", "Failed"], stopped: ["已停止", "Stopped"], unknown: ["待核对", "Unknown"],
  reference: ["资源引用", "Resource reference"], unavailable: ["执行能力不可用", "Execution unavailable"], "not-started": ["尚未运行", "Not started"],
  idle: ["未订阅", "Not subscribed"], connecting: ["连接中", "Connecting"], live: ["实时更新", "Live"], offline: ["网络断开", "Offline"], reconnecting: ["重新连接中", "Reconnecting"],
};
const typeNames: Record<string, [string, string]> = { "local-diagnostic": ["本地诊断", "Local diagnostic"], training: ["训练", "Training"], evaluation: ["评估", "Evaluation"], deployment: ["部署", "Deployment"], model: ["模型", "Models"], dataset: ["数据集", "Datasets"], compute: ["算力", "Compute"], agent: ["Agent", "Agents"] };
export function MonitorWindow({ document: pipeline, dirty, selectedId, visible, expanded, historyRequest, dock, center, splitRequested, onSplit, onExpand, onLocate }: {
  document: Pipeline; dirty: boolean; selectedId: string | null; visible: boolean; expanded: boolean; historyRequest: number;
  dock: RefObject<HTMLDivElement | null>; center: RefObject<HTMLDivElement | null>; splitRequested: boolean; onSplit(): void; onExpand(): void; onLocate(id: string): void;
}) {
  const [host] = useState(() => { const element = document.createElement("div"); element.className = "monitor-portal"; return element; });
  useLayoutEffect(() => { const target = expanded ? center.current : dock.current; target?.appendChild(host); host.hidden = !visible; return () => host.remove(); }, [expanded, visible, dock, center, host]);
  return createPortal(<MonitorBody pipeline={pipeline} dirty={dirty} selectedId={selectedId} visible={visible} expanded={expanded} historyRequest={historyRequest} splitRequested={splitRequested} onSplit={onSplit} onExpand={onExpand} onLocate={onLocate} />, host);
}
function MonitorBody({ pipeline, dirty, selectedId, visible, expanded, historyRequest, splitRequested, onSplit, onExpand, onLocate }: {
  pipeline: Pipeline; dirty: boolean; selectedId: string | null; visible: boolean; expanded: boolean; historyRequest: number; splitRequested: boolean; onSplit(): void; onExpand(): void; onLocate(id: string): void;
}) {
  const { locale } = useI18n(), { actorId, workspaceId, scopes } = useTeamIdentity();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const label = (value: string) => status[value] ? tx(...status[value]) : value;
  const typeLabel = (value: string) => typeNames[value] ? tx(...typeNames[value]) : value;
  const [scope, setScope] = useState("workspace"), [history, setHistory] = useState(false), [pinned, setPinned] = useState(false);
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  const [type, setType] = useState(""), [selectedKey, setSelectedKey] = useState<string | null>(null), [query, setQuery] = useState("");
  const canRead = ["pipelines.read", "runs.read"].every(permission => scopes.includes(permission));
  const identity = JSON.stringify([actorId, workspaceId, scopes]), snapshotIdentity = useRef(identity);
  const safeSnapshot = identity === snapshotIdentity.current ? snapshot : null;
  useEffect(() => { setSnapshot(null); snapshotIdentity.current = identity; setSelectedKey(null); setPinned(false); setError(""); }, [identity]);
  useEffect(() => { if (historyRequest) setHistory(true); }, [historyRequest]);
  useEffect(() => {
    if (!visible || !canRead) return;
    let active = true, pending = false;
    const fetchSnapshot = async () => {
      if (!active || pending || document.hidden || !navigator.onLine) return;
      pending = true;
      try {
        const next = monitoringSnapshotSchema.parse(await controlCommand("/studio-monitoring", "monitoring.snapshot", { workspaceId, ...(scope === "pipeline" ? { pipelineId: pipeline.id } : {}), history }));
        if (active && next.workspaceId === workspaceId) { setSnapshot(next); setError(""); }
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { pending = false; }
    };
    const offline = () => setError(tx("网络断开，保留最近观测。", "Offline; showing the last observation."));
    void fetchSnapshot(); const timer = setInterval(() => void fetchSnapshot(), 5000);
    window.addEventListener("online", fetchSnapshot); window.addEventListener("offline", offline); document.addEventListener("visibilitychange", fetchSnapshot);
    return () => { active = false; clearInterval(timer); window.removeEventListener("online", fetchSnapshot); window.removeEventListener("offline", offline); document.removeEventListener("visibilitychange", fetchSnapshot); };
  }, [identity, scope, scope === "pipeline" ? pipeline.id : "", history, visible, canRead, refresh, locale]);
  const rows = useMemo(() => monitorRows(safeSnapshot, pipeline, dirty, scope === "pipeline", history), [safeSnapshot, pipeline, dirty, scope, history]);
  const types = [...new Set(rows.map(row => row.type))];
  const lastFollow = useRef("");
  useEffect(() => {
    const followKey = JSON.stringify([pipeline.id, selectedId]);
    if (!pinned && (lastFollow.current !== followKey || (selectedKey?.includes(",null,") && !rows.some(row => row.key === selectedKey)))) {
      const row = rows.find(item => item.pipelineId === pipeline.id && item.id === selectedId);
      if (row) { setType(row.type); setSelectedKey(row.key); lastFollow.current = followKey; }
    }
  }, [pipeline.id, selectedId, pinned, rows, selectedKey]);
  const activeType = types.includes(type) ? type : types[0];
  const filtered = rows.filter(row => row.type === activeType && `${row.label} ${row.pipelineName} ${row.runId ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const selection = rows.find(row => row.key === selectedKey);
  const observation = useRunObservation(actorId, workspaceId, selection?.runId ?? null, canRead && visible);
  const step = observation.run?.steps.find(item => item.nodeId === selection?.id);
  return <section className={`monitor-window ${expanded ? "monitor-expanded" : ""}`} aria-label={tx("Navigator 运行监控", "Navigator run monitoring")}>
    <div className="monitor-toolbar"><select aria-label={tx("监控范围", "Monitoring scope")} value={scope} onChange={e => { setScope(e.target.value); setSnapshot(null); setSelectedKey(null); }}><option value="workspace">{tx("整个工作空间", "Entire workspace")}</option><option value="pipeline">{tx("当前流水线", "Current pipeline")}</option></select><button onClick={onSplit}>{splitRequested ? tx("合并编辑区", "Unsplit editor") : tx("左右分栏", "Split editor right")}</button><button onClick={onExpand}>{expanded ? tx("停靠右侧", "Dock right") : tx("在主区域打开", "Open in editor")}</button></div>
    <div className="monitor-toolbar"><label><input type="checkbox" checked={history} onChange={e => { setHistory(e.target.checked); setSnapshot(null); }} />{tx("运行历史", "Run history")}</label><button onClick={() => setRefresh(n => n + 1)}>{tx("刷新", "Refresh")}</button><label><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />{tx("固定查看", "Pin selection")}</label></div>
    {!canRead && <p role="status">{tx("当前身份没有运行监控权限。", "Your account cannot access run monitoring.")}</p>}
    {error && <p className="monitor-error" role="status">{tx("观测暂不可用，保留最近状态：", "Observation unavailable; retaining last state: ")}{error}</p>}
    <p className="monitor-meta">{workspaceId} · {safeSnapshot ? `${tx("更新于", "Updated")} ${new Date(safeSnapshot.observedAt).toLocaleTimeString(locale)}` : tx("尚未取得运行观测", "No run observation yet")}{dirty && ` · ${tx("当前流程含未保存编辑", "Current pipeline has unsaved edits")}`}</p>
    <div className="monitor-types" role="tablist" aria-label={tx("节点类型", "Node types")}>{types.map(value => <button key={value} role="tab" aria-selected={activeType === value} onClick={() => { setType(value); setSelectedKey(null); lastFollow.current = JSON.stringify([pipeline.id, selectedId]); }}><span>{typeLabel(value)}</span><small>{rows.filter(row => row.type === value).length}</small></button>)}</div>
    {!rows.length && <p>{tx("当前范围没有节点。", "No nodes in this scope.")}</p>}
    <div className="monitor-content"><div className="monitor-list"><input aria-label={tx("筛选监控节点", "Filter monitored nodes")} placeholder={tx("筛选节点或流水线", "Filter nodes or pipelines")} value={query} onChange={e => setQuery(e.target.value)} />
      {filtered.map(row => <button className={`monitor-row ${selection?.key === row.key ? "selected" : ""}`} key={row.key} onClick={() => setSelectedKey(row.key)}><span><strong>{row.label}</strong><span className={`monitor-state state-${row.state}`}>{label(row.state)}</span></span><small>{row.pipelineName} · {row.runId?.slice(0, 8) ?? tx("草稿", "Draft")}</small>{row.removed && <small>{tx("已从当前流程移除", "Removed from current pipeline")}</small>}{!row.runId && row.kind === "unavailable" && <small>{tx("执行能力尚不可用", "Execution capability unavailable")}</small>}{row.draft && <small>{tx("未保存", "Unsaved")}</small>}</button>)}
    </div><div className="monitor-detail">
      {selection ? <><h3>{selection.label}</h3><p className="monitor-meta">{selection.pipelineName} · {selection.type} · {selection.id}</p><dl><dt>{tx("状态", "Status")}</dt><dd>{label(selection.kind === "reference" ? "reference" : step?.state ?? selection.state)}</dd><dt>{tx("服务器", "Server")}</dt><dd>{step?.serverId ?? selection.serverId ?? tx("未分配", "Unassigned")}</dd><dt>{tx("重试次数", "Retries")}</dt><dd>{step?.retries ?? selection.retries}</dd></dl>
        {selection.runId && <><p className="monitor-meta">{label(observation.connection)}{observation.observedAt && ` · ${new Date(observation.observedAt).toLocaleTimeString(locale)}`}</p><h4>{tx("控制事件", "Control events")}</h4><div className="monitor-events">{observation.events.filter(event => !event.nodeId || event.nodeId === selection.id).map(event => <p key={event.sequence}><time>{new Date(event.at).toLocaleTimeString(locale)}</time> {event.message}</p>)}</div><h4>{tx("产物引用", "Output references")}</h4>{Object.entries(step?.outputs ?? {}).map(([port, artifact]) => <p key={port}><strong>{port}</strong><code>{artifact.uri}</code></p>)}{!Object.keys(step?.outputs ?? {}).length && <p className="monitor-meta">{tx("尚无已确认产物", "No confirmed outputs")}</p>}
          <details><summary>{tx("执行详情", "Execution details")}</summary><pre>{JSON.stringify({ runId: selection.runId, graphRevision: observation.run?.graphRevision, generation: step?.generation, attemptId: step?.attemptId, taskId: step?.taskId, checkpoint: step?.checkpoint, expectedConfig: step?.config, actualConfig: step?.actualConfig }, null, 2)}</pre></details></>}
        {selection.pipelineId === pipeline.id && !selection.removed && <button onClick={() => onLocate(selection.id)}>{tx("定位画布节点", "Locate on canvas")}</button>}
      </> : <p className="monitor-meta">{pinned ? tx("固定的记录已不在当前范围，可取消固定或打开历史。", "The pinned record is outside this scope. Unpin or open history.") : tx("选择节点查看运行详情。", "Select a node to inspect its run.")}</p>}
    </div></div>
  </section>;
}
