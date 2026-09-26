import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { databaseSchema, emptyDatabase, type Database, type RegistryStore } from "../packages/server-control/service";
import { ControlError } from "../packages/server-control/contracts";
import type { z } from "zod";

// Atomic file store for the single-user prototype; replace with a transactional
// store for the deployed control service. A competing process fails explicitly.
export class AtomicJsonStore<D> {
  private pending: Promise<void> = Promise.resolve();
  constructor(private file: string, private schema: z.ZodType<D, z.ZodTypeDef, any>, private empty: () => D) {}
  async read() {
    try { return this.schema.parse(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return this.empty(); throw e; }
  }
  async transact<T>(operation: (db: D) => T): Promise<T> {
    const transaction = this.pending.then(() => this.transactLocked(operation));
    this.pending = transaction.then(() => undefined, () => undefined);
    return transaction;
  }
  private async transactLocked<T>(operation: (db: D) => T): Promise<T> {
    await mkdir(dirname(this.file), { recursive: true });
    const lockPath = `${this.file}.lock`;
    const lock = await open(lockPath, "wx", 0o600).catch(e => {
      if (e.code === "EEXIST") throw new ControlError("STORE_BUSY", "登记库正在写入，请稍后用同一幂等键重试。", 409);
      throw e;
    });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      const db = await this.read(), result = operation(db);
      const output = await open(temporary, "wx", 0o600);
      try { await output.writeFile(JSON.stringify(this.schema.parse(db)), "utf8"); await output.sync(); }
      finally { await output.close(); }
      await rename(temporary, this.file);
      return result;
    } finally {
      await unlink(temporary).catch(e => { if (e.code !== "ENOENT") throw e; });
      await lock.close(); await unlink(lockPath);
    }
  }
}
export class FileRegistryStore extends AtomicJsonStore<Database> implements RegistryStore {
  constructor(file: string) { super(file, databaseSchema, emptyDatabase); }
}
