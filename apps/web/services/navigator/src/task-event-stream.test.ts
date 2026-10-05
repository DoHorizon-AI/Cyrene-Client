// -----------------------------------------------------------------------------
// Module: src/task-event-stream.test.ts
// Role: Verify sequenced task event replay and safe event labels.
// 中文：模块职责：验证任务事件序号去重以及安全事件标签。
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { assistantEventLabel, readAssistantTaskEvents } from "./task-event-stream";

describe("assistant task event stream", () => {
  it("accepts only new sequenced events and never renders an event message", async () => {
    const response = new Response([
      "id: 2", "event: task.status_changed", 'data: {"type":"task.status_changed","status":"running","message":"private-qr-payload"}', "",
      "id: 2", "event: duplicate", 'data: {"type":"duplicate"}', "",
      "id: 3", "event: task.completed", 'data: {"type":"task.completed","status":"completed"}', "", "",
    ].join("\n"), { headers: { "Content-Type": "text/event-stream" } });
    const controller = new AbortController();
    const accepted: Array<{ sequence: number; label: string }> = [];
    const cursor = await readAssistantTaskEvents(response, 1, controller.signal, event => {
      accepted.push({ sequence: event.sequence, label: assistantEventLabel(event) });
    });
    expect(cursor).toBe(3);
    expect(accepted).toEqual([
      { sequence: 2, label: "task.status_changed · running" },
      { sequence: 3, label: "task.completed · completed" },
    ]);
    expect(JSON.stringify(accepted)).not.toContain("private-qr-payload");
    expect(assistantEventLabel({ sequence: 4, name: "private-qr-payload", data: { type: "private-qr-payload", status: "private-qr-payload" } })).toBe("task.event");
  });

  it("rejects malformed frames instead of inventing an event", async () => {
    const response = new Response("id: nope\nevent: task.changed\ndata: {}\n\n", { headers: { "Content-Type": "text/event-stream" } });
    await expect(readAssistantTaskEvents(response, 0, new AbortController().signal, () => undefined)).rejects.toMatchObject({ name: "NavigatorContractError" });
  });
});
