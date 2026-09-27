import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/security-e2e", outputDir: ".studio/security-test-results", workers: 1,
  use: { baseURL: "http://localhost:5185", viewport: { width: 1600, height: 1000 }, trace: "retain-on-failure", channel: process.env.STUDIO_BROWSER_CHANNEL || undefined },
  webServer: { command: "npm run dev:legacy -- --host localhost --port 5185", url: "http://localhost:5185", reuseExistingServer: false,
    env: { VITE_WORKSPACE_BFF_ENABLED: "true", STUDIO_CONTROL_DATA_DIR: `.studio/security-e2e-${process.pid}` }, timeout: 30000 },
});
