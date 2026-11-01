// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Aether real WSL browser acceptance config                   │
// │ Role: Run real Client→Navigator product flows with no mocked routes. │
// │ 中文：模块职责：执行不使用模拟路由的 Client→Navigator 真实验收。    │
// └─────────────────────────────────────────────────────────────────────┘

import { defineConfig } from "@playwright/test";

if (process.env.CYRENE_AETHER_REAL_ACCEPTANCE !== "1") {
  throw new Error("Set CYRENE_AETHER_REAL_ACCEPTANCE=1 to run the local real-service acceptance suite.");
}
if (process.env.CYRENE_AETHER_REAL_URL !== "http://127.0.0.1:18684") {
  throw new Error("Real acceptance is pinned to http://127.0.0.1:18684.");
}

export default defineConfig({
  testDir: "tests/e2e-real",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:18684",
    viewport: { width: 1600, height: 1000 },
    trace: "off",
    screenshot: "off",
    video: "off",
    channel: process.env.STUDIO_BROWSER_CHANNEL || undefined,
  },
});
