// -----------------------------------------------------------------------------
// Module: src/router.test.ts
// Role: Route resolution tests for the Cyrene client navigation rail.
// -----------------------------------------------------------------------------
// 中文：模块职责：测试 Cyrene 客户端导航栏与服务的路由解析。

import { pathForRoute, routeForPath } from "./router";
import { describe, expect, it } from "vitest";

describe("Cyrene routes", () => {
  it("resolves all canonical routes with flow as default", () => {
    expect(routeForPath("/")).toBe("flow");
    expect(routeForPath("/flow")).toBe("flow");
    expect(routeForPath("/catalyst")).toBe("catalyst");
    expect(routeForPath("/yield")).toBe("yield");
    expect(routeForPath("/echo")).toBe("echo");
    expect(routeForPath("/reactor")).toBe("reactor");
    expect(routeForPath("/exchange")).toBe("exchange");
    expect(routeForPath("/navigator")).toBe("navigator");
    expect(routeForPath("/integrations")).toBe("integrations");
    expect(routeForPath("/settings")).toBe("settings");
  });

  it("resolves legacy and alias routes gracefully", () => {
    expect(routeForPath("/datasets")).toBe("catalyst");
    expect(routeForPath("/training")).toBe("yield");
    expect(routeForPath("/runs?runId=run-1")).toBe("yield");
    expect(routeForPath("/runs/run-1")).toBe("yield");
    expect(routeForPath("/models")).toBe("reactor");
    expect(routeForPath("/deployments")).toBe("reactor");
    expect(routeForPath("/gateway")).toBe("exchange");
    expect(routeForPath("/chat")).toBe("navigator");
  });

  it("keeps unknown paths on the flow canvas surface", () => {
    expect(routeForPath("/not-a-page")).toBe("flow");
  });

  it("returns canonical paths for route ids", () => {
    expect(pathForRoute("flow")).toBe("/");
    expect(pathForRoute("catalyst")).toBe("/catalyst");
    expect(pathForRoute("yield")).toBe("/yield");
    expect(pathForRoute("echo")).toBe("/echo");
    expect(pathForRoute("reactor")).toBe("/reactor");
    expect(pathForRoute("exchange")).toBe("/exchange");
    expect(pathForRoute("navigator")).toBe("/navigator");
    expect(pathForRoute("integrations")).toBe("/integrations");
    expect(pathForRoute("settings")).toBe("/settings");
  });
});
