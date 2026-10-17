import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const devHost = process.env.VITE_DEV_HOST ?? "127.0.0.1";
const devPort = Number(process.env.VITE_DEV_PORT ?? "5173");
const devAllowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const allowAllDevHosts = devAllowedHosts.includes("*");
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000";
const campusLabProxyTarget = process.env.VITE_CAMPUS_LAB_PROXY_TARGET ?? "http://127.0.0.1:8002";
const campusLabProxyKey = process.env.CAMPUS_LAB_PROXY_KEY ?? "";
const trustedProxyOrigin = `http://${devHost}:${devPort}`;
const backendProxy = {
  target: apiProxyTarget,
  changeOrigin: true,
  ws: true,
  // Phone browsers reach Vite through an HTTPS ngrok host. The browser request
  // is same-origin, but http-proxy otherwise forwards that public Origin to the
  // local API, whose development CORS policy correctly trusts only localhost.
  // Normalize only this private Vite -> API hop; production never uses Vite.
  headers: { Origin: trustedProxyOrigin },
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
    allowedHosts: allowAllDevHosts ? true : devAllowedHosts.length ? devAllowedHosts : undefined,
    // This repository lives in a macOS File Provider folder, where native file
    // events can be dropped. Polling makes every saved frontend edit reach HMR
    // reliably, including sessions connected through ngrok.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      "/api": backendProxy,
      "/healthz": backendProxy,
      "/metrics": backendProxy,
      "/readyz": backendProxy,
      "/release": backendProxy,
      ...(campusLabProxyKey ? {
        "/__campus-lab": {
          target: campusLabProxyTarget,
          changeOrigin: true,
          headers: { "X-Campus-Lab-Key": campusLabProxyKey },
          rewrite: (path: string) => path.replace(/^\/__campus-lab/u, ""),
        },
      } : {}),
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
