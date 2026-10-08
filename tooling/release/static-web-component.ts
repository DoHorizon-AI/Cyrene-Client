// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 static-web-component.ts                                          │
// │  Module: tooling/release                                             │
// │  Role: Build a deterministic static-web archive and v2 release data. │
// │                                                                      │
// │  模块职责：生成确定性静态 Web 包及 Workspace v2 release metadata。     │
// └─────────────────────────────────────────────────────────────────────┘
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";

const CLIENT_REPOSITORY = "DoHorizon-AI/Cyrene-Client";
const COMPONENT_ID = "cyrene-client-workspace-web";
const PUBLISHER_ID = "official-client-workspace-web";
const PUBLISHER_WORKFLOW = ".github/workflows/workspace-web-release.yml";
const WORKFLOW_IDENTITY = `${CLIENT_REPOSITORY}/${PUBLISHER_WORKFLOW}`;
const TARGET_ID = "linux-ubuntu-24.04-x86_64-web";
const PROTOCOL_VERSION = "cyrene.static-web.v1";
const MAX_STATIC_WEB_BYTES = 512 * 1024 * 1024;
const MAX_STATIC_WEB_ENTRIES = 10_000;

export type ReleaseChannel = "stable" | "preview";
export type StaticWebFiles = { files: Record<string, string>; fileCount: number; uncompressedBytes: number };

/** Hash raw bytes using the digest spelling used by Workspace component manifests. */
export function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Serialize safe JSON using the RFC 8785 key ordering and number subset used by Workspace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value) ?? "null";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Release metadata must use safe integers only.");
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Release metadata must contain plain JSON values only.");
  const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function digestObject<T extends Record<string, unknown>>(document: T, digestField: keyof T): T {
  const unsigned = { ...document };
  delete (unsigned as Partial<T>)[digestField];
  return { ...unsigned, [digestField]: sha256(Buffer.from(canonicalJson(unsigned), "utf8")) } as T;
}

function safeRelativePath(path: string): boolean {
  return path.length > 0 && Buffer.byteLength(path, "utf8") <= 100 && !path.startsWith("/") && !path.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(path) && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}

async function walkStaticRoot(root: string, current = root): Promise<string[]> {
  const names = (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const files: string[] = [];
  for (const entry of names) {
    const absolute = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Static web bundle cannot contain a symlink: ${absolute}`);
    if (entry.isDirectory()) files.push(...await walkStaticRoot(root, absolute));
    else if (entry.isFile()) files.push(relative(root, absolute).split(sep).join("/"));
    else throw new Error(`Static web bundle contains a non-regular entry: ${absolute}`);
  }
  return files;
}

/** Validate the built site and return the exact path-to-content digest map. */
export async function inspectStaticWebRoot(siteRoot: string): Promise<StaticWebFiles> {
  const root = resolve(siteRoot);
  const paths = await walkStaticRoot(root);
  if (paths.length === 0 || paths.length > MAX_STATIC_WEB_ENTRIES) throw new Error("Static web entry count is empty or exceeds the release limit.");
  paths.sort();
  if (!paths.includes("index.html")) throw new Error("The static web archive root must contain index.html.");

  const files: Record<string, string> = {};
  let uncompressedBytes = 0;
  const sourceRoots = [process.cwd(), process.env.GITHUB_WORKSPACE].filter((value): value is string => !!value).map(value => resolve(value));
  for (const path of paths) {
    if (!safeRelativePath(path) || path.toLowerCase().endsWith(".map")) throw new Error(`Static web path is unsafe or includes a source map: ${path}`);
    const bytes = await readFile(join(root, ...path.split("/")));
    uncompressedBytes += bytes.byteLength;
    if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes > MAX_STATIC_WEB_BYTES) throw new Error("Static web content exceeds the 512 MiB release limit.");
    files[path] = sha256(bytes);

    if (/\.(html|js|mjs|css|svg|json|txt)$/i.test(path)) {
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new Error(`Static text asset is not valid UTF-8: ${path}`); }
      if (content.includes("sourceMappingURL=") || sourceRoots.some(sourceRoot => content.includes(sourceRoot))) {
        throw new Error(`Static asset contains source-map or checkout-path metadata: ${path}`);
      }
      if (path === "index.html" && /(?:src|href)=["']https?:\/\//i.test(content)) {
        throw new Error("Static index.html cannot depend on a remote script or stylesheet.");
      }
    }
  }
  return { files, fileCount: paths.length, uncompressedBytes };
}

/** Create a root-relative deterministic tar.gz with normalized ownership and timestamps. */
export async function createStaticWebArchive(siteRoot: string, archivePath: string): Promise<StaticWebFiles> {
  const root = resolve(siteRoot);
  const inventory = await inspectStaticWebRoot(root);
  const paths = Object.keys(inventory.files).sort();
  const tar = spawnSync("tar", [
    "--create", "--format=ustar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
    "--mode=u=rw,go=r", "--no-recursion", "--null", "--files-from=-", "--file=-",
  ], {
    cwd: root,
    input: Buffer.from(`${paths.join("\0")}\0`, "utf8"),
    maxBuffer: MAX_STATIC_WEB_BYTES + 16 * 1024 * 1024,
    encoding: "buffer",
  });
  if (tar.error) throw tar.error;
  if (tar.status !== 0) throw new Error(`tar failed while packaging static web content: ${tar.stderr.toString("utf8").slice(0, 2000)}`);

  const compressed = gzipSync(tar.stdout, { level: 9 });
  if (compressed.byteLength < 1 || compressed.byteLength > MAX_STATIC_WEB_BYTES) {
    throw new Error("Compressed static web archive exceeds the 512 MiB release limit.");
  }
  await mkdir(resolve(archivePath, ".."), { recursive: true });
  await writeFile(archivePath, compressed, { flag: "wx", mode: 0o644 });
  const listed = spawnSync("tar", ["--list", "--gzip", "--file", resolve(archivePath)], { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  if (listed.error) throw listed.error;
  if (listed.status !== 0) throw new Error(`tar could not read back the static web archive: ${listed.stderr.slice(0, 2000)}`);
  const actualPaths = listed.stdout.trimEnd().split("\n").sort();
  if (actualPaths.length !== paths.length || actualPaths.some((path, index) => path !== paths[index])) {
    throw new Error("Static web archive entries differ from the signed file map.");
  }
  return inventory;
}

export type StaticWebReleaseOptions = {
  channel: ReleaseChannel;
  sourceRef: "refs/heads/develop" | "refs/heads/main" | "refs/heads/release";
  sourceCommit: string;
  runId: string;
  runAttempt: number;
  generatedAt: string;
  packageVersion: string;
  artifactUri: string;
  artifactName: string;
  artifactDigest: string;
  artifactSizeBytes: number;
  files: Record<string, string>;
  maxUncompressedBytes: number;
};

/** Build standard Workspace Component Release Manifest v2 and Index v1 documents. */
export function createStaticWebReleaseDocuments(options: StaticWebReleaseOptions) {
  if (!/^[a-f0-9]{40}$/.test(options.sourceCommit)) throw new Error("Static web source commit must be a full Git SHA.");
  if (!/^[0-9]{1,30}$/.test(options.runId) || !Number.isSafeInteger(options.runAttempt) || options.runAttempt < 1) throw new Error("GitHub workflow run identity is invalid.");
  if (!("refs/heads/develop" === options.sourceRef || "refs/heads/main" === options.sourceRef || "refs/heads/release" === options.sourceRef)) throw new Error("Static web releases must come from an integration branch.");
  const expectedChannel = options.sourceRef === "refs/heads/develop" ? "preview" : "stable";
  if (options.channel !== expectedChannel) throw new Error("Static web release channel differs from its source branch.");
  const releaseId = `${options.channel}-${COMPONENT_ID}-${options.sourceCommit}`;
  const version = `${options.packageVersion}+sha.${options.sourceCommit}`;
  const filePaths = Object.keys(options.files);
  if (options.files["index.html"] === undefined || filePaths.length === 0 || filePaths.length > MAX_STATIC_WEB_ENTRIES || filePaths.some(path => !safeRelativePath(path) || !/^sha256:[a-f0-9]{64}$/.test(options.files[path]))) {
    throw new Error("Static web file map must contain safe relative paths and a typed digest for index.html.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(options.artifactDigest)) throw new Error("Static web archive digest is malformed.");
  if (!Number.isSafeInteger(options.artifactSizeBytes) || options.artifactSizeBytes < 1) throw new Error("Static web archive size must be a positive safe integer.");
  if (!Number.isSafeInteger(options.maxUncompressedBytes) || options.maxUncompressedBytes < 1 || options.maxUncompressedBytes > MAX_STATIC_WEB_BYTES) throw new Error("Static web uncompressed size is outside the release limit.");
  if (!options.artifactUri.startsWith(`https://github.com/${CLIENT_REPOSITORY}/releases/download/${releaseId}/`)) throw new Error("Static web artifact must use this source SHA's immutable release URI.");
  const generatedAt = new Date(options.generatedAt);
  if (!Number.isFinite(generatedAt.getTime())) throw new Error("Static web index generation time is invalid.");
  const source = { repository: `https://github.com/${CLIENT_REPOSITORY}`, ref: options.sourceRef, commit: options.sourceCommit };
  const run = {
    id: options.runId,
    attempt: options.runAttempt,
    url: `https://github.com/${CLIENT_REPOSITORY}/actions/runs/${options.runId}/attempts/${options.runAttempt}`,
  };
  const attestation = (subjectName: string) => ({
    kind: "github-artifact-attestation",
    subjectName,
    repository: CLIENT_REPOSITORY,
    workflow: WORKFLOW_IDENTITY,
    predicateType: "https://slsa.dev/provenance/v1",
    run,
  });
  const target = {
    os: "linux",
    osVersion: "24.04",
    distribution: "ubuntu",
    distributionVersion: "24.04",
    architecture: "x86_64",
    abi: "glibc-2.39",
    runtime: "static-web",
  };
  const unsignedManifest = {
    schemaVersion: 2,
    releaseId,
    componentId: COMPONENT_ID,
    version,
    channel: options.channel,
    target,
    artifact: {
      kind: "static-web",
      format: "tar.gz",
      uri: options.artifactUri,
      sha256: options.artifactDigest,
      sizeBytes: options.artifactSizeBytes,
      files: options.files,
      maxEntries: Object.keys(options.files).length,
      maxUncompressedBytes: options.maxUncompressedBytes,
      entrypoint: "index.html",
    },
    dependencies: [],
    restart: { group: "none" },
    source,
    provenance: { attestation: attestation(options.artifactName) },
    protocolVersion: PROTOCOL_VERSION,
    contentDigest: options.artifactDigest,
  } as Record<string, unknown>;
  const manifest = digestObject(unsignedManifest, "manifestDigest");
  const manifestName = `${COMPONENT_ID}.manifest.json`;
  const manifestUri = `https://github.com/${CLIENT_REPOSITORY}/releases/download/${releaseId}/${manifestName}`;
  const unsignedIndex = {
    schemaVersion: 1,
    repository: CLIENT_REPOSITORY,
    channel: options.channel,
    generatedAt: generatedAt.toISOString(),
    source,
    provenance: { attestation: attestation("component-release-index-v1.json") },
    releases: [{ componentId: COMPONENT_ID, version, target, manifestUri, manifestDigest: manifest.manifestDigest }],
    compatibilityGroups: [],
  } as Record<string, unknown>;
  const index = digestObject(unsignedIndex, "indexDigest");
  return { releaseId, version, manifestName, manifest, indexName: "component-release-index-v1.json", index };
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--") || !value || value.startsWith("--") || result[key.slice(2)]) throw new Error(`Invalid or duplicate argument: ${key}`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

/** CLI used by the post-CI immutable static-web release workflow. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["site", "output", "source-ref", "source-commit", "channel", "run-id", "run-attempt", "generated-at"];
  if (required.some(key => !args[key])) throw new Error(`Required arguments: ${required.join(", ")}`);
  const sourceCommit = args["source-commit"];
  const outputRoot = resolve(args.output);
  await mkdir(outputRoot, { recursive: true });
  const artifactName = `${COMPONENT_ID}-${sourceCommit}.tar.gz`;
  const artifactPath = join(outputRoot, artifactName);
  const inventory = await createStaticWebArchive(args.site, artifactPath);
  const artifactBytes = await readFile(artifactPath);
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { version?: unknown };
  const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(packageVersion)) throw new Error("package.json version is invalid for a component release.");
  const documents = createStaticWebReleaseDocuments({
    channel: args.channel as ReleaseChannel,
    sourceRef: args["source-ref"] as StaticWebReleaseOptions["sourceRef"],
    sourceCommit,
    runId: args["run-id"],
    runAttempt: Number(args["run-attempt"]),
    generatedAt: args["generated-at"],
    packageVersion,
    artifactUri: `https://github.com/${CLIENT_REPOSITORY}/releases/download/${args.channel}-${COMPONENT_ID}-${sourceCommit}/${artifactName}`,
    artifactName,
    artifactDigest: sha256(artifactBytes),
    artifactSizeBytes: artifactBytes.byteLength,
    files: inventory.files,
    maxUncompressedBytes: inventory.uncompressedBytes,
  });
  await writeFile(join(outputRoot, documents.manifestName), `${canonicalJson(documents.manifest)}\n`, { flag: "wx", mode: 0o644 });
  await writeFile(join(outputRoot, documents.indexName), `${canonicalJson(documents.index)}\n`, { flag: "wx", mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ releaseId: documents.releaseId, version: documents.version, componentId: COMPONENT_ID, publisherId: PUBLISHER_ID, targetId: TARGET_ID, artifact: artifactName, manifest: documents.manifestName, index: documents.indexName })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`static-web component release failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
