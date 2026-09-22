import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Pipeline } from "../../../../packages/pipeline-model";
import type { PipelineRecord } from "../../../../packages/pipeline-control/contracts";
import { mergeSaveAcknowledgement } from "../../../../packages/pipeline-control/merge";
import { pipelineClient as client } from "./client";
import "./pipelines.css";

const graph = ({ presentation: _, ...p }: Pipeline) => p;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
interface Props {
  document: Pipeline; selectedId: string | null; disabled: boolean;
  onApply(p: Pipeline): void; onLoad(p: Pipeline): void; onNotice(message: string): void;
  canUndo: boolean; onUndo(): void;
  render?(parts: { file: ReactNode; edit: ReactNode; toolbar: ReactNode; status: ReactNode; conflict: ReactNode; history: ReactNode }): ReactNode;
}
export function PipelineControls(props: Props) {
  const [base, setBase] = useState<PipelineRecord | null>(null), [remote, setRemote] = useState<PipelineRecord | null>(null);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]), [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false), [summary, setSummary] = useState<string[]>([]);
  const live = useRef(props); live.current = props;
  const mounted = useRef(false), lifetime = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lifetime.current++; }; }, []);
  async function currentResult<T>(operation: Promise<T>): Promise<T> {
    const generation = lifetime.current;
    const result = await operation;
    if (!mounted.current || lifetime.current !== generation) throw new Error("工作台已关闭，忽略旧操作结果。");
    return result;
  }
  const inflight = useRef(false), receipt = useRef<{ payload: string; key: string } | null>(null);
  const keyFor = (data: unknown) => { const payload = JSON.stringify(data); if (receipt.current?.payload !== payload) receipt.current = { payload, key: crypto.randomUUID() }; return receipt.current.key; };
  const dirty = !base || !same(props.document, base.document);
  const locked = props.disabled || busy;
  useEffect(() => {
    if (!base) return;
    let stopped = false, pending = false;
    const poll = async () => {
      if (pending || inflight.current) return;
      pending = true;
      try {
        const result = await client.execute("pipelines.get", { workspaceId: "local", pipelineId: base.document.id });
        if (stopped || inflight.current) return;
        if (result.graphRevision !== base.graphRevision || result.layoutRevision !== base.layoutRevision) {
          if (same(live.current.document, base.document) && !live.current.disabled) {
            setBase(result); setRemote(null); live.current.onLoad(result.document); live.current.onNotice(`已同步 ${result.updatedBy} 的修改：流程 v${result.graphRevision} / 布局 v${result.layoutRevision}`);
          } else setRemote(result);
        }
      } catch { /* Explicit actions report errors; background polling preserves local work. */ }
      finally { pending = false; }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [base]);
  async function run(fn: () => Promise<void>) {
    if (!mounted.current || locked || inflight.current) return;
    const generation = lifetime.current;
    inflight.current = true; setBusy(true);
    try { await fn(); }
    catch (e) { if (mounted.current && lifetime.current === generation) live.current.onNotice(`操作未完成：${e instanceof Error ? e.message : String(e)}`); }
    finally { inflight.current = false; if (mounted.current && lifetime.current === generation) setBusy(false); }
  }
  async function save() {
    const p = structuredClone(live.current.document);
    let result;
    if (!base || base.document.id !== p.id) {
      const input = { workspaceId: "local", document: p };
      result = await currentResult(client.execute("pipelines.create", input, keyFor(["create", input])));
    } else {
      const input = { workspaceId: "local", pipelineId: p.id, expectedGraphRevision: base.graphRevision, expectedLayoutRevision: base.layoutRevision,
        ...(!same(graph(p), graph(base.document)) ? { graph: graph(p) } : {}),
        ...(!same(p.presentation, base.document.presentation) ? { presentation: p.presentation } : {}),
      };
      result = await currentResult(client.execute("pipelines.save", input, keyFor(["save", input])));
    }
    if (live.current.document.id !== p.id) { live.current.onNotice("原流程已保存到服务端；当前已切换流程，未应用旧结果。"); return; }
    if (same(live.current.document, p)) live.current.onLoad(result.record.document);
    else live.current.onApply(mergeSaveAcknowledgement(p, live.current.document, result.record.document));
    setBase(result.record); setRemote(null); setSummary(result.summary);
    live.current.onNotice(`服务端草稿已保存：流程 v${result.record.graphRevision} / 布局 v${result.record.layoutRevision}`);
  }
  async function list() { const result = await currentResult(client.execute("pipelines.list", { workspaceId: "local" })); setItems(result.items); live.current.onNotice(result.items.length ? "请选择服务端流程，再点击载入。" : "服务端暂无流程，可先保存当前草稿。"); }
  async function load() {
    const sent = structuredClone(live.current.document);
    const result = await currentResult(client.execute("pipelines.get", { workspaceId: "local", pipelineId: chosen }));
    if (!same(live.current.document, sent) || live.current.disabled) throw new Error("载入期间画布已修改或开始预演，旧结果未应用，请重试。");
    if ((!base || !same(live.current.document, base.document)) && !window.confirm("载入服务端流程会替换当前画布，是否继续？")) return;
    live.current.onLoad(result.document); setBase(result); setRemote(null); setSummary([]); live.current.onNotice("已载入服务端流水线，后续 AI 修改会在无本地变更时自动同步。");
  }
  async function layout(partial: boolean) {
    const p = structuredClone(live.current.document);
    const result = await currentResult(client.execute("pipelines.preview_layout", { workspaceId: "local", document: p, options: { direction: "RIGHT", ...(partial && props.selectedId ? { nodeIds: [props.selectedId] } : {}) } }));
    if (!same(live.current.document, p) || live.current.disabled) throw new Error("排版期间画布已修改或开始预演，旧结果未应用，请重试。");
    live.current.onApply(result.document); live.current.onNotice("排版已应用到本地画布，可撤销；保存到服务端后 AI 可读取新布局。");
  }
  function pin() {
    const id = props.selectedId; if (!id) return;
    const p = structuredClone(live.current.document); p.presentation.nodes[id].pinned = !p.presentation.nodes[id].pinned;
    live.current.onApply(p);
  }
  async function undoRemote() {
    if (!base) return;
    const sent = structuredClone(live.current.document);
    const input = { workspaceId: "local", pipelineId: base.document.id, expectedGraphRevision: base.graphRevision, expectedLayoutRevision: base.layoutRevision };
    const result = await currentResult(client.execute("pipelines.undo", input, keyFor(["undo", input])));
    if (live.current.document.id !== sent.id) { live.current.onNotice("原流程已在服务端撤销；当前已切换流程，未应用旧结果。"); return; }
    setBase(result.record); setSummary(result.summary);
    if (same(live.current.document, sent)) live.current.onLoad(result.record.document);
    else { setRemote(result.record); live.current.onNotice("服务端已撤销；操作期间的新本地修改已保留，可先导出备份后载入服务端版本。"); return; }
    live.current.onNotice("已撤销服务端最新一批修改，修订号保持递增。");
  }
  async function history() { if (base) { const result = await currentResult(client.execute("pipelines.history", { workspaceId: "local", pipelineId: base.document.id })); setSummary(result.items.slice(-5).flatMap(e => [`${e.actorId} · ${e.command} · v${e.graphRevision}/${e.layoutRevision}`, ...e.summary])); } }
  const status = <span>{base ? `服务端 v${base.graphRevision} / 布局 v${base.layoutRevision}${dirty ? " · 本地有修改" : " · 已同步"}` : "尚未保存到服务端"}</span>;
  const toolbar = <><button disabled={locked} onClick={() => void run(save)}>保存到服务端</button><button disabled={locked} onClick={() => void run(() => layout(false))}>自动排版</button></>;
  const file = <div className="keep-menu-open"><button disabled={locked} onClick={() => void run(list)}>读取流程列表</button>
      {items.length > 0 && <><select aria-label="服务端流程" value={chosen} disabled={locked} onChange={e => setChosen(e.target.value)}><option value="">选择流程</option>{items.map(i => <option key={i.id} value={i.id}>{i.name} · {i.id}</option>)}</select><button disabled={locked || !chosen} onClick={() => void run(load)}>载入服务端流程</button></>}
    </div>;
  const edit = <><button disabled={locked || !props.selectedId} onClick={() => void run(() => layout(true))}>整理选中节点</button><button disabled={locked || !props.selectedId} onClick={pin}>{props.selectedId && props.document.presentation.nodes[props.selectedId]?.pinned ? "解锁节点位置" : "锁定节点位置"}</button><button disabled={locked || !props.canUndo} onClick={props.onUndo}>撤销本地修改</button><button disabled={locked || !base || dirty} onClick={() => void run(undoRemote)}>撤销服务端修改</button></>;
  const conflict = remote && <div className="pipeline-conflict" role="status">服务端已有新版本 v{remote.graphRevision}/{remote.layoutRevision}，本地修改已保留。<button disabled={locked} onClick={() => { if (window.confirm("用服务端版本替换当前未保存修改？")) { setBase(remote); live.current.onLoad(remote.document); setRemote(null); } }}>载入新版本</button><span>可先导出 JSON 备份；提交同一文档域的旧版本会被拒绝。</span></div>;
  const historyPanel = <div className="keep-menu-open"><button disabled={locked || !base} onClick={() => void run(history)}>变更记录</button>{!!summary.length && <details className="pipeline-changes"><summary>最近变更 · {summary.length} 条</summary>{summary.map((s, i) => <p key={i}>{s}</p>)}</details>}</div>;
  return props.render ? props.render({ file, edit, toolbar, status, conflict, history: historyPanel }) : <section className="pipeline-controls" aria-label="流程版本与排版"><div className="pipeline-control-row">{status}{toolbar}{file}</div><div className="pipeline-control-row">{edit}{historyPanel}</div>{conflict}</section>;
}
