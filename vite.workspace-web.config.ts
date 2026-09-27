// Module: vite.workspace-web.config.ts
// Role: Build the primary Client web app as a separately packaged root-path site.
// 中文：模块职责：将 Client 主 Web 应用作为根路径独立站点构建。

import { defineConfig, mergeConfig, type UserConfig } from "vite";
import webConfig from "./vite.config";

export default defineConfig(async (environment) => {
  const baseConfig = typeof webConfig === "function"
    ? await webConfig(environment)
    : webConfig;

  return mergeConfig(baseConfig as UserConfig, {
    // The Nginx image serves this app at /, including the /device-approval deep link.
    // 中文：Nginx 镜像从 / 提供此应用，也包括 /device-approval 深层链接。
    base: "/",
    build: {
      outDir: "../../dist-workspace-web",
      emptyOutDir: true,
    },
  });
});
