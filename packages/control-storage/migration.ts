import type { StateStore } from "./index";
import { ControlError } from "../server-control/contracts";

/** Call only with a backup already created. A populated target is never replaced. */
export async function importState<D>(target: StateStore<D>, source: D, empty: D) {
  return target.transact(current => {
    if (JSON.stringify(current) === JSON.stringify(source)) return "already-imported";
    if (JSON.stringify(current) !== JSON.stringify(empty)) throw new ControlError("MIGRATION_TARGET_NOT_EMPTY", "目标已有数据，不能覆盖迁移。", 409);
    Object.assign(current as object, source);
    return "imported";
  });
}
