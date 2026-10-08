// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 InstallerPage.tsx                                                    │
// │  Module: services/installer                                              │
// │  Role: Top-level installer shell — step progress bar, page routing,      │
// │         and view composition for the full install flow.                  │
// │                                                                          │
// │  中文：模块职责：安装器顶层外壳——步骤进度条、页面路由及完整安装流程组合。      │
// └─────────────────────────────────────────────────────────────────────────┘

import { useState, useCallback } from "react";
import { useI18n } from "../../../src/i18n";
import { installerText } from "./copy";
import { InstallerWorkloadsPanel } from "./InstallerWorkloadsPanel";
import { InstallerPlanPanel } from "./InstallerPlanPanel";
import { InstallerManagementPanel } from "./InstallerManagementPanel";
import type { InstallationPlan } from "./contracts";
import "./installer.css";

// ---------------------------------------------------------------------------
// § Step definition
// ---------------------------------------------------------------------------

type Step = "select" | "plan" | "progress" | "management";

interface StepDef {
  id: Step;
  label: string;
  labelCn: string;
}

const STEPS: StepDef[] = [
  { id: "select", label: "Select", labelCn: "选择" },
  { id: "plan", label: "Plan", labelCn: "计划" },
  { id: "progress", label: "Progress", labelCn: "进度" },
  { id: "management", label: "Manage", labelCn: "管理" },
];

// ---------------------------------------------------------------------------
// § Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({
  steps,
  current,
  locale,
}: {
  steps: StepDef[];
  current: Step;
  locale: string;
}) {
  const currentIndex = steps.findIndex((s) => s.id === current);

  return (
    <nav className="installer-steps" aria-label="Installation progress">
      {steps.map((step, index) => {
        const isDone = index < currentIndex;
        const isActive = step.id === current;
        const className = [
          "installer-step",
          isDone ? "installer-step--done" : "",
          isActive ? "installer-step--active" : "",
        ].filter(Boolean).join(" ");

        return (
          <div key={step.id} style={{ display: "flex", alignItems: "center" }}>
            <div className={className}>
              <div className="installer-step__marker" aria-hidden="true" />
              <span className="installer-step__label">
                {locale === "zh-CN" ? step.labelCn : step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className="installer-step__connector" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// § Progress placeholder (step 3)
// ---------------------------------------------------------------------------

function InstallProgressPlaceholder({ l }: { l: (v: string) => string }) {
  return (
    <div className="installer-main" style={{ flex: 1 }}>
      <div className="installer-detail__header">
        <span className="installer-detail__eyebrow">Progress</span>
        <h2 className="installer-detail__title">{l("Loading…")}</h2>
      </div>
      <hr className="installer-horizon" />
      <div className="installer-not-connected" role="status">
        {l("⚠ NOT CONNECTED — this view uses mock data. Install operations are disabled.")}
      </div>
      <div className="installer-state">
        <h3 className="installer-state__title">Installation progress</h3>
        <p className="installer-state__detail">
          {/* NOT_CONNECTED: real progress comes from streaming the Installer API
              operation status endpoint. Wire to GET /api/installer/v1/operations/:id/stream */}
          [NOT_CONNECTED] Progress view is reserved for the real Installer API operation stream.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// § Main export
// ---------------------------------------------------------------------------

/**
 * Top-level Cyrene Installer page.
 *
 * Composes the step progress bar and three main panels:
 *   1. Workload / Individual Component selection
 *   2. Installation plan review
 *   3. Installation progress (NOT_CONNECTED placeholder)
 *   4. Component management (accessible at any time after first visit)
 *
 * 中文：顶层安装器页面。包含步骤进度条与三个主面板。
 */
export function InstallerPage() {
  const { locale } = useI18n();
  const l = useCallback((v: string) => installerText(v, locale), [locale]);

  const [step, setStep] = useState<Step>("select");
  const [selectedWorkloadIds, setSelectedWorkloadIds] = useState<string[]>([]);
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>([]);
  const [excludedComponentIds, setExcludedComponentIds] = useState<string[]>([]);
  const [showManagement, setShowManagement] = useState(false);

  const handleSelectNext = (workloadIds: string[], componentIds: string[], excludedIds: string[] = []) => {
    setSelectedWorkloadIds(workloadIds);
    setSelectedComponentIds(componentIds);
    setExcludedComponentIds(excludedIds);
    setStep("plan");
  };

  const handleInstall = (_plan: InstallationPlan) => {
    // NOT_CONNECTED: would POST to /api/installer/v1/operations
    setStep("progress");
  };

  return (
    <div className="installer-shell" style={{ height: "100%", overflow: "hidden" }}>
      {/* Step progress */}
      {!showManagement && (
        <StepIndicator steps={STEPS.filter((s) => s.id !== "management")} current={step} locale={locale} />
      )}

      {/* Tab bar for management mode */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--dh-border-subtle)", background: "var(--dh-bg-sheet)" }}>
        <button
          className={`installer-tab${!showManagement ? " installer-tab--active" : ""}`}
          onClick={() => setShowManagement(false)}
          aria-pressed={!showManagement}
        >
          {locale === "zh-CN" ? "安装" : "Install"}
        </button>
        <button
          className={`installer-tab${showManagement ? " installer-tab--active" : ""}`}
          onClick={() => setShowManagement(true)}
          aria-pressed={showManagement}
        >
          {l("Component Management")}
        </button>
      </div>

      {/* Page content */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        {showManagement ? (
          <InstallerManagementPanel />
        ) : step === "select" ? (
          <InstallerWorkloadsPanel
            onNext={handleSelectNext}
            initialWorkloadIds={selectedWorkloadIds}
            initialComponentIds={selectedComponentIds}
            initialExcludedRecommendedIds={excludedComponentIds}
          />
        ) : step === "plan" ? (
          <InstallerPlanPanel
            workloadIds={selectedWorkloadIds}
            componentIds={selectedComponentIds}
            excludedComponentIds={excludedComponentIds}
            onBack={() => setStep("select")}
            onInstall={handleInstall}
          />
        ) : (
          <InstallProgressPlaceholder l={l} />
        )}
      </div>
    </div>
  );
}
