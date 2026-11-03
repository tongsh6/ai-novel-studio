/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // 只收集前端源码测试。frontend/slice-verify/*.test.mjs 是外部验收脚本的自测，
    // 由验收流程单独驱动，不属于 pnpm test 的前端测试范围。
    include: ["src/**/*.test.{ts,tsx}"],
  },
  server: {
    host: process.env.VITE_DEV_HOST || "127.0.0.1",
    port: Number(process.env.VITE_DEV_PORT) || 5768,
    strictPort: false,
    proxy: {
      "/api": {
        target:
          process.env.VITE_PROXY_TARGET || process.env.VITE_API_ENDPOINT || "http://localhost:4657",
        changeOrigin: true,
      },
      "/socket": {
        target:
          process.env.VITE_PROXY_TARGET || process.env.VITE_API_ENDPOINT || "http://localhost:4657",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
