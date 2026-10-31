import { lazy, Suspense, useRef, Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState, type CSSProperties } from "react";
import { catalog, definitions, getDefinition } from "../../../packages/pipeline-model/catalog";
import { examplePipeline, inspect, type PipelineNode } from "../../../packages/pipeline-model";
import { GraphCanvas } from "./graph/GraphCanvas";
import { NavigatorSessionProvider, useNavigatorSession } from "./services/NavigatorSessionProvider";
import { ConnectionPanel } from "./services/ConnectionPanel";
import { NodeServiceSettings } from "./services/NodeServiceSettings";
import type { HostStatus } from "../../../packages/service-settings/contracts";
import { ServerManagerBody, ComputeTargetSettings } from "./servers/ServerManager";
import { PipelineControls } from "./pipelines/PipelineControls";
import { usePipelineDocument } from "./pipelines/usePipelineDocument";
import { useRunControl } from "./runs/RunPanel";
import { useBuildControl } from "./builds/useBuildControl";
import { useNodeCatalog } from "./pipelines/useNodeCatalog";
import { DeviceApprovalRoute } from "./device-approval/DeviceApprovalRoute";
import { UpdatesPanel } from "./updates/UpdatesPanel";

import { EditorWorkspace, type EditorWorkspaceHandle, type EditorId } from "./ide/EditorWorkspace";
import { Icon, ResizeHandle, useIdeLayout } from "./ide/Chrome";
import { MenuBar, type BottomTab } from "./ide/MenuBar";
import { useDockableWindow } from "./ide/useDockableWindow";
import { useShortcuts } from "./ide/useShortcuts";
import { useIdeMessages } from "./ide/messages";
import { FilePanel, PluginPanel } from "./ide/Panels";
import { AssistantWindow } from "./assistant/AssistantWindow";
import { logError } from "./logger";
import { LanguageSelect, useI18n } from "./i18n";
import { WorkspaceSecurity } from "./team/WorkspaceSecurity";

import { MonitorWindow } from "./monitoring/MonitorWindow";
import { productPages } from "./products/navigation";
import { routeForPath, pathForRoute, type RouteId } from "../services/navigator/src/router";
const ProductWorkspace = lazy(() => import("./products/ProductWorkspace"));

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logError(
      "studio.unhandled_error",
      "STUDIO.REACT_RENDER_ERROR",
      error.message || "React render error",
      {
        componentStack: errorInfo.componentStack,
        stack: error.stack,
      }
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: "var(--dh-danger)", fontFamily: "sans-serif" }}>
          <h2>应用发生未捕获错误</h2>
          <pre>{this.state.error?.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppView() {
  const { locale, t } = useI18n();
  const message = useIdeMessages();
  const catalogRevision = useNodeCatalog();
  const { layout, setLayout, left, right, reset } = useIdeLayout();
  const [serverVisited, setServerVisited] = useState(false);
  const [securityVisited, setSecurityVisited] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorId>(productPages.some(page => location.pathname === pathForRoute(page.id) && location.pathname !== "/") || (location.pathname.startsWith("/runs/") || location.pathname === "/overview") ? "product" : "graph");
  const [productRoute, setProductRoute] = useState<RouteId>(() => routeForPath(location.pathname));
  const [productVisited, setProductVisited] = useState(() => editorTab === "product");
  const [historyRequest, setHistoryRequest] = useState(0);
  const [assistantToolsRequest, setAssistantToolsRequest] = useState(0);
  const editorWorkspace = useRef<EditorWorkspaceHandle>(null);
  const monitorWindow = useDockableWindow({ id: "monitor", initiallyExpanded: true, layoutRight: layout.right, setLayout, toggleRight: right, editorWorkspace });
  const assistantWindow = useDockableWindow({ id: "assistant", initiallyExpanded: false, layoutRight: layout.right, setLayout, toggleRight: right, editorWorkspace });
  const { expanded: monitorExpanded, setExpanded: setMonitorExpanded, dock: monitorDock, center: monitorCenter } = monitorWindow;
  const { expanded: assistantExpanded, visited: assistantVisited, dock: assistantDock, center: assistantCenter } = assistantWindow;
  const [editorLayout, setEditorLayout] = useState<{ split: boolean; visible: EditorId[] }>({ split: false, visible: [editorTab] });
  const selectEditor = (id: EditorId) => {
    setEditorTab(id);
    if (id === "monitor") monitorWindow.activate();
    if (id === "assistant") assistantWindow.activate();
  };
  const openMonitor = (history = false) => { if (history) setHistoryRequest(value => value + 1); selectEditor("monitor"); };
  useEffect(() => {
    const open = () => setLayout(s => ({ ...s, left: "security", ...(innerWidth < 1000 ? { right: null } : {}) }));
    window.addEventListener("cyrene:open-account", open);
    return () => window.removeEventListener("cyrene:open-account", open);
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/studio-updates/v1/session", { signal: AbortSignal.timeout(5000) })
      .then(async response => {
        if (!response.ok) return false;
        const session: unknown = await response.json();
        if (!session || typeof session !== "object" || !("mode" in session) || session.mode !== "local" || !("commands" in session) || !Array.isArray(session.commands)) return false;
        return session.commands.some(command => command && typeof command === "object" && "name" in command && command.name === "updates.status");
      })
      .then(available => { if (active) setLocalUpdatesAvailable(available); }, () => { if (active) setLocalUpdatesAvailable(false); });
    return () => { active = false; };
  }, []);
  const toggleMonitor = () => monitorWindow.toggle(() => openMonitor());
  const toggleAssistant = () => assistantWindow.toggle(() => selectEditor("assistant"));
  const openAssistant = () => assistantWindow.dockWindow(true);
  const openMcpTools = () => {
    setAssistantToolsRequest(value => value + 1);
    assistantWindow.dockWindow(false);
  };
  const toggleEditorSplit = (id: EditorId = editorTab) => {
    if (editorLayout.split) editorWorkspace.current?.merge(id);
    else editorWorkspace.current?.split(id);
  };
  const openProduct = (route: RouteId) => { setProductVisited(true); setProductRoute(route); setEditorTab("product"); window.history.pushState({}, "", route === "overview" ? "/overview" : pathForRoute(route)); };
  useEffect(() => { const navigate = () => { setProductVisited(true); setProductRoute(routeForPath(location.pathname)); setEditorTab("product"); }; window.addEventListener("popstate", navigate); return () => window.removeEventListener("popstate", navigate); }, []);
  const [filePreview, setFilePreview] = useState<{ name: string; text: string } | null>(null);
  const [events, setEvents] = useState<{ time: string; message: string }[]>([]);
  const { settings: settingsClient } = useNavigatorSession();
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(null);
  const [localUpdatesAvailable, setLocalUpdatesAvailable] = useState(false);
  const [updateReminderCount, setUpdateReminderCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>("training");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("示例已就绪。连接端口、调整参数，然后校验流程。");
  const [tab, setTab] = useState<BottomTab>("checks");
  const [plan, setPlan] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [running, setRunning] = useState(false);
  const [canvasInteracting, setCanvasInteracting] = useState(false);
  const { initial, pipeline, editor, fileInput, dirty, savedDraft, undoCount, redoCount, redoLocal, changed, recordChange, applyDocument, loadServerDocument, openServerPipeline, undoLocal, snapshot, replace, save, restore, exportJson, importJson, withEditor, recoveries, recoveryStatus, recover, serverBase, updateServerBase } = usePipelineDocument({
    disabled: running || canvasInteracting,
    selectedId, onSelect: setSelectedId, onNotice: setNotice,
    onResetPreview: () => { setRunning(false); setPlan([]); setCursor(0); },
    onShowGraph: () => setEditorTab("graph"),
  });
  const validation = useMemo(() => inspect(pipeline), [pipeline, catalogRevision]);
  const runControl = useRunControl({ document: pipeline, selectedId, onNotice: setNotice });
  const buildControl = useBuildControl(setNotice);
  const showBottom = (next: BottomTab) => { setTab(next); setLayout(s => ({ ...s, bottom: true })); };
  const toggleBottom = () => setLayout(s => ({ ...s, bottom: !s.bottom }));
  const selected = pipeline.nodes.find((n) => n.id === selectedId);
  const selectedDefinition = selected && getDefinition(selected.type, selected.typeVersion);
  const groups = [...new Set(catalog.map((d) => d.category))];

  useEffect(() => {
    setEvents(previous => previous.at(-1)?.message === notice ? previous : [...previous.slice(-99), { time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), message: notice }]);
  }, [notice]);
  useEffect(() => { if (layout.left === "servers") setServerVisited(true); if (layout.left === "security") setSecurityVisited(true); }, [layout.left]);
  useShortcuts({ editorTab, running, undo: undoLocal, redo: redoLocal, save, left, right, toggleBottom });
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      logError(
        "studio.unhandled_error",
        "STUDIO.UNHANDLED_ERROR",
        event.message || "Unhandled window error",
        {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error?.stack,
        }
      );
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection";
      logError(
        "studio.unhandled_rejection",
        "STUDIO.UNHANDLED_REJECTION",
        message,
        {
          stack: reason instanceof Error ? reason.stack : undefined,
        }
      );
    };

    window.addEventListener("error", handleGlobalError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleGlobalError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);
  useEffect(() => {
    if (!running) return;
    if (cursor >= plan.length) { setRunning(false); setNotice("本地预演完成：已遍历依赖顺序，未执行训练、评估或部署。"); return; }
    const timer = window.setTimeout(() => setCursor((c) => c + 1), 450);
    return () => window.clearTimeout(timer);
  }, [running, cursor, plan.length]);

  function preview() {
    withEditor(() => {
      setLayout(s => ({ ...s, bottom: true })); setEditorTab("graph");
      const p = snapshot(), check = inspect(p);
      if (check.issues.length) { setTab("checks"); setNotice(`校验发现 ${check.issues.length} 个问题，修正后可预演。`); return; }
      setPlan(check.order); setCursor(0); setRunning(true); setTab("preview");
      setNotice("正在本地预演依赖顺序。不会访问训练服务或创建云资源。");
    });
  }
  function updateNode(n: PipelineNode) { withEditor(handle => handle.update(n)); }

  function showChecks() { setTab("checks"); setLayout(s => ({ ...s, bottom: true })); }
  function focusNode(id: string | null) { setSelectedId(id); if (id && !layout.right) setLayout(s => ({ ...s, right: "info", ...(innerWidth < 1000 ? { left: null } : {}) })); }
  const panelTitle = layout.left === "security" ? message("accountSecurity") : t(layout.left === "files" ? "项目文件" : layout.left === "servers" ? "服务器管理" : "节点库");
  const rightTitle = layout.right === "monitor" ? "Navigator" : layout.right === "assistant" ? "AI Assistant" : t(layout.right === "plugins" ? "页面插件" : "节点信息");
  const css = { "--left-width": `${layout.leftWidth}px`, "--right-width": `${layout.rightWidth}px`, "--bottom-height": `${layout.bottomHeight}px` } as CSSProperties;
  return <div className={`studio ide-studio ${layout.left ? "has-left" : ""} ${layout.right ? "has-right" : ""}`} style={css}>
    <PipelineControls onOpenServerPipeline={openServerPipeline} serverBase={serverBase} onServerBase={updateServerBase} document={pipeline} selectedId={selectedId} disabled={running || canvasInteracting} onApply={applyDocument} onLoad={loadServerDocument} onNotice={setNotice} canUndo={undoCount > 0} onUndo={undoLocal} canRedo={redoCount > 0} onRedo={redoLocal} render={controls => <>
      <header className="ide-titlebar">
        <div className="ide-brand" aria-label="Cyrene Client">C<span>↗</span></div>
        <MenuBar running={running} savedDraft={savedDraft} controls={controls} recoveries={recoveries}
          file={{ save, restore, importJson: () => fileInput.current?.click(), exportJson, recover }}
          editor={{ split: editorLayout.split, toggleSplit: () => toggleEditorSplit(),
            resetLayout: () => { reset(); setMonitorExpanded(true); editorWorkspace.current?.merge("graph"); },
            showSource: () => setEditorTab("source") }}
          windows={{ monitorExpanded, openMonitor, toggleMonitor, openAssistant, openMcpTools, left, right, showBottom, toggleBottom, openProduct }}
          execution={{ validate: () => { showChecks(); setNotice(validation.issues.length
            ? (locale === "zh-CN" ? `发现 ${validation.issues.length} 个问题。` : `${validation.issues.length} issue(s) found.`)
            : locale === "zh-CN" ? "结构校验通过；真实资源可用性与业务门禁尚未验证。" : "Structure validation passed; live resource availability and policy gates are not yet verified."); },
            loadExample: () => replace(examplePipeline(), locale === "zh-CN" ? "已载入训练示例。" : "Training example loaded."),
            preview, compileAction: runControl.compileAction, runMenu: runControl.menu, buildMenu: buildControl.menu }}
          updates={localUpdatesAvailable && <UpdatesPanel onReminderChange={setUpdateReminderCount} />} updateReminderCount={updateReminderCount} />
        <div className="ide-project-title">Cyrene Client <span> / </span> <b>Local Workspace</b></div>
        <div className="ide-document-meta"><div className="ide-document-name"><Icon name="nodes" /><input aria-label={t("流水线名称")} maxLength={100} value={pipeline.name} disabled={running} onChange={e => recordChange({ ...pipeline, name: e.target.value })} /><span className="ide-dirty" title={t(dirty ? "本地有未保存修改" : "草稿")}>{dirty ? "●" : ""}</span></div><span className="ide-version">{controls.status}</span></div>
        <div className="ide-titlebar-controls"><div className="ide-toolbar-actions">{controls.toolbar}<button className="ide-run" onClick={preview} disabled={running}><Icon name="play" />{t("本地预演")}</button></div><ConnectionPanel client={settingsClient} status={hostStatus} onConnected={setHostStatus} /><LanguageSelect compact /></div>
      </header>
      {controls.conflict}
    </>} />

    <div className="ide-body">
      <nav className="ide-rail ide-rail-left" aria-label={t("左侧工具栏")}>
        <button className={layout.left === "files" ? "active" : ""} aria-label={t("项目文件")} aria-pressed={layout.left === "files"} title={`${t("项目文件")} · Alt 1`} onClick={() => left("files")}><Icon name="files" /></button>
        <button className={layout.left === "nodes" ? "active" : ""} aria-label={t("节点库")} aria-pressed={layout.left === "nodes"} title={`${t("节点库")} · Alt 2`} onClick={() => left("nodes")}><Icon name="nodes" /></button>
        <button className={layout.left === "servers" ? "active" : ""} aria-label={t("服务器管理")} aria-pressed={layout.left === "servers"} title={`${t("服务器管理")} · Alt 3`} onClick={() => left("servers")}><Icon name="servers" /></button>
        <button className={layout.left === "security" ? "active" : ""} aria-label={message("accountSecurity")} aria-pressed={layout.left === "security"} title={message("accountSecurity")} onClick={() => left("security")}><Icon name="account" /></button>
        <div className="ide-rail-spacer" /><button aria-label={t("显示事件日志")} title={t("事件日志")} onClick={() => { setTab("log"); setLayout(s => ({ ...s, bottom: true })); }}><Icon name="log" /></button>
      </nav>
      <aside className="ide-dock ide-left-dock" hidden={!layout.left} aria-label={`${panelTitle}面板`}>
        <div className="ide-dock-heading"><strong>{panelTitle}</strong><span>⌄</span><button aria-label={t(layout.left === "servers" ? "关闭服务器管理" : "收起左侧窗口")} onClick={() => setLayout(s => ({ ...s, left: null }))}><Icon name="close" /></button></div>
        <div className="ide-dock-content">
          <div hidden={layout.left !== "files"}><FilePanel document={pipeline} disabled={running} onImport={file => void importJson(file)} onSource={() => setEditorTab("source")} onPreview={(name, text) => { setFilePreview({ name, text }); setEditorTab("file"); }} onNotice={setNotice} /></div>
          <div className="palette" hidden={layout.left !== "nodes"}>
        <div className="panel-heading"><strong>{t("节点库")}</strong><span>{locale === "zh-CN" ? `${catalog.length} 个模块` : `${catalog.length} modules`}</span></div>
        <input className="search" aria-label={t("搜索节点")} placeholder={t("搜索节点或服务…")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="catalog">{groups.map((group) => {
          const items = catalog.filter((d) => d.category === group && `${d.title} ${d.owner}`.toLowerCase().includes(query.toLowerCase()));
          return items.length ? <section key={group}><h3>{t(group)}</h3>{items.map((d) => <button className="node-option" key={d.type} disabled={running || pipeline.nodes.length >= 200} onClick={() => withEditor(handle => handle.add(d.type))} title={t(d.description)} aria-label={`${locale === "zh-CN" ? "添加" : "Add "}${t(d.title)}`}><span className="node-symbol" style={{ color: d.color }}>{({ dataset: "▤", model: "◇", compute: "▥", training: "⌘", evaluation: "◈", deployment: "↗", agent: "✧" })[d.type]}</span><span><strong>{t(d.title)}</strong><small>{d.owner}</small></span><span className="add-symbol">+</span></button>)}</section> : null;
        })}</div>
        <div className="palette-note"><span>01 — EXPERIMENT</span><p>{t("点击添加节点")}<br />{t("拖动端口连接步骤")}</p></div>

          </div>
          <div className="ide-server-panel" hidden={layout.left !== "servers"}>{serverVisited && <ServerManagerBody />}</div>
          <div hidden={layout.left !== "security"}>{securityVisited && <WorkspaceSecurity />}</div>
        </div>
        <ResizeHandle orientation="vertical" value={layout.leftWidth} min={210} max={480} label={t("调整左侧窗口宽度")} onChange={v => setLayout(s => ({ ...s, leftWidth: v }))} />
      </aside>

      <main className="ide-center editor-column" aria-label={t("流水线编辑器")}>
        <EditorWorkspace ref={editorWorkspace} active={editorTab} ratio={layout.editorRatio} onSelect={selectEditor} onRatio={value => setLayout(state => ({ ...state, editorRatio: value }))} onLayout={setEditorLayout} tabs={[
          { id: "graph", label: <><Icon name="nodes" />{pipeline.id}.pipeline <span>{dirty ? "●" : ""}</span></>, content: visible => <>
            <div className="canvas-toolbar"><span>{t("工作空间")} <span className="ide-breadcrumb-sep">›</span> {t("流水线")} <small>{locale === "zh-CN" ? `${pipeline.nodes.length} 节点 · ${pipeline.edges.length} 连接` : `${pipeline.nodes.length} nodes · ${pipeline.edges.length} connections`}</small></span><button onClick={() => withEditor(handle => handle.fit())}>{t("适应画布")}</button></div>
            <div className={`canvas-area ${running ? "locked" : ""}`}>
              <GraphCanvas ref={editor} initial={initial} interactive={visible && !running} onChange={changed} onSelect={focusNode} onInteractionChange={setCanvasInteracting} />
              {running && <div className="canvas-lock">{t("正在预演")} · {t("画布暂时锁定")}</div>}
            </div>
          </> },
          { id: "source", label: <><Icon name="files" />JSON</>, content: () => <div className="ide-source-view"><div>{pipeline.id}.json · {t("当前草稿")}<span>{t("只读预览")}</span></div><pre tabIndex={0} aria-label={t("文件内容预览")}>{JSON.stringify(pipeline, null, 2)}</pre></div> },
          ...(filePreview ? [{ id: "file" as const, label: <><Icon name="files" />{filePreview.name.split("/").at(-1)}</>, content: () => <div className="ide-source-view"><div>{filePreview.name}<span>{t("只读预览")}</span></div><pre tabIndex={0} aria-label={t("文件内容预览")}>{filePreview.text}</pre></div> }] : []),
          { id: "monitor", label: "Navigator", content: () => <div className="monitor-editor-host" ref={monitorCenter} /> },
          ...(assistantExpanded ? [{ id: "assistant" as const, label: <><Icon name="assistant" />AI Assistant</>, content: () => <div className="assistant-editor-host" ref={assistantCenter} /> }] : []),
          ...(productVisited ? [{ id: "product" as const, label: productPages.find(page => page.id === productRoute)?.[locale === "zh-CN" ? "zh" : "en"], content: () => <div className="monitor-editor-host"><Suspense fallback={<p>{message("openingPage")}</p>}><ProductWorkspace route={productRoute} /></Suspense></div> }] : []),
        ]} />
        <section className="bottom-panel" hidden={!layout.bottom} aria-label={t("底部工具窗口")}>
          <ResizeHandle orientation="horizontal" value={layout.bottomHeight} min={100} max={400} sign={-1} label={t("调整底部窗口高度")} onChange={v => setLayout(s => ({ ...s, bottomHeight: v }))} />
          <div className="bottom-tabs"><button className={tab === "builds" ? "active" : ""} onClick={() => setTab("builds")}>{t("构建输出")}</button><button className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>{t("真实运行")}</button><button className={tab === "checks" ? "active" : ""} onClick={() => setTab("checks")}><Icon name="check" />{t("流程检查")} <span>{validation.issues.length}</span></button><button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}><Icon name="play" />{t("运行预演")}</button><button className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}><Icon name="log" />{t("事件日志")}</button><button className="ide-bottom-close" aria-label={t("收起底部窗口")} onClick={() => setLayout(s => ({ ...s, bottom: false }))}><Icon name="close" /></button></div>
          <div hidden={tab === "log" || tab === "runs" || tab === "builds"}>
          {tab === "checks" ? <div className="check-content">{validation.issues.length ? <ul className="issues">{validation.issues.map((i, index) => <li key={`${i.code}-${index}`}><button onClick={() => { if (i.nodeId) withEditor(handle => handle.select(i.nodeId!)); }}>! {i.message}</button></li>)}</ul> : <div className="check-pass"><span>✓</span><div><strong>{t("结构检查通过")}</strong><p>{t("端口类型、必填参数与依赖顺序有效。服务连接、资源可用性及评估门禁尚未验证。")}</p></div></div>}</div> : <div className="preview-content"><div className="preview-heading"><span>{running ? t("依赖顺序预演中") : plan.length ? (locale === "zh-CN" ? `已预演 ${cursor} / ${plan.length} 步` : `Previewed ${cursor} / ${plan.length} steps`) : t("尚未开始预演")}</span>{running && <button onClick={() => { setRunning(false); setNotice(locale === "zh-CN" ? "预演已停止，未执行外部操作。" : "Preview stopped without external operations."); }}>{t("停止预演")}</button>}</div><div className="run-steps">{plan.map((id, index) => <span className={`run-step ${index < cursor ? "done" : index === cursor && running ? "current" : ""}`} key={id}>{index < cursor ? "✓" : String(index + 1).padStart(2, "0")} {pipeline.nodes.find((n) => n.id === id)?.label}</span>)}</div><p>{t("这里只模拟步骤顺序，不生成模型、评估指标或真实端点。")}</p></div>}
          </div>
          <div hidden={tab !== "runs"}>{runControl.panel}</div>
          <div hidden={tab !== "builds"}>{buildControl.panel}</div>
          <div className="ide-event-log" hidden={tab !== "log"}>{events.map((e, i) => <div key={i}><time>{e.time}</time><span>INFO</span><p>{e.message}</p></div>)}</div>
        </section>
      </main>

      <aside className="ide-dock ide-right-dock" hidden={!layout.right} aria-label={`${rightTitle}面板`}>
        <ResizeHandle orientation="vertical" value={layout.rightWidth} min={260} max={520} sign={-1} label={t("调整右侧窗口宽度")} onChange={v => setLayout(s => ({ ...s, rightWidth: v }))} />
        <div className="ide-dock-heading"><strong>{rightTitle}</strong><span>{layout.right === "assistant" ? "✧" : ""}</span><button aria-label={t("收起右侧窗口")} onClick={() => setLayout(s => ({ ...s, right: null }))}><Icon name="close" /></button></div>
        <div className="ide-dock-content">
          <div className="monitor-dock-host" ref={monitorDock} hidden={layout.right !== "monitor"} />
          <div className="inspector" hidden={layout.right !== "info"}>
        <div className="panel-heading"><strong>{t("节点配置")}</strong><span>{selectedDefinition?.owner ?? t("请选择节点")}</span></div>
        {selected && selectedDefinition ? <div className="inspector-content"><div className="inspector-icon" style={{ color: selectedDefinition.color }}>◇</div><h2>{selected.label}</h2><p className="description">{t(selectedDefinition.description)}</p><div className="divider" />
          {selected.type === "compute" && <ComputeTargetSettings key={`server-${pipeline.id}-${selected.id}`} node={selected} disabled={running} onUpdate={updateNode} />}
          <NodeServiceSettings key={`${pipeline.id}:${selected.id}`} node={selected} client={settingsClient} status={hostStatus} disabled={running} onUpdate={updateNode} />
          <label className="field"><span>{t("节点名称")}</span><input maxLength={80} value={selected.label} disabled={running} onChange={(e) => updateNode({ ...selected, label: e.target.value })} /></label>
          {selectedDefinition.fields.map((field) => <label className="field" key={field.name}><span>{t(field.label)}</span>{field.kind === "select" ? <select value={selected.config[field.name] ?? ""} disabled={running} onChange={(e) => updateNode({ ...selected, config: { ...selected.config, [field.name]: e.target.value } })}>{!selected.config[field.name] && <option value="">{t("请选择")}</option>}{field.choices!.map((c) => <option key={c} value={c}>{t(c)}</option>)}</select> : <input type={field.kind === "number" ? "number" : "text"} step="any" maxLength={300} value={selected.config[field.name] ?? ""} disabled={running} onChange={(e) => updateNode({ ...selected, config: { ...selected.config, [field.name]: field.kind === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value } })} />}</label>)}
          <div className="divider" /><span className="eyebrow">{locale === "zh-CN" ? "PORTS / 端口" : "PORTS"}</span><div className="port-list">{selectedDefinition.inputs.map((p) => <div key={p.name}><span>↳ {t(p.label)}</span><small>{p.kind}</small></div>)}{selectedDefinition.outputs.map((p) => <div key={p.name}><span>↗ {t(p.label)}</span><small>{p.kind}</small></div>)}</div>
          <button className="danger subtle" disabled={running} onClick={() => withEditor(handle => handle.remove(selected.id))}>{t("删除此节点")}</button>
        </div> : <div className="inspector-empty">{t("选择画布节点，编辑它的参数。")}<p>{t("也可通过下方列表定位。")}</p></div>}
        <details className="node-list"><summary>{t("流程中的节点")} · {pipeline.nodes.length}</summary>{pipeline.nodes.map((n) => <button key={n.id} onClick={() => withEditor(handle => handle.select(n.id))}>{n.label}<small>{definitions.get(n.type)?.owner}</small></button>)}</details>

          </div>
          <div hidden={layout.right !== "plugins"}><PluginPanel onSource={() => setEditorTab("source")} onChecks={showChecks} /></div>
          <div className="assistant-dock-host" ref={assistantDock} hidden={layout.right !== "assistant" || assistantExpanded} />
        </div>
      </aside>
      <nav className="ide-rail ide-rail-right" aria-label={t("右侧工具栏")}><button aria-label={message("navigatorMonitoring")} title="Navigator" aria-pressed={layout.right === "monitor" || editorLayout.visible.includes("monitor")} onClick={() => { if (layout.right === "monitor") right("monitor"); else openMonitor(); }}><Icon name="log" /></button>
        <button className={layout.right === "info" ? "active" : ""} aria-label={t("节点信息")} aria-pressed={layout.right === "info"} title={`${t("节点信息")} · Alt 0`} onClick={() => right("info")}><Icon name="info" /></button>
        <button className={layout.right === "plugins" ? "active" : ""} aria-label={t("页面插件")} aria-pressed={layout.right === "plugins"} title={t("页面插件")} onClick={() => right("plugins")}><Icon name="plugins" /></button>
        <button className={layout.right === "assistant" || editorLayout.visible.includes("assistant") ? "active" : ""} aria-label="AI Assistant" aria-pressed={layout.right === "assistant" || editorLayout.visible.includes("assistant")} title="AI Assistant" onClick={() => { if (assistantExpanded) selectEditor("assistant"); else openAssistant(); }}><Icon name="assistant" /></button>
      </nav>
    </div>
    <MonitorWindow document={pipeline} dirty={dirty} selectedId={selectedId} visible={monitorExpanded ? editorLayout.visible.includes("monitor") : layout.right === "monitor"} expanded={monitorExpanded} historyRequest={historyRequest} dock={monitorDock} center={monitorCenter} splitRequested={editorLayout.split} onSplit={() => toggleEditorSplit("monitor")} onExpand={toggleMonitor} onLocate={id => { setEditorTab("graph"); withEditor(handle => handle.select(id)); }} />
    {assistantVisited && <AssistantWindow document={pipeline} serverBase={serverBase} selectedId={selectedId} visible={assistantExpanded ? editorLayout.visible.includes("assistant") : layout.right === "assistant"} expanded={assistantExpanded} toolsRequest={assistantToolsRequest} dock={assistantDock} center={assistantCenter} onDock={toggleAssistant} onOpenWorkflow={openServerPipeline} onNotice={setNotice} onMonitor={() => openMonitor()} />}
    <div className="ide-bottom-bar"><button onClick={showChecks}><Icon name="check" />{t("问题")} {validation.issues.length ? `(${validation.issues.length})` : ""}</button><button onClick={() => { setTab("preview"); setLayout(s => ({ ...s, bottom: true })); }}><Icon name="play" />{t("运行")}</button><button onClick={() => { setTab("log"); setLayout(s => ({ ...s, bottom: true })); }}><Icon name="log" />{t("日志")}</button><span>{running ? t("正在本地预演") : message("navigatorRunMonitoring")}</span></div>
    <footer className="footer ide-statusbar"><p role="status" title={notice}>{notice}</p><div><span aria-label={t("编辑恢复状态")}>{recoveryStatus}</span><span>{t(hostStatus ? "Web Host 已连接" : "Web Host 未连接")}</span><span>UTF-8</span><span>JSON</span><span>Cyrene Client</span></div></footer>
    <input hidden ref={fileInput} type="file" accept=".json,application/json" aria-label={t("导入流程文件")} onChange={e => void importJson(e.target.files?.[0])} />
  </div>;
}

export function App() {
  const isDeviceApprovalRoute = typeof window !== "undefined" && window.location.pathname === "/device-approval";
  return (
    <ErrorBoundary>
      {isDeviceApprovalRoute
        ? <DeviceApprovalRoute />
        : <NavigatorSessionProvider><AppView /></NavigatorSessionProvider>}
    </ErrorBoundary>
  );
}
