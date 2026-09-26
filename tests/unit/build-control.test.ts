import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zipSync, strToU8 } from "fflate";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStateStore } from "../../packages/control-storage";
import { BuildControl } from "../../packages/build-control/service";
import { buildProfile, buildDatabase, emptyBuildDatabase, type Build, type BuildResult } from "../../packages/build-control/contracts";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import type { BuildAdapter, BuildObservation } from "../../packages/build-control/adapter";
import { GitHubBuildAdapter } from "../../packages/build-control/github";
import { NodeRegistry, emptyCatalogDatabase } from "../../packages/node-registry/service";
import { getDefinition } from "../../packages/pipeline-model/catalog";
import { createMcpServer } from "../../apps/mcp/server";

const sha = "a".repeat(40), image = `ghcr.io/example/node@sha256:${"b".repeat(64)}`;
const profile = buildProfile.parse({ id: "training", title: "Training", workspaceIds: ["local"], owner: "example", repository: "nodes", workflow: "studio-node-build.yml", workflowRef: "develop", sourceRefs: ["develop"], imageRepository: "ghcr.io/example/node", packageId: "training" });
const actor = { id: "editor", workspaceIds: ["local"], scopes: ["builds.read", "builds.write", "pipelines.read", "catalog.write"] };
const input = { workspaceId: "local", profileId: "training", sourceRef: "develop" };
function result(build: Build, version = "1"): BuildResult {
  return { schemaVersion: "cyrene.studio.build-result.v1", buildId: build.id, profileId: profile.id, sourceRepository: "example/nodes", sourceSha: build.sourceSha, workflowRunId: "123", image, provenance: { workflowSha: build.workflowSha, dependencyDigests: { "uv.lock": `sha256:${"d".repeat(64)}` } },
    package: { schemaVersion: "cyrene.studio.nodes.v1", id: "training", version, nodes: [{ type: "custom.trainer", version, title: "Trainer", owner: "Example", category: "Training", description: "Training node", color: "#abcdef", fields: [], defaults: {}, inputs: [], outputs: [], execution: { kind: "task", adapter: "yield", image, mutableFields: [], checkpoint: false } }] } };
}
function fixture() {
  const store = new MemoryStateStore(emptyBuildDatabase());
  let observed: BuildObservation | null = null;
  const adapter: BuildAdapter = { resolve: vi.fn(async () => sha), dispatch: vi.fn(async () => ({ runId: "123", url: "https://github.com/example/nodes/actions/runs/123" })), observe: vi.fn(async () => observed), cancel: vi.fn(async () => {}) };
  const control = new BuildControl(store, [profile], adapter);
  const call = (name: string, data: unknown, key: string = crypto.randomUUID(), identity = actor) => control.execute({ name, input: data, requestId: crypto.randomUUID(), idempotencyKey: key }, identity) as Promise<any>;
  const start = async () => { const preview = await call("builds.preview", input); return await call("builds.start", { ...input, expectedFingerprint: preview.fingerprint }, "start") as Build; };
  const finish = async (build: Build, payload = result(build)) => { observed = { runId: "123", url: "https://github.com/example/nodes/actions/runs/123", state: "succeeded", result: payload, message: "Verified" }; await control.tick(); };
  return { store, control, adapter, call, start, finish };
}
describe("durable build intent", () => {
  it("retains unknown dispatch and idempotency receipts after closing and reopening SQLite", async () => {
    const root = await mkdtemp(join(tmpdir(), "studio-build-restart-"));
    let factory = new SqliteStoreFactory(join(root, "control.sqlite"));
    const f = fixture(); vi.mocked(f.adapter.dispatch).mockRejectedValue(new Error("lost reply"));
    try {
      let control = new BuildControl(factory.state("builds", buildDatabase, emptyBuildDatabase), [profile], f.adapter);
      const preview: any = await control.execute({ name: "builds.preview", input, requestId: "preview" }, actor);
      const request = { name: "builds.start", input: { ...input, expectedFingerprint: preview.fingerprint }, requestId: "start", idempotencyKey: "persisted-start" };
      const first: any = await control.execute(request, actor); await control.tick(); await factory.close();
      factory = new SqliteStoreFactory(join(root, "control.sqlite"));
      control = new BuildControl(factory.state("builds", buildDatabase, emptyBuildDatabase), [profile], f.adapter);
      expect(await control.execute(request, actor)).toMatchObject({ id: first.id, state: "unknown" });
      await control.tick(); expect(f.adapter.dispatch).toHaveBeenCalledTimes(1);
    } finally { await factory.close(); await rm(root, { recursive: true, force: true }); }
  });
  it("reconciles a lost dispatch response across restart without creating a second workflow", async () => {
    const f = fixture(), build = await f.start();
    vi.mocked(f.adapter.dispatch).mockRejectedValueOnce(new Error("response lost after accepted"));
    await f.control.tick(); expect((await f.store.read()).builds[0].state).toBe("unknown");
    const restarted = new BuildControl(f.store, [profile], f.adapter);
    await restarted.tick(); await restarted.tick();
    expect(f.adapter.dispatch).toHaveBeenCalledTimes(1);
    await f.finish(build); expect((await f.control.verifiedResult(build.id, "local")).image).toBe(image);
    const preview = await f.call("builds.preview", input);
    expect((await f.call("builds.start", { ...input, expectedFingerprint: preview.fingerprint }, "start")).id).toBe(build.id);
    expect((await f.store.read()).builds).toHaveLength(1);
  });
  it("claims dispatch once even when two coordinators tick together", async () => {
    const f = fixture(); await f.start();
    await Promise.all([f.control.tick(), new BuildControl(f.store, [profile], f.adapter).tick()]);
    expect(f.adapter.dispatch).toHaveBeenCalledTimes(1);
  });
  it("rejects moved refs, unauthorized workspaces and read-only actors before dispatch", async () => {
    const f = fixture(), preview = await f.call("builds.preview", input);
    vi.mocked(f.adapter.resolve).mockResolvedValue("c".repeat(40));
    await expect(f.call("builds.start", { ...input, expectedFingerprint: preview.fingerprint })).rejects.toMatchObject({ code: "BUILD_PREVIEW_STALE" });
    await expect(f.call("builds.start", { ...input, expectedFingerprint: preview.fingerprint }, "reader", { ...actor, scopes: ["builds.read"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.call("builds.list", { workspaceId: "other" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.adapter.dispatch).not.toHaveBeenCalled();
  });
  it.each(["source", "image", "package", "run"])("rejects an otherwise successful build with mismatched %s", async mismatch => {
    const f = fixture(), build = await f.start(); await f.control.tick();
    const payload = result(build);
    if (mismatch === "source") payload.sourceSha = "c".repeat(40);
    if (mismatch === "image") payload.package.nodes[0].execution.image = image.replace("example", "intruder");
    if (mismatch === "package") payload.package.id = "unapproved";
    if (mismatch === "run") payload.workflowRunId = "124";
    await f.finish(build, payload);
    expect((await f.store.read()).builds[0].state).toBe("failed");
    await expect(f.control.verifiedResult(build.id, "local")).rejects.toMatchObject({ code: "BUILD_NOT_VERIFIED" });
  });
  it("cancels a queued build without dispatch and preserves completed success during cancellation", async () => {
    const f = fixture(), build = await f.start();
    await f.call("builds.cancel", { workspaceId: "local", buildId: build.id, expectedRevision: 1 }); await f.control.tick();
    expect(f.adapter.dispatch).not.toHaveBeenCalled();
    expect((await f.store.read()).builds[0].state).toBe("cancelled");
    const second = fixture(), next = await second.start(); await second.control.tick();
    await second.call("builds.cancel", { workspaceId: "local", buildId: next.id, expectedRevision: (await second.store.read()).builds[0].revision });
    await second.finish(next); expect((await second.store.read()).builds[0].state).toBe("succeeded");
  });
});
it("requires explicit activation, rejects stale previews and retains pinned old types", async () => {
  const f = fixture(), build = await f.start(); await f.control.tick(); await f.finish(build);
  const store = new MemoryStateStore(emptyCatalogDatabase());
  const registry = new NodeRegistry(store, async () => [], (id, workspace) => f.control.verifiedResult(id, workspace));
  const call = (name: string, input: unknown, key: string = crypto.randomUUID()) => registry.execute({ name, input, requestId: crypto.randomUUID(), idempotencyKey: key }, actor) as Promise<any>;
  expect((await store.read()).active).toEqual([]);
  const input = { workspaceId: "local", buildId: build.id, expectedRevision: 0 }, preview = await call("catalog.preview_activation", input);
  const activation = { ...input, expectedFingerprint: preview.fingerprint };
  await call("catalog.activate", activation, "activate");
  expect((await call("catalog.activate", activation, "activate")).revision).toBe(1);
  await expect(call("catalog.activate", activation)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  const second = new NodeRegistry(store, async () => [], async () => result(build, "2"));
  const preview2: any = await second.execute({ name: "catalog.preview_activation", input: { ...input, expectedRevision: 1 }, requestId: "p2" }, actor);
  await second.execute({ name: "catalog.activate", input: { ...input, expectedRevision: 1, expectedFingerprint: preview2.fingerprint }, requestId: "a2", idempotencyKey: "a2" }, actor);
  expect((await store.read()).active).toEqual(["training@2"]);
  expect(getDefinition("custom.trainer")?.version).toBe("2"); expect(getDefinition("custom.trainer", "1")?.version).toBe("1");
});
it("MCP calls share build identities and omit unauthorized writes", async () => {
  const f = fixture(), unused = { execute: async () => ({ items: [] }) };
  const server = createMcpServer(unused, actor, undefined, { builds: f.control }), client = new Client({ name: "build-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  try {
    const preview = await client.callTool({ name: "builds.preview", arguments: input });
    const started = await client.callTool({ name: "builds.start", arguments: { ...input, expectedFingerprint: (preview.structuredContent as any).fingerprint, idempotencyKey: "mcp-start" } });
    expect(started.isError).not.toBe(true);
    expect((await f.call("builds.list", { workspaceId: "local" })).items[0].id).toBe((started.structuredContent as any).id);
  } finally { await client.close(); await server.close(); }
  const reader = createMcpServer(unused, { ...actor, scopes: ["builds.read"] }, undefined, { builds: f.control });
  const client2 = new Client({ name: "reader", version: "1" }), [c, d] = InMemoryTransport.createLinkedPair(); await reader.connect(c); await client2.connect(d);
  try { expect((await client2.listTools()).tools.map(t => t.name)).not.toContain("builds.start"); } finally { await client2.close(); await reader.close(); }
});
it("verifies GitHub workflow identity and ZIP digest without forwarding credentials to artifact storage", async () => {
  const f = fixture(), build = await f.start(); build.workflowRunId = "123";
  const zip = zipSync({ "build-result.json": strToU8(JSON.stringify(result(build))) });
  const run = { id: 123, event: "workflow_dispatch", display_title: `studio-build:${build.id}`, repository: { full_name: "example/nodes" }, head_sha: sha, path: `.github/workflows/${profile.workflow}`, status: "completed", conclusion: "success" };
  let badDigest = false;
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path === "https://artifact.example/signed.zip") { expect(init?.headers).toBeUndefined(); return new Response(Buffer.from(zip)); }
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-token");
    if (path.endsWith("/123")) return Response.json(run);
    if (path.includes("/artifacts?")) return Response.json({ artifacts: [{ id: 9, name: `studio-result-${build.id}`, size_in_bytes: zip.length, digest: `sha256:${badDigest ? "0".repeat(64) : createHash("sha256").update(zip).digest("hex")}` }] });
    return new Response(null, { status: 302, headers: { location: "https://artifact.example/signed.zip" } });
  });
  const adapter = new GitHubBuildAdapter(() => "private-token", transport as typeof fetch);
  expect((await adapter.observe(build))?.state).toBe("succeeded");
  badDigest = true; await expect(adapter.observe(build)).rejects.toMatchObject({ code: "BUILD_RESULT_INVALID" });
  run.head_sha = "c".repeat(40); await expect(adapter.observe(build)).rejects.toMatchObject({ code: "BUILD_RESULT_INVALID" });
});
