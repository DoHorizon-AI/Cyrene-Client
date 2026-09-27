import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { serverSpec, type ResolvedServer, type Observation, type ServerRecord, type ServerSpec, type auditEvent } from "../../../../packages/server-control/contracts";
import type { PipelineNode } from "../../../../packages/pipeline-model";
import { serverClient } from "./client";
import { useTeamIdentity } from "../team/TeamGate";
import "./servers.css";

const attachmentLabels = { HOST_AGENT: "自管服务器", CONTAINER_AGENT: "容器算力", PROVIDER_MANAGED: "云平台托管" };
const emptySpec: ServerSpec = { name: "", attachment: "HOST_AGENT", provider: "self-managed", region: "", connectionRef: "" };
const errorMessage = (e: unknown) => e instanceof z.ZodError ? "请填写名称、提供方和有效连接标识（字母、数字、下划线或横线）。" : e instanceof Error ? e.message : "操作失败。";

export function ServerManager() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <button className="connection-toggle" onClick={() => { setOpen(true); dialog.current?.showModal(); }}>服务器管理</button>
    <dialog className="server-dialog" ref={dialog} onClose={() => setOpen(false)}>
      <div className="server-heading"><div><span className="eyebrow">INFRASTRUCTURE / LOCAL WORKSPACE</span><h2>服务器与云算力</h2></div><button aria-label="关闭服务器管理" onClick={() => dialog.current?.close()}>关闭</button></div>
      {open && <ServerManagerBody />}
    </dialog>
  </>;
}

export function ServerManagerBody() {
  const { workspaceId, scopes } = useTeamIdentity();
  const canWrite = scopes.includes("servers.write");
  const [resolved, setResolved] = useState<ResolvedServer | null>(null);
  const [items, setItems] = useState<ServerRecord[]>([]), [selected, setSelected] = useState<ServerRecord | null>(null);
  const [spec, setSpec] = useState<ServerSpec>({ ...emptySpec }), [filter, setFilter] = useState("");
  const [events, setEvents] = useState<z.infer<typeof auditEvent>[]>([]), [status, setStatus] = useState<Observation | null>(null);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const mounted = useRef(false), generation = useRef(0), inflight = useRef(false);
  const receipt = useRef<{ fingerprint: string; key: string } | null>(null);
  const keyFor = (payload: unknown) => {
    const fingerprint = JSON.stringify(payload);
    if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, key: crypto.randomUUID() };
    return receipt.current.key;
  };
  async function reload() {
    const [list, history] = await Promise.all([
      serverClient.execute("servers.list", { workspaceId }),
      serverClient.execute("servers.events", { workspaceId, after: 0 }),
    ]);
    if (!mounted.current) return;
    setItems(list.items); setEvents(history.items); setReady(true);
  }
  async function run(fn: () => Promise<void>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); setMessage("");
    try { await fn(); } catch (e) { if (mounted.current) setMessage(errorMessage(e)); }
    finally { inflight.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; void run(reload); return () => { mounted.current = false; generation.current++; }; }, []);
  function choose(item: ServerRecord | null) {
    generation.current++; setSelected(item); setSpec(item ? serverSpec.parse(itemSpec(item)) : { ...emptySpec }); setStatus(null); setResolved(null); setMessage("");
  }
  async function save() {
    const input = { workspaceId, spec: serverSpec.parse(spec) };
    const target = selected ? { ...input, serverId: selected.id, expectedRevision: selected.revision } : input;
    const result = selected ? await serverClient.execute("servers.update", target as typeof input & { serverId: string; expectedRevision: number }, keyFor(["update", target])) : await serverClient.execute("servers.register", input, keyFor(["register", input]));
    if (!mounted.current) return;
    choose(result); setMessage("登记已保存。连接适配器接入后才能获取实时状态和申请算力。"); await reload();
  }
  async function archive() {
    if (!selected) return;
    const input = { workspaceId, serverId: selected.id, expectedRevision: selected.revision };
    const result = await serverClient.execute("servers.archive", input, keyFor(["archive", input]));
    if (!mounted.current) return;
    choose(result); setMessage("登记已归档；目标服务器及其运行任务未被修改。"); await reload();
  }
  async function readStatus() {
    if (!selected) return;
    const version = generation.current;
    const result = await serverClient.execute("servers.status", { workspaceId, serverId: selected.id });
    if (mounted.current && generation.current === version) setStatus(result);
  }
  async function resolveTarget() {
    if (!selected) return;
    const version = generation.current; setResolved(null);
    const result = await serverClient.execute("servers.resolve", { workspaceId, serverId: selected.id });
    if (mounted.current && generation.current === version) setResolved(result);
  }
  const visible = items.filter(s => `${s.name} ${s.provider} ${s.region}`.toLowerCase().includes(filter.toLowerCase()));
  const locked = busy || !ready || !!selected?.archived || !canWrite;
  return <>
    <p className="server-intro">集中登记自管服务器、容器算力和云平台资源。连接状态来自控制服务，资源登记不会分配 GPU。</p>
    <div className="server-summary"><span><b>{items.filter(s => !s.archived).length}</b> 有效登记</span><span>本地登记库 · 状态按需查询</span><button disabled={busy} onClick={() => void run(reload)}>刷新登记</button></div>
    <div className="server-layout">
      <section className="server-list" aria-label="服务器列表"><input aria-label="筛选服务器" placeholder="按名称、提供方、区域筛选" value={filter} onChange={e => setFilter(e.target.value)} /><button className="primary" disabled={busy || !ready} onClick={() => choose(null)}>新增服务器登记</button>
        {!visible.length && <p>{ready ? "还没有匹配的服务器登记。" : "正在读取登记库…"}</p>}
        {visible.map(item => <button className={`server-card ${selected?.id === item.id ? "selected" : ""}`} disabled={busy} key={item.id} onClick={() => choose(item)}><strong>{item.name}</strong><span>{attachmentLabels[item.attachment]} · {item.provider}</span><small>{item.archived ? "已归档" : "已登记 · 连接待核实"} / {item.region || "未指定区域"}</small></button>)}
      </section>
      <section className="server-detail" aria-label="服务器详情">
        <h3>{selected ? "编辑服务器登记" : "新增服务器登记"}</h3>
        {selected && <p className="server-id">登记 ID：{selected.id} · 修订 {selected.revision}</p>}
        <form onSubmit={e => { e.preventDefault(); void run(save); }}>
          <fieldset disabled={locked}>
            <label className="field"><span>服务器名称</span><input required maxLength={100} value={spec.name} onChange={e => setSpec({ ...spec, name: e.target.value })} /></label>
            <label className="field"><span>接入方式</span><select value={spec.attachment} onChange={e => setSpec({ ...spec, attachment: e.target.value as ServerSpec["attachment"] })}>{Object.entries(attachmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className="server-fields"><label className="field"><span>提供方</span><input required maxLength={100} value={spec.provider} onChange={e => setSpec({ ...spec, provider: e.target.value })} /></label><label className="field"><span>区域</span><input maxLength={100} value={spec.region} onChange={e => setSpec({ ...spec, region: e.target.value })} /></label></div>
            <label className="field"><span>连接标识</span><input required pattern="[A-Za-z0-9_-]{1,100}" maxLength={100} placeholder="例如 office-gpu-01" value={spec.connectionRef} onChange={e => setSpec({ ...spec, connectionRef: e.target.value })} /><small>引用控制服务中的连接配置；此处不填写地址、密码或密钥。</small></label>
            <button className="primary" type="submit">保存服务器登记</button>
          </fieldset>
        </form>
        {selected && <div className="server-actions"><button disabled={busy} onClick={() => void run(readStatus)}>查询连接状态</button><button disabled={busy || selected.archived} onClick={() => void run(resolveTarget)}>核对执行身份</button><button disabled={locked} onClick={() => void run(archive)}>归档登记</button></div>}
        {resolved && <p role="status">已核对登记 v{resolved.revision} · 节点 {resolved.nodeRef.nodeId} · 代次 {resolved.nodeRef.epoch}。启动任务时仍需取得资源租约。</p>}
        {status && <div className="server-observation" role="status"><strong>{({ UNCONNECTED: "未连接", ONLINE: "在线", OFFLINE: "离线", STALE: "观测已过期" })[status.state]}</strong><p>{status.message}</p><small>{status.observedAt ? `观测时间：${status.observedAt}` : "尚无观测时间"}</small></div>}
        <div className="server-guidance"><strong>目标服务器组件</strong><p>{spec.attachment === "HOST_AGENT" ? "使用 Platform 的 cy-node-agent，主动建立 mTLS 连接，桥接本机 Kernel。" : spec.attachment === "CONTAINER_AGENT" ? "使用 Platform 的 cy-runtime-agent，适合没有 root、systemd 或入站端口的容器算力。" : "通过云提供方适配器接入，凭据保存在控制服务端。"}</p><small>当前版本完成资源登记；目标端安装、心跳、GPU 监控与云平台操作尚未接通。</small></div>
      </section>
    </div>
    {message && <p className="server-message" role="status">{message}</p>}
    <details className="server-events"><summary>登记操作记录（最多前 100 条；完整记录保存在本地登记库）</summary>{events.length ? [...events].reverse().map(e => <p key={e.sequence}>#{e.sequence} · {e.command} · {e.actorId} · {e.serverId} · 修订 {e.revision}</p>) : <p>暂无登记操作。</p>}</details>
  </>;
}
function itemSpec(item: ServerRecord): ServerSpec { return { name: item.name, attachment: item.attachment, provider: item.provider, region: item.region, connectionRef: item.connectionRef }; }

export function ComputeTargetSettings({ node, disabled, onUpdate }: { node: PipelineNode; disabled: boolean; onUpdate(node: PipelineNode): void }) {
  const [items, setItems] = useState<ServerRecord[]>([]), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function load() {
    setBusy(true); setMessage("");
    try { const result = await serverClient.execute("servers.list", { workspaceId: "local" }); if (mounted.current) { setItems(result.items.filter(s => !s.archived)); setMessage(result.items.some(s => !s.archived) ? "选择目标只保存算力意向，不代表已获得资源租约。" : "请先在服务器管理中添加登记。"); } }
    catch (e) { if (mounted.current) setMessage(errorMessage(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="service-settings" aria-label="服务器目标"><div className="settings-heading"><strong>目标服务器</strong><span>算力意向</span></div><p>从服务器管理中选择目标；实际执行前仍需解析连接、校验节点身份并获取租约。</p><button disabled={disabled || busy} onClick={() => void load()}>读取服务器登记</button>
    {items.length > 0 && <label className="field"><span>选择目标服务器</span><select disabled={disabled || busy} value={node.settingsBinding?.kind === "server-registration" ? node.settingsBinding.resourceId : ""} onChange={e => {
      const item = items.find(s => s.id === e.target.value); if (!item) return;
      onUpdate({ ...node, settingsBinding: { kind: "server-registration", resourceId: item.id, workspaceId: item.workspaceId } });
    }}><option value="">请选择已登记服务器</option>{items.map(s => <option key={s.id} value={s.id}>{s.name} · {attachmentLabels[s.attachment]}</option>)}</select></label>}
    {node.settingsBinding?.kind === "server-registration" && <p>已选登记：{node.settingsBinding.resourceId}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
