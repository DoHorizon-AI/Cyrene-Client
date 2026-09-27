import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineControl, pipelineDatabase, emptyPipelineDatabase, type PipelineStore } from "../../packages/pipeline-control/service";
import { examplePipeline } from "../../packages/pipeline-model";
import { AtomicJsonStore } from "../../tooling/server-store";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import { PostgresStoreFactory } from "../../tooling/postgres-store";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const actor = { id: "alice", workspaceIds: ["local", "second"], scopes: ["pipelines.read", "pipelines.write"] };

async function fixture(kind: string) {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-redo-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const key = `redo-${crypto.randomUUID()}`;
  let factory: SqliteStoreFactory | PostgresStoreFactory | undefined;
  const connect = (): PipelineStore => {
    if (kind === "json") return new AtomicJsonStore(join(directory, "pipelines.json"), pipelineDatabase, emptyPipelineDatabase);
    factory = kind === "sqlite" ? new SqliteStoreFactory(join(directory, "control.sqlite")) : new PostgresStoreFactory(process.env.STUDIO_TEST_DATABASE_URL!);
    return factory.state(key, pipelineDatabase, emptyPipelineDatabase);
  };
  let store = connect(), control = new PipelineControl(store);
  cleanup.push(async () => {
    if (factory instanceof PostgresStoreFactory) await factory.pool.query("DELETE FROM studio_state WHERE key=$1", [key]);
    await factory?.close();
  });
  const call = (name: string, input: unknown, id = "alice", key = crypto.randomUUID()) => control.execute({ name, input, requestId: crypto.randomUUID(), idempotencyKey: key }, { ...actor, id }) as Promise<any>;
  const target = { workspaceId: "local", pipelineId: examplePipeline().id };
  const write = async (name: string, extra = {}, id = "alice") => {
    const record = await call("pipelines.get", target);
    return call(name, { ...target, expectedGraphRevision: record.graphRevision, expectedLayoutRevision: record.layoutRevision, ...extra }, id);
  };
  const patch = (nodeId: string, config: object, id = "alice") => write("pipelines.patch", { edits: [{ op: "update_node", nodeId, config }] }, id);
  await call("pipelines.create", { workspaceId: "local", document: examplePipeline() });
  return { call, write, patch, target, store: () => store, restart: async () => { await factory?.close(); store = connect(); control = new PipelineControl(store); } };
}

for (const kind of ["json", "sqlite", "postgres"]) describe.skipIf(kind === "postgres" && !process.env.STUDIO_TEST_DATABASE_URL)(`${kind} collaborative redo`, () => {
  it("survives reopening, is actor scoped, and preserves another actor's later undo", async () => {
    const f = await fixture(kind);
    await f.patch("training", { epochs: 5 });
    await f.patch("evaluation", { threshold: 0.9 }, "bob");
    await f.write("pipelines.undo");
    await expect(f.write("pipelines.redo", {}, "bob")).rejects.toMatchObject({ code: "NOTHING_TO_REDO" });
    await f.write("pipelines.undo", {}, "bob");
    await f.restart();
    const { record } = await f.write("pipelines.redo");
    expect(record.document.nodes.find((n: any) => n.id === "training").config.epochs).toBe(5);
    expect(record.document.nodes.find((n: any) => n.id === "evaluation").config.threshold).toBe(examplePipeline().nodes.find(n => n.id === "evaluation")!.config.threshold);
    await f.write("pipelines.redo", {}, "bob");
    await f.write("pipelines.undo");
    expect((await f.call("pipelines.get", f.target)).document.nodes.find((n: any) => n.id === "evaluation").config.threshold).toBe(0.9);
  });
  it("rejects overlapping redo without consuming it, then permits the valid order", async () => {
    const f = await fixture(kind);
    await f.patch("training", { epochs: 5 }); await f.patch("training", { epochs: 8 }, "bob");
    await f.write("pipelines.undo", {}, "bob"); await f.write("pipelines.undo");
    const before = await f.store().read();
    await expect(f.write("pipelines.redo", {}, "bob")).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await f.store().read()).toEqual(before);
    await f.write("pipelines.redo");
    const { record } = await f.write("pipelines.redo", {}, "bob");
    expect(record.document.nodes.find((n: any) => n.id === "training").config.epochs).toBe(8);
  });
  it("preserves independent layout changes and rejects overlapping positions", async () => {
    const f = await fixture(kind);
    const move = async (node: string, x: number, id: string) => {
      const { document } = await f.call("pipelines.get", f.target);
      document.presentation.nodes[node].x = x;
      return f.write("pipelines.save", { presentation: document.presentation }, id);
    };
    await move("training", 900, "alice"); await move("evaluation", 1200, "bob");
    await f.write("pipelines.undo"); await f.write("pipelines.undo", {}, "bob");
    const { record } = await f.write("pipelines.redo");
    expect(record.document.presentation.nodes.training.x).toBe(900);
    expect(record.document.presentation.nodes.evaluation).toEqual(examplePipeline().presentation.nodes.evaluation);
    await move("training", 1000, "bob");
    await f.write("pipelines.undo", {}, "bob"); await f.write("pipelines.undo");
    await expect(f.write("pipelines.redo", {}, "bob")).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it("clears redo on any actor's effective write to that pipeline only", async () => {
    const f = await fixture(kind);
    await f.patch("training", { epochs: 5 }); await f.write("pipelines.undo");
    await f.call("pipelines.create", { workspaceId: "second", document: examplePipeline() }, "bob");
    await f.write("pipelines.save", { graph: (({ presentation, ...graph }) => graph)((await f.call("pipelines.get", f.target)).document) }, "bob");
    expect((await f.store().read()).redo).toHaveLength(1);
    await f.patch("evaluation", { threshold: 0.9 }, "bob");
    await expect(f.write("pipelines.redo")).rejects.toMatchObject({ code: "NOTHING_TO_REDO" });
  });
  it("infers legacy ownership only from an unambiguous same-actor history", async () => {
    const f = await fixture(kind);
    await f.patch("training", { epochs: 5 }); await f.write("pipelines.undo");
    await f.store().transact(db => { for (const redo of db.redo) { delete redo.actorId; delete redo.undoneDocument; } });
    await f.restart();
    await expect(f.write("pipelines.redo", {}, "bob")).rejects.toMatchObject({ code: "NOTHING_TO_REDO" });
    await f.write("pipelines.redo"); await f.write("pipelines.undo");
    await f.store().transact(db => { for (const redo of db.redo) { delete redo.actorId; delete redo.undoneDocument; redo.targetHistoryId = "missing"; } });
    const before = await f.store().read();
    await expect(f.write("pipelines.redo")).rejects.toMatchObject({ code: "NOTHING_TO_REDO" });
    expect(await f.store().read()).toEqual(before);
  });
});
