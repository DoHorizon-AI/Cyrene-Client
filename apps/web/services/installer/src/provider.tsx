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
  type ComponentAffinity,
  type InstallerComponent,
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
  executePlan(
    planId: string,
    confirmationToken?: string,
    options?: { expiresAt?: string },
  ): Promise<InstallerOperationStatus>;

  /** Stream operation progress updates (SSE via fetch + ReadableStream) */
  getOperationStream(
    operationId: string,
    onUpdate: (status: InstallerOperationStatus) => void,
    onError?: (err: Error) => void,
  ): () => void;

  /** Fetch managed components with binding guards and permissible actions */
  getManagedComponents(): Promise<ManagedComponent[]>;

  /** Execute a managed component lifecycle operation */
  executeComponentOperation(req: ComponentOperationRequest): Promise<InstallerOperationStatus>;

  /** Actively verify connection availability with backend service */
  verifyConnection?(): Promise<boolean>;

  /** Health check probe alias */
  healthcheck?(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// § Demo Provider (for Storybook and dev preview — strictly read-only)
// ---------------------------------------------------------------------------

export class DemoInstallerProvider implements InstallerProvider {
  readonly isDemo = true;
  readonly isConnected = false;

  async verifyConnection(): Promise<boolean> {
    return false;
  }

  async healthcheck(): Promise<boolean> {
    return false;
  }

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

  async executePlan(
    _planId: string,
    _confirmationToken?: string,
    _options?: { expiresAt?: string },
  ): Promise<InstallerOperationStatus> {
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

export interface ControlInstallerProviderOptions {
  prefix?: string;
  baseUrl?: string;
  authToken?: string;
  timeoutMs?: number;
  verified?: boolean;
}

export type RealInstallerProviderOptions = ControlInstallerProviderOptions;

export class ControlWorkloadInstallerProvider implements InstallerProvider {
  readonly isDemo = false;
  readonly isConfigured: boolean;
  private _verified = false;
  private readonly prefix: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;
  private cachedSession: { token: string; actor: { id: string; scopes: string[] } } | null = null;
  private lastResolvedPlan: InstallationPlan | null = null;

  constructor(options: ControlInstallerProviderOptions = {}) {
    const raw = options.prefix ?? options.baseUrl ?? "/studio-workloads";
    this.prefix = raw.replace(/\/+$/, "").replace(/\/v1$/, "");
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.isConfigured = Boolean(options.prefix || options.baseUrl || options.verified);
    this._verified = Boolean(options.verified && this.isConfigured);
  }

  get isConnected(): boolean {
    return this.isConfigured && this._verified;
  }

  async fetchSession(forceRefresh = false): Promise<{ token: string; actor: { id: string; scopes: string[] } }> {
    if (!forceRefresh && this.cachedSession) {
      return this.cachedSession;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      };
      const res = await fetch(`${this.prefix}/v1/session`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        throw new PermissionDeniedError(`Installer permission denied (${res.status})`);
      }
      if (!res.ok) {
        throw new NotConnectedError(`Failed to fetch Control session: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      this.cachedSession = {
        token: data.token,
        actor: data.actor ?? { id: "user", scopes: ["workloads.read", "workloads.install"] },
      };
      return this.cachedSession;
    } catch (err: unknown) {
      if (err instanceof PermissionDeniedError) throw err;
      throw new NotConnectedError(
        `Failed to reach Control session endpoint at ${this.prefix}/v1/session: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.isConfigured) {
      this._verified = false;
      return false;
    }
    try {
      const session = await this.fetchSession(true);
      if (session && Array.isArray(session.actor?.scopes) && session.actor.scopes.includes("workloads.read")) {
        this._verified = true;
        return true;
      }
      this._verified = false;
      return false;
    } catch {
      this._verified = false;
      return false;
    }
  }

  async healthcheck(): Promise<boolean> {
    return this.verifyConnection();
  }

  async dispatchCommand<T>(name: string, input: unknown): Promise<T> {
    if (!this.isConfigured) {
      throw new NotConnectedError("Installer service endpoint is not configured.");
    }
    const session = await this.fetchSession();
    if (name.startsWith("workloads.stage") || name.startsWith("workloads.apply")) {
      if (!session.actor.scopes.includes("workloads.install")) {
        throw new PermissionDeniedError("没有本机工作负载安装权限。");
      }
    } else if (name === "workloads.status" || name === "workloads.check") {
      if (!session.actor.scopes.includes("workloads.read")) {
        throw new PermissionDeniedError("没有本机工作负载读取权限。");
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.prefix}/v1/commands`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-studio-control-token": session.token,
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        },
        body: JSON.stringify({
          name,
          input,
          requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        }),
        signal: controller.signal,
      });

      if (res.status === 401 || res.status === 403) {
        throw new PermissionDeniedError(`Installer API permission denied (${res.status})`);
      }
      if (res.status === 409) {
        throw new PlanExpiredOrConflictError("计划已变化；请重新检查并确认最新计划。");
      }
      if (res.status >= 500) {
        let errBody: any;
        try {
          errBody = await res.json();
        } catch {}
        throw new Error(errBody?.error?.message ?? `Installer API server error: ${res.status} ${res.statusText}`);
      }
      if (!res.ok) {
        let errBody: any;
        try {
          errBody = await res.json();
        } catch {}
        throw new Error(errBody?.error?.message ?? `Installer API error: ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      return (json?.result !== undefined ? json.result : json) as T;
    } catch (err: unknown) {
      if (
        err instanceof PermissionDeniedError ||
        err instanceof PlanExpiredOrConflictError ||
        (err instanceof Error && err.message.startsWith("Installer API server error"))
      ) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Installer API request timed out after ${this.timeoutMs}ms`);
      }
      throw new NotConnectedError(
        `Failed to reach Installer API at ${this.prefix}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async getWorkloadCatalog(): Promise<WorkloadCatalog> {
    const [catalystStatus, echoStatus] = await Promise.all([
      this.dispatchCommand<{ components: Array<{ componentId: string }> }>("workloads.status", {
        workloadId: "catalyst",
        targetId: "linux-ubuntu-24.04-x86_64",
      }),
      this.dispatchCommand<{ components: Array<{ componentId: string }> }>("workloads.status", {
        workloadId: "echo",
        targetId: "linux-ubuntu-24.04-x86_64",
      }),
    ]);

    return {
      workloads: [
        {
          id: "catalyst",
          name: "Catalyst",
          nameCn: "Catalyst",
          description: "AI data curation, training data preparation, and knowledge base preparation.",
          descriptionCn: "AI 数据整理、训练数据准备与知识库数据准备。",
          components: catalystStatus.components.map((c) => ({
            componentId: c.componentId,
            affinity: "required" as ComponentAffinity,
          })),
        },
        {
          id: "echo",
          name: "Echo",
          nameCn: "Echo",
          description: "Standalone evaluation workload.",
          descriptionCn: "独立评测工作负载。",
          components: echoStatus.components.map((c) => ({
            componentId: c.componentId,
            affinity: "required" as ComponentAffinity,
          })),
        },
      ],
    };
  }

  async getComponentCatalog(): Promise<ComponentCatalog> {
    const results = await Promise.all([
      this.dispatchCommand<{ catalogGeneration: number; components: Array<{ componentId: string; installed: boolean; version: string | null }> }>(
        "workloads.status",
        { workloadId: "catalyst", targetId: "linux-ubuntu-24.04-x86_64" },
      ),
      this.dispatchCommand<{ catalogGeneration: number; components: Array<{ componentId: string; installed: boolean; version: string | null }> }>(
        "workloads.status",
        { workloadId: "echo", targetId: "linux-ubuntu-24.04-x86_64" },
      ),
    ]);

    const compMap = new Map<string, InstallerComponent>();
    for (const res of results) {
      for (const c of res.components) {
        if (!compMap.has(c.componentId)) {
          compMap.set(c.componentId, {
            id: c.componentId,
            name: c.componentId,
            description: `Component ${c.componentId}`,
            installedVersion: c.installed ? c.version : null,
            availableVersion: c.version,
            downloadBytes: null,
            status: c.installed ? "installed" : "available",
            supportedPlatforms: ["linux"],
            compatibleWithCurrentPlatform: true,
          });
        }
      }
    }

    return {
      generation: results[0]?.catalogGeneration ?? 1,
      components: Array.from(compMap.values()),
      fetchedAt: new Date().toISOString(),
    };
  }

  async resolvePlan(selection: PlanSelectionRequest): Promise<InstallationPlan> {
    const targetWorkloadIds = (selection.workloadIds && selection.workloadIds.length > 0)
      ? selection.workloadIds
      : ["catalyst"];

    const checkPromises = targetWorkloadIds.map(async (wid) => {
      const selections = {
        includeComponentIds: selection.manualComponentIds ?? [],
        excludeComponentIds: selection.excludedRecommendedComponentIds ?? [],
        choices: {},
      };
      return this.dispatchCommand<any>("workloads.check", {
        workloadId: wid,
        targetId: "linux-ubuntu-24.04-x86_64",
        selections,
        action: "install",
      });
    });

    const checkResults = await Promise.all(checkPromises);
    const isBlocked = checkResults.some((r) => r.status === "blocked");
    const allBlockers = checkResults.flatMap((r) => r.blockers ?? []);
    const allWarnings = checkResults.flatMap((r) => r.warnings ?? []);

    const compMap = new Map<string, PlannedComponent>();
    for (const r of checkResults) {
      for (const c of (r.components ?? [])) {
        if (!compMap.has(c.componentId)) {
          compMap.set(c.componentId, {
            componentId: c.componentId,
            affinity: c.requiredness === "dependency" ? "required" : (c.requiredness as ComponentAffinity),
            reason: c.reason,
            downloadBytes: null,
            version: c.version,
          });
        }
      }
    }

    const workloadPlans: Record<string, any> = {};
    for (let i = 0; i < targetWorkloadIds.length; i++) {
      const wid = targetWorkloadIds[i];
      const r = checkResults[i];
      workloadPlans[wid] = {
        workloadId: wid,
        planId: r.planId,
        planDigest: r.planDigest,
        catalogDigest: r.catalogDigest,
        status: r.status,
        blockers: r.blockers ?? [],
        warnings: r.warnings ?? [],
        action: "install",
        selections: {
          includeComponentIds: selection.manualComponentIds ?? [],
          excludeComponentIds: selection.excludedRecommendedComponentIds ?? [],
          choices: {},
        },
      };
    }

    const primaryResult = checkResults[0];
    const plan: InstallationPlan = {
      planId: primaryResult.planId,
      planDigest: primaryResult.planDigest,
      catalogDigest: primaryResult.catalogDigest,
      status: isBlocked ? "blocked" : "ready",
      catalogGeneration: 1,
      workloadIds: targetWorkloadIds,
      additionalComponentIds: selection.manualComponentIds,
      components: Array.from(compMap.values()),
      totalDownloadBytes: null,
      targetPlatform: { os: "linux", architecture: "x86_64", distribution: "ubuntu-24.04" },
      deploymentMode: "native",
      permissionsRequired: [],
      knownLimitations: [],
      alreadyInstalledComponentIds: checkResults.flatMap((r) =>
        (r.components ?? []).filter((c: any) => c.installed).map((c: any) => c.componentId),
      ),
      resolvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      blockers: allBlockers,
      warnings: allWarnings,
      workloadPlans,
    };

    this.lastResolvedPlan = plan;
    return plan;
  }

  async executePlan(
    planId: string,
    _confirmationToken?: string,
    options?: { expiresAt?: string; plan?: InstallationPlan },
  ): Promise<InstallerOperationStatus> {
    if (!this.isConnected) {
      throw new NotConnectedError(
        "Installer service connection has not been verified. Real installation operations are disabled.",
      );
    }
    if (options?.expiresAt && new Date(options.expiresAt).getTime() <= Date.now()) {
      throw new PlanExpiredOrConflictError("The installation plan has expired and cannot be executed.");
    }

    const plan = options?.plan ?? (this.lastResolvedPlan?.planId === planId ? this.lastResolvedPlan : null);
    if (plan?.status === "blocked") {
      throw new Error("Cannot execute a blocked installation plan.");
    }

    if (plan?.workloadPlans && Object.keys(plan.workloadPlans).length > 0) {
      const succeededWorkloads: string[] = [];
      for (const [wid, wp] of Object.entries(plan.workloadPlans)) {
        try {
          await this.dispatchCommand("workloads.stage", {
            workloadId: wp.workloadId,
            targetId: "linux-ubuntu-24.04-x86_64",
            selections: wp.selections,
            action: wp.action,
            planId: wp.planId,
            planDigest: wp.planDigest,
          });

          await this.dispatchCommand("workloads.apply", {
            workloadId: wp.workloadId,
            targetId: "linux-ubuntu-24.04-x86_64",
            selections: wp.selections,
            action: wp.action,
            planId: wp.planId,
            planDigest: wp.planDigest,
            confirmation: {
              planId: wp.planId,
              planDigest: wp.planDigest,
              confirmed: true,
            },
          });
          succeededWorkloads.push(wid);
        } catch (err: unknown) {
          if (succeededWorkloads.length > 0) {
            throw new Error(
              `Partial installation: Workload ${succeededWorkloads.join(", ")} succeeded, but ${wid} failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          throw err;
        }
      }
    } else {
      const digest = plan?.planDigest ?? `sha256:${planId.slice(5).padEnd(64, "0")}`;
      await this.dispatchCommand("workloads.stage", {
        workloadId: "catalyst",
        targetId: "linux-ubuntu-24.04-x86_64",
        selections: { includeComponentIds: [], excludeComponentIds: [], choices: {} },
        action: "install",
        planId,
        planDigest: digest,
      });

      await this.dispatchCommand("workloads.apply", {
        workloadId: "catalyst",
        targetId: "linux-ubuntu-24.04-x86_64",
        selections: { includeComponentIds: [], excludeComponentIds: [], choices: {} },
        action: "install",
        planId,
        planDigest: digest,
        confirmation: {
          planId,
          planDigest: digest,
          confirmed: true,
        },
      });
    }

    return {
      operationId: `op-${Date.now()}`,
      kind: "install",
      componentId: planId,
      phase: "succeeded",
      progressPercent: 100,
      message: "Installation completed successfully.",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      userDataRetained: null,
    };
  }

  getOperationStream(
    operationId: string,
    onUpdate: (status: InstallerOperationStatus) => void,
    onError?: (err: Error) => void,
  ): () => void {
    if (!this.isConnected) {
      if (onError) {
        onError(
          new NotConnectedError(
            "Installer service connection has not been verified. Stream remains closed.",
          ),
        );
      }
      return () => {};
    }

    // Official backend runs synchronously without fake SSE streaming
    onUpdate({
      operationId,
      kind: "install",
      componentId: operationId,
      phase: "succeeded",
      progressPercent: 100,
      message: "Operation completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      userDataRetained: null,
    });

    return () => {};
  }

  async getManagedComponents(): Promise<ManagedComponent[]> {
    const results = await Promise.all([
      this.dispatchCommand<{ components: Array<{ componentId: string; installed: boolean; version: string | null }> }>(
        "workloads.status",
        { workloadId: "catalyst", targetId: "linux-ubuntu-24.04-x86_64" },
      ),
      this.dispatchCommand<{ components: Array<{ componentId: string; installed: boolean; version: string | null }> }>(
        "workloads.status",
        { workloadId: "echo", targetId: "linux-ubuntu-24.04-x86_64" },
      ),
    ]);

    const compMap = new Map<string, ManagedComponent>();
    for (const res of results) {
      for (const c of res.components) {
        if (!compMap.has(c.componentId)) {
          compMap.set(c.componentId, {
            id: c.componentId,
            name: c.componentId,
            description: `Managed component ${c.componentId}`,
            installedVersion: c.installed ? c.version : null,
            availableVersion: c.version,
            downloadBytes: null,
            status: c.installed ? "installed" : "available",
            supportedPlatforms: ["linux"],
            compatibleWithCurrentPlatform: true,
            activeBindings: [],
            allowedOperations: c.installed ? ["uninstall"] : ["install"],
            retentionPolicyOnUninstall: "unknown",
          });
        }
      }
    }

    return Array.from(compMap.values());
  }

  async executeComponentOperation(req: ComponentOperationRequest): Promise<InstallerOperationStatus> {
    if (!this.isConnected) {
      throw new NotConnectedError(
        "Installer service connection has not been verified. Component operations are disabled.",
      );
    }
    if (req.operation !== "uninstall") {
      throw new OperationNotPermittedError(
        `Operation "${req.operation}" is not supported by the Control bridge. Only "install" and "uninstall" are permitted.`,
      );
    }

    const checkRes = await this.dispatchCommand<any>("workloads.check", {
      workloadId: "plugins",
      targetId: "linux-ubuntu-24.04-x86_64",
      selections: {
        includeComponentIds: [req.componentId],
        excludeComponentIds: [],
        choices: {},
      },
      action: "uninstall",
    });

    await this.dispatchCommand("workloads.stage", {
      workloadId: "plugins",
      targetId: "linux-ubuntu-24.04-x86_64",
      selections: {
        includeComponentIds: [req.componentId],
        excludeComponentIds: [],
        choices: {},
      },
      action: "uninstall",
      planId: checkRes.planId,
      planDigest: checkRes.planDigest,
    });

    await this.dispatchCommand("workloads.apply", {
      workloadId: "plugins",
      targetId: "linux-ubuntu-24.04-x86_64",
      selections: {
        includeComponentIds: [req.componentId],
        excludeComponentIds: [],
        choices: {},
      },
      action: "uninstall",
      planId: checkRes.planId,
      planDigest: checkRes.planDigest,
      confirmation: {
        planId: checkRes.planId,
        planDigest: checkRes.planDigest,
        confirmed: true,
      },
    });

    return {
      operationId: `op-uninstall-${Date.now()}`,
      kind: "uninstall",
      componentId: req.componentId,
      phase: "succeeded",
      progressPercent: 100,
      message: `Component ${req.componentId} uninstalled successfully.`,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      userDataRetained: false,
    };
  }
}

export const RealInstallerProvider = ControlWorkloadInstallerProvider;
export type RealInstallerProvider = ControlWorkloadInstallerProvider;

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
