import { useMemo, useSyncExternalStore } from "react";
import { runObservationSchema, type Run, type RunDatabase } from "../../../../packages/run-control/contracts";
import { executeRun } from "./client";

type View = { run: Run | null; events: RunDatabase["events"]; connection: "idle" | "connecting" | "live" | "offline" | "reconnecting"; observedAt?: string };
const empty: View = { run: null, events: [], connection: "idle" };
const entries = new Map<string, ReturnType<typeof createEntry>>();
function createEntry(workspaceId: string, runId: string) {
  let view = empty, cursor = 0, generation = 0, stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<View>) => { view = { ...view, ...patch }; listeners.forEach(listener => listener()); };
  const start = () => {
    const epoch = ++generation;
    let stream: EventSource | undefined, pending = false;
    const current = () => generation === epoch;
    const apply = (raw: unknown) => {
      const value = runObservationSchema.parse(raw);
      if (!current() || value.run.workspaceId !== workspaceId || value.run.id !== runId) return;
      if (view.run && value.run.revision < view.run.revision) return;
      const fresh = value.items.filter(event => event.sequence > cursor);
      cursor = Math.max(cursor, value.cursor);
      update({ run: value.run, events: [...view.events, ...fresh].slice(-200), observedAt: new Date().toISOString(), connection: "live" });
    };
    const connect = () => {
      stream?.close();
      if (!navigator.onLine) { update({ connection: "offline" }); return; }
      update({ connection: "connecting" });
      stream = new EventSource(`/studio-runs/v1/stream?${new URLSearchParams({ workspaceId, runId, after: String(cursor) })}`);
      stream.addEventListener("observation", event => { try { apply(JSON.parse((event as MessageEvent).data)); } catch { if (current()) update({ connection: "reconnecting" }); } });
      stream.onerror = () => { if (current()) update({ connection: "reconnecting" }); };
    };
    const offline = () => { stream?.close(); update({ connection: "offline" }); };
    const poll = async () => {
      if (pending || !navigator.onLine || !current()) return;
      pending = true;
      try { apply(await executeRun("runs.observe", { workspaceId, runId, after: cursor })); }
      catch { if (current()) update({ connection: "reconnecting" }); }
      finally { pending = false; }
    };
    window.addEventListener("online", connect); window.addEventListener("offline", offline);
    connect(); void poll(); const timer = setInterval(() => void poll(), 5000);
    stop = () => { ++generation; stream?.close(); clearInterval(timer); window.removeEventListener("online", connect); window.removeEventListener("offline", offline); view = empty; cursor = 0; };
  };
  return {
    get: () => view,
    subscribe: (listener: () => void) => {
      listeners.add(listener); if (listeners.size === 1) start();
      return () => { listeners.delete(listener); if (!listeners.size) { stop?.(); } };
    },
  };
}
const idle = { get: () => empty, subscribe: (_listener: () => void) => () => {} };
export function useRunObservation(actorId: string, workspaceId: string, runId: string | null, enabled: boolean) {
  const entry = useMemo(() => {
    if (!runId || !enabled) return idle;
    const key = JSON.stringify([actorId, workspaceId, runId]);
    let value = entries.get(key);
    if (!value) { value = createEntry(workspaceId, runId); entries.set(key, value); }
    return value;
  }, [actorId, workspaceId, runId, enabled]);
  return useSyncExternalStore(entry.subscribe, entry.get);
}
