/// <reference types="node" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // base is set via VITE_BASE_URL env var for GitHub Pages (e.g. /repo-name/)
  base: process.env.VITE_BASE_URL ?? "/",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
