import { Pool } from "pg";
import type { z } from "zod";
import type { StateStore, StoreFactory } from "../packages/control-storage";
import { equal } from "../packages/pipeline-control/service";

/** Aggregate row locking preserves the existing service transaction boundary.
 * State and receipts commit together. No external side effects run in callbacks.
 * A later row-per-document migration can keep the service-facing interface.
 */
export class PostgresStoreFactory implements StoreFactory {
  readonly pool: Pool;
  private ready: Promise<unknown>;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 10_000 });
    this.ready = this.initialize();
  }
  private async initialize() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1937006965)");
      await client.query(`CREATE TABLE IF NOT EXISTS studio_state (
        key text PRIMARY KEY, value jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now())`);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  state<D>(key: string, schema: z.ZodType<D, z.ZodTypeDef, any>, empty: () => D): StateStore<D> {
    const ready = this.ready.then(() => this.pool.query(
      "INSERT INTO studio_state(key,value) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING", [key, JSON.stringify(schema.parse(empty()))]));
    return {
      read: async () => {
        await ready;
        const result = await this.pool.query("SELECT value FROM studio_state WHERE key=$1", [key]);
        return schema.parse(result.rows[0].value);
      },
      transact: async <T>(operation: (state: D) => T) => {
        await ready;
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          const result = await client.query("SELECT value FROM studio_state WHERE key=$1 FOR UPDATE", [key]);
          const state = schema.parse(result.rows[0].value);
          const output = operation(state);
          if (output instanceof Promise) throw new Error("Transaction callbacks must be synchronous");
          await client.query("UPDATE studio_state SET value=$2::jsonb, revision=revision+1, updated_at=now() WHERE key=$1", [key, JSON.stringify(schema.parse(state))]);
          await client.query("COMMIT");
          return output;
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      },
    };
  }
  async close() { await this.pool.end(); }
  async importStates(entries: { key: string; value: unknown; empty: unknown }[]) {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1937006965)");
      for (const entry of entries) {
        await client.query("INSERT INTO studio_state(key,value) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING", [entry.key, JSON.stringify(entry.empty)]);
        const result = await client.query("SELECT value FROM studio_state WHERE key=$1 FOR UPDATE", [entry.key]);
        if (!equal(result.rows[0].value, entry.empty) && !equal(result.rows[0].value, entry.value)) throw new Error(`Migration target ${entry.key} is not empty`);
        await client.query("UPDATE studio_state SET value=$2::jsonb, revision=revision+1, updated_at=now() WHERE key=$1", [entry.key, JSON.stringify(entry.value)]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
