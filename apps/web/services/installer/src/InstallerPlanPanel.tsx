// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 InstallerPlanPanel.tsx                                               │
// │  Module: services/installer                                              │
// │  Role: Installation plan review page — shows what will be installed,     │
// │         why, download size, platform, and known limitations.             │
// │                                                                          │
// │  中文：模块职责：安装计划预览页——展示将安装内容、原因、大小、平台与限制。      │
// │  权威依赖解析由后端提供；绝不使用 navigator.platform 猜测架构。             │
// └─────────────────────────────────────────────────────────────────────────┘

import { useState, useEffect, useMemo, useCallback } from "react";
import { useI18n } from "../../../src/i18n";
import { installerText } from "./copy";
import { useInstallerProvider } from "./provider";
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
 * Dependency resolution and target environment are determined authoritatively
 * by the Installer API / Provider.
 *
 * 中文：权威计划由 InstallerProvider 提供，前端不猜测目标架构或伪造数据。
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
  const provider = useInstallerProvider();

  const [plan, setPlan] = useState<InstallationPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    provider
      .resolvePlan({
        workloadIds,
        manualComponentIds: componentIds,
        excludedRecommendedComponentIds: excludedComponentIds,
      })
      .then((resolved) => {
        if (!cancelled) {
          setPlan(resolved);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [provider, workloadIds, componentIds, excludedComponentIds, reloadKey]);

  const componentMap = useMemo(
    () => new Map(MOCK_COMPONENT_CATALOG.components.map((c) => [c.id, c])),
    [],
  );
  const workloadMap = useMemo(
    () => new Map(MOCK_WORKLOAD_CATALOG.workloads.map((w) => [w.id, w])),
    [],
  );

  const products = plan
    ? plan.workloadIds.map((id) => workloadMap.get(id)).filter(Boolean)
    : [];
  const alreadyInstalled = plan
    ? plan.components.filter((c) => plan.alreadyInstalledComponentIds.includes(c.componentId))
    : [];
  const toInstall = plan
    ? plan.components.filter((c) => !plan.alreadyInstalledComponentIds.includes(c.componentId))
    : [];

  const targetPlatformDisplay = plan?.targetPlatform?.os
    ? `${plan.targetPlatform.os} / ${plan.targetPlatform.architecture || l("TBD")}${
        plan.targetPlatform.distribution ? ` (${plan.targetPlatform.distribution})` : ""
      }`
    : l("TBD");

  const deploymentModeDisplay = plan?.deploymentMode ?? l("TBD");

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Provider demo / unconnected notice */}
      {provider.isDemo && (
        <div className="installer-not-connected" role="status">
          {l("⚠ NOT CONNECTED — this view uses mock data. Install operations are disabled.")}
        </div>
      )}

      <div className="installer-main" style={{ flex: 1 }}>
        <div className="installer-detail__header">
          <span className="installer-detail__eyebrow">{l("Installation Plan")}</span>
          <h2 className="installer-detail__title">{l("Review your installation")}</h2>
          <p className="installer-detail__desc">
            {l("This plan was resolved by the Installer API.")}
          </p>
        </div>
        <hr className="installer-horizon" />

        {loading ? (
          <div className="installer-state" role="status" aria-live="polite">
            <h3 className="installer-state__title">{l("Resolving installation plan…")}</h3>
            <p className="installer-state__detail">{l("Loading…")}</p>
          </div>
        ) : error ? (
          <div className="installer-affinity-warning" role="alert" style={{ margin: "var(--dh-space-4) 0" }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{l("Plan conflict or expired")}</p>
            <p style={{ margin: "var(--dh-space-2) 0" }}>{error}</p>
            <button
              className="installer-btn"
              onClick={() => setReloadKey((k) => k + 1)}
              style={{ marginTop: "var(--dh-space-2)" }}
            >
              {l("Try again")}
            </button>
          </div>
        ) : plan ? (
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
                <p className="installer-plan__meta-value">{targetPlatformDisplay}</p>
                <p className="installer-plan__meta-label" style={{ marginTop: "var(--dh-space-2)" }}>
                  {l("Deployment mode")}
                </p>
                <p className="installer-plan__meta-value">{deploymentModeDisplay}</p>
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

            {/* Plan ID & expiration */}
            <div className="installer-plan__meta-card">
              <p className="installer-plan__meta-label">Plan ID</p>
              <p className="installer-plan__meta-value">{plan.planId}</p>
              <p className="installer-plan__meta-label" style={{ marginTop: "var(--dh-space-1)" }}>
                Resolved at
              </p>
              <p className="installer-plan__meta-value">{plan.resolvedAt}</p>
              {plan.expiresAt && (
                <>
                  <p className="installer-plan__meta-label" style={{ marginTop: "var(--dh-space-1)" }}>
                    Expires at
                  </p>
                  <p className="installer-plan__meta-value">{plan.expiresAt}</p>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="installer-footer">
        <button className="installer-btn" onClick={onBack}>
          ← {l("Back")}
        </button>
        <span className="installer-footer__summary">
          {toInstall.length} {l("Plugins to install")}
          {plan?.totalDownloadBytes !== null && plan?.totalDownloadBytes !== undefined
            ? ` · ${formatBytes(plan.totalDownloadBytes)}`
            : ""}
        </span>
        {/* Primary action — disabled if provider isDemo or not connected, or if loading/error */}
        <button
          className="installer-btn installer-btn--primary"
          disabled={!plan || loading || Boolean(error) || provider.isDemo || !provider.isConnected}
          title={
            provider.isDemo || !provider.isConnected
              ? l("⚠ NOT CONNECTED — this view uses mock data. Install operations are disabled.")
              : undefined
          }
          onClick={() => plan && onInstall(plan)}
        >
          {l("Install")}
        </button>
      </div>
    </div>
  );
}
