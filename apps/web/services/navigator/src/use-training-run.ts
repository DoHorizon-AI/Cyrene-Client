// Role: Keep one owner-backed run observation scoped to its mounted session.
// 中文：在当前会话中观察一个由所属服务管理的任务。

import { useEffect, useRef, useState } from "react";
import { NavigatorContractError, NavigatorHttpError, type JsonRecord, type NavigatorApi } from "./api";
import { isRetryableTrainingRead, watchTrainingEvents, type TrainingStreamState } from "./training-run-stream";

export interface TrainingObservation {
  run: JsonRecord | null;
  attempts: JsonRecord[] | null;
  loading: boolean;
  error: string | null;
  attemptError: string | null;
  streamState: TrainingStreamState;
  streamError: string | null;
  events: JsonRecord[];
  latestLoss: number | null;
  currentStep: number | null;
  totalSteps: number | null;
  lossSeries: number[];
  etaSeconds: number | null;
  latestCheckpoint: string | null;
}

/** Narrow run operations shared by local and Workspace-backed clients.
 * 中文：本机和 Workspace 客户端共同使用的任务操作边界。
 */
export type TrainingRunClient = Pick<NavigatorApi,
  "getTrainingRun" | "getTrainingRunAttempts" | "openTrainingRunEvents" |
  "cancelTrainingRun" | "resumeTrainingRun" | "sendResultToReactor"> & {
  readonly capabilities?: { cancel: boolean; resume: boolean; deploy: boolean };
};

function emptyObservation(loading: boolean): TrainingObservation {
  return {
    run: null, attempts: null, loading, error: null, attemptError: null,
    streamState: "connecting", streamError: null, events: [], latestLoss: null,
    currentStep: null, totalSteps: null, lossSeries: [], etaSeconds: null, latestCheckpoint: null,
  };
}

/** Keep bounded display history; durable history and run state remain in Yield.
 * 中文：限制页面历史大小；完整历史和运行状态仍由 Yield 持久保存。
 */
export function appendTrainingEvent(state: TrainingObservation, event: JsonRecord): TrainingObservation {
  const payload = record(event.payload);
  const loss = finite(event.loss) ?? finite(payload.loss);
  const step = finite(event.step) ?? finite(payload.step) ?? finite(payload.currentStep);
  const total = finite(event.totalSteps) ?? finite(payload.totalSteps) ?? finite(payload.total_steps);
  const eta = finite(event.etaSeconds) ?? finite(payload.etaSeconds) ?? finite(payload.eta_seconds);
  const checkpoint = record(event.checkpoint ?? payload.checkpoint);
  const name = checkpoint.name ?? checkpoint.checkpointName;
  return {
    ...state, events: [...state.events.slice(-49), event],
    latestLoss: loss ?? state.latestLoss,
    lossSeries: loss === null ? state.lossSeries : [...state.lossSeries.slice(-199), loss],
    currentStep: step !== null && step >= 0 ? step : state.currentStep,
    totalSteps: total !== null && total >= 0 ? total : state.totalSteps,
    etaSeconds: eta !== null && eta >= 0 ? eta : state.etaSeconds,
    latestCheckpoint: typeof name === "string" && name.trim() ? name : state.latestCheckpoint,
  };
}

/** Cancel reads, streams and timers on run/session changes. 中文：切换任务或会话时取消全部读取和计时器。 */
export function useTrainingRun(api: TrainingRunClient, runId: string) {
  const [revision, setRevision] = useState(0);
  const [observation, setObservation] = useState<TrainingObservation>(() => emptyObservation(Boolean(runId)));
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false, refreshAgain = false, streamStarted = false, stopped = false, terminal = false;
    setObservation(emptyObservation(Boolean(runId)));
    const change = (update: (current: TrainingObservation) => TrainingObservation) => {
      if (!controller.signal.aborted) setObservation(update);
    };

    const refresh = async () => {
      if (!runId || controller.signal.aborted) return;
      if (pending) { refreshAgain = true; return; }
      pending = true;
      const request = new AbortController();
      const abort = () => request.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 15_000);
      try {
        const value = await api.getTrainingRun(runId, request.signal);
        if (controller.signal.aborted) return;
        if (value.id !== runId) throw new NavigatorContractError("Yield returned a different training run.");
        terminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(String(value.state));
        stopped = false;
        change((current) => ({ ...current, run: value, loading: false, error: null }));
        if (!streamStarted) {
          streamStarted = true;
          void watchTrainingEvents({
            runId, signal: controller.signal,
            open: (cursor, signal) => api.openTrainingRunEvents(runId, cursor, signal),
            onEvent: (event) => change((current) => appendTrainingEvent(current, event)),
            onState: (streamState, error) => {
              change((current) => ({
                ...(isAccessDenied(error) ? emptyObservation(false) : current),
                streamState, streamError: error instanceof Error ? error.message : null,
                error: isAccessDenied(error) ? message(error) : current.error,
              }));
              if (isAccessDenied(error)) controller.abort();
            },
            onConnected: () => { if (!pending) void refresh(); },
            onDone: () => { void refresh(); },
          }).catch((error: unknown) => change((current) => ({ ...current, streamState: "error", streamError: message(error) })));
        }
        try {
          const attempts = await api.getTrainingRunAttempts(runId, request.signal);
          change((current) => ({ ...current, attempts, attemptError: null }));
        } catch (error) {
          change((current) => ({ ...current, attemptError: message(error) }));
        }
      } catch (error) {
        stopped = !isRetryableTrainingRead(error);
        change((current) => ({ ...(isAccessDenied(error) ? emptyObservation(false) : current), loading: false, error: message(error) }));
        if (isAccessDenied(error)) controller.abort();
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abort);
        pending = false;
        if (refreshAgain && !controller.signal.aborted) {
          refreshAgain = false;
          void refresh();
        }
      }
    };
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const timer = setInterval(() => { if (!stopped && !terminal) void refresh(); }, 10_000);
    const online = () => { if (!stopped) void refresh(); };
    globalThis.addEventListener?.("online", online);
    return () => {
      controller.abort();
      clearInterval(timer);
      globalThis.removeEventListener?.("online", online);
      refreshRef.current = () => undefined;
    };
  }, [api, runId, revision]);

  return {
    ...observation,
    refresh: () => refreshRef.current(),
    reconnect: () => setRevision((value) => value + 1),
  };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The training run could not be read.";
}

function isAccessDenied(error: unknown): boolean {
  return error instanceof NavigatorHttpError && [401, 403, 404].includes(error.status);
}
