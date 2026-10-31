import type { Pipeline } from "../../../../packages/pipeline-model";
import { recordSchema, type PipelineRecord } from "../../../../packages/pipeline-control/contracts";
import type { NavigatorTaskEvent, NavigatorTaskRecord } from "../../services/navigator/src/api";

export function workflowSnapshot(document: Pipeline, base: PipelineRecord | null, selectedId: string | null) {
  const saved = base?.document.id === document.id ? base : null;
  return {
    pipelineId: document.id, name: document.name,
    ...(saved ? { graphRevision: saved.graphRevision, layoutRevision: saved.layoutRevision } : {}),
    hasLocalChanges: !saved || JSON.stringify(document) !== JSON.stringify(saved.document),
    ...(selectedId && document.nodes.some(node => node.id === selectedId) ? { selectedNodeId: selectedId } : {}),
    document: structuredClone(document),
  };
}

export function taskWorkflow(task: NavigatorTaskRecord): { pipelineId: string; name: string } | null {
  const value = task.metadata.workflow;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const workflow = value as Record<string, unknown>;
  return typeof workflow.pipelineId === "string"
    ? { pipelineId: workflow.pipelineId, name: typeof workflow.name === "string" ? workflow.name : workflow.pipelineId }
    : null;
}

export function isActiveTask(task: NavigatorTaskRecord): boolean {
  return ["queued", "running", "waiting_approval", "waiting_input"].includes(task.status);
}

export function mergeTaskRecords(previous: NavigatorTaskRecord[], incoming: NavigatorTaskRecord[]): NavigatorTaskRecord[] {
  const records = new Map(previous.map(task => [task.id, task]));
  for (const task of incoming) {
    const current = records.get(task.id);
    if (current && (current.sequence > task.sequence || (!isActiveTask(current) && isActiveTask(task)))) continue;
    records.set(task.id, task);
  }
  return [...records.values()];
}

export function chatSessions(tasks: NavigatorTaskRecord[]) {
  const sessions = new Map<string, NavigatorTaskRecord[]>();
  for (const task of tasks) {
    const list = sessions.get(task.sessionId) ?? [];
    list.push(task); sessions.set(task.sessionId, list);
  }
  return [...sessions].map(([id, turns]) => ({ id, turns: turns.sort((a, b) => a.createdAt - b.createdAt) }))
    .sort((a, b) => b.turns.at(-1)!.createdAt - a.turns.at(-1)!.createdAt);
}

const pipelineWrites = new Set(["pipelines.create", "pipelines.save", "pipelines.patch", "pipelines.layout", "pipelines.undo", "pipelines.redo"]);

/** Accept only successful, schema-checked MCP results associated with a real write call. */
export function changedPipelineRecords(events: NavigatorTaskEvent[]): PipelineRecord[] {
  const calls = new Map<string, string>(), records = new Map<string, PipelineRecord>();
  for (const event of events) {
    const type = typeof event.data.type === "string" ? event.data.type : event.name;
    const callId = String(event.data.callId ?? "");
    const tool = typeof event.data.tool === "string" ? event.data.tool : calls.get(callId) ?? "";
    const normalized = tool.replace(/^mcp__cyrene__/, "").replace(/^pipelines_/, "pipelines.");
    if (type === "tool-call") { calls.set(callId, normalized); continue; }
    if (type !== "tool-result" || event.data.isError === true || !pipelineWrites.has(normalized)) continue;
    try {
      const value = typeof event.data.result === "string" ? JSON.parse(event.data.result) : event.data.result;
      if (!value || typeof value !== "object" || value.isError === true) continue;
      let candidate = value.structuredContent?.record ?? value.record;
      if (!candidate && Array.isArray(value.content)) {
        for (const block of value.content) {
          if (block.type !== "text" || typeof block.text !== "string") continue;
          try { const text = JSON.parse(block.text); candidate = text.record ?? text.structuredContent?.record; if (candidate) break; } catch { /* Not a graph record. */ }
        }
      }
      const record = recordSchema.safeParse(candidate);
      if (record.success) records.set(record.data.document.id, record.data);
    } catch { /* Unstructured tool output does not identify a saved graph. */ }
  }
  return [...records.values()];
}
