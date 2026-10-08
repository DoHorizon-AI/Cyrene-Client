// ┌─────────────────────────────────────────────────────────────────────────┐
// │  📄 InstallerWorkloadsPanel.tsx                                          │
// │  Module: services/installer                                              │
// │  Role: Workload and Individual Component selection step of the           │
// │         Cyrene Installer UI.                                             │
// │                                                                          │
// │  中文：模块职责：Cyrene 安装器工作负载与独立组件选择步骤。                   │
// │                                                                          │
// │  ⚠ NOT_CONNECTED: component catalog and workload list use mock data.      │
// │    Replace MOCK_COMPONENT_CATALOG / MOCK_WORKLOAD_CATALOG with real      │
// │    GET /api/installer/v1/workloads and /components calls when ready.     │
// └─────────────────────────────────────────────────────────────────────────┘

import { useState, useMemo, useCallback, useEffect } from "react";
import { useI18n } from "../../../src/i18n";
import { installerText } from "./copy";
import { useInstallerProvider } from "./provider";
import {
  MOCK_WORKLOAD_CATALOG,
  MOCK_COMPONENT_CATALOG,
  type ComponentAffinity,
  type InstallerComponent,
  type WorkloadEntry,
} from "./contracts";
import "./installer.css";

// ---------------------------------------------------------------------------
// § Types
// ---------------------------------------------------------------------------

/** The effective affinity of a component in the current selection. */
type EffectiveAffinity = ComponentAffinity | "manual";

/** Reasons a component is selected (workload ids + manual toggle). */
interface ComponentSelectionReason {
  affinity: EffectiveAffinity;
  /** Workload IDs that demand this component */
  fromWorkloads: string[];
}

// ---------------------------------------------------------------------------
// § Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function resolveComponentSelection(
  selectedWorkloadIds: ReadonlySet<string>,
  excludedRecommendedComponentIds: ReadonlySet<string>,
  manualComponentIds: ReadonlySet<string>,
  workloads: readonly WorkloadEntry[],
): Map<string, ComponentSelectionReason> {
  const result = new Map<string, ComponentSelectionReason>();

  // 1 — Resolve from selected workloads
  for (const wl of workloads) {
    if (!selectedWorkloadIds.has(wl.id)) continue;
    for (const entry of wl.components) {
      if (entry.affinity === "optional") {
        // Optionals from workload are only included if user manually checked them
        if (!manualComponentIds.has(entry.componentId)) continue;
      }
      if (entry.affinity === "recommended" && excludedRecommendedComponentIds.has(entry.componentId)) {
        // User explicitly deselected this recommended component
        continue;
      }

      const existing = result.get(entry.componentId);
      if (!existing) {
        result.set(entry.componentId, {
          affinity: entry.affinity,
          fromWorkloads: [wl.id],
        });
      } else {
        // Upgrade affinity: required > recommended > optional
        const stronger = affinityRank(entry.affinity) > affinityRank(existing.affinity)
          ? entry.affinity
          : existing.affinity;
        result.set(entry.componentId, {
          affinity: stronger,
          fromWorkloads: [...existing.fromWorkloads, wl.id],
        });
      }
    }
  }

  // 2 — Add manual components not already covered
  for (const id of manualComponentIds) {
    if (!result.has(id)) {
      result.set(id, { affinity: "optional", fromWorkloads: [] });
    }
  }

  return result;
}

function affinityRank(a: EffectiveAffinity): number {
  return a === "required" ? 3 : a === "recommended" ? 2 : 1;
}

// ---------------------------------------------------------------------------
// § Sub-components
// ---------------------------------------------------------------------------

function AffinityChip({ affinity, l }: { affinity: ComponentAffinity | "manual"; l: (v: string) => string }) {
  if (affinity === "manual") return null;
  const labels: Record<ComponentAffinity, string> = {
    required: l("Required"),
    recommended: l("Recommended"),
    optional: l("Optional"),
  };
  return (
    <span className={`installer-chip installer-chip--${affinity}`}>
      {labels[affinity]}
    </span>
  );
}

function StatusPillSmall({ status }: { status: InstallerComponent["status"] }) {
  const label = status.replace(/_/g, " ");
  return (
    <span className={`installer-status-pill installer-status-pill--${status}`}>
      {label}
    </span>
  );
}

function AffinityWarning({
  componentId,
  affinity,
  workloads,
  l,
  onRestore,
}: {
  componentId: string;
  affinity: ComponentAffinity;
  workloads: readonly WorkloadEntry[];
  l: (v: string) => string;
  onRestore?: () => void;
}) {
  if (affinity === "required") {
    return (
      <div className="installer-affinity-warning" role="alert">
        {l("This component is required by the selected workload and cannot be removed.")}
      </div>
    );
  }
  if (affinity === "recommended") {
    const affected = workloads
      .filter((wl) => wl.components.some((c) => c.componentId === componentId && c.affinity === "recommended"))
      .map((wl) => wl.name);
    if (affected.length === 0) return null;
    return (
      <div className="installer-affinity-warning" role="alert">
        <div>
          {l("This component is recommended. Removing it may limit functionality.")}
          <br />
          {l("If you remove this component, the following capabilities will be affected:")}
          <ul className="installer-affinity-warning__list">
            {affected.map((name) => <li key={name}>{name}</li>)}
          </ul>
        </div>
        {onRestore && (
          <button
            type="button"
            className="installer-btn"
            style={{ marginTop: "var(--dh-space-2)", height: "24px", fontSize: "var(--dh-fs-xs)" }}
            onClick={(e) => {
              e.stopPropagation();
              onRestore();
            }}
          >
            ↺ {l("Restore")}
          </button>
        )}
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// § Sidebar — Workloads tab
// ---------------------------------------------------------------------------

function WorkloadsTab({
  workloads,
  selectedWorkloadIds,
  onToggle,
  componentMap,
  l,
}: {
  workloads: readonly WorkloadEntry[];
  selectedWorkloadIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  componentMap: ReadonlyMap<string, InstallerComponent>;
  l: (v: string) => string;
}) {
  if (workloads.length === 0) {
    return (
      <div className="installer-state">
        <p className="installer-state__detail">{l("No workloads available")}</p>
      </div>
    );
  }

  return (
    <div className="installer-workloads" role="group" aria-label="Workload choices">
      {workloads.map((wl) => {
        const selected = selectedWorkloadIds.has(wl.id);
        return (
          <article
            key={wl.id}
            className={`installer-workload-card${selected ? " installer-workload-card--selected" : ""}`}
            role="checkbox"
            aria-checked={selected}
            tabIndex={0}
            onClick={() => onToggle(wl.id)}
            onKeyDown={(e) => {
              // Prevent double-toggle if event originated from a child (e.g. checkbox)
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle(wl.id);
              }
            }}
          >
            <input
              type="checkbox"
              tabIndex={-1}
              checked={selected}
              onChange={(e) => {
                e.stopPropagation();
                onToggle(wl.id);
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.stopPropagation();
                }
              }}
              className="installer-workload-card__check"
              aria-label={wl.name}
            />
            <div>
              <h3 className="installer-workload-card__title">{wl.name}</h3>
              <p className="installer-workload-card__desc">{wl.description}</p>
              <div className="installer-workload-card__chips">
                {wl.components.map((c) => {
                  const comp = componentMap.get(c.componentId);
                  const name = comp?.name ?? c.componentId;
                  return (
                    <span
                      key={c.componentId}
                      className={`installer-chip installer-chip--${c.affinity}`}
                      title={name}
                    >
                      {name}
                    </span>
                  );
                })}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// § Sidebar — Individual Components tab
// ---------------------------------------------------------------------------

type FilterMode = "all" | "installed" | "available" | "incompatible";

function IndividualComponentsTab({
  components,
  selection,
  excludedRecommendedIds,
  workloads,
  onToggle,
  l,
}: {
  components: readonly InstallerComponent[];
  selection: ReadonlyMap<string, ComponentSelectionReason>;
  excludedRecommendedIds: ReadonlySet<string>;
  workloads: readonly WorkloadEntry[];
  onToggle: (id: string) => void;
  l: (v: string) => string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return components.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !c.description.toLowerCase().includes(q)) return false;
      if (filter === "installed") return c.installedVersion !== null;
      if (filter === "available") return c.installedVersion === null && c.compatibleWithCurrentPlatform;
      if (filter === "incompatible") return !c.compatibleWithCurrentPlatform;
      return true;
    });
  }, [components, query, filter]);

  const filterBtns: Array<{ mode: FilterMode; label: string }> = [
    { mode: "all", label: l("All") },
    { mode: "installed", label: l("Installed") },
    { mode: "available", label: l("Available") },
    { mode: "incompatible", label: l("Not compatible") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div className="installer-component-search">
        <input
          type="search"
          placeholder={l("Search components…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={l("Search components…")}
        />
      </div>
      <div className="installer-filter-bar" role="toolbar" aria-label="Filter">
        {filterBtns.map(({ mode, label }) => (
          <button
            key={mode}
            className={`installer-filter-btn${filter === mode ? " installer-filter-btn--active" : ""}`}
            onClick={() => setFilter(mode)}
            aria-pressed={filter === mode}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="installer-component-list" role="list">
        {filtered.length === 0 && (
          <div className="installer-state">
            <p className="installer-state__detail">{l("No components match your search.")}</p>
          </div>
        )}
        {filtered.map((c) => {
          const reason = selection.get(c.id);
          const isSelected = !!reason;
          const isRequired = reason?.affinity === "required";
          const isExcludedRecommended = excludedRecommendedIds.has(c.id);
          const incompatible = !c.compatibleWithCurrentPlatform;

          return (
            <div
              key={c.id}
              className={`installer-component-row${isSelected ? " installer-component-row--selected" : ""}${incompatible ? " installer-component-row--incompatible" : ""}`}
              role="checkbox"
              aria-checked={isSelected}
              aria-disabled={isRequired || incompatible}
              tabIndex={incompatible || isRequired ? -1 : 0}
              onClick={() => !isRequired && !incompatible && onToggle(c.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (!isRequired && !incompatible && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onToggle(c.id);
                }
              }}
            >
              <input
                type="checkbox"
                tabIndex={-1}
                checked={isSelected}
                disabled={isRequired || incompatible}
                onChange={() => !isRequired && !incompatible && onToggle(c.id)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.stopPropagation();
                  }
                }}
                aria-label={c.name}
              />
              <div>
                <p className="installer-component-row__name">{c.name}</p>
                <p className="installer-component-row__desc">{c.description}</p>
                {reason && (
                  <AffinityChip affinity={reason.affinity} l={l} />
                )}
                {isExcludedRecommended && (
                  <div style={{ marginTop: 4 }}>
                    <span className="installer-chip installer-chip--recommended" style={{ opacity: 0.75 }}>
                      {l("Recommended")} ({l("Not selected")})
                    </span>
                    <AffinityWarning
                      componentId={c.id}
                      affinity="recommended"
                      workloads={workloads}
                      l={l}
                      onRestore={() => onToggle(c.id)}
                    />
                  </div>
                )}
              </div>
              <div className="installer-component-row__meta">
                <StatusPillSmall status={c.status} />
                {c.availableVersion && (
                  <div style={{ marginTop: 4, fontFamily: "var(--dh-font-mono)", fontSize: "var(--dh-fs-xs)" }}>
                    v{c.availableVersion}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// § Detail pane
// ---------------------------------------------------------------------------

function DetailPane({
  selectedWorkloadIds,
  selection,
  components,
  workloads,
  onDeselect,
  l,
}: {
  selectedWorkloadIds: ReadonlySet<string>;
  selection: ReadonlyMap<string, ComponentSelectionReason>;
  components: readonly InstallerComponent[];
  workloads: readonly WorkloadEntry[];
  onDeselect: (componentId: string) => void;
  l: (v: string) => string;
}) {
  const componentMap = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);

  if (selection.size === 0) {
    return (
      <div className="installer-detail">
        <div className="installer-state">
          <h3 className="installer-state__title">{l("Select at least one workload or component")}</h3>
          <p className="installer-state__detail">
            {l("Choose what to install")}
          </p>
        </div>
      </div>
    );
  }

  const entries = Array.from(selection.entries()).sort(([, a], [, b]) =>
    affinityRank(a.affinity as ComponentAffinity) - affinityRank(b.affinity as ComponentAffinity)
  ).reverse();

  return (
    <div className="installer-detail">
      <div className="installer-detail__header">
        <span className="installer-detail__eyebrow">{l("Selected")}</span>
        <h2 className="installer-detail__title">
          {selection.size} {selection.size === 1 ? "component" : "components"}
        </h2>
      </div>
      <hr className="installer-horizon" />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--dh-space-3)" }}>
        {entries.map(([componentId, reason]) => {
          const comp = componentMap.get(componentId);
          const name = comp?.name ?? componentId;
          const isRequired = reason.affinity === "required";

          return (
            <div key={componentId} className="installer-plan__item" style={{ flexDirection: "column", gap: "var(--dh-space-2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--dh-space-3)" }}>
                <span className="installer-plan__item-name">{name}</span>
                <AffinityChip affinity={reason.affinity} l={l} />
                {!isRequired && (
                  <button
                    className="installer-btn"
                    style={{ padding: "0 var(--dh-space-2)", height: "22px", fontSize: "var(--dh-fs-xs)" }}
                    onClick={() => onDeselect(componentId)}
                    aria-label={`Remove ${name}`}
                  >
                    ✕
                  </button>
                )}
              </div>
              {comp?.description && (
                <p style={{ margin: 0, fontSize: "var(--dh-fs-xs)", color: "var(--dh-text-tertiary)" }}>
                  {comp.description}
                </p>
              )}
              {reason.affinity !== "manual" && reason.affinity !== "optional" && (
                <AffinityWarning
                  componentId={componentId}
                  affinity={reason.affinity as ComponentAffinity}
                  workloads={workloads}
                  l={l}
                />
              )}
              {reason.fromWorkloads.length > 0 && (
                <p style={{ margin: 0, fontSize: "var(--dh-fs-xs)", color: "var(--dh-text-tertiary)" }}>
                  {reason.fromWorkloads.map((wid) => workloads.find((w) => w.id === wid)?.name ?? wid).join(", ")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// § Main export
// ---------------------------------------------------------------------------

/**
 * Workload and Individual Component selection step of the Cyrene Installer.
 *
 * ⚠ NOT_CONNECTED: workload catalog and component catalog use mock data.
 * Replace with real API calls once the Installer API endpoint is available.
 * Dependency resolution is performed entirely by the backend — this component
 * never implements a second resolver.
 *
 * 中文：使用 Mock 数据；真实安装前不执行实际操作。
 */
export function InstallerWorkloadsPanel({
  onNext,
  initialWorkloadIds = [],
  initialComponentIds = [],
  initialExcludedRecommendedIds = [],
}: {
  onNext: (workloadIds: string[], componentIds: string[], excludedComponentIds?: string[]) => void;
  initialWorkloadIds?: string[];
  initialComponentIds?: string[];
  initialExcludedRecommendedIds?: string[];
}) {
  const { locale } = useI18n();
  const l = useCallback((v: string) => installerText(v, locale), [locale]);
  const provider = useInstallerProvider();

  const [workloads, setWorkloads] = useState<WorkloadEntry[]>(() =>
    provider.isDemo ? MOCK_WORKLOAD_CATALOG.workloads : [],
  );
  const [components, setComponents] = useState<InstallerComponent[]>(() =>
    provider.isDemo ? MOCK_COMPONENT_CATALOG.components : [],
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(!provider.isDemo);
  const [retryTrigger, setRetryTrigger] = useState(0);

  useEffect(() => {
    let active = true;

    if (provider.isDemo) {
      setWorkloads(MOCK_WORKLOAD_CATALOG.workloads);
      setComponents(MOCK_COMPONENT_CATALOG.components);
      setCatalogLoading(false);
      setCatalogError(null);
      return;
    }

    setCatalogLoading(true);
    setCatalogError(null);

    Promise.all([
      provider.getWorkloadCatalog(),
      provider.getComponentCatalog(),
      provider.verifyConnection ? provider.verifyConnection() : Promise.resolve(false),
    ])
      .then(([w, c]) => {
        if (active) {
          setWorkloads(w.workloads || []);
          setComponents(c.components || []);
          setCatalogLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          // Strictly clear catalog and do NOT fall back to mock catalog on failure
          setWorkloads([]);
          setComponents([]);
          setCatalogError(err instanceof Error ? err.message : String(err));
          setCatalogLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [provider, retryTrigger]);

  const componentMap = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);

  const [tab, setTab] = useState<"workloads" | "components">("workloads");
  const [selectedWorkloadIds, setSelectedWorkloadIds] = useState<Set<string>>(
    () => new Set(initialWorkloadIds),
  );
  const [manualComponentIds, setManualComponentIds] = useState<Set<string>>(
    () => new Set(initialComponentIds),
  );
  const [excludedRecommendedComponentIds, setExcludedRecommendedComponentIds] = useState<Set<string>>(
    () => new Set(initialExcludedRecommendedIds),
  );

  const selection = useMemo(
    () => resolveComponentSelection(selectedWorkloadIds, excludedRecommendedComponentIds, manualComponentIds, workloads),
    [selectedWorkloadIds, excludedRecommendedComponentIds, manualComponentIds, workloads],
  );

  const toggleWorkload = (id: string) => {
    setSelectedWorkloadIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleComponent = (id: string) => {
    // Check if required by any selected workload
    const isRequired = Array.from(selectedWorkloadIds).some((wid) => {
      const wl = workloads.find((w) => w.id === wid);
      return wl?.components.some((c) => c.componentId === id && c.affinity === "required");
    });
    if (isRequired) return; // cannot be toggled

    // Check if recommended by any selected workload
    const isRecommended = Array.from(selectedWorkloadIds).some((wid) => {
      const wl = workloads.find((w) => w.id === wid);
      return wl?.components.some((c) => c.componentId === id && c.affinity === "recommended");
    });

    if (isRecommended) {
      setExcludedRecommendedComponentIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }

    // Optional or standalone
    setManualComponentIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const deselect = (componentId: string) => {
    const isRequired = Array.from(selectedWorkloadIds).some((wid) => {
      const wl = workloads.find((w) => w.id === wid);
      return wl?.components.some((c) => c.componentId === componentId && c.affinity === "required");
    });
    if (isRequired) return;

    const isRecommended = Array.from(selectedWorkloadIds).some((wid) => {
      const wl = workloads.find((w) => w.id === wid);
      return wl?.components.some((c) => c.componentId === componentId && c.affinity === "recommended");
    });

    if (isRecommended) {
      setExcludedRecommendedComponentIds((prev) => new Set(prev).add(componentId));
      return;
    }

    setManualComponentIds((prev) => {
      const next = new Set(prev);
      next.delete(componentId);
      return next;
    });
  };

  const handleNext = () => {
    onNext(
      Array.from(selectedWorkloadIds),
      Array.from(manualComponentIds),
      Array.from(excludedRecommendedComponentIds),
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* NOT_CONNECTED banner */}
      {(provider.isDemo || !provider.isConnected) && (
        <div className="installer-not-connected" role="status">
          {l("⚠ NOT CONNECTED — this view uses mock data. Install operations are disabled.")}
        </div>
      )}

      {/* Explicit catalog error banner and retry button */}
      {catalogError && (
        <div
          className="installer-affinity-warning"
          role="alert"
          style={{
            margin: "var(--dh-space-2) var(--dh-space-4)",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <strong style={{ display: "block" }}>{l("Network interruption")}</strong>
            <span>{catalogError}</span>
          </div>
          <button
            type="button"
            className="installer-btn"
            onClick={() => setRetryTrigger((r) => r + 1)}
          >
            {l("Try again")}
          </button>
        </div>
      )}

      <div className="installer-body" style={{ flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <aside className="installer-sidebar">
          <nav className="installer-tabs" role="tablist" aria-label="Installation method">
            <button
              className={`installer-tab${tab === "workloads" ? " installer-tab--active" : ""}`}
              role="tab"
              aria-selected={tab === "workloads"}
              onClick={() => setTab("workloads")}
            >
              {l("Workloads")}
            </button>
            <button
              className={`installer-tab${tab === "components" ? " installer-tab--active" : ""}`}
              role="tab"
              aria-selected={tab === "components"}
              onClick={() => setTab("components")}
            >
              {l("Individual Components")}
            </button>
          </nav>

          {tab === "workloads" ? (
            <WorkloadsTab
              workloads={workloads}
              selectedWorkloadIds={selectedWorkloadIds}
              onToggle={toggleWorkload}
              componentMap={componentMap}
              l={l}
            />
          ) : (
            <IndividualComponentsTab
              components={components}
              selection={selection}
              excludedRecommendedIds={excludedRecommendedComponentIds}
              workloads={workloads}
              onToggle={toggleComponent}
              l={l}
            />
          )}

          {/* Selection summary */}
          <div className="installer-selection-summary">
            <span className="installer-selection-summary__count">{selection.size}</span>
            &nbsp;{l("Components")} · {Array.from(selectedWorkloadIds).map((id) => workloads.find((w) => w.id === id)?.name ?? id).join(", ") || l("No workloads selected")}
          </div>
        </aside>

        {/* Detail pane */}
        <section className="installer-main" aria-label="Component selection detail">
          <DetailPane
            selectedWorkloadIds={selectedWorkloadIds}
            selection={selection}
            components={components}
            workloads={workloads}
            onDeselect={deselect}
            l={l}
          />
        </section>
      </div>

      {/* Footer */}
      <div className="installer-footer">
        <span className="installer-footer__summary">
          {selection.size > 0
            ? `${selection.size} ${l("Components")} ${l("Selected")}`
            : l("Select at least one workload or component")}
        </span>
        <button
          className="installer-btn installer-btn--primary"
          disabled={selection.size === 0 || catalogLoading || Boolean(catalogError)}
          onClick={handleNext}
        >
          {l("Review installation plan")} →
        </button>
      </div>
    </div>
  );
}
