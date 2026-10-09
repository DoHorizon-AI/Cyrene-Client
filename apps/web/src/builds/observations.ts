import type { Build } from "../../../../packages/build-control/contracts";

export const isTerminalBuild = (build: Build) => ["succeeded", "failed", "cancelled"].includes(build.state);

/** A late poll must never replace a newer command acknowledgement. */
export function mergeBuildObservation(current: Build | null, next: Build): Build {
  if (current?.id !== next.id) return next;
  if (next.revision < current.revision || (isTerminalBuild(current) && !isTerminalBuild(next))) return current;
  return next;
}
