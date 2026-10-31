import { ControlError } from "../server-control/contracts";

/** These responses reject submission. Conflicts, throttling and timeouts need
 * reconciliation: they do not prove the original task was never accepted. */
export function submissionRejected(error: unknown) {
  return error instanceof ControlError && [400, 401, 403, 404, 405, 410, 422].includes(error.status);
}
export function retryDelay(failures: number, base = 5000, cap = 300_000) {
  return Math.min(cap, base * 2 ** Math.min(10, Math.max(0, failures - 1)));
}
