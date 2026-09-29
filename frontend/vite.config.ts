import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const devHost = process.env.VITE_DEV_HOST ?? "127.0.0.1";
const devPort = Number(process.env.VITE_DEV_PORT ?? "5173");
const devAllowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000";
const backendProxy = {
  target: apiProxyTarget,
  changeOrigin: true,
  ws: true,
};

export default defineConfig({
  plugins: [react()],
  // Open sessions may still lazy-load a previous build's content-addressed chunks.
  // Keep those files during local rebuilds; release images start from a clean workspace.
  build: { emptyOutDir: false },
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    allowedHosts: devAllowedHosts.length ? devAllowedHosts : undefined,
    proxy: {
      "/api": backendProxy,
      "/healthz": backendProxy,
      "/metrics": backendProxy,
      "/readyz": backendProxy,
      "/release": backendProxy,
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
