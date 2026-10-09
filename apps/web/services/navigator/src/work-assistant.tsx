// -----------------------------------------------------------------------------
// Module: src/work-assistant.tsx
// Role: Thin same-origin UI for durable work, approvals, connectors and files.
// 中文：模块职责：为持久任务、审批、连接器和附件提供轻量同源界面。
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import QRCode from "qrcode";
import { makeIdempotencyKey, NavigatorHttpError, type MemoryFact, type NavigatorApi, type NavigatorTaskEvent, type NavigatorTaskRecord, type QqConnectorHealth, type QqLoginChallenge, type WorkApproval, type WorkAttachment, type WorkConnector, type WorkInput, type WorkNotification } from "./api";
import { assistantEventLabel, readAssistantTaskEvents } from "./task-event-stream";
import { isQqQrExpired } from "./qq-login";
import { Button, PageHeader, Panel, StateBlock, StatusPill } from "./components";
import { useI18n } from "./i18n";
import "./work-assistant.css";

const MAX_ATTACHMENT_BYTES = 10_000_000;
const TERMINAL_TASK_STATES = new Set(["completed", "failed", "aborted"]);
const TERMINAL_LOGIN_STATES = new Set(["authorized", "expired", "failed"]);

type QqChallengeView = Omit<QqLoginChallenge, "qrPayload">;

/**
 * Render owner-backed assistant resources through the existing paired session.
 * 中文：通过现有配对会话展示由服务端管理的助手资源。
 */
export function WorkAssistantPage({ api, workspaceId, canOperate, canWrite }: { api: NavigatorApi; workspaceId: string; canOperate: boolean; canWrite: boolean }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false), [pageError, setPageError] = useState("");
  const [hostWorkspaceId, setHostWorkspaceId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<NavigatorTaskRecord[]>([]), [tasksError, setTasksError] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState(""), [taskDetail, setTaskDetail] = useState<NavigatorTaskRecord | null>(null), [detailError, setDetailError] = useState("");
  const [taskEvents, setTaskEvents] = useState<NavigatorTaskEvent[]>([]), [streamError, setStreamError] = useState("");
  const [prompt, setPrompt] = useState(""), [sessionId, setSessionId] = useState(""), [taskBusy, setTaskBusy] = useState(false);
  const [approvals, setApprovals] = useState<WorkApproval[]>([]), [approvalsError, setApprovalsError] = useState(""), [approvalBusy, setApprovalBusy] = useState("");
  const [pendingInputs, setPendingInputs] = useState<WorkInput[]>([]), [inputsError, setInputsError] = useState(""), [inputAnswers, setInputAnswers] = useState<Record<string, string>>({}), [inputBusy, setInputBusy] = useState("");
  const [memoryFacts, setMemoryFacts] = useState<MemoryFact[]>([]), [memoryError, setMemoryError] = useState(""), [memoryQuery, setMemoryQuery] = useState(""), [memoryDraft, setMemoryDraft] = useState(""), [memoryKey, setMemoryKey] = useState(""), [memoryBusy, setMemoryBusy] = useState(false);
  const [notifications, setNotifications] = useState<WorkNotification[]>([]), [notificationsError, setNotificationsError] = useState("");
  const [connectors, setConnectors] = useState<WorkConnector[]>([]), [connectorsError, setConnectorsError] = useState("");
  const [bindingId, setBindingId] = useState(""), [qqHealth, setQqHealth] = useState<QqConnectorHealth | null>(null), [qqError, setQqError] = useState("");
  const [challenge, setChallenge] = useState<QqChallengeView | null>(null), [qrImage, setQrImage] = useState(""), [qrBusy, setQrBusy] = useState(false);
  const [attachments, setAttachments] = useState<WorkAttachment[]>([]), [attachmentBusy, setAttachmentBusy] = useState(false), [attachmentError, setAttachmentError] = useState("");
  const taskDetailRef = useRef<NavigatorTaskRecord | null>(null);
  const taskStreamControllerRef = useRef<AbortController | null>(null);
  const streamCursors = useRef(new Map<string, number>());
  const inputMessageIdsRef = useRef(new Map<string, { answer: string; messageId: string }>());
  useEffect(() => { taskDetailRef.current = taskDetail; }, [taskDetail]);
  const effectiveWorkspaceId = hostWorkspaceId || workspaceId;
  const workspaceAligned = !hostWorkspaceId || !workspaceId || hostWorkspaceId === workspaceId;
  const mayOperate = canOperate && workspaceAligned;
  const mayWrite = canWrite && workspaceAligned;

  useEffect(() => {
    let active = true;
    void api.getSystemStatus().then(status => { if (active) setHostWorkspaceId(status.workspaceId || null); }, () => { if (active) setHostWorkspaceId(null); });
    return () => { active = false; };
  }, [api]);

  const refreshAll = useCallback(async () => {
    setLoading(true); setPageError("");
    const results = await Promise.all([
      api.getAssistantTasks().then(page => { setTasks(page.items); setTasksError(""); setSelectedTaskId(current => current || page.items[0]?.id || ""); return true; }).catch(error => { setTasksError(errorText(error)); return false; }),
      api.getWorkApprovals(effectiveWorkspaceId).then(items => { setApprovals(items); setApprovalsError(""); return true; }).catch(error => { setApprovalsError(errorText(error)); return false; }),
      api.getWorkInputs(effectiveWorkspaceId).then(items => { setPendingInputs(items); setInputsError(""); return true; }).catch(error => { setInputsError(errorText(error)); return false; }),
      api.getMemoryFacts(effectiveWorkspaceId).then(items => { setMemoryFacts(items); setMemoryError(""); return true; }).catch(error => { setMemoryError(errorText(error)); return false; }),
      api.getWorkNotifications(effectiveWorkspaceId).then(items => { setNotifications(items); setNotificationsError(""); return true; }).catch(error => { setNotificationsError(errorText(error)); return false; }),
      api.getWorkConnectors(effectiveWorkspaceId).then(items => {
        setConnectors(items); setConnectorsError("");
        setBindingId(current => current || items.find(item => item.connectorId.toLowerCase().includes("qq"))?.connectorId || "");
        return true;
      }).catch(error => { setConnectorsError(errorText(error)); return false; }),
    ]);
    if (!results.some(Boolean)) setPageError(t("All work services could not be read."));
    setLoading(false);
  }, [api, effectiveWorkspaceId, t]);

  useEffect(() => { void refreshAll(); }, [refreshAll]);

  useEffect(() => {
    if (!selectedTaskId) { setTaskDetail(null); return; }
    const controller = new AbortController();
    setTaskDetail(current => current?.id === selectedTaskId ? current : null);
    setDetailError(""); setTaskEvents([]); setStreamError("");
    void api.getAssistantTask(selectedTaskId, controller.signal).then(value => {
      if (!controller.signal.aborted) setTaskDetail(value);
    }, error => { if (!controller.signal.aborted) setDetailError(errorText(error)); });
    return () => controller.abort();
  }, [api, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId || (taskDetail?.id === selectedTaskId && TERMINAL_TASK_STATES.has(taskDetail.status))) return;
    const controller = new AbortController();
    taskStreamControllerRef.current = controller;
    let cursor = streamCursors.current.get(selectedTaskId) ?? 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false, refreshAgain = false;
    const refresh = async () => {
      if (controller.signal.aborted) return;
      if (refreshing) { refreshAgain = true; return; }
      refreshing = true;
      try {
        const value = await api.getAssistantTask(selectedTaskId, controller.signal);
        if (!controller.signal.aborted) {
          setTaskDetail(current => current?.id === value.id && current.sequence > value.sequence ? current : value);
          setTasks(current => current.map(task => task.id === value.id && task.sequence <= value.sequence ? value : task));
          const [nextApprovals, nextInputs] = await Promise.all([api.getWorkApprovals(effectiveWorkspaceId), api.getWorkInputs(effectiveWorkspaceId)]);
          if (!controller.signal.aborted) { setApprovals(nextApprovals); setPendingInputs(nextInputs); }
        }
      } catch (error) { if (!controller.signal.aborted) setDetailError(errorText(error)); }
      finally { refreshing = false; if (refreshAgain && !controller.signal.aborted) { refreshAgain = false; scheduleRefresh(); } }
    };
    const scheduleRefresh = () => {
      if (refreshTimer || controller.signal.aborted) return;
      refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh(); }, 500);
    };
    const connect = async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await api.openAssistantTaskEvents(selectedTaskId, cursor, controller.signal);
          cursor = await readAssistantTaskEvents(response, cursor, controller.signal, event => {
            if (controller.signal.aborted) return;
            streamCursors.current.set(selectedTaskId, event.sequence);
            setTaskEvents(previous => previous.some(item => item.sequence === event.sequence) ? previous : [...previous.slice(-99), event]);
            scheduleRefresh();
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          setStreamError(errorText(error));
          if (error instanceof NavigatorHttpError && error.status < 500 && error.status !== 408 && error.status !== 429) return;
        }
        if (controller.signal.aborted || (taskDetailRef.current?.id === selectedTaskId && TERMINAL_TASK_STATES.has(taskDetailRef.current.status))) return;
        await pause(1200, controller.signal);
      }
    };
    void connect();
    return () => {
      controller.abort();
      clearTimeout(refreshTimer);
      if (taskStreamControllerRef.current === controller) taskStreamControllerRef.current = null;
    };
  }, [api, selectedTaskId, effectiveWorkspaceId, taskDetail?.id === selectedTaskId && TERMINAL_TASK_STATES.has(taskDetail.status)]);

  useEffect(() => {
    if (taskDetail?.id === selectedTaskId && TERMINAL_TASK_STATES.has(taskDetail.status)) taskStreamControllerRef.current?.abort();
  }, [taskDetail?.status]);

  useEffect(() => {
    if (!bindingId) { setQqHealth(null); return; }
    const controller = new AbortController();
    setQqError("");
    void api.getQqHealth(effectiveWorkspaceId, bindingId).then(value => {
      if (!controller.signal.aborted) setQqHealth(value);
    }, error => {
      if (!controller.signal.aborted) { setQqHealth(null); setQqError(errorText(error)); }
    });
    return () => controller.abort();
  }, [api, effectiveWorkspaceId, bindingId, connectors.length]);

  useEffect(() => {
    if (!challenge || isQqQrExpired(challenge.expiresAtUtc)) {
      if (challenge) { setChallenge(current => current ? { ...current, state: "expired" } : null); setQrImage(""); }
      return;
    }
    const timer = setTimeout(() => { setChallenge(current => current ? { ...current, state: "expired" } : null); setQrImage(""); }, Math.max(0, Date.parse(challenge.expiresAtUtc) - Date.now()));
    return () => clearTimeout(timer);
  }, [challenge?.loginId, challenge?.expiresAtUtc]);

  useEffect(() => {
    if (!challenge || TERMINAL_LOGIN_STATES.has(challenge.state) || isQqQrExpired(challenge.expiresAtUtc) || !bindingId) return;
    let active = true;
    const timer = setInterval(() => {
      void api.pollQqLogin(effectiveWorkspaceId, bindingId, challenge.loginId).then(value => {
        if (!active || value.loginId !== challenge.loginId) return;
        setChallenge(current => current?.loginId === value.loginId ? { ...current, state: value.state, accountId: value.accountId } : current);
        if (value.state === "authorized" || value.state === "expired" || value.state === "failed") setQrImage("");
        setQqError("");
      }, error => { if (active) setQqError(errorText(error)); });
    }, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [api, effectiveWorkspaceId, bindingId, challenge?.loginId, challenge?.state, challenge?.expiresAtUtc]);

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || taskBusy || !mayOperate) return;
    setTaskBusy(true); setTasksError("");
    try {
      const created = await api.createAssistantTask({ prompt: prompt.trim(), ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}) });
      setPrompt(""); setSelectedTaskId(created.id); setTaskDetail(created); setTaskEvents([]);
      await reloadTasks();
    } catch (error) { setTasksError(errorText(error)); }
    finally { setTaskBusy(false); }
  };

  const reloadTasks = async () => {
    try { const page = await api.getAssistantTasks(); setTasks(page.items); setTasksError(""); }
    catch (error) { setTasksError(errorText(error)); }
  };

  const cancelTask = async () => {
    if (!taskDetail || !mayOperate || taskBusy) return;
    setTaskBusy(true);
    try {
      await api.cancelAssistantTask(taskDetail.id);
      const current = await api.getAssistantTask(taskDetail.id);
      setTaskDetail(current); setDetailError(""); await reloadTasks();
    } catch (error) { setDetailError(errorText(error)); }
    finally { setTaskBusy(false); }
  };

  const resolveApproval = async (approvalId: string, decision: "approved" | "rejected") => {
    setApprovalBusy(approvalId);
    try {
      await api.resolveWorkApproval(effectiveWorkspaceId, approvalId, decision);
      setApprovals(items => items.filter(item => item.id !== approvalId)); setApprovalsError("");
      await reloadTasks();
    } catch (error) { setApprovalsError(errorText(error)); }
    finally { setApprovalBusy(""); }
  };

  const answerWorkInput = async (inputId: string) => {
    const answer = inputAnswers[inputId]?.trim();
    if (!answer || !mayOperate || inputBusy) return;
    const previousRequest = inputMessageIdsRef.current.get(inputId);
    const messageId = previousRequest?.answer === answer ? previousRequest.messageId : makeIdempotencyKey();
    inputMessageIdsRef.current.set(inputId, { answer, messageId });
    setInputBusy(inputId); setInputsError("");
    try {
      await api.resolveWorkInput(effectiveWorkspaceId, inputId, answer, messageId);
      setPendingInputs(items => items.filter(item => item.id !== inputId));
      setInputAnswers(current => { const next = { ...current }; delete next[inputId]; return next; });
      inputMessageIdsRef.current.delete(inputId);
      await reloadTasks();
    } catch (error) {
      setInputsError(errorText(error));
      void api.getWorkInputs(effectiveWorkspaceId).then(setPendingInputs, () => undefined);
    }
    finally { setInputBusy(""); }
  };

  const searchMemory = async (event: FormEvent) => {
    event.preventDefault();
    if (!memoryQuery.trim()) { await loadMemory(); return; }
    setMemoryError("");
    try { setMemoryFacts(await api.queryMemory(effectiveWorkspaceId, memoryQuery.trim())); }
    catch (error) { setMemoryError(errorText(error)); }
  };

  const loadMemory = async () => {
    try { setMemoryFacts(await api.getMemoryFacts(effectiveWorkspaceId)); setMemoryError(""); }
    catch (error) { setMemoryError(errorText(error)); }
  };

  const saveMemory = async (event: FormEvent) => {
    event.preventDefault();
    if (!memoryKey.trim() || !memoryDraft.trim() || memoryBusy || !mayWrite) return;
    setMemoryBusy(true);
    try {
      await api.saveMemoryFact(effectiveWorkspaceId, { namespace: "work", key: memoryKey.trim(), value: { text: memoryDraft.trim() }, sourceId: "client:manual-note" });
      setMemoryKey(""); setMemoryDraft(""); await loadMemory();
    } catch (error) { setMemoryError(errorText(error)); }
    finally { setMemoryBusy(false); }
  };

  const uploadAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setAttachmentError("");
    if (file.size > MAX_ATTACHMENT_BYTES) { setAttachmentError(t("Attachments are limited to 10 MB.")); return; }
    setAttachmentBusy(true);
    try {
      const contentBase64 = await fileToBase64(file);
      const record = await api.uploadWorkAttachment(effectiveWorkspaceId, { name: file.name, mediaType: file.type || "application/octet-stream", contentBase64 });
      setAttachments(previous => [record, ...previous.filter(item => item.sha256 !== record.sha256)]);
    } catch (error) { setAttachmentError(errorText(error)); }
    finally { setAttachmentBusy(false); }
  };

  const downloadAttachment = async (attachment: WorkAttachment) => {
    setAttachmentError("");
    try {
      const response = await api.downloadWorkAttachment(effectiveWorkspaceId, attachment.sha256);
      const href = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = href; anchor.download = safeFilename(attachment.name); anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (error) { setAttachmentError(errorText(error)); }
  };

  const startQqLogin = async () => {
    if (!bindingId || !canRequestQqQr(qqHealth) || qrBusy || !mayOperate) return;
    setQrBusy(true); setQqError(""); setQrImage(""); setChallenge(null);
    try {
      const response = await api.startQqLogin(effectiveWorkspaceId, bindingId);
      if (isQqQrExpired(response.expiresAtUtc)) throw new Error(t("The QQ login QR expired before it could be displayed."));
      let image: string;
      try { image = await QRCode.toDataURL(response.qrPayload, { errorCorrectionLevel: "M", margin: 2, width: 240 }); }
      catch { throw new Error(t("The QQ login QR could not be rendered locally.")); }
      if (isQqQrExpired(response.expiresAtUtc)) throw new Error(t("The QQ login QR expired before it could be displayed."));
      setChallenge({ loginId: response.loginId, expiresAtUtc: response.expiresAtUtc, state: response.state, accountId: response.accountId });
      setQrImage(image);
    } catch (error) { setQqError(errorText(error)); }
    finally { setQrBusy(false); }
  };

  const refreshQq = async () => {
    if (!bindingId) return;
    setQqError("");
    try { setQqHealth(await api.getQqHealth(effectiveWorkspaceId, bindingId)); }
    catch (error) { setQqHealth(null); setQqError(errorText(error)); }
  };

  const taskActive = !!taskDetail && !TERMINAL_TASK_STATES.has(taskDetail.status);
  return <div className="page-container work-assistant">
    <PageHeader eyebrow={t("WORK ASSISTANT")} title={t("Work assistant")} description={t("Tasks run beside the paired Navigator host; workspace data stays with its owner.")} action={<Button onClick={() => void refreshAll()} disabled={loading}>{loading ? t("Refreshing...") : t("Refresh all")}</Button>} />
    {!workspaceAligned && <p role="alert" className="work-assistant__notice work-assistant__notice--error">{t("Selected workspace does not match the Navigator host configuration.")} {workspaceId} ≠ {hostWorkspaceId}</p>}
    {!mayOperate && <p className="work-assistant__notice">{t("Execution permission is required to create tasks, resolve approvals, answer requests, or start QQ login.")}</p>}
    {pageError && <p role="alert" className="work-assistant__notice work-assistant__notice--error">{pageError}</p>}

    <div className="work-assistant__grid">
      <Panel title={t("Create a task")} meta={<span>{t("Task state is owned by Navigator")}</span>}>
        <form className="work-assistant__form" onSubmit={event => void createTask(event)}>
          <label>{t("Prompt")}<textarea value={prompt} maxLength={100000} rows={4} onChange={event => setPrompt(event.target.value)} placeholder={t("Describe the work to perform on this Navigator host.")} /></label>
          <label>{t("Continue an agent session (optional)")}<input value={sessionId} maxLength={512} onChange={event => setSessionId(event.target.value)} placeholder={t("Leave blank to start a new agent session")} /></label>
          <div className="work-assistant__actions"><Button tone="primary" disabled={taskBusy || !mayOperate || !prompt.trim()}>{taskBusy ? t("Submitting...") : t("Create task")}</Button><span>{t("A task remains active on its host after this page closes.")}</span></div>
        </form>
        {tasksError && <StateBlock kind="error" title={t("Tasks unavailable")} detail={tasksError} action={<Button onClick={() => void reloadTasks()}>{t("Try again")}</Button>} />}
      </Panel>

      <Panel title={t("Assistant tasks")} meta={<Button onClick={() => void reloadTasks()}>{t("Refresh tasks")}</Button>}>
        {tasksError ? <p className="work-assistant__muted">{t("The task list did not load.")}</p> : tasks.length ? <ul className="work-assistant__task-list">
          {tasks.map(task => <li key={task.id}><button className={task.id === selectedTaskId ? "is-selected" : ""} onClick={() => setSelectedTaskId(task.id)}>
            <span><strong>{task.title || task.prompt.slice(0, 80)}</strong><small>{task.id} · {formatTime(task.createdAt)}</small></span><StatusPill value={task.status} />
          </button></li>)}
        </ul> : <StateBlock kind="empty" title={t("No tasks yet")} detail={t("New tasks appear here after Navigator accepts them.")} />}
      </Panel>

      <Panel title={t("Task detail")} meta={taskDetail ? <StatusPill value={taskDetail.status} /> : undefined} className="work-assistant__detail">
        {detailError ? <StateBlock kind="error" title={t("Task could not be read")} detail={detailError} action={<Button onClick={() => void api.getAssistantTask(selectedTaskId).then(setTaskDetail, error => setDetailError(errorText(error)))}>{t("Try again")}</Button>} /> : taskDetail ? <>
          <dl className="work-assistant__facts"><dt>{t("Task ID")}</dt><dd>{taskDetail.id}</dd><dt>{t("Agent session")}</dt><dd>{taskDetail.sessionId}</dd><dt>{t("Created")}</dt><dd>{formatTime(taskDetail.createdAt)}</dd></dl>
          <h3>{t("Prompt")}</h3><pre className="work-assistant__text">{taskDetail.prompt}</pre>
          {taskDetail.output ? <><h3>{t("Output")}</h3><pre className="work-assistant__text">{taskDetail.output}</pre></> : null}
          {taskDetail.error ? <><h3>{t("Error")}</h3><pre className="work-assistant__text work-assistant__text--error">{taskDetail.error}</pre></> : null}
          {taskDetail.reasoning ? <details><summary>{t("Reasoning")}</summary><pre className="work-assistant__text">{taskDetail.reasoning}</pre></details> : null}
          {taskActive && <div className="work-assistant__actions"><Button tone="danger" disabled={!mayOperate || taskBusy} onClick={() => void cancelTask()}>{taskBusy ? t("Working...") : t("Request cancellation")}</Button><span>{t("Cancellation is a request; the server reports the final state.")}</span></div>}
          <div className="work-assistant__event-list"><h3>{t("Live task events")}</h3>{streamError && <p role="status">{t("Event stream status")}: {streamError}</p>}{taskEvents.length ? taskEvents.map(item => <p key={item.sequence}><code>#{item.sequence}</code> {assistantEventLabel(item)}</p>) : <p className="work-assistant__muted">{t("No task events received yet.")}</p>}</div>
        </> : <StateBlock kind="empty" title={t("Select a task")} detail={t("Task details and sequenced events are read from Navigator.")} />}
      </Panel>

      <Panel title={t("Approvals")} meta={<span>{approvals.length}</span>}>
        {approvalsError ? <StateBlock kind="error" title={t("Approvals unavailable")} detail={approvalsError} /> : approvals.length ? <ul className="work-assistant__rows">
          {approvals.map(approval => <li key={approval.id}><div><strong>{approval.summary}</strong><small>{approval.kind} · {approval.id} · {t("Task")} {approval.taskId}</small>{Object.keys(approval.details).length > 0 && <details><summary>{t("Approval details")}</summary><pre className="work-assistant__text">{compactJson(approval.details)}</pre></details>}</div><div className="work-assistant__actions"><Button disabled={!mayOperate || approvalBusy === approval.id} onClick={() => void resolveApproval(approval.id, "approved")}>{t("Approve")}</Button><Button tone="danger" disabled={!mayOperate || approvalBusy === approval.id} onClick={() => void resolveApproval(approval.id, "rejected")}>{t("Reject")}</Button></div></li>)}
        </ul> : <StateBlock kind="empty" title={t("No pending approvals")} detail={t("The workspace has not reported any pending decision.")} />}
      </Panel>

      <Panel title={t("Waiting for your input")} meta={<span>{pendingInputs.length}</span>}>
        {inputsError ? <StateBlock kind="error" title={t("User input unavailable")} detail={inputsError} /> : pendingInputs.length ? <ul className="work-assistant__rows work-assistant__rows--stacked">
          {pendingInputs.map(input => <li key={input.id}><div><strong>{input.summary}</strong><small>{t("Task")} {input.taskId} · {input.id} · {formatTime(input.createdAt)}</small>{Object.keys(input.details).length > 0 && <details><summary>{t("Input details")}</summary><pre className="work-assistant__text">{compactJson(input.details)}</pre></details>}<label>{t("Your answer")}<textarea value={inputAnswers[input.id] ?? ""} maxLength={4000} rows={2} onChange={event => setInputAnswers(current => ({ ...current, [input.id]: event.target.value }))} /></label><Button tone="primary" disabled={!mayOperate || inputBusy.length > 0 || !inputAnswers[input.id]?.trim()} onClick={() => void answerWorkInput(input.id)}>{inputBusy === input.id ? t("Submitting...") : t("Send answer")}</Button></div><StatusPill value={input.status} /></li>)}
        </ul> : <StateBlock kind="empty" title={t("No pending inputs")} detail={t("Navigator has not requested any additional information.")} />}
      </Panel>

      <Panel title={t("Work memory")} meta={<Button onClick={() => void loadMemory()}>{t("Refresh memory")}</Button>}>
        <form className="work-assistant__inline-form" onSubmit={event => void searchMemory(event)}><label>{t("Search durable facts")}<input value={memoryQuery} onChange={event => setMemoryQuery(event.target.value)} /></label><Button>{t("Search")}</Button><Button type="button" onClick={() => { setMemoryQuery(""); void loadMemory(); }}>{t("Show all")}</Button></form>
        <form className="work-assistant__form work-assistant__form--compact" onSubmit={event => void saveMemory(event)}><label>{t("Fact key")}<input value={memoryKey} onChange={event => setMemoryKey(event.target.value)} maxLength={512} /></label><label>{t("Note")}<textarea value={memoryDraft} onChange={event => setMemoryDraft(event.target.value)} rows={2} maxLength={2000} /></label><Button disabled={!mayWrite || memoryBusy || !memoryKey.trim() || !memoryDraft.trim()}>{memoryBusy ? t("Saving...") : t("Save note")}</Button></form>
        {memoryError ? <StateBlock kind="error" title={t("Memory unavailable")} detail={memoryError} /> : memoryFacts.length ? <ul className="work-assistant__rows work-assistant__rows--stacked">{memoryFacts.map(fact => <li key={fact.id}><div><strong>{fact.namespace} / {fact.key}</strong><p>{compactJson(fact.value)}</p><small>{t("Source")}: {fact.sourceId || t("Not reported")} · {formatTime(fact.observedAt)}</small></div><StatusPill value={fact.missing ? "missing" : fact.stale ? "stale" : "fresh"} /></li>)}</ul> : <StateBlock kind="empty" title={t("No memory facts")} detail={t("No facts were returned for this workspace query.")} />}
      </Panel>

      <Panel title={t("Notifications")} meta={<Button onClick={() => void refreshAll()}>{t("Refresh notifications")}</Button>}>
        {notificationsError ? <StateBlock kind="error" title={t("Notifications unavailable")} detail={notificationsError} /> : notifications.length ? <ul className="work-assistant__rows">{notifications.map(item => <li key={item.id}><div><strong>{item.type}</strong><small>{item.id} · {formatTime(item.createdAt)}</small></div><StatusPill value={item.status} /></li>)}</ul> : <StateBlock kind="empty" title={t("No notifications")} detail={t("The durable notification outbox is empty.")} />}
      </Panel>

      <Panel title={t("Attachments")} meta={<span>{t("Maximum 10 MB")}</span>}>
        <label className="work-assistant__file">{t("Upload a workspace attachment")}<input type="file" disabled={!mayWrite || attachmentBusy} onChange={event => void uploadAttachment(event)} /></label>
        {attachmentError && <p role="alert" className="work-assistant__notice work-assistant__notice--error">{attachmentError}</p>}
        {attachments.length ? <ul className="work-assistant__rows work-assistant__rows--stacked">{attachments.map(attachment => <li key={attachment.sha256}><div><strong>{attachment.name}</strong><small>{attachment.mediaType} · {formatBytes(attachment.size)} · SHA-256 {attachment.sha256}</small></div><Button onClick={() => void downloadAttachment(attachment)}>{t("Download")}</Button></li>)}</ul> : <p className="work-assistant__muted">{attachmentBusy ? t("Uploading...") : t("Uploaded files are listed here for this view; the workspace service stores the durable attachment.")}</p>}
      </Panel>

      <Panel title={t("QQ connector on this Navigator host")} meta={<Button onClick={() => void refreshQq()} disabled={!bindingId}>{t("Refresh connector health")}</Button>}>
        <p className="work-assistant__muted">{t("Connector commands run beside the paired Navigator host. No remote Client host is registered.")}</p>
        <label>{t("QQ binding ID")}<select value={bindingId} onChange={event => setBindingId(event.target.value)}><option value="">{t("Choose or enter a binding below")}</option>{connectors.map(connector => <option key={connector.connectorId} value={connector.connectorId}>{connector.connectorId}</option>)}</select></label>
        <label className="work-assistant__binding-input">{t("Configured binding ID")}<input value={bindingId} onChange={event => setBindingId(event.target.value)} maxLength={256} /></label>
        {connectorsError && <p role="status" className="work-assistant__notice work-assistant__notice--error">{t("Connector list unavailable")}: {connectorsError}</p>}
        {connectors.length > 0 && <ul className="work-assistant__rows">{connectors.map(connector => <li key={connector.connectorId}><div><strong>{connector.connectorId}</strong><small>{connector.accountId || t("Account not reported")} · {t("Updated")}: {formatTime(connector.updatedAt)}</small>{connector.detail && <small>{connector.detail}</small>}</div><StatusPill value={connector.status} /></li>)}</ul>}
        {qqError && <p role="status" className="work-assistant__notice work-assistant__notice--error">{qqError}</p>}
        {qqHealth ? <dl className="work-assistant__facts"><dt>{t("Connector health")}</dt><dd><StatusPill value={qqHealth.status} /></dd><dt>{t("QQ host")}</dt><dd>{qqHealth.hostState}</dd><dt>{t("Client API ready")}</dt><dd>{qqHealth.apiReady ? t("Yes") : t("No")}</dd><dt>{t("Account confirmed")}</dt><dd>{qqHealth.accountConfirmed ? t("Yes") : t("No")}</dd>{qqHealth.generation !== null && <><dt>{t("Host generation")}</dt><dd>{qqHealth.generation}</dd></>}{qqHealth.clientVersion && <><dt>{t("Client version")}</dt><dd>{qqHealth.clientVersion}</dd></>}{qqHealth.failureCode && <><dt>{t("Failure code")}</dt><dd>{qqHealth.failureCode}</dd></>}</dl> : <StateBlock kind={qqError ? "error" : "empty"} title={t("QQ health not available")} detail={qqError || t("The configured QQ bridge has not reported live host and account state.")} />}
        <div className="work-assistant__actions"><Button tone="primary" disabled={!mayOperate || qrBusy || !bindingId || !canRequestQqQr(qqHealth)} onClick={() => void startQqLogin()}>{qrBusy ? t("Requesting QR...") : t("Show QQ login QR")}</Button>{qqHealth && !qqHealth.accountConfirmed && <span>{t("Confirm the dedicated QQ account in host configuration before requesting a QR.")}</span>}</div>
        {challenge && <div className="work-assistant__qr" aria-live="polite"><div>{qrImage && !TERMINAL_LOGIN_STATES.has(challenge.state) ? <img src={qrImage} alt={t("QQ login QR code")} /> : <p>{challenge.state === "expired" ? t("This QR code has expired. Request a new one.") : t("QR code hidden after login state changed.")}</p>}</div><div><strong>{t("Login state")}: {challenge.state}</strong><p>{t("Expires")}: {formatIso(challenge.expiresAtUtc)}</p>{challenge.accountId && <p>{t("Confirmed account")}: {challenge.accountId}</p>}</div></div>}
      </Panel>
    </div>
  </div>;
}

function canRequestQqQr(health: QqConnectorHealth | null): boolean {
  return !!health?.accountConfirmed && health.hostState.toUpperCase() === "NATIVE_READY";
}

function errorText(error: unknown): string {
  if (error instanceof NavigatorHttpError) return `${error.code}: ${error.detail}`;
  return error instanceof Error ? error.message : "The request did not complete.";
}

function formatTime(timestamp?: number | null): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString();
}

function formatIso(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : "—";
}

function formatBytes(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(value < 1024 * 1024 ? 2 : 1)} MiB`;
}

function compactJson(value: Record<string, unknown>): string {
  const text = JSON.stringify(value);
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}

function safeFilename(value: string): string {
  return value.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 200) || "attachment";
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}
