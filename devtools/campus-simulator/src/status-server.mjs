import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

function secureEqual(left, right) {
  const first = Buffer.from(String(left ?? ""));
  const second = Buffer.from(String(right ?? ""));
  return first.length === second.length && first.length > 0 && timingSafeEqual(first, second);
}

function send(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

export async function startStatusServer({ port, proxyKey, getStatus, host = "127.0.0.1" }) {
  if (typeof getStatus !== "function") throw new Error("A status snapshot provider is required.");
  const server = createServer((request, response) => {
    if (!secureEqual(request.headers["x-campus-lab-key"], proxyKey)) {
      send(response, 401, { error: "Campus Lab status requires the local development proxy." });
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("allow", "GET");
      send(response, 405, { error: "The Campus Lab status service is read-only." });
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const snapshot = getStatus();
    if (pathname === "/status") {
      send(response, 200, snapshot);
      return;
    }
    if (pathname === "/healthz") {
      send(response, 200, { ok: true, status: snapshot.status, generated_at: snapshot.generated_at });
      return;
    }
    if (pathname === "/readyz") {
      send(response, snapshot.status === "running" ? 200 : 503, {
        ready: snapshot.status === "running",
        status: snapshot.status,
        generated_at: snapshot.generated_at,
      });
      return;
    }
    send(response, 404, { error: "Not found." });
  });
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 6_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

export const statusServerInternals = { secureEqual };
