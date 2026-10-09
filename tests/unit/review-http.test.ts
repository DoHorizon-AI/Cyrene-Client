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
import { controlListener } from "../../apps/control/listener";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function app(mode: "local" | "team" = "local", file = ":memory:", publicOrigins = ["http://127.0.0.1:5180"]) {
  const stores = new SqliteStoreFactory(file);
  const application = createControlApplication({ stores, mode, publicOrigins, localApiToken: "test-dedicated-api-token" });
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
  it("uses Secure cookies for the HTTPS origin in a mixed-origin deployment", async () => {
    const a = await app("team", ":memory:", ["https://studio.example", "http://127.0.0.1:5180"]);
    await a.team.bootstrap("owner", "a-long-test-password");
    const result = await a.request("/studio-team/v1/login", { method: "POST", headers: { host: "studio.example", origin: "https://studio.example", "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "a-long-test-password" }) });
    expect(result.status).toBe(200); expect(result.headers.get("set-cookie")).toContain("; Secure");
  });
  it("does not grant instance catalog rights to a workspace administrator", async () => {
    const a = await app("team"); await a.team.bootstrap("owner", "a-long-test-password");
    const owner = await a.team.authenticate((await a.team.login("owner", "a-long-test-password")).token, "browser");
    expect(owner.actor.scopes).toContain("catalog.write");
    await a.team.createMember({ username: "admin", password: "admin-long-password", workspaceIds: ["local"], roles: ["admin"] }, owner.actor);
    const member = await a.team.authenticate((await a.team.login("admin", "admin-long-password")).token, "browser");
    expect(member.actor.scopes).not.toContain("catalog.write");
    await expect(a.team.issueApiToken(member, ["catalog.write"])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps token management browser-only at both HTTP and service boundaries", async () => {
    const a = await app("team"); await a.team.bootstrap("owner", "a-long-test-password");
    const login = await a.request("/studio-team/v1/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: "a-long-test-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0], session = await login.json();
    const headers = { cookie, "content-type": "application/json", "x-studio-control-token": session.token };
    const created = await a.request("/studio-team/v1/tokens", { method: "POST", headers, body: JSON.stringify({ scopes: ["pipelines.read"] }) });
    expect(created.status).toBe(201); const issued = await created.json();
    const listing = await a.request("/studio-team/v1/tokens", { headers }); expect(listing.status).toBe(200);
    const id = (await listing.json()).items[0].id;
    const bearer = { "content-type": "application/json", authorization: `Bearer ${issued.token}` };
    for (const [path, method, body] of [["tokens", "GET", undefined], ["tokens", "POST", { scopes: ["pipelines.read"] }], ["tokens/revoke", "POST", { id }]] as const) {
      expect((await a.request(`/studio-team/v1/${path}`, { method, headers: bearer, ...(body ? { body: JSON.stringify(body) } : {}) })).status).toBe(403);
    }
    const apiContext = await a.team.authenticate(issued.token, "api");
    await expect(a.team.issueApiToken(apiContext, ["pipelines.read"])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(a.team.listApiTokens(apiContext)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(a.team.revokeApiToken(id, apiContext)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await a.request("/studio-team/v1/tokens/revoke", { method: "POST", headers, body: JSON.stringify({ id }) })).status).toBe(200);
    await expect(a.team.authenticate(issued.token, "api")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("does not let failures or successes for one account reset or block another behind the same proxy", async () => {
    const a = await app("team"); await a.team.bootstrap("owner", "a-long-test-password");
    const login = await a.team.login("owner", "a-long-test-password"), context = await a.team.authenticate(login.token, "browser");
    await a.team.createMember({ username: "reader", password: "reader-long-password", workspaceIds: ["local"], roles: ["viewer"] }, context.actor);
    const attempt = (username: string, password: string) => a.request("/studio-team/v1/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    for (let i = 0; i < 10; i++) expect((await attempt("owner", "wrong")).status).toBe(401);
    expect((await attempt("reader", "reader-long-password")).status).toBe(200);
    expect((await attempt("owner", "a-long-test-password")).status).toBe(429);
  });
  it("fails closed for accidental local network listeners and mode typos", () => {
    expect(() => controlListener({ STUDIO_CONTROL_HOST: "0.0.0.0" })).toThrow("loopback");
    expect(() => controlListener({ STUDIO_MODE: "tem" })).toThrow("STUDIO_MODE");
    expect(controlListener({ STUDIO_MODE: "team", STUDIO_CONTROL_HOST: "0.0.0.0" }).mode).toBe("team");
    expect(controlListener({}).host).toBe("127.0.0.1");
  });

});
