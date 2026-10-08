// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 InstallerPlanPanel.tsx                                               │
// │  Module: services/installer                                              │
// │  Role: Installation plan review page — shows what will be installed,     │
// │         why, download size, platform, and known limitations.             │
// │                                                                          │
// │  中文：模块职责：安装计划预览页——展示将安装内容、原因、大小、平台与限制。      │
// │                                                                          │
// │  ⚠ NOT_CONNECTED: plan is assembled from mock catalog.                   │
// │    Replace with real POST /api/installer/v1/plans response when ready.   │
// └─────────────────────────────────────────────────────────────────────────┘

import { useMemo, useCallback } from "react";
import { useI18n } from "../../../src/i18n";
import { installerText } from "./copy";
import {
  MOCK_COMPONENT_CATALOG,
  MOCK_WORKLOAD_CATALOG,
  type InstallationPlan,
  type PlannedComponent,
} from "./contracts";
import "./installer.css";

// ---------------------------------------------------------------------------
// § Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/**
 * Build a mock InstallationPlan from workload + manual component selections.
 *
 * NOT_CONNECTED: this assembles a plan from local mock data.
 * The real flow sends the selection to POST /api/installer/v1/plans and
 * receives a plan whose dependency resolution is done server-side.
 */
function buildMockPlan(
  workloadIds: string[],
  componentIds: string[],
  excludedComponentIds: string[] = [],
): InstallationPlan {
  const componentMap = new Map(MOCK_COMPONENT_CATALOG.components.map((c) => [c.id, c]));
  const workloadMap = new Map(MOCK_WORKLOAD_CATALOG.workloads.map((w) => [w.id, w]));

  const seen = new Set<string>();
  const planned: PlannedComponent[] = [];

  // From workloads
  for (const wid of workloadIds) {
    const wl = workloadMap.get(wid);
    if (!wl) continue;
    for (const entry of wl.components) {
      if (entry.affinity === "optional") {
        if (!componentIds.includes(entry.componentId)) continue;
      }
      if (entry.affinity === "recommended" && excludedComponentIds.includes(entry.componentId)) {
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

  // Manual additions
  for (const cid of componentIds) {
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
    planId: `mock-${Date.now()}`,
    workloadIds,
    additionalComponentIds: componentIds,
    components: planned,
    totalDownloadBytes: total,
    targetPlatform: {
      os: navigator.platform.startsWith("Win") ? "windows" : navigator.platform.startsWith("Mac") ? "darwin" : "linux",
      architecture: "x86_64",
    },
    deploymentMode: "local",
    permissionsRequired: [],
    knownLimitations: [
      // NOT_CONNECTED: limitations come from the Installer API in production
    ],
    alreadyInstalledComponentIds: MOCK_COMPONENT_CATALOG.components
      .filter((c) => c.installedVersion !== null)
      .map((c) => c.id),
    resolvedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// § Sub-components
// ---------------------------------------------------------------------------

function PlannedComponentRow({
  item,
  componentName,
  l,
}: {
  item: PlannedComponent;
  componentName: string;
  l: (v: string) => string;
}) {
  return (
    <div className="installer-plan__item">
      <div style={{ flex: 1 }}>
        <p className="installer-plan__item-name">{componentName}</p>
        <p className="installer-plan__reason">{l(item.reason)}</p>
      </div>
      <div className="installer-plan__item-meta">
        {item.version ? (
          <span style={{ fontFamily: "var(--dh-font-mono)", fontSize: "var(--dh-fs-xs)" }}>
            v{item.version}
          </span>
        ) : null}
        {item.downloadBytes !== null ? (
          <div style={{ marginTop: 2 }}>{formatBytes(item.downloadBytes)}</div>
        ) : (
          <div style={{ color: "var(--dh-text-tertiary)", fontSize: "var(--dh-fs-xs)" }}>—</div>
        )}
        <span className={`installer-chip installer-chip--${item.affinity}`} style={{ marginTop: 4 }}>
          {l(item.affinity.charAt(0).toUpperCase() + item.affinity.slice(1))}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// § Main export
// ---------------------------------------------------------------------------

/**
 * Installation plan review step.
 *
 * ⚠ NOT_CONNECTED: uses mock plan assembled from static catalog.
 * In production: plan = await fetch("POST /api/installer/v1/plans", selection).
 *
 * 中文：当前为 Mock 计划，不执行实际安装。
 */
export function InstallerPlanPanel({
  workloadIds,
  componentIds,
  excludedComponentIds = [],
  onBack,
  onInstall,
}: {
  workloadIds: string[];
  componentIds: string[];
  excludedComponentIds?: string[];
  onBack: () => void;
  onInstall: (plan: InstallationPlan) => void;
}) {
  const { locale } = useI18n();
  const l = useCallback((v: string) => installerText(v, locale), [locale]);

  // NOT_CONNECTED: replace with API call
  const plan = useMemo(
    () => buildMockPlan(workloadIds, componentIds, excludedComponentIds),
    [workloadIds, componentIds, excludedComponentIds],
  );

  const componentMap = useMemo(
    () => new Map(MOCK_COMPONENT_CATALOG.components.map((c) => [c.id, c])),
    [],
  );
  const workloadMap = useMemo(
    () => new Map(MOCK_WORKLOAD_CATALOG.workloads.map((w) => [w.id, w])),
    [],
  );

  const products = plan.workloadIds.map((id) => workloadMap.get(id)).filter(Boolean);
  const alreadyInstalled = plan.components.filter((c) =>
    plan.alreadyInstalledComponentIds.includes(c.componentId),
  );
  const toInstall = plan.components.filter(
    (c) => !plan.alreadyInstalledComponentIds.includes(c.componentId),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* NOT_CONNECTED banner */}
      <div className="installer-not-connected" role="status">
        {l("⚠ NOT CONNECTED — this view uses mock data. Install operations are disabled.")}
      </div>

      <div className="installer-main" style={{ flex: 1 }}>
        <div className="installer-detail__header">
          <span className="installer-detail__eyebrow">{l("Installation Plan")}</span>
          <h2 className="installer-detail__title">{l("Review your installation")}</h2>
          <p className="installer-detail__desc">
            {l("This plan was resolved by the Installer API.")}
          </p>
        </div>
        <hr className="installer-horizon" />

        <div className="installer-plan">
          {/* Products */}
          {products.length > 0 && (
            <section className="installer-plan__section">
              <h3 className="installer-plan__section-title">{l("Products to install")}</h3>
              {products.map((wl) => wl && (
                <div key={wl.id} className="installer-plan__item">
                  <div style={{ flex: 1 }}>
                    <p className="installer-plan__item-name">{wl.name}</p>
                    <p className="installer-plan__reason">{wl.description}</p>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Plugins to install */}
          {toInstall.length > 0 && (
            <section className="installer-plan__section">
              <h3 className="installer-plan__section-title">{l("Plugins to install")}</h3>
              {toInstall.map((item) => (
                <PlannedComponentRow
                  key={item.componentId}
                  item={item}
                  componentName={componentMap.get(item.componentId)?.name ?? item.componentId}
                  l={l}
                />
              ))}
            </section>
          )}

          {/* Already installed */}
          {alreadyInstalled.length > 0 && (
            <section className="installer-plan__section">
              <h3 className="installer-plan__section-title">{l("Already installed")}</h3>
              {alreadyInstalled.map((item) => {
                const comp = componentMap.get(item.componentId);
                return (
                  <div key={item.componentId} className="installer-plan__item" style={{ opacity: 0.6 }}>
                    <div style={{ flex: 1 }}>
                      <p className="installer-plan__item-name">{comp?.name ?? item.componentId}</p>
                      <p className="installer-plan__reason">
                        v{comp?.installedVersion ?? "?"} — {l("Installed")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* Meta grid */}
          <div className="installer-plan__meta-row">
            {/* Download size */}
            <div className="installer-plan__meta-card">
              <p className="installer-plan__meta-label">{l("Estimated download size")}</p>
              {plan.totalDownloadBytes !== null ? (
                <>
                  <p className="installer-plan__size">{formatBytes(plan.totalDownloadBytes)}</p>
                  <p className="installer-plan__size-label">download</p>
                </>
              ) : (
                <p className="installer-plan__tbd">{l("Unknown — size data not yet available")}</p>
              )}
            </div>

            {/* Target platform */}
            <div className="installer-plan__meta-card">
              <p className="installer-plan__meta-label">{l("Target platform")}</p>
              <p className="installer-plan__meta-value">
                {plan.targetPlatform.os} / {plan.targetPlatform.architecture}
                {plan.targetPlatform.distribution ? ` (${plan.targetPlatform.distribution})` : ""}
              </p>
              <p className="installer-plan__meta-label" style={{ marginTop: "var(--dh-space-2)" }}>
                {l("Deployment mode")}
              </p>
              <p className="installer-plan__meta-value">{plan.deploymentMode}</p>
            </div>
          </div>

          {/* Permissions */}
          {plan.permissionsRequired.length > 0 && (
            <section className="installer-plan__section">
              <h3 className="installer-plan__section-title">{l("Permissions required")}</h3>
              <ul className="installer-plan__limitation-list">
                {plan.permissionsRequired.map((perm) => <li key={perm}>{perm}</li>)}
              </ul>
            </section>
          )}

          {/* Known limitations */}
          <section className="installer-plan__section">
            <h3 className="installer-plan__section-title">{l("Known limitations")}</h3>
            {plan.knownLimitations.length > 0 ? (
              <ul className="installer-plan__limitation-list">
                {plan.knownLimitations.map((lim) => <li key={lim}>{lim}</li>)}
              </ul>
            ) : (
              <p style={{ fontSize: "var(--dh-fs-sm)", color: "var(--dh-text-tertiary)" }}>
                {l("None reported")}
              </p>
            )}
          </section>

          {/* Plan ID (monospace — machine value) */}
          <div className="installer-plan__meta-card">
            <p className="installer-plan__meta-label">Plan ID</p>
            <p className="installer-plan__meta-value">{plan.planId}</p>
            <p className="installer-plan__meta-label" style={{ marginTop: "var(--dh-space-1)" }}>
              Resolved at
            </p>
            <p className="installer-plan__meta-value">{plan.resolvedAt}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="installer-footer">
        <button className="installer-btn" onClick={onBack}>
          ← {l("Back")}
        </button>
        <span className="installer-footer__summary">
          {toInstall.length} {l("Plugins to install")}
          {plan.totalDownloadBytes !== null ? ` · ${formatBytes(plan.totalDownloadBytes)}` : ""}
        </span>
        {/* Primary action — disabled because NOT_CONNECTED */}
        <button
          className="installer-btn installer-btn--primary"
          disabled
          title={l("⚠ NOT CONNECTED — this view uses mock data. Install operations are disabled.")}
          onClick={() => onInstall(plan)}
        >
          {l("Install")}
        </button>
      </div>
    </div>
  );
}
