// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 InstallerManagementPanel.tsx                                         │
// │  Module: services/installer                                              │
// │  Role: Post-install component management: status, install/uninstall,     │
// │         enable/disable, update, rollback, and dependency guard UI.       │
// │                                                                          │
// │  中文：模块职责：安装后组件管理——状态展示、安装/卸载/启停/更新/回滚与           │
// │         依赖阻断保护界面。                                                  │
// │                                                                          │
// │  ⚠ NOT_CONNECTED: component status and all operations use mock data.     │
// │    Wire to real Installer API once /api/installer/v1/components and      │
// │    /operations endpoints are implemented.                                 │
// └─────────────────────────────────────────────────────────────────────────┘

import { useState, useMemo, useCallback } from "react";
import { useI18n } from "../../../src/i18n";
import { installerText } from "./copy";
import {
  MOCK_COMPONENT_CATALOG,
  type InstallerComponent,
  type ComponentLifecycleStatus,
  type InstallerOperationKind,
  type ComponentBinding,
} from "./contracts";
import "./installer.css";

// ---------------------------------------------------------------------------
// § Types (management-layer extension)
// ---------------------------------------------------------------------------

interface ManagedComponent extends InstallerComponent {
  /** Active bindings from products using this component */
  activeBindings: ComponentBinding[];
  /** Operations the backend currently permits */
  allowedOperations: InstallerOperationKind[];
}

// ---------------------------------------------------------------------------
// § NOT_CONNECTED: mock management data
// ---------------------------------------------------------------------------

function buildMockManagedComponents(): ManagedComponent[] {
  // NOT_CONNECTED — real data comes from GET /api/installer/v1/components
  // with enriched management fields.
  return MOCK_COMPONENT_CATALOG.components.map((c) => ({
    ...c,
    // Simulate some components as installed
    installedVersion: null,
    status: "available" as ComponentLifecycleStatus,
    activeBindings: [],
    allowedOperations: (["install"] as InstallerOperationKind[]),
  }));
}

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
  const retention = component.status === "not_installed"
    ? null
    : (component as unknown as { retentionPolicyOnUninstall?: string }).retentionPolicyOnUninstall;

  let dataNoticeClass = "installer-confirm-dialog__data-notice--unknown";
  let dataNoticeText = l("User data retention is unknown. Review the component documentation before proceeding.");
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
          {l("This component is required by the selected workload and cannot be removed.")}
        </p>
        <div className={`installer-confirm-dialog__data-notice ${dataNoticeClass}`}>
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
  l,
}: {
  comp: ManagedComponent;
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

  const handleOperation = (op: InstallerOperationKind) => {
    if (op === "uninstall") {
      if (hasBindings) return; // guard — button should be disabled
      setConfirmUninstall(true);
    } else {
      // NOT_CONNECTED: real operation would POST to /api/installer/v1/operations
      window.alert(
        `[NOT_CONNECTED] Operation "${op}" on ${comp.id} would be sent to the Installer API.`,
      );
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
          <div className="installer-mgmt-card__guard">
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
              const isBlocked = op === "uninstall" && hasBindings;
              return (
                <button
                  key={op}
                  className={`installer-btn${isDanger ? " installer-btn--danger" : ""}`}
                  disabled={isBlocked}
                  onClick={() => handleOperation(op)}
                  title={isBlocked ? l("Removal is blocked because this component is actively bound to a running product. Disable the product first.") : undefined}
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

      {confirmUninstall && (
        <UninstallConfirmDialog
          component={comp}
          l={l}
          onConfirm={() => {
            setConfirmUninstall(false);
            // NOT_CONNECTED: real operation here
            window.alert(`[NOT_CONNECTED] Uninstall ${comp.id} confirmed — would call Installer API.`);
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
 * ⚠ NOT_CONNECTED: uses mock component status.
 * Wire to GET /api/installer/v1/components and POST /api/installer/v1/operations.
 *
 * Lifecycle statuses displayed: available, verified, installed, configured,
 * enabled, running, failed.
 *
 * 中文：当前为 Mock 数据，所有操作均不实际执行。
 */
export function InstallerManagementPanel() {
  const { locale } = useI18n();
  const l = useCallback((v: string) => installerText(v, locale), [locale]);

  // NOT_CONNECTED: replace with API call
  const components = useMemo(() => buildMockManagedComponents(), []);

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
      <div className="installer-not-connected" role="status">
        {l("⚠ NOT CONNECTED — this view uses mock data. Install operations are disabled.")}
      </div>

      <div className="installer-main" style={{ flex: 1 }}>
        <div className="installer-detail__header">
          <span className="installer-detail__eyebrow">{l("Component Management")}</span>
          <h2 className="installer-detail__title">{l("Manage installed components")}</h2>
        </div>
        <hr className="installer-horizon" />

        <div className="installer-mgmt-list">
          {sorted.map((comp) => (
            <ComponentManagementCard key={comp.id} comp={comp} l={l} />
          ))}
        </div>
      </div>
    </div>
  );
}
