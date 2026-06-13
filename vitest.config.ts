import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@linghun/config": resolve(__dirname, "packages/config/src/index.ts"),
      "@linghun/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@linghun/ink-runtime": resolve(__dirname, "packages/ink-runtime/src/index.ts"),
      "@linghun/providers": resolve(__dirname, "packages/providers/src/index.ts"),
      "@linghun/shared": resolve(__dirname, "packages/shared/src/index.ts"),
      "@linghun/tools": resolve(__dirname, "packages/tools/src/index.ts"),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
});
