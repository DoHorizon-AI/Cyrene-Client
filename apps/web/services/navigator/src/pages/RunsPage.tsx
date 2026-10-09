import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, Field, formatDate, MetricCard, PageHeader, Panel, ResourceTable, StateBlock, StatusPill, text } from "../components";
import { makeIdempotencyKey } from "../api";
import { pushRunRoute, routeForPath } from "../router";
import { useTrainingRun, type TrainingRunClient } from "../use-training-run";
import { useI18n } from "../i18n";
import { Detail, resourceId, nestedRecord, initialRunId, errorMessage } from "./shared";

/**
 * Run lookup and attempt diagnostics, reflecting the published Yield API shape.
 * 展示运行查询和尝试诊断信息，并遵循已发布的 Yield API 结构。
 */
/**
 * Minimal canvas loss curve so the console needs no charting dependency.
 * 使用最精简的 canvas 绘制损失曲线，使控制台无需引入图表依赖。
 */
function LossChart({ series }: { series: number[] }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || series.length < 2) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    context.beginPath();
    series.forEach((value, index) => {
      const x = (index / (series.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((value - min) / span) * (height - 2);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = "#7dd3fc";
    context.lineWidth = 1.5;
    context.stroke();
  }, [series]);

  if (series.length < 2) return null;
  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={120}
      style={{ width: "100%", height: "120px" }}
      aria-label={t("Training loss over steps")}
    />
  );
}

/**
 * Human-readable duration for an ETA in seconds.
 * 将 ETA 秒数格式化为人类可读的时长。
 */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function RunsPage({ api }: { api: TrainingRunClient }) {
  const { t } = useI18n();
  const [runId, setRunId] = useState(() => initialRunId());
  const [selectedRunId, setSelectedRunId] = useState(() => initialRunId());
  const observation = useTrainingRun(api, selectedRunId);
  const { run: observedRun, attempts, loading, attemptError, events, latestLoss, currentStep, totalSteps,
    lossSeries, etaSeconds, latestCheckpoint, streamState, streamError } = observation;
  const run = observedRun?.["id"] === selectedRunId ? observedRun : null;
  const [actionError, setActionError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const actionScope = useRef(0);
  const actionLock = useRef(false);
  const resumeKeys = useRef(new Map<string, string>());

  useEffect(() => {
    const navigate = () => {
      if (routeForPath(window.location.pathname) !== "runs") return;
      const id = initialRunId();
      setRunId(id);
      setSelectedRunId(id);
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);
  useEffect(() => {
    actionScope.current += 1;
    actionLock.current = false;
    setCanceling(false);
    setActionBusy(false);
    setActionNotice(null);
    setActionError(null);
    resumeKeys.current.clear();
    return () => { actionScope.current += 1; };
  }, [api, selectedRunId]);

  const currentRunId = run && run["id"] === selectedRunId ? selectedRunId : "";
  const runState = currentRunId ? text(run?.["state"], "") : "";
  const canCancel = api.capabilities?.cancel !== false && ["QUEUED", "RUNNING", "AWAITING_RETRY"].includes(runState);
  const resultId = text(nestedRecord(run ?? {}, "result")?.["id"], "");
  const canResume = api.capabilities?.resume !== false && ["FAILED", "CANCELLED"].includes(runState) && latestCheckpoint !== null;
  const canDeploy = api.capabilities?.deploy !== false && Boolean(resultId);
  const error = actionError ?? observation.error;
  const streamActive = streamState === "connected";
  const streamDone = streamState === "finished";

  const resumeRun = async () => {
    if (!currentRunId || !latestCheckpoint || !canResume || actionLock.current) return;
    actionLock.current = true;
    const scope = actionScope.current;
    const identity = JSON.stringify([currentRunId, latestCheckpoint, run?.["attemptCount"]]);
    let key = resumeKeys.current.get(identity);
    if (!key) { key = makeIdempotencyKey(); resumeKeys.current.set(identity, key); }
    setActionBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await api.resumeTrainingRun(currentRunId, latestCheckpoint, key);
      if (scope !== actionScope.current) return;
      setActionNotice(t("Resume accepted. Yield is restarting from the selected checkpoint."));
      observation.reconnect();
    } catch (resumeError) {
      if (scope === actionScope.current) setActionError(errorMessage(resumeError));
    } finally {
      if (scope === actionScope.current) { actionLock.current = false; setActionBusy(false); }
    }
  };

  const deployResult = async () => {
    if (!resultId || !currentRunId || actionLock.current) return;
    actionLock.current = true;
    const scope = actionScope.current;
    setActionBusy(true);
    setActionNotice(null);
    setActionError(null);
    try {
      await api.sendResultToReactor(resultId);
      if (scope === actionScope.current) setActionNotice(t("Sent to Reactor. Continue on the Deployments page."));
    } catch (deployError) {
      if (scope === actionScope.current) setActionError(errorMessage(deployError));
    } finally {
      if (scope === actionScope.current) { actionLock.current = false; setActionBusy(false); }
    }
  };

  const lookupRun = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = runId.trim();
    if (!value) {
      setActionError(t("Enter a training run id to read its owning Product projection."));
      return;
    }
    setActionError(null);
    if (value === selectedRunId) observation.reconnect();
    else pushRunRoute(value);
  };

  const cancelRun = async () => {
    if (!currentRunId || !canCancel || actionLock.current) return;
    actionLock.current = true;
    const scope = actionScope.current;
    setCanceling(true);
    setActionError(null);
    try {
      await api.cancelTrainingRun(currentRunId);
      if (scope === actionScope.current) observation.refresh();
    } catch (cancelError) {
      if (scope === actionScope.current) setActionError(errorMessage(cancelError));
    } finally {
      if (scope === actionScope.current) { actionLock.current = false; setCanceling(false); }
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Yield / 04"
        title={t("Follow one run to the metal.")}
        description="Yield publishes run detail and attempt diagnostics, not a browser-owned history cache. Enter an id to read the current projection."
      />

      <Panel title={t("Find a training run")} meta={<span className="mono-label">{t("OWNER: YIELD")}</span>}>
        <form className="lookup-form" onSubmit={lookupRun}>
          <Field label="Training run id" hint="Use the id returned when a prepared draft starts.">
            <input className="input-mono" value={runId} onChange={(event) => setRunId(event.target.value)} placeholder={t("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")} />
          </Field>
          <Button tone="primary" type="submit" disabled={loading}>{loading ? "Reading..." : "Read run"}</Button>
        </form>
      </Panel>

      {loading ? <StateBlock kind="loading" title={t("Reading run projection")} detail="Yield is returning current run state and public attempt diagnostics." /> : null}
      {error ? <StateBlock kind="error" title={t("Run could not be read")} detail={error} /> : null}
      {run ? (
        <>
          <Panel
            title={text(run["name"], "Training run")}
            meta={
              <div className="panel-actions">
                <StatusPill value={runState || "UNKNOWN"} />
                {canCancel ? <Button tone="danger" onClick={() => void cancelRun()} disabled={canceling || actionBusy}>{canceling ? "Canceling..." : "Request cancel"}</Button> : null}
              </div>
            }
          >
            <dl className="detail-grid">
              <Detail label="Run id" value={text(run["id"])} mono />
              <Detail label="Engine binding" value={text(run["engineBindingId"])} mono />
              <Detail label="Attempts" value={text(run["attemptCount"], "0")} />
              <Detail label="Resource version" value={text(run["resourceVersion"], "-")} />
              <Detail label="Created" value={formatDate(run["createdAt"])} />
              <Detail label="Updated" value={formatDate(run["updatedAt"])} />
            </dl>
            {nestedRecord(run, "failure") ? (
              <div className="callout callout--red">
                <span className="callout__mark" aria-hidden="true">!</span>
                <p><strong>{text(nestedRecord(run, "failure")?.["code"], "Run failure")}</strong> {text(nestedRecord(run, "failure")?.["message"])}</p>
              </div>
            ) : null}
          </Panel>

          <Panel
            title={t("Realtime execution stream")}
            meta={
              <div className="panel-actions">
                <StatusPill value={streamState.toUpperCase()} />
                {(streamDone || ["COMPLETED", "FAILED", "CANCELLED"].includes(runState)) && (
                  <Button onClick={observation.refresh}>{t("查看结果")}</Button>
                )}
                <Button onClick={observation.reconnect}>{t("Reconnect stream")}</Button>
              </div>
            }
          >
            {streamError ? <p role="alert" className="form-message form-message--error">{streamError}</p> : null}
            <div className="metric-grid">
              <MetricCard
                label="Loss"
                value={latestLoss !== null ? latestLoss.toFixed(4) : "--"}
                detail="Current training loss"
                accent="orange"
              />
              <MetricCard
                label="Progress"
                value={currentStep !== null && totalSteps !== null ? `${currentStep} / ${totalSteps}` : currentStep !== null ? `Step ${currentStep}` : "--"}
                detail={currentStep !== null && totalSteps ? `${Math.round((currentStep / totalSteps) * 100)}% steps completed` : "Step progress"}
                accent="blue"
              />
              <MetricCard
                label="Stream status"
                value={t(streamState[0]!.toUpperCase() + streamState.slice(1))}
                detail={streamDone ? t("All available events received") : streamActive ? t("SSE live connection") : t("Run state remains owned by Yield; reconnecting never restarts training.")}
                accent={streamActive ? "lime" : "gray"}
              />
              <MetricCard
                label="ETA"
                value={etaSeconds !== null ? formatDuration(etaSeconds) : "--"}
                detail="Estimated time remaining"
                accent="gray"
              />
              <MetricCard
                label="Checkpoint"
                value={latestCheckpoint ?? "--"}
                detail="Latest checkpoint reported by Yield"
                accent="gray"
              />
            </div>

            {currentStep !== null && totalSteps ? (
              <div style={{ marginTop: "16px" }}>
                <div
                  role="progressbar"
                  aria-valuenow={currentStep}
                  aria-valuemin={0}
                  aria-valuemax={totalSteps}
                  style={{ height: "8px", background: "var(--color-bg-subtle, #181c20)", borderRadius: "4px", overflow: "hidden" }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.round((currentStep / totalSteps) * 100))}%`,
                      height: "100%",
                      background: "var(--lime, #7dd3fc)",
                    }}
                  />
                </div>
              </div>
            ) : null}

            <div style={{ marginTop: "16px" }}>
              <LossChart series={lossSeries} />
            </div>

            <div className="form-actions" style={{ marginTop: "16px" }}>
              <Button disabled={!canResume || actionBusy || canceling} onClick={() => void resumeRun()}>
                {actionBusy ? "Working..." : "Resume from checkpoint"}
              </Button>
              <Button disabled={!canDeploy || actionBusy || canceling} onClick={() => void deployResult()}>{t("Deploy this model")}</Button>
            </div>
            {api.capabilities?.cancel === false && api.capabilities.resume === false && api.capabilities.deploy === false ? (
              <p>{t("This connection supports observation. Cancel, resume and deployment actions are available in the owning service.")}</p>
            ) : null}
            {actionNotice ? <p className="form-message form-message--success">{actionNotice}</p> : null}

            <div style={{ marginTop: "16px" }}>
              <strong style={{ display: "block", marginBottom: "8px", fontSize: "13px" }}>{t("Event logs (last 50):")}</strong>
              <div style={{ maxHeight: "260px", overflowY: "auto", background: "var(--color-bg-subtle, #181c20)", padding: "12px", borderRadius: "6px", fontFamily: "monospace", fontSize: "12px" }}>
                {events.length === 0 ? (
                  <div style={{ color: "var(--muted, #888)" }}>{t("No realtime stream events captured yet.")}</div>
                ) : (
                  events.map((evt, idx) => {
                    const seq = String(evt["sequence"] ?? idx + 1);
                    const kind = String(evt["kind"] ?? evt["event"] ?? "event");
                    const payload = evt["payload"] ? JSON.stringify(evt["payload"]) : evt["message"] ?? JSON.stringify(evt);
                    return (
                      <div key={seq} style={{ marginBottom: "4px", lineHeight: "1.4" }}>
                        <span style={{ color: "var(--muted, #888)", marginRight: "8px" }}>#{seq}</span>
                        <span style={{ color: "var(--blue, #64B5F6)", marginRight: "8px" }}>[{kind}]</span>
                        <span>{String(payload)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </Panel>

          <Panel title={t("Attempt diagnostics")} meta={attempts ? `${attempts.length} attempts` : "OWNER READ"}>
            {attemptError ? (
              <StateBlock kind="error" title={t("Attempts unavailable")} detail={attemptError} />
            ) : attempts && attempts.length > 0 ? (
              <ResourceTable
                rows={attempts}
                rowKey={resourceId}
                caption="Yield training attempts"
                columns={[
                  { label: "Attempt", render: (row) => <span className="input-mono">{text(row["id"])}</span> },
                  { label: "Phase", render: (row) => text(row["phase"]) },
                  { label: "State", render: (row) => <StatusPill value={text(row["state"], "UNKNOWN")} /> },
                  { label: "Failure", render: (row) => text(nestedRecord(row, "failure")?.["message"], "No failure recorded") },
                ]}
              />
            ) : (
              <StateBlock kind="empty" title={t("No attempt diagnostics")} detail="Yield has not published attempt records for this run." />
            )}
          </Panel>
        </>
      ) : !loading && !error ? (
        <StateBlock kind="empty" title={t("No run selected")} detail="Run history stays with Yield. Enter a run id above to inspect a live projection." />
      ) : null}
    </div>
  );
}
