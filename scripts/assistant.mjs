import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { access, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'node:net';
import { loadEnv } from 'vite';
import {
  createNavigatorChildEnvironment,
  prepareAssistantEnvironment,
} from './assistant-environment.mjs';
import { createNavigatorServeArgs, requestNavigatorShutdown } from './assistant-process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  port: { type: 'string', default: '5180' },
  'navigator-port': { type: 'string', default: '8100' },
  'persistence-port': { type: 'string', default: '0' },
  'control-port': { type: 'string' },
  'workspace-id': { type: 'string' },
  'organization-id': { type: 'string' },
  'actor-id': { type: 'string' },
  'state-dir': { type: 'string' },
  'principal-config': { type: 'string' },
  'principal-token-env': { type: 'string', default: 'CYRENE_SESSION_TOKEN' },
  'isolated-env': { type: 'boolean', default: false },
  'shutdown-stdin': { type: 'boolean', default: false },
} });
if (!values['isolated-env']) Object.assign(process.env, loadEnv('development', root, ''));
const {
  inheritedEnvironment: inheritedEnv,
  sharedEnvironment: webEnvironment,
  navigatorOnlyEnvironment,
} = prepareAssistantEnvironment(process.env, values['isolated-env']);
const frontPort = Number(values.port), navigatorPort = Number(values['navigator-port']);
const controlPort = Number(values['control-port'] ?? inheritedEnv.STUDIO_CONTROL_PORT ?? frontPort + 100);
const persistencePort = Number(values['persistence-port']);
const workspaceId = values['workspace-id'] ?? inheritedEnv.STUDIO_WORKSPACE_ID ?? 'local';
const organizationId = values['organization-id'] ?? inheritedEnv.CYRENE_ORGANIZATION_ID ?? 'local';
const actorId = values['actor-id'] ?? 'local-navigator';
const ports = [frontPort, navigatorPort, controlPort, ...(persistencePort > 0 ? [persistencePort] : [])];
if (ports.some(p => !Number.isSafeInteger(p) || p < 1 || p > 65535) || new Set(ports).size !== ports.length || !Number.isSafeInteger(persistencePort) || persistencePort < 0 || persistencePort > 65535) throw new Error('Use distinct frontend, Navigator, Control, and optional Persistence ports; persistence may be 0 for an ephemeral port');
if (!values['isolated-env'] && inheritedEnv.STUDIO_MODE && inheritedEnv.STUDIO_MODE !== 'local') throw new Error('The personal assistant launcher requires local mode');
if (values['isolated-env']) {
  const exchangeUrl = inheritedEnv.CYRENE_EXCHANGE_URL;
  if (!exchangeUrl || !inheritedEnv.CYRENE_EXCHANGE_TOKEN || !inheritedEnv.CYRENE_HARNESS_MODEL) throw new Error('Isolated mode requires explicit local CYRENE_EXCHANGE_URL, CYRENE_EXCHANGE_TOKEN, and CYRENE_HARNESS_MODEL environment values');
  let parsedExchangeUrl;
  try { parsedExchangeUrl = new URL(exchangeUrl); } catch { throw new Error('Isolated mode requires a loopback Exchange URL.'); }
  if (parsedExchangeUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsedExchangeUrl.hostname) || parsedExchangeUrl.username || parsedExchangeUrl.password || parsedExchangeUrl.pathname !== '/' || parsedExchangeUrl.search || parsedExchangeUrl.hash) throw new Error('Isolated mode only accepts a loopback Exchange origin without credentials or a path');
  if (workspaceId !== 'local') throw new Error('Isolated mode is limited to the local workspace id');
}
for (const port of ports) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is already occupied`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
const navigator = resolve(inheritedEnv.CYRENE_NAVIGATOR_DIR ?? join(root, '../Cyrene-Services/Cyrene-Navigator'));
await access(join(navigator, 'harness/dist/serve.js')).catch(() => { throw new Error('Build the pinned Navigator Harness first; see docs/navigator-assistant-integration.md'); });
const stateDir = resolve(values['state-dir'] ?? inheritedEnv.CYRENE_NAVIGATOR_STATE_DIR ?? join(root, '.studio/navigator'));
await mkdir(stateDir, { recursive: true });
const isolatedEnvDir = join(stateDir, 'empty-env');
if (values['isolated-env']) await mkdir(isolatedEnvDir, { recursive: true });
const frontOrigin = `http://127.0.0.1:${ports[0]}`;
const controlOrigin = `http://127.0.0.1:${ports[2]}`;
const token = values['isolated-env'] ? randomBytes(32).toString('hex') : inheritedEnv.STUDIO_LOCAL_API_TOKEN || randomBytes(32).toString('hex');
const common = { ...webEnvironment, STUDIO_MODE: 'local', STUDIO_CONTROL_HOST: '127.0.0.1',
  STUDIO_CONTROL_PORT: String(ports[2]),
  ...(values['isolated-env'] ? { STUDIO_ISOLATED_ENV: '1', STUDIO_ENV_DIR: isolatedEnvDir, STUDIO_CONTROL_DATA_DIR: join(stateDir, 'control') } : {}),
  STUDIO_WORKSPACE_ID: workspaceId,
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
  if (navigatorChild && children.has(navigatorChild)) {
    // The pinned Python supervisor handles SIGTERM and stops its children in reverse order.
    requestNavigatorShutdown(navigatorChild);
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
    let file = inheritedEnv.CYRENE_PYTHON, prefix = [];
    if (!file) {
      try { await access(virtualPython); file = virtualPython; }
      catch { file = 'uv'; prefix = ['run', '--project', navigator, 'python']; }
    }
    const env = { ...createNavigatorChildEnvironment(common, inheritedEnv, navigatorOnlyEnvironment),
      CYRENE_MCP_URL: controlOrigin + '/studio-mcp', CYRENE_MCP_TOKEN: token,
      CYRENE_PERSONAL_RUNTIMES_ENABLED: 'true',
      CYRENE_WORKSPACE_ID: common.STUDIO_WORKSPACE_ID,
      PYTHONPATH: [join(navigator, 'src'), inheritedEnv.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
      DSH_HOME: values['isolated-env'] ? join(stateDir, 'harness') : process.env.DSH_HOME ?? join(stateDir, 'harness'),
    };
    const navigatorArgs = createNavigatorServeArgs({
      prefix,
      scriptPath: join(navigator, 'scripts/serve-local.py'),
      stateDir,
      host: '127.0.0.1',
      port: ports[1],
      persistencePort,
      publicUrl: frontOrigin,
      workspaceId: common.STUDIO_WORKSPACE_ID,
      organizationId,
      actorId,
      principalTokenEnv: values['principal-token-env'],
      principalConfig: values['principal-config'] ? resolve(values['principal-config']) : undefined,
    });
    const child = start(file, navigatorArgs, navigator, env, ['ignore', 'pipe', 'inherit']);
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
