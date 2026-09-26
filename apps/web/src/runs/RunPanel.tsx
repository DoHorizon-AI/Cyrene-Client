import { useEffect, useRef, useState } from "react";
import { runCommands, runObservationSchema, type Run } from "../../../../packages/run-control/contracts";
import type { Pipeline } from "../../../../packages/pipeline-model";
import { pipelineClient } from "../pipelines/client";
import { useTeamIdentity } from "../team/TeamGate";
import "./runs.css";

async function execute(name: keyof typeof runCommands, input: unknown, key?: string) {
  const session = await fetch("/studio-runs/v1/session", { signal: AbortSignal.timeout(10000) });
  if (!session.ok) throw new Error("运行控制服务不可用或未登录。");
  const { token } = await session.json();
  const response = await fetch("/studio-runs/v1/commands", { method: "POST", headers: { "content-type": "application/json", "x-studio-control-token": token }, body: JSON.stringify({ name, input, requestId: crypto.randomUUID(), ...(key ? { idempotencyKey: key } : {}) }), signal: AbortSignal.timeout(30000) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "运行操作失败。"); return body.result;
}
export function useRunControl({ document, selectedId, onNotice }: { document: Pipeline; selectedId: string | null; onNotice(message: string): void }) {
  const { workspaceId, actorId, scopes } = useTeamIdentity();
  const canRead = scopes.includes("runs.read"), canWrite = scopes.includes("runs.write");
  const [items, setItems] = useState<Pick<Run, "id" | "state" | "pipelineId">[]>([]), [run, setRun] = useState<Run | null>(null);
  const [preflight, setPreflight] = useState<{ input: any; result: any; document: Pipeline } | null>(null), [preview, setPreview] = useState<{ input: any; result: any } | null>(null);
  const [busy, setBusy] = useState(false), [logs, setLogs] = useState<{ sequence: number; message: string }[]>([]), [servers, setServers] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<{ title: string; result: unknown } | null>(null);
  const [connection, setConnection] = useState("未订阅");
  const alive = useRef(false), live = useRef({ document, selectedId, workspaceId, servers }); live.current = { document, selectedId, workspaceId, servers };
  const keys = useRef(new Map<string, string>());
  const keyFor = (name: string, input: unknown) => { const content = JSON.stringify([name, input]); if (!keys.current.has(content)) keys.current.set(content, crypto.randomUUID()); return keys.current.get(content)!; };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const operation = useRef(false), context = useRef(0);
  useEffect(() => { context.current++; setRun(null); setItems([]); setPreflight(null); setPreview(null); setServers({}); setDetails(null); keys.current.clear(); }, [document.id, workspaceId, actorId]);
  async function perform(action: (current: () => boolean) => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); const sentContext = context.current;
    const current = () => alive.current && sentContext === context.current;
    try { await action(current); } catch (error) { if (current()) onNotice(error instanceof Error ? error.message : String(error)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    if (!run || !canRead) return;
    let active = true, pending = false, cursor = 0;
    setLogs([]);
    setConnection("正在连接");
    const apply = (raw: unknown) => {
      const value = runObservationSchema.parse(raw);
      if (!active || value.run.id !== run.id || value.run.workspaceId !== workspaceId) return;
      setRun(previous => previous?.id === value.run.id && previous.revision <= value.run.revision ? value.run : previous);
      const fresh = value.items.filter(event => event.sequence > cursor);
      cursor = Math.max(cursor, value.cursor);
      setLogs(rows => [...rows, ...fresh].slice(-200));
    };
    let events: EventSource | undefined;
    const connect = () => {
      events?.close();
      if (!navigator.onLine) { setConnection("网络断开，等待重连"); return; }
      events = new EventSource(`/studio-runs/v1/stream?${new URLSearchParams({ workspaceId, runId: run.id, after: String(cursor) })}`);
      events.addEventListener("observation", event => {
        try { apply(JSON.parse((event as MessageEvent).data)); if (active) setConnection("实时订阅中"); }
        catch { if (active) setConnection("事件读取异常，正在核对"); }
      });
      events.onerror = () => { if (active) setConnection("订阅重连中，保留最近状态"); };
    };
    const offline = () => { events?.close(); setConnection("网络断开，等待重连"); };
    window.addEventListener("offline", offline); window.addEventListener("online", connect); connect();
    const poll = async () => {
      if (pending || !navigator.onLine) return; pending = true;
      try {
        apply(await execute("runs.observe", { workspaceId, runId: run.id, after: cursor }));
      } catch { /* Keep last observation and local edits while disconnected. */ }
      finally { pending = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000); return () => { active = false; clearInterval(timer); events?.close(); window.removeEventListener("offline", offline); window.removeEventListener("online", connect); };
  }, [run?.id, workspaceId, actorId, canRead]);
  async function inspectRun() {
    const sent = structuredClone(live.current.document), sentServers = structuredClone(live.current.servers), sentWorkspace = live.current.workspaceId;
    const record = await pipelineClient.execute("pipelines.get", { workspaceId, pipelineId: sent.id });
    if (JSON.stringify(record.document) !== JSON.stringify(sent)) throw new Error("请先将当前图保存到服务端，再预检真实运行。");
    const input = { workspaceId, pipelineId: record.document.id, expectedGraphRevision: record.graphRevision, placements: Object.fromEntries(sent.nodes.filter(n => sentServers[n.id]?.trim()).map(n => {
      const computeId = sent.edges.filter(e => e.to.node === n.id).map(e => e.from.node).find(id => sent.nodes.some(node => node.id === id && node.type === "compute"));
      const compute = sent.nodes.find(node => node.id === computeId);
      return [n.id, { serverId: sentServers[n.id].trim(), acceleratorCount: compute ? Number(compute.config.count) : 1 }];
    })) };
    const result = await execute("runs.preflight", input);
    if (!alive.current || live.current.workspaceId !== sentWorkspace || JSON.stringify(live.current.document) !== JSON.stringify(sent) || JSON.stringify(live.current.servers) !== JSON.stringify(sentServers)) return;
    setPreflight({ input, result, document: sent });
  }
  const preflightAction = <button disabled={busy || !canRead} onClick={() => void perform(inspectRun)}>运行预检</button>;
  const compileAction = <button disabled={busy || !scopes.includes("pipelines.read")} onClick={() => void perform(async current => { const result = await pipelineClient.execute("pipelines.compile", { workspaceId, pipelineId: document.id }); if (current()) setDetails({ title: "已保存图的执行计划", result }); })}>编译服务端执行计划</button>;
  const detailActions = <>{(["runs.attempts", "runs.artifacts"] as const).map((name, i) => <button key={name} disabled={busy || !canRead || !run} onClick={() => { if (run) void perform(async current => { const result = await execute(name, { workspaceId, runId: run.id }); if (current()) setDetails({ title: i === 0 ? "节点执行代次" : "运行制品与检查点", result }); }); }}>{i === 0 ? "查看执行代次" : "查看制品与检查点"}</button>)}</>;
  const observeAction = <button disabled={busy || !canRead || !run} onClick={() => { if (run) void perform(async current => { const result = runObservationSchema.parse(await execute("runs.observe", { workspaceId, runId: run.id })); if (current()) { setRun(previous => previous?.id === result.run.id && previous.revision <= result.run.revision ? result.run : previous); setDetails({ title: "运行状态与事件快照", result }); } }); }}>核对运行状态与事件</button>;
  const listAction = <button disabled={busy || !canRead} onClick={() => void perform(async current => { const result = await execute("runs.list", { workspaceId }); if (current()) setItems(result.items); })}>刷新运行列表</button>;
  const startAction = <button disabled={busy || !canWrite || !preflight || preflight.result.issues.length > 0 || JSON.stringify(document) !== JSON.stringify(preflight.document)} onClick={() => { if (preflight) void perform(async current => { const input = { ...preflight.input, expectedFingerprint: preflight.result.fingerprint }; const result = await execute("runs.start", input, keyFor("start", input)); if (current()) { setRun(result); setItems(rows => [...rows.filter(row => row.id !== result.id), result]); setPreflight(null); } }); }}>启动真实运行</button>;
  const stopAction = <button disabled={busy || !canWrite || !run || ["succeeded", "failed", "stopped", "stopping"].includes(run.state)} onClick={() => { if (run) void perform(async current => { const input = { workspaceId, runId: run.id, expectedRevision: run.revision }; const result = await execute("runs.stop", input, keyFor("stop", input)); if (current()) setRun(result); }); }}>停止此运行</button>;
  const resumeAction = <button disabled={busy || !canWrite || !run || !run.steps.every(s => ["succeeded", "failed", "stopped"].includes(s.state)) || !run.steps.some(s => ["failed", "stopped"].includes(s.state))} onClick={() => { if (run) void perform(async current => { const input = { workspaceId, runId: run.id, expectedRevision: run.revision }; const result = await execute("runs.resume", input, keyFor("resume", input)); if (current()) setRun(result); }); }}>恢复此运行</button>;
  const previewAction = <button disabled={busy || !canRead || !run || !selectedId || document.id !== run.pipelineId} onClick={() => { if (run) void perform(async current => { const node = live.current.document.nodes.find(n => n.id === live.current.selectedId); if (!node) return; const input = { workspaceId, runId: run.id, expectedRevision: run.revision, nodeId: node.id, config: structuredClone(node.config) }; const result = await execute("runs.preview_change", input); if (current() && live.current.selectedId === node.id && JSON.stringify(live.current.document.nodes.find(n => n.id === node.id)?.config) === JSON.stringify(input.config)) setPreview({ input, result }); }); }}>预览选中节点变更</button>;
  const applyAction = <button disabled={busy || !canWrite || !run || !preview || preview.result.mode === "rejected" || run.revision !== preview.input.expectedRevision || run.id !== preview.input.runId || selectedId !== preview.input.nodeId || JSON.stringify(document.nodes.find(n => n.id === preview.input.nodeId)?.config) !== JSON.stringify(preview.input.config)} onClick={() => { if (preview) void perform(async current => { const input = { ...preview.input, expectedFingerprint: preview.result.fingerprint }; const result = await execute("runs.apply_change", input, keyFor("change", input)); if (current()) { setRun(result); setItems(rows => [...rows.filter(row => row.id !== result.id), result]); setPreview(null); } }); }}>应用所示变更</button>;
  const panel = <section aria-label="真实运行管理" className="run-panel">
    <div><strong>分布式运行</strong>{document.nodes.filter(n => !["dataset", "model", "compute"].includes(n.type)).map(node => <label key={node.id}>{node.label}<input aria-label={`${node.label}执行服务器`} placeholder="服务器 ID（留空由资源池选择）" value={servers[node.id] ?? ""} onChange={e => { setServers(values => ({ ...values, [node.id]: e.target.value })); setPreflight(null); }} /></label>)}
      {preflightAction}{listAction}{observeAction}{detailActions}
      <select disabled={busy} aria-label="工作流运行" value={run?.id ?? ""} onChange={e => { const id = e.target.value; if (id) void perform(async current => { const result = await execute("runs.get", { workspaceId, runId: id }); if (current()) { setRun(result); setPreview(null); } }); }}><option value="">选择运行</option>{items.map(item => <option key={item.id} value={item.id}>{item.pipelineId} · {item.state} · {item.id.slice(0, 8)}</option>)}</select>
    </div>
    {preflight && <div><p>{preflight.result.issues.length ? preflight.result.issues.map((i: any) => i.message).join("；") : "预检通过；启动时仍需取得执行资源。"}</p><details><summary>有效服务器与算力配置</summary><pre>{JSON.stringify({ placements: preflight.result.placements, targets: preflight.result.targets }, null, 2)}</pre></details>{startAction}</div>}
    {run && <><p>运行 {run.id.slice(0, 8)} · {run.state} · v{run.revision}{run.parentRunId ? ` · 分支自 ${run.parentRunId.slice(0, 8)}` : ""}</p>
      {stopAction}{resumeAction}{previewAction}
      {preview && <div><p>{preview.result.message} 影响：{preview.result.affected.join(", ")}；可复用：{preview.result.reusable.join(", ") || "无"}</p>{applyAction}</div>}
      <table><thead><tr><th>节点</th><th>状态／服务器</th><th>期望配置</th><th>实际配置</th></tr></thead><tbody>{run.steps.map(step => <tr key={step.nodeId}><td>{step.nodeId}</td><td>{step.state} · {step.serverId ?? "未分配"}<br />{step.message}</td><td><code>{JSON.stringify(step.config)}</code></td><td><code>{JSON.stringify(step.actualConfig)}</code>{step.effectiveStep !== undefined && ` · step ${step.effectiveStep}`}</td></tr>)}</tbody></table>
      <p role="status" aria-label="运行订阅状态">{connection}</p>
      <details><summary>运行事件 · {logs.length}</summary>{logs.map(event => <p key={event.sequence}>{event.sequence} · {event.message}</p>)}</details>
    </>}
    {details && <details open><summary>{details.title}</summary><pre>{JSON.stringify(details.result, null, 2)}</pre></details>}
  </section>;
  return { panel, compileAction, menu: <>{preflightAction}{startAction}<hr />{listAction}{observeAction}{stopAction}{resumeAction}<hr />{previewAction}{applyAction}{detailActions}</> };
}
