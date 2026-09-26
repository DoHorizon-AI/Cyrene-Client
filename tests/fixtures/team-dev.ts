import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createControlApplication } from "../../apps/control/application";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import { buildProfile } from "../../packages/build-control/contracts";
import type { BuildAdapter } from "../../packages/build-control/adapter";

// Isolated team UI fixture. No Product adapters, GPU jobs, or user database.
const stores = new SqliteStoreFactory(":memory:");
const profile = buildProfile.parse({ id: "fixture", title: "Fixture build (simulated GitHub)", workspaceIds: ["local"], owner: "example", repository: "fixture", workflow: "studio-node-build.yml", workflowRef: "develop", sourceRefs: ["develop"], imageRepository: "ghcr.io/example/fixture", packageId: "fixture" });
// Only this test fixture simulates GitHub; no image is built or published.
const buildAdapter: BuildAdapter = {
  resolve: async () => "a".repeat(40),
  dispatch: async () => ({ runId: "123", url: "https://github.com/example/fixture/actions/runs/123" }),
  cancel: async () => {},
  observe: async build => {
    const image = `ghcr.io/example/fixture@sha256:${"b".repeat(64)}`;
    return { runId: "123", url: "https://github.com/example/fixture/actions/runs/123", state: "succeeded", message: "Fixture result verified", result: {
      schemaVersion: "cyrene.studio.build-result.v1", buildId: build.id, profileId: "fixture", sourceRepository: "example/fixture", sourceSha: build.sourceSha, workflowRunId: "123", image,
      provenance: { workflowSha: build.workflowSha, dependencyDigests: { "lock.json": `sha256:${"c".repeat(64)}` } },
      package: { schemaVersion: "cyrene.studio.nodes.v1", id: "fixture", version: "1", nodes: [{ type: "fixture.task", version: "1", title: "Fixture task", owner: "Fixture", category: "Test", description: "Browser test only", color: "#abcdef", inputs: [], outputs: [], fields: [], defaults: {}, execution: { kind: "task", adapter: "fixture", image, mutableFields: [], checkpoint: false } }] },
    } };
  },
};
const app = createControlApplication({ stores, mode: "team", publicOrigins: ["http://127.0.0.1:5183"], buildProfiles: [profile], buildAdapter });
await app.ready;
await app.team.bootstrap("owner", "browser-fixture-owner-password");
await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
const port = (app.server.address() as AddressInfo).port;
const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5183"], { env: { ...process.env, STUDIO_CONTROL_URL: `http://127.0.0.1:${port}` }, stdio: "inherit", windowsHide: true });
let closed = false;
const worker = setInterval(() => void app.builds.tick(), 250);
const close = () => { if (closed) return; closed = true; clearInterval(worker); child.kill("SIGTERM"); app.server.closeAllConnections(); app.server.close(() => { void stores.close(); }); };
child.on("exit", close); child.on("error", close); process.once("SIGINT", close); process.once("SIGTERM", close);
