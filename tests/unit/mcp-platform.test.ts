import { afterEach, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createControlApplication } from "../../apps/control/application";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import { LocalDiagnosticAdapter, diagnosticDatabase, emptyDiagnosticDatabase } from "../../packages/local-diagnostics/adapter";
import { diagnosticPipeline } from "../../packages/local-diagnostics/definition";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(readOnly = false) {
  const stores = new SqliteStoreFactory(":memory:");
  const app = createControlApplication({ stores, mode: "local", publicOrigins: ["http://127.0.0.1:5180"], localApiToken: "test-api-token", localDiagnostics: true, mcpReadOnly: readOnly });
  await app.ready; await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); await stores.close(); });
  const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const client = new Client({ name: "platform-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/studio-mcp`), { requestInit: { headers: { authorization: "Bearer test-api-token" } } }));
  cleanup.push(() => client.close());
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent as any;
  };
  return { app, stores, origin, client, call };
}

it("handshakes over HTTP, discovers context/prompts and runs a workflow through actual MCP commands", async () => {
  const f = await fixture();
  expect((await f.client.listTools()).tools.map(t => t.name)).toEqual(expect.arrayContaining(["pipelines.create", "pipelines.layout", "runs.start", "monitoring.snapshot", "servers.list"]));
  const context = await f.client.readResource({ uri: "cyrene://context" });
  expect(JSON.stringify(context)).toContain("local-mcp"); expect(JSON.stringify(context)).not.toContain("test-api-token");
  expect((await f.client.listPrompts()).prompts[0].name).toBe("workflow-assistant");
  const doc = diagnosticPipeline("mcp-check");
  const created = await f.call("pipelines.create", { workspaceId: "local", document: doc, idempotencyKey: "create-check" });
  const laidOut = await f.call("pipelines.layout", { workspaceId: "local", pipelineId: doc.id, expectedGraphRevision: created.record.graphRevision, expectedLayoutRevision: created.record.layoutRevision, idempotencyKey: "layout-check" });
  const input = { workspaceId: "local", pipelineId: doc.id, expectedGraphRevision: laidOut.record.graphRevision };
  const preview = await f.call("runs.preflight", input); expect(preview.issues).toEqual([]);
  const args = { ...input, expectedFingerprint: preview.fingerprint, idempotencyKey: "start-check" };
  const run = await f.call("runs.start", args);
  expect((await f.call("runs.start", args)).id).toBe(run.id);
  await f.app.runs.tick();
  const observed = await f.call("runs.observe", { workspaceId: "local", runId: run.id });
  expect(observed.run.state).toBe("running");
  expect(observed.run.steps.every((s: any) => s.adapter === "local-diagnostic")).toBe(true);
  expect((await f.call("monitoring.snapshot", { workspaceId: "local" })).runs[0].id).toBe(run.id);
  await f.call("runs.stop", { workspaceId: "local", runId: run.id, expectedRevision: observed.run.revision, idempotencyKey: "stop-check" });
  await f.app.runs.tick();
  expect((await f.call("runs.get", { workspaceId: "local", runId: run.id })).state).toBe("stopped");
  expect((await f.client.callTool({ name: "monitoring.snapshot", arguments: { workspaceId: "other" } })).isError).toBe(true);
});

it("rejects missing credentials, cross-origin and CSRF before protocol calls, and filters writes in read-only mode", async () => {
  const f = await fixture(true);
  expect((await f.client.listTools()).tools.every(t => t.annotations?.readOnlyHint)).toBe(true);
  const result = await f.client.callTool({ name: "pipelines.create", arguments: { workspaceId: "local", document: diagnosticPipeline("forbidden"), idempotencyKey: "forbidden" } });
  expect(result.isError).toBe(true);
  for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: "Bearer test-api-token", origin: "https://evil.invalid" }]) {
    const response = await fetch(`${f.origin}/studio-mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers } as Record<string, string>, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect([401, 403]).toContain(response.status);
  }
  expect((await f.call("pipelines.list", { workspaceId: "local" })).items).toHaveLength(0);
});

it("resumes persisted diagnostic computation without recreating attempts and reports intentional failure honestly", async () => {
  const file = join(tmpdir(), `cyrene-diagnostic-${crypto.randomUUID()}.sqlite`);
  let stores = new SqliteStoreFactory(file);
  cleanup.push(async () => { await stores.close(); await unlink(file); });
  let store = stores.state("diagnostic-test", diagnosticDatabase, emptyDiagnosticDatabase);
  let now = 1000;
  let adapter = new LocalDiagnosticAdapter(store, () => now);
  const node = diagnosticPipeline("example").nodes[0]; node.config.rounds = 2;
  const assignment = { workspaceId: "local", runId: "run", node, attemptId: "attempt", generation: 1, inputs: {}, placement: { acceleratorCount: 1 }, image: (await adapter.preflight(node, { acceleratorCount: 1 })).image };
  await adapter.start(assignment); now += 1000;
  const first = await adapter.lookup("attempt", "local"); expect(first.state).toBe("running");
  await stores.close(); stores = new SqliteStoreFactory(file);
  store = stores.state("diagnostic-test", diagnosticDatabase, emptyDiagnosticDatabase);
  adapter = new LocalDiagnosticAdapter(store, () => now);
  expect(await adapter.start(assignment)).toEqual(first); now += 1000;
  const final = await adapter.lookup("attempt", "local"); expect(final).toMatchObject({ state: "succeeded", terminalAuthority: true });
  expect(await adapter.stop("attempt", "local")).toEqual(final);
  expect(await adapter.lookup("attempt", "other")).toEqual({ state: "absent", authoritative: true });
  await expect(adapter.start({ ...assignment, generation: 2 })).rejects.toMatchObject({ code: "ATTEMPT_CONFLICT" });
  await adapter.start({ ...assignment, attemptId: "failure", node: { ...node, config: { ...node.config, outcome: "fail" } } });
  now += 1000; await adapter.lookup("failure", "local"); now += 1000;
  expect(await adapter.lookup("failure", "local")).toMatchObject({ state: "failed", terminalAuthority: true, retryable: false });
  expect((await store.read()).attempts).toHaveLength(2);
});

it("rechecks team credentials for every MCP request and token owners can revoke without exposing secrets", async () => {
  const stores = new SqliteStoreFactory(":memory:");
  const app = createControlApplication({ stores, mode: "team", publicOrigins: ["http://127.0.0.1:5180"] });
  await app.ready; await app.team.bootstrap("owner", "long-test-owner-password");
  const session = await app.team.login("owner", "long-test-owner-password");
  const { actor } = await app.team.authenticate(session.token, "browser");
  const issued = await app.team.issueApiToken(actor, ["pipelines.read"]);
  const listed = await app.team.listApiTokens(actor);
  expect(listed).toHaveLength(1); expect(JSON.stringify(listed)).not.toContain(issued.token); expect(JSON.stringify(listed)).not.toContain(issued.csrf);
  expect(await app.team.revokeApiToken(listed[0].id, { ...actor, id: "another-user" })).toEqual({ revoked: false });
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); await stores.close(); });
  const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const client = new Client({ name: "revocation-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/studio-mcp`), { requestInit: { headers: { authorization: `Bearer ${issued.token}` } } }));
  cleanup.push(() => client.close());
  expect((await client.listTools()).tools.every(tool => tool.annotations?.readOnlyHint)).toBe(true);
  await app.team.revokeApiToken(listed[0].id, actor);
  await expect(client.listTools()).rejects.toThrow();
  expect(await app.team.listApiTokens(actor)).toEqual([]);
});
