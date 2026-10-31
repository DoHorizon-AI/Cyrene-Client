import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { access, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'node:net';
import { loadEnv } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
Object.assign(process.env, loadEnv('development', root, ''));
const { values } = parseArgs({ options: {
  port: { type: 'string', default: '5180' },
  'navigator-port': { type: 'string', default: '8100' },
  'state-dir': { type: 'string' },
  'shutdown-stdin': { type: 'boolean', default: false },
} });
const ports = [values.port, values['navigator-port'], process.env.STUDIO_CONTROL_PORT ?? String(Number(values.port) + 100)].map(Number);
if (ports.some(p => !Number.isSafeInteger(p) || p < 1 || p > 65535) || new Set(ports).size !== ports.length) throw new Error('Use three distinct ports between 1 and 65535');
if (process.env.STUDIO_MODE && process.env.STUDIO_MODE !== 'local') throw new Error('The personal assistant launcher requires local mode');
for (const port of ports) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is already occupied`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
const navigator = resolve(process.env.CYRENE_NAVIGATOR_DIR ?? join(root, '../Cyrene-Services/Cyrene-Navigator'));
await access(join(navigator, 'harness/dist/serve.js')).catch(() => { throw new Error('Build the pinned Navigator Harness first; see docs/navigator-assistant-integration.md'); });
const stateDir = resolve(values['state-dir'] ?? process.env.CYRENE_NAVIGATOR_STATE_DIR ?? join(root, '.studio/navigator'));
await mkdir(stateDir, { recursive: true });
const frontOrigin = `http://127.0.0.1:${ports[0]}`;
const controlOrigin = `http://127.0.0.1:${ports[2]}`;
const token = process.env.STUDIO_LOCAL_API_TOKEN || randomBytes(32).toString('hex');
const common = { ...process.env, STUDIO_MODE: 'local', STUDIO_CONTROL_HOST: '127.0.0.1',
  STUDIO_WORKSPACE_ID: process.env.STUDIO_WORKSPACE_ID ?? 'local', STUDIO_CONTROL_PORT: String(ports[2]),
  STUDIO_PUBLIC_ORIGINS: frontOrigin, STUDIO_NAVIGATOR_URL: `http://127.0.0.1:${ports[1]}`,
  STUDIO_LOCAL_API_TOKEN: token,
};
const children = new Set();
let closing = false;
let navigatorChild;
let shutdownInput;
function start(file, args, cwd, env, stdio = 'inherit') {
  const child = spawn(file, args, { cwd, env, stdio, windowsHide: true });
  children.add(child);
  child.once('error', error => { console.error(`Unable to start ${file}: ${error.code ?? 'process error'}`); close(1); });
  child.once('exit', code => { children.delete(child); if (!closing) close(code ?? 1); });
  return child;
}
function close(code = 0) {
  if (closing) return;
  closing = true; process.exitCode = code;
  shutdownInput?.close(); process.stdin.pause();
  const terminate = child => {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      // Kill only process trees launched by this supervisor, including Python's
      // persistence/executor children. Never search for unrelated services.
      spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else child.kill('SIGTERM');
  };
  const remaining = () => { for (const child of children) terminate(child); };
  if (navigatorChild && children.has(navigatorChild) && !navigatorChild.stdin.destroyed) {
    // The existing Python supervisor releases writer/session leases and shuts
    // down its children in reverse order before the Client processes stop.
    navigatorChild.stdin.on('error', () => {});
    navigatorChild.stdin.end('shutdown\n');
    const deadline = setTimeout(remaining, 30_000);
    navigatorChild.once('exit', () => { clearTimeout(deadline); remaining(); });
  } else {
    remaining();
  }
}
process.once('SIGINT', () => close()); process.once('SIGTERM', () => close());
if (values['shutdown-stdin']) {
  const control = createInterface({ input: process.stdin });
  shutdownInput = control;
  control.on('line', line => { if (line.trim() === 'shutdown') { control.close(); process.stdin.pause(); close(); } });
  control.once('close', () => close());
}
try {
  start(process.execPath, ['scripts/dev.mjs', '--port', String(ports[0])], root, common);
  const deadline = Date.now() + 45_000;
  for (;;) {
    if (closing) break;
    try { if ((await fetch(controlOrigin + '/health/ready', { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    if (Date.now() >= deadline) throw new Error('Control startup timed out');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!closing) {
    const virtualPython = join(navigator, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
    let file = process.env.CYRENE_PYTHON, prefix = [];
    if (!file) {
      try { await access(virtualPython); file = virtualPython; }
      catch { file = 'uv'; prefix = ['run', '--project', navigator, 'python']; }
    }
    const env = { ...common, CYRENE_MCP_URL: controlOrigin + '/studio-mcp', CYRENE_MCP_TOKEN: token,
      CYRENE_PERSONAL_RUNTIMES_ENABLED: 'true',
      CYRENE_WORKSPACE_ID: common.STUDIO_WORKSPACE_ID,
      PYTHONPATH: [join(navigator, 'src'), process.env.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
      DSH_HOME: process.env.DSH_HOME ?? join(stateDir, 'harness'),
    };
    const child = start(file, [...prefix, join(navigator, 'scripts/serve-local.py'), '--state-dir', stateDir,
      '--host', '127.0.0.1', '--port', String(ports[1]), '--public-url', frontOrigin,
      '--workspace-id', common.STUDIO_WORKSPACE_ID, '--insecure-http', '--shutdown-stdin'], navigator, env, ['pipe', 'pipe', 'inherit']);
    navigatorChild = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const value = JSON.parse(line);
        if (value.urls?.web) {
          console.log(`Assistant ready: ${frontOrigin}`);
          console.log(`Navigator pairing code file: ${join(stateDir, 'pairing-code')}`);
        }
      } catch { /* Child service diagnostics stay on stderr. */ }
    });
  }
} catch (error) { console.error(error.message); close(1); }
