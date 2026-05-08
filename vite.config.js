import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/xlsx")) return "xlsx";
          if (id.includes("node_modules")) return "vendor";
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ["xlsx", "xlsx/xlsx.mjs"],
  },
  server: {
    host: process.env.HOST || "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.VITE_API_PORT || "4000"}`,
        changeOrigin: true,
      },
      "/manifest.webmanifest": {
        target: `http://127.0.0.1:${process.env.VITE_API_PORT || "4000"}`,
        changeOrigin: true,
      },
      "/app-icon.svg": {
        target: `http://127.0.0.1:${process.env.VITE_API_PORT || "4000"}`,
        changeOrigin: true,
      },
      "/app-maskable.svg": {
        target: `http://127.0.0.1:${process.env.VITE_API_PORT || "4000"}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/release/**",
    ],
  },
});
