import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createControlApplication } from "../../apps/control/application";
import { createWorkloadControl } from "../../apps/control/workload-control";
import { parseWorkloadPlanHelperReply, resolveWorkloadHelperCommand } from "../../apps/control/workload-helper";
import {
  workloadCheckResultSchema,
  workloadApplyResultSchema,
  workloadPlanHelperEnvelopeSchema,
  workloadPlanHelperRequestSchema,
  workloadResolutionSchema,
  workloadSelectedComponentSchema,
  workloadStageResultSchema,
  workloadStatusResultSchema,
  stableJson,
  type WorkloadCheckResult,
} from "../../packages/workload-plan/contracts";
import { SqliteStoreFactory } from "../../tooling/sqlite-store";

const digest = `sha256:${"a".repeat(64)}`;
const hostTargetId = "linux-ubuntu-24.04-x86_64";
const localActor = { id: "local-user", workspaceIds: ["local"], scopes: ["workloads.read", "workloads.install"] };
const selection = { includeComponentIds: [] as string[], excludeComponentIds: [] as string[], choices: {} as Record<string, string> };
const selectedComponents = [{
  componentId: "cyrene-client-workspace-web",
  version: "0.0.1+sha.abcdef1234567890",
  targetId: "linux-ubuntu-24.04-x86_64-web",
  artifactKind: "static-web",
  releaseId: `preview-${"a".repeat(40)}`,
  manifestUri: "https://github.com/DoHorizon-AI/Cyrene-Client/releases/download/preview-test/cyrene-client-workspace-web.manifest.json",
  manifestDigest: digest,
  manifestAssetDigest: digest,
  digest,
  indexIdentity: {
    publisherIdentity: {
      id: "official-client-workspace-web",
      repository: "DoHorizon-AI/Cyrene-Client",
      workflow: "DoHorizon-AI/Cyrene-Client/.github/workflows/workspace-web-release.yml",
      tagFormat: "component-source-sha",
    },
    repository: "DoHorizon-AI/Cyrene-Client",
    assetName: "component-release-index-v1.json",
    assetUri: "https://github.com/DoHorizon-AI/Cyrene-Client/releases/download/preview-test/component-release-index-v1.json",
    assetDigest: digest,
    indexDigest: digest,
    channel: "preview",
    releaseTag: `preview-${"a".repeat(40)}`,
  },
  publisherIdentity: {
    id: "official-client-workspace-web",
    repository: "DoHorizon-AI/Cyrene-Client",
    workflow: "DoHorizon-AI/Cyrene-Client/.github/workflows/workspace-web-release.yml",
    tagFormat: "component-source-sha",
  },
  reason: "workload-required",
  requiredness: "required",
  sourcePolicy: null,
  bindingId: null,
  attestationRef: {
    repository: "DoHorizon-AI/Cyrene-Client",
    workflow: "DoHorizon-AI/Cyrene-Client/.github/workflows/workspace-web-release.yml",
    sourceCommit: "a".repeat(40),
    sourceRef: "refs/heads/develop",
    subjectName: "cyrene-client-workspace-web.tar.gz",
    subjectDigest: digest,
  },
  installed: false,
  installationId: null,
  installedIdentity: null,
  capabilityId: null,
  packageId: null,
}];
function makeResolution(action: "install" | "uninstall" = "install", selectionBinding = selection, catalogDigest = digest) {
  const resolvedComponents = action === "uninstall"
    ? selectedComponents.map(component => ({ ...component, installed: true, installationId: component.artifactKind === "plugin-package" ? "installation-1" : null, installedIdentity: { sourceId: "cyrene-catalyst", componentId: component.componentId, releaseId: component.releaseId, manifestDigest: component.manifestDigest } }))
    : selectedComponents;
  const planDigestMaterial = {
    schemaVersion: 1,
    catalogDigest,
    workloadId: "catalyst",
    action,
    targetId: hostTargetId,
    selectionBinding,
    selectedComponents: resolvedComponents,
    closureReasons: [],
    warnings: [],
    blockers: [],
  };
  const planDigest = `sha256:${createHash("sha256").update(stableJson(planDigestMaterial), "utf8").digest("hex")}`;
  return workloadResolutionSchema.parse({
    ...planDigestMaterial,
    status: "ready",
    planId: `plan-${planDigest.slice("sha256:".length, "sha256:".length + 32)}`,
    planDigest,
    action,
    planDigestMaterial,
  });
}

const resolution = makeResolution();
const plan = workloadCheckResultSchema.parse({
  status: "ready",
  planId: resolution.planId,
  planDigest: resolution.planDigest,
  catalogDigest: resolution.catalogDigest,
  workloadId: resolution.workloadId,
  action: resolution.action,
  targetId: resolution.targetId,
  components: selectedComponents,
  resolution,
  warnings: [],
  blockers: [],
}) as WorkloadCheckResult;
const stagedPlan = workloadStageResultSchema.parse({
  ...plan,
  status: "staged",
  components: resolution.selectedComponents.map(component => ({
    componentId: component.componentId,
    status: "staged",
    artifactKind: component.artifactKind,
    version: component.version,
    digest: component.digest,
    manifestDigest: component.manifestDigest,
    stagedIdentity: { releaseId: component.releaseId },
  })),
});

function makeApplyResult(resolved = resolution) {
  const uninstall = resolved.action === "uninstall";
  return workloadApplyResultSchema.parse({
    status: uninstall ? "uninstalled" : "activated",
    planId: resolved.planId,
    planDigest: resolved.planDigest,
    catalogDigest: resolved.catalogDigest,
    workloadId: resolved.workloadId,
    action: resolved.action,
    targetId: resolved.targetId,
    components: resolved.selectedComponents.map(component => ({
      componentId: component.componentId,
      version: component.version,
      digest: component.digest,
      installationId: component.artifactKind === "plugin-package"
        ? uninstall ? component.installationId : component.installationId ?? "installation-1"
        : null,
      installedIdentity: component.installedIdentity ?? { componentId: component.componentId, installationId: "installation-1" },
    })),
    resolution: resolved,
    warnings: resolved.warnings,
    blockers: resolved.blockers,
  });
}

describe("local workload plan contract and bridge", () => {
  it("requires release identity digests and keeps Package Runtime IDs off typed deployments", () => {
    expect(() => workloadSelectedComponentSchema.parse({ ...selectedComponents[0], releaseId: null })).toThrow();
    expect(() => workloadSelectedComponentSchema.parse({ ...selectedComponents[0], manifestDigest: null })).toThrow();
    expect(() => workloadSelectedComponentSchema.parse({ ...selectedComponents[0], manifestAssetDigest: null })).toThrow();
    expect(() => workloadSelectedComponentSchema.parse({ ...selectedComponents[0], digest: null })).toThrow();
    expect(() => workloadSelectedComponentSchema.parse({ ...selectedComponents[0], installationId: "invented-installation-id" })).toThrow("Package Runtime installation IDs");
    expect(workloadSelectedComponentSchema.safeParse({ ...selectedComponents[0], bindingId: "catalog/binding" }).success).toBe(false);
  });

  it("requires install candidates to carry the verified catalog publisher and index", () => {
    for (const field of ["publisherIdentity", "indexIdentity"] as const) {
      const invalidResolution = JSON.parse(JSON.stringify(resolution)) as Record<string, any>;
      invalidResolution.selectedComponents[0][field] = null;
      invalidResolution.planDigestMaterial.selectedComponents[0][field] = null;
      const digestValue = `sha256:${createHash("sha256").update(stableJson(invalidResolution.planDigestMaterial), "utf8").digest("hex")}`;
      invalidResolution.planDigest = digestValue;
      invalidResolution.planId = `plan-${digestValue.slice("sha256:".length, "sha256:".length + 32)}`;
      expect(() => workloadResolutionSchema.parse(invalidResolution)).toThrow("verified publisher and release index");
    }
  });

  it("uses the fixed Linux workload CLI and refuses other host platforms", () => {
    const ubuntu2404 = 'ID=ubuntu\nVERSION_ID="24.04"\n';
    expect(resolveWorkloadHelperCommand("linux", "x64", ubuntu2404)).toEqual({ executable: "/usr/bin/cyrene", args: ["workload", "--json"] });
    expect(() => resolveWorkloadHelperCommand("win32", "x64", ubuntu2404)).toThrow("Ubuntu 24.04");
    expect(() => resolveWorkloadHelperCommand("darwin", "arm64", "")).toThrow("Ubuntu 24.04");
    expect(() => resolveWorkloadHelperCommand("linux", "arm64", ubuntu2404)).toThrow("x86_64");
    expect(() => resolveWorkloadHelperCommand("linux", "x64", 'ID=debian\nVERSION_ID="12"\n')).toThrow("Ubuntu 24.04");
  });

  it("accepts exactly one UTF-8 JSON reply line for the requested operation", () => {
    const response = JSON.stringify({ protocolVersion: "cyrene.workload-plan.v1", ok: true, operation: "check", result: plan });
    expect(parseWorkloadPlanHelperReply(Buffer.from(`${response}\n`, "utf8"), "check")).toEqual(plan);
    expect(() => parseWorkloadPlanHelperReply(Buffer.from(`${response}\n\n`, "utf8"), "check")).toThrow("单行 JSON");
    expect(() => parseWorkloadPlanHelperReply(Buffer.from([0xff, 0xfe]), "check")).toThrow("UTF-8");
    expect(() => parseWorkloadPlanHelperReply(Buffer.from(response, "utf8"), "stage")).toThrow("协议");
  });

  it("normalizes public selections into the fixed workload-plan protocol", async () => {
    const helper = vi.fn(async () => plan);
    const workloads = createWorkloadControl(helper);

    await workloads.execute({
      name: "workloads.check",
      input: { workloadId: "catalyst", targetId: hostTargetId },
      requestId: "check-1",
    }, localActor);

    expect(helper).toHaveBeenCalledWith({
      protocolVersion: "cyrene.workload-plan.v1",
      operation: "check",
      workloadId: "catalyst",
      targetId: hostTargetId,
      action: "install",
      selections: selection,
    });
  });

  it("binds uninstall selection and action into the existing plan digest", async () => {
    const uninstallSelection = { ...selection, includeComponentIds: ["cyrene-client-workspace-web"] };
    const uninstallResolution = makeResolution("uninstall", uninstallSelection);
    const uninstallPlan = workloadCheckResultSchema.parse({
      ...plan,
      planId: uninstallResolution.planId,
      planDigest: uninstallResolution.planDigest,
      action: uninstallResolution.action,
      components: uninstallResolution.selectedComponents,
      resolution: uninstallResolution,
    });
    const helper = vi.fn(async () => uninstallPlan);
    const workloads = createWorkloadControl(helper);

    const result = await workloads.execute({
      name: "workloads.check",
      input: { workloadId: "catalyst", targetId: hostTargetId, action: "uninstall", selections: uninstallSelection },
      requestId: "uninstall-check",
    }, localActor);
    expect(result).toMatchObject({ planId: uninstallResolution.planId, planDigest: uninstallResolution.planDigest });
    expect(helper).toHaveBeenCalledWith({
      protocolVersion: "cyrene.workload-plan.v1",
      operation: "check",
      workloadId: "catalyst",
      targetId: hostTargetId,
      action: "uninstall",
      selections: uninstallSelection,
    });
    expect(uninstallResolution.planDigest).not.toBe(resolution.planDigest);

    const invalidHelper = vi.fn(async () => plan);
    const invalidControl = createWorkloadControl(invalidHelper);
    await expect(invalidControl.execute({
      name: "workloads.check",
      input: { workloadId: "catalyst", targetId: hostTargetId, action: "uninstall", selections: selection },
      requestId: "uninstall-empty",
    }, localActor)).rejects.toThrow();
    expect(invalidHelper).not.toHaveBeenCalled();

    const uninstallApply = makeApplyResult(uninstallResolution);
    expect(uninstallApply).toMatchObject({ status: "uninstalled", components: [{ installationId: null }] });
    expect(() => workloadApplyResultSchema.parse({ ...uninstallApply, status: "activated" })).toThrow();
    expect(() => workloadApplyResultSchema.parse({
      ...uninstallApply,
      components: [{ ...uninstallApply.components[0], alreadyAbsent: true }],
    })).toThrow("plugin uninstall receipt");
  });

  it("refuses resolver action results that differ from the checked action", async () => {
    const uninstallResolution = makeResolution("uninstall", { ...selection, includeComponentIds: ["cyrene-client-workspace-web"] });
    const mismatchedPlan = workloadCheckResultSchema.parse({
      ...plan,
      planId: uninstallResolution.planId,
      planDigest: uninstallResolution.planDigest,
      action: uninstallResolution.action,
      components: uninstallResolution.selectedComponents,
      resolution: uninstallResolution,
    });
    const control = createWorkloadControl(vi.fn(async () => mismatchedPlan));
    await expect(control.execute({
      name: "workloads.check",
      input: { workloadId: "catalyst", targetId: hostTargetId, action: "install", selections: selection },
      requestId: "action-mismatch",
    }, localActor)).rejects.toMatchObject({ code: "WORKLOAD_ACTION_MISMATCH" });
  });

  it("requires digest-matched explicit confirmation before applying a plan", async () => {
    const helper = vi.fn(async () => plan);
    const workloads = createWorkloadControl(helper);

    await expect(workloads.execute({
      name: "workloads.apply",
      input: {
        workloadId: "catalyst",
        targetId: hostTargetId,
        action: "install",
        selections: selection,
        planId: plan.planId,
        planDigest: plan.planDigest,
        confirmation: { planId: plan.planId, planDigest: `sha256:${"b".repeat(64)}`, confirmed: true },
      },
      requestId: "apply-1",
    }, localActor)).rejects.toThrow();
    expect(helper).not.toHaveBeenCalled();
  });

  it("stages and applies only the exact digest-bound plan", async () => {
    const stageHelper = vi.fn(async () => stagedPlan);
    const stageControl = createWorkloadControl(stageHelper);
    const stageResult = await stageControl.execute({
      name: "workloads.stage",
      input: { workloadId: "catalyst", targetId: hostTargetId, selections: selection, action: "install", planId: plan.planId, planDigest: plan.planDigest },
      requestId: "stage-valid",
    }, localActor);
    expect(stageResult).toMatchObject({ status: "staged", planId: plan.planId, planDigest: plan.planDigest });
    expect(stageHelper).toHaveBeenCalledWith({
      protocolVersion: "cyrene.workload-plan.v1",
      operation: "stage",
      workloadId: "catalyst",
      targetId: hostTargetId,
      action: "install",
      selections: selection,
      planId: plan.planId,
      planDigest: plan.planDigest,
    });

    const appliedPlan = makeApplyResult();
    const applyHelper = vi.fn(async () => appliedPlan);
    const applyControl = createWorkloadControl(applyHelper);
    const applyResult = await applyControl.execute({
      name: "workloads.apply",
      input: {
        workloadId: "catalyst",
        targetId: hostTargetId,
        action: "install",
        selections: selection,
        planId: plan.planId,
        planDigest: plan.planDigest,
        confirmation: { planId: plan.planId, planDigest: plan.planDigest, confirmed: true },
      },
      requestId: "apply-valid",
    }, localActor);
    expect(applyResult).toMatchObject({ status: "activated", planId: plan.planId, planDigest: plan.planDigest });
    expect(applyHelper).toHaveBeenCalledWith({
      protocolVersion: "cyrene.workload-plan.v1",
      operation: "apply",
      workloadId: "catalyst",
      targetId: hostTargetId,
      action: "install",
      selections: selection,
      planId: plan.planId,
      planDigest: plan.planDigest,
      confirmation: { planId: plan.planId, planDigest: plan.planDigest, confirmed: true },
    });
  });

  it("rejects arbitrary workload or component selectors before invoking the CLI", async () => {
    const helper = vi.fn(async () => plan);
    const workloads = createWorkloadControl(helper);

    await expect(workloads.execute({
      name: "workloads.check",
      input: { workloadId: "../shell", targetId: hostTargetId, selections: { ...selection, includeComponentIds: ["../../etc/passwd"] } },
      requestId: "check-2",
    }, localActor)).rejects.toThrow();
    await expect(workloadPlanHelperRequestSchema.parseAsync({
      protocolVersion: "cyrene.workload-plan.v1",
      operation: "apply",
      workloadId: "catalyst",
      targetId: hostTargetId,
      action: "install",
      selections: selection,
      planId: "plan-1",
      planDigest: digest,
      confirmation: { planId: "plan-1", planDigest: `sha256:${"b".repeat(64)}`, confirmed: true },
    })).rejects.toThrow();
    expect(helper).not.toHaveBeenCalled();
  });

  it("validates the deterministic plan ID and exact digest-bearing result shape", () => {
    expect(workloadCheckResultSchema.safeParse({ ...plan, planId: "plan-other" }).success).toBe(false);
    expect(workloadCheckResultSchema.safeParse({ ...plan, unexpected: true }).success).toBe(false);
    expect(workloadCheckResultSchema.safeParse({ ...plan, components: [] }).success).toBe(false);
    expect(workloadPlanHelperEnvelopeSchema.safeParse({ protocolVersion: "cyrene.workload-plan.v1", ok: true, operation: "check", result: plan }).success).toBe(true);
    expect(workloadPlanHelperEnvelopeSchema.safeParse({ protocolVersion: "cyrene.workload-plan.v1", ok: true, operation: "apply", result: plan }).success).toBe(false);
    expect(workloadStatusResultSchema.safeParse({ status: "ready", workloadId: "catalyst", targetId: hostTargetId, catalogGeneration: 1, catalogDigest: digest, components: [] }).success).toBe(true);
    const alteredPolicy = {
      ...selectedComponents[0],
      sourcePolicy: {
        mode: "actualProduct",
        productComponentIds: ["cyrene-catalyst"],
        productSources: [{ componentId: "cyrene-catalyst", sourceId: "cyrene-catalyst" }],
        operations: ["activate"],
      },
      bindingId: "catalog-binding/actual-product/cyrene-catalyst/cyrene-client-workspace-web",
    };
    expect(workloadResolutionSchema.safeParse({
      ...resolution,
      selectedComponents: [alteredPolicy],
      planDigestMaterial: { ...resolution.planDigestMaterial, selectedComponents: [alteredPolicy] },
    }).success).toBe(false);
  });

  it("checks the resolver SHA-256 and prevents staging or applying a changed plan", async () => {
    const forgedDigest = `sha256:${"f".repeat(64)}`;
    const forgedPlan = {
      ...plan,
      planDigest: forgedDigest,
      planId: `plan-${"f".repeat(32)}`,
      resolution: { ...resolution, planDigest: forgedDigest, planId: `plan-${"f".repeat(32)}` },
    };
    const digestControl = createWorkloadControl(vi.fn(async () => forgedPlan as WorkloadCheckResult));
    await expect(digestControl.execute({
      name: "workloads.check",
      input: { workloadId: "catalyst", targetId: hostTargetId },
      requestId: "digest-check",
    }, localActor)).rejects.toMatchObject({ code: "WORKLOAD_PLAN_DIGEST" });

    const alternateResolution = makeResolution("install", selection, `sha256:${"b".repeat(64)}`);
    const alternateStage = workloadStageResultSchema.parse({
      status: "staged",
      planId: alternateResolution.planId,
      planDigest: alternateResolution.planDigest,
      catalogDigest: alternateResolution.catalogDigest,
      workloadId: alternateResolution.workloadId,
      action: alternateResolution.action,
      targetId: alternateResolution.targetId,
      components: alternateResolution.selectedComponents.map(component => ({
        componentId: component.componentId,
        status: "staged",
        artifactKind: component.artifactKind,
        version: component.version,
        digest: component.digest,
        manifestDigest: component.manifestDigest,
        stagedIdentity: { releaseId: component.releaseId },
      })),
      resolution: alternateResolution,
      warnings: alternateResolution.warnings,
      blockers: alternateResolution.blockers,
    });
    const stageControl = createWorkloadControl(vi.fn(async () => alternateStage));
    await expect(stageControl.execute({
      name: "workloads.stage",
      input: { workloadId: "catalyst", targetId: hostTargetId, selections: selection, action: "install", planId: plan.planId, planDigest: plan.planDigest },
      requestId: "changed-stage",
    }, localActor)).rejects.toMatchObject({ code: "WORKLOAD_PLAN_CHANGED" });

    const applyControl = createWorkloadControl(vi.fn(async () => makeApplyResult(alternateResolution)));
    await expect(applyControl.execute({
      name: "workloads.apply",
      input: {
        workloadId: "catalyst",
        targetId: hostTargetId,
        action: "install",
        selections: selection,
        planId: plan.planId,
        planDigest: plan.planDigest,
        confirmation: { planId: plan.planId, planDigest: plan.planDigest, confirmed: true },
      },
      requestId: "changed-apply",
    }, localActor)).rejects.toMatchObject({ code: "WORKLOAD_PLAN_CHANGED" });
  });

  it("serves the plan contract through loopback local Control and preserves read/write scopes", async () => {
    const stores = new SqliteStoreFactory(":memory:");
    const helper = vi.fn(async () => plan);
    const app = createControlApplication({ stores, mode: "local", publicOrigins: ["http://127.0.0.1:5180"], workloadPlanHelper: helper });
    try {
      await app.ready;
      await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
      const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
      const request = (path: string, method = "GET", headers: Record<string, string> = {}, body?: string) => new Promise<{ status: number; json: () => Promise<unknown> }>((resolve, reject) => {
        const outgoing = httpRequest(origin + path, { method, headers: { host: "127.0.0.1:5180", ...headers } }, response => {
          const chunks: Buffer[] = [];
          response.on("data", chunk => chunks.push(Buffer.from(chunk)));
          response.on("end", () => resolve({ status: response.statusCode ?? 0, json: async () => JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
        });
        outgoing.once("error", reject);
        outgoing.end(body);
      });
      const session = await request("/studio-workloads/v1/session");
      expect(session.status).toBe(200);
      const sessionData = await session.json() as { token: string; commands: Array<{ name: string; readOnly: boolean }> };
      expect(sessionData.commands).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "workloads.status", readOnly: true }),
        expect.objectContaining({ name: "workloads.apply", readOnly: false }),
      ]));

      const response = await request("/studio-workloads/v1/commands", "POST", {
        "content-type": "application/json",
        "x-studio-control-token": sessionData.token,
      }, JSON.stringify({ name: "workloads.check", input: { workloadId: "catalyst", targetId: hostTargetId }, requestId: "route-check-1" }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ result: plan });
      expect(helper).toHaveBeenCalledTimes(1);
    } finally {
      app.server.closeAllConnections();
      await new Promise<void>(resolve => app.server.close(() => resolve()));
      await stores.close();
    }
  });

  it("refuses workload staging without local installation scope", async () => {
    const helper = vi.fn(async () => plan);
    const workloads = createWorkloadControl(helper);
    await expect(workloads.execute({
      name: "workloads.stage",
      input: { workloadId: "catalyst", targetId: hostTargetId, selections: selection, action: "install", planId: plan.planId, planDigest: plan.planDigest },
      requestId: "stage-1",
    }, { id: "reader", workspaceIds: ["local"], scopes: ["workloads.read"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(helper).not.toHaveBeenCalled();
  });

  it("does not register local workload installation commands on the team Control BFF", async () => {
    const stores = new SqliteStoreFactory(":memory:");
    const helper = vi.fn(async () => plan);
    const app = createControlApplication({ stores, mode: "team", publicOrigins: ["http://127.0.0.1:5180"], workloadPlanHelper: helper });
    try {
      await app.ready;
      expect(app.workloads).toBeUndefined();
      expect(app.groups.has("/studio-workloads")).toBe(false);
      expect(helper).not.toHaveBeenCalled();
    } finally {
      await stores.close();
    }
  });
});
