import { defineConfig } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/control",
  testDir: "tests/control-e2e", workers: 1,
  use: { baseURL: "http://127.0.0.1:5183", viewport: { width: 1600, height: 1000 }, channel: process.env.STUDIO_BROWSER_CHANNEL || undefined, trace: "retain-on-failure" },
  webServer: { command: "node --import tsx tests/fixtures/team-dev.ts", url: "http://127.0.0.1:5183/studio-team/v1/session", reuseExistingServer: false, timeout: 30000 },
});
