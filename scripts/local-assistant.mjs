import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// The installed launcher sets CYRENE_NAVIGATOR_DIR to its bundled runtime.
// Source development can use an adjacent Navigator checkout with built output.
const candidates = [process.env.CYRENE_NAVIGATOR_DIR, '../Cyrene-Navigator', '../navigator'].filter(Boolean).map(p => resolve(p));
const repository = candidates.find(p => existsSync(join(p, 'assistant/dist/main.js')));
if (!repository) throw new Error('Set CYRENE_NAVIGATOR_DIR to the built Navigator runtime. See docs/local-assistant.md.');
const token = randomBytes(32).toString('hex');
const args = process.argv.slice(2), portIndex = args.indexOf('--port');
const webPort = portIndex >= 0 ? Number(args[portIndex + 1]) : 5180;
process.env.STUDIO_LOCAL_API_TOKEN = randomBytes(32).toString('hex');
process.env.STUDIO_MODE = 'local';
const child = spawn(process.execPath, [join(repository, 'assistant/dist/main.js')], {
  windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, CYRENE_ASSISTANT_TOKEN: token, CYRENE_ASSISTANT_CWD: process.env.CYRENE_ASSISTANT_CWD ?? process.cwd(), CYRENE_STUDIO_MCP_URL: `http://127.0.0.1:${Number(process.env.STUDIO_CONTROL_PORT ?? webPort + 100)}/studio-mcp`, CYRENE_STUDIO_MCP_TOKEN: process.env.STUDIO_LOCAL_API_TOKEN },
});
child.stderr.on('data', () => {});
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Navigator assistant startup timed out')), 20000);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { try { const value = JSON.parse(line); if (value.service === 'cyrene-assistant') { clearTimeout(timer); lines.close(); resolve(`http://127.0.0.1:${value.port}`); } } catch {} });
  child.once('error', reject); child.once('exit', () => { clearTimeout(timer); reject(new Error('Navigator assistant exited')); });
}).catch(error => { child.kill(); throw error; });
process.env.STUDIO_ASSISTANT_HOST_URL = endpoint;
process.env.STUDIO_ASSISTANT_HOST_TOKEN = token;
process.once('exit', () => child.kill());
process.once('SIGINT', () => child.kill()); process.once('SIGTERM', () => child.kill());
child.once('exit', () => { process.stderr.write('Local assistant stopped. In-flight turns require reconciliation.\n'); });
await import('./dev.mjs');
console.log('Local assistant connected. Open the loopback workbench address printed by Vite.');
