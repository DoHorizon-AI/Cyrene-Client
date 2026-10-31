import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { ControlError } from "../server-control/contracts";
import { buildResult, type Build, type BuildProfile } from "./contracts";
import type { BuildAdapter, BuildObservation } from "./adapter";

/** A server-configured credential; repository/workflow targets are never taken
 * from graph inputs. Redirects used for signed artifact downloads omit it. */
export class GitHubBuildAdapter implements BuildAdapter {
  private nextRequestAt = 0;
  constructor(private token: () => string, private transport: typeof fetch = fetch) {}
  private base(profile: BuildProfile) { return `/repos/${profile.owner}/${profile.repository}`; }
  private async request(path: string, method = "GET", body?: unknown) {
    if (Date.now() < this.nextRequestAt) throw new ControlError("GITHUB_RATE_LIMITED", "等待 GitHub 限流窗口结束。", 503);
    const response = await this.transport(`https://api.github.com${path}`, {
      method, redirect: "manual", signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${this.token()}`, accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 429 || response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))) {
      const retry = response.headers.get("retry-after"), reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const delay = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : 0;
      this.nextRequestAt = Math.max(Date.now() + 60_000, Number.isFinite(delay) ? delay : 0, Number.isFinite(reset) ? reset : 0);
      throw new ControlError("GITHUB_RATE_LIMITED", "GitHub 请求受到限流，将按限流窗口重试。", 503);
    }
    return response;
  }
  private async json(path: string, method = "GET", body?: unknown) {
    const response = await this.request(path, method, body);
    // GitHub secondary limits may use 403 without a Retry-After header.
    if (!response.ok) throw new ControlError("GITHUB_UNAVAILABLE", `GitHub 请求未确认（HTTP ${response.status}），请核对配置或稍后重试。`, response.status === 403 ? 503 : response.status);
    if (response.status === 204) return {};
    return response.json();
  }
  async resolve(profile: BuildProfile, ref: string): Promise<string> { return (await this.json(`${this.base(profile)}/commits/${encodeURIComponent(ref)}`)).sha; }
  async dispatch(build: Build) {
    const result = await this.json(`${this.base(build.profile)}/actions/workflows/${encodeURIComponent(build.profile.workflow)}/dispatches`, "POST", {
      ref: build.profile.workflowRef,
      inputs: { studio_build_id: build.id, source_sha: build.sourceSha, profile_id: build.profile.id },
    });
    const runId = this.id(result.workflow_run_id);
    return { runId, url: `https://github.com/${build.profile.owner}/${build.profile.repository}/actions/runs/${runId}` };
  }
  async observe(build: Build): Promise<BuildObservation | null> {
    const base = this.base(build.profile);
    let run: any;
    if (build.workflowRunId) run = await this.json(`${base}/actions/runs/${build.workflowRunId}`);
    else {
      // No automatic redispatch after a lost response. Search bounded pages for
      // the durable correlation embedded by our workflow's run-name.
      for (let page = 1; page <= 10; page++) {
        const created = encodeURIComponent(`>=${new Date(Date.parse(build.createdAt) - 60_000).toISOString()}`);
        const result = await this.json(`${base}/actions/workflows/${encodeURIComponent(build.profile.workflow)}/runs?event=workflow_dispatch&created=${created}&per_page=100&page=${page}`);
        const matches = result.workflow_runs.filter((r: any) => r.display_title === `studio-build:${build.id}`);
        if (matches.length > 1) throw new ControlError("BUILD_RESULT_INVALID", "发现重复构建关联。", 409);
        if (matches.length) { run = matches[0]; break; }
        if (result.workflow_runs.length < 100) break;
      }
      if (!run) return null;
    }
    if (run.event !== "workflow_dispatch" || run.display_title !== `studio-build:${build.id}` || run.repository?.full_name !== `${build.profile.owner}/${build.profile.repository}` || run.head_sha !== build.workflowSha || run.path !== `.github/workflows/${build.profile.workflow}`) throw new ControlError("BUILD_RESULT_INVALID", "GitHub 构建身份与请求不一致。", 409);
    const runId = this.id(run.id), url = `https://github.com/${build.profile.owner}/${build.profile.repository}/actions/runs/${runId}`;
    if (run.status !== "completed") return { runId, url, state: "running", message: `GitHub：${run.status}。运行中日志请打开构建链接。` };
    if (run.conclusion !== "success") return { runId, url, state: run.conclusion === "cancelled" ? "cancelled" : "failed", message: `GitHub 构建结束：${run.conclusion ?? "未知结论"}。` };
    const artifacts = await this.json(`${base}/actions/runs/${runId}/artifacts?per_page=100`);
    const matches = artifacts.artifacts.filter((a: any) => a.name === `studio-result-${build.id}` && !a.expired);
    if (matches.length !== 1) throw new ControlError("BUILD_RESULT_INVALID", "缺少唯一有效的构建结果清单。", 409);
    const artifact = matches[0];
    if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes > 8 * 1024 * 1024) throw new ControlError("BUILD_RESULT_INVALID", "构建结果大小不符合契约。", 409);
    const response = await this.request(`${base}/actions/artifacts/${this.id(artifact.id)}/zip`);
    let download = response;
    if (response.status === 302) {
      const location = new URL(response.headers.get("location") ?? "");
      if (location.protocol !== "https:" || location.username || location.password) throw new Error("Invalid artifact location");
      download = await this.transport(location, { redirect: "error", signal: AbortSignal.timeout(20000) });
    }
    if (!download.ok || !download.body) throw new Error("Artifact download unavailable");
    const reader = download.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 8 * 1024 * 1024) throw new Error("Artifact too large"); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    const zip = Buffer.concat(chunks);
    if (typeof artifact.digest !== "string" || artifact.digest !== `sha256:${createHash("sha256").update(zip).digest("hex")}`) throw new ControlError("BUILD_RESULT_INVALID", "GitHub 制品摘要校验失败。", 409);
    try {
      const files = unzipSync(zip, { filter: file => file.name === "build-result.json" && file.originalSize <= 1_048_576 });
      const result = buildResult.parse(JSON.parse(strFromU8(files["build-result.json"])));
      return { runId, url, state: "succeeded", message: "镜像及节点包构建成功；等待显式启用版本。", result };
    } catch { throw new ControlError("BUILD_RESULT_INVALID", "构建结果清单不符合契约。", 409); }
  }
  async cancel(build: Build, runId: string) {
    const response = await this.request(`${this.base(build.profile)}/actions/runs/${runId}/cancel`, "POST");
    if (!response.ok && response.status !== 409) throw new Error("Cancellation not confirmed");
  }
  private id(value: unknown) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
    throw new Error("Invalid GitHub identity");
  }
}
