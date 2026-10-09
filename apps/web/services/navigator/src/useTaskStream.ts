import { useEffect, useRef, useState } from "react";
import { NavigatorContractError, NavigatorHttpError, type NavigatorApi, type NavigatorTaskEvent, type NavigatorTaskRecord } from "./api";
import { readAssistantTaskEvents } from "./task-event-stream";

interface TaskStreamOptions {
  api: NavigatorApi;
  taskId?: string;
  scopeKey?: string;
  enabled?: boolean;
  terminal?: boolean;
  replayTerminal?: boolean;
  onEvent(event: NavigatorTaskEvent, taskId: string): void;
  onTask(task: NavigatorTaskRecord): void;
  onRefresh?(signal: AbortSignal): Promise<void>;
  onError(error: unknown, source: "stream" | "refresh" | "resources"): void;
}

/** Observe one durable task; selection, visibility and terminal state own its lifetime. */
export function useTaskStream(options: TaskStreamOptions): void {
  const { api, taskId, scopeKey = "", enabled = true, terminal = false, replayTerminal = false } = options;
  const observationKey = JSON.stringify([scopeKey, taskId]);
  const callbacks = useRef(options);
  const identity = useRef(observationKey);
  const cursors = useRef(new Map<string, number>());
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  callbacks.current = options;
  identity.current = observationKey;

  useEffect(() => {
    const changed = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);

  useEffect(() => {
    if (!taskId || !enabled || !pageVisible || (terminal && !replayTerminal)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false, refreshAgain = false, failures = 0;
    const active = () => !controller.signal.aborted && identity.current === observationKey;
    const refresh = async () => {
      if (!active()) return;
      if (refreshing) { refreshAgain = true; return; }
      refreshing = true;
      try {
        const taskRead = api.getAssistantTask(taskId, controller.signal).then(task => {
          if (!active()) return;
          if (task.id !== taskId) throw new NavigatorContractError("Navigator returned another task while refreshing the selected task.");
          callbacks.current.onTask(task);
        }).catch(error => { if (active()) callbacks.current.onError(error, "refresh"); });
        const resources = Promise.resolve().then(() => {
          if (active()) return callbacks.current.onRefresh?.(controller.signal);
        }).catch(error => { if (active()) callbacks.current.onError(error, "resources"); });
        await Promise.allSettled([taskRead, resources]);
      } finally {
        refreshing = false;
        if (refreshAgain && active()) { refreshAgain = false; scheduleRefresh(); }
      }
    };
    const scheduleRefresh = () => {
      if (timer || !active()) return;
      timer = setTimeout(() => { timer = undefined; void refresh(); }, 500);
    };
    const connect = async () => {
      while (active() && !document.hidden) {
        try {
          const cursor = cursors.current.get(observationKey) ?? 0;
          const response = await api.openAssistantTaskEvents(taskId, cursor, controller.signal);
          await readAssistantTaskEvents(response, cursor, controller.signal, event => {
            if (!active()) return;
            cursors.current.set(observationKey, event.sequence);
            callbacks.current.onEvent(event, taskId);
            scheduleRefresh();
          });
          if (terminal) return;
          failures = 0;
        } catch (error) {
          if (!active()) return;
          callbacks.current.onError(error, "stream");
          if (error instanceof NavigatorHttpError && error.status < 500 && ![408, 429].includes(error.status)) return;
          failures++;
        }
        await waitForReconnect(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)), controller.signal);
      }
    };
    const hidden = () => { if (document.hidden) controller.abort(); };
    document.addEventListener("visibilitychange", hidden);
    void connect();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", hidden); };
  }, [api, taskId, observationKey, enabled, terminal, replayTerminal, pageVisible]);
}

function waitForReconnect(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });
}
