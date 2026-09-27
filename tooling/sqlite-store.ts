import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";
import type { StateStore, StoreFactory } from "../packages/control-storage";
import { equal } from "../packages/pipeline-control/service";

/** Single-host development backend; team deployments use PostgreSQL. */
export class SqliteStoreFactory implements StoreFactory {
  private db: DatabaseSync;
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS studio_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }
  state<D>(key: string, schema: z.ZodType<D, z.ZodTypeDef, any>, empty: () => D): StateStore<D> {
    this.db.prepare("INSERT OR IGNORE INTO studio_state(key,value) VALUES (?,?)").run(key, JSON.stringify(schema.parse(empty())));
    const read = () => schema.parse(JSON.parse((this.db.prepare("SELECT value FROM studio_state WHERE key=?").get(key) as { value: string }).value));
    return {
      read: async () => read(),
      transact: async <T>(operation: (state: D) => T) => {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const state = read(), result = operation(state);
          if (result instanceof Promise) throw new Error("Transaction callbacks must be synchronous");
          this.db.prepare("UPDATE studio_state SET value=? WHERE key=?").run(JSON.stringify(schema.parse(state)), key);
          this.db.exec("COMMIT");
          return result;
        } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      },
    };
  }
  async close() { this.db.close(); }
  async importStates(entries: { key: string; value: unknown; empty: unknown }[]) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) {
        const old = this.db.prepare("SELECT value FROM studio_state WHERE key=?").get(entry.key) as { value: string } | undefined;
        if (old && !equal(JSON.parse(old.value), entry.empty) && !equal(JSON.parse(old.value), entry.value)) throw new Error(`Migration target ${entry.key} is not empty`);
        this.db.prepare("INSERT INTO studio_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(entry.key, JSON.stringify(entry.value));
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
