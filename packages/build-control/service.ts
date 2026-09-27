import { createHash } from "node:crypto";
import type { StateStore } from "../control-storage";
import { ControlError, type Actor } from "../server-control/contracts";
import { pipelineRequest } from "../pipeline-control/contracts";
import { compileContribution } from "../node-registry/contracts";
import { buildCommands, buildResult, sourceSha, type Build, type BuildDatabase, type BuildProfile, type BuildResult } from "./contracts";
import type { BuildAdapter } from "./adapter";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const terminal = (build: Build) => ["succeeded", "failed", "cancelled"].includes(build.state);
export class BuildControl {
  private ticking = false;
  constructor(private store: StateStore<BuildDatabase>, private profiles: BuildProfile[], private adapter?: BuildAdapter) {
    if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw new Error("Duplicate build profile id");
  }
  async execute(raw: unknown, actor: Actor): Promise<unknown> {
    const request = pipelineRequest.parse(raw);
    if (!Object.hasOwn(buildCommands, request.name)) throw new ControlError("UNKNOWN_COMMAND", "未知构建操作。");
    const name = request.name as keyof typeof buildCommands, command = buildCommands[name], input = command.input.parse(request.input);
    if (!actor.workspaceIds.includes(input.workspaceId) || !actor.scopes.includes(command.scope)) throw new ControlError("FORBIDDEN", "没有此工作空间的构建权限。", 403);
    if (!command.readOnly && !request.idempotencyKey) throw new ControlError("IDEMPOTENCY_REQUIRED", "构建写操作需要幂等键。");
    const key = JSON.stringify([actor.id, input.workspaceId, request.idempotencyKey]), fingerprint = hash([name, input]);
    const replay = (db: BuildDatabase) => {
      const receipt = db.receipts.find(r => r.key === key);
      if (receipt && receipt.fingerprint !== fingerprint) throw new ControlError("IDEMPOTENCY_CONFLICT", "幂等键已用于其他构建操作。", 409);
      return receipt && structuredClone(this.find(db, input.workspaceId, receipt.buildId));
    };
    const state = await this.store.read();
    if (!command.readOnly) { const previous = replay(state); if (previous) return previous; }
    if (name === "builds.list_profiles") return { items: this.profiles.filter(p => p.workspaceIds.includes(input.workspaceId)) };
    if (name === "builds.list") return { items: state.builds.filter(b => b.workspaceId === input.workspaceId) };
    if (name === "builds.preview" || name === "builds.start") {
      const args = buildCommands["builds.preview"].input.parse({ workspaceId: input.workspaceId, profileId: "profileId" in input ? input.profileId : undefined, sourceRef: "sourceRef" in input ? input.sourceRef : undefined });
      const profile = this.profiles.find(p => p.id === args.profileId && p.workspaceIds.includes(args.workspaceId));
      if (!profile || !profile.sourceRefs.includes(args.sourceRef)) throw new ControlError("BUILD_SOURCE_NOT_ALLOWED", "未配置此构建来源或源码引用。", 403);
      if (!this.adapter) throw new ControlError("BUILD_UNCONFIGURED", "尚未配置 GitHub 构建凭据。", 503);
      const sha = sourceSha.parse(await this.adapter.resolve(profile, args.sourceRef));
      const workflowSha = sourceSha.parse(await this.adapter.resolve(profile, profile.workflowRef));
      const preview = { profile, sourceSha: sha, workflowSha, fingerprint: hash([profile, args.sourceRef, sha, workflowSha]) };
      if (name === "builds.preview") return preview;
      if (buildCommands["builds.start"].input.parse(input).expectedFingerprint !== preview.fingerprint) throw new ControlError("BUILD_PREVIEW_STALE", "源码或构建配置已变化，请重新预览。", 409);
      return this.store.transact(db => {
        const previous = replay(db); if (previous) return previous;
        const build: Build = { id: crypto.randomUUID(), workspaceId: input.workspaceId, createdBy: actor.id, createdAt: new Date().toISOString(), revision: 1, profile: structuredClone(profile), sourceRef: args.sourceRef, sourceSha: sha, workflowSha, state: "queued" };
        db.builds.push(build); db.receipts.push({ key, fingerprint, buildId: build.id }); this.event(db, build, "已保存构建请求，尚未启用节点版本。"); return structuredClone(build);
      });
    }
    const args = buildCommands["builds.get"].input.parse({ workspaceId: input.workspaceId, buildId: "buildId" in input ? input.buildId : undefined });
    const build = this.find(state, args.workspaceId, args.buildId);
    if (name === "builds.get") return build;
    if (name === "builds.read_events") {
      const after = buildCommands[name].input.parse(input).after;
      const items = state.events.filter(e => e.workspaceId === args.workspaceId && e.buildId === args.buildId && e.sequence > after).slice(0, 200);
      return { items, cursor: items.at(-1)?.sequence ?? after };
    }
    return this.store.transact(db => {
      const previous = replay(db); if (previous) return previous;
      const current = this.find(db, args.workspaceId, args.buildId);
      if (current.revision !== buildCommands["builds.cancel"].input.parse(input).expectedRevision) throw new ControlError("REVISION_CONFLICT", "构建状态已变化。", 409);
      if (!terminal(current)) { current.state = current.state === "queued" ? "cancelled" : "cancelling"; current.revision++; this.event(db, current, "已记录取消构建请求。"); }
      db.receipts.push({ key, fingerprint, buildId: current.id }); return structuredClone(current);
    });
  }
  async verifiedResult(buildId: string, workspaceId: string): Promise<BuildResult> {
    const build = this.find(await this.store.read(), workspaceId, buildId);
    if (build.state !== "succeeded" || !build.result) throw new ControlError("BUILD_NOT_VERIFIED", "构建未成功或结果尚未通过验证。", 409);
    return structuredClone(build.result);
  }
  async tick() {
    if (this.ticking || !this.adapter) return;
    this.ticking = true;
    try {
      const errors: unknown[] = [];
      for (const build of (await this.store.read()).builds.filter(b => !terminal(b))) {
        try { await this.advance(build); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "Build reconciliation persistence unavailable");
    }
    finally { this.ticking = false; }
  }
  private async advance(snapshot: Build) {
    const prepared = await this.store.transact(db => {
      const build = this.find(db, snapshot.workspaceId, snapshot.id); if (terminal(build)) return null;
      const dispatch = build.state === "queued";
      if (dispatch) { build.state = "dispatching"; build.revision++; this.event(db, build, "正在提交 GitHub Actions。"); }
      return { build: structuredClone(build), dispatch };
    });
    if (!prepared) return;
    const { build, dispatch } = prepared;
    try {
      if (dispatch) {
        const receipt = await this.adapter!.dispatch(build);
        await this.store.transact(db => { const current = this.find(db, build.workspaceId, build.id); current.workflowRunId = receipt.runId; current.workflowUrl = receipt.url; if (current.state !== "cancelling") current.state = "running"; current.revision++; this.event(db, current, "GitHub 已接收构建。"); });
        return;
      }
      const observation = await this.adapter!.observe(build);
      if (!observation) throw new Error("Dispatch outcome unknown");
      if (build.state === "cancelling" && observation.state === "running") await this.adapter!.cancel(build, observation.runId);
      let result: BuildResult | undefined;
      if (observation.state === "succeeded") result = this.validateResult(build, observation.runId, observation.result);
      await this.store.transact(db => {
        const current = this.find(db, build.workspaceId, build.id); if (terminal(current)) return;
        const next = observation.state === "running" && current.state === "cancelling" ? "cancelling" : observation.state;
        if (current.state === next && current.message === observation.message && current.workflowRunId === observation.runId) return;
        current.state = next; current.message = observation.message; current.workflowRunId = observation.runId; current.workflowUrl = observation.url;
        if (result) current.result = result;
        current.revision++; this.event(db, current, observation.message);
      });
    } catch (error) {
      await this.store.transact(db => {
        const current = this.find(db, build.workspaceId, build.id); if (terminal(current)) return;
        const invalid = error instanceof ControlError && error.code === "BUILD_RESULT_INVALID";
        const message = invalid ? "构建结果与来源或节点契约不一致，拒绝启用。" : "构建结果尚未确认，正在核对原 GitHub 任务；不会重复派发。";
        if (current.message === message) return;
        current.state = invalid ? "failed" : current.state === "cancelling" ? "cancelling" : "unknown";
        current.message = message; current.revision++; this.event(db, current, message);
      });
    }
  }
  private validateResult(build: Build, runId: string, raw: unknown) {
    try {
      const result = buildResult.parse(raw);
      if (result.provenance.workflowSha !== build.workflowSha) throw new Error("Workflow revision mismatch");
      if (result.buildId !== build.id || result.profileId !== build.profile.id || result.sourceRepository !== `${build.profile.owner}/${build.profile.repository}` || result.sourceSha !== build.sourceSha || result.workflowRunId !== runId || result.image.split("@")[0] !== build.profile.imageRepository || result.package.id !== build.profile.packageId) throw new Error("Identity mismatch");
      for (const node of result.package.nodes) {
        compileContribution(node, result.package);
        if (node.execution.kind !== "reference" && node.execution.image !== result.image) throw new Error("Image mismatch");
      }
      return result;
    } catch { throw new ControlError("BUILD_RESULT_INVALID", "构建结果无法验证。", 409); }
  }
  private find(db: BuildDatabase, workspaceId: string, id: string) { const result = db.builds.find(b => b.workspaceId === workspaceId && b.id === id); if (!result) throw new ControlError("NOT_FOUND", "构建不存在。", 404); return result; }
  private event(db: BuildDatabase, build: Build, message: string) { db.events.push({ sequence: (db.events.at(-1)?.sequence ?? 0) + 1, workspaceId: build.workspaceId, buildId: build.id, at: new Date().toISOString(), message }); }
}
