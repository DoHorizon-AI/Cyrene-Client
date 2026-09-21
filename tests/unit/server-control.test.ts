import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { ServerControl, type ServerObserver } from "../../packages/server-control/service";
import { FileRegistryStore } from "../../tooling/server-store";
import { controlMiddleware } from "../../tooling/server-control";
import { type Actor, type Observation, type ServerRecord } from "../../packages/server-control/contracts";
import { examplePipeline, parsePipeline } from "../../packages/pipeline-model";

const actor: Actor = { id: "tester", workspaceIds: ["local"], scopes: ["servers.read", "servers.write"] };
const spec = { name: "Office GPU", attachment: "HOST_AGENT", provider: "self-managed", region: "office", connectionRef: "office-01" };
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function fixture(observers?: Map<string, ServerObserver>) {
  const folder = await mkdtemp(join(tmpdir(), "cyrene-control-test-")); folders.push(folder);
  const path = join(folder, "registry.json"), store = new FileRegistryStore(path);
  return { path, store, control: new ServerControl(store, observers) };
}
function request(name: string, input: object, key?: string) { return { name, input, requestId: crypto.randomUUID(), ...(key ? { idempotencyKey: key } : {}) }; }
const register = (control: ServerControl, key = "registration-1") => control.execute(request("servers.register", { workspaceId: "local", spec }, key), actor) as Promise<ServerRecord>;

describe("transport-independent server control", () => {
  it("persists registration and idempotency receipts across service recreation", async () => {
    const { path, control, store } = await fixture();
    const first = await register(control);
    const second = await register(new ServerControl(new FileRegistryStore(path)));
    expect(second).toEqual(first);
    expect((await store.read()).events).toHaveLength(1);
    expect((await store.read()).events[0]).toMatchObject({ actorId: "tester", serverId: first.id, revision: 1 });
  });
  it("rejects a reused key with a different payload", async () => {
    const { control } = await fixture(); await register(control);
    await expect(control.execute(request("servers.register", { workspaceId: "local", spec: { ...spec, name: "Different" } }, "registration-1"), actor)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("checks scopes and workspace before reading or deduplicating", async () => {
    const { control } = await fixture(); await register(control);
    await expect(control.execute(request("servers.list", { workspaceId: "another" }), actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(control.execute(request("servers.register", { workspaceId: "local", spec }, "registration-1"), { ...actor, scopes: ["servers.read"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(control.execute(request("servers.register", { workspaceId: "local", spec }), actor)).rejects.toMatchObject({ code: "IDEMPOTENCY_REQUIRED" });
  });
  it("rejects secret fields, arbitrary commands and client-supplied actor identity", async () => {
    const { control } = await fixture();
    for (const body of [
      request("servers.register", { workspaceId: "local", spec: { ...spec, sshPassword: "never-store" } }, "x"),
      request("servers.register", { workspaceId: "local", spec: { ...spec, connectionRef: "https://host/?token=secret" } }, "x"),
      request("servers.shell", { workspaceId: "local", command: "echo" }),
      { ...request("servers.list", { workspaceId: "local" }), actor: "admin" },
    ]) await expect(control.execute(body, actor)).rejects.toThrow();
  });
  it("prevents stale updates and archives only metadata", async () => {
    const { control, store } = await fixture(); const first = await register(control);
    const target = { workspaceId: "local", serverId: first.id, expectedRevision: 1 };
    await control.execute(request("servers.update", { ...target, spec: { ...spec, name: "Renamed" } }, "edit"), actor);
    await expect(control.execute(request("servers.archive", target, "stale"), actor)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await control.execute(request("servers.archive", { ...target, expectedRevision: 2 }, "archive"), actor);
    expect((await store.read()).servers[0]).toMatchObject({ name: "Renamed", archived: true, revision: 3 });
    expect((await store.read()).events).toHaveLength(3);
    await expect(control.execute(request("servers.update", { ...target, expectedRevision: 3, spec }, "after-archive"), actor)).rejects.toMatchObject({ code: "ARCHIVED" });
  });
  it("isolates resource identities across workspaces", async () => {
    const { control } = await fixture(); const first = await register(control);
    await expect(control.execute(request("servers.status", { workspaceId: "other", serverId: first.id }), { ...actor, workspaceIds: ["other"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await control.execute(request("servers.list", { workspaceId: "other" }), { ...actor, workspaceIds: ["other"] })).toEqual({ items: [] });
  });
  it("reports unconnected without inventing node identities or metrics", async () => {
    const { control } = await fixture(); const first = await register(control);
    expect(await control.execute(request("servers.status", { workspaceId: "local", serverId: first.id }), actor)).toMatchObject({ state: "UNCONNECTED", nodeRef: null, observedAt: null, capabilities: [] });
  });
  it("validates observer identity and treats stale telemetry as unavailable", async () => {
    let value: Observation;
    const { control } = await fixture(new Map([["office-01", { read: async () => value }]]));
    const first = await register(control);
    const read = () => control.execute(request("servers.status", { workspaceId: "local", serverId: first.id }), actor);
    value = { serverId: first.id, state: "ONLINE", observedAt: new Date().toISOString(), nodeRef: { nodeId: "node-01", epoch: "9007199254740993" }, capabilities: ["inventory.read"], message: "connected" };
    expect(await read()).toMatchObject({ state: "ONLINE" });
    value.observedAt = new Date(Date.now() - 61_000).toISOString();
    expect(await read()).toMatchObject({ state: "STALE", capabilities: [] });
    value.serverId = "another";
    await expect(read()).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
  });
  it("retains event cursors and excludes failed commands", async () => {
    const { control } = await fixture(); const first = await register(control);
    await control.execute(request("servers.archive", { workspaceId: "local", serverId: first.id, expectedRevision: 1 }, "archive"), actor);
    expect(await control.execute(request("servers.events", { workspaceId: "local", after: 1 }), actor)).toMatchObject({ items: [{ sequence: 2, command: "servers.archive" }], nextCursor: 2 });
  });
  it("roundtrips compute target refs without leaking connection details", async () => {
    const p = examplePipeline(); p.nodes.find(n => n.type === "compute")!.settingsBinding = { kind: "server-registration", resourceId: "registration-id", workspaceId: "local" };
    expect(parsePipeline(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it("refuses corrupt stores and competing writes without resetting data", async () => {
    const { path, control } = await fixture();
    await writeFile(path, "corrupt"); await expect(register(control)).rejects.toThrow(); expect(await readFile(path, "utf8")).toBe("corrupt");
    await writeFile(`${path}.lock`, "active"); await expect(register(control)).rejects.toMatchObject({ code: "STORE_BUSY" });
  });
});

it("uses a real local HTTP boundary with CSRF, actor enforcement and persistence", async () => {
  const { control, store } = await fixture();
  const middleware = controlMiddleware(control);
  const server = createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number }, origin = `http://127.0.0.1:${address.port}`;
  try {
    expect((await fetch(`${origin}/studio-control/v1/session`, { headers: { origin: "https://external.example" } })).status).toBe(403);
    const { token } = await (await fetch(`${origin}/studio-control/v1/session`)).json();
    const call = (body: unknown, auth = token) => fetch(`${origin}/studio-control/v1/commands`, { method: "POST", headers: { origin, "content-type": "application/json", "x-studio-control-token": auth }, body: JSON.stringify(body) });
    expect((await call(request("servers.list", { workspaceId: "local" }), "wrong")).status).toBe(403);
    expect((await call(request("servers.list", { workspaceId: "other" }))).status).toBe(403);
    expect((await call(request("servers.register", { workspaceId: "local", spec }, "http-test"))).status).toBe(200);
    expect((await store.read()).events[0].actorId).toBe("local-user");
    expect((await call(request("servers.list", { workspaceId: "local" }))).status).toBe(200);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
