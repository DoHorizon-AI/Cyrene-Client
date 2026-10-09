// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 installer.test.ts                                                    │
// │  Module: services/installer                                              │
// │  Role: Unit tests for installer contract helpers and mock plan builder.  │
// │                                                                          │
// │  中文：模块职责：安装器契约辅助函数与 Mock 计划构建器的单元测试。              │
// └─────────────────────────────────────────────────────────────────────────┘
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MOCK_WORKLOAD_CATALOG,
  MOCK_COMPONENT_CATALOG,
  KNOWN_COMPONENT_IDS,
  type ComponentAffinity,
  type InstallationPlan,
  type InstallerOperationStatus,
} from "./contracts";

// ---------------------------------------------------------------------------
// § Catalog integrity
// ---------------------------------------------------------------------------

describe("MOCK_WORKLOAD_CATALOG", () => {
  it("contains the Catalyst workload", () => {
    const catalyst = MOCK_WORKLOAD_CATALOG.workloads.find((w) => w.id === "catalyst");
    expect(catalyst).toBeDefined();
    expect(catalyst!.name).toBe("Catalyst");
  });

  it("contains the Echo workload", () => {
    const echo = MOCK_WORKLOAD_CATALOG.workloads.find((w) => w.id === "echo");
    expect(echo).toBeDefined();
    expect(echo!.name).toBe("Echo");
  });

  it("Catalyst workload has dataset-preparation as required", () => {
    const catalyst = MOCK_WORKLOAD_CATALOG.workloads.find((w) => w.id === "catalyst")!;
    const entry = catalyst.components.find((c) => c.componentId === KNOWN_COMPONENT_IDS.datasetPreparation);
    expect(entry).toBeDefined();
    expect(entry!.affinity).toBe("required");
  });

  it("Echo workload has exact-match as required", () => {
    const echo = MOCK_WORKLOAD_CATALOG.workloads.find((w) => w.id === "echo")!;
    const entry = echo.components.find((c) => c.componentId === KNOWN_COMPONENT_IDS.exactMatch);
    expect(entry).toBeDefined();
    expect(entry!.affinity).toBe("required");
  });

  it("all component ids in workloads exist in component catalog", () => {
    const catalogIds = new Set(MOCK_COMPONENT_CATALOG.components.map((c) => c.id));
    for (const wl of MOCK_WORKLOAD_CATALOG.workloads) {
      for (const entry of wl.components) {
        expect(catalogIds.has(entry.componentId), `${entry.componentId} not in catalog`).toBe(true);
      }
    }
  });

  it("each workload has a bilingual description", () => {
    for (const wl of MOCK_WORKLOAD_CATALOG.workloads) {
      expect(typeof wl.description).toBe("string");
      expect(wl.description.length).toBeGreaterThan(0);
      expect(typeof wl.descriptionCn).toBe("string");
    }
  });
});

describe("MOCK_COMPONENT_CATALOG", () => {
  it("lists all known component IDs", () => {
    const ids = new Set(MOCK_COMPONENT_CATALOG.components.map((c) => c.id));
    for (const id of Object.values(KNOWN_COMPONENT_IDS)) {
      expect(ids.has(id), `${id} missing from catalog`).toBe(true);
    }
  });

  it("dataset-preparation reports supported platforms including linux, windows, darwin", () => {
    const comp = MOCK_COMPONENT_CATALOG.components.find(
      (c) => c.id === KNOWN_COMPONENT_IDS.datasetPreparation,
    )!;
    expect(comp.supportedPlatforms).toContain("linux");
    expect(comp.supportedPlatforms).toContain("windows");
    expect(comp.supportedPlatforms).toContain("darwin");
  });

  it("each component has a name and description", () => {
    for (const comp of MOCK_COMPONENT_CATALOG.components) {
      expect(comp.name.length, `${comp.id} missing name`).toBeGreaterThan(0);
      expect(comp.description.length, `${comp.id} missing description`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// § Affinity resolution logic (pure)
// ---------------------------------------------------------------------------

function affinityRank(a: ComponentAffinity): number {
  return a === "required" ? 3 : a === "recommended" ? 2 : 1;
}

describe("affinityRank", () => {
  it("ranks required > recommended > optional", () => {
    expect(affinityRank("required")).toBeGreaterThan(affinityRank("recommended"));
    expect(affinityRank("recommended")).toBeGreaterThan(affinityRank("optional"));
  });
});

// ---------------------------------------------------------------------------
// § Selection resolution
// ---------------------------------------------------------------------------

function resolveComponentSelection(
  selectedWorkloadIds: ReadonlySet<string>,
  excludedRecommendedComponentIds: ReadonlySet<string>,
  manualComponentIds: ReadonlySet<string>,
  workloads: typeof MOCK_WORKLOAD_CATALOG.workloads,
) {
  const result = new Map<string, { affinity: ComponentAffinity | "manual"; fromWorkloads: string[] }>();
  for (const wl of workloads) {
    if (!selectedWorkloadIds.has(wl.id)) continue;
    for (const entry of wl.components) {
      if (entry.affinity === "optional") {
        if (!manualComponentIds.has(entry.componentId)) continue;
      }
      if (entry.affinity === "recommended" && excludedRecommendedComponentIds.has(entry.componentId)) {
        continue;
      }
      const existing = result.get(entry.componentId);
      if (!existing) {
        result.set(entry.componentId, { affinity: entry.affinity, fromWorkloads: [wl.id] });
      } else {
        const stronger = affinityRank(entry.affinity) > affinityRank(existing.affinity as ComponentAffinity)
          ? entry.affinity : existing.affinity;
        result.set(entry.componentId, { affinity: stronger, fromWorkloads: [...existing.fromWorkloads, wl.id] });
      }
    }
  }
  for (const id of manualComponentIds) {
    if (!result.has(id)) result.set(id, { affinity: "optional", fromWorkloads: [] });
  }
  return result;
}

describe("resolveComponentSelection", () => {
  const workloads = MOCK_WORKLOAD_CATALOG.workloads;

  it("selecting Catalyst includes documentParsing and datasetPreparation as required", () => {
    const sel = resolveComponentSelection(new Set(["catalyst"]), new Set(), new Set(), workloads);
    expect(sel.get(KNOWN_COMPONENT_IDS.documentParsing)?.affinity).toBe("required");
    expect(sel.get(KNOWN_COMPONENT_IDS.datasetPreparation)?.affinity).toBe("required");
  });

  it("selecting Catalyst includes recommended components by default", () => {
    const sel = resolveComponentSelection(new Set(["catalyst"]), new Set(), new Set(), workloads);
    expect(sel.get(KNOWN_COMPONENT_IDS.knowledgePreparation)?.affinity).toBe("recommended");
    expect(sel.get(KNOWN_COMPONENT_IDS.datasetGeneration)?.affinity).toBe("recommended");
  });

  it("recommended components can be excluded without blocking other components", () => {
    const excluded = new Set([KNOWN_COMPONENT_IDS.knowledgePreparation]);
    const sel = resolveComponentSelection(new Set(["catalyst"]), excluded, new Set(), workloads);
    expect(sel.has(KNOWN_COMPONENT_IDS.knowledgePreparation)).toBe(false);
    expect(sel.get(KNOWN_COMPONENT_IDS.datasetPreparation)?.affinity).toBe("required");
    expect(sel.get(KNOWN_COMPONENT_IDS.datasetGeneration)?.affinity).toBe("recommended");
  });

  it("selecting Echo includes exact-match as required and evaluator-pack as recommended", () => {
    const sel = resolveComponentSelection(new Set(["echo"]), new Set(), new Set(), workloads);
    expect(sel.get(KNOWN_COMPONENT_IDS.exactMatch)?.affinity).toBe("required");
    expect(sel.get(KNOWN_COMPONENT_IDS.evaluatorPack)?.affinity).toBe("recommended");
  });

  it("manually adding a component not in workloads marks it optional", () => {
    const sel = resolveComponentSelection(new Set(), new Set(), new Set([KNOWN_COMPONENT_IDS.vllmRuntime]), workloads);
    expect(sel.get(KNOWN_COMPONENT_IDS.vllmRuntime)?.affinity).toBe("optional");
  });

  it("component required by workload cannot be downgraded by manual toggle", () => {
    const sel = resolveComponentSelection(
      new Set(["catalyst"]),
      new Set(),
      new Set([KNOWN_COMPONENT_IDS.datasetPreparation]),
      workloads,
    );
    expect(sel.get(KNOWN_COMPONENT_IDS.datasetPreparation)?.affinity).toBe("required");
  });

  it("selecting both Catalyst and Echo unions all required and recommended components", () => {
    const sel = resolveComponentSelection(new Set(["catalyst", "echo"]), new Set(), new Set(), workloads);
    expect(sel.has(KNOWN_COMPONENT_IDS.documentParsing)).toBe(true);
    expect(sel.has(KNOWN_COMPONENT_IDS.datasetPreparation)).toBe(true);
    expect(sel.has(KNOWN_COMPONENT_IDS.exactMatch)).toBe(true);
    expect(sel.has(KNOWN_COMPONENT_IDS.evaluatorPack)).toBe(true);
  });

  it("empty selection returns empty map", () => {
    const sel = resolveComponentSelection(new Set(), new Set(), new Set(), workloads);
    expect(sel.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// § Provider Layer Tests
// ---------------------------------------------------------------------------

import {
  DemoInstallerProvider,
  RealInstallerProvider,
  NotConnectedError,
  OperationNotPermittedError,
  PermissionDeniedError,
  PlanExpiredOrConflictError,
} from "./provider";
import { installerText } from "./copy";

describe("DemoInstallerProvider", () => {
  const provider = new DemoInstallerProvider();

  it("is marked as demo and not connected", () => {
    expect(provider.isDemo).toBe(true);
    expect(provider.isConnected).toBe(false);
  });

  it("returns workload and component catalogs", async () => {
    const workloads = await provider.getWorkloadCatalog();
    const components = await provider.getComponentCatalog();
    expect(workloads.workloads.length).toBeGreaterThan(0);
    expect(components.components.length).toBeGreaterThan(0);
  });

  it("resolves plan with targetPlatform as null (never guessing from navigator.platform)", async () => {
    const plan = await provider.resolvePlan({
      workloadIds: ["catalyst"],
      manualComponentIds: [],
    });
    expect(plan.planId).toMatch(/^demo-preview-/);
    expect(plan.targetPlatform).toBeNull();
    expect(plan.deploymentMode).toBeNull();
    expect(plan.components.length).toBeGreaterThan(0);
  });

  it("executePlan rejects in demo mode", async () => {
    await expect(provider.executePlan("test-plan")).rejects.toThrow(OperationNotPermittedError);
  });

  it("executeComponentOperation rejects in demo mode", async () => {
    await expect(
      provider.executeComponentOperation({
        componentId: KNOWN_COMPONENT_IDS.documentParsing,
        operation: "install",
      }),
    ).rejects.toThrow(OperationNotPermittedError);
  });

  it("returns managed components with unknown retention policy and no allowed operations", async () => {
    const managed = await provider.getManagedComponents();
    expect(managed.length).toBeGreaterThan(0);
    for (const item of managed) {
      expect(item.allowedOperations).toEqual([]);
      expect(item.retentionPolicyOnUninstall).toBe("unknown");
    }
  });
});

describe("RealInstallerProvider", () => {
  const originalFetch = globalThis.fetch;
  const mockDigest = `sha256:${"a".repeat(64)}`;
  const mockPlanId = `plan-${"a".repeat(32)}`;
  const mockSession = {
    token: "csrf-token-123",
    workspaceId: "local",
    mode: "local",
    actor: { id: "local-user", scopes: ["workloads.read", "workloads.install"] },
    commands: [
      { name: "workloads.status", endpoint: "/studio-workloads/v1/commands", readOnly: true },
      { name: "workloads.check", endpoint: "/studio-workloads/v1/commands", readOnly: true },
      { name: "workloads.stage", endpoint: "/studio-workloads/v1/commands", readOnly: false },
      { name: "workloads.apply", endpoint: "/studio-workloads/v1/commands", readOnly: false },
    ],
  };

  const mockCatalystStatus = {
    status: "ready",
    workloadId: "catalyst",
    targetId: "linux-ubuntu-24.04-x86_64",
    catalogGeneration: 1,
    catalogDigest: mockDigest,
    components: [
      { componentId: "cyrene.tools.dataset-preparation", installed: false, version: "0.2.0", digest: mockDigest, verification: true },
    ],
  };

  const mockEchoStatus = {
    status: "ready",
    workloadId: "echo",
    targetId: "linux-ubuntu-24.04-x86_64",
    catalogGeneration: 1,
    catalogDigest: mockDigest,
    components: [
      { componentId: "cyrene.evaluation.exact-match", installed: false, version: "0.1.0", digest: mockDigest, verification: true },
    ],
  };

  const mockCheckReady = {
    status: "ready",
    planId: mockPlanId,
    planDigest: mockDigest,
    catalogDigest: mockDigest,
    workloadId: "catalyst",
    action: "install",
    targetId: "linux-ubuntu-24.04-x86_64",
    resolution: {
      schemaVersion: 1,
      status: "ready",
      planId: mockPlanId,
      planDigest: mockDigest,
      catalogDigest: mockDigest,
      workloadId: "catalyst",
      action: "install",
      targetId: "linux-ubuntu-24.04-x86_64",
      selectedComponents: [],
      closureReasons: [],
      warnings: [],
      blockers: [],
      selectionBinding: { includeComponentIds: [], excludeComponentIds: [], choices: {} },
      planDigestMaterial: {} as any,
    },
    warnings: [],
    blockers: [],
    components: [
      {
        componentId: "cyrene.tools.dataset-preparation",
        version: "0.2.0",
        targetId: "linux-ubuntu-24.04-x86_64",
        artifactKind: "python-package",
        releaseId: "preview-1",
        manifestUri: "https://example.com/manifest.json",
        manifestDigest: mockDigest,
        manifestAssetDigest: mockDigest,
        digest: mockDigest,
        indexIdentity: null,
        publisherIdentity: null,
        reason: "workload-required",
        requiredness: "required",
        sourcePolicy: null,
        attestationRef: null,
        installed: false,
        installationId: null,
        installedIdentity: null,
        capabilityId: null,
        packageId: null,
        bindingId: null,
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("unconfigured provider throws NotConnectedError on fetch", async () => {
    const provider = new RealInstallerProvider({ prefix: "", baseUrl: "" });
    expect(provider.isConnected).toBe(false);
    expect(provider.isConfigured).toBe(false);
    await expect(provider.getWorkloadCatalog()).rejects.toThrow(NotConnectedError);
  });

  it("error classes carry correct names and messages", () => {
    const connErr = new NotConnectedError("custom msg");
    expect(connErr.name).toBe("NotConnectedError");
    expect(connErr.message).toBe("custom msg");

    const permErr = new PermissionDeniedError("forbidden");
    expect(permErr.name).toBe("PermissionDeniedError");

    const confErr = new PlanExpiredOrConflictError("conflict");
    expect(confErr.name).toBe("PlanExpiredOrConflictError");

    const opErr = new OperationNotPermittedError("not permitted");
    expect(opErr.name).toBe("OperationNotPermittedError");
  });

  it("verifies connection via /v1/session and checks actor workloads.read scope", async () => {
    const provider = new RealInstallerProvider({ prefix: "/studio-workloads" });
    expect(provider.isConfigured).toBe(true);
    expect(provider.isConnected).toBe(false);

    // Mock successful session retrieval
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockSession), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const verified = await provider.verifyConnection();
    expect(verified).toBe(true);
    expect(provider.isConnected).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/studio-workloads/v1/session",
      expect.objectContaining({ method: "GET" }),
    );

    // Failing session returns unverified
    const failingProvider = new RealInstallerProvider({ prefix: "/studio-workloads" });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Service Unavailable", { status: 503 }));
    const failVerified = await failingProvider.verifyConnection();
    expect(failVerified).toBe(false);
    expect(failingProvider.isConnected).toBe(false);
  });

  it("unconnected/unverified provider causes zero real installation side-effects", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({ prefix: "/studio-workloads" });
    expect(provider.isConnected).toBe(false);

    await expect(provider.executePlan("plan-test")).rejects.toThrow(NotConnectedError);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      provider.executeComponentOperation({ componentId: "comp-1", operation: "install" }),
    ).rejects.toThrow(NotConnectedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches real workload status (workloads.status) with control token", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(
          new Response(JSON.stringify(mockSession), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/v1/commands")) {
        const body = JSON.parse(init?.body as string);
        expect(init?.headers).toMatchObject({
          "x-studio-control-token": "csrf-token-123",
          Authorization: "Bearer token-abc",
        });
        if (body.name === "workloads.status") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ result: body.input.workloadId === "echo" ? mockEchoStatus : mockCatalystStatus }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({
      prefix: "/studio-workloads",
      authToken: "token-abc",
    });

    const catalog = await provider.getWorkloadCatalog();
    expect(catalog.workloads.length).toBe(2);
    expect(catalog.workloads.find((w) => w.id === "catalyst")).toBeDefined();
    expect(catalog.workloads.find((w) => w.id === "echo")).toBeDefined();

    const components = await provider.getComponentCatalog();
    expect(components.components.length).toBeGreaterThan(0);
    expect(components.components.some((c) => c.id === "cyrene.tools.dataset-preparation")).toBe(true);
  });

  it("checks plan (workloads.check) and handles ready vs blocked states", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(mockSession), { status: 200 }));
      }
      if (url.endsWith("/v1/commands")) {
        const body = JSON.parse(init?.body as string);
        if (body.name === "workloads.check") {
          if (body.input.workloadId === "blocked-workload") {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  result: {
                    ...mockCheckReady,
                    status: "blocked",
                    blockers: [
                      {
                        code: "DEPENDENCY_MISSING",
                        componentId: "dep-1",
                        message: "Required dependency missing on host",
                        retryable: false,
                        capabilityId: null,
                        requiredness: "required",
                        targetId: null,
                        details: {},
                      },
                    ],
                  },
                }),
                { status: 200 },
              ),
            );
          }
          return Promise.resolve(new Response(JSON.stringify({ result: mockCheckReady }), { status: 200 }));
        }
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({ prefix: "/studio-workloads" });

    // Ready plan
    const readyPlan = await provider.resolvePlan({ workloadIds: ["catalyst"], manualComponentIds: [] });
    expect(readyPlan.status).toBe("ready");
    expect(readyPlan.planId).toBe(mockPlanId);
    expect(readyPlan.planDigest).toBe(mockDigest);
    expect(readyPlan.components.length).toBe(1);

    // Blocked plan
    const blockedPlan = await provider.resolvePlan({ workloadIds: ["blocked-workload"], manualComponentIds: [] });
    expect(blockedPlan.status).toBe("blocked");
    expect(blockedPlan.blockers?.length).toBe(1);
    expect(blockedPlan.blockers?.[0].code).toBe("DEPENDENCY_MISSING");
  });

  it("stages and applies workload plan with identical planId and planDigest", async () => {
    const recordedCommands: any[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(mockSession), { status: 200 }));
      }
      if (url.endsWith("/v1/commands")) {
        const body = JSON.parse(init?.body as string);
        recordedCommands.push(body);
        if (body.name === "workloads.check") {
          return Promise.resolve(new Response(JSON.stringify({ result: mockCheckReady }), { status: 200 }));
        }
        if (body.name === "workloads.stage") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                result: {
                  status: "staged",
                  planId: body.input.planId,
                  planDigest: body.input.planDigest,
                  catalogDigest: mockDigest,
                  workloadId: body.input.workloadId,
                  action: "install",
                  targetId: body.input.targetId,
                  resolution: mockCheckReady.resolution,
                  warnings: [],
                  blockers: [],
                  components: [{ componentId: "cyrene.tools.dataset-preparation", status: "staged" }],
                },
              }),
              { status: 200 },
            ),
          );
        }
        if (body.name === "workloads.apply") {
          // Verify confirmation matches planId and planDigest
          expect(body.input.confirmation.planId).toBe(body.input.planId);
          expect(body.input.confirmation.planDigest).toBe(body.input.planDigest);
          expect(body.input.confirmation.confirmed).toBe(true);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                result: {
                  status: "installed",
                  planId: body.input.planId,
                  planDigest: body.input.planDigest,
                  catalogDigest: mockDigest,
                  workloadId: body.input.workloadId,
                  action: "install",
                  targetId: body.input.targetId,
                  components: mockCheckReady.components,
                  resolution: mockCheckReady.resolution,
                  warnings: [],
                  blockers: [],
                },
              }),
              { status: 200 },
            ),
          );
        }
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({ prefix: "/studio-workloads", verified: true });
    const plan = await provider.resolvePlan({ workloadIds: ["catalyst"], manualComponentIds: [] });
    const opStatus = await provider.executePlan(plan.planId);

    expect(opStatus.phase).toBe("succeeded");
    expect(recordedCommands.map((c) => c.name)).toEqual(["workloads.check", "workloads.stage", "workloads.apply"]);

    const stageCommand = recordedCommands.find((c) => c.name === "workloads.stage");
    const applyCommand = recordedCommands.find((c) => c.name === "workloads.apply");
    expect(stageCommand.input.planId).toBe(plan.planId);
    expect(stageCommand.input.planDigest).toBe(plan.planDigest);
    expect(applyCommand.input.planId).toBe(plan.planId);
    expect(applyCommand.input.planDigest).toBe(plan.planDigest);
  });

  it("handles stage or apply failure without faking success", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(mockSession), { status: 200 }));
      }
      if (url.endsWith("/v1/commands")) {
        const body = JSON.parse(init?.body as string);
        if (body.name === "workloads.stage") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: { message: "Package verification signature invalid" } }),
              { status: 500 },
            ),
          );
        }
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({ prefix: "/studio-workloads", verified: true });
    await expect(provider.executePlan(mockPlanId)).rejects.toThrow("Package verification signature invalid");
  });

  it("rejects plan ID / digest mismatch from backend (WORKLOAD_PLAN_DIGEST)", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(mockSession), { status: 200 }));
      }
      if (url.endsWith("/v1/commands")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: "本机 workload CLI 返回的计划摘要与解析内容不匹配。" } }),
            { status: 502 },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({ prefix: "/studio-workloads", verified: true });
    await expect(provider.executePlan(mockPlanId)).rejects.toThrow(/计划摘要与解析内容不匹配/);
  });

  it("handles 409 conflict and stale plan (WORKLOAD_PLAN_CHANGED)", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(mockSession), { status: 200 }));
      }
      if (url.endsWith("/v1/commands")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: "计划已变化；请重新检查并确认最新计划。" } }),
            { status: 409 },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({ prefix: "/studio-workloads", verified: true });

    // Server-side 409 conflict throws PlanExpiredOrConflictError
    await expect(provider.executePlan(mockPlanId)).rejects.toThrow(PlanExpiredOrConflictError);

    // Client-side expiry validation prohibits network call
    const expiredTimestamp = new Date(Date.now() - 30_000).toISOString();
    await expect(
      provider.executePlan(mockPlanId, undefined, { expiresAt: expiredTimestamp }),
    ).rejects.toThrow(PlanExpiredOrConflictError);
  });

  it("handles unauthorized user (401/403) and missing required scope", async () => {
    // 403 on session
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const provider = new RealInstallerProvider({ prefix: "/studio-workloads" });
    await expect(provider.getWorkloadCatalog()).rejects.toThrow(PermissionDeniedError);

    // Actor lacking workloads.install scope
    const readOnlySession = {
      ...mockSession,
      actor: { id: "readonly-user", scopes: ["workloads.read"] },
    };
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(readOnlySession), { status: 200 }));
      }
      return Promise.reject(new Error(`Unexpected ${url}`));
    });

    const readOnlyProvider = new RealInstallerProvider({ prefix: "/studio-workloads", verified: true });
    await expect(readOnlyProvider.executePlan(mockPlanId)).rejects.toThrow(PermissionDeniedError);
  });

  it("handles connection interruption and network failure distinctly", async () => {
    // Network interruption (TypeError)
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const provider = new RealInstallerProvider({ prefix: "/studio-workloads" });
    await expect(provider.getWorkloadCatalog()).rejects.toThrow(NotConnectedError);

    // 500 Server error
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(mockSession), { status: 200 }));
      }
      return Promise.resolve(new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }));
    });
    await expect(provider.getWorkloadCatalog()).rejects.toThrow(/server error|500/i);
  });

  it("truthfully reports partial component installation success in multi-workload without fake atomicity", async () => {
    let executedWorkload: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(mockSession), { status: 200 }));
      }
      if (url.endsWith("/v1/commands")) {
        const body = JSON.parse(init?.body as string);
        if (body.name === "workloads.check") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ result: { ...mockCheckReady, workloadId: body.input.workloadId } }),
              { status: 200 },
            ),
          );
        }
        if (body.name === "workloads.stage" || body.name === "workloads.apply") {
          if (body.input.workloadId === "catalyst") {
            executedWorkload.push(`catalyst-${body.name}`);
            return Promise.resolve(new Response(JSON.stringify({ result: { status: "installed" } }), { status: 200 }));
          }
          if (body.input.workloadId === "echo") {
            // Echo fails during apply!
            return Promise.resolve(
              new Response(
                JSON.stringify({ error: { message: "Disk full on /var/cyrene/echo" } }),
                { status: 500 },
              ),
            );
          }
        }
      }
      return Promise.reject(new Error(`Unexpected ${url}`));
    });
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({ prefix: "/studio-workloads", verified: true });
    const multiPlan = await provider.resolvePlan({ workloadIds: ["catalyst", "echo"], manualComponentIds: [] });

    await expect(provider.executePlan(multiPlan.planId)).rejects.toThrow(
      /Partial installation.*catalyst.*succeeded.*echo.*failed/i,
    );
  });

  it("manages components lifecycle and prohibits unsupported operations", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(mockSession), { status: 200 }));
      }
      if (url.endsWith("/v1/commands")) {
        const body = JSON.parse(init?.body as string);
        if (body.name === "workloads.status") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                result: {
                  ...mockCatalystStatus,
                  components: [
                    { componentId: "cyrene.tools.dataset-preparation", installed: true, version: "0.2.0" },
                  ],
                },
              }),
              { status: 200 },
            ),
          );
        }
        if (body.name === "workloads.check") {
          return Promise.resolve(new Response(JSON.stringify({ result: mockCheckReady }), { status: 200 }));
        }
        if (body.name === "workloads.stage" || body.name === "workloads.apply") {
          return Promise.resolve(new Response(JSON.stringify({ result: { status: "uninstalled" } }), { status: 200 }));
        }
      }
      return Promise.reject(new Error(`Unexpected ${url}`));
    });
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({ prefix: "/studio-workloads", verified: true });
    const managed = await provider.getManagedComponents();
    const installedComp = managed.find((c) => c.id === "cyrene.tools.dataset-preparation");
    expect(installedComp).toBeDefined();
    expect(installedComp?.allowedOperations).toEqual(["uninstall"]);

    // Unsupported operations are strictly blocked with OperationNotPermittedError
    await expect(
      provider.executeComponentOperation({ componentId: "cyrene.tools.dataset-preparation", operation: "update" }),
    ).rejects.toThrow(OperationNotPermittedError);

    await expect(
      provider.executeComponentOperation({ componentId: "cyrene.tools.dataset-preparation", operation: "rollback" }),
    ).rejects.toThrow(OperationNotPermittedError);

    // Uninstall executes check -> stage -> apply
    const uninstallRes = await provider.executeComponentOperation({
      componentId: "cyrene.tools.dataset-preparation",
      operation: "uninstall",
    });
    expect(uninstallRes.kind).toBe("uninstall");
    expect(uninstallRes.phase).toBe("succeeded");
  });

  it("enters progress view ONLY after execution is accepted by backend", async () => {
    let currentStep: "plan" | "progress" = "plan";
    let inPageError: string | null = null;
    let operationId: string | null = null;

    const handleInstallFlow = async (
      provider: RealInstallerProvider,
      plan: InstallationPlan,
    ) => {
      if (provider.isDemo || !provider.isConnected) {
        inPageError = "Operation disabled in demo mode.";
        return;
      }
      if (plan.expiresAt && new Date(plan.expiresAt).getTime() <= Date.now()) {
        inPageError = "The installation plan has expired.";
        return;
      }

      try {
        const res = await provider.executePlan(plan.planId, undefined, { expiresAt: plan.expiresAt });
        if (!res || !res.operationId) {
          throw new Error("No operation ID returned");
        }
        operationId = res.operationId;
        currentStep = "progress";
      } catch (err: unknown) {
        inPageError = err instanceof Error ? err.message : String(err);
      }
    };

    const validPlan: InstallationPlan = {
      planId: "p1",
      catalogGeneration: 1,
      workloadIds: [],
      additionalComponentIds: [],
      components: [],
      totalDownloadBytes: 100,
      targetPlatform: null,
      deploymentMode: null,
      permissionsRequired: [],
      knownLimitations: [],
      alreadyInstalledComponentIds: [],
      resolvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    // Case 1: unverified provider -> remains on plan view
    const unverifiedProvider = new RealInstallerProvider({ prefix: "/studio-workloads" });
    await handleInstallFlow(unverifiedProvider, validPlan);
    expect(currentStep).toBe("plan");
    expect(inPageError).toContain("Operation disabled");
    expect(operationId).toBeNull();

    // Case 2: verified provider but execution fails (500) -> remains on plan view
    inPageError = null;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(mockSession), { status: 200 }));
      }
      return Promise.resolve(new Response("Server Error", { status: 500, statusText: "Internal Server Error" }));
    });
    const verifiedProvider = new RealInstallerProvider({ prefix: "/studio-workloads", verified: true });
    await handleInstallFlow(verifiedProvider, validPlan);
    expect(currentStep).toBe("plan");
    expect(inPageError).toMatch(/server error|500/i);
    expect(operationId).toBeNull();

    // Case 3: execution accepted -> switches to progress
    inPageError = null;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/v1/session")) {
        return Promise.resolve(new Response(JSON.stringify(mockSession), { status: 200 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ result: { status: "installed" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    await handleInstallFlow(verifiedProvider, validPlan);
    expect(currentStep).toBe("progress");
    expect(inPageError).toBeNull();
    expect(operationId).toBeTruthy();
  });
});

describe("Bilingual copy table", () => {
  it("translates error and safety keys in zh-CN", () => {
    expect(installerText("Permission denied", "zh-CN")).toBe("权限不足");
    expect(installerText("Network interruption", "zh-CN")).toBe("网络中断");
    expect(installerText("TBD", "zh-CN")).toBe("待确定");
    expect(installerText("Restore", "zh-CN")).toBe("恢复");
  });

  it("returns English original for non-zh locale", () => {
    expect(installerText("Permission denied", "en-US")).toBe("Permission denied");
    expect(installerText("Restore", "en-US")).toBe("Restore");
  });
});

