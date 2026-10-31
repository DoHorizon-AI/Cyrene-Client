import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NavigatorApi,
  NavigatorHttpError,
  makeIdempotencyKey,
  type NavigatorTaskEvent,
  type NavigatorTaskRecord,
  type WorkApproval,
  type WorkAttachment,
  type WorkInput,
} from "../../services/navigator/src/api";

import { useTaskStream } from "../../services/navigator/src/useTaskStream";
import { useNavigatorSession } from "../services/NavigatorSessionProvider";
import { useTeamIdentity } from "../team/TeamGate";
import { useI18n } from "../i18n";
import type { AssistantWindowProps } from "./AssistantWindow";
import {
  chatSessions,
  isActiveTask,
  mergeTaskRecords,
} from "./model";
import { ChatComposer } from "./ChatComposer";
import { ChatHeader } from "./ChatHeader";
import { History } from "./History";
import { LegacyHistory } from "./LegacyHistory";
import { ModelBar } from "./ModelBar";
import { TaskMessages } from "./TaskMessages";
import { useAssistantMessages } from "./messages";
import { ProviderSettings } from "./ProviderSettings";
import { parseLegacyHistory, type LegacyChat } from "./legacy-history";

const McpPanel = lazy(() => import("../mcp/McpPanel"));
type Submission = {
  requestId: string;
  input: Parameters<NavigatorApi["createAssistantTask"]>[0];
};

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default function Chat(props: AssistantWindowProps) {
  const { locale } = useI18n(),
    { actorId, workspaceId, scopes } = useTeamIdentity();
  const m = useAssistantMessages();
  const {
    api,
    session: auth,
    reconnect,
    pair,
    error: sessionError,
  } = useNavigatorSession();
  const [pairing, setPairing] = useState("");
  const [hostWorkspace, setHostWorkspace] = useState("");
  const [hostLoading, setHostLoading] = useState(false),
    [hostError, setHostError] = useState("");
  const [tasks, setTasks] = useState<NavigatorTaskRecord[]>([]),
    [nextCursor, setNextCursor] = useState<string | null>(null);
  const selectionKey = `cyrene.assistant.selection.v1:${actorId}:${workspaceId}`;
  const [sessionId, setSessionId] = useState(() => {
    try {
      return localStorage.getItem(selectionKey) ?? "";
    } catch {
      return "";
    }
  });
  const [draft, setDraft] = useState(""),
    [attachments, setAttachments] = useState<WorkAttachment[]>([]);
  const [view, setView] = useState<
    "chat" | "history" | "settings" | "mcp" | "legacy"
  >("chat");
  const [legacyChats, setLegacyChats] = useState<LegacyChat[]>([]),
    [legacyId, setLegacyId] = useState("");
  const [mcpVisited, setMcpVisited] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    uploading = false;
  const [pending, setPending] = useState<Submission | null>(null);
  const [approvals, setApprovals] = useState<WorkApproval[]>([]),
    [inputs, setInputs] = useState<WorkInput[]>([]),
    [answers, setAnswers] = useState<Record<string, string>>({});
  const [taskEvents, setTaskEvents] = useState<
    Record<string, NavigatorTaskEvent[]>
  >({});
  const [restoringHistory, setRestoringHistory] = useState(false);
  const mounted = useRef(true),
    selected = useRef(sessionId),
    operation = useRef(false),
    follow = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null),
    transcript = useRef<HTMLDivElement>(null);
  const inputRequests = useRef(
    new Map<string, { answer: string; messageId: string }>(),
  );
  const historyExtended = useRef(false);
  const restoredTargets = useRef(new Set<string>());
  const legacyInput = useRef<HTMLInputElement>(null);
  selected.current = sessionId;
  const effectiveWorkspace = hostWorkspace || workspaceId;
  const aligned =
    !!hostWorkspace &&
    !!workspaceId &&
    hostWorkspace === workspaceId;
  const mayOperate =
    !!auth?.authenticated && aligned && scopes.includes("products.operate");
  const mayConfigure = scopes.includes("products.admin");
  const sessions = useMemo(
    () =>
      chatSessions(
        tasks.filter((task) => task.workspaceId === effectiveWorkspace),
      ),
    [tasks, effectiveWorkspace],
  );
  const turns =
    sessions.find((session) => session.id === sessionId)?.turns ?? [];
  const activeTask = turns.find(isActiveTask),
    lastTask = turns.at(-1);
  const observedTask = activeTask ?? lastTask;
  const selectedTaskIds = new Set(turns.map((task) => task.id));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (props.toolsRequest) {
      setMcpVisited(true);
      setView("mcp");
    }
  }, [props.toolsRequest]);
  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem(selectionKey, sessionId);
      else localStorage.removeItem(selectionKey);
    } catch {
      /* Selection is optional UI state. */
    }
  }, [sessionId, selectionKey]);
  const fail = (reason: unknown) => {
    if (mounted.current) setError(message(reason));
  };

  const reloadTasks = useCallback(async () => {
    const page = await api.getAssistantTasks();
    if (!mounted.current) return;
    setTasks((previous) => mergeTaskRecords(previous, page.items));
    if (!historyExtended.current) setNextCursor(page.nextCursor);
  }, [api]);

  const reloadApprovals = useCallback(
    async (signal?: AbortSignal) => {
      const results = await Promise.allSettled([
        api.getWorkApprovals(effectiveWorkspace),
        api.getWorkInputs(effectiveWorkspace),
      ]);
      if (!mounted.current || signal?.aborted) return;
      if (results[0].status === "fulfilled") setApprovals(results[0].value);
      if (results[1].status === "fulfilled") setInputs(results[1].value);
    },
    [api, effectiveWorkspace],
  );

  const reloadHostWorkspace = useCallback(async () => {
    setHostLoading(true);
    setHostWorkspace("");
    setHostError("");
    try {
      const status = await api.getSystemStatus();
      if (!status.workspaceId)
        throw new Error(m("navigatorDidNotIdentifyItsWorkspace"));
      if (mounted.current) setHostWorkspace(status.workspaceId);
    } catch (reason) {
      if (mounted.current) setHostError(message(reason));
    } finally {
      if (mounted.current) setHostLoading(false);
    }
  }, [api, locale]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    void reloadTasks().catch(fail);
    void reloadHostWorkspace();
  }, [
    api,
    auth?.authenticated,
    reloadTasks,
    reloadHostWorkspace,
  ]);

  useEffect(() => {
    if (
      !auth?.authenticated ||
      !sessionId ||
      turns.length ||
      !nextCursor ||
      restoredTargets.current.has(sessionId)
    )
      return;
    let active = true;
    const target = sessionId;
    restoredTargets.current.add(target);
    setRestoringHistory(true);
    const restore = async () => {
      let cursor: string | null = nextCursor;
      try {
        for (
          let pageNumber = 0;
          active && cursor && pageNumber < 10;
          pageNumber++
        ) {
          const page = await api.getAssistantTasks(cursor);
          if (!active) return;
          setTasks((previous) => mergeTaskRecords(previous, page.items));
          historyExtended.current = true;
          cursor = page.nextCursor;
          if (
            page.items.some(
              (task) =>
                task.sessionId === target &&
                task.workspaceId === effectiveWorkspace,
            )
          )
            break;
        }
        if (active) setNextCursor(cursor);
      } catch (reason) {
        if (active) fail(reason);
      } finally {
        if (active) setRestoringHistory(false);
      }
    };
    void restore();
    return () => {
      active = false;
    };
  }, [
    api,
    auth?.authenticated,
    sessionId,
    !turns.length,
    nextCursor,
    effectiveWorkspace,
  ]);

  useEffect(() => {
    if (!auth?.authenticated || !props.visible) return;
    let active = true,
      inFlight = false,
      failures = 0;
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
      } catch (reason) {
        delay = Math.min(60_000, 2000 * 2 ** Math.min(failures++, 5));
        if (active) fail(reason);
      } finally {
        inFlight = false;
        if (active) timer = setTimeout(() => void update(), delay);
      }
    };
    const wake = () => {
      if (!document.hidden) void update();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    void update();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [
    auth?.authenticated,
    props.visible,
    activeTask?.id,
    pending?.requestId,
    reloadTasks,
    reloadApprovals,
  ]);

  useTaskStream({
    api,
    taskId: observedTask?.id,
    scopeKey: selectionKey,
    enabled: props.visible && !!auth?.authenticated,
    terminal: !!observedTask && !isActiveTask(observedTask),
    replayTerminal: true,
    onEvent: (event, taskId) =>
      setTaskEvents((previous) => ({
        ...previous,
        [taskId]: [
          ...(previous[taskId] ?? [])
            .filter((item) => item.sequence !== event.sequence)
            .slice(-99),
          event,
        ],
      })),
    onTask: (task) =>
      setTasks((previous) => mergeTaskRecords(previous, [task])),
    onRefresh: reloadApprovals,
    onError: fail,
  });

  useEffect(() => {
    if (!pending) return;
    const created = tasks.find((task) => task.id === pending.requestId);
    if (created) {
      setSessionId(created.sessionId);
      setPending(null);
      setDraft("");
      setAttachments([]);
    }
  }, [pending, tasks]);
  useEffect(() => {
    if (follow.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [tasks, taskEvents, approvals, inputs, sessionId]);

  const act = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      fail(reason);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const send = async (retry?: Submission) => {
    if (
      !mayOperate ||
      operation.current ||
      activeTask ||
      uploading ||
      (!retry && (!draft.trim() || pending || (!!sessionId && !lastTask)))
    )
      return;
    const taskId = retry?.input.taskId ?? makeIdempotencyKey();
    const submission: Submission = retry ?? {
      requestId: taskId,
      input: {
        prompt: draft.trim(),
        ...(sessionId ? { sessionId } : {}),
        taskId,
      },
    };
    setPending(submission);
    await act(async () => {
      try {
        const created = await api.createAssistantTask(
          submission.input,
          submission.requestId,
        );
        if (!mounted.current) return;
        setTasks((previous) => mergeTaskRecords(previous, [created]));
        setSessionId(created.sessionId);
        setPending(null);
        setDraft((current) =>
          current.trim() === submission.input.prompt ? "" : current,
        );
        follow.current = true;
      } catch (reason) {
        if (
          reason instanceof NavigatorHttpError &&
          reason.status < 500 &&
          ![408, 429].includes(reason.status)
        )
          setPending(null);
        throw reason;
      }
    });
  };

  const selectSession = (id: string) => {
    if (busy || uploading || pending) return;
    setSessionId(id);
    setDraft("");
    setAttachments([]);
    setError("");
    setView("chat");
    setRestoringHistory(false);
    follow.current = true;
  };

  const upload = async (files: FileList | File[]) => {
    void files;
    fail(m("attachmentsAreNotConnectedToTaskSubmissions"));
  };

  const decide = (
    approval: WorkApproval,
    decision: "approved" | "rejected",
  ) =>
    void act(async () => {
      // Approval identity comes from its owning task, never from the open graph.
      if (!mayOperate || !selectedTaskIds.has(approval.taskId)) return;
      await api.resolveWorkApproval(
        effectiveWorkspace,
        approval.id,
        decision,
      );
      await reloadApprovals();
      await reloadTasks();
    });
  const answer = (input: WorkInput) =>
    void act(async () => {
      if (!mayOperate || !selectedTaskIds.has(input.taskId)) return;
      const text = answers[input.id]?.trim();
      if (!text) return;
      const previous = inputRequests.current.get(input.id);
      const messageId =
        previous?.answer === text ? previous.messageId : makeIdempotencyKey();
      inputRequests.current.set(input.id, { answer: text, messageId });
      await api.resolveWorkInput(effectiveWorkspace, input.id, text, messageId);
      inputRequests.current.delete(input.id);
      await reloadApprovals();
      await reloadTasks();
    });

  return (
    <section
      className="assistant-window"
      aria-label="AI Assistant"
      onDragOver={(event) => {
        if (mayOperate && event.dataTransfer.types.includes("Files"))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          void upload(event.dataTransfer.files);
        }
      }}
    >
      <ChatHeader
        selectionDisabled={busy || uploading || !!pending}
        busy={busy}
        canConfigure={mayConfigure}
        expanded={props.expanded}
        onNew={() => selectSession("")}
        onHistory={() => {
          setView(view === "history" ? "chat" : "history");
          void reloadTasks().catch(fail);
        }}
        onRefresh={() =>
          void act(async () => {
            await reconnect();
            if (auth?.authenticated) {
              await reloadHostWorkspace();
              await reloadTasks();
            }
          })
        }
        onSettings={() => setView(view === "settings" ? "chat" : "settings")}
        onTools={() => {
          setMcpVisited(true);
          setView(view === "mcp" ? "chat" : "mcp");
        }}
        onDock={props.onDock}
      />
      {(error || sessionError) && (
        <div className="assistant-error" role="alert">
          {error || sessionError}
          <button
            aria-label={m("dismissError")}
            onClick={() => {
              setError("");
            }}
          >
            ×
          </button>
        </div>
      )}
      {mcpVisited && (
        <div className="assistant-aux" hidden={view !== "mcp"}>
          <Suspense fallback={<p>MCP…</p>}>
            <McpPanel
              key={props.document.id}
              document={props.document}
              selectedId={props.selectedId}
              onNotice={props.onNotice}
              onMonitor={props.onMonitor}
            />
          </Suspense>
        </div>
      )}
      {!auth?.authenticated && view !== "mcp" && (
        <form
          className="assistant-aux"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await pair(pairing);
              setPairing("");
            });
          }}
        >
          <p>{m("connectUsingTheExistingNavigatorPairedSession")}</p>
          <label>
            {m("oneTimePairingCode")}
            <input
              value={pairing}
              autoComplete="one-time-code"
              onChange={(event) => setPairing(event.target.value)}
            />
          </label>
          <button disabled={busy || !pairing.trim()}>{m("connect")}</button>
        </form>
      )}
      {auth?.authenticated && (
        <>
          {!aligned && (
            <p className="assistant-error" role="status">
              {hostLoading
                ? m("checkingTheNavigatorWorkspace")
                : hostError ||
                  (!hostWorkspace
                    ? m("navigatorWorkspaceIdentityIsNotVerifiedOperationsAreUnavailable")
                    : m("navigatorIsConnectedToADifferentWorkspaceOperationsAre"))}
              <button
                disabled={hostLoading}
                onClick={() => {
                  void reloadHostWorkspace();
                }}
              >
                {m("retryWorkspaceConnection")}
              </button>
            </p>
          )}
          {view !== "chat" && (
            <button
              className="assistant-back"
              aria-label={m("backToChat")}
              onClick={() => setView("chat")}
            >
              ← {m("backToChat")}
            </button>
          )}
          {view === "history" && (
            <History
              sessions={sessions}
              selectionDisabled={busy || uploading || !!pending}
              busy={busy}
              hasEarlier={!!nextCursor}
              hasLegacy={legacyChats.length > 0}
              onSelect={selectSession}
              onReadLegacy={() => legacyInput.current?.click()}
              onViewLegacy={() => setView("legacy")}
              onLoadEarlier={() =>
                void act(async () => {
                  const page = await api.getAssistantTasks(
                    nextCursor ?? undefined,
                  );
                  historyExtended.current = true;
                  setTasks((previous) =>
                    mergeTaskRecords(previous, page.items),
                  );
                  setNextCursor(page.nextCursor);
                })
              }
            />
          )}
          {view === "legacy" && (
            <LegacyHistory
              chats={legacyChats}
              selectedId={legacyId}
              onSelect={setLegacyId}
            />
          )}
          {view === "settings" && mayConfigure && (
            <ProviderSettings />
          )}
          <div className="assistant-conversation" hidden={view !== "chat"}>
            <div
              className="assistant-transcript"
              ref={transcript}
              onScroll={(event) => {
                const node = event.currentTarget;
                follow.current =
                  node.scrollHeight - node.scrollTop - node.clientHeight < 100;
              }}
            >
              {!turns.length && (
                <div className="assistant-empty">
                  <span>✧</span>
                  <h2>
                    {sessionId
                      ? m("readingSessionHistory")
                      : m("startAConversation")}
                  </h2>
                  <p>
                    {restoringHistory
                      ? m("readingEarlierTasks")
                      : m("executeResumeAndApproveTasksThroughNavigator")}
                  </p>
                  {sessionId && !restoringHistory && (
                    <button onClick={() => setView("history")}>
                      {m("chooseASessionFromHistory")}
                    </button>
                  )}
                </div>
              )}
              {turns.map((task) => (
                <TaskMessages
                  key={task.id}
                  task={task}
                  events={taskEvents[task.id] ?? []}
                  approvals={approvals}
                  inputs={inputs}
                  answers={answers}
                  pipelineId={props.document.id}
                  workspaceId={effectiveWorkspace}
                  disabled={busy || !mayOperate}
                  onOpenWorkflow={(id) =>
                    void props.onOpenWorkflow(id).catch(fail)
                  }
                  onDecide={decide}
                  onAnswer={answer}
                  onAnswerChange={(id, value) =>
                    setAnswers((previous) => ({ ...previous, [id]: value }))
                  }
                />
              ))}
            </div>
            <div className="assistant-compose-area">
              <ChatComposer
                draft={draft}
                attachments={attachments}
                pending={!!pending}
                busy={busy}
                uploading={uploading}
                canOperate={mayOperate}
                active={!!activeTask}
                sendDisabled={
                  busy ||
                  uploading ||
                  !!pending ||
                  !mayOperate ||
                  !draft.trim() ||
                  (!!sessionId && !lastTask)
                }
                onDraft={setDraft}
                onRemove={(id) =>
                  setAttachments((previous) =>
                    previous.filter((value) => value.id !== id),
                  )
                }
                onRetry={() => {
                  if (pending) void send(pending);
                }}
                onAttach={() => fileInput.current?.click()}
                attachmentsEnabled={false}
                onSend={() => void send()}
                onStop={() => {
                  if (activeTask)
                    void act(async () => {
                      await api.cancelAssistantTask(activeTask.id);
                      await reloadTasks();
                    });
                }}
              />
              <ModelBar />
              {!scopes.includes("products.operate") && (
                <small>{m("thisAccountCannotExecuteAgentTasks")}</small>
              )}
              {sessionId && (
                <details className="assistant-session-details">
                  <summary>{m("sessionDetails")}</summary>
                  <code>{sessionId}</code>
                  <span>Navigator · {effectiveWorkspace}</span>
                </details>
              )}
            </div>
          </div>
        </>
      )}
      <input
        ref={fileInput}
        hidden
        type="file"
        multiple
        disabled
        aria-label={m("chooseAttachments")}
        onChange={(event) => {
          if (event.target.files) void upload(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={legacyInput}
        hidden
        type="file"
        accept="application/json,.json"
        aria-label={m("chooseLegacyChatExport")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) {
            fail(m("legacyChatExportsMustBeAtMost10MB"));
            return;
          }
          void file
            .text()
            .then((text) => {
              const chats = parseLegacyHistory(
                JSON.parse(text),
                effectiveWorkspace,
              );
              if (mounted.current) {
                setLegacyChats(chats);
                setLegacyId(chats[0]?.id ?? "");
                setView("legacy");
              }
            }, fail)
            .catch(fail);
        }}
      />
    </section>
  );
}
