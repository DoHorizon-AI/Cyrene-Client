import { defineConfig } from "@playwright/test";
const workerCount = process.env.STUDIO_E2E_WORKERS;
if (workerCount !== undefined && (!/^[1-9]\d*$/.test(workerCount) || !Number.isSafeInteger(Number(workerCount)))) {
  throw new Error("STUDIO_E2E_WORKERS must be a positive safe integer.");
}
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: workerCount === undefined ? undefined : Number(workerCount),
  use: { baseURL: "http://127.0.0.1:5181", viewport: { width: 1600, height: 1000 }, trace: "retain-on-failure", channel: process.env.STUDIO_BROWSER_CHANNEL || undefined },
  webServer: {
    command: "npm run dev:legacy -- --port 5181",
    url: "http://127.0.0.1:5181",
    reuseExistingServer: false,
    env: { STUDIO_CONTROL_DATA_DIR: `.studio/e2e-${process.pid}` },
    timeout: 30000,
  },
});
