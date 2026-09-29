import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Desktop staff dashboard. Runs beside the mobile app (5173) and shares the same API.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/staff/" : "/",
  plugins: [react()],
  // Keep lazy chunks available to already-open local sessions across a rebuild.
  build: { emptyOutDir: false },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true },
}));
