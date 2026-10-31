// ┌────────────────────────────────────────────────────────────────────────┐
// │  📄 native-control-component.ts                                        │
// │  Module: tooling/release                                               │
// │  Role: Build the attested Node-native Studio Control release payload.  │
// │  中文：生成带供应链证明的 Node 原生 Studio Control 发布包。             │
// └────────────────────────────────────────────────────────────────────────┘
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const CLIENT_REPOSITORY = "DoHorizon-AI/Cyrene-Client";
const COMPONENT_ID = "cyrene-client-workspace-control";
const PUBLISHER_ID = "official-client-workspace-control";
const PUBLISHER_WORKFLOW = ".github/workflows/workspace-control-release.yml";
const WORKFLOW_IDENTITY = `${CLIENT_REPOSITORY}/${PUBLISHER_WORKFLOW}`;
const TARGET_ID = "linux-ubuntu-24.04-x86_64-node-24";
const PROTOCOL_VERSION = "cyrene.client.studio-control.v1";
const ENTRYPOINT = "bin/cyrene-studio-control";
const NODE_BINARY = "runtime/bin/node";
const NODE_LICENSE = "runtime/LICENSE";
const SERVICE_UNIT = "systemd/cyrene-client-workspace-control.service";
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const EXECUTABLE_FILES = [ENTRYPOINT, NODE_BINARY] as const;

export type ReleaseChannel = "stable" | "preview";
export type NativeControlFiles = { files: Record<string, string>; fileCount: number; uncompressedBytes: number };

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
  return path.length > 0 && Buffer.byteLength(path, "utf8") <= 512 && !path.startsWith("/") && !path.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(path) && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Native Control bundle cannot contain a symlink: ${path}`);
    if (entry.isDirectory()) files.push(...await walkFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
    else throw new Error(`Native Control bundle contains a non-regular entry: ${path}`);
  }
  return files;
}

/** Validate a staged bundle and return its exact path-to-content digest map. */
export async function inspectNativeControlRoot(bundleRoot: string): Promise<NativeControlFiles> {
  const root = resolve(bundleRoot);
  const paths = (await walkFiles(root)).sort();
  if (paths.length === 0 || paths.length > MAX_ENTRIES) throw new Error("Native Control entry count is empty or exceeds the release limit.");
  for (const required of [ENTRYPOINT, "lib/studio-control.mjs", NODE_BINARY, NODE_LICENSE, SERVICE_UNIT, "licenses/THIRD_PARTY_NOTICES.md"]) {
    if (!paths.includes(required)) throw new Error(`Native Control bundle is missing ${required}.`);
  }
  if (paths.some(path => !safeRelativePath(path) || path.toLowerCase().endsWith(".map") || /(^|\/)\.env(?:\.|$)/i.test(path))) {
    throw new Error("Native Control bundle contains an unsafe path, source map, or environment file.");
  }

  const executableSet = new Set<string>(EXECUTABLE_FILES);
  const files: Record<string, string> = {};
  let uncompressedBytes = 0;
  const sourceRoots = [process.cwd(), process.env.GITHUB_WORKSPACE].filter((value): value is string => !!value).flatMap(value => {
    const absolute = resolve(value), slashPath = absolute.replaceAll("\\", "/");
    return [absolute, slashPath, JSON.stringify(absolute).slice(1, -1), JSON.stringify(slashPath).slice(1, -1)];
  });
  for (const path of paths) {
    const absolute = join(root, ...path.split("/"));
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Native Control path is not a regular file: ${path}`);
    await chmod(absolute, executableSet.has(path) ? 0o755 : 0o644);
    const bytes = await readFile(absolute);
    uncompressedBytes += bytes.byteLength;
    if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes > MAX_UNCOMPRESSED_BYTES) throw new Error("Native Control content exceeds the 512 MiB release limit.");
    files[path] = sha256(bytes);
    if (/\.(?:mjs|js|cjs|json|sh|txt|md)$/i.test(path)) {
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new Error(`Native Control text asset is not valid UTF-8: ${path}`); }
      if (content.includes("sourceMappingURL=") || sourceRoots.some(sourceRoot => sourceRoot && content.includes(sourceRoot))) {
        throw new Error(`Native Control text asset contains source-map or checkout-path metadata: ${path}`);
      }
    }
  }
  const unit = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(join(root, ...SERVICE_UNIT.split("/"))));
  for (const directive of [
    "User=cyrene",
    "Group=cyrene",
    "Environment=STUDIO_MODE=local",
    "Environment=STUDIO_CONTROL_HOST=127.0.0.1",
    "Environment=STUDIO_CONTROL_PORT=5182",
    "Environment=STUDIO_PUBLIC_ORIGINS=http://127.0.0.1:8100,http://localhost:8100",
    "EnvironmentFile=-/etc/cyrene/studio-control.env",
    "ExecStart=/usr/bin/cyrene component-run cyrene-client-workspace-control",
    "Restart=on-failure",
    "ReadWritePaths=/var/lib/cyrene/studio-control",
  ]) {
    if (!unit.split(/\r?\n/).includes(directive)) throw new Error(`Native Control service unit is missing the required directive: ${directive}`);
  }
  if (/^\s*Environment=.*(?:TOKEN|PASSWORD|SECRET)=/im.test(unit)) throw new Error("Native Control service unit must not embed a credential value.");
  return { files, fileCount: paths.length, uncompressedBytes };
}

/** Create a deterministic tar.gz with normalized ownership, timestamps and modes. */
export async function createNativeControlArchive(bundleRoot: string, archivePath: string): Promise<NativeControlFiles> {
  const root = resolve(bundleRoot);
  const inventory = await inspectNativeControlRoot(root);
  const paths = Object.keys(inventory.files).sort();
  const tar = spawnSync("tar", [
    "--create", "--format=ustar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
    "--no-recursion", "--null", "--files-from=-", "--file=-",
  ], {
    cwd: root,
    input: Buffer.from(`${paths.join("\0")}\0`, "utf8"),
    maxBuffer: MAX_UNCOMPRESSED_BYTES + 16 * 1024 * 1024,
    encoding: "buffer",
  });
  if (tar.error) throw tar.error;
  if (tar.status !== 0) throw new Error(`tar failed while packaging native Control: ${tar.stderr.toString("utf8").slice(0, 2000)}`);
  const compressed = gzipSync(tar.stdout, { level: 9 });
  if (compressed.byteLength < 1 || compressed.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Compressed native Control archive exceeds the 512 MiB release limit.");
  await mkdir(resolve(archivePath, ".."), { recursive: true });
  await writeFile(archivePath, compressed, { flag: "wx", mode: 0o644 });
  const listed = spawnSync("tar", ["--list", "--gzip", ...(process.platform === "win32" ? ["--force-local"] : []), "--file", resolve(archivePath)], { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  if (listed.error) throw listed.error;
  if (listed.status !== 0) throw new Error(`tar could not read back the native Control archive: ${listed.stderr.slice(0, 2000)}`);
  const actualPaths = listed.stdout.trimEnd().split("\n").sort();
  if (actualPaths.length !== paths.length || actualPaths.some((path, index) => path !== paths[index])) throw new Error("Native Control archive entries differ from the signed file map.");
  return inventory;
}

export type NativeControlReleaseOptions = {
  channel: ReleaseChannel;
  sourceRef: "refs/heads/develop" | "refs/heads/main" | "refs/heads/release";
  sourceCommit: string;
  runId: string;
  runAttempt: number;
  generatedAt: string;
  artifactUri: string;
  artifactName: string;
  artifactDigest: string;
  artifactSizeBytes: number;
  files: Record<string, string>;
};

/** Build standard Workspace Component Release Manifest v2 and Index v1 documents. */
export function createNativeControlReleaseDocuments(options: NativeControlReleaseOptions) {
  if (!/^[a-f0-9]{40}$/.test(options.sourceCommit)) throw new Error("Native Control source commit must be a full Git SHA.");
  if (!/^[0-9]{1,30}$/.test(options.runId) || !Number.isSafeInteger(options.runAttempt) || options.runAttempt < 1) throw new Error("GitHub workflow run identity is invalid.");
  if (!(options.sourceRef === "refs/heads/develop" || options.sourceRef === "refs/heads/main" || options.sourceRef === "refs/heads/release")) throw new Error("Native Control releases must come from an integration branch.");
  const expectedChannel = options.sourceRef === "refs/heads/develop" ? "preview" : "stable";
  if (options.channel !== expectedChannel) throw new Error("Native Control release channel differs from its source branch.");
  const releaseId = `${options.channel}-${COMPONENT_ID}-${options.sourceCommit}`;
  const version = `0.0.1+sha.${options.sourceCommit}`;
  const filePaths = Object.keys(options.files);
  if (!options.files[ENTRYPOINT] || !options.files[NODE_BINARY] || !options.files[NODE_LICENSE] || filePaths.length === 0 || filePaths.length > MAX_ENTRIES || filePaths.some(path => !safeRelativePath(path) || !/^sha256:[a-f0-9]{64}$/.test(options.files[path]))) {
    throw new Error("Native Control file map must contain the launcher, Node runtime and license with typed digests.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(options.artifactDigest)) throw new Error("Native Control archive digest is malformed.");
  if (!Number.isSafeInteger(options.artifactSizeBytes) || options.artifactSizeBytes < 1) throw new Error("Native Control archive size must be a positive safe integer.");
  if (options.artifactUri !== `https://github.com/${CLIENT_REPOSITORY}/releases/download/${releaseId}/${options.artifactName}`) throw new Error("Native Control artifact must use this source SHA's immutable release URI.");
  const generatedAt = new Date(options.generatedAt);
  if (!Number.isFinite(generatedAt.getTime())) throw new Error("Native Control index generation time is invalid.");
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
    runtime: "node:24",
  };
  const unsignedManifest = {
    schemaVersion: 2,
    releaseId,
    componentId: COMPONENT_ID,
    version,
    channel: options.channel,
    target,
    artifact: {
      kind: "native-binary",
      format: "tar.gz",
      uri: options.artifactUri,
      sha256: options.artifactDigest,
      sizeBytes: options.artifactSizeBytes,
      files: options.files,
      entrypoint: ENTRYPOINT,
      executableFiles: [...EXECUTABLE_FILES],
    },
    dependencies: [],
    restart: { group: "single-service", unit: "cyrene-client-workspace-control.service" },
    source,
    provenance: { attestation: attestation(options.artifactName) },
    health: { kind: "http", path: "/health/ready", port: 5182 },
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
    const key = argv[index], value = argv[index + 1];
    if (!key.startsWith("--") || !value || value.startsWith("--") || result[key.slice(2)]) throw new Error(`Invalid or duplicate argument: ${key}`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

/** CLI used by the post-CI immutable native Control release workflow. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["bundle", "output", "source-ref", "source-commit", "channel", "run-id", "run-attempt", "generated-at"];
  if (required.some(key => !args[key])) throw new Error(`Required arguments: ${required.join(", ")}`);
  const sourceCommit = args["source-commit"], outputRoot = resolve(args.output);
  await mkdir(outputRoot, { recursive: true });
  const artifactName = `${COMPONENT_ID}-${sourceCommit}.tar.gz`;
  const artifactPath = join(outputRoot, artifactName);
  const inventory = await createNativeControlArchive(args.bundle, artifactPath);
  const artifactBytes = await readFile(artifactPath);
  const documents = createNativeControlReleaseDocuments({
    channel: args.channel as ReleaseChannel,
    sourceRef: args["source-ref"] as NativeControlReleaseOptions["sourceRef"],
    sourceCommit,
    runId: args["run-id"],
    runAttempt: Number(args["run-attempt"]),
    generatedAt: args["generated-at"],
    artifactUri: `https://github.com/${CLIENT_REPOSITORY}/releases/download/${args.channel}-${COMPONENT_ID}-${sourceCommit}/${artifactName}`,
    artifactName,
    artifactDigest: sha256(artifactBytes),
    artifactSizeBytes: artifactBytes.byteLength,
    files: inventory.files,
  });
  await writeFile(join(outputRoot, documents.manifestName), `${canonicalJson(documents.manifest)}\n`, { flag: "wx", mode: 0o644 });
  await writeFile(join(outputRoot, documents.indexName), `${canonicalJson(documents.index)}\n`, { flag: "wx", mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ releaseId: documents.releaseId, version: documents.version, componentId: COMPONENT_ID, publisherId: PUBLISHER_ID, targetId: TARGET_ID, artifact: artifactName, manifest: documents.manifestName, index: documents.indexName })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
