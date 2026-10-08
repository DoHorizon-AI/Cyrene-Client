// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 installer.test.ts                                                    │
// │  Module: services/installer                                              │
// │  Role: Unit tests for installer contract helpers and mock plan builder.  │
// │                                                                          │
// │  中文：模块职责：安装器契约辅助函数与 Mock 计划构建器的单元测试。              │
// └─────────────────────────────────────────────────────────────────────────┘
import { describe, it, expect } from "vitest";
import {
  MOCK_WORKLOAD_CATALOG,
  MOCK_COMPONENT_CATALOG,
  KNOWN_COMPONENT_IDS,
  type ComponentAffinity,
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
  it("unconfigured provider throws NotConnectedError on fetch", async () => {
    const provider = new RealInstallerProvider({ baseUrl: "" });
    expect(provider.isConnected).toBe(false);
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

