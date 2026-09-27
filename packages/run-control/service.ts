import { createHash } from "node:crypto";
import type { StateStore } from "../control-storage";
import { inspect, type PipelineNode } from "../pipeline-model";
import { getDefinition } from "../pipeline-model/catalog";
import { ControlError, type Actor } from "../server-control/contracts";
import { pipelineRequest } from "../pipeline-control/contracts";
import type { PipelineControl } from "../pipeline-control/service";
import { equal } from "../pipeline-control/service";
import type { PipelineRecord } from "../pipeline-control/contracts";
import { capabilitiesSchema, observationSchema, placementSchema, runCommands, type Capabilities, type Observation, type Outputs, type Placement, type Run, type RunDatabase, type Step } from "./contracts";
import type { Assignment, ExecutionAdapter } from "./adapter";
import type { PlacementResolver } from "./placement";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const reference = (node: PipelineNode) => ["dataset", "model", "compute"].includes(node.type) || getDefinition(node.type, node.typeVersion)?.execution?.kind === "reference";
const adapterName = (node: PipelineNode) => getDefinition(node.type, node.typeVersion)?.execution?.adapter ?? ({ training: "yield", evaluation: "echo", deployment: "reactor", agent: "navigator" }[node.type] ?? node.type);
const terminal = (step: Step) => ["succeeded", "failed", "stopped"].includes(step.state);
const graphOf = ({ presentation: _, ...graph }: Run["document"]) => graph;

export class RunControl {
  private ticking = false;
  constructor(private store: StateStore<RunDatabase>, private pipelines: Pick<PipelineControl, "execute">, private adapters: Map<string, ExecutionAdapter>, private now = () => Date.now(), private placementResolver?: PlacementResolver) {}
  async execute(raw: unknown, actor: Actor): Promise<unknown> {
    const request = pipelineRequest.parse(raw);
    if (!Object.hasOwn(runCommands, request.name)) throw new ControlError("UNKNOWN_COMMAND", "未知运行操作。");
    const name = request.name as keyof typeof runCommands, command = runCommands[name], input = command.input.parse(request.input);
    if (!actor.workspaceIds.includes(input.workspaceId) || !actor.scopes.includes(command.readOnly ? "runs.read" : "runs.write")) throw new ControlError("FORBIDDEN", "没有运行操作权限。", 403);
    const fingerprint = hash([name, input]), key = JSON.stringify([actor.id, input.workspaceId, request.idempotencyKey]);
    if (!command.readOnly && !request.idempotencyKey) throw new ControlError("IDEMPOTENCY_REQUIRED", "运行写操作需要幂等键。");
    const replay = (db: RunDatabase) => {
      const receipt = db.receipts.find(r => r.key === key);
      if (receipt && receipt.fingerprint !== fingerprint) throw new ControlError("IDEMPOTENCY_CONFLICT", "幂等键已用于其他操作。", 409);
      return receipt && structuredClone(this.find(db, input.workspaceId, receipt.runId));
    };
    const state = await this.store.read();
    if (!command.readOnly) { const previous = replay(state); if (previous) return previous; }
    if (name === "runs.list") return { items: state.runs.filter(run => run.workspaceId === input.workspaceId).map(({ document: _, steps: __, ...run }) => run) };
    if (name === "runs.preflight" || name === "runs.start") {
      const args = runCommands["runs.preflight"].input.parse({ workspaceId: input.workspaceId, pipelineId: "pipelineId" in input ? input.pipelineId : undefined, expectedGraphRevision: "expectedGraphRevision" in input ? input.expectedGraphRevision : undefined, placements: "placements" in input ? input.placements : {} });
      const record = await this.pipelines.execute({ name: "pipelines.get", input: { workspaceId: args.workspaceId, pipelineId: args.pipelineId }, requestId: request.requestId }, { ...actor, scopes: [...actor.scopes, "pipelines.read"] }) as PipelineRecord;
      if (record.graphRevision !== args.expectedGraphRevision) throw new ControlError("REVISION_CONFLICT", "流程版本已变化，请重新预检。", 409);
      const placements = this.resolvePlacements(record, args.placements);
      const preflight = await this.preflight(record, placements);
      if (name === "runs.preflight") return preflight;
      const start = runCommands["runs.start"].input.parse(input);
      if (preflight.issues.length) throw new ControlError("NOT_EXECUTABLE", preflight.issues.map(i => i.message).join("；"), 409);
      if (preflight.fingerprint !== start.expectedFingerprint) throw new ControlError("PREFLIGHT_CHANGED", "能力、镜像或配置已变化，请重新预检。", 409);
      // The submitted revision becomes an immutable execution snapshot. Later
      // draft edits are intentionally independent of this accepted run.
      return this.store.transact(db => {
        const previous = replay(db); if (previous) return previous;
        const run = this.newRun(record, actor.id, placements, preflight.capabilities, preflight.targets);
        db.runs.push(run); db.receipts.push({ key, fingerprint, runId: run.id }); this.event(db, run, actor.id, "run.accepted", "运行快照已保存，等待执行资源。");
        return structuredClone(run);
      });
    }
    const args = runCommands["runs.get"].input.parse({ workspaceId: input.workspaceId, runId: "runId" in input ? input.runId : undefined });
    const run = this.find(state, args.workspaceId, args.runId);
    if (name === "runs.get") return run;
    if (name === "runs.observe") {
      const events = runCommands[name].input.parse(input);
      const all = state.events.filter(e => e.workspaceId === args.workspaceId && e.runId === args.runId);
      if (events.after > (all.at(-1)?.sequence ?? 0)) throw new ControlError("INVALID_CURSOR", "事件游标超出此运行的历史，请从 0 重新读取。", 409);
      const items = all.filter(e => e.sequence > events.after).slice(0, events.limit);
      return { run, items, cursor: items.at(-1)?.sequence ?? events.after };
    }
    if (name === "runs.attempts") return { items: state.attempts.filter(a => a.runId === run.id) };
    if (name === "runs.artifacts") return { items: run.steps.flatMap(step => [
      ...Object.entries(step.outputs).map(([port, artifact]) => ({ nodeId: step.nodeId, port, artifact, checkpoint: false })),
      ...(step.checkpoint ? [{ nodeId: step.nodeId, port: "checkpoint", artifact: step.checkpoint, checkpoint: true }] : []),
    ]) };
    if (name === "runs.events") {
      const events = runCommands[name].input.parse(input), items = state.events.filter(e => e.workspaceId === args.workspaceId && e.runId === args.runId && e.sequence > events.after).slice(0, events.limit);
      return { items, cursor: items.at(-1)?.sequence ?? events.after };
    }
    if (name === "runs.preview_change") return this.preview(run, runCommands[name].input.parse(input));
    return this.store.transact(db => {
      const previous = replay(db); if (previous) return previous;
      const current = this.find(db, args.workspaceId, args.runId);
      let result = current;
      if (name === "runs.stop") {
        const stop = runCommands[name].input.parse(input); this.revision(current, stop.expectedRevision);
        if (["succeeded", "failed", "stopped"].includes(current.state)) throw new ControlError("TERMINAL_RUN", "运行已经结束。", 409);
        current.state = "stopping"; current.revision++; this.event(db, current, actor.id, "run.stop_requested", "已记录停止意图，等待执行端确认。");
      } else if (name === "runs.resume") {
        const resume = runCommands[name].input.parse(input); this.revision(current, resume.expectedRevision);
        if (!current.steps.every(terminal) || !current.steps.some(s => ["stopped", "failed"].includes(s.state))) throw new ControlError("RESUME_NOT_ALLOWED", "必须先确认所有旧执行已经终止。", 409);
        for (const step of current.steps.filter(s => s.state !== "succeeded")) {
          step.state = "pending"; step.retries = 0; step.eventCursor = 0; delete step.attemptId; delete step.taskId; delete step.change; delete step.nextAttemptAt;
          if (!step.capabilities?.checkpoint) delete step.checkpoint;
        }
        current.state = "queued"; current.revision++; this.event(db, current, actor.id, "run.resume_requested", "已确认旧执行终止，等待恢复执行。");
      } else {
        const change = runCommands["runs.apply_change"].input.parse(input), preview = this.preview(current, change);
        if (preview.fingerprint !== change.expectedFingerprint) throw new ControlError("CHANGE_PLAN_STALE", "变更预览已失效。", 409);
        if (preview.mode === "rejected") throw new ControlError("CHANGE_REJECTED", preview.message, 409);
        const step = current.steps.find(s => s.nodeId === change.nodeId)!;
        if (preview.mode === "online") {
          if (step.change) throw new ControlError("CHANGE_PENDING", "已有变更等待执行端确认。", 409);
          step.change = { id: crypto.randomUUID(), config: change.config, state: "pending" }; step.config = change.config; current.revision++;
          this.event(db, current, actor.id, "step.change_requested", "在线调整已提交，实际配置尚未改变。", step.nodeId);
        } else {
          const document = structuredClone(current.document);
          // The initial snapshot is immutable; a branch includes subsequent
          // accepted changes, including changes to nodes outside this edit.
          for (const node of document.nodes) node.config = structuredClone(current.steps.find(s => s.nodeId === node.id)!.config);
          document.nodes.find(node => node.id === change.nodeId)!.config = change.config;
          const record: PipelineRecord = { document, workspaceId: current.workspaceId, graphRevision: current.graphRevision, layoutRevision: 1, updatedAt: new Date().toISOString(), updatedBy: actor.id };
          result = this.newRun(record, actor.id, current.placements, Object.fromEntries(current.steps.filter(s => s.capabilities).map(s => [s.nodeId, s.capabilities!])), current.targets);
          result.parentRunId = current.id;
          for (const next of result.steps) {
            const old = current.steps.find(s => s.nodeId === next.nodeId)!;
            if (preview.reusable.includes(next.nodeId)) Object.assign(next, { state: "succeeded", outputs: structuredClone(old.outputs), actualConfig: structuredClone(old.actualConfig), message: `复用 ${current.id} 的已确认结果` });
            if (next.nodeId === change.nodeId && preview.mode === "checkpoint-branch") next.checkpoint = step.checkpoint;
          }
          db.runs.push(result); this.event(db, result, actor.id, "run.branched", `从 ${current.id} 创建新分支；原分支未停止。`);
        }
      }
      db.receipts.push({ key, fingerprint, runId: result.id }); return structuredClone(result);
    });
  }
  private resolvePlacements(record: PipelineRecord, overrides: Record<string, Placement>) {
    const placements = structuredClone(overrides);
    for (const node of record.document.nodes.filter(n => !reference(n))) {
      const incoming = record.document.edges.filter(e => e.to.node === node.id).map(e => record.document.nodes.find(n => n.id === e.from.node)).filter(n => n?.type === "compute");
      if (incoming.length > 1) throw new ControlError("AMBIGUOUS_COMPUTE", "节点连接了多个算力配置，请明确唯一资源意向。");
      const compute = incoming[0], binding = compute?.settingsBinding;
      const override: Placement | undefined = overrides[node.id];
      if (binding?.kind === "server-registration" && binding.workspaceId !== record.workspaceId) throw new ControlError("FORBIDDEN", "算力配置引用了其他工作空间的服务器登记。", 403);
      placements[node.id] = {
        ...(compute ? { provider: String(compute.config.provider), accelerator: String(compute.config.accelerator) } : {}),
        ...(binding?.kind === "server-registration" ? { serverId: binding.resourceId } : {}),
        ...override,
        acceleratorCount: override?.acceleratorCount ?? (compute ? Number(compute.config.count) : 1),
      };
    }
    return placements;
  }
  private async preflight(record: PipelineRecord, placements: Record<string, Placement>) {
    const issues: { nodeId?: string; code: string; message: string }[] = [...inspect(record.document).issues];
    const capabilities: Record<string, Capabilities> = {}, targets: Run["targets"] = {};
    for (const node of record.document.nodes) {
      if (reference(node)) {
        try { this.referenceOutputs(node); } catch (error) { issues.push({ nodeId: node.id, code: "ARTIFACT_REFERENCE", message: (error as Error).message }); }
        continue;
      }
      const adapter = this.adapters.get(adapterName(node));
      if (!adapter) { issues.push({ nodeId: node.id, code: "ADAPTER_UNAVAILABLE", message: `${node.label}：尚未连接执行适配器 ${adapterName(node)}` }); continue; }
      try {
        const placement = placementSchema.parse(placements[node.id] ?? { acceleratorCount: 1 });
        targets[node.id] = await this.resolveTargets(record.workspaceId, placement);
        capabilities[node.id] = capabilitiesSchema.parse(await adapter.preflight(node, placement, record.workspaceId, targets[node.id]));
        const required = getDefinition(node.type, node.typeVersion)?.execution?.image;
        if (required && required !== capabilities[node.id].image) throw new ControlError("IMAGE_MISMATCH", "能力包镜像与执行器镜像不一致。");
      }
      catch (error) { issues.push({ nodeId: node.id, code: "PREFLIGHT_FAILED", message: `${node.label}：${error instanceof ControlError ? error.message : "无法验证执行能力"}` }); }
    }
    for (const id of Object.keys(placements)) if (!record.document.nodes.some(n => n.id === id)) issues.push({ nodeId: id, code: "UNKNOWN_NODE", message: "放置策略包含不存在的节点。" });
    return { fingerprint: hash([graphOf(record.document), record.graphRevision, placements, capabilities, targets]), issues, capabilities, placements, targets };
  }
  private async resolveTargets(workspaceId: string, placement: Placement) {
    if (this.placementResolver) return this.placementResolver.resolve(workspaceId, placement);
    if (placement.serverId || placement.pool?.length) throw new ControlError("RESOLVER_UNAVAILABLE", "服务器身份解析尚未配置。", 503);
    return [];
  }
  private async rejectUnstarted(runId: string, nodeId: string, attemptId: string, kind: string, message: string) {
    await this.store.transact(db => {
      const run = db.runs.find(r => r.id === runId)!, step = run.steps.find(s => s.nodeId === nodeId)!;
      if (step.attemptId !== attemptId || terminal(step)) return;
      step.state = run.state === "stopping" ? "stopped" : "failed"; step.message = message;
      run.revision++; this.event(db, run, "studio-coordinator", kind, message, nodeId); this.aggregate(run);
    });
  }
  private newRun(record: PipelineRecord, actorId: string, placements: Record<string, Placement>, capabilities: Record<string, Capabilities>, targets: Run["targets"]): Run {
    return { id: crypto.randomUUID(), workspaceId: record.workspaceId, pipelineId: record.document.id, graphRevision: record.graphRevision, revision: 1, document: structuredClone(record.document), state: record.document.nodes.every(reference) ? "succeeded" : "queued", createdAt: new Date().toISOString(), createdBy: actorId, placements: structuredClone(placements), targets: structuredClone(targets), steps: record.document.nodes.map(node => ({ nodeId: node.id, adapter: adapterName(node), state: reference(node) ? "succeeded" : "pending", config: structuredClone(node.config), actualConfig: structuredClone(node.config), capabilities: capabilities[node.id], generation: 0, retries: 0, inputs: {}, outputs: reference(node) ? this.referenceOutputs(node) : {}, eventCursor: 0 })) };
  }
  private referenceOutputs(node: PipelineNode): Outputs {
    if (node.type === "compute") return {};
    const definition = getDefinition(node.type, node.typeVersion), result: Outputs = {};
    for (const port of definition?.outputs ?? []) {
      const uri = node.config[`${port.name}Ref`];
      const snapshot = node.settingsBinding?.artifact;
      if (snapshot) {
        if (uri !== snapshot.uri) throw new ControlError("ARTIFACT_REFERENCE", `${node.label} 的本地引用与已绑定制品身份不一致。`);
        result[port.name] = {
          uri: snapshot.uri, digest: snapshot.digest, kind: snapshot.kind,
          sizeBytes: snapshot.size_bytes,
          ...(snapshot.manifest_digest ? { manifestDigest: snapshot.manifest_digest } : {}),
        };
        continue;
      }
      const digest = typeof uri === "string" && uri.match(/sha256:[a-f0-9]{64}/)?.[0];
      if (!digest) throw new ControlError("ARTIFACT_REFERENCE", `${node.label} 需要带 SHA-256 摘要的不可变制品引用。`);
      result[port.name] = { uri: uri as string, digest, kind: port.kind };
    }
    return result;
  }
  private preview(run: Run, input: { expectedRevision: number; nodeId: string; config: PipelineNode["config"] }) {
    this.revision(run, input.expectedRevision);
    const node = run.document.nodes.find(n => n.id === input.nodeId), step = run.steps.find(s => s.nodeId === input.nodeId);
    if (!node || !step) throw new ControlError("UNKNOWN_NODE", "节点不存在。");
    const definition = getDefinition(node.type, node.typeVersion);
    if (!definition) throw new ControlError("UNKNOWN_TYPE", "节点契约不可用。");
    definition.configSchema.parse(input.config);
    const affected = new Set([node.id]);
    let changed = true;
    while (changed) { changed = false; for (const edge of run.document.edges) if (affected.has(edge.from.node) && !affected.has(edge.to.node)) { affected.add(edge.to.node); changed = true; } }
    const fields = new Set([...Object.keys(step.config), ...Object.keys(input.config)].filter(key => !equal(step.config[key], input.config[key])));
    if (reference(node)) return { fingerprint: hash([run.id, run.revision, input.nodeId, input.config, "reference"]), mode: "rejected" as const, affected: [...affected], reusable: [], message: "资源引用变更需要修改草稿并重新预检启动，不能沿用原运行的资源身份。", expectedRevision: run.revision };
    const downstreamStarted = run.steps.some(s => s.nodeId !== node.id && affected.has(s.nodeId) && s.state !== "pending");
    let mode: "online" | "branch" | "checkpoint-branch" | "rejected" = "branch";
    if (!fields.size || step.change || run.state === "stopping") mode = "rejected";
    else if (step.state === "running" && !downstreamStarted && fields.size && [...fields].every(field => step.capabilities?.mutableFields.includes(field))) mode = "online";
    // Resume compatibility is deliberately conservative: checkpoint reuse only
    // when the provider declared every changed field mutable for this engine.
    else if (step.checkpoint && step.capabilities?.checkpoint && [...fields].every(field => step.capabilities!.mutableFields.includes(field))) mode = "checkpoint-branch";
    const reusable = run.steps.filter(s => s.state === "succeeded" && !affected.has(s.nodeId) && equal(s.actualConfig, s.config) && !s.change).map(s => s.nodeId);
    const message = mode === "online" ? "将在执行器声明的安全边界应用，等待实际生效回执。" : mode === "rejected" ? "没有有效变化、已有待处理变更或运行正在停止。" : mode === "checkpoint-branch" ? "新分支从兼容检查点恢复，原分支保留。" : "创建新分支并重新执行受影响步骤；原分支保留。";
    return { fingerprint: hash([run.id, run.revision, { expectedRevision: input.expectedRevision, nodeId: input.nodeId, config: input.config }, mode, [...affected], reusable]), mode, affected: [...affected], reusable, message, expectedRevision: run.revision };
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const snapshot = await this.store.read();
      for (const run of snapshot.runs.filter(r => !["succeeded", "stopped", "failed"].includes(r.state))) {
        for (const step of run.steps) {
          if (terminal(step)) continue;
          // Pending work can be stopped even after its adapter is removed.
          if (run.state === "stopping" && !step.attemptId) {
            await this.store.transact(db => {
              const current = db.runs.find(r => r.id === run.id)!, waiting = current.steps.find(s => s.nodeId === step.nodeId)!;
              if (current.state === "stopping" && !waiting.attemptId && !terminal(waiting)) {
                waiting.state = "stopped"; current.revision++;
                this.event(db, current, "studio-coordinator", "step.stopped", "未派发的步骤已停止。", waiting.nodeId);
                this.aggregate(current);
              }
            });
            continue;
          }
          const adapter = this.adapters.get(step.adapter); if (!adapter) continue;
          try { await this.advance(run.id, step.nodeId, adapter); }
          catch { /* Intent remains durable. Never infer failure from timeout. */ }
        }
      }
    } finally { this.ticking = false; }
  }
  private async advance(runId: string, nodeId: string, adapter: ExecutionAdapter) {
    const prepared = await this.store.transact(db => {
      const run = db.runs.find(r => r.id === runId)!, step = run.steps.find(s => s.nodeId === nodeId)!;
      if (terminal(step)) return null;
      if (run.state === "stopping" && !step.attemptId) { step.state = "stopped"; this.aggregate(run); run.revision++; return null; }
      if (step.state === "pending") {
        if (step.nextAttemptAt && step.nextAttemptAt > this.now()) return null;
        delete step.nextAttemptAt;
        const incoming = run.document.edges.filter(e => e.to.node === nodeId);
        if (incoming.some(edge => run.steps.find(s => s.nodeId === edge.from.node)?.state !== "succeeded")) return null;
        const inputs: Outputs = {};
        for (const edge of incoming) {
          const output = run.steps.find(s => s.nodeId === edge.from.node)!.outputs[edge.from.port];
          if (output) inputs[edge.to.port] = output;
        }
        step.inputs = inputs; step.attemptId = crypto.randomUUID(); step.generation++; step.state = "dispatching"; run.state = "running"; run.revision++;
        db.attempts.push({ runId: run.id, nodeId, attemptId: step.attemptId, generation: step.generation });
        this.event(db, run, "studio-coordinator", "step.dispatch_intent", "已保存执行意图。", nodeId);
      }
      return { run: structuredClone(run), step: structuredClone(step) };
    });
    if (!prepared?.step.attemptId) return;
    const { run, step } = prepared;
    let observation: Observation;
    try {
      if (run.state === "stopping") observation = await adapter.stop(step.attemptId!, run.workspaceId, `stop-${step.attemptId}`);
      else if (step.change) observation = await adapter.change(step.attemptId!, run.workspaceId, step.change.config, step.change.id);
      else {
        observation = observationSchema.parse(await adapter.lookup(step.attemptId!, run.workspaceId));
        if (observation.state === "absent" && step.state === "dispatching") {
          // A stop may have arrived while lookup was in flight. Do not create
          // fresh work after that stop has already been committed.
          const latest = this.find(await this.store.read(), run.workspaceId, run.id);
          if (latest.state === "stopping") {
            await this.rejectUnstarted(run.id, nodeId, step.attemptId!, "step.stopped", "停止已生效，权威确认此步骤尚未启动。");
            return;
          }
          const node = structuredClone(run.document.nodes.find(n => n.id === nodeId)!); node.config = step.config;
          const assignment: Assignment = { workspaceId: run.workspaceId, runId: run.id, node, attemptId: step.attemptId!, generation: step.generation, inputs: step.inputs, placement: run.placements[nodeId] ?? { acceleratorCount: 1 }, image: step.capabilities!.image, checkpoint: step.checkpoint, targets: run.targets[nodeId] ?? [] };
          const targets = await this.resolveTargets(run.workspaceId, assignment.placement);
          if (!equal(targets, assignment.targets)) {
            await this.rejectUnstarted(run.id, nodeId, step.attemptId!, "SERVER_IDENTITY_CHANGED", "服务器登记或 Node 代次已变化，请重新预检并创建运行。");
            return;
          }
          if (this.find(await this.store.read(), run.workspaceId, run.id).state === "stopping") {
            await this.rejectUnstarted(run.id, nodeId, step.attemptId!, "step.stopped", "派发前已收到停止请求，此步骤未启动。");
            return;
          }
          observation = await adapter.start(assignment);
        }
      }
      observation = observationSchema.parse(observation);
      if (observation.state !== "absent" && observation.appliedConfig) {
        const node = run.document.nodes.find(n => n.id === nodeId)!;
        getDefinition(node.type, node.typeVersion)!.configSchema.parse(observation.appliedConfig);
      }
    } catch {
      await this.store.transact(db => {
        const latest = db.runs.find(r => r.id === runId)!, current = latest.steps.find(s => s.nodeId === nodeId)!;
        if (current.attemptId !== step.attemptId || terminal(current)) return;
        // Preserve dispatching: an authoritative absence can safely redispatch
        // the SAME attempt id. Other unknown outcomes are only observed.
        if (current.state !== "dispatching") current.state = "unknown";
        if (current.change) current.change.state = "unknown";
        if (current.message !== "执行结果未知，等待权威状态核对。") { current.message = "执行结果未知，等待权威状态核对。"; latest.revision++; }
      });
      return;
    }
    await this.store.transact(db => {
      const latest = db.runs.find(r => r.id === runId)!, current = latest.steps.find(s => s.nodeId === nodeId)!;
      if (current.attemptId !== step.attemptId || current.generation !== step.generation || terminal(current)) return;
      if (observation.state === "absent") {
        // stop(absent) is a provider promise that no accepted task exists. The
        // stop intent already prevents further start calls for this attempt.
        if (latest.state === "stopping") {
          current.state = "stopped"; current.message = "执行权威确认任务不存在，停止已完成。";
          this.event(db, latest, "studio-coordinator", "step.stopped", current.message, nodeId);
          this.aggregate(latest);
        } else { current.state = "unknown"; current.message = "执行记录缺失，不能确认原实例是否停止。"; latest.state = "attention"; }
        latest.revision++; return;
      }
      if (observation.attemptId !== current.attemptId || observation.generation !== current.generation) return;
      const attempt = db.attempts.find(a => a.attemptId === current.attemptId);
      if (attempt) attempt.observation = structuredClone(observation);
      const previous = JSON.stringify(current);
      if (["succeeded", "failed", "stopped"].includes(observation.state) && !observation.terminalAuthority) { current.state = "unknown"; current.message = "等待执行权威确认终态。"; }
      else {
        current.state = observation.state; current.taskId = observation.taskId; current.serverId = observation.serverId; current.message = observation.message;
        if (observation.checkpoint) current.checkpoint = observation.checkpoint;
        if (observation.state === "succeeded") {
          const node = latest.document.nodes.find(n => n.id === nodeId)!, ports = getDefinition(node.type, node.typeVersion)?.outputs ?? [];
          if (ports.some(port => observation.outputs[port.name]?.kind !== port.kind)) { current.state = "failed"; current.message = "执行结果缺少声明的输出制品。"; }
          else current.outputs = observation.outputs;
        }
        if (observation.appliedConfig) {
          current.actualConfig = observation.appliedConfig; current.effectiveStep = observation.effectiveStep;
          if (current.change && equal(current.change.config, observation.appliedConfig)) delete current.change;
        }
        if (observation.state === "failed" && observation.terminalAuthority && observation.retryable && current.capabilities?.safeRetry && current.retries < 2 && latest.state !== "stopping") {
          current.retries++; current.state = "pending"; delete current.attemptId; delete current.taskId; delete current.change;
          current.nextAttemptAt = this.now() + 10_000 * 2 ** (current.retries - 1);
          if (!current.capabilities.checkpoint) delete current.checkpoint;
          this.event(db, latest, "studio-coordinator", "step.retry", `旧执行已终止；等待 ${10 * 2 ** (current.retries - 1)} 秒后从检查点恢复或重试。`, nodeId);
        }
      }
      for (const event of [...observation.events].sort((a, b) => a.sequence - b.sequence)) if (event.sequence > current.eventCursor) { this.event(db, latest, "product", "step.log", event.message, nodeId); current.eventCursor = event.sequence; }
      if (current.state === "pending") current.eventCursor = 0;
      if (previous !== JSON.stringify(current)) { latest.revision++; this.event(db, latest, "studio-coordinator", "step.observed", current.message ?? current.state, nodeId); }
      this.aggregate(latest);
    });
  }
  private aggregate(run: Run) {
    if (run.state === "stopping") { if (run.steps.every(terminal)) run.state = "stopped"; return; }
    // A never-dispatched dependent has no execution to fence. Mark it stopped
    // when a predecessor definitively failed, so the run can finish and resume.
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of run.steps.filter(s => s.state === "pending" && !s.attemptId)) {
        if (run.document.edges.some(e => e.to.node === step.nodeId && run.steps.some(s => s.nodeId === e.from.node && ["failed", "stopped"].includes(s.state)))) {
          step.state = "stopped"; step.message = "上游执行未成功，此步骤未派发。"; changed = true;
        }
      }
    }
    if (run.steps.every(s => s.state === "succeeded")) run.state = "succeeded";
    else if (run.steps.every(terminal)) run.state = "failed";
    else if (run.steps.some(s => s.state === "failed")) run.state = "attention";
    else if (run.steps.some(s => s.state === "unknown")) run.state = "attention";
    else run.state = "running";
  }
  private revision(run: Run, expected: number) { if (run.revision !== expected) throw new ControlError("REVISION_CONFLICT", "运行状态已变化，请重新读取并预览。", 409); }
  private find(db: RunDatabase, workspaceId: string, id: string) { const run = db.runs.find(r => r.workspaceId === workspaceId && r.id === id); if (!run) throw new ControlError("NOT_FOUND", "运行不存在。", 404); return run; }
  private event(db: RunDatabase, run: Run, actorId: string, kind: string, message: string, nodeId?: string) { db.events.push({ sequence: (db.events.at(-1)?.sequence ?? 0) + 1, workspaceId: run.workspaceId, runId: run.id, nodeId, actorId, kind, message, at: new Date().toISOString() }); }
}
