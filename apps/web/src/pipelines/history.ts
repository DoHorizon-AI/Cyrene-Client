import type { Pipeline } from '../../../../packages/pipeline-model';
import { mergeIndependentGraph } from '../../../../packages/pipeline-control/collaboration';
import { canonicalJson } from '../../../../packages/control-storage/canonical';

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
/** Rebase the contiguous, conflict-free part of each local history stack.
 * An undo must only reverse local changes, never overwrite a remote edit. */
export function rebaseHistory(stack: Pipeline[], before: Pipeline, remote: Pipeline): Pipeline[] {
  if (before.id !== remote.id) return [];
  const result: Pipeline[] = [];
  let base = before, current = remote;
  for (const snapshot of [...stack].reverse()) {
    try {
      const graph = mergeIndependentGraph(base, snapshot, current);
      const presentation = structuredClone(current.presentation);
      for (const id of new Set([...Object.keys(base.presentation.nodes), ...Object.keys(snapshot.presentation.nodes)])) {
        const old = base.presentation.nodes[id], next = snapshot.presentation.nodes[id], actual = presentation.nodes[id];
        if (same(old, next)) continue;
        if (!same(actual, old) && !same(actual, next)) throw new Error('Layout conflict');
        if (next) presentation.nodes[id] = structuredClone(next); else delete presentation.nodes[id];
      }
      const rebased = { ...graph, presentation };
      result.unshift(rebased); base = snapshot; current = rebased;
    } catch { break; }
  }
  return result;
}
