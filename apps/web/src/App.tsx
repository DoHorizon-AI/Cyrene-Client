import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { catalog, definitions } from "../../../packages/pipeline-model/catalog";
import { examplePipeline, inspect, parsePipeline, type Pipeline, type PipelineNode } from "../../../packages/pipeline-model";
import { GraphCanvas, type GraphHandle } from "./graph/GraphCanvas";
import { SettingsClient } from "./services/client";
import { ConnectionPanel } from "./services/ConnectionPanel";
import { NodeServiceSettings } from "./services/NodeServiceSettings";
import type { HostStatus } from "../../../packages/service-settings/contracts";
import { ServerManagerBody, ComputeTargetSettings } from "./servers/ServerManager";
import { PipelineControls } from "./pipelines/PipelineControls";

import { Icon, Menu, ResizeHandle, useIdeLayout } from "./ide/Chrome";
import { FilePanel, AssistantPanel, PluginPanel } from "./ide/Panels";

const STORAGE_KEY = "cyrene.studio.prototype.v1.draft";
const MAX_FILE_BYTES = 1024 * 1024;
type Tab = "checks" | "preview" | "log";

export function App() {
  const { layout, setLayout, left, right, reset } = useIdeLayout();
  const [serverVisited, setServerVisited] = useState(false);
  const [editorTab, setEditorTab] = useState<"graph" | "source" | "file">("graph");
  const [filePreview, setFilePreview] = useState<{ name: string; text: string } | null>(null);
  const [events, setEvents] = useState<{ time: string; message: string }[]>([]);
  const [settingsClient] = useState(() => new SettingsClient());
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(null);
  const [initial] = useState(examplePipeline);
  const [pipeline, setPipeline] = useState(initial);
  const currentDocument = useRef(initial), history = useRef<Pipeline[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>("training");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("示例已就绪。连接端口、调整参数，然后校验流程。");
  const [tab, setTab] = useState<Tab>("checks");
  const [plan, setPlan] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedDraft, setSavedDraft] = useState(false);
  const editor = useRef<GraphHandle>(null), fileInput = useRef<HTMLInputElement>(null);
  const validation = useMemo(() => inspect(pipeline), [pipeline]);
  const selected = pipeline.nodes.find((n) => n.id === selectedId);
  const selectedDefinition = selected && definitions.get(selected.type);
  const groups = [...new Set(catalog.map((d) => d.category))];

  useEffect(() => {
    setEvents(previous => previous.at(-1)?.message === notice ? previous : [...previous.slice(-99), { time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), message: notice }]);
  }, [notice]);
  useEffect(() => { if (layout.left === "servers") setServerVisited(true); }, [layout.left]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!running) save(); }
      if (e.altKey && ["1", "2", "3", "0", "9"].includes(e.key)) {
        e.preventDefault();
        if (e.key === "1") left("files"); if (e.key === "2") left("nodes"); if (e.key === "3") left("servers"); if (e.key === "0") right("info");
        if (e.key === "9") setLayout(s => ({ ...s, bottom: !s.bottom }));
      }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    try { setSavedDraft(localStorage.getItem(STORAGE_KEY) !== null); }
    catch { setNotice("浏览器存储不可用；仍可使用 JSON 导出保存。"); }
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!running) return;
    if (cursor >= plan.length) { setRunning(false); setNotice("本地预演完成：已遍历依赖顺序，未执行训练、评估或部署。"); return; }
    const timer = window.setTimeout(() => setCursor((c) => c + 1), 450);
    return () => window.clearTimeout(timer);
  }, [running, cursor, plan.length]);

  function changed(p: Pipeline) {
    recordChange({ ...p, name: currentDocument.current.name });
  }
  function recordChange(p: Pipeline) {
    if (JSON.stringify(currentDocument.current) === JSON.stringify(p)) return;
    history.current = [...history.current.slice(-49), structuredClone(currentDocument.current)]; setUndoCount(history.current.length);
    currentDocument.current = p; setPipeline(p); setDirty(true); setRunning(false); setPlan([]); setCursor(0);
  }
  function applyDocument(p: Pipeline) {
    editor.current!.load(p, { silent: true }); recordChange(p);
    if (selectedId && p.nodes.some(n => n.id === selectedId)) editor.current!.select(selectedId);
  }
  function loadServerDocument(p: Pipeline) {
    editor.current!.load(p, { silent: true, fit: false }); currentDocument.current = p; setPipeline(p);
    history.current = []; setUndoCount(0); setDirty(false); setRunning(false); setPlan([]); setCursor(0);
    if (selectedId && p.nodes.some(n => n.id === selectedId)) editor.current!.select(selectedId);
  }
  function undoLocal() {
    const p = history.current.pop(); if (!p) return;
    editor.current!.load(p, { silent: true }); currentDocument.current = p; setPipeline(p); setDirty(true); setUndoCount(history.current.length);
    setRunning(false); setPlan([]); setCursor(0); setNotice("已撤销本地修改；服务端版本尚未改变。");
    if (selectedId && p.nodes.some(n => n.id === selectedId)) editor.current!.select(selectedId);
  }
  function snapshot() { return { ...editor.current!.snapshot(), name: pipeline.name }; }
  function error(e: unknown) { setNotice(`操作未完成：${e instanceof Error ? e.message : String(e)}`); }
  function replace(p: Pipeline, message: string) {
    if (dirty && !window.confirm("当前流程有未保存修改，是否替换？")) return;
    applyDocument(p); setSelectedId(null); setRunning(false); setPlan([]); setCursor(0); setEditorTab("graph");
    setNotice(message);
  }
  function save() {
    try {
      const p = parsePipeline(snapshot()); localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      setSavedDraft(true); setDirty(false); setNotice("草稿已保存到此浏览器。可导出 JSON 另存备份。");
    } catch (e) { error(e); }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error("没有本地草稿。");
      replace(parsePipeline(JSON.parse(raw)), "已载入本地草稿。");
    } catch (e) { error(e); }
  }
  function exportJson() {
    try {
      const p = parsePipeline(snapshot());
      const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = `${p.id}.json`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("已导出流程定义与布局。运行预演记录不会写入文件。");
    } catch (e) { error(e); }
  }
  async function importJson(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("文件不能超过 1 MB。");
      const p = parsePipeline(JSON.parse(await file.text())); replace(p, "已导入流程。请校验连接与参数后预演。");
    } catch (e) { error(e); }
    finally { if (fileInput.current) fileInput.current.value = ""; }
  }
  function preview() {
    setLayout(s => ({ ...s, bottom: true })); setEditorTab("graph");
    const p = snapshot(), check = inspect(p);
    if (check.issues.length) { setTab("checks"); setNotice(`校验发现 ${check.issues.length} 个问题，修正后可预演。`); return; }
    setPlan(check.order); setCursor(0); setRunning(true); setTab("preview");
    setNotice("正在本地预演依赖顺序。不会访问训练服务或创建云资源。");
  }
  function updateNode(n: PipelineNode) { editor.current!.update(n); }

  function showChecks() { setTab("checks"); setLayout(s => ({ ...s, bottom: true })); }
  function focusNode(id: string | null) { setSelectedId(id); if (id && !layout.right) setLayout(s => ({ ...s, right: "info", ...(innerWidth < 1000 ? { left: null } : {}) })); }
  const panelTitle = layout.left === "files" ? "项目文件" : layout.left === "servers" ? "服务器管理" : "节点库";
  const rightTitle = layout.right === "assistant" ? "平台 MCP" : layout.right === "plugins" ? "页面插件" : "节点信息";
  const css = { "--left-width": `${layout.leftWidth}px`, "--right-width": `${layout.rightWidth}px`, "--bottom-height": `${layout.bottomHeight}px` } as CSSProperties;
  return <div className={`studio ide-studio ${layout.left ? "has-left" : ""} ${layout.right ? "has-right" : ""}`} style={css}>
    <PipelineControls document={pipeline} selectedId={selectedId} disabled={running} onApply={applyDocument} onLoad={loadServerDocument} onNotice={setNotice} canUndo={undoCount > 0} onUndo={undoLocal} render={controls => <>
      <header className="ide-titlebar">
        <div className="ide-brand" aria-label="Cyrene Studio">C<span>↗</span></div>
        <nav className="ide-menubar" aria-label="主菜单">
          <Menu label="文件"><button aria-label="保存草稿" disabled={running} onClick={save}>保存草稿 <kbd>Ctrl S</kbd></button><button disabled={!savedDraft || running} onClick={restore}>载入草稿</button><button disabled={running} onClick={() => fileInput.current?.click()}>导入 JSON</button><button disabled={running} onClick={exportJson}>导出 JSON</button><hr />{controls.file}</Menu>
          <Menu label="编辑">{controls.edit}</Menu>
          <Menu label="视图"><button onClick={() => left("files")}>项目文件 <kbd>Alt 1</kbd></button><button onClick={() => left("nodes")}>节点库 <kbd>Alt 2</kbd></button><button onClick={() => left("servers")}>服务器管理 <kbd>Alt 3</kbd></button><hr /><button onClick={() => right("info")}>节点信息</button><button onClick={() => right("plugins")}>页面插件</button><button onClick={() => right("assistant")}>平台 MCP</button><button onClick={() => setLayout(s => ({ ...s, bottom: !s.bottom }))}>切换底部工具窗口 <kbd>Alt 9</kbd></button><hr /><button onClick={reset}>恢复默认布局</button></Menu>
          <Menu label="流程"><button disabled={running} onClick={() => { showChecks(); setNotice(validation.issues.length ? `发现 ${validation.issues.length} 个问题。` : "结构校验通过；真实资源可用性与业务门禁尚未验证。"); }}>校验流程</button><button disabled={running} onClick={() => replace(examplePipeline(), "已载入训练示例。")}>训练示例</button>{controls.history}</Menu>
          <Menu label="工具"><button onClick={() => { setTab("log"); setLayout(s => ({ ...s, bottom: true })); }}>事件日志</button><button onClick={() => { setEditorTab("source"); }}>查看流程 JSON</button><button onClick={() => right("assistant")}>MCP 工具与上下文</button></Menu>
        </nav>
        <div className="ide-project-title">Cyrene Studio <span> / </span> <b>Local Workspace</b></div>
        <div className="ide-window-meta"><span className="ide-status-dot" /> 本地工作空间</div>
      </header>
      <div className="ide-main-toolbar"><div className="ide-document-name"><Icon name="nodes" /><input aria-label="流水线名称" maxLength={100} value={pipeline.name} disabled={running} onChange={e => recordChange({ ...pipeline, name: e.target.value })} /><span className="ide-dirty" title={dirty ? "本地有未保存修改" : "草稿"}>{dirty ? "●" : ""}</span></div><span className="ide-version">{controls.status}</span><div className="ide-toolbar-actions">{controls.toolbar}<button className="ide-run" onClick={preview} disabled={running}><Icon name="play" />本地预演</button><ConnectionPanel client={settingsClient} status={hostStatus} onConnected={setHostStatus} /></div></div>
      {controls.conflict}
    </>} />

    <div className="ide-body">
      <nav className="ide-rail ide-rail-left" aria-label="左侧工具栏">
        <button className={layout.left === "files" ? "active" : ""} aria-label="项目文件" aria-pressed={layout.left === "files"} title="项目文件 · Alt 1" onClick={() => left("files")}><Icon name="files" /></button>
        <button className={layout.left === "nodes" ? "active" : ""} aria-label="节点库" aria-pressed={layout.left === "nodes"} title="节点库 · Alt 2" onClick={() => left("nodes")}><Icon name="nodes" /></button>
        <button className={layout.left === "servers" ? "active" : ""} aria-label="服务器管理" aria-pressed={layout.left === "servers"} title="服务器管理 · Alt 3" onClick={() => left("servers")}><Icon name="servers" /></button>
        <div className="ide-rail-spacer" /><button aria-label="显示事件日志" title="事件日志" onClick={() => { setTab("log"); setLayout(s => ({ ...s, bottom: true })); }}><Icon name="log" /></button>
      </nav>
      <aside className="ide-dock ide-left-dock" hidden={!layout.left} aria-label={`${panelTitle}面板`}>
        <div className="ide-dock-heading"><strong>{panelTitle}</strong><span>⌄</span><button aria-label={layout.left === "servers" ? "关闭服务器管理" : "收起左侧窗口"} onClick={() => setLayout(s => ({ ...s, left: null }))}><Icon name="close" /></button></div>
        <div className="ide-dock-content">
          <div hidden={layout.left !== "files"}><FilePanel document={pipeline} disabled={running} onImport={file => void importJson(file)} onSource={() => setEditorTab("source")} onPreview={(name, text) => { setFilePreview({ name, text }); setEditorTab("file"); }} onNotice={setNotice} /></div>
          <div className="palette" hidden={layout.left !== "nodes"}>
        <div className="panel-heading"><strong>节点库</strong><span>{catalog.length} 个模块</span></div>
        <input className="search" aria-label="搜索节点" placeholder="搜索节点或服务…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="catalog">{groups.map((group) => {
          const items = catalog.filter((d) => d.category === group && `${d.title} ${d.owner}`.toLowerCase().includes(query.toLowerCase()));
          return items.length ? <section key={group}><h3>{group}</h3>{items.map((d) => <button className="node-option" key={d.type} disabled={running || pipeline.nodes.length >= 200} onClick={() => editor.current!.add(d.type)} title={d.description} aria-label={`添加${d.title}`}><span className="node-symbol" style={{ color: d.color }}>{({ dataset: "▤", model: "◇", compute: "▥", training: "⌘", evaluation: "◈", deployment: "↗", agent: "✧" })[d.type]}</span><span><strong>{d.title}</strong><small>{d.owner}</small></span><span className="add-symbol">+</span></button>)}</section> : null;
        })}</div>
        <div className="palette-note"><span>01 — EXPERIMENT</span><p>点击添加节点<br />拖动端口连接步骤</p></div>

          </div>
          <div className="ide-server-panel" hidden={layout.left !== "servers"}>{serverVisited && <ServerManagerBody />}</div>
        </div>
        <ResizeHandle orientation="vertical" value={layout.leftWidth} min={210} max={480} label="调整左侧窗口宽度" onChange={v => setLayout(s => ({ ...s, leftWidth: v }))} />
      </aside>

      <main className="ide-center editor-column" aria-label="流水线编辑器">
        <div className="ide-editor-tabs" role="tablist" aria-label="编辑器页面"><button role="tab" aria-selected={editorTab === "graph"} className={editorTab === "graph" ? "active" : ""} onClick={() => setEditorTab("graph")}><Icon name="nodes" />{pipeline.id}.pipeline <span>{dirty ? "●" : ""}</span></button><button role="tab" aria-selected={editorTab === "source"} className={editorTab === "source" ? "active" : ""} onClick={() => setEditorTab("source")}><Icon name="files" />JSON</button>{filePreview && <button role="tab" aria-selected={editorTab === "file"} className={editorTab === "file" ? "active" : ""} onClick={() => setEditorTab("file")}><Icon name="files" />{filePreview.name.split("/").at(-1)}</button>}</div>
        <div className="canvas-toolbar"><span>工作空间 <span className="ide-breadcrumb-sep">›</span> 流水线 <small>{pipeline.nodes.length} 节点 · {pipeline.edges.length} 连接</small></span><button onClick={() => editor.current!.fit()}>适应画布</button></div>
        <div className={`canvas-area ${running ? "locked" : ""}`}>
          <GraphCanvas ref={editor} initial={initial} interactive={editorTab === "graph" && !running} onChange={changed} onSelect={focusNode} />
          {editorTab === "graph" && <><div className="canvas-hint">拖动平移 <span>·</span> 滚轮缩放 <span>·</span> Delete 删除节点</div>{running && <div className="canvas-lock">正在预演 · 画布暂时锁定</div>}</>}
          {editorTab !== "graph" && <div className="ide-source-view"><div>{editorTab === "source" ? `${pipeline.id}.json · 当前草稿` : filePreview?.name}<span>只读预览</span></div><pre tabIndex={0} aria-label="文件内容预览">{editorTab === "source" ? JSON.stringify(pipeline, null, 2) : filePreview?.text}</pre></div>}
        </div>
        <section className="bottom-panel" hidden={!layout.bottom} aria-label="底部工具窗口">
          <ResizeHandle orientation="horizontal" value={layout.bottomHeight} min={100} max={400} sign={-1} label="调整底部窗口高度" onChange={v => setLayout(s => ({ ...s, bottomHeight: v }))} />
          <div className="bottom-tabs"><button className={tab === "checks" ? "active" : ""} onClick={() => setTab("checks")}><Icon name="check" />流程检查 <span>{validation.issues.length}</span></button><button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}><Icon name="play" />运行预演</button><button className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}><Icon name="log" />事件日志</button><button className="ide-bottom-close" aria-label="收起底部窗口" onClick={() => setLayout(s => ({ ...s, bottom: false }))}><Icon name="close" /></button></div>
          <div hidden={tab === "log"}>
          {tab === "checks" ? <div className="check-content">{validation.issues.length ? <ul className="issues">{validation.issues.map((i, index) => <li key={`${i.code}-${index}`}><button onClick={() => i.nodeId && editor.current!.select(i.nodeId)}>! {i.message}</button></li>)}</ul> : <div className="check-pass"><span>✓</span><div><strong>结构检查通过</strong><p>端口类型、必填参数与依赖顺序有效。服务连接、资源可用性及评估门禁尚未验证。</p></div></div>}</div> : <div className="preview-content"><div className="preview-heading"><span>{running ? "依赖顺序预演中" : plan.length ? `已预演 ${cursor} / ${plan.length} 步` : "尚未开始预演"}</span>{running && <button onClick={() => { setRunning(false); setNotice("预演已停止，未执行外部操作。"); }}>停止预演</button>}</div><div className="run-steps">{plan.map((id, index) => <span className={`run-step ${index < cursor ? "done" : index === cursor && running ? "current" : ""}`} key={id}>{index < cursor ? "✓" : String(index + 1).padStart(2, "0")} {pipeline.nodes.find((n) => n.id === id)?.label}</span>)}</div><p>这里只模拟步骤顺序，不生成模型、评估指标或真实端点。</p></div>}
          </div>
          <div className="ide-event-log" hidden={tab !== "log"}>{events.map((e, i) => <div key={i}><time>{e.time}</time><span>INFO</span><p>{e.message}</p></div>)}</div>
        </section>
      </main>

      <aside className="ide-dock ide-right-dock" hidden={!layout.right} aria-label={`${rightTitle}面板`}>
        <ResizeHandle orientation="vertical" value={layout.rightWidth} min={260} max={520} sign={-1} label="调整右侧窗口宽度" onChange={v => setLayout(s => ({ ...s, rightWidth: v }))} />
        <div className="ide-dock-heading"><strong>{rightTitle}</strong><span>{layout.right === "assistant" ? "✧" : ""}</span><button aria-label="收起右侧窗口" onClick={() => setLayout(s => ({ ...s, right: null }))}><Icon name="close" /></button></div>
        <div className="ide-dock-content">
          <div className="inspector" hidden={layout.right !== "info"}>
        <div className="panel-heading"><strong>节点配置</strong><span>{selectedDefinition?.owner ?? "请选择节点"}</span></div>
        {selected && selectedDefinition ? <div className="inspector-content"><div className="inspector-icon" style={{ color: selectedDefinition.color }}>◇</div><h2>{selected.label}</h2><p className="description">{selectedDefinition.description}</p><div className="divider" />
          {selected.type === "compute" && <ComputeTargetSettings key={`server-${selected.id}`} node={selected} disabled={running} onUpdate={updateNode} />}
          <NodeServiceSettings key={selected.id} node={selected} client={settingsClient} status={hostStatus} disabled={running} onUpdate={updateNode} />
          <label className="field"><span>节点名称</span><input maxLength={80} value={selected.label} disabled={running} onChange={(e) => updateNode({ ...selected, label: e.target.value })} /></label>
          {selectedDefinition.fields.map((field) => <label className="field" key={field.name}><span>{field.label}</span>{field.kind === "select" ? <select value={selected.config[field.name] ?? ""} disabled={running} onChange={(e) => updateNode({ ...selected, config: { ...selected.config, [field.name]: e.target.value } })}>{!selected.config[field.name] && <option value="">请选择</option>}{field.choices!.map((c) => <option key={c}>{c}</option>)}</select> : <input type={field.kind === "number" ? "number" : "text"} step="any" maxLength={300} value={selected.config[field.name] ?? ""} disabled={running} onChange={(e) => updateNode({ ...selected, config: { ...selected.config, [field.name]: field.kind === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value } })} />}</label>)}
          <div className="divider" /><span className="eyebrow">PORTS / 端口</span><div className="port-list">{selectedDefinition.inputs.map((p) => <div key={p.name}><span>↳ {p.label}</span><small>{p.kind}</small></div>)}{selectedDefinition.outputs.map((p) => <div key={p.name}><span>↗ {p.label}</span><small>{p.kind}</small></div>)}</div>
          <button className="danger subtle" disabled={running} onClick={() => editor.current!.remove(selected.id)}>删除此节点</button>
        </div> : <div className="inspector-empty">选择画布节点，编辑它的参数。<p>也可通过下方列表定位。</p></div>}
        <details className="node-list"><summary>流程中的节点 · {pipeline.nodes.length}</summary>{pipeline.nodes.map((n) => <button key={n.id} onClick={() => editor.current!.select(n.id)}>{n.label}<small>{definitions.get(n.type)?.owner}</small></button>)}</details>

          </div>
          <div hidden={layout.right !== "plugins"}><PluginPanel onSource={() => setEditorTab("source")} onChecks={showChecks} /></div>
          <div hidden={layout.right !== "assistant"}><AssistantPanel document={pipeline} selectedId={selectedId} onNotice={setNotice} /></div>
        </div>
      </aside>
      <nav className="ide-rail ide-rail-right" aria-label="右侧工具栏">
        <button className={layout.right === "info" ? "active" : ""} aria-label="节点信息" aria-pressed={layout.right === "info"} title="节点信息 · Alt 0" onClick={() => right("info")}><Icon name="info" /></button>
        <button className={layout.right === "plugins" ? "active" : ""} aria-label="页面插件" aria-pressed={layout.right === "plugins"} title="页面插件" onClick={() => right("plugins")}><Icon name="plugins" /></button>
        <button className={layout.right === "assistant" ? "active" : ""} aria-label="平台 MCP" aria-pressed={layout.right === "assistant"} title="平台 MCP 助手" onClick={() => right("assistant")}><Icon name="assistant" /></button>
      </nav>
    </div>
    <div className="ide-bottom-bar"><button onClick={showChecks}><Icon name="check" />问题 {validation.issues.length ? `(${validation.issues.length})` : ""}</button><button onClick={() => { setTab("preview"); setLayout(s => ({ ...s, bottom: true })); }}><Icon name="play" />运行</button><button onClick={() => { setTab("log"); setLayout(s => ({ ...s, bottom: true })); }}><Icon name="log" />日志</button><span>{running ? "正在本地预演" : "远端任务监控尚未接入"}</span></div>
    <footer className="footer ide-statusbar"><p role="status" title={notice}>{notice}</p><div><span>{hostStatus ? "Web Host 已连接" : "Web Host 未连接"}</span><span>UTF-8</span><span>JSON</span><span>Cyrene Studio</span></div></footer>
    <input hidden ref={fileInput} type="file" accept=".json,application/json" aria-label="导入流程文件" onChange={e => void importJson(e.target.files?.[0])} />
  </div>;
}
