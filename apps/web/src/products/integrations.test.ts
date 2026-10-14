import { describe, expect, it } from "vitest";
import type { NavigatorApi } from "../../services/navigator/src/api";
import {
  authorizationExpiryPresentation,
  browserNotificationPermissionLabel,
  canReplayWeComRenewal,
  classifyAuthorizationExpiry,
  renewalRetryState,
  safeOfficialRenewalUrl,
  supportsAuthorizationRenewal,
  supportsCloudObservations,
  validateActivationQR,
  validateExistingGrantManagementURL,
} from "./IntegrationAlerts";
import { followIntegrationNotifications, NotificationDeduplicator } from "./integration-notification-feed";
import {
  IntegrationApiError,
  IntegrationsClient,
  parseIntegrationNotification,
  type ExchangeProductCredential,
  type IntegrationNotification,
  type NotificationPage,
  type RenewalSession,
} from "./integrations-client";
import {
  readBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  sendBrowserNotification,
  type BrowserNotificationPort,
} from "./integration-notification-permission";
import {
  clearPendingRenewalScope,
  loadPendingRenewalRequest,
  savePendingRenewalRequest,
  type PendingRenewalRequest,
  type RenewalStoragePort,
} from "./integration-renewal-storage";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function notification(sequence: number, id = `notification-${sequence}`, connectionId: string | null = "connection-1"): IntegrationNotification {
  return {
    id,
    sequence,
    connectionId,
    kind: "authorization.required",
    severity: "warning",
    title: `Authorization required ${sequence}`,
    description: "Renew the configured connection.",
    createdAt: "2026-10-14T12:00:00Z",
    actionRef: null,
    acknowledgedAt: null,
  };
}

function page(...items: IntegrationNotification[]): NotificationPage {
  return { notifications: items, nextSequence: items.at(-1)?.sequence ?? 0 };
}

const existingGrantManagementUrl = "https://work.weixin.qq.com/ai/aiHelper/authorizationList?aibotid=12345678901234567&bar_style_type=3&for_native=true&forceInnerBrowser=1&from=chat&hide_more_btn=true&pc_bar_bg=f6f6f7%2C202021&str_aibotid=bot_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&type=6&ww_vh=640&ww_vw=640";
const renewalSession1 = "00000000-0000-4000-8000-000000000001";
const renewalSession2 = "00000000-0000-4000-8000-000000000002";
const renewalSessionManagement = "00000000-0000-4000-8000-000000000003";

function clientFor(requestProductResponse: (path: string, init?: RequestInit) => Promise<Response>): IntegrationsClient {
  return new IntegrationsClient(
    { requestProductResponse } as unknown as Pick<NavigatorApi, "requestProductResponse">,
    () => ({ bearerToken: "synthetic-platform-bearer", workspaceId: "synthetic-workspace" }),
  );
}

class MemoryRenewalStorage implements RenewalStoragePort {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("Client integration views", () => {
  it("requires an explicit first-party Exchange bearer and sends it only in the dedicated headers", async () => {
    const requests: { path: string; headers: Headers }[] = [];
    const api = {
      requestProductResponse: async (path: string, init: RequestInit = {}) => {
        requests.push({ path, headers: new Headers(init.headers) });
        return jsonResponse([]);
      },
    } as unknown as Pick<NavigatorApi, "requestProductResponse">;
    const disconnected = new IntegrationsClient(api, () => null);
    await expect(disconnected.listConnections()).rejects.toMatchObject({ code: "EXCHANGE_CREDENTIAL_REQUIRED" });
    expect(requests).toHaveLength(0);

    const credential: ExchangeProductCredential = { bearerToken: "synthetic-platform-bearer", workspaceId: "workspace-fixture" };
    const connected = new IntegrationsClient(api, () => credential);
    await connected.listConnections();
    expect(requests[0]).toMatchObject({ path: "/api/v1/integrations/connections" });
    expect(requests[0]?.headers.get("X-Cyrene-Product-Authorization")).toBe("Bearer synthetic-platform-bearer");
    expect(requests[0]?.headers.get("X-Cyrene-Workspace-Id")).toBe("workspace-fixture");
    expect(requests[0]?.headers.has("Authorization")).toBe(false);
  });

  it("keeps unknown expiry distinct from expired authorization and only enables approved cloud providers", () => {
    expect(classifyAuthorizationExpiry(null, Date.parse("2026-10-14T12:00:00Z"))).toBe("unknown");
    expect(classifyAuthorizationExpiry("not-a-time", 0)).toBe("unknown");
    expect(classifyAuthorizationExpiry("2026-10-14T11:59:59Z", Date.parse("2026-10-14T12:00:00Z"))).toBe("expired");
    expect(classifyAuthorizationExpiry("2026-10-14T12:00:01Z", Date.parse("2026-10-14T12:00:00Z"))).toBe("future");
    expect(authorizationExpiryPresentation(null, 0, value => value)).toEqual({ state: "unknown", label: "Expiry unknown" });
    expect(authorizationExpiryPresentation("2026-10-14T11:59:59Z", Date.parse("2026-10-14T12:00:00Z"), value => value)).toEqual({ state: "expired", label: "Expired" });
    expect(["azure", "gcp", "hf", "runpod", "tailscale"].every(supportsCloudObservations)).toBe(true);
    expect(supportsCloudObservations("wecom")).toBe(false);
    expect(supportsAuthorizationRenewal("wecom")).toBe(true);
    expect(supportsAuthorizationRenewal("azure")).toBe(false);
    expect(safeOfficialRenewalUrl("http://login.example.test/authorize")).toBeNull();
    expect(safeOfficialRenewalUrl("https://user:secret@login.example.test/authorize")).toBeNull();
    const activationQr = "https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=abcdefgh";
    expect(validateActivationQR(activationQr)).toBe(activationQr);
    expect(safeOfficialRenewalUrl(activationQr))
      .toBe("https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=abcdefgh");
    for (const malformed of [
      "https://work.weixin.qq.com.evil.example/ai/qc/gen?source=wecom_cli_external&scode=abcdefgh",
      "https://open.work.weixin.qq.com/authorize?source=wecom_cli_external&scode=abcdefgh",
      "https://work.weixin.qq.com:443/ai/qc/gen?source=wecom_cli_external&scode=abcdefgh",
      "https://work.weixin.qq.com/ai/qc/gen?source=other&scode=abcdefgh",
      "https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=short",
      "https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=abcdefgh&redirect=https://evil.example",
      "https://user@work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=abcdefgh",
      "https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=abcdefgh#",
    ]) expect(safeOfficialRenewalUrl(malformed)).toBeNull();
  });

  it("accepts only the canonical existing-profile WeCom grant-management URL", () => {
    const canonical = existingGrantManagementUrl;
    const shuffled = "https://work.weixin.qq.com/ai/aiHelper/authorizationList?ww_vw=640&type=6&str_aibotid=bot_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&aibotid=12345678901234567&from=chat&ww_vh=640&pc_bar_bg=f6f6f7%2C202021&hide_more_btn=true&forceInnerBrowser=1&for_native=true&bar_style_type=3";
    expect(validateExistingGrantManagementURL(canonical)).toBe(canonical);
    expect(validateExistingGrantManagementURL(shuffled)).toBe(canonical);
    expect(safeOfficialRenewalUrl(canonical)).toBe(canonical);
    expect(validateActivationQR(canonical)).toBeNull();

    const malformed = [
      canonical.replace("work.weixin.qq.com", "work.weixin.qq.com.evil.example"),
      canonical.replace("work.weixin.qq.com/ai/aiHelper", "user@work.weixin.qq.com/ai/aiHelper"),
      canonical.replace("work.weixin.qq.com/ai/aiHelper", "open.work.weixin.qq.com/ai/aiHelper"),
      canonical.replace("https://work.weixin.qq.com/", "https://work.weixin.qq.com:443/"),
      canonical.replace("/ai/aiHelper/authorizationList", "/ai/aiHelper/authorizationlist"),
      `${canonical}#fragment`,
      `${canonical}&redirect=https://evil.example`,
      `${canonical}&type=6`,
      canonical.replace("&ww_vw=640", ""),
      canonical.replace("type=6", "type=5"),
      canonical.replace("type=6", "type=4"),
      canonical.replace("from=chat", "from=other"),
      canonical.replace("forceInnerBrowser=1", "forceInnerBrowser=0"),
      canonical.replace("bar_style_type=3", "bar_style_type=2"),
      canonical.replace("for_native=true", "for_native=false"),
      canonical.replace("hide_more_btn=true", "hide_more_btn=false"),
      canonical.replace("12345678901234567", "1234567890123456"),
      canonical.replace("bot_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bot_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      canonical.replace("f6f6f7%2C202021", "f6f6f7%2Cinvalid"),
      canonical.replace("ww_vh=640", "ww_vh=0"),
      canonical.replace("ww_vw=640", "ww_vw=4097"),
    ];
    for (const value of malformed) {
      expect(validateExistingGrantManagementURL(value)).toBeNull();
      expect(safeOfficialRenewalUrl(value)).toBeNull();
    }
  });

  it("parses Exchange's existing-profile authorization URL for a later explicit user action", async () => {
    const client = clientFor(async () => jsonResponse({
      sessionRef: renewalSessionManagement, authorizationRef: "authorization-1", state: "WAITING_USER",
      createdAt: "2026-10-14T12:00:00Z", expiresAt: null,
      authorizationUrl: existingGrantManagementUrl, generation: 3,
    }, 202, { Location: `/api/v1/accounts/renewal-sessions/${renewalSessionManagement}` }));
    const result = await client.beginRenewal("authorization-1", "renew-management-once");
    expect(result.authorizationUrl).toBe(existingGrantManagementUrl);
    expect(safeOfficialRenewalUrl(result.authorizationUrl)).toBe(existingGrantManagementUrl);
  });

  it("allows same-key retry only for WeCom's known ambiguous VERIFYING start", () => {
    const pending: PendingRenewalRequest = { idempotencyKey: "same-key", sessionRef: renewalSession1, retryState: "PROVIDER_START_OUTCOME_UNKNOWN" };
    const ambiguous: RenewalSession = {
      sessionRef: renewalSession1, authorizationRef: "authorization-1", state: "VERIFYING",
      createdAt: "2026-10-14T12:00:00Z", expiresAt: null, authorizationUrl: null,
      reasonCode: "provider_start_outcome_unknown", generation: 4,
    };
    expect(renewalRetryState(ambiguous)).toBe("PROVIDER_START_OUTCOME_UNKNOWN");
    expect(canReplayWeComRenewal("wecom", "authorization-1", pending, ambiguous)).toBe(true);
    expect(canReplayWeComRenewal("wecom", "authorization-1", pending, null)).toBe(true);
    expect(canReplayWeComRenewal("wecom", "authorization-1", {
      idempotencyKey: "same-key", sessionRef: null, retryState: "REQUEST_OUTCOME_UNKNOWN",
    }, null)).toBe(true);
    expect(canReplayWeComRenewal("azure", "authorization-1", pending, ambiguous)).toBe(false);
    expect(canReplayWeComRenewal("wecom", "authorization-1", { ...pending, retryState: "PROVIDER_STATUS_LOOKUP_UNAVAILABLE" }, {
      ...ambiguous, reasonCode: "provider_status_lookup_unavailable",
    })).toBe(true);
    expect(canReplayWeComRenewal("wecom", "authorization-1", pending, {
      ...ambiguous, reasonCode: "provider_status_unavailable",
    })).toBe(false);
    expect(canReplayWeComRenewal("wecom", "authorization-1", pending, { ...ambiguous, state: "WAITING_USER" })).toBe(false);
    expect(canReplayWeComRenewal("wecom", null, pending, ambiguous)).toBe(false);
  });

  it("restores only the same session/workspace/connection renewal handle and clears it on scope exit", async () => {
    const storage = new MemoryRenewalStorage();
    const scopeA = "actor-a\u0000workspace-a\u0000session-a";
    const scopeB = "actor-a\u0000workspace-b\u0000session-b";
    const pending: PendingRenewalRequest = { idempotencyKey: "same-key", sessionRef: renewalSession1, retryState: "PROVIDER_START_OUTCOME_UNKNOWN" };
    expect(await savePendingRenewalRequest(storage, scopeA, "connection-1", "auth-1", pending)).toBe(true);
    expect(await loadPendingRenewalRequest(storage, scopeA, "connection-1", "auth-1")).toEqual(pending);
    expect(await loadPendingRenewalRequest(storage, scopeA, "connection-2", "auth-1")).toBeNull();
    expect(await loadPendingRenewalRequest(storage, scopeA, "connection-1", "auth-2")).toBeNull();
    expect(await loadPendingRenewalRequest(storage, scopeB, "connection-1", "auth-1")).toBeNull();
    expect([...storage.values.keys()].join(" ")).not.toContain("workspace-a");
    expect([...storage.values.values()].join(" ")).not.toContain("auth-1");
    await savePendingRenewalRequest(storage, scopeB, "connection-1", "auth-1", pending);
    await clearPendingRenewalScope(storage, scopeA);
    expect(await loadPendingRenewalRequest(storage, scopeA, "connection-1", "auth-1")).toBeNull();
    expect(await loadPendingRenewalRequest(storage, scopeB, "connection-1", "auth-1")).toEqual(pending);
  });

  it("requests browser notification permission only through the explicit action and handles denied or unsupported browsers", async () => {
    let requests = 0, sent = 0;
    const denied: BrowserNotificationPort = {
      permission: "denied",
      requestPermission: async () => { requests += 1; return "denied"; },
      notify: () => { sent += 1; },
    };
    expect(readBrowserNotificationPermission(denied)).toBe("denied");
    expect(requests).toBe(0);
    expect(await requestBrowserNotificationPermission(null)).toBe("unsupported");
    expect(await requestBrowserNotificationPermission(denied)).toBe("denied");
    expect(requests).toBe(1);
    expect(browserNotificationPermissionLabel("denied", value => value)).toBe("Blocked in browser settings");
    expect(browserNotificationPermissionLabel("unsupported", value => value)).toBe("Unsupported");
    expect(sendBrowserNotification(denied, "denied", "title", "body", "id")).toBe(false);
    expect(sent).toBe(0);
    expect(sendBrowserNotification(null, "unsupported", "title", "body", "id")).toBe(false);
  });

  it("uses actor-scoped connection IDs and strips binding, target, QR, and raw observation data before UI state", async () => {
    const paths: string[] = [];
    const client = clientFor(async path => {
      paths.push(path);
      if (path === "/api/v1/integrations/connections") return jsonResponse([
        { id: "connection-1", provider: "hf", displayName: "Models", bindingRef: "binding-private", targetRef: "target-private" },
      ]);
      if (path.endsWith("authorization-health")) return jsonResponse({
        connectionId: "connection-1", provider: "hf", authorizationRef: null, loginState: "PRESENT",
        authorizationState: "UNKNOWN", checkedAt: null, expiresAt: null, generation: 2, capabilities: [], reasonCode: "not_observed",
      });
      return jsonResponse({
        connectionId: "connection-1", provider: "hf", checkedAt: "2026-10-14T12:01:00Z", resources: [{
          externalRef: "private-provider-ref", kind: "hf.model", displayName: "public model label", status: "UNKNOWN",
          providerStatus: null, collectedAt: "2026-10-14T12:00:00Z", observedAt: null,
          attributes: { ownerEmail: "private@example.test", raw: { identity: "private" } },
          platformResourceRef: "platform-private-ref", platformGeneration: 4,
          source: "private-binding-alias", freshness: "UNKNOWN",
        }],
      });
    });
    const connections = await client.listConnections();
    expect(connections).toEqual([{ id: "connection-1", provider: "hf", displayName: "Models" }]);
    const health = await client.getAuthorizationHealth(connections[0]!.id);
    expect(health).toMatchObject({ loginState: "PRESENT", authorizationState: "UNKNOWN", authorizationRef: null, checkedAt: null, reasonCode: "not_observed", expiresAt: null });
    const resources = await client.getResources(connections[0]!.id);
    expect(resources.resources[0]).toEqual({
      kind: "hf.model", displayName: "public model label", status: "UNKNOWN", providerStatus: null,
      collectedAt: "2026-10-14T12:00:00Z", observedAt: null, freshness: "UNKNOWN",
    });
    expect(JSON.stringify({ connections, resources })).not.toContain("private");
    expect(paths).toEqual([
      "/api/v1/integrations/connections",
      "/api/v1/integrations/connections/connection-1/authorization-health",
      "/api/v1/integrations/connections/connection-1/resources",
    ]);
  });

  it("shows the empty cloud projection with an unknown collection timestamp", async () => {
    const client = clientFor(async () => jsonResponse({ connectionId: "connection-1", provider: "runpod", checkedAt: null, resources: [] }));
    await expect(client.getResources("connection-1")).resolves.toMatchObject({
      provider: "runpod", checkedAt: null, resources: [],
    });
  });

  it("requires async Location contracts and keeps renewal secrets and QR references out of returned UI data", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const client = clientFor(async (path, init) => {
      calls.push({ path, init });
      return jsonResponse({
        sessionRef: renewalSession1, authorizationRef: "authorization-1", state: "WAITING_USER",
        createdAt: "2026-10-14T12:00:00Z", expiresAt: null,
        authorizationUrl: "https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=opaque_state_123",
        qrAttachmentRef: "/native/private/qr.png", generation: 3,
      }, 202, { Location: `/api/v1/accounts/renewal-sessions/${renewalSession1}` });
    });
    const result = await client.beginRenewal("authorization-1", "renew-once");
    expect(result).not.toHaveProperty("qrAttachmentRef");
    expect(result.authorizationUrl).toContain("https://work.weixin.qq.com/ai/qc/gen?");
    expect(calls[0]?.path).toBe("/api/v1/accounts/authorizations/authorization-1/renewal-sessions");
    expect(new Headers(calls[0]?.init?.headers).get("Idempotency-Key")).toBe("renew-once");
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("retains an explicit ambiguous provider-start reason without a renewal URL", async () => {
    const keys: Array<string | null> = [];
    const client = clientFor(async (_path, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key"));
      return jsonResponse({
        sessionRef: renewalSession2, authorizationRef: "authorization-1", state: "VERIFYING",
        createdAt: "2026-10-14T12:00:00Z", expiresAt: null, authorizationUrl: null,
        reasonCode: "provider_start_outcome_unknown", generation: 4,
      }, 202, { Location: `/api/v1/accounts/renewal-sessions/${renewalSession2}` });
    });
    const first = await client.beginRenewal("authorization-1", "same-renewal-key");
    const pending: PendingRenewalRequest = {
      idempotencyKey: "same-renewal-key", sessionRef: first.sessionRef, retryState: "PROVIDER_START_OUTCOME_UNKNOWN",
    };
    expect(renewalRetryState(first)).toBe("PROVIDER_START_OUTCOME_UNKNOWN");
    expect(canReplayWeComRenewal("wecom", "authorization-1", pending, first)).toBe(true);
    const replay = await client.beginRenewal("authorization-1", pending.idempotencyKey);
    expect(replay).toMatchObject({ state: "VERIFYING", authorizationUrl: null, reasonCode: "provider_start_outcome_unknown" });
    expect(keys).toEqual(["same-renewal-key", "same-renewal-key"]);
  });

  it("parses Exchange's read-only status lookup unavailable reason", async () => {
    const paths: string[] = [];
    const client = clientFor(async path => {
      paths.push(path);
      return jsonResponse({
        sessionRef: renewalSession2, authorizationRef: "authorization-1", state: "VERIFYING",
        createdAt: "2026-10-14T12:00:00Z", expiresAt: null, authorizationUrl: null,
        reasonCode: "provider_status_lookup_unavailable", generation: 4,
      });
    });
    const status = await client.getRenewal("authorization-1", renewalSession2);
    expect(paths).toEqual([`/api/v1/accounts/renewal-sessions/${renewalSession2}`]);
    expect(renewalRetryState(status)).toBe("PROVIDER_STATUS_LOOKUP_UNAVAILABLE");
    expect(canReplayWeComRenewal("wecom", "authorization-1", {
      idempotencyKey: "same-renewal-key", sessionRef: renewalSession2, retryState: "PROVIDER_STATUS_LOOKUP_UNAVAILABLE",
    }, status)).toBe(true);
  });

  it("keeps failed response bodies out of displayed errors while preserving the safe problem code", async () => {
    const client = clientFor(async () => new Response(JSON.stringify({ code: "EXCHANGE_CONNECTION_REAUTHORIZATION_REQUIRED", detail: "private@example.test and secret-value" }), {
      status: 409, headers: { "Content-Type": "application/problem+json" },
    }));
    let failure: unknown;
    try { await client.getAuthorizationHealth("connection-1"); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(IntegrationApiError);
    expect(failure).toMatchObject({ status: 409, code: "EXCHANGE_CONNECTION_REAUTHORIZATION_REQUIRED" });
    expect((failure as Error).message).not.toContain("private@example.test");
    expect((failure as Error).message).not.toContain("secret-value");
  });
});

describe("durable integration notification recovery", () => {
  it("accepts a nullable Product notification connection ID", () => {
    expect(parseIntegrationNotification(notification(1, "notice-no-connection", null))).toMatchObject({
      id: "notice-no-connection", connectionId: null,
    });
  });

  it("deduplicates by both server sequence and notification id", () => {
    const seen = new NotificationDeduplicator();
    expect(seen.accept(notification(4, "notice-a"))).toBe(true);
    expect(seen.accept(notification(4, "notice-b"))).toBe(false);
    expect(seen.accept(notification(5, "notice-a"))).toBe(false);
    expect(seen.cursor).toBe(4);
  });

  it("recovers notifications missed while offline before continuing the SSE cursor", async () => {
    const controller = new AbortController();
    let listCalls = 0, streamCalls = 0;
    const delivered: Array<{ sequence: number; browser: boolean }> = [];
    const api = {
      listNotifications: async (after: number) => {
        listCalls += 1;
        if (listCalls === 1) throw new Error("offline");
        if (listCalls === 2) { expect(after).toBe(0); return page(notification(1)); }
        expect(after).toBe(1);
        const missed = notification(2);
        controller.abort();
        return page(missed);
      },
      openNotificationEvents: async (after: number) => {
        streamCalls += 1;
        expect(after).toBe(1);
        throw new Error("stream offline");
      },
    };
    await followIntegrationNotifications({
      api, signal: controller.signal, reconnectDelayMs: 0, sleep: async () => undefined,
      onNotification: (item, hint) => delivered.push({ sequence: item.sequence, browser: hint.showBrowserNotification }),
    });
    expect(delivered).toEqual([{ sequence: 1, browser: false }, { sequence: 2, browser: true }]);
    expect(streamCalls).toBe(1);
  });

  it("recovers sequence gaps and drops the repeated SSE frame after list recovery", async () => {
    const controller = new AbortController();
    const events = [notification(3), notification(3)].map(item => `id: ${item.sequence}\ndata: ${JSON.stringify(item)}\n\n`).join("");
    let listCalls = 0, openedAfter = -1;
    const delivered: number[] = [];
    const api = {
      listNotifications: async (after: number) => {
        listCalls += 1;
        if (listCalls === 1) return page(notification(1));
        expect(after).toBe(1);
        return page(notification(2), notification(3));
      },
      openNotificationEvents: async (after: number) => {
        openedAfter = after;
        return new Response(events, { headers: { "Content-Type": "text/event-stream" } });
      },
    };
    await followIntegrationNotifications({
      api, signal: controller.signal, reconnectDelayMs: 0, sleep: async () => undefined,
      onNotification: item => { delivered.push(item.sequence); if (item.sequence === 3) controller.abort(); },
    });
    expect(openedAfter).toBe(1);
    expect(delivered).toEqual([1, 2, 3]);
    expect(listCalls).toBe(2);
  });

  it("sends the current sequence as Last-Event-ID to the paired Product endpoint", async () => {
    let call: { path: string; init?: RequestInit } | undefined;
    const client = clientFor(async (path, init) => {
      call = { path, init };
      return new Response(": connected\n\n", { headers: { "Content-Type": "text/event-stream" } });
    });
    const response = await client.openNotificationEvents(23, new AbortController().signal);
    expect(call?.path).toBe("/api/v1/integrations/notifications/events");
    expect(new Headers(call?.init?.headers).get("Last-Event-ID")).toBe("23");
    await response.body?.cancel();
  });
});
