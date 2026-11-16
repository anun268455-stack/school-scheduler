/// <reference types="node" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // base ตั้งผ่าน VITE_BASE_URL ตอน build สำหรับ GitHub Pages (เว็บนี้อยู่ใต้ /<repo>/workload/)
  base: process.env.VITE_BASE_URL ?? "/",
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
