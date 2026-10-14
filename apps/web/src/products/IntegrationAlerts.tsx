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

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  type ExchangeProductCredential,
  type AuthorizationHealth,
  type CloudQueryResult,
  type ConnectionSummary,
  type IntegrationNotification,
  type RenewalSession,
} from "./integrations-client";
import {
  browserRenewalStorage,
  clearPendingRenewalRequest,
  clearPendingRenewalScope,
  loadPendingRenewalRequest,
  savePendingRenewalRequest,
  type PendingRenewalRequest,
  type RenewalRetryState,
} from "./integration-renewal-storage";

/** Authenticated Product client and permission projection supplied by the paired page shell. */
export interface IntegrationAlertsProps {
  api: NavigatorApi;
  canOperate: boolean;
  sessionScope: string;
}

/** Exchange currently implements Account Center renewal only for WeCom connections. */
export function supportsAuthorizationRenewal(provider: string): boolean {
  return provider.trim().toLowerCase() === "wecom";
}

/** Identify the unresolved WeCom start states with durable same-key POST replay. */
export function renewalRetryState(session: RenewalSession): RenewalRetryState | null {
  if (session.state !== "VERIFYING") return null;
  if (session.reasonCode === "provider_start_outcome_unknown") return "PROVIDER_START_OUTCOME_UNKNOWN";
  if (session.reasonCode === "provider_status_lookup_unavailable") return "PROVIDER_STATUS_LOOKUP_UNAVAILABLE";
  return null;
}

/** Permit explicit WeCom same-key retry only after a known ambiguous request outcome. */
export function canReplayWeComRenewal(
  provider: string,
  authorizationRef: string | null,
  pending: PendingRenewalRequest | null,
  session: RenewalSession | null,
): boolean {
  if (!supportsAuthorizationRenewal(provider) || !authorizationRef || !pending) return false;
  if (pending.retryState === "REQUEST_OUTCOME_UNKNOWN" && !pending.sessionRef) return true;
  if (!session && pending.sessionRef && ["PROVIDER_START_OUTCOME_UNKNOWN", "PROVIDER_STATUS_LOOKUP_UNAVAILABLE"].includes(pending.retryState)) return true;
  const expectedState = session ? renewalRetryState(session) : null;
  return session?.state === "VERIFYING" && !!pending.sessionRef && pending.sessionRef === session.sessionRef
    && expectedState !== null && pending.retryState === expectedState;
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

const wecomOrigin = "https://work.weixin.qq.com";
const activationQrPath = "/ai/qc/gen";
const existingGrantManagementPath = "/ai/aiHelper/authorizationList";
const existingGrantManagementQueryKeys = [
  "aibotid", "bar_style_type", "for_native", "forceInnerBrowser", "from", "hide_more_btn",
  "pc_bar_bg", "str_aibotid", "type", "ww_vh", "ww_vw",
] as const;

/** Parse one exact vendor-owned HTTPS navigation route; never accept a host or path prefix. */
function parseOfficialWeComUrl(value: string | null, path: string): URL | null {
  if (!value || value.includes("#") || !value.startsWith(`${wecomOrigin}${path}?`)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== wecomOrigin || url.hostname !== "work.weixin.qq.com"
      || url.host !== "work.weixin.qq.com" || url.username || url.password || url.pathname !== path || url.hash) return null;
    return url;
  } catch { return null; }
}

/** Validate the existing activation QR route without treating it as an existing-profile grant page. */
export function validateActivationQR(value: string | null): string | null {
  const url = parseOfficialWeComUrl(value, activationQrPath);
  if (!url) return null;
  const sources = url.searchParams.getAll("source"), codes = url.searchParams.getAll("scode");
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || keys.some(key => key !== "source" && key !== "scode")
    || sources.length !== 1 || sources[0] !== "wecom_cli_external"
    || codes.length !== 1 || !/^[A-Za-z0-9_-]{8,256}$/.test(codes[0] ?? "")) return null;
  return url.href;
}

/** Validate WeCom's message-capability management page and return its canonical query order. */
export function validateExistingGrantManagementURL(value: string | null): string | null {
  const url = parseOfficialWeComUrl(value, existingGrantManagementPath);
  if (!url) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== existingGrantManagementQueryKeys.length
    || keys.some(key => !existingGrantManagementQueryKeys.includes(key as typeof existingGrantManagementQueryKeys[number]))) return null;

  const fields = new Map<string, string>();
  for (const key of existingGrantManagementQueryKeys) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1) return null;
    fields.set(key, values[0]!);
  }
  const aibotid = fields.get("aibotid") ?? "";
  const strAibotid = fields.get("str_aibotid") ?? "";
  const background = fields.get("pc_bar_bg") ?? "";
  const height = fields.get("ww_vh") ?? "";
  const width = fields.get("ww_vw") ?? "";
  if (fields.get("type") !== "6" || fields.get("from") !== "chat" || fields.get("forceInnerBrowser") !== "1"
    || fields.get("bar_style_type") !== "3" || fields.get("for_native") !== "true" || fields.get("hide_more_btn") !== "true"
    || !/^\d{17}$/.test(aibotid) || !/^[A-Za-z0-9_-]{35}$/.test(strAibotid)
    || !/^[A-Fa-f0-9]{6},[A-Fa-f0-9]{6}$/.test(background)
    || !isValidWecomViewport(height) || !isValidWecomViewport(width)) return null;

  const canonicalQuery = new URLSearchParams();
  for (const key of existingGrantManagementQueryKeys) canonicalQuery.set(key, fields.get(key)!);
  const canonical = new URL(`${url.origin}${url.pathname}`);
  canonical.search = canonicalQuery.toString();
  return canonical.href;
}

function isValidWecomViewport(value: string): boolean {
  return /^[1-9]\d{0,3}$/.test(value) && Number(value) <= 4096;
}

/** Accept only the two fixed WeCom authorization routes; never render the raw provider URL. */
export function safeOfficialRenewalUrl(value: string | null): string | null {
  return validateActivationQR(value) ?? validateExistingGrantManagementURL(value);
}

/** Render the integration console using the already paired Navigator and Control session. */
export function IntegrationAlerts({ api, canOperate, sessionScope }: IntegrationAlertsProps) {
  const { t } = useI18n();
  const [exchangeCredential, setExchangeCredential] = useState<ExchangeProductCredential | null>(null);
  const [bearerInput, setBearerInput] = useState("");
  const [workspaceSelector, setWorkspaceSelector] = useState("");
  const renewalScope = `${sessionScope}\u0000${workspaceSelector.trim()}`;
  const client = useMemo(() => new IntegrationsClient(api, () => exchangeCredential), [api, exchangeCredential]);
  const browserPort = useRef<BrowserNotificationPort | null>(getBrowserNotificationPort());
  const renewalCleanupTimers = useRef(new Map<string, number>());
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
  const [pendingRenewal, setPendingRenewal] = useState<PendingRenewalRequest | null>(null);
  const [pendingRenewalLoading, setPendingRenewalLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [notifications, setNotifications] = useState<IntegrationNotification[]>([]);
  const [feedError, setFeedError] = useState("");

  const invalidateExchangeCredential = () => {
    setExchangeCredential(null);
    setConnections([]); setSelectedId(""); setNotifications([]);
    setHealth(null); setResources(null); setRefreshOperation(null); setRenewal(null); setPendingRenewal(null);
    setConnectionError(""); setHealthError(""); setResourcesError(""); setRenewalError(""); setFeedError("");
  };

  const connectExchange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = bearerInput.trim(), selectedWorkspace = workspaceSelector.trim();
    if (!token || !selectedWorkspace) return;
    setExchangeCredential({ bearerToken: token, workspaceId: selectedWorkspace });
    setBearerInput("");
    setConnections([]); setSelectedId(""); setNotifications([]);
    setReloadConnections(value => value + 1);
  };

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
    setWorkspaceSelector("");
    setBearerInput("");
    setExchangeCredential(null);
    setConnections([]); setSelectedId(""); setNotifications([]);
    setHealth(null); setResources(null); setRefreshOperation(null); setRenewal(null); setPendingRenewal(null);
  }, [sessionScope]);

  useEffect(() => {
    const existing = renewalCleanupTimers.current.get(renewalScope);
    if (existing !== undefined) {
      window.clearTimeout(existing);
      renewalCleanupTimers.current.delete(renewalScope);
    }
    return () => {
      const timer = window.setTimeout(() => {
        if (renewalCleanupTimers.current.get(renewalScope) !== timer) return;
        renewalCleanupTimers.current.delete(renewalScope);
        const storage = browserRenewalStorage();
        if (storage) void clearPendingRenewalScope(storage, renewalScope);
      }, 0);
      renewalCleanupTimers.current.set(renewalScope, timer);
    };
  }, [renewalScope]);

  useEffect(() => {
    if (!exchangeCredential) {
      setConnections([]); setSelectedId(""); setConnectionError(""); setLoadingConnections(false);
      return;
    }
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
  }, [client, exchangeCredential, reloadConnections, t]);

  useEffect(() => {
    if (!exchangeCredential || !selectedConnection) {
      setHealth(null); setResources(null); setRefreshOperation(null); setRenewal(null);
      setPendingRenewal(null); setPendingRenewalLoading(false);
      setHealthError(""); setResourcesError(""); setHealthLoading(false); setResourcesLoading(false);
      return;
    }
    const controller = new AbortController();
    const cloudEnabled = supportsCloudObservations(selectedConnection.provider);
    setHealth(null); setResources(null); setRefreshOperation(null); setRenewal(null);
    setPendingRenewal(null);
    setHealthError(""); setResourcesError(""); setRenewalError("");
    const renewalSupported = supportsAuthorizationRenewal(selectedConnection.provider);
    setHealthLoading(true); setResourcesLoading(cloudEnabled); setPendingRenewalLoading(renewalSupported);
    void (async () => {
      try {
        const value = await client.getAuthorizationHealth(selectedConnection.id, controller.signal);
        if (controller.signal.aborted) return;
        setHealth(value);
        if (!renewalSupported || !value.authorizationRef) return;
        const storage = browserRenewalStorage();
        if (!storage) return;
        const pending = await loadPendingRenewalRequest(storage, renewalScope, selectedConnection.id, value.authorizationRef);
        if (controller.signal.aborted) return;
        if (!pending) return;
        setPendingRenewal(pending);
        if (!pending.sessionRef) return;
        try {
          const status = await client.getRenewal(value.authorizationRef, pending.sessionRef, controller.signal);
          if (controller.signal.aborted) return;
          setRenewal(status);
          const retryState = renewalRetryState(status);
          if (retryState) {
            const updated = { ...pending, retryState };
            setPendingRenewal(updated);
            await savePendingRenewalRequest(storage, renewalScope, selectedConnection.id, value.authorizationRef, updated);
          } else {
            await clearPendingRenewalRequest(storage, renewalScope, selectedConnection.id, value.authorizationRef);
            setPendingRenewal(null);
          }
        } catch (error) {
          if (!controller.signal.aborted) setRenewalError(safeFailure(error, t));
        }
      } catch (error) {
        if (!controller.signal.aborted) setHealthError(safeFailure(error, t));
      } finally {
        if (!controller.signal.aborted) { setHealthLoading(false); setPendingRenewalLoading(false); }
      }
    })();
    if (cloudEnabled) {
      void client.getResources(selectedConnection.id, controller.signal).then(value => {
        if (!controller.signal.aborted) setResources(value);
      }, error => {
        if (!controller.signal.aborted) setResourcesError(safeFailure(error, t));
      }).finally(() => { if (!controller.signal.aborted) setResourcesLoading(false); });
    }
    return () => controller.abort();
  }, [client, exchangeCredential, selectedConnection, renewalScope, t]);

  useEffect(() => {
    if (!exchangeCredential) { setNotifications([]); setFeedError(""); return; }
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
  }, [client, exchangeCredential, t]);

  useEffect(() => {
    if (!exchangeCredential || !renewal || isRenewalTerminal(renewal.state) || !selectedConnection) return;
    const controller = new AbortController();
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const updated = await client.getRenewal(renewal.authorizationRef, renewal.sessionRef, controller.signal);
        if (active) setRenewal(updated);
        if (active && selectedConnection && supportsAuthorizationRenewal(selectedConnection.provider)
          && activeHealth?.authorizationRef && pendingRenewal?.sessionRef === updated.sessionRef) {
          const storage = browserRenewalStorage();
          const retryState = renewalRetryState(updated);
          if (retryState) {
            if (pendingRenewal.retryState !== retryState || pendingRenewal.sessionRef !== updated.sessionRef) {
              const next = { ...pendingRenewal, sessionRef: updated.sessionRef, retryState };
              setPendingRenewal(next);
              if (storage) await savePendingRenewalRequest(storage, renewalScope, selectedConnection.id, activeHealth.authorizationRef, next);
            }
          } else {
            if (storage) await clearPendingRenewalRequest(storage, renewalScope, selectedConnection.id, activeHealth.authorizationRef);
            setPendingRenewal(null);
          }
        }
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
  }, [client, exchangeCredential, renewal?.sessionRef, renewal?.state, renewal?.reasonCode, selectedConnection, activeHealth?.authorizationRef, pendingRenewal, renewalScope, t]);

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
    if (!exchangeCredential || !selectedConnection || !supportsCloudObservations(selectedConnection.provider)) return;
    setResourcesLoading(true); setResourcesError("");
    try { setResources(await client.getResources(selectedConnection.id)); }
    catch (error) { setResourcesError(safeFailure(error, t)); }
    finally { setResourcesLoading(false); }
  };

  const refreshObservations = async () => {
    if (!exchangeCredential || !selectedConnection || !canOperate || !supportsCloudObservations(selectedConnection.provider) || actionBusy) return;
    setActionBusy(true); setResourcesError("");
    try {
      const operation = await client.refreshResources(selectedConnection.id, newIntegrationIdempotencyKey());
      setRefreshOperation({ state: operation.state, updatedAt: operation.updatedAt });
      await readObservations();
    } catch (error) { setResourcesError(safeFailure(error, t)); }
    finally { setActionBusy(false); }
  };

  const startRenewal = async (retrySameKey: boolean) => {
    if (!exchangeCredential || !selectedConnection || !supportsAuthorizationRenewal(selectedConnection.provider)
      || !health?.authorizationRef || health.connectionId !== selectedConnection.id || !canOperate
      || actionBusy || pendingRenewalLoading) return;
    if (retrySameKey && !canReplayWeComRenewal(selectedConnection.provider, health.authorizationRef, pendingRenewal, activeRenewal)) return;
    if (!retrySameKey && (pendingRenewal || (activeRenewal && !isRenewalTerminal(activeRenewal.state)))) return;
    const storage = browserRenewalStorage();
    if (!storage) { setRenewalError(t("Browser session storage is unavailable; renewal cannot start safely.")); return; }

    setActionBusy(true); setRenewalError("");
    const requestKey = retrySameKey && pendingRenewal ? pendingRenewal.idempotencyKey : newIntegrationIdempotencyKey();
    const requestHandle: PendingRenewalRequest = { idempotencyKey: requestKey, sessionRef: null, retryState: "REQUEST_OUTCOME_UNKNOWN" };
    setPendingRenewal(requestHandle);
    setRenewal(null);
    const stored = await savePendingRenewalRequest(storage, renewalScope, selectedConnection.id, health.authorizationRef, requestHandle);
    if (!stored) {
      setPendingRenewal(null);
      setRenewalError(t("Browser session storage is unavailable; renewal cannot start safely."));
      setActionBusy(false);
      return;
    }
    try {
      const session = await client.beginRenewal(health.authorizationRef, requestKey);
      setRenewal(session);
      const retryState = renewalRetryState(session);
      if (retryState) {
        const unresolved = { idempotencyKey: requestKey, sessionRef: session.sessionRef, retryState };
        setPendingRenewal(unresolved);
        await savePendingRenewalRequest(storage, renewalScope, selectedConnection.id, health.authorizationRef, unresolved);
      } else {
        setPendingRenewal(null);
        await clearPendingRenewalRequest(storage, renewalScope, selectedConnection.id, health.authorizationRef);
      }
    } catch (error) {
      setRenewalError(safeFailure(error, t));
      if (isAmbiguousRenewalFailure(error)) {
        await savePendingRenewalRequest(storage, renewalScope, selectedConnection.id, health.authorizationRef, requestHandle);
      } else {
        setPendingRenewal(null);
        await clearPendingRenewalRequest(storage, renewalScope, selectedConnection.id, health.authorizationRef);
      }
    } finally { setActionBusy(false); }
  };

  const acknowledge = async (notification: IntegrationNotification) => {
    if (!exchangeCredential || !canOperate) return;
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
  const renewalStorageAvailable = browserRenewalStorage() !== null;
  const providerRenewalSupported = supportsAuthorizationRenewal(selectedConnection?.provider ?? "");
  const canRetryRenewal = renewalStorageAvailable && canReplayWeComRenewal(selectedConnection?.provider ?? "", activeHealth?.authorizationRef ?? null, pendingRenewal, activeRenewal);
  const canStartRenewal = providerRenewalSupported && !!activeHealth?.authorizationRef && canOperate && !actionBusy
    && renewalStorageAvailable && !pendingRenewalLoading && !pendingRenewal && (!activeRenewal || isRenewalTerminal(activeRenewal.state));

  return <div className="page-stack integration-alerts-page">
    <PageHeader
      eyebrow="Exchange / Integrations"
      title="Authorization and cloud observations"
      description="Review authorization health, renew supported WeCom connections, and read configured cloud observations."
      action={<Button onClick={() => setReloadConnections(value => value + 1)} disabled={!exchangeCredential || loadingConnections}>{loadingConnections ? t("Reading...") : t("Refresh connections")}</Button>}
    />

    <Panel title="Exchange access" meta={<StatusPill value={exchangeCredential ? t("Provided for this tab") : t("Not configured")} tone={exchangeCredential ? "info" : "muted"} />}>
      <form className="ia-exchange-credential" onSubmit={connectExchange}>
        <label className="field">
          <span className="field__label">{t("Personal Cyrene first-party Product bearer")}</span>
          <input type="password" autoComplete="off" spellCheck={false} value={bearerInput} onChange={event => { setBearerInput(event.target.value); if (exchangeCredential) invalidateExchangeCredential(); }} />
        </label>
        <label className="field">
          <span className="field__label">{t("Exchange workspace selector")}</span>
          <input autoComplete="off" spellCheck={false} value={workspaceSelector} onChange={event => {
            const value = event.target.value;
            setWorkspaceSelector(value);
            if (exchangeCredential && value.trim() !== exchangeCredential.workspaceId) invalidateExchangeCredential();
          }} />
        </label>
        <div className="ia-actions">
          <Button type="submit" tone="primary" disabled={!bearerInput.trim() || !workspaceSelector.trim()}>{t(exchangeCredential ? "Replace Exchange credential" : "Connect Exchange")}</Button>
          {exchangeCredential ? <Button type="button" onClick={() => { setBearerInput(""); invalidateExchangeCredential(); }}>{t("Disconnect Exchange")}</Button> : null}
        </div>
      </form>
      <p className="ia-scope-note">{t("Use a personal first-party Product bearer, not a Studio login or MCP token. The credential stays in page memory and is sent only to the approved Exchange routes. Exchange verifies the bearer; the workspace value is a selector, not an identity claim.")}</p>
      {!exchangeCredential ? <p className="ia-scope-note">{t("Exchange data is not requested until you connect with both values.")}</p> : null}
    </Panel>

    {exchangeCredential ? <>

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
              <p className="ia-scope-note">{t("Exchange filters this list and its details for the supplied bearer and workspace selector.")}</p>
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
                {activeRenewal.state === "WAITING_USER" && officialRenewalUrl ? <Button type="button" onClick={() => window.open(officialRenewalUrl, "_blank", "noopener,noreferrer")}>{t("Open official authorization or permission management page")}</Button> : null}
                {activeRenewal.state === "WAITING_USER" && !officialRenewalUrl ? <small>{t("Official authorization link is unavailable.")}</small> : null}
              </div> : null}
              {renewalError ? <p className="ia-inline-error" role="alert">{renewalError}</p> : null}
              {providerRenewalSupported ? <div className="ia-actions">
                {canRetryRenewal
                  ? <Button tone="primary" disabled={!canOperate || actionBusy || pendingRenewalLoading} loading={actionBusy} onClick={() => void startRenewal(true)}>{t("Retry same renewal request")}</Button>
                  : <Button tone="primary" disabled={!canStartRenewal} loading={actionBusy} onClick={() => void startRenewal(false)}>{t("Start authorization renewal")}</Button>}
                {!canOperate ? <small>{t("Renewal requires products.operate permission.")}</small> : null}
                {canOperate && !activeHealth.authorizationRef ? <small>{t("No authorization record is available for renewal.")}</small> : null}
                {pendingRenewalLoading ? <small>{t("Checking the existing renewal session before enabling an action.")}</small> : null}
                {pendingRenewal && !canRetryRenewal ? <small>{t("Exchange is resolving the existing renewal session; a new session is disabled.")}</small> : null}
                {canRetryRenewal ? <small>{t("Retry uses the original idempotency key; it cannot create another renewal session.")}</small> : null}
              </div> : <p className="ia-scope-note">{t("Authorization renewal is currently available only for WeCom connections.")}</p>}
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
    </> : <StateBlock kind="empty" title="Connect Exchange to view integrations" detail="Exchange requests require an explicit personal first-party bearer and workspace selector." />}
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

function isAmbiguousRenewalFailure(error: unknown): boolean {
  return !(error instanceof IntegrationApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
}

function safeFailure(error: unknown, translate: (message: string) => string): string {
  if (error instanceof IntegrationApiError) return `${translate("Request failed")}: ${error.status || translate("Connection unavailable")} · ${error.code}`;
  return translate("Request failed. Verify the paired session and retry.");
}
