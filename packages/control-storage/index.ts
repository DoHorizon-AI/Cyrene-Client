import type { z } from "zod";

/** The callback is synchronous: never perform network I/O inside a transaction. */
export interface StateStore<D> {
  read(): Promise<D>;
  transact<T>(operation: (state: D) => T): Promise<T>;
}
export interface StoreFactory {
  state<D>(key: string, schema: z.ZodType<D, z.ZodTypeDef, any>, empty: () => D): StateStore<D>;
  close(): Promise<void>;
  importStates?(entries: { key: string; value: unknown; empty: unknown }[]): Promise<void>;
}

export class MemoryStateStore<D> implements StateStore<D> {
  constructor(private value: D) {}
  async read() { return structuredClone(this.value); }
  async transact<T>(operation: (state: D) => T) {
    const draft = structuredClone(this.value);
    const result = operation(draft);
    this.value = structuredClone(draft);
    return structuredClone(result);
  }
}
