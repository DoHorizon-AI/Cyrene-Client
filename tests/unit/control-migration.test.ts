import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyPipelineDatabase, pipelineDatabase, PipelineControl } from "../../packages/pipeline-control/service";
import { MemoryStateStore } from "../../packages/control-storage";
import { emptyDatabase } from "../../packages/server-control/service";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import { examplePipeline } from "../../packages/pipeline-model";

it("migrates legacy stores with backups, repeats safely and preserves a corrupt source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-migration-"));
  try {
    const memory = new MemoryStateStore(emptyPipelineDatabase());
    await new PipelineControl(memory).execute({ name: "pipelines.create", input: { workspaceId: "local", document: examplePipeline() }, requestId: "import", idempotencyKey: "import" }, { id: "owner", workspaceIds: ["local"], scopes: ["pipelines.write"] });
    const source = JSON.stringify(await memory.read());
    await writeFile(join(directory, "pipelines.json"), source); await writeFile(join(directory, "server-registry.json"), JSON.stringify(emptyDatabase()));
    const run = () => promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/migrate-control.ts"], { env: { ...process.env, STUDIO_DATABASE_URL: "", STUDIO_CONTROL_DATA_DIR: directory }, timeout: 15000 });
    await run(); await run();
    expect(await readFile(join(directory, "pipelines.json"), "utf8")).toBe(source);
    expect(await readdir(join(directory, "backups"))).toHaveLength(2);
    await writeFile(join(directory, "pipelines.json"), "{broken"); await expect(run()).rejects.toThrow();
    expect(await readFile(join(directory, "pipelines.json"), "utf8")).toBe("{broken");
    const store = new SqliteStoreFactory(join(directory, "control.sqlite"));
    try { expect(await store.state("pipelines", pipelineDatabase, emptyPipelineDatabase).read()).toEqual(await memory.read()); } finally { await store.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 20000);
