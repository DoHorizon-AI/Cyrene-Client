// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Aether real WSL browser acceptance config                   │
// │ Role: Run real Client→Navigator product flows with no mocked routes. │
// │ 中文：模块职责：执行不使用模拟路由的 Client→Navigator 真实验收。    │
// └─────────────────────────────────────────────────────────────────────┘

import { defineConfig } from "@playwright/test";

if (process.env.CYRENE_AETHER_REAL_ACCEPTANCE !== "1") {
  throw new Error("Set CYRENE_AETHER_REAL_ACCEPTANCE=1 to run the local real-service acceptance suite.");
}
// The browser origin is either the legacy single-origin Web Host or the Client dev
// server that fronts the Control BFF. Anything else stays rejected.
const allowedOrigins = new Set(["http://127.0.0.1:18684", "http://127.0.0.1:18694"]);
const realUrl = process.env.CYRENE_AETHER_REAL_URL ?? "";
if (!allowedOrigins.has(realUrl)) {
  throw new Error(`Real acceptance is pinned to ${[...allowedOrigins].join(" or ")}.`);
}

export default defineConfig({
  testDir: "tests/e2e-real",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: "line",
  use: {
    baseURL: realUrl,
    viewport: { width: 1600, height: 1000 },
    trace: "off",
    screenshot: "off",
    video: "off",
    channel: process.env.STUDIO_BROWSER_CHANNEL || undefined,
  },
});
