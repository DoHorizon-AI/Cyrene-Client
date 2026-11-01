// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Assistant Navigator supervisor tests                        │
// │ Role: Verify supported args and graceful signal-based shutdown.     │
// │ 中文：模块职责：验证Navigator参数兼容性与信号优雅关闭。            │
// └─────────────────────────────────────────────────────────────────────┘

import { expect, it } from "vitest";
import { createNavigatorServeArgs, requestNavigatorShutdown } from "../../scripts/assistant-process.mjs";

it("uses supported serve-local arguments without the removed stdin flag", () => {
  const args = createNavigatorServeArgs({
    prefix: [],
    scriptPath: "/navigator/scripts/serve-local.py",
    stateDir: "/state/navigator",
    host: "127.0.0.1",
    port: 18680,
    persistencePort: 18681,
    publicUrl: "http://127.0.0.1:18684",
    workspaceId: "local",
    organizationId: "cyrene-aether-local",
    actorId: "aether-local-acceptance",
    principalTokenEnv: "CYRENE_SESSION_TOKEN",
    principalConfig: "/state/local-product/navigator-principals.json",
  });

  expect(args).toContain("/navigator/scripts/serve-local.py");
  expect(args).toContain("--principal-config");
  expect(args).toContain("/state/local-product/navigator-principals.json");
  expect(args).not.toContain("--shutdown-stdin");
});

it("asks the Navigator supervisor to shut down through its signal handler", () => {
  const signals: string[] = [];
  const child = { kill: (signal: "SIGTERM") => { signals.push(signal); return true; } };

  expect(requestNavigatorShutdown(child)).toBe(true);
  expect(signals).toEqual(["SIGTERM"]);
});
