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

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("unconfigured provider throws NotConnectedError on fetch", async () => {
    const provider = new RealInstallerProvider({ baseUrl: "" });
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
  });

  it("distinguishes between configured baseUrl and verified service availability", async () => {
    const provider = new RealInstallerProvider({ baseUrl: "https://installer.api/v1" });
    // Configured baseUrl alone does NOT mean connected/verified
    expect(provider.isConfigured).toBe(true);
    expect(provider.isConnected).toBe(false);

    // Mock successful healthcheck
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "healthy" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const verified = await provider.verifyConnection();
    expect(verified).toBe(true);
    expect(provider.isConnected).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://installer.api/v1/health",
      expect.objectContaining({ method: "GET" }),
    );

    // Failed healthcheck leaves provider unverified
    const failingProvider = new RealInstallerProvider({ baseUrl: "https://installer.api/v1" });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );
    const failVerified = await failingProvider.verifyConnection();
    expect(failVerified).toBe(false);
    expect(failingProvider.isConnected).toBe(false);
  });

  it("unconnected/unverified provider causes zero real installation side-effects", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({ baseUrl: "https://installer.api/v1" });
    expect(provider.isConnected).toBe(false);

    // executePlan must reject without calling fetch
    await expect(provider.executePlan("plan-test")).rejects.toThrow(NotConnectedError);
    expect(fetchMock).not.toHaveBeenCalled();

    // executeComponentOperation must reject without calling fetch
    await expect(
      provider.executeComponentOperation({ componentId: "comp-1", operation: "install" }),
    ).rejects.toThrow(NotConnectedError);
    expect(fetchMock).not.toHaveBeenCalled();

    // stream remains closed and reports error without calling fetch
    let streamError: Error | null = null;
    const unsub = provider.getOperationStream(
      "op-1",
      () => {},
      (err) => {
        streamError = err;
      },
    );
    expect(streamError).toBeInstanceOf(NotConnectedError);
    expect(fetchMock).not.toHaveBeenCalled();
    unsub();
  });

  it("fetches workload/component catalogs and resolves plan with Authorization header", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/workloads")) {
        return Promise.resolve(
          new Response(JSON.stringify(MOCK_WORKLOAD_CATALOG), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/components")) {
        return Promise.resolve(
          new Response(JSON.stringify(MOCK_COMPONENT_CATALOG), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/plans/resolve")) {
        const plan: InstallationPlan = {
          planId: "plan-resolved-1",
          catalogGeneration: 1,
          workloadIds: ["catalyst"],
          additionalComponentIds: [],
          components: [],
          totalDownloadBytes: 5000,
          targetPlatform: { os: "linux", architecture: "x86_64" },
          deploymentMode: "container",
          permissionsRequired: [],
          knownLimitations: [],
          alreadyInstalledComponentIds: [],
          resolvedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
        return Promise.resolve(
          new Response(JSON.stringify(plan), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({
      baseUrl: "https://installer.api/v1",
      authToken: "bearer-token-123",
    });

    const workloads = await provider.getWorkloadCatalog();
    expect(workloads.workloads.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://installer.api/v1/workloads",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer bearer-token-123",
        }),
      }),
    );

    const components = await provider.getComponentCatalog();
    expect(components.components.length).toBeGreaterThan(0);

    const resolved = await provider.resolvePlan({
      workloadIds: ["catalyst"],
      manualComponentIds: [],
    });
    expect(resolved.planId).toBe("plan-resolved-1");
    expect(resolved.targetPlatform?.os).toBe("linux");
  });

  it("handles 401 and 403 PermissionDeniedError", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const provider = new RealInstallerProvider({ baseUrl: "https://installer.api/v1" });
    await expect(provider.getWorkloadCatalog()).rejects.toThrow(PermissionDeniedError);

    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await expect(provider.getComponentCatalog()).rejects.toThrow(PermissionDeniedError);
  });

  it("handles 409 PlanExpiredOrConflictError", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Conflict", { status: 409 }));
    const provider = new RealInstallerProvider({ baseUrl: "https://installer.api/v1", verified: true });
    await expect(
      provider.resolvePlan({ workloadIds: [], manualComponentIds: [] }),
    ).rejects.toThrow(PlanExpiredOrConflictError);

    await expect(provider.executePlan("plan-expired-server")).rejects.toThrow(PlanExpiredOrConflictError);
  });

  it("handles 500 Internal Server Error and network interruption distinctly", async () => {
    // 500 Internal Server Error
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
    );
    const provider = new RealInstallerProvider({ baseUrl: "https://installer.api/v1" });
    await expect(provider.getWorkloadCatalog()).rejects.toThrow(/server error|500/i);

    // Network interruption (TypeError / fetch rejection)
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(provider.getWorkloadCatalog()).rejects.toThrow(NotConnectedError);
  });

  it("prohibits execution of stale/expired plans", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({ baseUrl: "https://installer.api/v1", verified: true });
    const expiredTimestamp = new Date(Date.now() - 30_000).toISOString();

    // Client-side expiry check prevents network call
    await expect(
      provider.executePlan("plan-old", undefined, { expiresAt: expiredTimestamp }),
    ).rejects.toThrow(PlanExpiredOrConflictError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("executes valid plan when verified and backend returns operation status", async () => {
    const opStatus: InstallerOperationStatus = {
      operationId: "op-101",
      kind: "install",
      componentId: "cyrene.tools.document-parsing",
      phase: "pending",
      progressPercent: 0,
      message: "Queued for installation",
      startedAt: new Date().toISOString(),
      completedAt: null,
      userDataRetained: null,
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(opStatus), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({
      baseUrl: "https://installer.api/v1",
      verified: true,
      authToken: "exec-token",
    });

    const result = await provider.executePlan("plan-valid-1", "confirm-token");
    expect(result.operationId).toBe("op-101");
    expect(result.phase).toBe("pending");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://installer.api/v1/plans/plan-valid-1/execute",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer exec-token",
        }),
        body: JSON.stringify({ confirmationToken: "confirm-token" }),
      }),
    );
  });

  it("streams operation progress using fetch-based ReadableStream with Bearer auth", async () => {
    const statusPayload: InstallerOperationStatus = {
      operationId: "op-stream-1",
      kind: "install",
      componentId: "comp-1",
      phase: "running",
      progressPercent: 65,
      message: "Unpacking component archives",
      startedAt: new Date().toISOString(),
      completedAt: null,
      userDataRetained: null,
    };

    const sseBody = `data: ${JSON.stringify(statusPayload)}\n\n`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sseBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    globalThis.fetch = fetchMock;

    const provider = new RealInstallerProvider({
      baseUrl: "https://installer.api/v1",
      authToken: "sse-bearer-token",
      verified: true,
    });

    const received: InstallerOperationStatus[] = [];
    const unsub = provider.getOperationStream(
      "op-stream-1",
      (status) => received.push(status),
      (err) => {
        throw err;
      },
    );

    // Allow event loop microtasks for stream reading
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://installer.api/v1/operations/op-stream-1/stream",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "text/event-stream",
          Authorization: "Bearer sse-bearer-token",
        }),
      }),
    );
    expect(received.length).toBe(1);
    expect(received[0].operationId).toBe("op-stream-1");
    expect(received[0].progressPercent).toBe(65);

    unsub();
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
    const unverifiedProvider = new RealInstallerProvider({ baseUrl: "https://installer.api/v1" });
    await handleInstallFlow(unverifiedProvider, validPlan);
    expect(currentStep).toBe("plan");
    expect(inPageError).toContain("Operation disabled");
    expect(operationId).toBeNull();

    // Case 2: verified provider but execution fails (500) -> remains on plan view
    inPageError = null;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" }),
    );
    const verifiedProvider = new RealInstallerProvider({ baseUrl: "https://installer.api/v1", verified: true });
    await handleInstallFlow(verifiedProvider, validPlan);
    expect(currentStep).toBe("plan");
    expect(inPageError).toMatch(/server error|500/i);
    expect(operationId).toBeNull();

    // Case 3: execution accepted -> switches to progress
    inPageError = null;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        operationId: "op-success-777",
        kind: "install",
        componentId: "comp-1",
        phase: "pending",
        progressPercent: 0,
        message: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        userDataRetained: null,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await handleInstallFlow(verifiedProvider, validPlan);
    expect(currentStep).toBe("progress");
    expect(inPageError).toBeNull();
    expect(operationId).toBe("op-success-777");
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

