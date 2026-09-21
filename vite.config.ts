import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { admittedTarget, settingsBridge, settingsProxy } from "./tooling/settings-proxy";
import { serverControlBridge } from "./tooling/server-control";
import { pipelineControlBridge } from "./tooling/pipeline-control";

export default defineConfig(({ mode }) => {
  const target = admittedTarget(loadEnv(mode, process.cwd(), "").STUDIO_NAVIGATOR_URL);
  const proxy = settingsProxy(target);
  return {
    root: "apps/web",
    plugins: [react(), settingsBridge(target), serverControlBridge(process.env.STUDIO_CONTROL_DATA_DIR), pipelineControlBridge(process.env.STUDIO_CONTROL_DATA_DIR)],
    server: { host: "127.0.0.1", port: 5180, strictPort: true, proxy },
    preview: { host: "127.0.0.1", proxy },
    build: { outDir: "../../dist", emptyOutDir: true },
  };
});
