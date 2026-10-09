import { useEffect, useState } from "react";
import { Button, formatDate, PageHeader, Panel, ResourceTable, StateBlock, StatusPill, text, WorkflowSteps, type WorkflowStep } from "../components";
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
            <div className="dh-phase-timeline">
              <WorkflowSteps steps={deploymentPhaseSteps(deploymentEvents, t)} label={t("Deployment phases")} />

              <div className="service-list">
                {deploymentEvents.map((evt) => (
                  <div className="dh-event-row" key={evt.sequence}>
                    <span className="mono-label">#{evt.sequence}</span>
                    <StatusPill value={evt.phase} />
                    <div>
                      <span>{evt.message}</span>
                      {evt.failureCode ? (
                        <span className="dh-event-row__failure">{t("Failure:")}{evt.failureCode}</span>
                      ) : null}
                    </div>
                    <span className="dh-event-row__time">{formatDate(evt.occurredAt)}</span>
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

const DEPLOYMENT_PHASES = ["QUEUED", "LOADING", "PROBING", "READY"] as const;

function deploymentPhaseSteps(events: readonly DeploymentEvent[], t: (message: string) => string): WorkflowStep[] {
  const passed = DEPLOYMENT_PHASES.map((phase) => events.some((event) => event.phase === phase));
  const reached = passed.lastIndexOf(true);
  if (events.some((event) => event.phase === "FAILED")) {
    const timeline = DEPLOYMENT_PHASES.slice(0, reached + 1).map((phase, index): WorkflowStep => ({ id: phase, label: phase, state: passed[index] ? "done" : "pending" }));
    return [...timeline, { id: "FAILED", label: t("FAILED"), state: "blocked" }];
  }
  return DEPLOYMENT_PHASES.map((phase, index): WorkflowStep => {
    if (passed[index] && index === reached && phase !== "READY") return { id: phase, label: phase, detail: t("In progress"), state: "running" };
    return { id: phase, label: phase, state: passed[index] ? "done" : "pending" };
  });
}
