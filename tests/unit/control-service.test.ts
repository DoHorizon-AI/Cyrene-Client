import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { z } from "zod";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import { createControlApplication } from "../../apps/control/application";
import { examplePipeline } from "../../packages/pipeline-model";
import { RemoteControl } from "../../packages/control-client";
import { importState } from "../../packages/control-storage/migration";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function app(mode: "local" | "team" = "local", file = ":memory:") {
  const stores = new SqliteStoreFactory(file);
  const application = createControlApplication({ stores, mode, publicOrigins: ["http://127.0.0.1:5180"], localApiToken: "test-dedicated-api-token" });
  await application.ready;
  await new Promise<void>(resolve => application.server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { application.server.closeAllConnections(); await new Promise<void>(resolve => application.server.close(() => resolve())); await stores.close(); });
  const origin = `http://127.0.0.1:${(application.server.address() as AddressInfo).port}`;
  const request = (path: string, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const request = httpRequest(origin + path, { method: init.method ?? "GET", headers: { host: "127.0.0.1:5180", ...init.headers as Record<string, string> } }, response => {
      const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value])) })));
    }); request.on("error", reject); request.end(init.body);
  });
  return { ...application, origin, request };
}
describe("independent control service", () => {
  it("shares HTTP state with authenticated MCP remote commands without exposing its API credential", async () => {
    const a = await app();
    const session = await (await a.request("/studio-pipelines/v1/session")).json();
    expect(JSON.stringify(session)).not.toContain("test-dedicated-api-token");
    const response = await a.request("/studio-pipelines/v1/commands", { method: "POST", headers: { "content-type": "application/json", "x-studio-control-token": session.token }, body: JSON.stringify({ name: "pipelines.create", input: { workspaceId: "local", document: examplePipeline() }, requestId: "request-1", idempotencyKey: "create-1" }) });
    expect(response.status).toBe(200);
    const client = new RemoteControl(a.origin, "test-dedicated-api-token");
    const result: any = await client.execute({ name: "pipelines.get", input: { workspaceId: "local", pipelineId: examplePipeline().id }, requestId: "get-1" }, { id: "forged", workspaceIds: [], scopes: [] });
    expect(result.updatedBy).toBe("local-user");
    expect((await a.request("/studio-pipelines/v1/session", { headers: { host: "evil.example" } })).status).toBe(403);
    expect((await a.request("/api%2fv1/yield/training-drafts/x/actions/start")).status).toBe(403);
  });
  it("authenticates individual members, enforces CSRF and limits delegated MCP scopes", async () => {
    const a = await app("team");
    await a.team.bootstrap("owner", "a-long-test-password");
    expect((await a.request("/studio-pipelines/v1/session")).status).toBe(401);
    const login = await a.request("/studio-team/v1/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "a-long-test-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0], session = await login.json();
    const body = JSON.stringify({ username: "reader", password: "reader-long-test-password", workspaceIds: ["local"], roles: ["viewer"] });
    expect((await a.request("/studio-team/v1/members", { method: "POST", headers: { "content-type": "application/json", cookie }, body })).status).toBe(403);
    expect((await a.request("/studio-team/v1/members", { method: "POST", headers: { "content-type": "application/json", cookie, "x-studio-control-token": session.token }, body })).status).toBe(201);
    const readerSession = await a.team.login("reader", "reader-long-test-password"), actor = (await a.team.authenticate(readerSession.token, "browser")).actor;
    await expect(a.team.issueApiToken(actor, ["runs.write"])).rejects.toMatchObject({ code: "FORBIDDEN" });
    const issued = await a.team.issueApiToken(actor, ["pipelines.read"]);
    const remote = new RemoteControl(a.origin, issued.token);
    expect((await remote.session()).scopes).toEqual(["pipelines.read"]);
    const directory = await (await fetch(`${a.origin}/studio-commands/v1/session`, { headers: { authorization: `Bearer ${issued.token}` } })).json();
    expect(directory.commands.some((c: any) => c.name === "builds.start")).toBe(false);
    expect(directory.commands.some((c: any) => c.name === "pipelines.compile")).toBe(true);
    await expect(remote.execute({ name: "pipelines.create", input: { workspaceId: "local", document: examplePipeline() }, requestId: "create", idempotencyKey: "create" }, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await a.team.logout(issued.token);
    await expect(a.team.authenticate(issued.token, "api")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
it("SQLite restart preserves committed state and rolls back failed transactions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-control-")); cleanup.push(() => rm(dir, { recursive: true }));
  const schema = z.object({ count: z.number() }), file = join(dir, "state.sqlite");
  const first = new SqliteStoreFactory(file), store = first.state("counter", schema, () => ({ count: 0 }));
  await store.transact(value => { value.count++; });
  await expect(store.transact(value => { value.count++; throw new Error("interrupted"); })).rejects.toThrow("interrupted");
  await first.close();
  const next = new SqliteStoreFactory(file); cleanup.push(() => next.close());
  const reopened = next.state("counter", schema, () => ({ count: 0 }));
  expect(await reopened.read()).toEqual({ count: 1 });
  await expect(importState(reopened, { count: 2 }, { count: 0 })).rejects.toMatchObject({ code: "MIGRATION_TARGET_NOT_EMPTY" });
  expect(await importState(reopened, { count: 1 }, { count: 0 })).toBe("already-imported");
});
