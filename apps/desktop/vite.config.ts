import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

// Renderer 源码在 src/renderer，主进程/preload 各自单独打包进 dist/main、dist/preload。
// main 进程直接 import 引擎底座（@linghun/tui 等），故引擎包不打进 renderer。
export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [
    react(),
    electron([
      {
        // 主进程
        entry: resolve(__dirname, "src/main/index.ts"),
        vite: {
          build: {
            outDir: resolve(__dirname, "dist/main"),
            rollupOptions: {
              // 引擎底座与 electron 走 Node require，不打包进 bundle
              external: [
                "electron",
                "@linghun/tui",
                "@linghun/core",
                "@linghun/config",
                "@linghun/providers",
                "@linghun/shared",
              ],
            },
          },
        },
      },
      {
        // preload：必须 CJS，contextBridge 才能在隔离上下文注入
        entry: resolve(__dirname, "src/preload/index.ts"),
        onstart({ reload }) {
          reload();
        },
        vite: {
          build: {
            outDir: resolve(__dirname, "dist/preload"),
            rollupOptions: { external: ["electron"] },
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
});
