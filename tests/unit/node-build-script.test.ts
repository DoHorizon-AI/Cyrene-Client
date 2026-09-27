import { expect, it } from "vitest";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildResult } from "../../packages/build-control/contracts";

it("trusted build script pins the published digest and refuses source path escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-image-build-"));
  try {
    for (const dir of ["scripts", "ci", "source"]) await mkdir(join(root, dir));
    await copyFile("scripts/node-build.mjs", join(root, "scripts/node-build.mjs"));
    const profile = { imageRepository: "ghcr.io/example/test", packageId: "test", context: ".", dockerfile: "Dockerfile", manifest: "nodes.json", lockFiles: ["lock.json"] };
    const writeProfile = () => writeFile(join(root, "ci/build-profiles.json"), JSON.stringify({ test: profile }));
    await writeProfile();
    await writeFile(join(root, "source/Dockerfile"), "FROM scratch\n");
    await writeFile(join(root, "source/lock.json"), "{\"version\":1}");
    await writeFile(join(root, "source/nodes.json"), JSON.stringify({ schemaVersion: "cyrene.studio.nodes.v1", id: "test", version: "template", nodes: [{ type: "test.task", version: "template", title: "Task", owner: "Test", category: "Test", description: "Fixture", color: "#abcdef", inputs: [], outputs: [], fields: [], defaults: {}, execution: { kind: "task", adapter: "test", checkpoint: false, mutableFields: [] } }] }));
    await writeFile(join(root, "image.json"), JSON.stringify({ "containerimage.digest": `sha256:${"b".repeat(64)}` }));
    const env = { ...process.env, SOURCE_SHA: "a".repeat(40), STUDIO_BUILD_ID: "build-one", PROFILE_ID: "test", SOURCE_DIRECTORY: join(root, "source"), GITHUB_OUTPUT: join(root, "output"), IMAGE_METADATA: join(root, "image.json"), GITHUB_RUN_ID: "123", GITHUB_SHA: "c".repeat(40), GITHUB_REPOSITORY: "example/test", BUILD_RESULT_FILE: join(root, "result.json") };
    const run = (phase: string) => execFileSync(process.execPath, [join(root, "scripts/node-build.mjs"), phase], { env, stdio: "pipe" });
    run("prepare"); run("result");
    const result = buildResult.parse(JSON.parse(await readFile(join(root, "result.json"), "utf8")));
    expect(result.image).toBe(`ghcr.io/example/test@sha256:${"b".repeat(64)}`);
    expect(result.package.nodes[0].execution.image).toBe(result.image);
    expect(result.package.version).toBe("aaaaaaaaaaaa.123"); expect(result.provenance.dependencyDigests["lock.json"]).toMatch(/^sha256:/);
    profile.dockerfile = "../image.json"; await writeProfile(); expect(() => run("prepare")).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
