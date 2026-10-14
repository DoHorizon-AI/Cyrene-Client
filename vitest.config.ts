import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "apps/web/src/products/**/*.test.ts",
      "apps/web/services/navigator/src/**/*.test.ts",
      "apps/web/services/catalyst/src/**/*.test.ts",
      "apps/web/services/echo/src/**/*.test.ts",
    ],
  },
});
