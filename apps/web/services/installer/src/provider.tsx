// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 provider.ts                                                         │
// │  Module: services/installer                                              │
// │  Role: Separation layer between Demo/Preview and Real Installer API.    │
// │         Authoritative plan resolution, dependency trees, and operation   │
// │         execution belong strictly to the backend.                        │
// │                                                                          │
// │  中文：模块职责：Demo/预览与真实 Installer API 的隔离适配层。              │
// │  权威安装计划、依赖关系和副作用执行均由后端统一决定。                         │
// └─────────────────────────────────────────────────────────────────────────┘

import React, { createContext, useContext } from "react";
import {
  MOCK_WORKLOAD_CATALOG,
  MOCK_COMPONENT_CATALOG,
  type WorkloadCatalog,
  type ComponentCatalog,
  type InstallationPlan,
  type PlannedComponent,
  type PlanSelectionRequest,
  type ComponentOperationRequest,
  type InstallerOperationStatus,
  type ManagedComponent,
} from "./contracts";

// ---------------------------------------------------------------------------
// § Errors
// ---------------------------------------------------------------------------

export class NotConnectedError extends Error {
  constructor(message = "Installer service is not connected. All execution operations are safely disabled.") {
    super(message);
    this.name = "NotConnectedError";
  }
}

export class OperationNotPermittedError extends Error {
  constructor(message = "This operation is not permitted in demo / unverified mode.") {
    super(message);
    this.name = "OperationNotPermittedError";
  }
}

export class PlanExpiredOrConflictError extends Error {
  constructor(message = "The installation plan has expired or conflicts with current catalog generation.") {
    super(message);
    this.name = "PlanExpiredOrConflictError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(message = "Insufficient permissions to execute installer operation.") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

// ---------------------------------------------------------------------------
// § InstallerProvider Interface
// ---------------------------------------------------------------------------

export interface InstallerProvider {
  /** Whether the provider is running in demo/mock mode */
  readonly isDemo: boolean;
  /** Whether a live connection to the backend installer service is verified */
  readonly isConnected: boolean;

  /** Fetch the workload catalog */
  getWorkloadCatalog(): Promise<WorkloadCatalog>;

  /** Fetch the component catalog */
  getComponentCatalog(): Promise<ComponentCatalog>;

  /** Request the authoritative installation plan from backend */
  resolvePlan(selection: PlanSelectionRequest): Promise<InstallationPlan>;

  /** Execute a previously resolved and confirmed plan */
  executePlan(planId: string, confirmationToken?: string): Promise<InstallerOperationStatus>;

  /** Stream operation progress updates (SSE or polling) */
  getOperationStream(
    operationId: string,
    onUpdate: (status: InstallerOperationStatus) => void,
    onError?: (err: Error) => void,
  ): () => void;

  /** Fetch managed components with binding guards and permissible actions */
  getManagedComponents(): Promise<ManagedComponent[]>;

  /** Execute a managed component lifecycle operation */
  executeComponentOperation(req: ComponentOperationRequest): Promise<InstallerOperationStatus>;
}

// ---------------------------------------------------------------------------
// § Demo Provider (for Storybook and dev preview — strictly read-only)
// ---------------------------------------------------------------------------

export class DemoInstallerProvider implements InstallerProvider {
  readonly isDemo = true;
  readonly isConnected = false;

  async getWorkloadCatalog(): Promise<WorkloadCatalog> {
    return MOCK_WORKLOAD_CATALOG;
  }

  async getComponentCatalog(): Promise<ComponentCatalog> {
    return MOCK_COMPONENT_CATALOG;
  }

  async resolvePlan(selection: PlanSelectionRequest): Promise<InstallationPlan> {
    const componentMap = new Map(MOCK_COMPONENT_CATALOG.components.map((c) => [c.id, c]));
    const workloadMap = new Map(MOCK_WORKLOAD_CATALOG.workloads.map((w) => [w.id, w]));

    const seen = new Set<string>();
    const planned: PlannedComponent[] = [];
    const excludedSet = new Set(selection.excludedRecommendedComponentIds ?? []);

    for (const wid of selection.workloadIds) {
      const wl = workloadMap.get(wid);
      if (!wl) continue;
      for (const entry of wl.components) {
        if (entry.affinity === "optional") {
          if (!selection.manualComponentIds.includes(entry.componentId)) continue;
        }
        if (entry.affinity === "recommended" && excludedSet.has(entry.componentId)) {
          continue;
        }
        if (seen.has(entry.componentId)) continue;
        seen.add(entry.componentId);
        const comp = componentMap.get(entry.componentId);
        planned.push({
          componentId: entry.componentId,
          affinity: entry.affinity,
          reason: entry.affinity === "required" ? `Required by ${wl.name}` : `Recommended by ${wl.name}`,
          reasonCn: entry.affinity === "required" ? `${wl.name} 必需` : `${wl.name} 推荐`,
          downloadBytes: comp?.downloadBytes ?? null,
          version: comp?.availableVersion ?? null,
        });
      }
    }

    for (const cid of selection.manualComponentIds) {
      if (seen.has(cid)) continue;
      seen.add(cid);
      const comp = componentMap.get(cid);
      planned.push({
        componentId: cid,
        affinity: "optional",
        reason: "Manually selected",
        reasonCn: "手动选择",
        downloadBytes: comp?.downloadBytes ?? null,
        version: comp?.availableVersion ?? null,
      });
    }

    const anyUnknown = planned.some((c) => c.downloadBytes === null);
    const total = anyUnknown ? null : planned.reduce((sum, c) => sum + (c.downloadBytes ?? 0), 0);

    return {
      planId: `demo-preview-${Date.now()}`,
      catalogGeneration: MOCK_COMPONENT_CATALOG.generation,
      workloadIds: selection.workloadIds,
      additionalComponentIds: selection.manualComponentIds,
      components: planned,
      totalDownloadBytes: total,
      // Target platform is strictly NULL in demo mode — never guess from navigator.platform
      targetPlatform: null,
      deploymentMode: null,
      permissionsRequired: [],
      knownLimitations: [],
      alreadyInstalledComponentIds: MOCK_COMPONENT_CATALOG.components
        .filter((c) => c.installedVersion !== null)
        .map((c) => c.id),
      resolvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
  }

  async executePlan(_planId: string, _confirmationToken?: string): Promise<InstallerOperationStatus> {
    throw new OperationNotPermittedError(
      "Cannot execute installation in demo / NOT_CONNECTED mode. Connect to a valid Installer API first.",
    );
  }

  getOperationStream(
    _operationId: string,
    _onUpdate: (status: InstallerOperationStatus) => void,
    onError?: (err: Error) => void,
  ): () => void {
    if (onError) {
      onError(new NotConnectedError("Operation stream is unavailable in demo mode."));
    }
    return () => {};
  }

  async getManagedComponents(): Promise<ManagedComponent[]> {
    return MOCK_COMPONENT_CATALOG.components.map((c) => ({
      ...c,
      activeBindings: [],
      // In demo mode, no operations are permitted
      allowedOperations: [],
      // Retention is explicitly unknown — never promise data retention without server confirmation
      retentionPolicyOnUninstall: "unknown",
    }));
  }

  async executeComponentOperation(_req: ComponentOperationRequest): Promise<InstallerOperationStatus> {
    throw new OperationNotPermittedError(
      "Cannot execute component lifecycle operations in demo / NOT_CONNECTED mode.",
    );
  }
}

// ---------------------------------------------------------------------------
// § Real Provider (prepares integration with Codex's Installer API)
// ---------------------------------------------------------------------------

export interface RealInstallerProviderOptions {
  baseUrl?: string;
  authToken?: string;
  timeoutMs?: number;
}

export class RealInstallerProvider implements InstallerProvider {
  readonly isDemo = false;
  readonly isConnected: boolean;
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;

  constructor(options: RealInstallerProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "/api/installer/v1").replace(/\/+$/, "");
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    // Considered connected if a non-empty baseUrl is configured
    this.isConnected = Boolean(options.baseUrl);
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.isConnected) {
      throw new NotConnectedError("Installer service endpoint is not configured.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      ...(init?.headers as Record<string, string> || {}),
    };

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new PermissionDeniedError(`Installer API permission denied (${response.status})`);
      }
      if (response.status === 409) {
        throw new PlanExpiredOrConflictError("Catalog conflict or expired plan token.");
      }
      if (!response.ok) {
        throw new Error(`Installer API error: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      if (err instanceof PermissionDeniedError || err instanceof PlanExpiredOrConflictError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Installer API request timed out after ${this.timeoutMs}ms`);
      }
      throw new NotConnectedError(
        `Failed to reach Installer API at ${this.baseUrl}${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async getWorkloadCatalog(): Promise<WorkloadCatalog> {
    return this.fetchJson<WorkloadCatalog>("/workloads");
  }

  async getComponentCatalog(): Promise<ComponentCatalog> {
    return this.fetchJson<ComponentCatalog>("/components");
  }

  async resolvePlan(selection: PlanSelectionRequest): Promise<InstallationPlan> {
    return this.fetchJson<InstallationPlan>("/plans/resolve", {
      method: "POST",
      body: JSON.stringify(selection),
    });
  }

  async executePlan(planId: string, confirmationToken?: string): Promise<InstallerOperationStatus> {
    return this.fetchJson<InstallerOperationStatus>(`/plans/${encodeURIComponent(planId)}/execute`, {
      method: "POST",
      body: JSON.stringify({ confirmationToken }),
    });
  }

  getOperationStream(
    operationId: string,
    onUpdate: (status: InstallerOperationStatus) => void,
    onError?: (err: Error) => void,
  ): () => void {
    if (!this.isConnected || typeof EventSource === "undefined") {
      if (onError) onError(new NotConnectedError("SSE is unavailable or provider not connected."));
      return () => {};
    }

    const url = `${this.baseUrl}/operations/${encodeURIComponent(operationId)}/stream`;
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as InstallerOperationStatus;
        onUpdate(data);
      } catch (err) {
        if (onError) onError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    es.onerror = (e) => {
      es.close();
      if (onError) onError(new Error("EventSource connection error"));
    };

    return () => {
      es.close();
    };
  }

  async getManagedComponents(): Promise<ManagedComponent[]> {
    return this.fetchJson<ManagedComponent[]>("/components/managed");
  }

  async executeComponentOperation(req: ComponentOperationRequest): Promise<InstallerOperationStatus> {
    return this.fetchJson<InstallerOperationStatus>(
      `/components/${encodeURIComponent(req.componentId)}/operations`,
      {
        method: "POST",
        body: JSON.stringify(req),
      },
    );
  }
}

// ---------------------------------------------------------------------------
// § React Context & Hook
// ---------------------------------------------------------------------------

export const defaultInstallerProvider = new DemoInstallerProvider();

const InstallerProviderContext = createContext<InstallerProvider>(defaultInstallerProvider);

export function InstallerProviderBoundary({
  provider,
  children,
}: {
  provider: InstallerProvider;
  children: React.ReactNode;
}) {
  return (
    <InstallerProviderContext.Provider value={provider}>
      {children}
    </InstallerProviderContext.Provider>
  );
}

export function useInstallerProvider(): InstallerProvider {
  return useContext(InstallerProviderContext);
}
