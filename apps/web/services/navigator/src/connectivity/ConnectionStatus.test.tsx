import { describe, expect, it, vi } from "vitest";
import { probeConnection, type ConnectionHealth } from "./ConnectionStatus";
import type { NavigatorApi, SystemStatus } from "../api";

describe("ConnectionStatus", () => {
  it("probes successfully when healthz and system status return healthy", async () => {
    // Mock global fetch for healthz
    const origFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    const mockApi = {
      getSystemStatus: vi.fn().mockResolvedValue({
        service: "cyrene-exchange",
        status: "OK",
        version: "0.1.0",
        authenticated: true,
        proxyPrefixes: [],
        credentials: { active: 1, revoked: 0 },
        observedAt: new Date().toISOString(),
      } as SystemStatus),
    } as unknown as NavigatorApi;

    try {
      const result: ConnectionHealth = await probeConnection(mockApi);
      expect(result.state).toBe("CONNECTED");
      expect(result.latencyMs).toBeTypeOf("number");
      expect(result.endpoints.length).toBeGreaterThanOrEqual(2);
      expect(result.endpoints.find((e) => e.id === "edge")?.status).toBe("UP");
      expect(result.endpoints.find((e) => e.id === "exchange")?.status).toBe("UP");
    } finally {
      global.fetch = origFetch;
    }
  });

  it("reports DEGRADED when only edge healthz is reachable", async () => {
    const origFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    const mockApi = {
      getSystemStatus: vi.fn().mockRejectedValue(new Error("Network Error")),
    } as unknown as NavigatorApi;

    try {
      const result: ConnectionHealth = await probeConnection(mockApi);
      expect(result.state).toBe("DEGRADED");
      expect(result.endpoints.find((e) => e.id === "edge")?.status).toBe("UP");
      expect(result.endpoints.find((e) => e.id === "exchange")?.status).toBe("DOWN");
    } finally {
      global.fetch = origFetch;
    }
  });

  it("reports DISCONNECTED when edge healthz and API are both unreachable", async () => {
    const origFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error("Host Unreachable"));

    const mockApi = {
      getSystemStatus: vi.fn().mockRejectedValue(new Error("Host Unreachable")),
    } as unknown as NavigatorApi;

    try {
      const result: ConnectionHealth = await probeConnection(mockApi);
      expect(result.state).toBe("DISCONNECTED");
      expect(result.latencyMs).toBeNull();
      expect(result.endpoints.find((e) => e.id === "edge")?.status).toBe("DOWN");
    } finally {
      global.fetch = origFetch;
    }
  });
});
