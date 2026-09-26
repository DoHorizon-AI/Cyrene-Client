import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pipelineDatabase, emptyPipelineDatabase } from "../packages/pipeline-control/service";
import { databaseSchema, emptyDatabase } from "../packages/server-control/service";
import { PostgresStoreFactory } from "../tooling/postgres-store";
import { SqliteStoreFactory } from "../tooling/sqlite-store";

const directory = resolve(process.env.STUDIO_CONTROL_DATA_DIR ?? ".studio");
const backup = resolve(directory, "backups", `migration-${crypto.randomUUID()}`);
const sources = [
  { key: "pipelines", file: "pipelines.json", schema: pipelineDatabase, empty: emptyPipelineDatabase() },
  { key: "servers", file: "server-registry.json", schema: databaseSchema, empty: emptyDatabase() },
];
const entries: { key: string; value: unknown; empty: unknown }[] = [];
for (const source of sources) {
  let raw: string;
  try { raw = await readFile(resolve(directory, source.file), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
  // Invalid source is never treated as an empty database.
  const value = source.schema.parse(JSON.parse(raw));
  await mkdir(backup, { recursive: true, mode: 0o700 });
  await copyFile(resolve(directory, source.file), resolve(backup, source.file), constants.COPYFILE_EXCL);
  entries.push({ key: source.key, value, empty: source.empty });
}
if (!entries.length) throw new Error("No legacy JSON stores found. Nothing was changed.");
const stores = process.env.STUDIO_DATABASE_URL ? new PostgresStoreFactory(process.env.STUDIO_DATABASE_URL) : new SqliteStoreFactory(resolve(directory, "control.sqlite"));
try { await stores.importStates(entries); process.stdout.write(`Migrated ${entries.length} stores atomically. Original files retained. Backup: ${backup}\n`); }
finally { await stores.close(); }
