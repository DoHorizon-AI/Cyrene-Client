import { describe, expect, it } from "vitest";
import type { NavigatorApi } from "../../services/navigator/src/api";
import { authorizationExpiryPresentation, browserNotificationPermissionLabel, classifyAuthorizationExpiry, safeOfficialRenewalUrl, supportsCloudObservations } from "./IntegrationAlerts";
import { followIntegrationNotifications, NotificationDeduplicator } from "./integration-notification-feed";
import {
  IntegrationApiError,
  IntegrationsClient,
  type IntegrationNotification,
  type NotificationPage,
} from "./integrations-client";
import {
  readBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  sendBrowserNotification,
  type BrowserNotificationPort,
} from "./integration-notification-permission";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function notification(sequence: number, id = `notification-${sequence}`): IntegrationNotification {
  return {
    id,
    sequence,
    connectionId: "connection-1",
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

function clientFor(requestProductResponse: (path: string, init?: RequestInit) => Promise<Response>): IntegrationsClient {
  return new IntegrationsClient({ requestProductResponse } as unknown as Pick<NavigatorApi, "requestProductResponse">);
}

describe("Client integration views", () => {
  it("keeps unknown expiry distinct from expired authorization and only enables approved cloud providers", () => {
    expect(classifyAuthorizationExpiry(null, Date.parse("2026-10-14T12:00:00Z"))).toBe("unknown");
    expect(classifyAuthorizationExpiry("not-a-time", 0)).toBe("unknown");
    expect(classifyAuthorizationExpiry("2026-10-14T11:59:59Z", Date.parse("2026-10-14T12:00:00Z"))).toBe("expired");
    expect(classifyAuthorizationExpiry("2026-10-14T12:00:01Z", Date.parse("2026-10-14T12:00:00Z"))).toBe("future");
    expect(authorizationExpiryPresentation(null, 0, value => value)).toEqual({ state: "unknown", label: "Expiry unknown" });
    expect(authorizationExpiryPresentation("2026-10-14T11:59:59Z", Date.parse("2026-10-14T12:00:00Z"), value => value)).toEqual({ state: "expired", label: "Expired" });
    expect(["azure", "gcp", "hf", "runpod", "tailscale"].every(supportsCloudObservations)).toBe(true);
    expect(supportsCloudObservations("wecom")).toBe(false);
    expect(safeOfficialRenewalUrl("http://login.example.test/authorize")).toBeNull();
    expect(safeOfficialRenewalUrl("https://user:secret@login.example.test/authorize")).toBeNull();
    expect(safeOfficialRenewalUrl("https://login.example.test/authorize?state=opaque")).toBe("https://login.example.test/authorize?state=opaque");
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
        sessionRef: "session-1", authorizationRef: "authorization-1", state: "WAITING_USER",
        createdAt: "2026-10-14T12:00:00Z", expiresAt: null,
        authorizationUrl: "https://login.example.test/authorize?state=opaque-state",
        qrAttachmentRef: "/native/private/qr.png", generation: 3,
      }, 202, { Location: "/api/v1/accounts/authorizations/authorization-1/renewal-sessions/session-1" });
    });
    const result = await client.beginRenewal("authorization-1", "renew-once");
    expect(result).not.toHaveProperty("qrAttachmentRef");
    expect(result.authorizationUrl).toContain("https://login.example.test/");
    expect(calls[0]?.path).toBe("/api/v1/accounts/authorizations/authorization-1/renewal-sessions");
    expect(new Headers(calls[0]?.init?.headers).get("Idempotency-Key")).toBe("renew-once");
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it("retains an explicit ambiguous provider-start reason without a renewal URL", async () => {
    const client = clientFor(async () => jsonResponse({
      sessionRef: "session-2", authorizationRef: "authorization-1", state: "VERIFYING",
      createdAt: "2026-10-14T12:00:00Z", expiresAt: null, authorizationUrl: null,
      reasonCode: "provider_start_outcome_unknown", generation: 4,
    }, 202, { Location: "/api/v1/accounts/authorizations/authorization-1/renewal-sessions/session-2" }));
    await expect(client.beginRenewal("authorization-1", "same-renewal-key")).resolves.toMatchObject({
      state: "VERIFYING", authorizationUrl: null, reasonCode: "provider_start_outcome_unknown",
    });
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
