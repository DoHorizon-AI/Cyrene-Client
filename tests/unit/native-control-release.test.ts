import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, createNativeControlArchive, createNativeControlReleaseDocuments, inspectNativeControlRoot, sha256 } from "../../tooling/release/native-control-component";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function bundleFixture() {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-native-control-"));
  directories.push(directory);
  const bundle = join(directory, "bundle");
  await Promise.all([
    mkdir(join(bundle, "bin"), { recursive: true }),
    mkdir(join(bundle, "lib"), { recursive: true }),
    mkdir(join(bundle, "runtime", "bin"), { recursive: true }),
    mkdir(join(bundle, "licenses"), { recursive: true }),
    mkdir(join(bundle, "systemd"), { recursive: true }),
  ]);
  const launcher = join(bundle, "bin", "cyrene-studio-control");
  await writeFile(launcher, "#!/bin/sh\nset -eu\nBASE_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")/..\" && pwd -P)\nexec \"$BASE_DIR/runtime/bin/node\" \"$BASE_DIR/lib/studio-control.mjs\" \"$@\"\n");
  await chmod(launcher, 0o755);
  await writeFile(join(bundle, "lib", "studio-control.mjs"), "process.stdout.write('ready');\n");
  await writeFile(join(bundle, "runtime", "bin", "node"), Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(128, 7)]));
  await chmod(join(bundle, "runtime", "bin", "node"), 0o755);
  await writeFile(join(bundle, "runtime", "LICENSE"), "Node.js is licensed under MIT.\n");
  await writeFile(join(bundle, "systemd", "cyrene-client-workspace-control.service"), [
    "[Service]",
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
    "",
  ].join("\n"));
  await writeFile(join(bundle, "licenses", "THIRD_PARTY_NOTICES.md"), "# Third-party notices\n");
  return { directory, bundle };
}

describe("immutable native Control release builder", () => {
  it("creates a deterministic archive and source-SHA-bound standard release documents", async () => {
    const fixture = await bundleFixture();
    const first = join(fixture.directory, "one.tar.gz"), second = join(fixture.directory, "two.tar.gz");
    const files = await createNativeControlArchive(fixture.bundle, first);
    await createNativeControlArchive(fixture.bundle, second);
    const archiveBytes = await readFile(first);
    expect(await readFile(second)).toEqual(archiveBytes);
    expect(files.files).toHaveProperty("bin/cyrene-studio-control");
    expect(files.files).toHaveProperty("runtime/bin/node");
    expect(files.files).toHaveProperty("runtime/LICENSE");
    expect(files.files).toHaveProperty("systemd/cyrene-client-workspace-control.service");

    const sourceCommit = "a".repeat(40);
    const artifactName = `cyrene-client-workspace-control-${sourceCommit}.tar.gz`;
    const documents = createNativeControlReleaseDocuments({
      channel: "preview",
      sourceRef: "refs/heads/develop",
      sourceCommit,
      runId: "123456",
      runAttempt: 2,
      generatedAt: "2026-10-08T12:00:00Z",
      artifactUri: `https://github.com/DoHorizon-AI/Cyrene-Client/releases/download/preview-cyrene-client-workspace-control-${sourceCommit}/${artifactName}`,
      artifactName,
      artifactDigest: sha256(archiveBytes),
      artifactSizeBytes: archiveBytes.byteLength,
      files: files.files,
    });
    expect(documents.releaseId).toBe(`preview-cyrene-client-workspace-control-${sourceCommit}`);
    expect(documents.version).toBe(`0.0.1+sha.${sourceCommit}`);
    expect(documents.manifest).toMatchObject({
      componentId: "cyrene-client-workspace-control",
      protocolVersion: "cyrene.client.studio-control.v1",
      contentDigest: sha256(archiveBytes),
      target: { runtime: "node:24", abi: "glibc-2.39" },
      artifact: { kind: "native-binary", entrypoint: "bin/cyrene-studio-control", executableFiles: ["bin/cyrene-studio-control", "runtime/bin/node"] },
      restart: { group: "single-service", unit: "cyrene-client-workspace-control.service" },
      health: { kind: "http", path: "/health/ready", port: 5182 },
      dependencies: [],
    });
    const unsigned = { ...documents.manifest } as Record<string, unknown>;
    delete unsigned.manifestDigest;
    expect(documents.manifest.manifestDigest).toBe(sha256(Buffer.from(canonicalJson(unsigned))));
    expect(documents.index.releases).toHaveLength(1);
    expect((documents.index as { releases: Record<string, unknown>[] }).releases[0]).toMatchObject({ componentId: "cyrene-client-workspace-control", manifestDigest: documents.manifest.manifestDigest });
  });

  it("rejects malformed immutable identities and missing runtime/license paths", async () => {
    const fixture = await bundleFixture();
    await rm(join(fixture.bundle, "runtime", "LICENSE"));
    await expect(createNativeControlArchive(fixture.bundle, join(fixture.directory, "broken.tar.gz"))).rejects.toThrow("runtime/LICENSE");
    expect(() => createNativeControlReleaseDocuments({
      channel: "stable",
      sourceRef: "refs/heads/develop",
      sourceCommit: "b".repeat(40),
      runId: "1",
      runAttempt: 1,
      generatedAt: "2026-10-08T12:00:00Z",
      artifactUri: "https://github.com/DoHorizon-AI/Cyrene-Client/releases/download/x/x.tar.gz",
      artifactName: "x.tar.gz",
      artifactDigest: `sha256:${"0".repeat(64)}`,
      artifactSizeBytes: 1,
      files: { "bin/cyrene-studio-control": `sha256:${"0".repeat(64)}` },
    })).toThrow("channel differs from its source branch");
  });

  it("rejects serialized native and slash-normalized checkout paths before packaging", async () => {
    const fixture = await bundleFixture();
    for (const path of [process.cwd(), process.cwd().replaceAll("\\", "/")]) {
      await writeFile(join(fixture.bundle, "lib", "studio-control.mjs"), `const checkout=${JSON.stringify(path)};`);
      await expect(inspectNativeControlRoot(fixture.bundle)).rejects.toThrow("checkout-path");
    }
  });
});
