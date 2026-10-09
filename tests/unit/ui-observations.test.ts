import { describe, expect, it } from "vitest";
import type { Build } from "../../packages/build-control/contracts";
import { examplePipeline } from "../../packages/pipeline-model";
import { mergeBuildObservation } from "../../apps/web/src/builds/observations";
import { retainRecoveries, type Recovery } from "../../apps/web/src/pipelines/recovery";

describe("late UI observations", () => {
  it("keeps a newer cancellation and terminal result when an older poll arrives", () => {
    const current = { id: "build-1", revision: 8, state: "cancelled" } as Build;
    expect(mergeBuildObservation(current, { ...current, revision: 7, state: "running" })).toBe(current);
    expect(mergeBuildObservation(current, { ...current, revision: 9, state: "running" })).toBe(current);
    expect(mergeBuildObservation(current, { ...current, revision: 9 })).toMatchObject({ revision: 9 });
  });
  it("limits recovery to the latest 20 records per actor, workspace and pipeline", () => {
    const rows: Recovery[] = Array.from({ length: 25 }, (_, sequence) => ({
      id: `row-${sequence}`, actorId: "alice", workspaceId: "local", tabId: "tab", sequence,
      savedAt: new Date(1000 * sequence).toISOString(), document: examplePipeline(), history: [], selectedId: null,
    }));
    const other: Recovery[] = [
      { ...rows[0], id: "other-pipeline", document: { ...rows[0].document, id: "another" } },
      { ...rows[0], id: "other-actor", actorId: "bob" },
      { ...rows[0], id: "other-workspace", workspaceId: "remote" },
    ];
    const retained = retainRecoveries([...other, ...rows]);
    expect(retained).toHaveLength(23);
    expect(retained.map(row => row.id)).toEqual(expect.arrayContaining(other.map(row => row.id)));
    expect(retained.some(row => row.id === "row-4")).toBe(false);
    expect(retained.some(row => row.id === "row-5")).toBe(true);
  });
});
