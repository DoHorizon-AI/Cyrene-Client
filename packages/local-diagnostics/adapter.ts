import { createHash } from "node:crypto";
import { z } from "zod";
import type { StateStore } from "../control-storage";
import type { ExecutionAdapter, Assignment } from "../run-control/adapter";
import type { Observation, Capabilities, Placement } from "../run-control/contracts";
import type { PipelineNode } from "../pipeline-model";
import { ControlError } from "../server-control/contracts";
import { diagnosticConfig } from "./definition";

const attempt = z.object({ id: z.string(), workspaceId: z.string(), generation: z.number(), fingerprint: z.string(), config: diagnosticConfig, completed: z.number(), digest: z.string(), lastStepAt: z.number(), state: z.enum(["running", "succeeded", "failed", "stopped"]) });
export const diagnosticDatabase = z.object({ attempts: z.array(attempt) });
export const emptyDiagnosticDatabase = () => ({ attempts: [] });
type Attempt = z.infer<typeof attempt>;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
/** A small, durable in-process test workload, never a replacement for Product adapters. */
export class LocalDiagnosticAdapter implements ExecutionAdapter {
  constructor(private store: StateStore<z.infer<typeof diagnosticDatabase>>, private now = () => Date.now()) {}
  async preflight(node: PipelineNode, placement: Placement): Promise<Capabilities> {
    diagnosticConfig.parse(node.config);
    if (node.type !== "local-diagnostic" || placement.serverId || placement.pool?.length) throw new ControlError("LOCAL_ONLY", "本地诊断不能调度到服务器。");
    // The required execution contract uses an image-shaped implementation identity.
    // This fingerprint is explicitly NOT a pullable OCI image or a container claim.
    return { image: `cyrene-local-diagnostic@sha256:${sha("cyrene-local-diagnostic.v1")}`, contractVersion: "cyrene.studio.execution.v1", mutableFields: [], checkpoint: false, safeRetry: false };
  }
  async start(input: Assignment): Promise<Observation> {
    await this.preflight(input.node, input.placement);
    return this.store.transact(db => {
      const fingerprint = sha(JSON.stringify(input));
      const old = db.attempts.find(a => a.id === input.attemptId);
      if (old) { if (old.workspaceId !== input.workspaceId || old.fingerprint !== fingerprint) throw new ControlError("ATTEMPT_CONFLICT", "诊断任务身份不匹配。", 409); return this.observe(old); }
      const record: Attempt = { id: input.attemptId, workspaceId: input.workspaceId, generation: input.generation, fingerprint, config: diagnosticConfig.parse(input.node.config), completed: 0, digest: sha(String(input.node.config.text)), lastStepAt: this.now(), state: "running" };
      db.attempts.push(record); return this.observe(record);
    });
  }
  async lookup(id: string, workspaceId: string): Promise<Observation> {
    return this.store.transact(db => {
      const record = db.attempts.find(a => a.id === id && a.workspaceId === workspaceId);
      if (!record) return { state: "absent" as const, authoritative: true as const };
      if (record.state === "running" && this.now() - record.lastStepAt >= 1000) {
        record.digest = sha(record.digest); record.completed++; record.lastStepAt = this.now();
        if (record.completed >= record.config.rounds) record.state = record.config.outcome === "fail" ? "failed" : "succeeded";
      }
      return this.observe(record);
    });
  }
  async stop(id: string, workspaceId: string): Promise<Observation> {
    return this.store.transact(db => { const record = db.attempts.find(a => a.id === id && a.workspaceId === workspaceId); if (!record) return { state: "absent" as const, authoritative: true as const }; if (record.state === "running") record.state = "stopped"; return this.observe(record); });
  }
  async change(): Promise<Observation> { throw new ControlError("UNSUPPORTED", "诊断参数仅在新运行中生效。"); }
  private observe(a: Attempt): Observation {
    const message = `Local diagnostic (no GPU): ${a.completed}/${a.config.rounds}; SHA-256 ${a.digest}${a.state === "failed" ? "; intentional failure test" : ""}`;
    return { state: a.state, attemptId: a.id, generation: a.generation, taskId: a.id, serverId: "local-diagnostic", outputs: {}, terminalAuthority: a.state !== "running", retryable: false, message, events: [{ sequence: a.completed + (a.state === "stopped" ? 2 : 1), message }] };
  }
}
