import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavigatorApi, NavigatorHttpError, makeIdempotencyKey, type AssistantCapabilities, type AssistantExecution, type AssistantPermission, type AssistantProtocol, type AssistantProvider, type NavigatorTaskEvent, type NavigatorTaskRecord, type SessionPayload, type WorkApproval, type WorkAttachment, type WorkInput } from "../../services/navigator/src/api";
import { assistantEventLabel, readAssistantTaskEvents } from "../../services/navigator/src/task-event-stream";
import { studioProductFetch } from "../products/transport";
import { useTeamIdentity } from "../team/TeamGate";
import { useI18n } from "../i18n";
import type { AssistantWindowProps } from "./AssistantWindow";
import { changedPipelineRecords, chatSessions, isActiveTask, mergeTaskRecords, taskWorkflow, workflowSnapshot } from "./model";
import Markdown from "./Markdown";
import { parseLegacyHistory, type LegacyChat } from "./legacy-history";

const McpPanel = lazy(() => import("../mcp/McpPanel"));
type Submission = { requestId: string; input: Parameters<NavigatorApi["createAssistantTask"]>[0] };
const permissionLabels: Record<AssistantPermission, [string, string]> = {
  "read-only": ["只读", "Read only"], ask: ["逐次确认", "Ask"], auto: ["自动审批", "Auto approval"], "full-access": ["完全访问", "Full access"],
};
const statusLabels: Record<NavigatorTaskRecord["status"], [string, string]> = {
  queued: ["排队中", "Queued"], running: ["执行中", "Running"], completed: ["已完成", "Completed"], failed: ["失败", "Failed"],
  aborted: ["已停止", "Stopped"], waiting_approval: ["等待确认", "Approval required"], waiting_input: ["等待补充信息", "Input required"],
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function executionFor(task?: NavigatorTaskRecord): Partial<AssistantExecution> {
  const navigator = task?.metadata.navigator;
  const owned = navigator && typeof navigator === "object" && !Array.isArray(navigator) ? navigator as Record<string, unknown> : {};
  const value = owned.execution ?? task?.execution ?? task?.metadata.execution;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<AssistantExecution> : {};
}

export default function Chat(props: AssistantWindowProps) {
  const { locale } = useI18n(), { actorId, workspaceId, scopes } = useTeamIdentity();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const api = useMemo(() => new NavigatorApi(studioProductFetch), []);
  const [auth, setAuth] = useState<SessionPayload | null>(null), [pairing, setPairing] = useState("");
  const [caps, setCaps] = useState<AssistantCapabilities | null>(null), [hostWorkspace, setHostWorkspace] = useState("");
  const [tasks, setTasks] = useState<NavigatorTaskRecord[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null);
  const selectionKey = `cyrene.assistant.selection.v1:${actorId}:${workspaceId}`;
  const [sessionId, setSessionId] = useState(() => { try { return localStorage.getItem(selectionKey) ?? ""; } catch { return ""; } });
  const [draft, setDraft] = useState(""), [attachments, setAttachments] = useState<WorkAttachment[]>([]);
  const [runtimeId, setRuntimeId] = useState("harness"), [providerId, setProviderId] = useState("");
  const [model, setModel] = useState(""), [effort, setEffort] = useState(""), [permission, setPermission] = useState<AssistantPermission>("ask");
  const [view, setView] = useState<"chat" | "history" | "settings" | "mcp" | "legacy">("chat");
  const [legacyChats, setLegacyChats] = useState<LegacyChat[]>([]), [legacyId, setLegacyId] = useState("");
  const [mcpVisited, setMcpVisited] = useState(false);
  const [error, setError] = useState(""), [capsError, setCapsError] = useState(""), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<Submission | null>(null);
  const [approvals, setApprovals] = useState<WorkApproval[]>([]), [inputs, setInputs] = useState<WorkInput[]>([]), [answers, setAnswers] = useState<Record<string, string>>({});
  const [taskEvents, setTaskEvents] = useState<Record<string, NavigatorTaskEvent[]>>({});
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [restoringHistory, setRestoringHistory] = useState(false);
  const mounted = useRef(true), selected = useRef(sessionId), operation = useRef(false), follow = useRef(true);
  const streamCursors = useRef(new Map<string, number>()), fileInput = useRef<HTMLInputElement>(null), transcript = useRef<HTMLDivElement>(null);
  const inputRequests = useRef(new Map<string, { answer: string; messageId: string }>());
  const historyExtended = useRef(false);
  const restoredTargets = useRef(new Set<string>());
  const legacyInput = useRef<HTMLInputElement>(null);
  selected.current = sessionId;
  const effectiveWorkspace = hostWorkspace || workspaceId;
  const aligned = !hostWorkspace || hostWorkspace === workspaceId;
  const mayOperate = aligned && scopes.includes("products.operate");
  const mayConfigure = scopes.includes("products.admin");
  const sessions = useMemo(() => chatSessions(tasks.filter(task => task.workspaceId === effectiveWorkspace)), [tasks, effectiveWorkspace]);
  const turns = sessions.find(session => session.id === sessionId)?.turns ?? [];
  const activeTask = turns.find(isActiveTask), lastTask = turns.at(-1);
  const observedTask = activeTask ?? lastTask;
  const runtime = caps?.runtimes.find(item => item.id === runtimeId);
  const provider = caps?.providers.find(item => item.id === providerId);
  const models = runtimeId === "harness" && providerId ? provider?.models ?? [] : runtime?.models ?? [];
  const modelInfo = models.find(item => item.id === model);
  const selectedTaskIds = new Set(turns.map(task => task.id));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (props.toolsRequest) { setMcpVisited(true); setView("mcp"); } }, [props.toolsRequest]);
  useEffect(() => {
    const changed = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => { try { if (sessionId) localStorage.setItem(selectionKey, sessionId); else localStorage.removeItem(selectionKey); } catch { /* Selection is optional UI state. */ } }, [sessionId, selectionKey]);
  const fail = (reason: unknown) => { if (mounted.current) setError(message(reason)); };

  const reloadTasks = useCallback(async () => {
    const page = await api.getAssistantTasks();
    if (!mounted.current) return;
    setTasks(previous => mergeTaskRecords(previous, page.items));
    if (!historyExtended.current) setNextCursor(page.nextCursor);
  }, [api]);

  const reloadApprovals = useCallback(async () => {
    const results = await Promise.allSettled([api.getWorkApprovals(effectiveWorkspace), api.getWorkInputs(effectiveWorkspace)]);
    if (!mounted.current) return;
    if (results[0].status === "fulfilled") setApprovals(results[0].value);
    if (results[1].status === "fulfilled") setInputs(results[1].value);
  }, [api, effectiveWorkspace]);

  const reloadCapabilities = useCallback(async () => {
    try { const value = await api.getAssistantCapabilities(); if (mounted.current) { setCaps(value); setCapsError(""); } }
    catch (reason) { if (mounted.current) setCapsError(message(reason)); }
  }, [api]);

  useEffect(() => {
    let active = true;
    api.setSessionExpiredHandler(() => { if (active) setAuth(current => current ? { ...current, authenticated: false } : null); });
    void api.restoreSession().then(value => { if (active) setAuth(value); }, reason => { if (active) fail(reason); });
    return () => { active = false; api.setSessionExpiredHandler(null); };
  }, [api]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    void reloadTasks().catch(fail);
    void reloadCapabilities();
    void api.getSystemStatus().then(status => { if (mounted.current) setHostWorkspace(status.workspaceId ?? ""); }, fail);
  }, [api, auth?.authenticated, reloadTasks, reloadCapabilities]);

  useEffect(() => {
    if (!auth?.authenticated || !sessionId || turns.length || !nextCursor || restoredTargets.current.has(sessionId)) return;
    let active = true;
    const target = sessionId;
    restoredTargets.current.add(target);
    setRestoringHistory(true);
    const restore = async () => {
      let cursor: string | null = nextCursor;
      try {
        for (let pageNumber = 0; active && cursor && pageNumber < 10; pageNumber++) {
          const page = await api.getAssistantTasks(cursor);
          if (!active) return;
          setTasks(previous => mergeTaskRecords(previous, page.items));
          historyExtended.current = true; cursor = page.nextCursor;
          if (page.items.some(task => task.sessionId === target && task.workspaceId === effectiveWorkspace)) break;
        }
        if (active) setNextCursor(cursor);
      } catch (reason) { if (active) fail(reason); }
      finally { if (active) setRestoringHistory(false); }
    };
    void restore();
    return () => { active = false; };
  }, [api, auth?.authenticated, sessionId, !turns.length, nextCursor, effectiveWorkspace]);

  useEffect(() => {
    if (!auth?.authenticated || !auth.expiresAt) return;
    let active = true;
    const timer = setTimeout(() => void api.refreshSession().then(value => { if (active) setAuth(value); }, reason => { if (active) fail(reason); }),
      Math.min(2_147_483_647, Math.max(1000, Date.parse(auth.expiresAt) - Date.now() - 30_000)));
    return () => { active = false; clearTimeout(timer); };
  }, [api, auth]);

  useEffect(() => {
    if (!caps || sessionId) return;
    if (!caps.runtimes.some(value => value.id === runtimeId && value.available)) setRuntimeId(caps.defaultRuntime);
    if (!providerId && caps.runtimes.find(runtime => runtime.id === "harness")?.models.length) return;
    if (!caps.providers.some(value => value.id === providerId)) setProviderId(caps.providers.find(value => value.configured)?.id ?? "");
  }, [caps, sessionId, runtimeId, providerId]);
  useEffect(() => { if (caps && !models.some(value => value.id === model)) setModel(models[0]?.id ?? ""); }, [!!caps, JSON.stringify(models), model]);
  useEffect(() => { if (caps && !modelInfo?.efforts.includes(effort)) setEffort(""); }, [!!caps, JSON.stringify(modelInfo?.efforts), effort]);
  useEffect(() => { if (runtime && !runtime.permissions.includes(permission)) setPermission(runtime.permissions.includes("ask") ? "ask" : runtime.permissions[0]); }, [runtime, permission]);

  // Restore execution settings from the task ledger; browser preferences never own sessions.
  useEffect(() => {
    if (!sessionId || !lastTask || !caps) return;
    const execution = executionFor(lastTask);
    setRuntimeId(execution.runtime || "harness"); setProviderId(execution.providerId || "");
    if (execution.model) setModel(execution.model);
    setEffort(execution.effort ?? "");
    if (execution.permission) setPermission(execution.permission);
  }, [sessionId, lastTask?.id, !!caps]);

  useEffect(() => {
    if (!auth?.authenticated || !props.visible) return;
    let active = true, inFlight = false, failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      clearTimeout(timer);
      if (!active || inFlight) return;
      if (document.hidden) return;
      inFlight = true;
      let delay = activeTask || pending ? 3000 : 15_000;
      try {
        await reloadTasks();
        if (activeTask) await reloadApprovals();
        failures = 0;
      } catch (reason) { delay = Math.min(60_000, 2000 * 2 ** Math.min(failures++, 5)); if (active) fail(reason); }
      finally { inFlight = false; if (active) timer = setTimeout(() => void update(), delay); }
    };
    const wake = () => { if (!document.hidden) void update(); };
    document.addEventListener("visibilitychange", wake); window.addEventListener("online", wake);
    void update();
    return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake); };
  }, [auth?.authenticated, props.visible, activeTask?.id, pending?.requestId, reloadTasks, reloadApprovals]);

  useEffect(() => {
    if (!observedTask || !props.visible || !pageVisible || !auth?.authenticated) return;
    const taskId = observedTask.id, controller = new AbortController();
    const terminal = !isActiveTask(observedTask);
    let failures = 0, refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (refreshTimer || controller.signal.aborted) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void api.getAssistantTask(taskId, controller.signal).then(task => {
          if (!controller.signal.aborted) setTasks(previous => mergeTaskRecords(previous, [task]));
        }, reason => { if (!controller.signal.aborted) fail(reason); });
        void reloadApprovals();
      }, 500);
    };
    const connect = async () => {
      while (!controller.signal.aborted && !document.hidden) {
        try {
          const cursor = streamCursors.current.get(taskId) ?? 0;
          const response = await api.openAssistantTaskEvents(taskId, cursor, controller.signal);
          await readAssistantTaskEvents(response, cursor, controller.signal, event => {
            if (controller.signal.aborted) return;
            streamCursors.current.set(taskId, event.sequence);
            setTaskEvents(previous => ({ ...previous, [taskId]: [...(previous[taskId] ?? []).filter(item => item.sequence !== event.sequence).slice(-99), event] }));
            refresh();
          });
          if (terminal) return;
          failures = 0;
        } catch (reason) {
          if (controller.signal.aborted) return;
          fail(reason);
          if (reason instanceof NavigatorHttpError && reason.status < 500 && ![408, 429].includes(reason.status)) return;
          failures++;
        }
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve(); };
          const timer = setTimeout(finish, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
          controller.signal.addEventListener("abort", finish, { once: true });
        });
      }
    };
    const wake = () => { if (document.hidden) controller.abort(); };
    document.addEventListener("visibilitychange", wake);
    void connect();
    return () => { controller.abort(); clearTimeout(refreshTimer); document.removeEventListener("visibilitychange", wake); };
  }, [api, auth?.authenticated, observedTask?.id, observedTask?.status, props.visible, pageVisible, reloadApprovals]);

  useEffect(() => {
    if (!pending) return;
    const created = tasks.find(task => task.id === pending.requestId);
    if (created) { setSessionId(created.sessionId); setPending(null); setDraft(""); setAttachments([]); }
  }, [pending, tasks]);
  useEffect(() => { if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [tasks, taskEvents, approvals, inputs, sessionId]);

  const act = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError("");
    try { await action(); } catch (reason) { fail(reason); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };

  const send = async (retry?: Submission) => {
    if (!mayOperate || operation.current || activeTask || uploading || (!retry && (!draft.trim() || pending || (!!sessionId && !lastTask)))) return;
    if (!runtime?.available || (runtimeId === "harness" && providerId && !provider?.configured)) { setError(tx("请选择可用的智能体或配置 API。", "Choose an available agent or configure an API.")); return; }
    if (!retry && attachments.some(item => item.mediaType.startsWith("image/")) && modelInfo?.images !== true) {
      setError(tx("当前模型不支持已附加的图像，请移除图像或切换模型。", "Remove image attachments or choose an image-capable model.")); return;
    }
    const submission = retry ?? { requestId: makeIdempotencyKey(), input: {
      prompt: draft.trim(), ...(sessionId ? { sessionId } : {}),
      execution: { runtime: runtimeId, ...(runtimeId === "harness" && providerId ? { providerId } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}), permission },
      metadata: { workflow: workflowSnapshot(props.document, props.serverBase, props.selectedId), attachments: attachments.map(({ id, sha256, name, mediaType, size }) => ({ id, sha256, name, mediaType, size })) },
    } };
    setPending(submission);
    await act(async () => {
      try {
        const created = await api.createAssistantTask(submission.input, submission.requestId);
        if (!mounted.current) return;
        setTasks(previous => mergeTaskRecords(previous, [created])); setSessionId(created.sessionId);
        setPending(null); setDraft(current => current.trim() === submission.input.prompt ? "" : current);
        const ids = new Set((submission.input.metadata?.attachments as WorkAttachment[] | undefined)?.map(item => item.id));
        setAttachments(current => current.filter(item => !ids.has(item.id))); follow.current = true;
      } catch (reason) {
        if (reason instanceof NavigatorHttpError && reason.status < 500 && ![408, 429].includes(reason.status)) setPending(null);
        throw reason;
      }
    });
  };

  const selectSession = (id: string) => {
    if (busy || uploading || pending) return;
    setSessionId(id); setDraft(""); setAttachments([]); setError(""); setView("chat"); setRestoringHistory(false); follow.current = true;
    if (!id) { setPermission("ask"); setEffort(""); }
  };

  const upload = async (files: FileList | File[]) => {
    if (!mayOperate || uploading) return;
    const batch = Array.from(files), origin = selected.current;
    if (batch.length + attachments.length > 12) { fail(tx("最多附加 12 个文件。", "At most 12 files.")); return; }
    setUploading(true); setError("");
    try {
      for (const file of batch) {
        if ((file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i.test(file.name)) && modelInfo?.images !== true) {
          throw new Error(tx("当前模型没有声明图像支持，请选择支持图像的模型。", "The selected model does not advertise image support. Choose an image-capable model."));
        }
        if (file.size > 4 * 1024 * 1024) throw new Error(tx("单个附件不能超过 4 MB。", "Each attachment must be at most 4 MB."));
        const contentBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = () => reject(new Error("File read failed"));
          reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(file);
        });
        if (!mounted.current || selected.current !== origin) return;
        const item = await api.uploadWorkAttachment(effectiveWorkspace, { name: file.name, mediaType: file.type || "text/plain", contentBase64 });
        if (mounted.current && selected.current === origin) setAttachments(current => [...current, item]);
      }
    } catch (reason) { fail(reason); }
    finally { if (mounted.current) setUploading(false); }
  };

  const decide = (approval: WorkApproval, decision: "approved" | "rejected", scope: "once" | "task" = "once") => void act(async () => {
    // Approval identity comes from its owning task, never from the open graph.
    if (!mayOperate || !selectedTaskIds.has(approval.taskId)) return;
    await api.resolveWorkApproval(effectiveWorkspace, approval.id, decision, scope);
    await reloadApprovals(); await reloadTasks();
  });
  const answer = (input: WorkInput) => void act(async () => {
    if (!mayOperate || !selectedTaskIds.has(input.taskId)) return;
    const text = answers[input.id]?.trim(); if (!text) return;
    const previous = inputRequests.current.get(input.id);
    const messageId = previous?.answer === text ? previous.messageId : makeIdempotencyKey();
    inputRequests.current.set(input.id, { answer: text, messageId });
    await api.resolveWorkInput(effectiveWorkspace, input.id, text, messageId);
    inputRequests.current.delete(input.id); await reloadApprovals(); await reloadTasks();
  });

  const renderTask = (task: NavigatorTaskRecord) => {
    const workflow = taskWorkflow(task), samePipeline = !workflow || workflow.pipelineId === props.document.id;
    const taskRuntime = caps?.runtimes.find(runtime => runtime.id === (executionFor(task).runtime ?? "harness"));
    const changed = changedPipelineRecords(taskEvents[task.id] ?? []).filter(record => record.workspaceId === effectiveWorkspace);
    return <div key={task.id} data-task-id={task.id}>
      <article className="assistant-message user"><strong>{tx("你", "You")}</strong><p>{task.prompt}</p>
        {workflow && <details><summary>{tx("发送时的流程", "Pipeline when sent")}: {workflow.name}</summary><pre>{JSON.stringify(task.metadata.workflow, null, 2)}</pre></details>}
        {Array.isArray(task.metadata.attachments) && <small>{(task.metadata.attachments as WorkAttachment[]).map(item => item.name).join(" · ")}</small>}
      </article>
      {task.reasoning && <article className="assistant-message"><details><summary>{tx("思考摘要", "Reasoning")}</summary><Markdown text={task.reasoning} /></details></article>}
      {task.output && <article className="assistant-message"><Markdown text={task.output} /></article>}
      {(taskEvents[task.id] ?? []).filter(event => !["task.output", "task.reasoning", "text-delta", "reasoning-delta"].includes(event.name)).map(event => <article className="assistant-message tool" key={event.sequence}><small>⌘ {event.name === "tool-call" || event.name === "tool-result" ? `${String(event.data.tool ?? "Tool")} · ${event.name}` : assistantEventLabel(event)}</small></article>)}
      {changed.map(record => <article className="assistant-message assistant-workflow-result" key={record.document.id}><span>{tx("已保存流程", "Saved pipeline")}: {record.document.name} · v{record.graphRevision}</span><button onClick={() => void props.onOpenWorkflow(record.document.id).catch(fail)}>{tx("在画布中查看", "View in canvas")}</button></article>)}
      {approvals.filter(item => item.taskId === task.id).map(approval => <article key={approval.id} className="assistant-message approval">
        <strong>{tx("等待确认", "Approval required")}: {approval.summary}</strong>
        {workflow && <p>{tx("发起时的流程", "Originating pipeline")}: {workflow.name} <code>{workflow.pipelineId}</code></p>}
        {!samePipeline && <p role="status">{tx("当前画布已切换；此审批仍属于上方任务。", "The canvas changed; this approval still belongs to the task above.")}</p>}
        <details><summary>{tx("操作详情", "Operation details")}</summary><pre>{JSON.stringify(approval.details, null, 2)}</pre></details>
        <div className="assistant-actions"><button disabled={busy || !mayOperate} onClick={() => decide(approval, "approved")}>{tx("允许本次", "Allow once")}</button>
          {taskRuntime?.approvalScopes?.includes("task") && <button disabled={busy || !mayOperate} onClick={() => decide(approval, "approved", "task")}>{tx("允许本轮全部", "Allow for all")}</button>}
          <button disabled={busy || !mayOperate} onClick={() => decide(approval, "rejected")}>{tx("拒绝", "Decline")}</button></div>
      </article>)}
      {inputs.filter(item => item.taskId === task.id).map(input => <article key={input.id} className="assistant-message approval"><strong>{input.summary}</strong><textarea aria-label={tx("补充信息", "Requested input")} value={answers[input.id] ?? ""} onChange={event => setAnswers(previous => ({ ...previous, [input.id]: event.target.value }))} /><button disabled={busy || !mayOperate || !answers[input.id]?.trim()} onClick={() => answer(input)}>{tx("回答", "Answer")}</button></article>)}
      <article className="assistant-message assistant-muted"><span>{tx(...statusLabels[task.status])}</span> · <code>{task.id}</code>
        {task.error && <p role="alert">{task.error}</p>}
        {workflow && !changed.length && <button onClick={() => void props.onOpenWorkflow(workflow.pipelineId).catch(fail)}>{tx("查看发起时流程", "View originating pipeline")}</button>}
      </article>
    </div>;
  };

  return <section className="assistant-window" aria-label="AI Assistant" onDragOver={event => { if (mayOperate && event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void upload(event.dataTransfer.files); } }}>
    <header className="assistant-heading"><strong>AI Assistant</strong>
      <button aria-label={tx("新建聊天", "New chat")} title={tx("新建聊天", "New chat")} disabled={busy || uploading || !!pending} onClick={() => selectSession("")}>＋</button>
      <button aria-label={tx("聊天历史", "Chat history")} onClick={() => { setView(view === "history" ? "chat" : "history"); void reloadTasks().catch(fail); }}>◷</button>
      <button aria-label={tx("刷新智能体", "Refresh agents")} disabled={busy} onClick={() => void act(async () => { const session = await api.restoreSession(); setAuth(session); if (session.authenticated) { await reloadCapabilities(); await reloadTasks(); } })}>↻</button>
      {mayConfigure && <button aria-label={tx("助手设置", "Assistant settings")} onClick={() => setView(view === "settings" ? "chat" : "settings")}>⚙</button>}
      <button aria-label={tx("MCP 调试", "MCP tools")} onClick={() => { setMcpVisited(true); setView(view === "mcp" ? "chat" : "mcp"); }}>MCP</button>
      <button aria-label={props.expanded ? tx("停靠右侧", "Dock right") : tx("在主页面打开", "Open in editor")} onClick={props.onDock}>{props.expanded ? "⇥" : "↗"}</button>
    </header>
    {(error || capsError) && <div className="assistant-error" role="alert">{error || capsError}<button aria-label={tx("关闭错误", "Dismiss error")} onClick={() => { setError(""); setCapsError(""); }}>×</button></div>}
    {mcpVisited && <div className="assistant-aux" hidden={view !== "mcp"}><Suspense fallback={<p>MCP…</p>}><McpPanel key={props.document.id} document={props.document} selectedId={props.selectedId} onNotice={props.onNotice} onMonitor={props.onMonitor} /></Suspense></div>}
    {!auth?.authenticated && view !== "mcp" && <form className="assistant-aux" onSubmit={event => { event.preventDefault(); void act(async () => { setAuth(await api.pair(pairing)); setPairing(""); }); }}><p>{tx("使用现有 Navigator 配对会话连接智能体。", "Connect using the existing Navigator paired session.")}</p><label>{tx("一次性配对码", "One-time pairing code")}<input value={pairing} autoComplete="one-time-code" onChange={event => setPairing(event.target.value)} /></label><button disabled={busy || !pairing.trim()}>{tx("连接", "Connect")}</button></form>}
    {auth?.authenticated && <>
      {!aligned && <p className="assistant-error" role="status">{tx("Navigator 工作空间与当前工作空间不一致，无法提交操作。", "Navigator is connected to a different workspace; operations are unavailable.")}</p>}
      {view !== "chat" && <button className="assistant-back" aria-label={tx("返回聊天", "Back to chat")} onClick={() => setView("chat")}>← {tx("返回聊天", "Back to chat")}</button>}
      {view === "history" && <div className="assistant-aux"><button onClick={() => legacyInput.current?.click()}>{tx("读取旧聊天导出", "Read legacy chat export")}</button>{legacyChats.length > 0 && <button onClick={() => setView("legacy")}>{tx("查看已读取的旧聊天", "View imported legacy chats")}</button>}{sessions.map(session => <div className="assistant-history" key={session.id}><button disabled={busy || uploading || !!pending} onClick={() => selectSession(session.id)}><strong>{session.turns[0].title || session.turns[0].prompt.slice(0, 60)}</strong><small>{session.turns.length} {tx("轮对话", "turns")} · {new Date(session.turns.at(-1)!.createdAt).toLocaleString(locale)} · {tx(...statusLabels[session.turns.at(-1)!.status])}</small></button></div>)}
        {nextCursor && <button disabled={busy} onClick={() => void act(async () => { const page = await api.getAssistantTasks(nextCursor); historyExtended.current = true; setTasks(previous => mergeTaskRecords(previous, page.items)); setNextCursor(page.nextCursor); })}>{tx("加载更早记录", "Load earlier history")}</button>}
      </div>}
      {view === "legacy" && <div className="assistant-aux"><p role="status">{tx("旧聊天只读；导出的审批和运行状态不会恢复或执行。", "Legacy chats are read only. Exported approvals and executions cannot be resumed.")}</p>
        <select aria-label={tx("旧聊天", "Legacy chat")} value={legacyId} onChange={event => setLegacyId(event.target.value)}>{legacyChats.map(chat => <option key={chat.id} value={chat.id}>{chat.title || chat.id} · {chat.runtime}</option>)}</select>
        {legacyChats.find(chat => chat.id === legacyId)?.events.map(event => <article key={event.seq} className={`assistant-message ${event.type === "user" ? "user" : ""}`}><small>{event.type}</small><Markdown text={event.text} /></article>)}
      </div>}
      {view === "settings" && mayConfigure && <ProviderSettings providers={caps?.providers ?? []} api={api} onChanged={reloadCapabilities} tx={tx} />}
      <div className="assistant-conversation" hidden={view !== "chat"}>
        <div className="assistant-transcript" ref={transcript} onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
          {!turns.length && <div className="assistant-empty"><span>✧</span><h2>{sessionId ? tx("读取会话记录", "Reading session history") : tx("开始一段对话", "Start a conversation")}</h2><p>{restoringHistory ? tx("正在读取更早的任务记录…", "Reading earlier tasks…") : tx("使用 Navigator 执行、恢复与审批任务", "Execute, resume and approve tasks through Navigator")}</p>{sessionId && !restoringHistory && <button onClick={() => setView("history")}>{tx("在历史中选择会话", "Choose a session from history")}</button>}</div>}
          {turns.map(renderTask)}
        </div>
        <div className="assistant-compose-area">
          {pending && <div className="assistant-error" role="status">{tx("提交尚未确认。核对任务记录或用同一请求安全重试。", "Submission is unconfirmed. Check task history or retry the same request.")}<button disabled={busy} onClick={() => void send(pending)}>{tx("重试原请求", "Retry request")}</button></div>}
          <div className="assistant-chips">{attachments.map(item => <button key={item.id} disabled={busy || !!pending} onClick={() => setAttachments(previous => previous.filter(value => value.id !== item.id))}>{item.name} ×</button>)}</div>
          <div className="assistant-composer"><textarea aria-label={tx("消息", "Message")} placeholder={tx("询问、规划或操作工作空间…", "Ask, plan or work in your workspace…")} value={draft} disabled={!mayOperate || !!pending} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
            <div className="assistant-compose-tools"><button disabled={uploading || busy || !!pending || !mayOperate} onClick={() => fileInput.current?.click()}>{tx("附加文件", "Attach files")}</button><small>{props.document.name}</small><span />
              {activeTask ? <button disabled={busy || !mayOperate} onClick={() => void act(async () => { await api.cancelAssistantTask(activeTask.id); await reloadTasks(); })}>{tx("停止", "Stop")}</button>
                : <button className="assistant-send" aria-label={tx("发送", "Send")} disabled={busy || uploading || !!pending || !mayOperate || !draft.trim() || !runtime?.available || (runtimeId === "harness" && !!providerId && !provider?.configured) || (!!sessionId && (!lastTask || !runtime?.resume))} onClick={() => void send()}>↑</button>}
            </div>
          </div>
          <div className="assistant-model-bar">
            <select aria-label={tx("智能体", "Agent")} value={runtimeId} disabled={!!sessionId || !!activeTask || !!pending} onChange={event => setRuntimeId(event.target.value)}>{caps?.runtimes.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.name}{!item.available ? tx("（不可用）", " (unavailable)") : ""}</option>)}</select>
            {runtimeId === "harness" && <select aria-label={tx("API 提供方", "API provider")} value={providerId} disabled={!!sessionId || !!activeTask || !!pending} onChange={event => setProviderId(event.target.value)}><option value="" disabled={!runtime?.models.length && !!caps?.providers.length}>{tx("宿主默认模型", "Host default model")}</option>{caps?.providers.map(item => <option key={item.id} value={item.id} disabled={!item.configured}>{item.name}</option>)}</select>}
            {models.length > 0 && <select aria-label={tx("模型", "Model")} value={model} disabled={!!activeTask || !!pending} onChange={event => setModel(event.target.value)}>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            {!!modelInfo?.efforts.length && <select aria-label={tx("思考深度", "Reasoning effort")} value={effort} disabled={!!activeTask || !!pending} onChange={event => setEffort(event.target.value)}><option value="">{tx("默认思考深度", "Default reasoning")}</option>{modelInfo.efforts.map(value => <option key={value} value={value}>{value}</option>)}</select>}
            {!!runtime?.permissions.length && <select aria-label={tx("权限模式", "Permission mode")} value={permission} disabled={!!activeTask || !!pending} onChange={event => setPermission(event.target.value as AssistantPermission)}>{runtime.permissions.map(value => <option key={value} value={value}>{tx(...permissionLabels[value])}</option>)}</select>}
          </div>
          {runtime?.reason && <small className="assistant-muted">{runtime.reason}</small>}
          {runtime && !runtime.resume && sessionId && <small>{tx("该智能体不支持恢复会话，请新建聊天。", "This agent cannot resume sessions. Start a new chat.")}</small>}
          {permission === "full-access" && <small className="assistant-muted">{tx("智能体将按宿主能力自动执行；工作空间权限仍然生效。", "The agent uses its host permissions; workspace permissions still apply.")}</small>}
          {!mayOperate && <small>{tx("当前账号没有智能体执行权限。", "This account cannot execute agent tasks.")}</small>}
          {sessionId && <details className="assistant-session-details"><summary>{tx("会话信息", "Session details")}</summary><code>{sessionId}</code><span>Navigator · {effectiveWorkspace}</span></details>}
        </div>
      </div>
    </>}
    <input ref={fileInput} hidden type="file" multiple aria-label={tx("选择附件", "Choose attachments")} accept={modelInfo?.images ? undefined : ".txt,.md,.json,.yaml,.yml,.csv,.log,.py,.ts,.tsx,.js,.toml,.ini,.xml,.html,.css"} onChange={event => { if (event.target.files) void upload(event.target.files); event.target.value = ""; }} />
    <input ref={legacyInput} hidden type="file" accept="application/json,.json" aria-label={tx("选择旧聊天导出", "Choose legacy chat export")} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      if (file.size > 10 * 1024 * 1024) { fail(tx("旧聊天导出不能超过 10 MB。", "Legacy chat exports must be at most 10 MB.")); return; }
      void file.text().then(text => { const chats = parseLegacyHistory(JSON.parse(text), effectiveWorkspace); if (mounted.current) { setLegacyChats(chats); setLegacyId(chats[0]?.id ?? ""); setView("legacy"); } }, fail).catch(fail);
    }} />
  </section>;
}

function ProviderSettings({ providers, api, onChanged, tx }: { providers: AssistantProvider[]; api: NavigatorApi; onChanged(): Promise<void>; tx(zh: string, en: string): string }) {
  const [id, setId] = useState(""), [name, setName] = useState(""), [baseUrl, setBaseUrl] = useState(""), [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(""), [efforts, setEfforts] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [protocol, setProtocol] = useState<AssistantProtocol>("openai-completions"), [images, setImages] = useState(false);
  const select = (value: string) => {
    const provider = providers.find(item => item.id === value);
    setId(value); setName(provider?.name ?? ""); setBaseUrl(provider?.baseUrl ?? ""); setApiKey("");
    setModels(provider?.models.map(item => item.id).join("\n") ?? ""); setEfforts(provider?.models[0]?.efforts.join(",") ?? "");
    setProtocol(provider?.protocol ?? "openai-completions"); setImages(provider?.models[0]?.images === true);
  };
  return <form className="assistant-aux assistant-provider" onSubmit={event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    const previous = providers.find(provider => provider.id === id);
    const levelValues = efforts.split(",").map(item => item.trim()).filter(Boolean);
    const defaultsChanged = efforts !== (previous?.models[0]?.efforts.join(",") ?? "") || images !== (previous?.models[0]?.images === true);
    const input = { name: name.trim(), protocol, baseUrl: baseUrl.trim(), ...(apiKey ? { apiKey } : {}),
      models: models.split(/[\n,]/).map(value => value.trim()).filter(Boolean).map(value => {
        const existing = previous?.models.find(model => model.id === value);
        return existing && !defaultsChanged ? existing : { id: value, efforts: levelValues, images };
      }) };
    // Clear the credential field immediately. It is never persisted in browser storage.
    setApiKey(""); void api.saveAssistantProvider(id.trim(), input).then(onChanged, reason => setError(message(reason))).finally(() => setBusy(false));
  }}>
    <h3>{tx("API 配置", "API configuration")}</h3><p>{tx("凭据保存在 Navigator 宿主。请按提供方支持填写模型和思考深度。", "Credentials are saved by the Navigator host. Enter models and reasoning levels supported by your provider.")}</p>
    <label>{tx("已有提供方", "Existing provider")}<select aria-label={tx("已有提供方", "Existing provider")} value={providers.some(provider => provider.id === id) ? id : ""} onChange={event => select(event.target.value)}><option value="">{tx("新增提供方", "New provider")}</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
    <label>ID<input required pattern="[a-z][a-z0-9-]{0,63}" maxLength={64} value={id} onChange={event => setId(event.target.value)} /></label>
    <label>{tx("名称", "Name")}<input required value={name} onChange={event => setName(event.target.value)} /></label>
    <label>{tx("API 协议", "API protocol")}<select aria-label={tx("API 协议", "API protocol")} value={protocol} onChange={event => setProtocol(event.target.value as AssistantProtocol)}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
    <label>Base URL<input required type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /></label>
    <label>API Key<input type="password" autoComplete="off" value={apiKey} placeholder={tx("留空保留现有凭据", "Leave empty to keep current credentials")} onChange={event => setApiKey(event.target.value)} /></label>
    <label>{tx("模型 ID（每行一个）", "Model IDs (one per line)")}<textarea required value={models} onChange={event => setModels(event.target.value)} /></label>
    <label>{tx("思考深度（逗号分隔，可留空）", "Reasoning levels (comma separated, optional)")}<input value={efforts} onChange={event => setEfforts(event.target.value)} /></label>
    <label className="assistant-checkbox"><input type="checkbox" checked={images} onChange={event => setImages(event.target.checked)} />{tx("这些模型支持图像输入", "These models support image inputs")}</label>
    <div className="assistant-actions"><button disabled={busy || !id.trim() || !models.trim()}>{tx("保存", "Save")}</button>{providers.some(provider => provider.id === id) && <button type="button" disabled={busy} onClick={() => { setBusy(true); void api.deleteAssistantProvider(id).then(async () => { select(""); await onChanged(); }, reason => setError(message(reason))).finally(() => setBusy(false)); }}>{tx("删除提供方", "Delete provider")}</button>}</div>
    {error && <p role="alert">{error}</p>}
  </form>;
}
