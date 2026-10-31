// -----------------------------------------------------------------------------
// Module: src/work-assistant.tsx
// Role: Thin same-origin UI for durable work, approvals, connectors and files.
// 中文：模块职责：为持久任务、审批、连接器和附件提供轻量同源界面。
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import QRCode from "qrcode";
import { makeIdempotencyKey, NavigatorHttpError, type MemoryFact, type NavigatorApi, type NavigatorTaskEvent, type NavigatorTaskRecord, type QqConnectorHealth, type QqLoginChallenge, type WorkApproval, type WorkAttachment, type WorkConnector, type WorkInput, type WorkNotification } from "./api";
import { assistantEventLabel } from "./task-event-stream";
import { useTaskStream } from "./useTaskStream";
import { isQqQrExpired } from "./qq-login";
import { Button, PageHeader, Panel, StateBlock, StatusPill } from "./components";
import { useI18n } from "./i18n";
import "./work-assistant.css";

const MAX_ATTACHMENT_BYTES = 10_000_000;
const TERMINAL_TASK_STATES = new Set(["completed", "failed", "aborted"]);
const SETTLED_TASK_STATES = new Set([...TERMINAL_TASK_STATES, "waiting_approval", "waiting_input", "awaiting_user_authorization"]);
const PAUSED_TASK_STATES = new Set(["waiting_approval", "waiting_input", "awaiting_user_authorization"]);
const TERMINAL_LOGIN_STATES = new Set(["authorized", "expired", "failed"]);

type QqChallengeView = Omit<QqLoginChallenge, "qrPayload">;
type PendingTaskSubmission = { taskId: string; prompt: string; sessionId?: string };
type ApprovalDecision = "approved" | "rejected";
type ApprovalRequest = { workspaceId: string; approvalId: string; decision: ApprovalDecision; messageId: string };
type UncertainApproval = { approval: WorkApproval; decision: ApprovalDecision };

function approvalScopeKey(workspaceId: string, approvalId: string): string {
  return JSON.stringify([workspaceId, approvalId]);
}

/**
 * Render owner-backed assistant resources through the existing paired session.
 * 中文：通过现有配对会话展示由服务端管理的助手资源。
 */
export function WorkAssistantPage({ api, workspaceId, canOperate, canWrite }: { api: NavigatorApi; workspaceId: string; canOperate: boolean; canWrite: boolean }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false), [pageError, setPageError] = useState("");
  const [hostWorkspaceId, setHostWorkspaceId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true), [workspaceError, setWorkspaceError] = useState("");
  const workspaceProbe = useRef(0);
  const [tasks, setTasks] = useState<NavigatorTaskRecord[]>([]), [tasksError, setTasksError] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState(""), [taskDetail, setTaskDetail] = useState<NavigatorTaskRecord | null>(null), [detailError, setDetailError] = useState("");
  const [taskEvents, setTaskEvents] = useState<NavigatorTaskEvent[]>([]), [streamError, setStreamError] = useState("");
  const [prompt, setPrompt] = useState(""), [sessionId, setSessionId] = useState(""), [taskBusy, setTaskBusy] = useState(false);
  const [pendingTask, setPendingTask] = useState<PendingTaskSubmission | null>(null);
  const [approvals, setApprovals] = useState<WorkApproval[]>([]), [approvalsError, setApprovalsError] = useState(""), [approvalBusy, setApprovalBusy] = useState("");
  const [approvalRetries, setApprovalRetries] = useState<Record<string, ApprovalDecision>>({});
  const [uncertainApprovals, setUncertainApprovals] = useState<Record<string, UncertainApproval>>({});
  const [pendingInputs, setPendingInputs] = useState<WorkInput[]>([]), [inputsError, setInputsError] = useState(""), [inputAnswers, setInputAnswers] = useState<Record<string, string>>({}), [inputBusy, setInputBusy] = useState("");
  const [memoryFacts, setMemoryFacts] = useState<MemoryFact[]>([]), [memoryError, setMemoryError] = useState(""), [memoryQuery, setMemoryQuery] = useState(""), [memoryDraft, setMemoryDraft] = useState(""), [memoryKey, setMemoryKey] = useState(""), [memoryBusy, setMemoryBusy] = useState(false);
  const [notifications, setNotifications] = useState<WorkNotification[]>([]), [notificationsError, setNotificationsError] = useState("");
  const [connectors, setConnectors] = useState<WorkConnector[]>([]), [connectorsError, setConnectorsError] = useState("");
  const [bindingId, setBindingId] = useState(""), [qqHealth, setQqHealth] = useState<QqConnectorHealth | null>(null), [qqError, setQqError] = useState("");
  const [challenge, setChallenge] = useState<QqChallengeView | null>(null), [qrImage, setQrImage] = useState(""), [qrBusy, setQrBusy] = useState(false);
  const [attachments, setAttachments] = useState<WorkAttachment[]>([]), [attachmentBusy, setAttachmentBusy] = useState(false), [attachmentError, setAttachmentError] = useState("");
  const inputMessageIdsRef = useRef(new Map<string, { answer: string; messageId: string }>());
  const approvalRequestsRef = useRef(new Map<string, ApprovalRequest>());
  const uncertainApprovalScopesRef = useRef(new Set<string>());
  const effectiveWorkspaceId = workspaceId;
  const workspaceKnown = !!hostWorkspaceId;
  const workspaceAligned = workspaceKnown && !!workspaceId && hostWorkspaceId === workspaceId;
  const workspaceScope = useRef({ selected: workspaceId, host: hostWorkspaceId });
  workspaceScope.current = { selected: workspaceId, host: hostWorkspaceId };
  const isCurrentWorkspace = useCallback((expectedWorkspaceId: string) => {
    const current = workspaceScope.current;
    return !!expectedWorkspaceId && current.selected === expectedWorkspaceId && current.host === expectedWorkspaceId;
  }, []);
  const reconcileApprovalSnapshot = useCallback((requestedWorkspaceId: string, items: WorkApproval[]) => {
    const pendingIds = new Set(items.map(item => item.id));
    for (const [key, request] of approvalRequestsRef.current) {
      if (request.workspaceId === requestedWorkspaceId && !pendingIds.has(request.approvalId)
        && !uncertainApprovalScopesRef.current.has(approvalScopeKey(requestedWorkspaceId, request.approvalId))) {
        approvalRequestsRef.current.delete(key);
      }
    }
    setApprovalRetries(previous => {
      const next = { ...previous };
      for (const approvalId of Object.keys(next)) {
        if (!pendingIds.has(approvalId) && !uncertainApprovalScopesRef.current.has(approvalScopeKey(requestedWorkspaceId, approvalId))) delete next[approvalId];
      }
      return next;
    });
    setApprovals(items);
  }, []);
  const mayOperate = canOperate && workspaceAligned;
  const mayWrite = canWrite && workspaceAligned;

  const reloadWorkspace = useCallback(async () => {
    const generation = ++workspaceProbe.current;
    setWorkspaceLoading(true); setWorkspaceError(""); setHostWorkspaceId(null);
    try {
      const status = await api.getSystemStatus();
      if (!status.workspaceId) throw new Error(t("Navigator did not report a workspace identity."));
      if (generation === workspaceProbe.current) setHostWorkspaceId(status.workspaceId);
    } catch (error) { if (generation === workspaceProbe.current) setWorkspaceError(errorText(error)); }
    finally { if (generation === workspaceProbe.current) setWorkspaceLoading(false); }
  }, [api, t]);
  useEffect(() => { void reloadWorkspace(); return () => { workspaceProbe.current++; }; }, [reloadWorkspace]);

  const refreshAll = useCallback(async () => {
    setLoading(true); setPageError("");
    if (!workspaceAligned) {
      setTasks([]); setSelectedTaskId(""); setTaskDetail(null); setTaskEvents([]);
      setTasksError(""); setDetailError(""); setStreamError("");
    }
    const requestedWorkspaceId = workspaceId;
    const taskHistory = workspaceAligned
      ? api.getAssistantTasks().then(page => {
        if (!isCurrentWorkspace(requestedWorkspaceId)) return false;
        const items = page.items.filter(item => item.workspaceId === requestedWorkspaceId);
        setTasks(items); setTasksError("");
        setSelectedTaskId(current => items.some(item => item.id === current) ? current : items[0]?.id ?? "");
        return true;
      }).catch(error => {
        if (isCurrentWorkspace(requestedWorkspaceId)) setTasksError(errorText(error));
        return false;
      })
      : Promise.resolve(false);
    const results = await Promise.all([
      taskHistory,
      api.getWorkApprovals(effectiveWorkspaceId).then(items => { reconcileApprovalSnapshot(effectiveWorkspaceId, items); setApprovalsError(""); return true; }).catch(error => { setApprovalsError(errorText(error)); return false; }),
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
  }, [api, effectiveWorkspaceId, workspaceAligned, workspaceId, isCurrentWorkspace, reconcileApprovalSnapshot, t]);

  useEffect(() => { void refreshAll(); }, [refreshAll]);

  useEffect(() => {
    if (!workspaceAligned || !selectedTaskId) { setTaskDetail(null); return; }
    const requestedWorkspaceId = workspaceId;
    const controller = new AbortController();
    setTaskDetail(current => current?.id === selectedTaskId && current.workspaceId === requestedWorkspaceId ? current : null);
    setDetailError(""); setTaskEvents([]); setStreamError("");
    void api.getAssistantTask(selectedTaskId, controller.signal).then(value => {
      if (controller.signal.aborted || !isCurrentWorkspace(requestedWorkspaceId)) return;
      if (value.workspaceId !== requestedWorkspaceId) {
        setTaskDetail(null); setSelectedTaskId("");
        setDetailError(t("Navigator returned a task outside the selected workspace."));
        return;
      }
      setTaskDetail(value);
    }, error => { if (!controller.signal.aborted && isCurrentWorkspace(requestedWorkspaceId)) setDetailError(errorText(error)); });
    return () => controller.abort();
  }, [api, selectedTaskId, workspaceAligned, workspaceId, hostWorkspaceId, isCurrentWorkspace, t]);

  useTaskStream({
    api, taskId: workspaceAligned && (tasks.some(task => task.id === selectedTaskId && task.workspaceId === workspaceId)
      || (taskDetail?.id === selectedTaskId && taskDetail.workspaceId === workspaceId)) ? selectedTaskId : "", scopeKey: workspaceId,
    terminal: taskDetail?.id === selectedTaskId && taskDetail.workspaceId === workspaceId && SETTLED_TASK_STATES.has(taskDetail.status),
    replayTerminal: taskDetail?.id === selectedTaskId && taskDetail.workspaceId === workspaceId && PAUSED_TASK_STATES.has(taskDetail.status),
    onEvent: event => setTaskEvents(previous => previous.some(item => item.sequence === event.sequence) ? previous : [...previous.slice(-99), event]),
    onTask: value => {
      if (!isCurrentWorkspace(workspaceId) || value.workspaceId !== workspaceId) return;
      setTaskDetail(current => current?.id === value.id && current.sequence > value.sequence ? current : value);
      setTasks(current => current.map(task => task.id === value.id && task.sequence <= value.sequence ? value : task));
    },
    onRefresh: async signal => {
      const [nextApprovals, nextInputs] = await Promise.allSettled([api.getWorkApprovals(effectiveWorkspaceId), api.getWorkInputs(effectiveWorkspaceId)]);
      if (signal.aborted) return;
      if (nextApprovals.status === "fulfilled") { reconcileApprovalSnapshot(effectiveWorkspaceId, nextApprovals.value); setApprovalsError(""); }
      else setApprovalsError(errorText(nextApprovals.reason));
      if (nextInputs.status === "fulfilled") { setPendingInputs(nextInputs.value); setInputsError(""); }
      else setInputsError(errorText(nextInputs.reason));
    },
    onError: (error, source) => source === "stream" ? setStreamError(errorText(error)) : setDetailError(errorText(error)),
  });

  useEffect(() => {
    if (!workspaceAligned || !taskDetail || !PAUSED_TASK_STATES.has(taskDetail.status)) return;
    const taskId = taskDetail.id, requestedWorkspaceId = workspaceId;
    let active = true;
    const timer = setInterval(() => {
      void api.getAssistantTask(taskId).then(value => {
        if (!active || !isCurrentWorkspace(requestedWorkspaceId)) return;
        if (value.id !== taskId || value.workspaceId !== requestedWorkspaceId) return;
        setTaskDetail(current => typeof current?.sequence === "number" && current.sequence > value.sequence ? current : value);
        setTasks(current => current.map(task => task.id === value.id && task.sequence <= value.sequence ? value : task));
      }, error => { if (active && isCurrentWorkspace(requestedWorkspaceId)) setDetailError(errorText(error)); });
    }, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [api, workspaceAligned, workspaceId, hostWorkspaceId, taskDetail?.id, taskDetail?.status, isCurrentWorkspace]);

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

  const submitTask = async () => {
    if (taskBusy || !mayOperate) return;
    const request = pendingTask ?? {
      taskId: makeIdempotencyKey(),
      prompt: prompt.trim(),
      ...(sessionId.trim() ? { sessionId: sessionId.trim() } : {}),
    };
    if (!request.prompt.trim()) return;
    const isRetry = !!pendingTask;
    const requestedWorkspaceId = workspaceId;
    setPendingTask(request);
    setTaskBusy(true); setTasksError("");
    try {
      let created: NavigatorTaskRecord | null = null;
      if (isRetry) {
        try {
          created = await api.getAssistantTask(request.taskId);
          if (created.id !== request.taskId) throw new Error(t("Navigator returned a different task than requested."));
        } catch (error) {
          if (!(error instanceof NavigatorHttpError) || error.status !== 404) throw error;
        }
      }
      if (!created) {
        created = await api.createAssistantTask({
          prompt: request.prompt,
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          taskId: request.taskId,
        });
      }
      if (!isCurrentWorkspace(requestedWorkspaceId)) return;
      if (created.workspaceId !== requestedWorkspaceId) throw new Error(t("Navigator returned a task outside the selected workspace."));
      setPendingTask(null);
      setPrompt(current => current === request.prompt ? "" : current);
      setSelectedTaskId(created.id); setTaskDetail(created); setTaskEvents([]);
      await reloadTasks();
    } catch (error) {
      if (isCurrentWorkspace(requestedWorkspaceId)) {
        if (error instanceof NavigatorHttpError && error.status < 500 && ![408, 429].includes(error.status)) setPendingTask(null);
        setTasksError(errorText(error));
      }
    }
    finally { setTaskBusy(false); }
  };

  const createTask = (event: FormEvent) => {
    event.preventDefault();
    void submitTask();
  };

  const reloadTasks = async () => {
    if (!workspaceAligned) {
      setTasks([]); setSelectedTaskId(""); setTaskDetail(null); setTaskEvents([]); setTasksError("");
      return;
    }
    const requestedWorkspaceId = workspaceId;
    try {
      const page = await api.getAssistantTasks();
      if (!isCurrentWorkspace(requestedWorkspaceId)) return;
      const items = page.items.filter(item => item.workspaceId === requestedWorkspaceId);
      setTasks(items); setTasksError("");
      setSelectedTaskId(current => items.some(item => item.id === current) ? current : items[0]?.id ?? "");
    }
    catch (error) { if (isCurrentWorkspace(requestedWorkspaceId)) setTasksError(errorText(error)); }
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

  const resolveApproval = async (approval: WorkApproval, decision: ApprovalDecision) => {
    if (!mayOperate || approvalBusy) return;
    const approvalId = approval.id;
    if (approvalRetries[approvalId] && approvalRetries[approvalId] !== decision) return;
    const requestKey = JSON.stringify([effectiveWorkspaceId, approvalId, decision]);
    const scopeKey = approvalScopeKey(effectiveWorkspaceId, approvalId);
    const messageId = approvalRequestsRef.current.get(requestKey)?.messageId ?? makeIdempotencyKey();
    approvalRequestsRef.current.set(requestKey, { workspaceId: effectiveWorkspaceId, approvalId, decision, messageId });
    const clearUncertainFlag = () => {
      uncertainApprovalScopesRef.current.delete(scopeKey);
      setUncertainApprovals(previous => { const next = { ...previous }; delete next[approvalId]; return next; });
    };
    const clearApprovalRequest = () => {
      clearUncertainFlag();
      for (const [key, request] of approvalRequestsRef.current) {
        if (request.workspaceId === effectiveWorkspaceId && request.approvalId === approvalId) approvalRequestsRef.current.delete(key);
      }
      setApprovalRetries(previous => { const next = { ...previous }; delete next[approvalId]; return next; });
    };
    const resolveTaskAfterApproval = async () => {
      await reloadTasks();
      try {
        const current = await api.getAssistantTask(approval.taskId);
        if (isCurrentWorkspace(effectiveWorkspaceId) && current.workspaceId === effectiveWorkspaceId) setTaskDetail(current);
      } catch (error) { if (isCurrentWorkspace(effectiveWorkspaceId)) setDetailError(errorText(error)); }
    };
    const requireMatchingReceipt = (receipt: Awaited<ReturnType<NavigatorApi["resolveWorkApproval"]>>) => {
      if (receipt.approval.id !== approvalId || receipt.approval.status !== decision) {
        throw new Error(t("Navigator did not confirm the requested approval decision."));
      }
    };
    setApprovalBusy(approvalId);
    try {
      const receipt = await api.resolveWorkApproval(effectiveWorkspaceId, approvalId, decision, messageId);
      requireMatchingReceipt(receipt);
      clearUncertainFlag();
      setApprovalRetries(previous => ({ ...previous, [approvalId]: decision }));
      setApprovals(items => items.filter(item => item.id !== approvalId)); setApprovalsError("");
      await resolveTaskAfterApproval();
    } catch (error) {
      const ambiguous = !(error instanceof NavigatorHttpError)
        || error.status >= 500
        || [408, 409, 429].includes(error.status);
      if (!ambiguous) {
        clearApprovalRequest();
        setApprovalsError(errorText(error));
      } else {
        uncertainApprovalScopesRef.current.add(scopeKey);
        setApprovalRetries(previous => ({ ...previous, [approvalId]: decision }));
        setUncertainApprovals(previous => ({ ...previous, [approvalId]: { approval, decision } }));
        let current: WorkApproval[];
        try {
          current = await api.getWorkApprovals(effectiveWorkspaceId);
        } catch (reconciliationError) {
          setApprovalsError(`${t("The approval response is uncertain and current approval state could not be read.")} ${errorText(reconciliationError)}`);
          return;
        }
        setApprovals(current);
        if (current.some(item => item.id === approvalId)) {
          reconcileApprovalSnapshot(effectiveWorkspaceId, current);
          setApprovalsError(t("The approval response was not confirmed. Retrying will reuse the same request ID."));
          return;
        }
        try {
          const receipt = await api.resolveWorkApproval(effectiveWorkspaceId, approvalId, decision, messageId);
          requireMatchingReceipt(receipt);
          clearUncertainFlag();
          setApprovalRetries(previous => ({ ...previous, [approvalId]: decision }));
          setApprovals(current);
          setApprovalsError("");
          await resolveTaskAfterApproval();
          return;
        } catch (reconciliationError) {
          setUncertainApprovals(previous => ({ ...previous, [approvalId]: { approval, decision } }));
          setApprovalRetries(previous => ({ ...previous, [approvalId]: decision }));
          setApprovalsError(`${t("The approval is no longer pending, but the requested decision is still unconfirmed. Retry the same request.")} ${errorText(reconciliationError)}`);
        }
      }
    }
    finally { setApprovalBusy(""); }
  };

  const answerWorkInput = async (inputId: string) => {
    const answer = inputAnswers[inputId]?.trim();
    if (!answer || !mayOperate || inputBusy) return;
    const taskId = pendingInputs.find(item => item.id === inputId)?.taskId;
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
      try {
        if (!taskId) return;
        const task = await api.getAssistantTask(taskId);
        if (isCurrentWorkspace(effectiveWorkspaceId) && task.workspaceId === effectiveWorkspaceId) setTaskDetail(task);
      } catch (error) { if (isCurrentWorkspace(effectiveWorkspaceId)) setDetailError(errorText(error)); }
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
    if (!file || !mayWrite || attachmentBusy) return;
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

  const visibleTasks = workspaceAligned ? tasks.filter(task => task.workspaceId === workspaceId) : [];
  const visibleTaskDetail = workspaceAligned && taskDetail?.workspaceId === workspaceId ? taskDetail : null;
  const visibleDetailError = workspaceAligned ? detailError : "";
  const taskActive = !!visibleTaskDetail && !TERMINAL_TASK_STATES.has(visibleTaskDetail.status);
  return <div className="page-container work-assistant">
    <PageHeader eyebrow={t("WORK ASSISTANT")} title={t("Work assistant")} description={t("Tasks run beside the paired Navigator host; workspace data stays with its owner.")} action={<Button onClick={() => void refreshAll()} disabled={loading}>{loading ? t("Refreshing...") : t("Refresh all")}</Button>} />
    {!workspaceKnown && <p role={workspaceError ? "alert" : "status"} className="work-assistant__notice">{workspaceLoading ? t("Verifying Navigator workspace identity...") : workspaceError || t("Navigator did not report a workspace identity.")} <Button disabled={workspaceLoading} onClick={() => void reloadWorkspace()}>{t("Retry workspace connection")}</Button></p>}
    {workspaceKnown && !workspaceAligned && <p role="alert" className="work-assistant__notice work-assistant__notice--error">{t("Selected workspace does not match the Navigator host configuration.")} {workspaceId} / {hostWorkspaceId} <Button onClick={() => void reloadWorkspace()}>{t("Retry workspace connection")}</Button></p>}
    {!canOperate && <p className="work-assistant__notice">{t("Execution permission is required to create tasks, resolve approvals, answer requests, or start QQ login.")}</p>}
    {pageError && <p role="alert" className="work-assistant__notice work-assistant__notice--error">{pageError}</p>}

    <div className="work-assistant__grid">
      <Panel title={t("Create a task")} meta={<span>{t("Task state is owned by Navigator")}</span>}>
        <form className="work-assistant__form" onSubmit={event => void createTask(event)}>
          <label>{t("Prompt")}<textarea value={prompt} maxLength={100000} rows={4} disabled={taskBusy || !!pendingTask} onChange={event => setPrompt(event.target.value)} placeholder={t("Describe the work to perform on this Navigator host.")} /></label>
          <label>{t("Continue an agent session (optional)")}<input value={sessionId} maxLength={512} disabled={taskBusy || !!pendingTask} onChange={event => setSessionId(event.target.value)} placeholder={t("Leave blank to start a new agent session")} /></label>
          <div className="work-assistant__actions"><Button tone="primary" disabled={taskBusy || !mayOperate || (pendingTask ? false : !prompt.trim())}>{taskBusy ? t("Submitting...") : pendingTask ? t("Retry same task") : t("Create task")}</Button><span>{t("A task remains active on its host after this page closes.")}</span></div>
        </form>
        {workspaceAligned && tasksError && <StateBlock kind="error" title={t("Tasks unavailable")} detail={tasksError} action={<Button onClick={() => pendingTask ? void submitTask() : void reloadTasks()}>{pendingTask ? t("Retry same task") : t("Try again")}</Button>} />}
      </Panel>

      <Panel title={t("Assistant tasks")} meta={<Button disabled={!workspaceAligned} onClick={() => void reloadTasks()}>{t("Refresh tasks")}</Button>}>
        {!workspaceAligned ? <StateBlock kind="empty" title={t("Task history hidden")} detail={t("Task history is hidden until the selected workspace is verified with Navigator.")} /> : tasksError ? <p className="work-assistant__muted">{t("The task list did not load.")}</p> : visibleTasks.length ? <ul className="work-assistant__task-list">
          {visibleTasks.map(task => <li key={task.id}><button className={task.id === selectedTaskId ? "is-selected" : ""} onClick={() => setSelectedTaskId(task.id)}>
            <span><strong>{task.title || task.prompt.slice(0, 80)}</strong><small>{task.id} · {formatTime(task.createdAt)}</small></span><StatusPill value={task.status} />
          </button></li>)}
        </ul> : <StateBlock kind="empty" title={t("No tasks yet")} detail={t("New tasks appear here after Navigator accepts them.")} />}
      </Panel>

      <Panel title={t("Task detail")} meta={visibleTaskDetail ? <StatusPill value={visibleTaskDetail.status} /> : undefined} className="work-assistant__detail">
        {visibleDetailError ? <StateBlock kind="error" title={t("Task could not be read")} detail={visibleDetailError} action={<Button onClick={() => {
          const requestedWorkspaceId = workspaceId;
          void api.getAssistantTask(selectedTaskId).then(value => {
            if (!isCurrentWorkspace(requestedWorkspaceId)) return;
            if (value.workspaceId === requestedWorkspaceId) setTaskDetail(value);
            else setDetailError(t("Navigator returned a task outside the selected workspace."));
          }, error => { if (isCurrentWorkspace(requestedWorkspaceId)) setDetailError(errorText(error)); });
        }}>{t("Try again")}</Button>} /> : visibleTaskDetail ? <>
          <dl className="work-assistant__facts"><dt>{t("Task ID")}</dt><dd>{visibleTaskDetail.id}</dd><dt>{t("Agent session")}</dt><dd>{visibleTaskDetail.sessionId}</dd><dt>{t("Created")}</dt><dd>{formatTime(visibleTaskDetail.createdAt)}</dd></dl>
          <h3>{t("Prompt")}</h3><pre className="work-assistant__text">{visibleTaskDetail.prompt}</pre>
          {visibleTaskDetail.output ? <><h3>{t("Output")}</h3><pre className="work-assistant__text">{visibleTaskDetail.output}</pre></> : null}
          {visibleTaskDetail.error ? <><h3>{t("Error")}</h3><pre className="work-assistant__text work-assistant__text--error">{visibleTaskDetail.error}</pre></> : null}
          {visibleTaskDetail.reasoning ? <details><summary>{t("Reasoning")}</summary><pre className="work-assistant__text">{visibleTaskDetail.reasoning}</pre></details> : null}
          {taskActive && <div className="work-assistant__actions"><Button tone="danger" disabled={!mayOperate || taskBusy} onClick={() => void cancelTask()}>{taskBusy ? t("Working...") : t("Request cancellation")}</Button><span>{t("Cancellation is a request; the server reports the final state.")}</span></div>}
          <div className="work-assistant__event-list"><h3>{t("Live task events")}</h3>{streamError && <p role="status">{t("Event stream status")}: {streamError}</p>}{taskEvents.length ? taskEvents.map(item => <p key={item.sequence}><code>#{item.sequence}</code> {assistantEventLabel(item)}</p>) : <p className="work-assistant__muted">{t("No task events received yet.")}</p>}</div>
        </> : <StateBlock kind="empty" title={t("Select a task")} detail={t("Task details and sequenced events are read from Navigator.")} />}
      </Panel>

      <Panel title={t("Approvals")} meta={<span>{approvals.length}</span>}>
        {approvalsError && <p role="alert" className="work-assistant__notice work-assistant__notice--error">{approvalsError}</p>}
        {Object.values(uncertainApprovals).filter(item => !approvals.some(approval => approval.id === item.approval.id)).map(({ approval, decision }) => <div key={approval.id} role="alert" className="work-assistant__notice work-assistant__notice--error">
          <span>{t("The approval is no longer pending, but the requested decision is still unconfirmed. Retry the same request.")}</span>
          <Button disabled={!mayOperate || approvalBusy === approval.id} onClick={() => void resolveApproval(approval, decision)}>{decision === "approved" ? t("Retry approval") : t("Retry rejection")}</Button>
        </div>)}
        {approvals.length ? <ul className="work-assistant__rows">
          {approvals.map(approval => {
            const retry = approvalRetries[approval.id];
            return <li key={approval.id}><div><strong>{approval.summary}</strong><small>{approval.kind} · {approval.id} · {t("Task")} {approval.taskId}</small>{Object.keys(approval.details).length > 0 && <details><summary>{t("Approval details")}</summary><pre className="work-assistant__text">{compactJson(approval.details)}</pre></details>}</div><div className="work-assistant__actions"><Button disabled={!mayOperate || approvalBusy === approval.id || (!!retry && retry !== "approved")} onClick={() => void resolveApproval(approval, "approved")}>{retry === "approved" ? t("Retry approval") : t("Approve")}</Button><Button tone="danger" disabled={!mayOperate || approvalBusy === approval.id || (!!retry && retry !== "rejected")} onClick={() => void resolveApproval(approval, "rejected")}>{retry === "rejected" ? t("Retry rejection") : t("Reject")}</Button></div></li>;
          })}
        </ul> : !Object.keys(uncertainApprovals).length && <StateBlock kind="empty" title={t("No pending approvals")} detail={t("The workspace has not reported any pending decision.")} />}
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
