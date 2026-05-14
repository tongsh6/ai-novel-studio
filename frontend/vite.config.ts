import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.VITE_DEV_PORT) || 5768,
    strictPort: false,
    proxy: {
      "/api": {
        target: process.env.VITE_PROXY_TARGET || process.env.VITE_API_ENDPOINT || "http://localhost:4657",
        changeOrigin: true,
      },
      "/socket": {
        target: process.env.VITE_PROXY_TARGET || process.env.VITE_API_ENDPOINT || "http://localhost:4657",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
