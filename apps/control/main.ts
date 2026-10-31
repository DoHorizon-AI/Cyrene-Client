import { resolve } from "node:path";
import { PostgresStoreFactory } from "../../tooling/postgres-store";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";
import { admittedTarget } from "../../tooling/settings-proxy";
import { admittedLoopbackTarget, isLoopbackHost, type DirectProductId } from "../../tooling/product-proxy";
import { createControlApplication } from "./application";
import { loadNodePackages } from "../../tooling/node-packages";
import { ProductExecutionAdapter } from "../../packages/run-control/http-adapter";
import type { ExecutionAdapter } from "../../packages/run-control/adapter";
import { readFile } from "node:fs/promises";
import { buildProfile } from "../../packages/build-control/contracts";
import { GitHubBuildAdapter } from "../../packages/build-control/github";
import { readConfiguredSecret } from "./secrets";
import { controlListener } from "./listener";

const { mode, host } = controlListener(process.env);
if (mode === "team" && !process.env.STUDIO_DATABASE_URL) throw new Error("Team mode requires STUDIO_DATABASE_URL (PostgreSQL)");
const stores = process.env.STUDIO_DATABASE_URL ? new PostgresStoreFactory(process.env.STUDIO_DATABASE_URL) : new SqliteStoreFactory(resolve(process.env.STUDIO_CONTROL_DATA_DIR ?? ".studio", "control.sqlite"));

const adapters = new Map<string, ExecutionAdapter>();
for (const name of ["yield", "echo"]) {
  const prefix = `STUDIO_${name.toUpperCase()}_EXECUTION`;
  const url = process.env[`${prefix}_URL`]?.trim();
  const token = await readConfiguredSecret(`${prefix}_TOKEN`);
  if (Boolean(url) !== Boolean(token)) throw new Error(`${prefix}_URL and ${prefix}_TOKEN or ${prefix}_TOKEN_FILE are required together`);
  if (url && token) adapters.set(name, new ProductExecutionAdapter(url, token));
}
const buildProfiles = process.env.STUDIO_BUILD_PROFILES_FILE ? buildProfile.array().max(100).parse(JSON.parse(await readFile(process.env.STUDIO_BUILD_PROFILES_FILE, "utf8"))) : [];
const githubToken = process.env.STUDIO_GITHUB_TOKEN_FILE ? (await readFile(process.env.STUDIO_GITHUB_TOKEN_FILE, "utf8")).trim() : process.env.STUDIO_GITHUB_TOKEN;
const navigatorUrl = admittedTarget(process.env.STUDIO_NAVIGATOR_URL);
const directEnvironmentNames = ["STUDIO_CATALYST_URL", "STUDIO_CATALYST_API_TOKEN", "STUDIO_CATALYST_API_TOKEN_FILE", "STUDIO_ECHO_URL", "STUDIO_ECHO_API_TOKEN", "STUDIO_ECHO_API_TOKEN_FILE"];
const directConfigured = directEnvironmentNames.some(name => !!process.env[name]?.trim());
const productTargets: Partial<Record<DirectProductId, { origin: string; token: string }>> = {};
if (directConfigured) {
  if (mode !== "local" || navigatorUrl) throw new Error("Direct Product origins require local mode with STUDIO_NAVIGATOR_URL unset.");
  const controlHost = process.env.STUDIO_CONTROL_HOST ?? "127.0.0.1";
  if (!isLoopbackHost(controlHost)) throw new Error("Direct Product mode requires STUDIO_CONTROL_HOST to be loopback.");
  for (const service of ["catalyst", "echo"] as const) {
    const prefix = `STUDIO_${service.toUpperCase()}`;
    const url = process.env[`${prefix}_URL`]?.trim();
    const token = await readConfiguredSecret(`${prefix}_API_TOKEN`);
    if (Boolean(url) !== Boolean(token)) throw new Error(`${prefix}_URL and ${prefix}_API_TOKEN or ${prefix}_API_TOKEN_FILE are required together`);
    if (url && token) productTargets[service] = { origin: admittedLoopbackTarget(url)!, token };
  }
  if (!productTargets.catalyst) throw new Error("Direct Product mode requires STUDIO_CATALYST_URL and its server-side token.");
}
const application = createControlApplication({ stores, mode, workspaceId: process.env.STUDIO_WORKSPACE_ID, localDiagnostics: process.env.STUDIO_LOCAL_DIAGNOSTICS === "1", mcpReadOnly: process.env.STUDIO_MCP_READ_ONLY === "1", publicOrigins: (process.env.STUDIO_PUBLIC_ORIGINS ?? "http://127.0.0.1:5180").split(",").map(s => s.trim()), navigatorUrl, productTargets: directConfigured ? productTargets : undefined, localApiToken: process.env.STUDIO_LOCAL_API_TOKEN, loadPackages: () => loadNodePackages(process.env.STUDIO_NODE_PACKAGES_DIR), adapters, buildProfiles, buildAdapter: githubToken ? new GitHubBuildAdapter(() => githubToken) : undefined });
await application.ready;
if (process.argv.includes("--bootstrap-admin")) {
  if (!process.env.STUDIO_ADMIN_USER || !process.env.STUDIO_ADMIN_PASSWORD) throw new Error("Set STUDIO_ADMIN_USER and STUDIO_ADMIN_PASSWORD for this command only");
  const result = await application.team.bootstrap(process.env.STUDIO_ADMIN_USER, process.env.STUDIO_ADMIN_PASSWORD);
  process.stdout.write(`Created administrator ${result.username}\n`);
  await stores.close();
} else {
  const port = Number(process.env.STUDIO_CONTROL_PORT ?? 5182);
  application.server.listen(port, host, () => process.stdout.write(`Studio control listening on port ${port} (${mode})\n`));
  let reconciliation: Promise<void> | undefined;
  const worker = setInterval(() => {
    if (reconciliation) return;
    reconciliation = Promise.allSettled([application.runs.tick(), application.builds.tick()]).then(results => { if (results.some(result => result.status === "rejected")) process.stderr.write("Control reconciliation unavailable; intents retained.\n"); }).finally(() => { reconciliation = undefined; });
  }, 1000);
  let closing = false;
  const close = () => { if (closing) return; closing = true; clearInterval(worker); application.server.close(() => { void Promise.resolve(reconciliation).then(() => stores.close()); }); application.server.closeIdleConnections(); };
  process.once("SIGTERM", close); process.once("SIGINT", close);
}
