// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 update-helper.ts                                                 │
// │  Module: apps/control                                                │
// │  Role: Run the fixed local component-update helper over JSON stdio.  │
// │                                                                      │
// │  模块职责：通过固定参数和 JSON 标准输入输出调用本机更新 helper。         │
// └─────────────────────────────────────────────────────────────────────┘
import { spawn } from "node:child_process";
import { isAbsolute, win32 } from "node:path";
import { updateHelperEnvelopeSchema, updateHelperRequestSchema, type UpdateHelperRequest, type UpdateHelperResult } from "../../packages/component-updates/contracts";
import { ControlError } from "../../packages/server-control/contracts";

const PROTOCOL_VERSION = "cyrene.component-updates.helper.v1" as const;
const MAX_OUTPUT_BYTES = 1_048_576;
const LINUX_POLKIT = "/usr/bin/pkexec";
const LINUX_PRIVILEGED_HELPER = "/usr/libexec/cyrene-component-update-helper";

/** Resolve the fixed local executable chain; request bodies never choose a path or argument. */
export function resolveUpdateHelperCommand(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): { executable: string; args: string[] } {
  const configured = env.STUDIO_UPDATE_HELPER_PATH?.trim();
  if (platform === "linux") {
    if (configured && configured !== LINUX_PRIVILEGED_HELPER) {
      throw new ControlError("UPDATE_HELPER_CONFIG", "Linux 更新 helper 固定为 pkexec 调用已安装的 component-update-helper。", 500);
    }
    return { executable: LINUX_POLKIT, args: [LINUX_PRIVILEGED_HELPER] };
  }
  const absolute = configured && (platform === "win32" ? win32.isAbsolute(configured) : isAbsolute(configured));
  if (configured && !absolute) throw new ControlError("UPDATE_HELPER_CONFIG", "STUDIO_UPDATE_HELPER_PATH 必须是绝对路径。", 500);
  return {
    executable: configured || (platform === "win32"
      ? `${(env.ProgramFiles || "C:\\Program Files").replace(/[\\/]+$/, "")}\\Cyrene\\installer.exe`
      : "/usr/bin/cyrene"),
    args: platform === "win32" ? ["--updates-stdio"] : ["update", "--json"],
  };
}

/** Invoke the local helper with one bounded JSON request and validate its reply. */
export function createUpdateHelper(options: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
} = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const { executable, args } = resolveUpdateHelperCommand(env, platform);

  return async function runUpdateHelper(request: UpdateHelperRequest): Promise<UpdateHelperResult> {
    const validated = updateHelperRequestSchema.parse(request);
    if (validated.protocolVersion !== PROTOCOL_VERSION) throw new ControlError("UPDATE_PROTOCOL", "更新 helper 协议版本不受支持。", 400);
    const timeoutMs = options.timeoutMs ?? (validated.operation === "status" || validated.operation === "check" ? 30_000 : 15 * 60_000);

    return await new Promise<UpdateHelperResult>((resolve, reject) => {
      const child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new ControlError("UPDATE_HELPER_TIMEOUT", "本机更新操作超时；请先读取更新状态再重试。", 504);
        child.kill();
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          failure = new ControlError("UPDATE_HELPER_OUTPUT", "本机更新 helper 返回的数据超过限制。", 502);
          child.kill();
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => { stderrBytes = Math.min(stderrBytes + chunk.length, MAX_OUTPUT_BYTES); });
      child.once("error", error => {
        clearTimeout(timer);
        reject(new ControlError("UPDATE_HELPER_UNAVAILABLE", `无法启动本机更新 helper: ${error.message}`, 503));
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (failure) { reject(failure); return; }
        const text = Buffer.concat(stdout).toString("utf8").trim();
        if (!text) {
          const error = platform === "linux"
            ? new ControlError("UPDATE_AUTH_REQUIRED", `Linux 本机 helper 没有返回协议结果 (exit=${code ?? "signal"}, stderrBytes=${stderrBytes})。请检查 Polkit 授权代理与 helper 安装；无桌面授权代理时可在本机终端运行 sudo cyrene update --json。`, 403)
            : new ControlError("UPDATE_HELPER_EMPTY", `本机更新 helper 没有返回协议结果 (exit=${code ?? "signal"}, stderrBytes=${stderrBytes})。`, 502);
          reject(error);
          return;
        }
        let parsed: unknown;
        try { parsed = JSON.parse(text); }
        catch { reject(new ControlError("UPDATE_HELPER_JSON", "本机更新 helper 返回了无效 JSON。", 502)); return; }
        const envelope = updateHelperEnvelopeSchema.safeParse(parsed);
        if (!envelope.success || envelope.data.operation !== validated.operation) {
          reject(new ControlError("UPDATE_HELPER_PROTOCOL", "本机更新 helper 返回的协议或操作类型不匹配。", 502));
          return;
        }
        if (!envelope.data.ok) {
          reject(new ControlError(envelope.data.error.code, envelope.data.error.message, envelope.data.error.retryable ? 503 : 409));
          return;
        }
        if (code !== 0 && code !== null || signal) {
          reject(new ControlError("UPDATE_HELPER_EXIT", `本机更新 helper 异常退出 (exit=${code ?? "none"}, signal=${signal ?? "none"})。`, 502));
          return;
        }
        resolve(envelope.data.result);
      });
      child.stdin.once("error", error => {
        if (!failure) failure = new ControlError("UPDATE_HELPER_INPUT", `无法向本机更新 helper 发送请求: ${error.message}`, 502);
      });
      child.stdin.end(`${JSON.stringify(validated)}\n`);
    });
  };
}
