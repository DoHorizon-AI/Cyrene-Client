import { spawn } from "node:child_process";
import { loadEnv } from "vite";
Object.assign(process.env, loadEnv("development", process.cwd(), "STUDIO_"));
const args = process.argv.slice(2);
const index = args.indexOf("--port"), port = index >= 0 ? Number(args[index + 1]) : 5180;
const controlPort = Number(process.env.STUDIO_CONTROL_PORT ?? port + 100);
const env = { ...process.env, STUDIO_CONTROL_PORT: String(controlPort), STUDIO_PUBLIC_ORIGINS: process.env.STUDIO_PUBLIC_ORIGINS ?? `http://127.0.0.1:${port}`, STUDIO_CONTROL_URL: `http://127.0.0.1:${controlPort}` };
const children = [];
let closing = false;
function close(code = 0) { if (closing) return; closing = true; for (const child of children) child.kill("SIGTERM"); process.exitCode = code; }
for (const childArgs of [["--import", "tsx", "apps/control/main.ts"], ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", ...args]]) {
  const child = spawn(process.execPath, childArgs, { env, stdio: "inherit", windowsHide: true }); children.push(child);
  child.on("error", error => { console.error(error.message); close(1); });
  child.on("exit", code => close(code ?? 1));
}
process.once("SIGINT", () => close()); process.once("SIGTERM", () => close());
