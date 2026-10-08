// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 static-web-release.test.ts                                       │
// │  Module: tests/unit                                                 │
// │  Role: Verify the immutable static-web package and release envelope. │
// │                                                                      │
// │  模块职责：验证不可变静态 Web 包及标准 Release 元数据。                │
// └─────────────────────────────────────────────────────────────────────┘
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  createStaticWebArchive,
  createStaticWebReleaseDocuments,
  inspectStaticWebRoot,
  sha256,
} from "../../tooling/release/static-web-component";

const temporaryRoots: string[] = [];
const sourceCommit = "a".repeat(40);
const archiveDigest = `sha256:${"b".repeat(64)}`;

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-static-web-test-"));
  temporaryRoots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("static-web immutable release", () => {
  it("creates deterministic root-relative archives with an exact asset digest map", async () => {
    const directory = await temporaryDirectory();
    const site = join(directory, "site");
    await mkdir(join(site, "assets"), { recursive: true });
    await writeFile(join(site, "index.html"), "<!doctype html><script type=module src=/assets/app.js></script>\n");
    await writeFile(join(site, "assets", "app.js"), "document.body.dataset.ready='true';\n");

    const first = join(directory, "first.tar.gz");
    const second = join(directory, "second.tar.gz");
    const firstInventory = await createStaticWebArchive(site, first);
    const secondInventory = await createStaticWebArchive(site, second);

    expect(secondInventory).toEqual(firstInventory);
    expect(await readFile(first)).toEqual(await readFile(second));
    expect(firstInventory.files["index.html"]).toBe(sha256(await readFile(join(site, "index.html"))));
    expect(firstInventory.files["assets/app.js"]).toBe(sha256(await readFile(join(site, "assets", "app.js"))));
    expect(firstInventory.fileCount).toBe(2);
  });

  it("rejects missing entrypoints, source maps, symlinks, and checkout paths", async () => {
    const directory = await temporaryDirectory();
    const site = join(directory, "site");
    await mkdir(site);
    await writeFile(join(site, "app.js"), "ok");
    await expect(inspectStaticWebRoot(site)).rejects.toThrow("index.html");

    await writeFile(join(site, "index.html"), "<main></main>");
    await writeFile(join(site, "invalid.js"), Buffer.from([0xff, 0xfe]));
    await expect(inspectStaticWebRoot(site)).rejects.toThrow("valid UTF-8");
    await rm(join(site, "invalid.js"));
    await writeFile(join(site, "app.js.map"), "{}");
    await expect(inspectStaticWebRoot(site)).rejects.toThrow("source map");
    await rm(join(site, "app.js.map"));

    await writeFile(join(site, "app.js"), `const checkout=${JSON.stringify(process.cwd())};`);
    await expect(inspectStaticWebRoot(site)).rejects.toThrow("checkout-path");
    await writeFile(join(site, "app.js"), "ok");
    await symlink(join(site, "app.js"), join(site, "linked.js"));
    await expect(inspectStaticWebRoot(site)).rejects.toThrow("symlink");
  });

  it("emits Workspace manifest v2 and release index v1 bound to the immutable source SHA", () => {
    const documents = createStaticWebReleaseDocuments({
      channel: "preview",
      sourceRef: "refs/heads/develop",
      sourceCommit,
      runId: "9876543210",
      runAttempt: 1,
      generatedAt: "2026-10-08T12:30:00Z",
      packageVersion: "0.0.1",
      artifactUri: `https://github.com/DoHorizon-AI/Cyrene-Client/releases/download/preview-cyrene-client-workspace-web-${sourceCommit}/cyrene-client-workspace-web-${sourceCommit}.tar.gz`,
      artifactName: `cyrene-client-workspace-web-${sourceCommit}.tar.gz`,
      artifactDigest: archiveDigest,
      artifactSizeBytes: 1024,
      files: { "index.html": `sha256:${"c".repeat(64)}`, "assets/app.js": `sha256:${"d".repeat(64)}` },
      maxUncompressedBytes: 2048,
    });
    const manifest = documents.manifest as Record<string, unknown>;
    const index = documents.index as Record<string, unknown>;
    const artifact = manifest.artifact as Record<string, unknown>;
    const provenance = manifest.provenance as { attestation: Record<string, unknown> };
    const unsignedManifest = { ...manifest };
    delete unsignedManifest.manifestDigest;
    const unsignedIndex = { ...index };
    delete unsignedIndex.indexDigest;

    expect(documents.releaseId).toBe(`preview-cyrene-client-workspace-web-${sourceCommit}`);
    expect(documents.version).toBe(`0.0.1+sha.${sourceCommit}`);
    expect(manifest).toMatchObject({ schemaVersion: 2, componentId: "cyrene-client-workspace-web", channel: "preview", protocolVersion: "cyrene.static-web.v1", contentDigest: archiveDigest });
    expect(artifact).toMatchObject({ kind: "static-web", format: "tar.gz", sha256: archiveDigest, entrypoint: "index.html", maxEntries: 2, maxUncompressedBytes: 2048 });
    expect(provenance.attestation).toMatchObject({
      kind: "github-artifact-attestation",
      subjectName: `cyrene-client-workspace-web-${sourceCommit}.tar.gz`,
      repository: "DoHorizon-AI/Cyrene-Client",
      workflow: "DoHorizon-AI/Cyrene-Client/.github/workflows/workspace-web-release.yml",
    });
    expect(manifest.manifestDigest).toBe(sha256(Buffer.from(canonicalJson(unsignedManifest))));
    expect(index.indexDigest).toBe(sha256(Buffer.from(canonicalJson(unsignedIndex))));
    expect(index).toMatchObject({ schemaVersion: 1, repository: "DoHorizon-AI/Cyrene-Client", channel: "preview" });
  });

  it("rejects source/channel mismatches and release assets outside the source-SHA tag", () => {
    const common = {
      channel: "stable" as const,
      sourceRef: "refs/heads/main" as const,
      sourceCommit,
      runId: "9876543210",
      runAttempt: 1,
      generatedAt: "2026-10-08T12:30:00Z",
      packageVersion: "0.0.1",
      artifactUri: `https://github.com/DoHorizon-AI/Cyrene-Client/releases/download/stable-cyrene-client-workspace-web-${sourceCommit}/bundle.tar.gz`,
      artifactName: "bundle.tar.gz",
      artifactDigest: archiveDigest,
      artifactSizeBytes: 1024,
      files: { "index.html": `sha256:${"c".repeat(64)}` },
      maxUncompressedBytes: 2048,
    };
    expect(() => createStaticWebReleaseDocuments({ ...common, channel: "preview" })).toThrow("source branch");
    expect(() => createStaticWebReleaseDocuments({ ...common, artifactUri: "https://example.com/bundle.tar.gz" })).toThrow("immutable release URI");
  });
});
