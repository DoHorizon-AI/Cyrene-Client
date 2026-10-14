// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 IntegrationAlerts.tsx                                            │
// │  Module: apps/web/src/products                                      │
// │  Role: Show paired Exchange authorization health, renewal controls,  │
// │        durable alerts, and real cloud observation projections.       │
// │                                                                      │
// │  模块职责：展示已配对 Exchange 连接授权、续期、持久通知与云资源观测。      │
// │  · 浏览器通知只在用户主动授权后启用，页面关闭后的告警由邮件独立承担        │
// │  · 只显示服务端投影字段，不呈现目标、绑定、身份或原始属性 JSON             │
// └─────────────────────────────────────────────────────────────────────┘

import { useEffect, useMemo, useRef, useState } from "react";
import type { NavigatorApi } from "../../services/navigator/src/api";
import { Button, formatDate, PageHeader, Panel, StateBlock, StatusPill } from "../../services/navigator/src/components";
import { useI18n } from "../../services/navigator/src/i18n";
import { followIntegrationNotifications } from "./integration-notification-feed";
import {
  getBrowserNotificationPort,
  readBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  sendBrowserNotification,
  type BrowserNotificationPermission,
  type BrowserNotificationPort,
} from "./integration-notification-permission";
import {
  IntegrationApiError,
  IntegrationsClient,
  newIntegrationIdempotencyKey,
  type AuthorizationHealth,
  type CloudQueryResult,
  type ConnectionSummary,
  type IntegrationNotification,
  type RenewalSession,
} from "./integrations-client";

/** Authenticated Product client and permission projection supplied by the paired page shell. */
export interface IntegrationAlertsProps {
  api: NavigatorApi;
  canOperate: boolean;
}

/** Use cloud observation queries only for the providers that have an approved read-only route. */
export function supportsCloudObservations(provider: string): boolean {
  return ["azure", "gcp", "hf", "runpod", "tailscale"].includes(provider.trim().toLowerCase());
}

/** Distinguish an expired authorization from a missing or invalid expiry timestamp. */
export function classifyAuthorizationExpiry(expiresAt: string | null, now = Date.now()): "unknown" | "expired" | "future" {
  if (!expiresAt) return "unknown";
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return "unknown";
  return expiresAtMs <= now ? "expired" : "future";
}

/** Produce the exact label and state tone used by the authorization expiry row. */
export function authorizationExpiryPresentation(
  expiresAt: string | null,
  now: number,
  translate: (message: string) => string,
): { state: "unknown" | "expired" | "future"; label: string } {
  const state = classifyAuthorizationExpiry(expiresAt, now);
  return { state, label: state === "unknown" ? translate("Expiry unknown") : state === "expired" ? translate("Expired") : formatDate(expiresAt) };
}

/** Map the browser permission state to the label shown beside connection health. */
export function browserNotificationPermissionLabel(
  permission: BrowserNotificationPermission,
  translate: (message: string) => string,
): string {
  return permission === "unsupported" ? translate("Unsupported")
    : permission === "granted" ? translate("Allowed")
      : permission === "denied" ? translate("Blocked in browser settings") : translate("Not enabled");
}

/** Accept only HTTPS renewal links without embedded credentials; the URL is never rendered as text. */
export function safeOfficialRenewalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/** Render the integration console using the already paired Navigator and Control session. */
export function IntegrationAlerts({ api, canOperate }: IntegrationAlertsProps) {
  const { locale, t } = useI18n();
  const client = useMemo(() => new IntegrationsClient(api), [api]);
  const browserPort = useRef<BrowserNotificationPort | null>(getBrowserNotificationPort());
  const permissionRef = useRef<BrowserNotificationPermission>(readBrowserNotificationPermission(browserPort.current));
  const [permission, setPermission] = useState<BrowserNotificationPermission>(permissionRef.current);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [reloadConnections, setReloadConnections] = useState(0);
  const [health, setHealth] = useState<AuthorizationHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [resources, setResources] = useState<CloudQueryResult | null>(null);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState("");
  const [refreshOperation, setRefreshOperation] = useState<{ state: string; updatedAt: string } | null>(null);
  const [renewal, setRenewal] = useState<RenewalSession | null>(null);
  const [renewalError, setRenewalError] = useState("");
  const [renewalRequestKey, setRenewalRequestKey] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [notifications, setNotifications] = useState<IntegrationNotification[]>([]);
  const [feedError, setFeedError] = useState("");

  const selectedConnection = connections.find(connection => connection.id === selectedId) ?? null;
  const activeHealth = selectedConnection && health?.connectionId === selectedConnection.id ? health : null;
  const activeResources = selectedConnection && resources?.connectionId === selectedConnection.id ? resources : null;
  const activeRenewal = activeHealth && renewal?.authorizationRef === activeHealth.authorizationRef ? renewal : null;

  useEffect(() => {
    const refreshPermission = () => {
      const next = readBrowserNotificationPermission(browserPort.current);
      permissionRef.current = next; setPermission(next);
    };
    window.addEventListener("focus", refreshPermission);
    return () => window.removeEventListener("focus", refreshPermission);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingConnections(true);
    setConnectionError("");
    void client.listConnections(controller.signal).then(next => {
      setConnections(next);
      setSelectedId(current => current && next.some(connection => connection.id === current) ? current : next[0]?.id ?? "");
    }, error => {
      if (!controller.signal.aborted) setConnectionError(safeFailure(error, t));
    }).finally(() => { if (!controller.signal.aborted) setLoadingConnections(false); });
    return () => controller.abort();
  }, [client, reloadConnections, t]);

  useEffect(() => {
    if (!selectedConnection) {
      setHealth(null); setResources(null); setRefreshOperation(null); setRenewal(null);
      setRenewalRequestKey(null);
      setHealthError(""); setResourcesError(""); setHealthLoading(false); setResourcesLoading(false);
      return;
    }
    const controller = new AbortController();
    const cloudEnabled = supportsCloudObservations(selectedConnection.provider);
    setHealth(null); setResources(null); setRefreshOperation(null); setRenewal(null);
    setRenewalRequestKey(null);
    setHealthError(""); setResourcesError(""); setRenewalError("");
    setHealthLoading(true); setResourcesLoading(cloudEnabled);
    void client.getAuthorizationHealth(selectedConnection.id, controller.signal).then(value => {
      if (!controller.signal.aborted) setHealth(value);
    }, error => {
      if (!controller.signal.aborted) setHealthError(safeFailure(error, t));
    }).finally(() => { if (!controller.signal.aborted) setHealthLoading(false); });
    if (cloudEnabled) {
      void client.getResources(selectedConnection.id, controller.signal).then(value => {
        if (!controller.signal.aborted) setResources(value);
      }, error => {
        if (!controller.signal.aborted) setResourcesError(safeFailure(error, t));
      }).finally(() => { if (!controller.signal.aborted) setResourcesLoading(false); });
    }
    return () => controller.abort();
  }, [client, selectedConnection, t]);

  useEffect(() => {
    const controller = new AbortController();
    void followIntegrationNotifications({
      api: client,
      signal: controller.signal,
      onSnapshot: () => setFeedError(""),
      onError: error => setFeedError(safeFailure(error, t)),
      onNotification: (notification, hint) => {
        setNotifications(current => mergeNotification(current, notification));
        if (hint.showBrowserNotification) {
          try {
            sendBrowserNotification(browserPort.current, permissionRef.current, notification.title, notification.description, notification.id);
          } catch { /* A browser notification failure never interrupts durable in-app delivery. */ }
        }
      },
    });
    return () => controller.abort();
  }, [client, t]);

  useEffect(() => {
    if (!renewal || isRenewalTerminal(renewal.state) || !selectedConnection) return;
    const controller = new AbortController();
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const updated = await client.getRenewal(renewal.authorizationRef, renewal.sessionRef, controller.signal);
        if (active) setRenewal(updated);
        if (active && updated.state === "SUCCEEDED") {
          const refreshed = await client.getAuthorizationHealth(selectedConnection.id, controller.signal);
          if (active) setHealth(refreshed);
        }
        if (active && !isRenewalTerminal(updated.state)) timer = window.setTimeout(() => void poll(), 2000);
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setRenewalError(safeFailure(error, t));
          timer = window.setTimeout(() => void poll(), 4000);
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 1500);
    return () => { active = false; controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [client, renewal?.sessionRef, renewal?.state, selectedConnection, t]);

  const requestPermission = async () => {
    try {
      const next = await requestBrowserNotificationPermission(browserPort.current);
      permissionRef.current = next; setPermission(next);
    } catch {
      const next = readBrowserNotificationPermission(browserPort.current);
      permissionRef.current = next; setPermission(next);
    }
  };

  const readObservations = async () => {
    if (!selectedConnection || !supportsCloudObservations(selectedConnection.provider)) return;
    setResourcesLoading(true); setResourcesError("");
    try { setResources(await client.getResources(selectedConnection.id)); }
    catch (error) { setResourcesError(safeFailure(error, t)); }
    finally { setResourcesLoading(false); }
  };

  const refreshObservations = async () => {
    if (!selectedConnection || !canOperate || !supportsCloudObservations(selectedConnection.provider) || actionBusy) return;
    setActionBusy(true); setResourcesError("");
    try {
      const operation = await client.refreshResources(selectedConnection.id, newIntegrationIdempotencyKey());
      setRefreshOperation({ state: operation.state, updatedAt: operation.updatedAt });
      await readObservations();
    } catch (error) { setResourcesError(safeFailure(error, t)); }
    finally { setActionBusy(false); }
  };

  const startRenewal = async (retrySameKey: boolean) => {
    if (!selectedConnection || !health?.authorizationRef || health.connectionId !== selectedConnection.id || !canOperate || actionBusy || (renewal && !isRenewalTerminal(renewal.state))) return;
    setActionBusy(true); setRenewalError("");
    const requestKey = retrySameKey && renewalRequestKey ? renewalRequestKey : newIntegrationIdempotencyKey();
    setRenewalRequestKey(requestKey);
    try {
      setRenewal(await client.beginRenewal(health.authorizationRef, requestKey));
      setRenewalRequestKey(null);
    }
    catch (error) { setRenewalError(safeFailure(error, t)); }
    finally { setActionBusy(false); }
  };

  const acknowledge = async (notification: IntegrationNotification) => {
    if (!canOperate) return;
    try {
      const updated = await client.acknowledge(notification.id, newIntegrationIdempotencyKey());
      setNotifications(current => mergeNotification(current, updated));
    } catch (error) { setFeedError(safeFailure(error, t)); }
  };

  const officialRenewalUrl = safeOfficialRenewalUrl(activeRenewal?.authorizationUrl ?? null);
  const expiryPresentation = authorizationExpiryPresentation(activeHealth?.expiresAt ?? null, Date.now(), t);
  const expiry = expiryPresentation.state;
  const expiryLabel = expiryPresentation.label;
  const browserPermissionLabel = browserNotificationPermissionLabel(permission, t);

  return <div className="page-stack integration-alerts-page">
    <PageHeader
      eyebrow="Exchange / Integrations"
      title="Authorization and cloud observations"
      description="Review connection access, complete provider renewal, and read Exchange observations for configured cloud connections."
      action={<Button onClick={() => setReloadConnections(value => value + 1)} disabled={loadingConnections}>{loadingConnections ? t("Reading...") : t("Refresh connections")}</Button>}
    />

    <Panel title="Configured connection" meta={selectedConnection ? <StatusPill value={selectedConnection.provider} tone="info" /> : undefined}>
      {loadingConnections && !connections.length ? <StateBlock kind="loading" title="Reading configured connections" detail="Exchange filters this list to the paired actor and workspace." />
        : connectionError ? <StateBlock kind="error" title="Connections unavailable" detail={connectionError} action={<Button onClick={() => setReloadConnections(value => value + 1)}>{t("Retry")}</Button>} />
          : connections.length === 0 ? <StateBlock kind="empty" title="No configured connections" detail="Create a connection in Exchange before reading authorization or cloud observations." />
            : <div className="ia-connection-controls">
              <label className="field">
                <span className="field__label">{t("Connection")}</span>
                <select aria-label={t("Connection")} value={selectedId} onChange={event => setSelectedId(event.target.value)}>
                  {connections.map(connection => <option key={connection.id} value={connection.id}>{connection.displayName} · {connection.provider}</option>)}
                </select>
              </label>
              <p className="ia-scope-note">{t("This list and each detail request are scoped by the paired server session.")}</p>
            </div>}
    </Panel>

    {selectedConnection ? <>
      <Panel title="Authorization health" meta={activeHealth ? <StatusPill value={activeHealth.authorizationState} /> : undefined}>
        {healthLoading && !activeHealth ? <StateBlock kind="loading" title="Reading authorization health" detail="Exchange reports login and permission state separately." />
          : healthError && !activeHealth ? <StateBlock kind="error" title="Authorization health unavailable" detail={healthError} action={<Button onClick={() => setReloadConnections(value => value + 1)}>{t("Retry")}</Button>} />
            : activeHealth ? <>
              <dl className="ia-health-grid">
                <div><dt>{t("Connection login")}</dt><dd><StatusPill value={activeHealth.loginState} /></dd></div>
                <div><dt>{t("Permission health")}</dt><dd><StatusPill value={activeHealth.authorizationState} /></dd></div>
                <div><dt>{t("Expiry")}</dt><dd><StatusPill value={expiry === "expired" ? t("Expired") : expiry === "unknown" ? t("Unknown") : t("Known")} tone={expiry === "expired" ? "bad" : expiry === "unknown" ? "muted" : "info"} /> <span>{expiryLabel}</span></dd></div>
                <div><dt>{t("Last checked")}</dt><dd>{activeHealth.checkedAt ? formatDate(activeHealth.checkedAt) : t("No authorization observation yet")}</dd></div>
              </dl>
              {activeHealth.reasonCode === "not_observed" ? <p className="ia-scope-note">{t("Exchange has not observed this authorization yet; UNKNOWN does not mean valid or expired.")}</p> : null}
              {activeHealth.capabilities.length > 0 ? <div className="ia-capabilities">
                <h3>{t("Capability permissions")}</h3>
                {activeHealth.capabilities.map(capability => <div className="ia-capability" key={capability.capabilityId}>
                  <strong>{capability.capabilityId}</strong>
                  <StatusPill value={capability.state} />
                  <span>{t("Last verified")}: {formatDate(capability.lastVerifiedAt)}</span>
                  <span>{t("Expiry")}: {capability.expiresAt ? formatDate(capability.expiresAt) : t("Expiry unknown")}</span>
                  {capability.reasonCode ? <code>{capability.reasonCode}</code> : null}
                </div>)}
              </div> : null}
              {activeRenewal ? <div className="ia-renewal-state" role="status">
                <StatusPill value={activeRenewal.state} tone={activeRenewal.state === "SUCCEEDED" ? "good" : activeRenewal.state === "FAILED" || activeRenewal.state === "EXPIRED" ? "bad" : "warn"} />
                <span>{t("Renewal session")}: {t(activeRenewal.state)}</span>
                {activeRenewal.expiresAt ? <span>{t("Session expires")}: {formatDate(activeRenewal.expiresAt)}</span> : <span>{t("Session expiry unknown")}</span>}
                {activeRenewal.reasonCode ? <small>{t(activeRenewal.reasonCode)}</small> : null}
                {activeRenewal.state === "WAITING_USER" && officialRenewalUrl ? <Button type="button" onClick={() => window.open(officialRenewalUrl, "_blank", "noopener,noreferrer")}>{t("Open official authorization page")}</Button> : null}
                {activeRenewal.state === "WAITING_USER" && !officialRenewalUrl ? <small>{t("Official authorization link is unavailable.")}</small> : null}
              </div> : null}
              {renewalError ? <p className="ia-inline-error" role="alert">{renewalError}</p> : null}
              <div className="ia-actions">
                {renewalRequestKey
                  ? <Button tone="primary" disabled={!canOperate || actionBusy || !activeHealth.authorizationRef || !!(activeRenewal && !isRenewalTerminal(activeRenewal.state))} loading={actionBusy} onClick={() => void startRenewal(true)}>{t("Retry same renewal request")}</Button>
                  : <Button tone="primary" disabled={!canOperate || actionBusy || !activeHealth.authorizationRef || !!(activeRenewal && !isRenewalTerminal(activeRenewal.state))} loading={actionBusy} onClick={() => void startRenewal(false)}>{t("Start authorization renewal")}</Button>}
                {!canOperate ? <small>{t("Renewal requires products.operate permission.")}</small> : null}
                {canOperate && !activeHealth.authorizationRef ? <small>{t("No authorization record is available for renewal.")}</small> : null}
                {renewalRequestKey ? <small>{t("A retry uses the same idempotency key and cannot create a second renewal session.")}</small> : null}
              </div>
            </> : <StateBlock kind="empty" title="Authorization state unknown" detail="Exchange has not returned a health record for this connection." />}
      </Panel>

      <Panel title="Cloud resource observations" meta={activeResources ? <StatusPill value={t(activeResources.resources.length ? "Observation available" : "No observations")} tone={activeResources.resources.length ? "good" : "muted"} /> : undefined}>
        {!supportsCloudObservations(selectedConnection.provider) ? <StateBlock kind="empty" title="Cloud observations not available for this provider" detail="This provider has no approved read-only cloud observation route." />
          : resourcesLoading && !activeResources ? <StateBlock kind="loading" title="Reading cloud observations" detail="Exchange is returning its Product projection of provider observations." />
            : resourcesError && !activeResources ? <StateBlock kind="error" title="Cloud observations unavailable" detail={resourcesError} action={<Button onClick={() => void readObservations()}>{t("Retry")}</Button>} />
              : activeResources ? <>
                <div className="ia-observation-toolbar">
                  <span>{t("Exchange checked")}: {activeResources.checkedAt ? formatDate(activeResources.checkedAt) : t("No cloud observation collected yet")}</span>
                  <div className="ia-actions">
                    <Button onClick={() => void readObservations()} disabled={resourcesLoading}>{resourcesLoading ? t("Reading...") : t("Read latest observations")}</Button>
                    <Button tone="primary" onClick={() => void refreshObservations()} disabled={!canOperate || actionBusy} loading={actionBusy}>{t("Request cloud refresh")}</Button>
                  </div>
                </div>
                {refreshOperation ? <p className="ia-operation-state" role="status">{t("Refresh job")}: <StatusPill value={refreshOperation.state} /> · {t("Updated")}: {formatDate(refreshOperation.updatedAt)} · {t("Collection is asynchronous; this is not a completion claim.")}</p> : null}
                {resourcesError ? <p className="ia-inline-error" role="alert">{resourcesError}</p> : null}
                {activeResources.resources.length ? <div className="ia-observation-list">
                  {activeResources.resources.map((resource, index) => <article className="ia-observation" key={`${resource.kind}:${resource.displayName}:${index}`}>
                    <div className="ia-observation__title"><div><h3>{resource.displayName}</h3><small>{resource.kind}</small></div><StatusPill value={resource.status} /></div>
                    {resource.providerStatus ? <p>{t("Provider status")}: {resource.providerStatus}</p> : null}
                    <dl className="ia-observation__times">
                      <div><dt>{t("Freshness")}</dt><dd><StatusPill value={resource.freshness} tone={resource.freshness === "FRESH" ? "good" : resource.freshness === "STALE" ? "warn" : "muted"} /></dd></div>
                      <div><dt>{t("Collected")}</dt><dd>{formatDate(resource.collectedAt)}</dd></div>
                      <div><dt>{t("Provider observed")}</dt><dd>{formatDate(resource.observedAt)}</dd></div>
                    </dl>
                  </article>)}
                </div> : <StateBlock kind="empty" title="No cloud observations" detail="Exchange has no provider observations for this configured connection yet." />}
              </> : <StateBlock kind="empty" title="Cloud observations unknown" detail="No provider observation has been returned for this connection." />}
      </Panel>
    </> : null}

    <Panel title="Durable notification feed" meta={<StatusPill value={feedError ? t("Reconnecting") : t("Exchange feed")} tone={feedError ? "warn" : "info"} />}>
      <div className="ia-browser-permission">
        <div><strong>{t("Browser notifications")}</strong><span>{browserPermissionLabel}</span></div>
        {permission === "default" ? <Button onClick={() => void requestPermission()}>{t("Enable browser notifications")}</Button> : null}
        {permission === "unsupported" ? <small>{t("This browser does not support notifications.")}</small> : null}
        {permission === "denied" ? <small>{t("Change notification permission in browser site settings.")}</small> : null}
      </div>
      <p className="ia-delivery-note">{t("Browser notifications require this Client page to be open. Email notifications are handled separately; this page does not verify delivery and does not provide Web Push.")}</p>
      {feedError ? <p className="ia-inline-error" role="status">{t("Feed reconnecting")}: {feedError}</p> : null}
      {!notifications.length ? <StateBlock kind="empty" title="No notifications" detail="The durable Exchange notification feed is empty." />
        : <div className="ia-notification-list">
          {notifications.map(notification => <article className="ia-notification" key={`${notification.sequence}:${notification.id}`}>
            <div className="ia-notification__content">
              <div className="ia-notification__meta"><StatusPill value={notification.severity} /> <span>{t(notification.kind)}</span> <time>{formatDate(notification.createdAt)}</time></div>
              <h3>{notification.title}</h3>
              <p>{notification.description}</p>
              {notification.actionRef ? <small>{t("A safe Product action is available; open its owning workflow to continue.")}</small> : null}
            </div>
            {notification.acknowledgedAt ? <StatusPill value={t("Acknowledged")} tone="good" />
              : canOperate ? <Button onClick={() => void acknowledge(notification)}>{t("Acknowledge")}</Button>
                : <small>{t("Acknowledgement requires products.operate permission.")}</small>}
          </article>)}
        </div>}
    </Panel>
  </div>;
}

function mergeNotification(current: IntegrationNotification[], next: IntegrationNotification): IntegrationNotification[] {
  const bySequence = new Map(current.map(item => [item.sequence, item]));
  const existing = bySequence.get(next.sequence);
  bySequence.set(next.sequence, existing?.acknowledgedAt && !next.acknowledgedAt ? existing : next);
  return [...bySequence.values()].sort((left, right) => right.sequence - left.sequence).slice(0, 100);
}

function isRenewalTerminal(state: RenewalSession["state"]): boolean {
  return ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"].includes(state);
}

function safeFailure(error: unknown, translate: (message: string) => string): string {
  if (error instanceof IntegrationApiError) return `${translate("Request failed")}: ${error.status || translate("Connection unavailable")} · ${error.code}`;
  return translate("Request failed. Verify the paired session and retry.");
}
