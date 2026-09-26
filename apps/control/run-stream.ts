import type { IncomingMessage, ServerResponse } from "node:http";
import type { Actor } from "../../packages/server-control/contracts";
import { ControlError } from "../../packages/server-control/contracts";
import { runCommands, runObservationSchema } from "../../packages/run-control/contracts";
import type { RunControl } from "../../packages/run-control/service";

/** SSE and MCP read the same atomic snapshot and durable event cursor. */
export async function streamRun(req: IncomingMessage, res: ServerResponse, runs: RunControl, authorize: () => Promise<{ actor: Actor }>) {
  const url = new URL(req.url!, "http://control.invalid");
  const last = req.headers["last-event-id"] ?? url.searchParams.get("after") ?? "0";
  if (typeof last !== "string" || !/^\d{1,16}$/.test(last)) throw new ControlError("INVALID_CURSOR", "事件游标无效。");
  const input = runCommands["runs.observe"].input.parse({ workspaceId: url.searchParams.get("workspaceId"), runId: url.searchParams.get("runId"), after: Number(last), limit: 100 });
  const read = async () => {
    const { actor } = await authorize();
    return runObservationSchema.parse(await runs.execute({ name: "runs.observe", input, requestId: crypto.randomUUID() }, actor));
  };
  // Authenticate and validate the workspace/run/cursor before sending headers.
  const initial = await read();
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
  let pending = false, closed = false, revision = 0;
  const emit = (value: typeof initial) => {
    if (closed) return;
    const frame = value.run.revision !== revision || value.items.length
      ? `id: ${value.cursor}\nevent: observation\ndata: ${JSON.stringify(value)}\n\n`
      : ": heartbeat\n\n";
    input.after = value.cursor; revision = value.run.revision;
    // Bound slow-client buffering; EventSource reconnects from the last frame
    // it actually received and replays durable events without losing them.
    if (!res.write(frame)) res.end();
  };
  const push = async () => {
    if (pending || closed) return;
    pending = true;
    try { emit(await read()); }
    catch { if (!closed) res.end(); }
    finally { pending = false; }
  };
  const timer = setInterval(() => void push(), 1000);
  const expiry = setTimeout(() => res.end(), 60_000);
  res.on("close", () => { closed = true; clearInterval(timer); clearTimeout(expiry); });
  emit(initial);
}
