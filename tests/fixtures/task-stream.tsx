import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { NavigatorApi, type NavigatorTaskEvent, type NavigatorTaskRecord } from "../../apps/web/services/navigator/src/api";
import { useTaskStream } from "../../apps/web/services/navigator/src/useTaskStream";

function TaskStreamFixture() {
  const api = useMemo(() => new NavigatorApi(), []);
  const pausedResume = new URLSearchParams(location.search).has("paused-resume");
  const [selected, setSelected] = useState("task-a");
  const [scope, setScope] = useState("scope-a");
  const [observations, setObservations] = useState<NavigatorTaskRecord[]>(() => pausedResume ? [fixtureTask("waiting_approval")] : []);
  const [events, setEvents] = useState<Record<string, NavigatorTaskEvent[]>>({});
  const [error, setError] = useState("");
  const task = observations.find(value => value.id === selected);
  useTaskStream({
    api, taskId: selected, scopeKey: scope,
    terminal: !!task && ["completed", "failed", "aborted", "waiting_approval", "waiting_input", "awaiting_user_authorization"].includes(task.status),
    replayTerminal: pausedResume,
    onEvent: (event, id) => setEvents(current => ({ ...current, [id]: [...(current[id] ?? []), event] })),
    onTask: value => setObservations(current => [...current.filter(task => task.id !== value.id), value]),
    onRefresh: new URLSearchParams(location.search).has("resources-fail")
      ? () => Promise.reject(new Error("Related resource unavailable"))
      : new URLSearchParams(location.search).has("resources-slow")
        ? signal => new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true }))
        : undefined,
    onError: error => setError(String(error)),
  });
  return <main>
    <button onClick={() => setSelected("task-b")}>Select B</button>
    <button onClick={() => { setScope("scope-b"); setObservations([]); setEvents({}); }}>Switch scope</button>
    {pausedResume && <button onClick={() => void fetch("/api/fixture/task-stream/resume", { method: "POST" }).then(() => api.getAssistantTask("task-a")).then(value => setObservations(current => [...current.filter(item => item.id !== value.id), value]))}>Resume task</button>}
    <output aria-label="Task observations">{JSON.stringify(observations.map(({ id, status, workspaceId }) => ({ id, status, workspaceId })))}</output>
    <output aria-label="Task events">{JSON.stringify(Object.fromEntries(Object.entries(events).map(([id, values]) => [id, values.map(event => event.sequence)])))}</output>
    <p role="alert">{error}</p>
  </main>;
}

function fixtureTask(status: NavigatorTaskRecord["status"]): NavigatorTaskRecord {
  return { id: "task-a", workspaceId: "local", sessionId: "session-a", prompt: "Task A", status, createdAt: 1,
    startedAt: 1, endedAt: null, output: "", reasoning: "", error: null, durationMs: 0, sequence: 1, metadata: {} };
}

createRoot(document.getElementById("root")!).render(<TaskStreamFixture />);
