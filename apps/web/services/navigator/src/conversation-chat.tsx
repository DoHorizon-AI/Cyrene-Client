// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator private conversation chat                         │
// │ Role: Send Web turns through the trusted DSH ingress and read Work. │
// │ 中文：模块职责：经可信 DSH 入口发送 Web 轮次并回读 Work 消息。      │
// └─────────────────────────────────────────────────────────────────────┘

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, PageHeader, Panel, StateBlock, StatusPill } from "./components";
import { newConversationMemoryKey, type ConversationMessage, type ConversationTurnAdmission, type NavigatorApi, type NavigatorTaskRecord } from "./api";
import { assistantEventLabel, readAssistantTaskEvents } from "./task-event-stream";
import { useI18n } from "./i18n";
import { errorMessage } from "./pages/shared";
import "./conversation-assistant.css";

type Props = { api: NavigatorApi; workspaceId: string; canOperate: boolean };
type PendingTurn = { conversationId: string; text: string; idempotencyKey: string };

/**
 * Render a private Web chat backed by the dedicated conversation admission API.
 * 中文：通过专用对话入口展示由 Navigator 持久化的私聊消息与任务回执。
 */
export function ConversationChatPage({ api, workspaceId, canOperate }: Props) {
  const { t } = useI18n();
  const [hostWorkspaceId, setHostWorkspaceId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [conversationId, setConversationId] = useState(() => `web-${newConversationMemoryKey()}`);
  const [text, setText] = useState("");
  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  const [admission, setAdmission] = useState<ConversationTurnAdmission | null>(null);
  const [task, setTask] = useState<NavigatorTaskRecord | null>(null);
  const [taskEvents, setTaskEvents] = useState<Array<{ sequence: number; label: string }>>([]);
  const [eventCursor, setEventCursor] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesError, setMessagesError] = useState("");
  const streamController = useRef<AbortController | null>(null);
  const cursorRef = useRef(0);
  const aligned = !!workspaceId && hostWorkspaceId === workspaceId;
  const mayOperate = canOperate && aligned;

  useEffect(() => {
    let active = true;
    setWorkspaceLoading(true); setWorkspaceError(""); setHostWorkspaceId(null);
    void api.getSystemStatus().then((status) => {
      if (!active) return;
      if (!status.workspaceId) throw new Error(t("Navigator did not report a workspace identity."));
      if (status.workspaceId !== workspaceId) throw new Error(t("Selected workspace does not match the Navigator host."));
      setHostWorkspaceId(status.workspaceId);
    }).catch((reason: unknown) => { if (active) setWorkspaceError(errorMessage(reason)); })
      .finally(() => { if (active) setWorkspaceLoading(false); });
    return () => { active = false; streamController.current?.abort(); };
  }, [api, workspaceId, t]);

  const loadMessages = useCallback(async (scope = conversationId) => {
    if (!aligned || !scope.trim()) return;
    setMessagesError("");
    try {
      const result = await api.getConversationMessages(workspaceId, { conversationId: scope.trim(), conversationKind: "direct", limit: 100 });
      setMessages(result.items);
    } catch (reason) {
      setMessages([]); setMessagesError(errorMessage(reason));
    }
  }, [api, aligned, conversationId, workspaceId]);

  const consumeTask = useCallback(async (turn: ConversationTurnAdmission) => {
    streamController.current?.abort();
    const controller = new AbortController();
    streamController.current = controller;
    setStreaming(true); setError("");
    try {
      const response = await api.openConversationTurnTaskEvents(turn, cursorRef.current, controller.signal);
      const cursor = await readAssistantTaskEvents(response, cursorRef.current, controller.signal, (event) => {
        cursorRef.current = event.sequence;
        setEventCursor(event.sequence);
        setTaskEvents((current) => [...current.slice(-99), { sequence: event.sequence, label: assistantEventLabel(event) }]);
      });
      cursorRef.current = cursor;
      setEventCursor(cursor);
      const latest = await api.getConversationTurnTask(turn, controller.signal);
      if (latest.workspaceId !== workspaceId || latest.id !== turn.taskId) throw new Error(t("Navigator returned a task outside the selected workspace."));
      setTask(latest);
      await loadMessages(turn.conversationId);
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    } finally {
      if (streamController.current === controller) {
        streamController.current = null;
        setStreaming(false);
      }
    }
  }, [api, loadMessages, t, workspaceId]);

  const submitTurn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayOperate || busy || streaming) return;
    const request = pendingTurn ?? {
      conversationId: conversationId.trim(),
      text: text.trim(),
      idempotencyKey: newConversationMemoryKey(),
    };
    if (!request.conversationId || !request.text) return;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(request.conversationId) || request.text.length > 20_000) {
      setError(t("Enter a valid conversation ID and a message no longer than 20,000 characters."));
      return;
    }
    setPendingTurn(request); setBusy(true); setError(""); setAdmission(null); setTask(null); setTaskEvents([]); cursorRef.current = 0; setEventCursor(0);
    try {
      const accepted = await api.submitConversationTurn(request);
      if (accepted.conversationId !== request.conversationId) throw new Error(t("Navigator returned a different conversation than requested."));
      setAdmission(accepted); setPendingTurn(null); setText("");
      await consumeTask(accepted);
    } catch (reason) {
      if (reason instanceof Error && "status" in reason) {
        const status = Number((reason as { status?: unknown }).status);
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) setPendingTurn(null);
      }
      setError(errorMessage(reason));
    } finally { setBusy(false); }
  };

  const newConversation = () => {
    streamController.current?.abort();
    const nextId = `web-${newConversationMemoryKey()}`;
    setConversationId(nextId); setMessages([]); setMessagesError(""); setAdmission(null); setTask(null); setTaskEvents([]);
    setPendingTurn(null); setText(""); setError(""); cursorRef.current = 0; setEventCursor(0);
  };

  const changeConversationId = (value: string) => {
    setConversationId(value); setMessages([]); setMessagesError(""); setAdmission(null); setTask(null); setTaskEvents([]);
    cursorRef.current = 0; setEventCursor(0); setError("");
  };

  const refreshTaskStatus = async () => {
    if (!admission || busy || streaming) return;
    setError("");
    try {
      const latest = await api.getConversationTurnTask(admission);
      if (latest.workspaceId !== workspaceId || latest.id !== admission.taskId) throw new Error(t("Navigator returned a task outside the selected workspace."));
      setTask(latest);
      await loadMessages(admission.conversationId);
    } catch (reason) { setError(errorMessage(reason)); }
  };

  const terminal = !!task && ["completed", "failed", "aborted"].includes(task.status);
  const memoryPath = `/conversation-memory?conversationId=${encodeURIComponent(conversationId.trim())}`;

  return <div className="conversation-assistant">
    <PageHeader eyebrow={t("PRIVATE WEB CONVERSATION")} title={t("Conversation chat")} description={t("Send a private direct turn through the trusted Navigator ingress. Messages, memory context, and replies are read back from Work.")} action={<a className="button button--quiet" href={memoryPath}>{t("Open memory controls")}</a>} />
    {workspaceLoading || workspaceError ? <StateBlock kind={workspaceLoading ? "loading" : "error"} title={workspaceLoading ? t("Verifying Navigator workspace") : t("Conversation chat unavailable")} detail={workspaceLoading ? t("Checking the paired host before admitting a private turn.") : workspaceError} /> : <>
      {!canOperate && <p className="dh-notice product-readonly">{t("Sending a conversation turn requires products.operate.")}</p>}
      {error && <p role="alert" className="dh-notice dh-notice--danger">{error}</p>}
      <Panel title={t("Private direct conversation")} meta={<StatusPill value="private" />}>
        <div className="conversation-assistant__scope">
          <label>{t("Conversation ID")}<input value={conversationId} onChange={(event) => changeConversationId(event.target.value)} disabled={busy || streaming || !!pendingTurn} maxLength={200} autoComplete="off" /></label>
          <Button type="button" onClick={newConversation} disabled={busy || streaming || !!pendingTurn}>{t("New private conversation")}</Button>
        </div>
        <p className="conversation-assistant__help">{t("The host binds the conversation-assistant profile, direct kind, and private visibility. Persona and actor identity are not accepted from this form.")}</p>
      </Panel>
      <Panel title={t("Messages in this conversation")} meta={<Button onClick={() => void loadMessages()} disabled={!aligned || streaming}>{t("Refresh messages")}</Button>}>
        {messagesError ? <StateBlock kind="error" title={t("Conversation messages unavailable")} detail={messagesError} /> : messages.length ? <ul className="conversation-assistant__list">{messages.map((message) => <li key={message.id}>
          <div><strong>{message.role}</strong><p>{message.content}</p><small>{t("Event")}: {message.eventId} · {t("Visibility")}: {message.scope.visibility} · {message.scope.conversationId}</small>
            {message.sourceRefs.length > 0 && <small>{t("Used memory sources")}: {message.sourceRefs.map((source) => `${source.memoryId ?? t("source")} v${source.memoryVersion ?? "?"}`).join(", ")}</small>}
          </div>
        </li>)}</ul> : <StateBlock kind="empty" title={t("No stored conversation messages")} detail={t("Send a private turn to create a real ingress event and read its Work projection here.")} />}
      </Panel>
      <form onSubmit={(event) => void submitTurn(event)}>
        <Panel title={t("Send a message")}>
          <label>{t("Message")}<textarea rows={4} value={pendingTurn?.text ?? text} onChange={(event) => setText(event.target.value)} disabled={!mayOperate || busy || streaming || !!pendingTurn} maxLength={20_000} /></label>
          {pendingTurn && <p className="conversation-assistant__help">{t("The previous admission response is uncertain. Retry the exact same turn with its original idempotency key.")}</p>}
          <div className="conversation-assistant__actions">
            <Button tone="primary" disabled={!mayOperate || busy || streaming || !(pendingTurn?.text ?? text).trim() || !conversationId.trim()} loading={busy || streaming}>{pendingTurn ? t("Retry same turn") : t("Send private message")}</Button>
            {admission && terminal && <Button type="button" onClick={() => void refreshTaskStatus()}>{t("Refresh task status")}</Button>}
            {admission && !terminal && !streaming && !busy && <Button type="button" onClick={() => void consumeTask(admission)}>{t("Reconnect task stream")}</Button>}
          </div>
        </Panel>
      </form>
      {admission && <Panel title={t("Turn receipt")} meta={<StatusPill value={task?.status ?? admission.status} />}>
        <dl className="conversation-assistant__facts"><dt>{t("Task ID")}</dt><dd>{admission.taskId}</dd><dt>{t("Session")}</dt><dd>{admission.sessionId}</dd><dt>{t("Events read")}</dt><dd>{eventCursor}</dd></dl>
        {taskEvents.length > 0 && <ul className="conversation-assistant__list">{taskEvents.map((item) => <li key={item.sequence}>{item.label}</li>)}</ul>}
        {task?.status === "completed" && <section><h3>{t("Assistant reply")}</h3><p>{task.output}</p></section>}
        {task?.error && <p role="alert" className="dh-notice dh-notice--danger">{task.error}</p>}
      </Panel>}
    </>}
  </div>;
}
