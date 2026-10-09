// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 InstallerManagementPanel.tsx                                         │
// │  Module: services/installer                                              │
// │  Role: Post-install component management: status, install/uninstall,     │
// │         enable/disable, update, rollback, and dependency guard UI.       │
// │                                                                          │
// │  中文：模块职责：安装后组件管理——状态展示、安装/卸载/启停/更新/回滚与           │
// │         依赖阻断保护界面。                                                  │
// │                                                                          │
// │  安全策略：无真实后端连接时，所有可能造成副作用的操作完全禁用。               │
// │  绝不在 NOT_CONNECTED 下弹出 window.alert 或执行未经验证的变更。            │
// └─────────────────────────────────────────────────────────────────────────┘

import { useState, useMemo, useCallback, useEffect } from "react";
import { useI18n } from "../../../src/i18n";
import { installerText } from "./copy";
import { useInstallerProvider } from "./provider";
import {
  type ComponentLifecycleStatus,
  type InstallerOperationKind,
  type ManagedComponent,
} from "./contracts";
import "./installer.css";

// ---------------------------------------------------------------------------
// § Sub-components
// ---------------------------------------------------------------------------

function StatusPill({ status }: { status: ComponentLifecycleStatus }) {
  return (
    <span className={`installer-status-pill installer-status-pill--${status}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function UninstallConfirmDialog({
  component,
  onConfirm,
  onCancel,
  l,
}: {
  component: ManagedComponent;
  onConfirm: () => void;
  onCancel: () => void;
  l: (v: string) => string;
}) {
  const retention = component.retentionPolicyOnUninstall;

  let dataNoticeClass = "installer-confirm-dialog__data-notice--unknown";
  let dataNoticeText = l(
    "User data retention policy is unverified. Cyrene cannot guarantee data preservation upon uninstall.",
  );

  if (retention === "retain") {
    dataNoticeClass = "installer-confirm-dialog__data-notice--retain";
    dataNoticeText = l("User data will be retained after uninstall.");
  } else if (retention === "delete") {
    dataNoticeClass = "installer-confirm-dialog__data-notice--remove";
    dataNoticeText = l("User data will be removed. This cannot be undone.");
  }

  return (
    <div className="installer-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="uninstall-dialog-title">
      <div className="installer-confirm-dialog">
        <h3 className="installer-confirm-dialog__title" id="uninstall-dialog-title">
          {l("Confirm uninstall")} — {component.name}
        </h3>
        <p className="installer-confirm-dialog__body">
          {component.description}
        </p>
        <div className={`installer-confirm-dialog__data-notice ${dataNoticeClass}`} role="note">
          {dataNoticeText}
        </div>
        <div className="installer-confirm-dialog__actions">
          <button className="installer-btn" onClick={onCancel}>
            {l("Cancel")}
          </button>
          <button className="installer-btn installer-btn--danger" onClick={onConfirm}>
            {l("Uninstall")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComponentManagementCard({
  comp,
  isDemoOrDisconnected,
  onExecuteOp,
  l,
}: {
  comp: ManagedComponent;
  isDemoOrDisconnected: boolean;
  onExecuteOp: (comp: ManagedComponent, op: InstallerOperationKind) => void;
  l: (v: string) => string;
}) {
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const hasBindings = comp.activeBindings.length > 0;

  const operationLabels: Record<InstallerOperationKind, string> = {
    install: l("Install"),
    uninstall: l("Uninstall"),
    update: l("Update"),
    rollback: l("Rollback"),
    enable: l("Enable"),
    disable: l("Disable"),
    start: l("Start"),
    stop: l("Stop"),
  };

  const operationTone: Partial<Record<InstallerOperationKind, "danger">> = {
    uninstall: "danger",
  };

  const handleOperationClick = (op: InstallerOperationKind) => {
    if (isDemoOrDisconnected) return; // Safety guard: ignore clicks in demo mode
    if (op === "uninstall") {
      if (hasBindings) return; // blocked by bindings
      setConfirmUninstall(true);
    } else {
      onExecuteOp(comp, op);
    }
  };

  return (
    <>
      <article className="installer-mgmt-card">
        <div className="installer-mgmt-card__header">
          <div className="installer-mgmt-card__name">{comp.name}</div>
          <StatusPill status={comp.status} />
        </div>

        {comp.installedVersion && (
          <p style={{ margin: 0, fontSize: "var(--dh-fs-xs)", color: "var(--dh-text-tertiary)", fontFamily: "var(--dh-font-mono)" }}>
            v{comp.installedVersion}
            {comp.availableVersion && comp.availableVersion !== comp.installedVersion
              ? ` → v${comp.availableVersion} available`
              : ""}
          </p>
        )}

        <p style={{ margin: 0, fontSize: "var(--dh-fs-xs)", color: "var(--dh-text-tertiary)" }}>
          {comp.description}
        </p>

        {/* Binding guard */}
        {hasBindings && (
          <div className="installer-mgmt-card__guard" role="alert">
            <p style={{ margin: 0 }}>
              {l("This component is in use by:")}
            </p>
            {comp.activeBindings.map((binding) => (
              <p key={`${binding.productId}-${binding.bindingDescription}`} className="installer-mgmt-card__guard-binding" style={{ margin: 0 }}>
                {binding.productName} — {binding.bindingDescription}
              </p>
            ))}
            <p style={{ margin: 0 }}>
              {l("Removal is blocked because this component is actively bound to a running product. Disable the product first.")}
            </p>
          </div>
        )}

        {/* Operation buttons */}
        {comp.allowedOperations.length > 0 && (
          <div className="installer-mgmt-card__actions">
            {comp.allowedOperations.map((op) => {
              const isDanger = operationTone[op] === "danger";
              const isBlocked = (op === "uninstall" && hasBindings) || isDemoOrDisconnected;
              const buttonTitle = isDemoOrDisconnected
                ? l("Operation disabled in demo mode.")
                : op === "uninstall" && hasBindings
                ? l("Removal is blocked because this component is actively bound to a running product. Disable the product first.")
                : undefined;

              return (
                <button
                  key={op}
                  className={`installer-btn${isDanger ? " installer-btn--danger" : ""}`}
                  disabled={isBlocked}
                  onClick={() => handleOperationClick(op)}
                  title={buttonTitle}
                  aria-disabled={isBlocked}
                >
                  {operationLabels[op]}
                </button>
              );
            })}
          </div>
        )}

        {!comp.compatibleWithCurrentPlatform && (
          <p style={{ margin: 0, fontSize: "var(--dh-fs-xs)", color: "var(--dh-text-tertiary)" }}>
            {l("This platform is not compatible.")}
          </p>
        )}
      </article>

      {confirmUninstall && !isDemoOrDisconnected && (
        <UninstallConfirmDialog
          component={comp}
          l={l}
          onConfirm={() => {
            setConfirmUninstall(false);
            onExecuteOp(comp, "uninstall");
          }}
          onCancel={() => setConfirmUninstall(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// § Main export
// ---------------------------------------------------------------------------

/**
 * Component management page for post-install operations.
 *
 * All state and permissible actions are governed authoritatively by the
 * InstallerProvider. In demo / NOT_CONNECTED mode, all mutating operations
 * are completely disabled without alerts.
 *
 * 中文：组件管理页。权威状态来自 Provider；未连接时所有副作用操作均安全禁用。
 */
export function InstallerManagementPanel() {
  const { locale } = useI18n();
  const l = useCallback((v: string) => installerText(v, locale), [locale]);
  const provider = useInstallerProvider();

  const [components, setComponents] = useState<ManagedComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const isDemoOrDisconnected = provider.isDemo || !provider.isConnected;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorBanner(null);

    provider
      .getManagedComponents()
      .then((items) => {
        if (active) {
          setComponents(items);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setErrorBanner(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [provider]);

  const handleExecuteOp = async (comp: ManagedComponent, op: InstallerOperationKind) => {
    if (isDemoOrDisconnected) {
      setErrorBanner(l("Operation disabled in demo mode."));
      return;
    }

    try {
      setErrorBanner(null);
      setActionNotice(`${l(op.charAt(0).toUpperCase() + op.slice(1))} ${comp.name}…`);
      await provider.executeComponentOperation({
        componentId: comp.id,
        operation: op,
      });
      setActionNotice(null);
    } catch (err) {
      setActionNotice(null);
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const statusOrder: ComponentLifecycleStatus[] = [
    "running",
    "enabled",
    "configured",
    "installed",
    "verified",
    "available",
    "failed",
    "not_installed",
  ];

  const sorted = useMemo(
    () =>
      [...components].sort(
        (a, b) =>
          statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status),
      ),
    [components],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* NOT_CONNECTED banner */}
      {isDemoOrDisconnected && (
        <div className="installer-not-connected" role="status">
          {l("⚠ NOT CONNECTED — this view uses mock data. Install operations are disabled.")}
        </div>
      )}

      {/* Action feedback / error alert banners */}
      {errorBanner && (
        <div className="installer-affinity-warning" role="alert" style={{ margin: "var(--dh-space-2) var(--dh-space-4)" }}>
          <span>{errorBanner}</span>
          <button
            className="installer-btn"
            style={{ marginLeft: "var(--dh-space-3)", height: "22px", fontSize: "var(--dh-fs-xs)" }}
            onClick={() => setErrorBanner(null)}
          >
            ✕
          </button>
        </div>
      )}

      {actionNotice && (
        <div className="installer-selection-summary" role="status" style={{ margin: "var(--dh-space-2) var(--dh-space-4)" }}>
          {actionNotice}
        </div>
      )}

      <div className="installer-main" style={{ flex: 1 }}>
        <div className="installer-detail__header">
          <span className="installer-detail__eyebrow">{l("Component Management")}</span>
          <h2 className="installer-detail__title">{l("Manage installed components")}</h2>
        </div>
        <hr className="installer-horizon" />

        {loading ? (
          <div className="installer-state" role="status" aria-live="polite">
            <h3 className="installer-state__title">{l("Loading…")}</h3>
          </div>
        ) : (
          <div className="installer-mgmt-list">
            {sorted.map((comp) => (
              <ComponentManagementCard
                key={comp.id}
                comp={comp}
                isDemoOrDisconnected={isDemoOrDisconnected}
                onExecuteOp={handleExecuteOp}
                l={l}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
