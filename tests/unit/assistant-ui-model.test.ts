import { expect, it } from "vitest";
import { examplePipeline } from "../../packages/pipeline-model";
import { changedPipelineRecords, chatSessions, mergeTaskRecords, taskWorkflow, workflowSnapshot } from "../../apps/web/src/assistant/model";
import type { NavigatorTaskRecord } from "../../apps/web/services/navigator/src/api";
import { parseLegacyHistory } from "../../apps/web/src/assistant/legacy-history";

const task = (id: string, sessionId: string, createdAt: number): NavigatorTaskRecord => ({
  id, sessionId, workspaceId: "local", prompt: "Hello", status: "completed", createdAt, startedAt: createdAt,
  endedAt: createdAt, output: "Done", reasoning: "", error: null, durationMs: 0, sequence: 1, metadata: {},
});

it("pins a detached workflow snapshot to the originating task across graph edits", () => {
  const document = examplePipeline();
  const snapshot = workflowSnapshot(document, null, "training");
  const submitted = { ...task("turn-1", "session-1", 1), metadata: { workflow: snapshot } };
  document.name = "Another pipeline"; document.nodes[0].label = "Changed";
  expect(snapshot.document.name).not.toBe(document.name);
  expect(snapshot.document.nodes[0].label).not.toBe(document.nodes[0].label);
  expect(taskWorkflow(submitted)).toEqual({ pipelineId: snapshot.pipelineId, name: snapshot.name });
  expect(snapshot.hasLocalChanges).toBe(true);
});

it("groups durable turns by Navigator session and orders history by latest activity", () => {
  const sessions = chatSessions([task("turn-3", "session-1", 3), task("turn-2", "session-2", 2), task("turn-1", "session-1", 1)]);
  expect(sessions.map(session => session.id)).toEqual(["session-1", "session-2"]);
  expect(sessions[0].turns.map(turn => turn.id)).toEqual(["turn-1", "turn-3"]);
});

it("reads legacy text without restoring approvals, tools or credential-bearing metadata", () => {
  const archive = { schemaVersion: 1, kind: "cyrene-legacy-assistant-history", workspaceId: "local", sessions: [{
    id: "old-1", title: "Old chat", runtime: "codex", updatedAt: 1, apiKey: "private-key", events: [
      { seq: 1, type: "user", data: { text: "Hello", workflow: { private: true } } },
      { seq: 2, type: "approval", data: { text: "Execute this", id: "approval-1" } },
      { seq: 3, type: "tool", data: { apiKey: "private-key" } },
    ],
  }] };
  const chats = parseLegacyHistory(archive, "local");
  expect(chats[0].events).toEqual([{ seq: 1, type: "user", text: "Hello" }]);
  expect(JSON.stringify(chats)).not.toContain("private-key");
  expect(() => parseLegacyHistory(archive, "other-workspace")).toThrow(/workspace/);
});

it("keeps terminal task observations when an older active response arrives later", () => {
  const completed = { ...task("turn-1", "session-1", 1), sequence: 10 };
  const stale = { ...completed, status: "running" as const, sequence: 9 };
  expect(mergeTaskRecords([completed], [stale])[0]).toEqual(completed);
});

it("shows the schema-checked written pipeline rather than assuming the context pipeline was the target", () => {
  const record = { document: { ...examplePipeline(), id: "written-other-flow", name: "Other flow" }, workspaceId: "local", graphRevision: 2, layoutRevision: 1, updatedBy: "agent", updatedAt: new Date().toISOString() };
  const events = [
    { sequence: 1, name: "tool-call", data: { type: "tool-call", callId: "write-1", tool: "mcp__cyrene__pipelines_patch" } },
    { sequence: 2, name: "tool-result", data: { type: "tool-result", callId: "write-1", result: JSON.stringify({ structuredContent: { record } }) } },
  ];
  expect(changedPipelineRecords(events)).toEqual([record]);
  expect(changedPipelineRecords([{ ...events[1], data: { ...events[1].data, isError: true } }])).toEqual([]);
  expect(changedPipelineRecords([{ ...events[1], data: { ...events[1].data, tool: "pipelines.get" } }])).toEqual([]);
});
