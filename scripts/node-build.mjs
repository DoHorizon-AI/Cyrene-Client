// Executed from the trusted workflow checkout, never from the source checkout.
import { readFile, realpath, appendFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";

const env = process.env;
const required = name => { if (!env[name]) throw new Error(`Missing ${name}`); return env[name]; };
const sourceSha = required("SOURCE_SHA"), buildId = required("STUDIO_BUILD_ID"), profileId = required("PROFILE_ID");
if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^[A-Za-z0-9_.-]{1,100}$/.test(buildId) || !/^[A-Za-z0-9_.-]{1,100}$/.test(profileId)) throw new Error("Invalid build identity");
const profiles = JSON.parse(await readFile(new URL("../ci/build-profiles.json", import.meta.url), "utf8"));
if (!Object.hasOwn(profiles, profileId)) throw new Error("Profile is not admitted by the trusted workflow");
const profile = profiles[profileId];
if (!/^ghcr\.io\/[a-z0-9][a-z0-9./_-]+$/.test(profile.imageRepository) || !/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(profile.packageId)) throw new Error("Invalid profile target");
const source = await realpath(required("SOURCE_DIRECTORY"));
async function inside(path) {
  if (typeof path !== "string" || !path || /[\r\n]/.test(path) || isAbsolute(path)) throw new Error("Invalid source path");
  const resolved = await realpath(resolve(source, path)), rest = relative(source, resolved);
  if (rest === ".." || rest.startsWith("../") || rest.startsWith("..\\") || isAbsolute(rest)) throw new Error("Source path escapes checkout");
  return resolved;
}
const context = await inside(profile.context), dockerfile = await inside(profile.dockerfile), manifest = await inside(profile.manifest);
if (!Array.isArray(profile.lockFiles) || !profile.lockFiles.length) throw new Error("Profile must declare dependency lock files");
const dependencyDigests = {};
for (const path of profile.lockFiles) dependencyDigests[path] = `sha256:${createHash("sha256").update(await readFile(await inside(path))).digest("hex")}`;
if (process.argv[2] === "prepare") {
  await appendFile(required("GITHUB_OUTPUT"), `context=${context}\ndockerfile=${dockerfile}\ntag=${profile.imageRepository}:studio-${buildId}\n`);
} else if (process.argv[2] === "result") {
  const metadata = JSON.parse(await readFile(required("IMAGE_METADATA"), "utf8")), digest = metadata["containerimage.digest"];
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Build did not produce a registry digest");
  const runId = required("GITHUB_RUN_ID"), workflowSha = required("GITHUB_SHA");
  if (!/^[1-9]\d*$/.test(runId) || !/^[a-f0-9]{40}$/.test(workflowSha)) throw new Error("Invalid workflow identity");
  const pkg = JSON.parse(await readFile(manifest, "utf8")), image = `${profile.imageRepository}@${digest}`;
  if (pkg.schemaVersion !== "cyrene.studio.nodes.v1" || pkg.id !== profile.packageId || !Array.isArray(pkg.nodes) || !pkg.nodes.length) throw new Error("Invalid package manifest");
  const version = `${sourceSha.slice(0, 12)}.${runId}`;
  pkg.version = version;
  for (const node of pkg.nodes) { node.version = version; if (node.execution.kind !== "reference") node.execution.image = image; }
  const result = { schemaVersion: "cyrene.studio.build-result.v1", buildId, profileId, sourceRepository: required("GITHUB_REPOSITORY"), sourceSha, workflowRunId: runId, image, package: pkg, provenance: { workflowSha, dependencyDigests } };
  await writeFile(required("BUILD_RESULT_FILE"), JSON.stringify(result, null, 2));
} else throw new Error("Expected prepare or result");
