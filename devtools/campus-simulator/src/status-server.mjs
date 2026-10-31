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

async function readControlRequest(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_024) throw new Error("Control request is too large.");
  }
  let parsed;
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    throw new Error("Control request must be valid JSON.");
  }
  if (typeof parsed.enabled !== "boolean" || Object.keys(parsed).some((key) => !["enabled", "clock_mode", "duration_seconds", "run_id"].includes(key))) {
    throw new Error("Control request must contain enabled and may contain a supported clock_mode.");
  }
  if (parsed.run_id !== undefined && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parsed.run_id)) {
    throw new Error("run_id must identify the server-created isolated Simulation run.");
  }
  if (parsed.clock_mode !== undefined && !["realtime", "1m", "15m", "60m"].includes(parsed.clock_mode)) {
    throw new Error("clock_mode must be realtime, 1m, 15m or 60m.");
  }
  if (parsed.duration_seconds !== undefined && ![60, 900, 3_600].includes(parsed.duration_seconds)) {
    throw new Error("duration_seconds must be 60, 900 or 3600.");
  }
  return parsed;
}

export async function startStatusServer({ port, proxyKey, getStatus, setControl, setEnabled, host = "127.0.0.1" }) {
  if (typeof getStatus !== "function") throw new Error("A status snapshot provider is required.");
  const server = createServer(async (request, response) => {
    if (!secureEqual(request.headers["x-campus-lab-key"], proxyKey)) {
      send(response, 401, { error: "Campus Lab status requires the local development proxy." });
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/control") {
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        send(response, 405, { error: "Campus Lab control requires POST." });
        return;
      }
      const updateControl = typeof setControl === "function" ? setControl : (typeof setEnabled === "function" ? ({ enabled }) => setEnabled(enabled) : null);
      if (!updateControl) {
        send(response, 503, { error: "Campus Lab control is unavailable." });
        return;
      }
      try {
        const control = await readControlRequest(request);
        send(response, 200, await updateControl(control));
      } catch (error) {
        send(response, 400, { error: error instanceof Error ? error.message : "Invalid control request." });
      }
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("allow", "GET");
      send(response, 405, { error: "The Campus Lab status service is read-only except for its explicit control endpoint." });
      return;
    }
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
