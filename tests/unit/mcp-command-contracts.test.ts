import { afterEach, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMcpServer } from "../../apps/mcp/server";
import { registerCommand } from "../../apps/mcp/register-command";
import { createControlApplication } from "../../apps/control/application";
import { allCommandDefinitions, permittedCommands, wireToolName } from "../../packages/control-client/commands";
import { ControlError } from "../../packages/server-control/contracts";
import { MemoryStateStore } from "../../packages/control-storage";
import { PipelineControl, emptyPipelineDatabase } from "../../packages/pipeline-control/service";
import { diagnosticPipeline } from "../../packages/local-diagnostics/definition";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import { buildProfile, emptyBuildDatabase, type Build } from "../../packages/build-control/contracts";
import { BuildControl } from "../../packages/build-control/service";
import { NodeRegistry, emptyCatalogDatabase } from "../../packages/node-registry/service";
import type { BuildAdapter } from "../../packages/build-control/adapter";

const actor = { id: "review", workspaceIds: ["local"], scopes: ["pipelines.read", "pipelines.write", "runs.read", "runs.write", "builds.read", "builds.write", "catalog.write", "servers.read", "servers.write"] };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function linked(server: McpServer) {
  const client = new Client({ name: "mcp-contract-test", version: "1" }), [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  cleanup.push(async () => { await client.close(); await server.close(); });
  return client;
}
function error(result: any) { expect(result.isError).toBe(true); return JSON.parse(result.content[0].text); }
async function http() {
  const stores = new SqliteStoreFactory(":memory:");
  const app = createControlApplication({ stores, mode: "local", localDiagnostics: true, localApiToken: "mcp-contract-token", publicOrigins: ["http://127.0.0.1:5180"] });
  await app.ready; await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); await stores.close(); });
  const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const client = new Client({ name: "http-contract-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/studio-mcp`), { requestInit: { headers: { authorization: "Bearer mcp-contract-token" } } }));
  cleanup.push(() => client.close());
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name: wireToolName(name), arguments: args });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true); return result.structuredContent as any;
  };
  return { app, client, call, origin };
}

it("discovers unique portable names, dotted titles, formal schemas and effect annotations over real HTTP", async () => {
  const { client, origin } = await http();
  const { tools } = await client.listTools();
  expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
  expect(tools).toHaveLength(Object.keys(allCommandDefinitions).length);
  for (const tool of tools) {
    expect(tool.name).toMatch(/^[a-z0-9_]{1,64}$/);
    const definition = allCommandDefinitions[tool.title as keyof typeof allCommandDefinitions];
    expect(definition).toBeDefined(); expect(tool.name).toBe(wireToolName(tool.title!));
    expect(tool.description).toBe(definition.description); expect(tool.description?.trim()).toBeTruthy();
    expect(tool.annotations).toMatchObject({ readOnlyHint: definition.readOnly, destructiveHint: definition.effects === "destructive", idempotentHint: true, openWorldHint: definition.external });
    const properties = tool.inputSchema.properties as Record<string, any>;
    if (!definition.readOnly) expect(properties.idempotencyKey.description).toContain("SAME key and SAME parameters");
    for (const [field, schema] of Object.entries(properties)) if (field.startsWith("expected") || field === "after") expect(schema.description).toBeTruthy();
  }
  expect(tools.find(tool => tool.name === "nodes_list_types")?.outputSchema).toMatchObject({ properties: { items: { items: { properties: { type: {}, version: {}, active: {}, configSchema: {}, defaults: {}, inputs: {}, outputs: {} } } } } });
  const nodes = await client.callTool({ name: "nodes_list_types", arguments: { workspaceId: "local" } });
  expect(nodes.isError).not.toBe(true);
  expect((nodes.structuredContent as any).items.find((node: any) => node.type === "compute")).toMatchObject({ active: true, title: "算力配置", defaults: { count: 1 } });
  const guide = await client.readResource({ uri: "cyrene://guide" });
  expect(JSON.stringify(guide)).toContain("IDEMPOTENCY_CONFLICT"); expect(JSON.stringify(guide)).toContain("unknown");
  const response = await fetch(`${origin}/studio-commands/v1/session`, { headers: { authorization: "Bearer mcp-contract-token" } });
  const session = await response.json();
  expect(session.commands.filter((command: any) => !command.name.startsWith("updates.")).map((command: any) => command.name).sort()).toEqual(tools.map(tool => tool.title).sort());
  expect(tools.some(tool => tool.name.startsWith("updates_"))).toBe(false);
});

it("filters every required scope and fails closed for unlisted or foreign-workspace calls", async () => {
  const unused = { execute: vi.fn(async () => ({})) };
  const reader = { ...actor, scopes: ["runs.read"] };
  expect(permittedCommands(reader)).not.toContain("runs.preflight");
  expect(permittedCommands(reader)).not.toContain("monitoring.snapshot");
  const client = await linked(createMcpServer(unused, reader, unused, { monitoring: unused }));
  expect((await client.listTools()).tools.some(tool => tool.name === "runs_preflight")).toBe(false);
  expect(error(await client.callTool({ name: "runs_preflight", arguments: {} }))).toMatchObject({ code: "UNKNOWN_COMMAND", outcome: "rejected", retryable: false });
  expect(error(await client.callTool({ name: "runs_get", arguments: { workspaceId: "other", runId: "run" } }))).toMatchObject({ code: "FORBIDDEN", outcome: "rejected" });
  expect(unused.execute).not.toHaveBeenCalled();
});

it("rejects tool name collisions and invalid wire names before startup", () => {
  const server = new McpServer({ name: "collision", version: "1" });
  const definition = { input: z.object({ workspaceId: z.string() }), output: z.object({}), description: "Test command", readOnly: true, requiredScopes: [], effects: "read" as const, external: false };
  const executor = { execute: async () => ({}) };
  registerCommand(server, "test.dot", definition, executor, actor);
  expect(() => registerCommand(server, "test_dot", definition, executor, actor)).toThrow("Duplicate MCP tool name");
  expect(() => registerCommand(server, "Test.invalid", definition, executor, actor)).toThrow("Invalid MCP tool name");
});

it("returns rejected input errors before executor calls and unknown output errors after a committed write", async () => {
  const store = new MemoryStateStore(emptyPipelineDatabase()), pipelines = new PipelineControl(store);
  let invalidOutput = true;
  const execute = vi.fn(async (raw: unknown, identity: typeof actor) => {
    const result = await pipelines.execute(raw, identity); return invalidOutput ? { record: null } : result;
  });
  const client = await linked(createMcpServer({ execute }, actor));
  const invalid = error(await client.callTool({ name: "pipelines_create", arguments: { workspaceId: "local" } }));
  expect(invalid).toMatchObject({ code: "INVALID_INPUT", outcome: "rejected", retryable: false });
  expect(invalid.requestId).toMatch(/^[a-f0-9-]{36}$/); expect(execute).not.toHaveBeenCalled();
  const args = { workspaceId: "local", document: diagnosticPipeline("output-write"), idempotencyKey: "original-key" };
  const unknown = error(await client.callTool({ name: "pipelines_create", arguments: args }));
  expect(unknown).toMatchObject({ outcome: "unknown", retryable: true, recovery: { readTools: ["pipelines_get", "pipelines_list"] } });
  expect(unknown.recovery.action).toContain("original idempotency key AND parameters");
  expect(unknown.requestId).toBe((execute.mock.calls[0][0] as any).requestId);
  expect((await store.read()).records).toHaveLength(1);
  invalidOutput = false;
  expect((await client.callTool({ name: "pipelines_create", arguments: args })).structuredContent).toMatchObject({ record: { graphRevision: 1 } });
  expect((await store.read()).records).toHaveLength(1);
  const conflict = error(await client.callTool({ name: "pipelines_create", arguments: { ...args, document: { ...args.document, name: "Changed intent" } } }));
  expect(conflict).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", outcome: "rejected", retryable: false });
});

it("uses the same error envelope for actual server writes, revision conflict and receipt conflict over HTTP", async () => {
  const f = await http();
  const spec = { name: "review server", attachment: "HOST_AGENT", provider: "local", region: "local", connectionRef: "fixture" };
  const args = { workspaceId: "local", spec, idempotencyKey: "register" };
  const server = await f.call("servers.register", args);
  expect((await f.call("servers.register", args)).id).toBe(server.id);
  expect(error(await f.client.callTool({ name: "servers_register", arguments: { ...args, spec: { ...spec, name: "other" } } }))).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", outcome: "rejected" });
  await f.call("servers.update", { workspaceId: "local", serverId: server.id, expectedRevision: 1, spec: { ...spec, name: "updated" }, idempotencyKey: "update" });
  expect(error(await f.client.callTool({ name: "servers_archive", arguments: { workspaceId: "local", serverId: server.id, expectedRevision: 1, idempotencyKey: "stale" } }))).toMatchObject({ code: "REVISION_CONFLICT", outcome: "rejected", retryable: false });
  const audit = await f.call("servers.events", { workspaceId: "local" });
  expect(audit.items).toHaveLength(2); expect(audit.items.every((event: any) => event.requestId)).toBe(true);
  expect((await f.call("servers.events", { workspaceId: "local", after: audit.nextCursor })).items).toHaveLength(0);
});

it("returns existingRunId for duplicate active intents, replays original keys and allows terminal restart", async () => {
  const f = await http();
  const document = diagnosticPipeline("duplicate-run");
  await f.call("pipelines.create", { workspaceId: "local", document, idempotencyKey: "create" });
  const input = { workspaceId: "local", pipelineId: document.id, expectedGraphRevision: 1 };
  const preview = await f.call("runs.preflight", input);
  const args = { ...input, expectedFingerprint: preview.fingerprint, idempotencyKey: "first-start" };
  const run = await f.call("runs.start", args);
  const duplicates = await Promise.all(["second-start", "third-start"].map(idempotencyKey => f.client.callTool({ name: "runs_start", arguments: { ...args, idempotencyKey } })));
  for (const result of duplicates) expect(error(result)).toMatchObject({ code: "DUPLICATE_ACTIVE_RUN", outcome: "rejected", details: { existingRunId: run.id } });
  expect((await f.call("runs.list", { workspaceId: "local" })).items).toHaveLength(1);
  await f.call("runs.stop", { workspaceId: "local", runId: run.id, expectedRevision: run.revision, idempotencyKey: "stop" });
  await f.app.runs.tick();
  expect((await f.call("runs.get", { workspaceId: "local", runId: run.id })).state).toBe("stopped");
  const next = await f.call("runs.start", { ...args, idempotencyKey: "terminal-restart" }); expect(next.id).not.toBe(run.id);
  expect((await f.call("runs.start", args)).id).toBe(run.id);
});

it("runs actual build/catalog tools with duplicate guards, revisions and receipt conflicts", async () => {
  const profile = buildProfile.parse({ id: "contract", title: "Contract build", workspaceIds: ["local"], owner: "example", repository: "nodes", workflow: "build.yml", workflowRef: "develop", sourceRefs: ["develop"], imageRepository: "ghcr.io/example/contract", packageId: "mcp-contract" });
  const sha = "a".repeat(40), image = `ghcr.io/example/contract@sha256:${"b".repeat(64)}`;
  let now = Date.now();
  const payload = (build: Build) => ({ schemaVersion: "cyrene.studio.build-result.v1" as const, buildId: build.id, profileId: profile.id, sourceRepository: "example/nodes", sourceSha: sha, workflowRunId: "123", image,
    provenance: { workflowSha: sha, dependencyDigests: { "lock.json": `sha256:${"c".repeat(64)}` } },
    package: { schemaVersion: "cyrene.studio.nodes.v1" as const, id: "mcp-contract", version: "1", nodes: [{ type: "mcp-contract.task", version: "1", title: "Contract task", owner: "Fixture", category: "Test", description: "MCP fixture only", color: "#abcdef", inputs: [], outputs: [], fields: [], defaults: {}, execution: { kind: "task" as const, adapter: "fixture", image, mutableFields: [], checkpoint: false } }] } });
  const adapter: BuildAdapter = { resolve: async () => sha, dispatch: vi.fn(async () => ({ runId: "123", url: "https://github.com/example/nodes/actions/runs/123" })), cancel: async () => {}, observe: async build => ({ state: "succeeded", runId: "123", url: "https://github.com/example/nodes/actions/runs/123", message: "verified", result: payload(build) }) };
  const builds = new BuildControl(new MemoryStateStore(emptyBuildDatabase()), [profile], adapter, () => now);
  const catalog = new NodeRegistry(new MemoryStateStore(emptyCatalogDatabase()), async () => [], (id, workspace) => builds.verifiedResult(id, workspace));
  const client = await linked(createMcpServer({ execute: async () => ({}) }, actor, undefined, { builds, catalog }));
  const call = async (name: string, args: any): Promise<any> => { const response = await client.callTool({ name: wireToolName(name), arguments: args }); expect(response.isError, JSON.stringify(response.content)).not.toBe(true); return response.structuredContent; };
  const input = { workspaceId: "local", profileId: profile.id, sourceRef: "develop" };
  const preview = await call("builds.preview", input);
  const args = { ...input, expectedFingerprint: preview.fingerprint, idempotencyKey: "start" };
  const build = await call("builds.start", args);
  expect((await call("builds.start", args)).id).toBe(build.id);
  expect(error(await client.callTool({ name: "builds_start", arguments: { ...args, idempotencyKey: "duplicate" } }))).toMatchObject({ code: "DUPLICATE_ACTIVE_BUILD", outcome: "rejected", details: { existingBuildId: build.id } });
  expect(error(await client.callTool({ name: "builds_start", arguments: { ...args, sourceRef: "other" } }))).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", outcome: "rejected" });
  await builds.tick(); now += 15_000; await builds.tick(); expect(adapter.dispatch).toHaveBeenCalledTimes(1);
  const activation = { workspaceId: "local", buildId: build.id, expectedRevision: 0 };
  const planned = await call("catalog.preview_activation", activation);
  const activate = { ...activation, expectedFingerprint: planned.fingerprint, idempotencyKey: "activate" };
  expect(await call("catalog.activate", activate)).toMatchObject({ revision: 1, packageId: "mcp-contract" });
  expect(await call("catalog.activate", activate)).toMatchObject({ revision: 1 });
  expect(error(await client.callTool({ name: "catalog_activate", arguments: { ...activate, expectedFingerprint: "d".repeat(64) } }))).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", outcome: "rejected" });
  expect(error(await client.callTool({ name: "catalog_activate", arguments: { ...activate, idempotencyKey: "stale" } }))).toMatchObject({ code: "REVISION_CONFLICT", outcome: "rejected" });
  expect((await call("catalog.list_packages", { workspaceId: "local" })).active).toContain("mcp-contract@1");
  expect((await call("builds.start", { ...args, idempotencyKey: "terminal-new" })).id).not.toBe(build.id);
});

it("classifies unexpected executor failures as unknown across all command groups", async () => {
  const failure = { execute: async () => { throw new Error("private upstream details"); } };
  const client = await linked(createMcpServer(failure, actor, failure, { monitoring: failure, builds: failure, catalog: failure, servers: failure }));
  for (const [name, args] of [["servers_list", { workspaceId: "local" }], ["builds_list", { workspaceId: "local" }], ["catalog_list_packages", { workspaceId: "local" }]]) {
    const result = error(await client.callTool({ name: name as string, arguments: args as Record<string, unknown> }));
    expect(result).toMatchObject({ outcome: "unknown", retryable: true }); expect(JSON.stringify(result)).not.toContain("private upstream details"); expect(result.requestId).toBeTruthy();
  }
  const controlled = await linked(createMcpServer({ execute: async () => { throw new ControlError("FORBIDDEN", "Denied", 403); } }, actor));
  expect(error(await controlled.callTool({ name: "pipelines_list", arguments: { workspaceId: "local" } }))).toMatchObject({ code: "FORBIDDEN", outcome: "rejected" });
});
