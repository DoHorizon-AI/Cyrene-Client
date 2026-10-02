// Role: Check cursor recovery, event framing and authorization failure behavior.
// 中文：验证游标恢复、事件分帧以及授权失败时的行为。

import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigatorContractError, NavigatorHttpError, type JsonRecord } from "./api";
import { readTrainingEvents, watchTrainingEvents } from "./training-run-stream";
import { appendTrainingEvent, type TrainingObservation } from "./use-training-run";

function frame(sequence: number, extra: JsonRecord = {}, runId = "run-1"): string {
  return `id: ${sequence}\nevent: metrics\ndata: ${JSON.stringify({ sequence, trainingRunId: runId, kind: "metrics", ...extra })}\n\n`;
}
function done(sequence: number): string {
  return `id: ${sequence}\nevent: done\ndata: ${JSON.stringify({ sequence, state: "COMPLETED" })}\n\n`;
}
function stream(text: string, fragment = false): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    if (fragment) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => vi.useRealTimers());

describe("durable training stream", () => {
  it("handles split UTF-8/CRLF, comments, multiline data and duplicate sequences", async () => {
    const events: JsonRecord[] = [];
    const multiline = frame(1, { message: "训练" }).replace(',"trainingRunId"', ',\ndata: "trainingRunId"');
    const input = `: heartbeat\n\n${multiline}${frame(1)}${frame(2)}${done(2)}`.replaceAll("\n", "\r\n");
    expect(await readTrainingEvents(stream(input, true), "run-1", 0, new AbortController().signal, (event) => events.push(event)))
      .toEqual({ cursor: 2, terminal: true });
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[0]?.message).toBe("训练");
  });

  it("does not advance for an incomplete frame at EOF", async () => {
    const events: JsonRecord[] = [];
    expect(await readTrainingEvents(stream(frame(1) + frame(2).slice(0, -1)), "run-1", 0, new AbortController().signal, (event) => events.push(event)))
      .toEqual({ cursor: 1, terminal: false });
    expect(events).toHaveLength(1);
  });

  it.each([
    frame(1, {}, "another-run"), frame(1).replace("id: 1", "id: 2"),
    frame(1).replace("event: metrics", "event: checkpoint"), "id: 1\nevent: metrics\ndata: invalid\n\n",
    done(1), done(0).replace("COMPLETED", "RUNNING"),
  ])("rejects unbound or malformed events", async (input) => {
    await expect(readTrainingEvents(stream(input), "run-1", 0, new AbortController().signal, () => undefined))
      .rejects.toBeInstanceOf(NavigatorContractError);
  });

  it("limits incomplete frame memory", async () => {
    await expect(readTrainingEvents(stream("data: " + "x".repeat(1_048_577)), "run-1", 0, new AbortController().signal, () => undefined))
      .rejects.toBeInstanceOf(NavigatorContractError);
  });

  it("reconnects after EOF using the accepted cursor and ignores replayed frames", async () => {
    vi.useFakeTimers();
    const cursors: number[] = [], events: number[] = [], states: string[] = [];
    const task = watchTrainingEvents({
      runId: "run-1", signal: new AbortController().signal,
      open: async (cursor) => {
        cursors.push(cursor);
        return stream(cursors.length === 1 ? frame(1) : frame(1) + frame(2) + done(2));
      },
      onEvent: (event) => events.push(Number(event.sequence)),
      onState: (state) => states.push(state),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await task;
    expect(cursors).toEqual([0, 1]);
    expect(events).toEqual([1, 2]);
    expect(states).toContain("reconnecting");
    expect(states.at(-1)).toBe("finished");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the cursor after a transport exception", async () => {
    vi.useFakeTimers();
    const cursors: number[] = [];
    const task = watchTrainingEvents({
      runId: "run-1", signal: new AbortController().signal,
      open: async (cursor) => {
        cursors.push(cursor);
        if (cursors.length > 1) return stream(done(1));
        let first = true;
        return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
          if (first) { first = false; controller.enqueue(new TextEncoder().encode(frame(1))); }
          else controller.error(new Error("network disconnected"));
        } }));
      }, onEvent: () => undefined, onState: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await task;
    expect(cursors).toEqual([0, 1]);
  });

  it("stops on access denial and cancels delayed retries when unmounted", async () => {
    vi.useFakeTimers();
    const denied = vi.fn(async () => { throw new NavigatorHttpError(403, "FORBIDDEN", "denied", false); });
    const state = vi.fn();
    await watchTrainingEvents({ runId: "run-1", signal: new AbortController().signal, open: denied, onEvent: () => undefined, onState: state });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(state.mock.calls.at(-1)?.[0]).toBe("error");
    const controller = new AbortController();
    const disconnected = vi.fn(async () => { throw new TypeError("offline"); });
    const task = watchTrainingEvents({ runId: "run-1", signal: controller.signal, open: disconnected, onEvent: () => undefined, onState: () => undefined });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await task;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads top-level metrics with empty payloads and bounds display history", () => {
    let state: TrainingObservation = {
      run: null, attempts: null, loading: false, error: null, attemptError: null,
      streamState: "connected", streamError: null, events: [], latestLoss: null, currentStep: null,
      totalSteps: null, lossSeries: [], etaSeconds: null, latestCheckpoint: null,
    };
    for (let step = 0; step < 250; step++) {
      state = appendTrainingEvent(state, { sequence: step + 1, step, loss: 0.1, totalSteps: 300, etaSeconds: 5, checkpoint: { name: "checkpoint-200" }, payload: {} });
    }
    expect(state.events).toHaveLength(50);
    expect(state.lossSeries).toHaveLength(200);
    expect(state).toMatchObject({ currentStep: 249, latestLoss: 0.1, totalSteps: 300, etaSeconds: 5, latestCheckpoint: "checkpoint-200" });
  });
});
