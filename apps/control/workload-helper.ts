// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 workload-helper.ts                                               │
// │  Module: apps/control                                                │
// │  Role: Run the fixed local workload CLI over bounded JSON stdio.    │
// │                                                                      │
// │  模块职责：通过固定参数和有界 JSON 标准输入输出调用本机 workload CLI。  │
// └─────────────────────────────────────────────────────────────────────┘
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { workloadPlanHelperEnvelopeSchema, workloadPlanHelperRequestSchema, type WorkloadPlanHelperRequest, type WorkloadPlanResult } from "../../packages/workload-plan/contracts";
import { ControlError } from "../../packages/server-control/contracts";

const PROTOCOL_VERSION = "cyrene.workload-plan.v1" as const;
const MAX_OUTPUT_BYTES = 1_048_576;
const LINUX_CYRENE = "/usr/bin/cyrene";

/** Parse one bounded UTF-8 JSON line and enforce the fixed helper envelope. */
export function parseWorkloadPlanHelperReply(
  bytes: Buffer,
  operation: WorkloadPlanHelperRequest["operation"],
): WorkloadPlanResult {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ControlError("WORKLOAD_HELPER_JSON", "本机 workload CLI 返回了无效 UTF-8。", 502); }
  if (text.endsWith("\n")) text = text.slice(0, -1);
  if (!text || /[\r\n]/.test(text) || text.trim() !== text) {
    throw new ControlError("WORKLOAD_HELPER_JSON", "本机 workload CLI 必须返回单行 JSON。", 502);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new ControlError("WORKLOAD_HELPER_JSON", "本机 workload CLI 返回了无效 JSON。", 502); }
  const envelope = workloadPlanHelperEnvelopeSchema.safeParse(parsed);
  if (!envelope.success || envelope.data.operation !== operation) {
    throw new ControlError("WORKLOAD_HELPER_PROTOCOL", "本机 workload CLI 返回的协议或操作类型不匹配。", 502);
  }
  if (!envelope.data.ok) {
    throw new ControlError(envelope.data.error.code, envelope.data.error.message, envelope.data.error.retryable ? 503 : 409);
  }
  return envelope.data.result;
}

function osReleaseValue(content: string, key: string): string | undefined {
  const line = content.split(/\r?\n/).find(candidate => candidate.startsWith(`${key}=`));
  if (!line) return undefined;
  const value = line.slice(key.length + 1);
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

/** Resolve the fixed helper only on its supported Ubuntu 24.04 x86_64 host. */
export function resolveWorkloadHelperCommand(
  platform: NodeJS.Platform,
  architecture: string,
  osRelease: string,
): { executable: string; args: string[] } {
  if (platform !== "linux" || architecture !== "x64" || osReleaseValue(osRelease, "ID") !== "ubuntu" || osReleaseValue(osRelease, "VERSION_ID") !== "24.04") {
    throw new ControlError("WORKLOAD_PLATFORM_UNSUPPORTED", "工作负载安装目前只支持 Ubuntu 24.04 x86_64 本机 CLI。", 503);
  }
  return { executable: LINUX_CYRENE, args: ["workload", "--json"] };
}

/** Invoke the installed workload CLI with one validated JSON request and validate its reply. */
export function createWorkloadPlanHelper(options: {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
} = {}) {
  const platform = options.platform ?? process.platform;
  let command: { executable: string; args: string[] } | undefined;
  let resolutionError: Error | undefined;
  try {
    const osRelease = platform === "linux" ? readFileSync("/etc/os-release", "utf8") : "";
    command = resolveWorkloadHelperCommand(platform, process.arch, osRelease);
  } catch (error) {
    resolutionError = error instanceof ControlError
      ? error
      : new ControlError("WORKLOAD_PLATFORM_UNSUPPORTED", "工作负载安装目前只支持 Ubuntu 24.04 x86_64 本机 CLI。", 503);
  }

  return async function runWorkloadPlanHelper(request: WorkloadPlanHelperRequest): Promise<WorkloadPlanResult> {
    const validated = workloadPlanHelperRequestSchema.parse(request);
    if (validated.protocolVersion !== PROTOCOL_VERSION) throw new ControlError("WORKLOAD_PROTOCOL", "工作负载 helper 协议版本不受支持。", 400);
    if (resolutionError) throw resolutionError;
    const { executable, args } = command!;
    const timeoutMs = options.timeoutMs ?? (validated.operation === "status" || validated.operation === "check" ? 30_000 : 15 * 60_000);

    return await new Promise<WorkloadPlanResult>((resolve, reject) => {
      const child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new ControlError("WORKLOAD_HELPER_TIMEOUT", "本机工作负载操作超时；请先读取状态再重试。", 504);
        child.kill();
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          failure = new ControlError("WORKLOAD_HELPER_OUTPUT", "本机 workload CLI 返回的数据超过限制。", 502);
          child.kill();
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => { stderrBytes = Math.min(stderrBytes + chunk.length, MAX_OUTPUT_BYTES); });
      child.once("error", error => {
        clearTimeout(timer);
        reject(new ControlError("WORKLOAD_HELPER_UNAVAILABLE", `无法启动本机 workload CLI: ${error.message}`, 503));
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (failure) { reject(failure); return; }
        const output = Buffer.concat(stdout);
        if (!output.length) {
          reject(new ControlError("WORKLOAD_HELPER_EMPTY", `本机 workload CLI 没有返回协议结果 (exit=${code ?? "signal"}, stderrBytes=${stderrBytes})。`, 502));
          return;
        }
        try {
          const result = parseWorkloadPlanHelperReply(output, validated.operation);
          if (code !== 0 && code !== null || signal) {
            reject(new ControlError("WORKLOAD_HELPER_EXIT", `本机 workload CLI 异常退出 (exit=${code ?? "none"}, signal=${signal ?? "none"})。`, 502));
            return;
          }
          resolve(result);
        } catch (error) { reject(error); }
      });
      child.stdin.once("error", error => {
        if (!failure) failure = new ControlError("WORKLOAD_HELPER_INPUT", `无法向本机 workload CLI 发送请求: ${error.message}`, 502);
      });
      child.stdin.end(`${JSON.stringify(validated)}\n`);
    });
  };
}
