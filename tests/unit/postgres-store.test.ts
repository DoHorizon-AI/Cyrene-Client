import { expect, it } from "vitest";
import { z } from "zod";
import { PostgresStoreFactory } from "../../tooling/postgres-store";

it.skipIf(!process.env.STUDIO_TEST_DATABASE_URL)("PostgreSQL serializes competing writers and persists receipts across clients", async () => {
  const first = new PostgresStoreFactory(process.env.STUDIO_TEST_DATABASE_URL!), second = new PostgresStoreFactory(process.env.STUDIO_TEST_DATABASE_URL!);
  const schema = z.object({ value: z.number(), receipts: z.array(z.string()) }), key = `test-${crypto.randomUUID()}`;
  const a = first.state(key, schema, () => ({ value: 0, receipts: [] })), b = second.state(key, schema, () => ({ value: 0, receipts: [] }));
  try {
    await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? a : b).transact(state => { state.value++; state.receipts.push(String(index)); })));
    expect((await a.read()).value).toBe(20); expect(new Set((await b.read()).receipts).size).toBe(20);
    await expect(a.transact(state => { state.value = 0; throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect((await b.read()).value).toBe(20);
  } finally { await first.pool.query("DELETE FROM studio_state WHERE key=$1", [key]); await first.close(); await second.close(); }
});
