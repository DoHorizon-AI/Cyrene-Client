import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { examplePipeline } from "../packages/pipeline-model";

// Uses a private network and disposable containers, never the configured team
// database. Build the two images before running this acceptance check.
const exec = promisify(execFile);
const docker = async (...args: string[]) => (await exec("docker", args, { timeout: 120000, maxBuffer: 2_000_000 })).stdout.trim();
const prefix = `studio-check-${crypto.randomUUID().slice(0, 8)}`;
const network = `${prefix}-network`, database = `${prefix}-database`, web = `${prefix}-web`, control = `${prefix}-control`;
const controlImage = process.env.STUDIO_TEST_CONTROL_IMAGE ?? "cyrene-studio:control-development";
const webImage = process.env.STUDIO_TEST_WEB_IMAGE ?? "cyrene-studio:web-development";
const databaseImage = process.env.STUDIO_TEST_POSTGRES_IMAGE ?? "postgres:17";
const password = crypto.randomUUID(), administratorPassword = crypto.randomUUID();
const created: string[] = [];
async function waitFor<T>(operation: () => Promise<T>, accept: (value: T) => boolean) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { const result = await operation(); if (accept(result)) return result; } catch { /* Startup and DNS replacement are retried. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Container readiness timed out");
}
await docker("network", "create", "--label", "cyrene.task=studio-container-verification", network);
try {
  created.push(database);
  await docker("run", "-d", "--name", database, "--network", network, "--network-alias", "database", "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_USER=studio", "-e", "POSTGRES_DB=studio", "-e", `POSTGRES_PASSWORD=${password}`, databaseImage);
  await waitFor(() => docker("exec", database, "pg_isready", "-U", "studio", "-d", "studio"), value => value.includes("accepting connections"));
  created.push(web);
  await docker("run", "-d", "--name", web, "--network", network, "-p", "127.0.0.1::8080", webImage);
  const port = JSON.parse(await docker("inspect", web))[0].NetworkSettings.Ports["8080/tcp"][0].HostPort;
  const origin = `http://127.0.0.1:${port}`;
  const environment = ["-e", "STUDIO_MODE=team", "-e", `STUDIO_DATABASE_URL=postgresql://studio:${password}@database:5432/studio`, "-e", `STUDIO_PUBLIC_ORIGINS=${origin}`];
  await docker("run", "--rm", "--network", network, ...environment, "-e", "STUDIO_ADMIN_USER=owner", "-e", `STUDIO_ADMIN_PASSWORD=${administratorPassword}`, controlImage, "node", "--import", "tsx", "apps/control/main.ts", "--bootstrap-admin");
  created.push(control);
  const start = () => docker("run", "-d", "--name", control, "--network", network, "--network-alias", "studio-control", ...environment, controlImage);
  await start();
  const request = (path: string, init: RequestInit = {}) => fetch(origin + path, { ...init, signal: AbortSignal.timeout(5000) });
  const ready = () => waitFor(async () => { const response = await request("/studio-team/v1/session"); return response.ok && response.headers.get("content-type")?.includes("application/json"); }, Boolean);
  await ready();
  const login = await request("/studio-team/v1/login", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ username: "owner", password: administratorPassword }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0], csrf = (await login.json()).token;
  const command = async (name: string, input: unknown, idempotencyKey?: string) => {
    const response = await request("/studio-pipelines/v1/commands", { method: "POST", headers: { "content-type": "application/json", origin, cookie, "x-studio-control-token": csrf }, body: JSON.stringify({ name, input, requestId: crypto.randomUUID(), idempotencyKey }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  };
  const document = examplePipeline(); document.name = "Container restart acceptance";
  await command("pipelines.create", { workspaceId: "local", document }, "acceptance-create");
  const target = { workspaceId: "local", pipelineId: document.id, expectedLayoutRevision: 1 };
  await command("pipelines.patch", { ...target, expectedGraphRevision: 1, edits: [{ op: "rename", name: "Redo after container replacement" }] }, "acceptance-patch");
  await command("pipelines.undo", { ...target, expectedGraphRevision: 2 }, "acceptance-undo");
  await docker("stop", "--time", "10", control); await docker("rm", control); await start(); await ready();
  const restored = await command("pipelines.get", { workspaceId: "local", pipelineId: document.id });
  assert.equal(restored.document.name, document.name); assert.equal(restored.graphRevision, 3);
  const redone = await command("pipelines.redo", { ...target, expectedGraphRevision: 3 }, "acceptance-redo");
  assert.equal(redone.record.document.name, "Redo after container replacement");
  const replay = await command("pipelines.redo", { ...target, expectedGraphRevision: 3 }, "acceptance-redo");
  assert.deepEqual(replay, redone);
  await command("pipelines.create", { workspaceId: "local", document }, "acceptance-create");
  assert.equal((await command("pipelines.list", { workspaceId: "local" })).items.length, 1);
  assert.match(await (await request("/")).text(), /<div id="root">/);
  process.stdout.write("PASS: gateway login, PostgreSQL graph, actor redo, session and idempotency survive control-container replacement.\n");
} finally {
  for (const name of created.reverse()) await docker("rm", "-f", "-v", name).catch(() => {});
  await docker("network", "rm", network).catch(() => {});
}
