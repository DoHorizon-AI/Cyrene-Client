import { useEffect, useState } from "react";
import { count, Button, formatDate, MetricCard, PageHeader, Panel, StateBlock, StatusPill, statusTone } from "../components";
import { type JsonRecord, type SystemStatus } from "../api";
import { useI18n } from "../i18n";
import { type PageProps, Detail, settledValue } from "./shared";

/**
 * Workspace-level status cards and independently refreshed service observations.
 * 展示 Workspace 级状态卡片和分别刷新的服务观测信息。
 */
export function OverviewPage({ api }: PageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [models, setModels] = useState<JsonRecord[] | null>(null);
  const [datasets, setDatasets] = useState<JsonRecord[] | null>(null);
  const [drafts, setDrafts] = useState<JsonRecord[] | null>(null);
  const [deployments, setDeployments] = useState<JsonRecord[] | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled([
      api.getSystemStatus(),
      api.getModelImports(),
      api.getDatasets(),
      api.getTrainingDrafts(),
      api.getDeployments(),
    ]).then(([systemResult, modelsResult, datasetsResult, draftsResult, deploymentsResult]) => {
      if (!active) {
        return;
      }
      const nextFailures: string[] = [];
      const nextSystem = settledValue(systemResult, "Host status", nextFailures);
      const nextModels = settledValue(modelsResult, "Models", nextFailures);
      const nextDatasets = settledValue(datasetsResult, "Datasets", nextFailures);
      const nextDrafts = settledValue(draftsResult, "Training", nextFailures);
      const nextDeployments = settledValue(deploymentsResult, "Deployments", nextFailures);
      setSystem(nextSystem);
      setModels(nextModels);
      setDatasets(nextDatasets);
      setDrafts(nextDrafts);
      setDeployments(nextDeployments);
      setFailures(nextFailures);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const refresh = () => setReloadKey((value) => value + 1);

  return (
    <div className="page-stack overview-page">
      <PageHeader
        eyebrow="System / Overview"
        title={t("Workspace status")}
        description="Current service availability and host resources reported by the configured Product endpoints."
        action={
          <Button onClick={refresh} disabled={loading} aria-label={t("Refresh overview")}>
            {loading ? t("Refreshing...") : t("Refresh")}
          </Button>
        }
      />

      <div className="metric-grid">
        <MetricCard
          label="Model imports"
          value={loading ? "..." : count(models?.length ?? null)}
          detail={models === null ? "Reactor unavailable" : "Reactor"}
          accent="lime"
        />
        <MetricCard
          label="Dataset containers"
          value={loading ? "..." : count(datasets?.length ?? null)}
          detail={datasets === null ? "Catalyst unavailable" : "Catalyst"}
          accent="blue"
        />
        <MetricCard
          label="Training drafts"
          value={loading ? "..." : count(drafts?.length ?? null)}
          detail={drafts === null ? "Yield unavailable" : "Yield"}
          accent="orange"
        />
        <MetricCard
          label="Deployments"
          value={loading ? "..." : count(deployments?.length ?? null)}
          detail={deployments === null ? "Reactor unavailable" : "Reactor"}
          accent="gray"
        />
      </div>

      {loading ? (
        <StateBlock kind="loading" title={t("Refreshing status")} detail="Reading the host and configured Product endpoints." />
      ) : (
        <div className="overview-grid">
          <Panel
            title={t("Services")}
            meta={<StatusPill value={system?.status ?? "UNKNOWN"} />}
          >
            <div className="service-list">
              {[
                ["Navigator Web Host", system !== null],
                ["Reactor / models + serving", models !== null && deployments !== null],
                ["Catalyst / datasets", datasets !== null],
                ["Yield / training", drafts !== null],
              ].map(([label, available]) => (
                <div className="service-row" key={String(label)}>
                  <span className={`service-dot ${available ? "service-dot--good" : "service-dot--bad"}`} aria-hidden="true" />
                  <span>{t(String(label))}</span>
                  <strong>{t(available ? "Available" : "Unavailable")}</strong>
                </div>
              ))}
            </div>
            <div className="panel-footnote">
              {system
                ? `${system.proxyPrefixes.length} routes · Updated ${formatDate(system.observedAt)}`
                : "Host status is unavailable."}
            </div>
          </Panel>

          <Panel title={t("Issues")} meta={<span className="mono-label">{failures.length} {t("FAILED")}</span>}>
            {failures.length === 0 ? (
              <StateBlock
                kind="empty"
                title={t("No reported issues")}
                detail="All configured status requests completed successfully."
              />
            ) : (
              <div className="attention-list">
                {failures.map((failure) => (
                  <div className="attention-item" key={failure}>
                    <span className="attention-item__icon" aria-hidden="true">!</span>
                    <div>
                      <strong>{failure}</strong>
                      <p>{t("Check the service endpoint and its current binding, then refresh.")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title={t("Accelerators")}
            meta={<StatusPill value={system?.gpu?.available ? "AVAILABLE" : "UNAVAILABLE"} />}
          >
            {system?.gpu?.available && system.gpu.gpus && system.gpu.gpus.length > 0 ? (
              <div className="service-list">
                {system.gpu.gpus.map((gpu, idx) => (
                  <div className="service-row" key={idx}>
                    <span className="service-dot service-dot--good" aria-hidden="true" />
                    <span><strong>{gpu.name}</strong></span>
                    <span>{gpu.usedMib} / {gpu.totalMib}{t("MiB (")}{gpu.utilizationPct}{t("% util)")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <StateBlock
                kind="empty"
                title={t("No accelerator data")}
                detail={system?.gpu?.available === false ? "nvidia-smi is unavailable or no supported GPU was found." : "The host did not report hardware information."}
              />
            )}
          </Panel>

          <Panel
            title={t("Storage")}
            meta={<StatusPill value={system?.disk?.available !== false ? "MOUNTED" : "UNAVAILABLE"} />}
          >
            {system?.disk?.totalGib ? (
              <dl className="detail-grid">
                <Detail label="Total space" value={`${system.disk.totalGib} GiB`} />
                <Detail label="Used space" value={`${system.disk.usedGib ?? "-"} GiB`} />
                <Detail label="Free space" value={`${system.disk.freeGib ?? "-"} GiB`} />
                <Detail label="Utilization" value={`${system.disk.usedPct ?? "-"}%`} />
              </dl>
            ) : (
              <StateBlock kind="empty" title={t("Storage usage unavailable")} detail="Filesystem statistics not reported by host." />
            )}
          </Panel>

          <Panel
            title={t("Readiness")}
            meta={
              system?.blockers && system.blockers.length > 0 ? (
                <StatusPill value="BLOCKED" />
              ) : (
                <StatusPill value="READY" />
              )
            }
          >
            {system?.blockers && system.blockers.length > 0 ? (
              <div className="attention-list">
                {system.blockers.map((blocker) => (
                  <div className="attention-item attention-item--danger" key={blocker.code}>
                    <span className="attention-item__icon" aria-hidden="true">!</span>
                    <div>
                      <strong className="input-mono">{blocker.code}</strong>
                      <p>{blocker.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <StateBlock
                kind="empty"
                title={t("No reported blockers")}
                detail="The host status endpoint did not report any readiness blockers."
              />
            )}
          </Panel>

          <Panel
            title={t("Installed plugins")}
            meta={<span className="mono-label">{t("RUNTIME")}</span>}
          >
            {system?.plugins && system.plugins.length > 0 ? (
              <div className="service-list">
                {system.plugins.map((plugin) => (
                  <div className="service-row" key={plugin.name}>
                    <span
                      className={`service-dot service-dot--${statusTone(plugin.state)}`}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{plugin.name}</strong>
                      {plugin.kind ? <small className="service-row__kind">({plugin.kind})</small> : null}
                    </div>
                    <StatusPill value={plugin.state} />
                  </div>
                ))}
              </div>
            ) : (
              <StateBlock
                kind="empty"
                title={t("No plugins detected")}
                detail="No runtime plugins currently registered or reported by host."
              />
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
