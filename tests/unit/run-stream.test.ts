import { afterEach, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createControlApplication } from "../../apps/control/application";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import { examplePipeline } from "../../packages/pipeline-model";
import type { Run } from "../../packages/run-control/contracts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const stores = new SqliteStoreFactory(":memory:");
  const app = createControlApplication({ stores, mode: "team", publicOrigins: ["http://127.0.0.1:5180"] });
  await app.ready; await app.team.bootstrap("owner", "stream-test-password");
  const login = await app.team.login("owner", "stream-test-password");
  const { actor } = await app.team.authenticate(login.token, "browser");
  const token = (await app.team.issueApiToken(actor, ["runs.read"])).token;
  const document = examplePipeline(); document.nodes = document.nodes.filter(n => n.type === "compute"); document.edges = [];
  document.presentation.nodes = Object.fromEntries(document.nodes.map(n => [n.id, document.presentation.nodes[n.id]]));
  await app.pipelines.execute({ name: "pipelines.create", input: { workspaceId: "local", document }, requestId: "create", idempotencyKey: "create" }, actor);
  const input = { workspaceId: "local", pipelineId: document.id, expectedGraphRevision: 1 };
  const preview: any = await app.runs.execute({ name: "runs.preflight", input, requestId: "preflight" }, actor);
  const run = await app.runs.execute({ name: "runs.start", input: { ...input, expectedFingerprint: preview.fingerprint }, requestId: "start", idempotencyKey: "start" }, actor) as Run;
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); await stores.close(); });
  const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const path = `/studio-runs/v1/stream?workspaceId=local&runId=${run.id}`;
  return { app, actor, token, origin, path, run };
}
async function frame(response: Response) {
  const reader = response.body!.getReader();
  let text = "";
  while (!text.includes("\n\n")) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); }
  await reader.cancel();
  return { text, value: JSON.parse(text.split("\n").find(line => line.startsWith("data: "))!.slice(6)) };
}
it("streams the same atomic observation as MCP and resumes without replaying acknowledged events", async () => {
  const f = await fixture(), headers = { authorization: `Bearer ${f.token}` };
  const first = await frame(await fetch(f.origin + f.path, { headers, signal: AbortSignal.timeout(5000) }));
  expect(first.value.run.id).toBe(f.run.id); expect(first.value.items).toHaveLength(1);
  const replay = await frame(await fetch(f.origin + f.path, { headers: { ...headers, "last-event-id": String(first.value.cursor) }, signal: AbortSignal.timeout(5000) }));
  expect(replay.value.items).toEqual([]); expect(replay.value.run).toEqual(first.value.run);
  const command = await f.app.runs.execute({ name: "runs.observe", input: { workspaceId: "local", runId: f.run.id }, requestId: "observe" }, f.actor);
  expect(command).toEqual(first.value);
});
it("checks stream workspace, scope, authentication and cursors before emitting headers", async () => {
  const f = await fixture(), headers = { authorization: `Bearer ${f.token}` };
  const other = f.path.replace("workspaceId=local", "workspaceId=other");
  expect((await fetch(f.origin + other, { headers })).status).toBe(403);
  expect((await fetch(f.origin + f.path, { headers: { ...headers, "last-event-id": "not-a-cursor" } })).status).toBe(400);
  expect((await fetch(f.origin + f.path, { headers: { ...headers, "last-event-id": "999" } })).status).toBe(409);
  const restricted = await f.app.team.issueApiToken(f.actor, ["pipelines.read"]);
  expect((await fetch(f.origin + f.path, { headers: { authorization: `Bearer ${restricted.token}` } })).status).toBe(403);
  await f.app.team.logout(f.token);
  expect((await fetch(f.origin + f.path, { headers })).status).toBe(401);
});
it("closes an existing stream when its credential is revoked", async () => {
  const f = await fixture();
  const response = await fetch(f.origin + f.path, { headers: { authorization: `Bearer ${f.token}` }, signal: AbortSignal.timeout(5000) });
  const reader = response.body!.getReader();
  await reader.read(); await f.app.team.logout(f.token);
  let done = false;
  while (!done) done = (await reader.read()).done;
  expect(done).toBe(true);
});
