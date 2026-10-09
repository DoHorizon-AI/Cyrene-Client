import { useEffect, useState } from "react";
import { Button, formatDate, PageHeader, Panel, ResourceTable, StateBlock, StatusPill, text } from "../components";
import { type DeploymentEvent, type JsonRecord } from "../api";
import { useI18n } from "../i18n";
import { type PageProps, resourceId, endpointSummary, errorMessage } from "./shared";

/**
 * Reactor deployment intent, observed state, and explicit stop action.
 * 展示 Reactor 部署意图、观测状态和明确的停止操作。
 */
export function DeploymentsPage({ api }: PageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [deployments, setDeployments] = useState<JsonRecord[] | null>(null);
  const [bindings, setBindings] = useState<JsonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Deployment events timeline state
  // 中文：部署事件时间线状态。
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [deploymentEvents, setDeploymentEvents] = useState<DeploymentEvent[] | null>(null);

  const loadDeploymentEvents = async (id: string) => {
    setSelectedDeploymentId(id);
    setEventsLoading(true);
    setEventsError(null);
    try {
      const res = await api.getDeploymentEvents(id);
      setDeploymentEvents(res.events);
    } catch (err) {
      setEventsError(errorMessage(err));
      setDeploymentEvents(null);
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.allSettled([api.getDeployments(), api.getServingBindings()]).then(([deploymentResult, bindingResult]) => {
      if (!active) {
        return;
      }
      if (deploymentResult.status === "fulfilled") {
        setDeployments(deploymentResult.value);
        setError(null);
      } else {
        setDeployments(null);
        setError(errorMessage(deploymentResult.reason));
      }
      if (bindingResult.status === "fulfilled") {
        setBindings(bindingResult.value);
        setBindingError(null);
      } else {
        setBindings([]);
        setBindingError(errorMessage(bindingResult.reason));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const stopDeployment = async (id: string) => {
    setStopId(id);
    setActionError(null);
    try {
      await api.stopDeployment(id);
      setReloadKey((value) => value + 1);
    } catch (stopError) {
      setActionError(errorMessage(stopError));
    } finally {
      setStopId(null);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Reactor / 05"
        title={t("Serve with a known edge.")}
        description="Deployments express intent; endpoints express addressability. Read both through Reactor and stop only through its explicit lifecycle action."
        action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{t("Refresh deployments")}</Button>}
      />

      <div className="callout callout--blue">
        <span className="callout__mark" aria-hidden="true">{t("i")}</span>
        <p><strong>{t("Serving bindings:")}{bindings.length || "none reported"}.</strong> {bindingError ?? "Reactor resolves node and engine identity; the UI does not infer readiness from a URL."}</p>
      </div>

      <Panel title={t("Deployment ledger")} meta={deployments ? `${deployments.length} records` : "LIVE READ"}>
        {loading ? (
          <StateBlock kind="loading" title={t("Reading deployments")} detail="Reactor is reconciling desired intent with observed serving state." />
        ) : error ? (
          <StateBlock kind="error" title={t("Deployments unavailable")} detail={error} action={<Button onClick={() => setReloadKey((value) => value + 1)}>{t("Try again")}</Button>} />
        ) : deployments && deployments.length > 0 ? (
          <>
            <ResourceTable
              rows={deployments}
              rowKey={resourceId}
              caption="Reactor deployments"
              columns={[
                { label: "Deployment", render: (row) => <strong>{text(row["name"], "Unnamed deployment")}</strong> },
                { label: "Observed", render: (row) => <StatusPill value={text(row["observedState"], "UNKNOWN")} /> },
                { label: "Desired", render: (row) => <StatusPill value={text(row["desiredState"], "UNKNOWN")} /> },
                { label: "Binding", render: (row) => <span className="input-mono">{text(row["servingBindingId"])}</span> },
                { label: "Endpoint", render: (row) => endpointSummary(row) },
                {
                  label: "Timeline",
                  render: (row) => {
                    const id = text(row["id"], "");
                    const isSelected = selectedDeploymentId === id;
                    return (
                      <Button
                        tone={isSelected ? "primary" : "quiet"}
                        onClick={() => void loadDeploymentEvents(id)}
                      >{t("加载历史")}</Button>
                    );
                  },
                },
                {
                  label: "Action",
                  render: (row) => {
                    const id = text(row["id"], "");
                    const stopped = text(row["desiredState"], "") === "STOPPED";
                    return <Button tone="danger" disabled={stopped || stopId !== null} onClick={() => void stopDeployment(id)}>{stopId === id ? "Stopping..." : stopped ? "Stopped" : "Stop"}</Button>;
                  },
                },
              ]}
            />
            {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          </>
        ) : (
          <StateBlock kind="empty" title={t("No deployments")} detail="A validated model version must be handed to Reactor before a serving deployment can exist." />
        )}
      </Panel>

      {selectedDeploymentId ? (
        <Panel
          title={`加载历史时间线: ${selectedDeploymentId}`}
          meta={
            deploymentEvents ? (
              <span className="mono-label">{deploymentEvents.length}{t("EVENTS")}</span>
            ) : undefined
          }
        >
          {eventsLoading ? (
            <StateBlock
              kind="loading"
              title={t("Loading deployment phase events")}
              detail="Reactor SQLite store is returning the phase transition timeline."
            />
          ) : eventsError ? (
            <StateBlock kind="error" title={t("Events unavailable")} detail={eventsError} />
          ) : deploymentEvents && deploymentEvents.length > 0 ? (
            <div style={{ marginTop: "12px" }}>
              {/* Phase sequence visualization */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "20px",
                  overflowX: "auto",
                  padding: "8px 0",
                }}
              >
                {["QUEUED", "LOADING", "PROBING", "READY"].map((p, idx) => {
                  const hasPassed = deploymentEvents.some((e) => e.phase === p);
                  return (
                    <div key={p} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          padding: "4px 10px",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: 600,
                          fontFamily: "var(--mono)",
                          background: hasPassed ? "rgba(201, 242, 123, 0.15)" : "rgba(255, 255, 255, 0.05)",
                          color: hasPassed ? "var(--lime)" : "var(--faint)",
                          border: `1px solid ${hasPassed ? "var(--lime)" : "var(--line)"}`,
                        }}
                      >
                        {p}
                      </span>
                      {idx < 3 ? <span style={{ color: "var(--faint)" }}>→</span> : null}
                    </div>
                  );
                })}
                {deploymentEvents.some((e) => e.phase === "FAILED") ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ color: "var(--red)" }}>→</span>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: "12px",
                        fontSize: "12px",
                        fontWeight: 600,
                        fontFamily: "var(--mono)",
                        background: "rgba(255, 139, 120, 0.15)",
                        color: "var(--red)",
                        border: "1px solid var(--red)",
                      }}
                    >{t("FAILED")}</span>
                  </div>
                ) : null}
              </div>

              {/* Detailed event timeline list */}
              <div className="service-list">
                {deploymentEvents.map((evt) => (
                  <div
                    key={evt.sequence}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "40px 100px 1fr auto",
                      alignItems: "center",
                      gap: "12px",
                      padding: "10px 0",
                      borderBottom: "1px solid var(--line)",
                      fontSize: "12px",
                    }}
                  >
                    <span className="mono-label">#{evt.sequence}</span>
                    <StatusPill value={evt.phase} />
                    <div>
                      <span>{evt.message}</span>
                      {evt.failureCode ? (
                        <span
                          style={{
                            display: "block",
                            color: "var(--red)",
                            fontWeight: 600,
                            marginTop: "2px",
                            fontFamily: "var(--mono)",
                          }}
                        >{t("Failure:")}{evt.failureCode}
                        </span>
                      ) : null}
                    </div>
                    <span style={{ color: "var(--muted)", fontSize: "11px" }}>
                      {formatDate(evt.occurredAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <StateBlock
              kind="empty"
              title={t("No events recorded")}
              detail="Reactor has not published loading events for this deployment yet."
            />
          )}
        </Panel>
      ) : null}
    </div>
  );
}
