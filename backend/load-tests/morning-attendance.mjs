#!/usr/bin/env node

import { setTimeout as sleep } from "node:timers/promises";

const HARD_LIMITS = Object.freeze({
  virtualUsers: 200,
  sessions: 200,
  authConcurrency: 10,
  durationSeconds: 300,
  requestsPerSecond: 500,
  maxRequests: 50_000,
  requestTimeoutMs: 60_000,
  responseBytes: 50 * 1024 * 1024,
  sseConnections: 100,
  sseDurationSeconds: 300,
  sseBytesPerConnection: 100 * 1024 * 1024,
});

const SAFE_GET_PATHS = new Set([
  "/api/v1/auth/csrf/",
  "/api/v1/screens/teacher/home/",
  "/api/v1/screens/teacher/attendance/",
  "/api/v1/events/stream/",
]);
const SAFE_POST_PATHS = new Set(["/api/v1/auth/login/"]);
const USER_AGENT = "OmniSchoolMorningAttendanceReadLoadTest/1.0";

const HELP = `OmniSchool morning-attendance read load test

Usage:
  TEACHER_IDENTIFIER=... TEACHER_PASSWORD=... \\
    node backend/load-tests/morning-attendance.mjs

Options:
  --help         Show this help without reading credentials or sending traffic.
  --dry-run      Validate configuration and print the sanitized plan; send no traffic.

Core environment variables:
  TARGET_URL                 API origin (default: http://127.0.0.1:8000)
  ALLOW_NON_LOCAL_TARGET     Must be true for a non-loopback HTTPS origin
  TEACHER_IDENTIFIER         Required staff/admin username or email (never printed)
  TEACHER_PASSWORD           Required password (never printed)
  VIRTUAL_USERS              Concurrent read workers (default: 10, max: 200)
  SESSION_COUNT              Login sessions shared by workers (default: min(VUs, 4))
  AUTH_CONCURRENCY           Concurrent logins (default: 2, max: 10)
  DURATION_SECONDS           Read phase duration (default: 30, max: 300)
  REQUESTS_PER_SECOND        Aggregate target start rate (default: 20, max: 500)
  MAX_REQUESTS               Absolute read-request cap (default: 10000, max: 50000)
  REQUEST_TIMEOUT_MS         Per-read timeout (default: 10000, max: 60000)
  DATE                       Optional YYYY-MM-DD; otherwise use the API school date
  CLASS_SECTION_ID           Optional class UUID; otherwise use first home-screen class
  HOME_WEIGHT                Relative teacher-home share (default: 1)
  REGISTER_WEIGHT            Relative attendance-register share (default: 3)
  SSE_CONNECTIONS            Optional SSE sockets (default: 0, max: 100)
  SSE_DURATION_SECONDS       SSE soak duration (default: DURATION_SECONDS, max: 300)
  MAX_ERROR_RATE             Failure threshold, 0..1 (default: 0.01)
  OUTPUT_FORMAT              text or json (default: text)

Only CSRF, login, teacher-home, teacher-attendance register, and SSE endpoints are
allowlisted in the program. The harness never submits, locks, unlocks, corrects,
or otherwise mutates attendance.
`;

class HarnessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
  }
}

class CookieJar {
  #cookies = [];

  constructor(origin) {
    this.origin = new URL(origin);
  }

  capture(headers, responseUrl = this.origin) {
    const source = responseUrl instanceof URL ? responseUrl : new URL(responseUrl);
    for (const setCookie of getSetCookieValues(headers)) {
      const [pair, ...attributes] = setCookie.split(";");
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const parsedAttributes = new Map();
      const flags = new Set();
      for (const rawAttribute of attributes) {
        const attribute = rawAttribute.trim();
        const attributeSeparator = attribute.indexOf("=");
        if (attributeSeparator < 0) flags.add(attribute.toLowerCase());
        else parsedAttributes.set(
          attribute.slice(0, attributeSeparator).trim().toLowerCase(),
          attribute.slice(attributeSeparator + 1).trim(),
        );
      }
      const rawDomain = parsedAttributes.get("domain");
      const domain = (rawDomain || source.hostname).toLowerCase().replace(/^\./, "");
      const hostOnly = !rawDomain;
      if (!domainMatches(source.hostname, domain, hostOnly)) continue;
      const rawPath = parsedAttributes.get("path");
      const path = rawPath?.startsWith("/") ? rawPath : defaultCookiePath(source.pathname);
      const maxAge = parsedAttributes.has("max-age") ? Number(parsedAttributes.get("max-age")) : undefined;
      const expiresValue = parsedAttributes.get("expires");
      const parsedExpires = expiresValue ? Date.parse(expiresValue) : Number.NaN;
      const expiresAt = Number.isFinite(maxAge)
        ? Date.now() + maxAge * 1_000
        : Number.isNaN(parsedExpires) ? undefined : parsedExpires;
      const keyMatches = (cookie) => cookie.name === name && cookie.domain === domain && cookie.path === path;
      this.#cookies = this.#cookies.filter((cookie) => !keyMatches(cookie));
      if (value === "" || (Number.isFinite(maxAge) && maxAge <= 0) || (expiresAt !== undefined && expiresAt <= Date.now())) continue;
      this.#cookies.push({ name, value, domain, hostOnly, path, secure: flags.has("secure"), expiresAt });
    }
  }

  get(name, requestUrl = this.origin) {
    return this.#matching(requestUrl).find((cookie) => cookie.name === name)?.value;
  }

  header(requestUrl = this.origin) {
    return this.#matching(requestUrl).map(({ name, value }) => `${name}=${value}`).join("; ");
  }

  #matching(requestUrl) {
    const target = requestUrl instanceof URL ? requestUrl : new URL(requestUrl);
    const now = Date.now();
    this.#cookies = this.#cookies.filter((cookie) => cookie.expiresAt === undefined || cookie.expiresAt > now);
    return this.#cookies
      .filter((cookie) => domainMatches(target.hostname, cookie.domain, cookie.hostOnly))
      .filter((cookie) => pathMatches(target.pathname, cookie.path))
      .filter((cookie) => !cookie.secure || target.protocol === "https:")
      .sort((left, right) => right.path.length - left.path.length);
  }
}

class Metrics {
  #endpoints = new Map();

  record(endpoint, { elapsedMs, status, bytes = 0, error }) {
    let metric = this.#endpoints.get(endpoint);
    if (!metric) {
      metric = {
        endpoint,
        count: 0,
        succeeded: 0,
        httpFailed: 0,
        transportFailed: 0,
        bytes: 0,
        latencies: [],
        statuses: new Map(),
        errors: new Map(),
      };
      this.#endpoints.set(endpoint, metric);
    }
    metric.count += 1;
    metric.bytes += bytes;
    if (Number.isFinite(elapsedMs)) metric.latencies.push(elapsedMs);
    if (status !== undefined) {
      metric.statuses.set(String(status), (metric.statuses.get(String(status)) ?? 0) + 1);
      if (status >= 200 && status < 300 && !error) metric.succeeded += 1;
      else metric.httpFailed += 1;
    } else {
      metric.transportFailed += 1;
    }
    if (error) metric.errors.set(error, (metric.errors.get(error) ?? 0) + 1);
  }

  snapshot(prefix) {
    return [...this.#endpoints.values()]
      .filter((metric) => prefix === undefined || metric.endpoint.startsWith(prefix))
      .sort((left, right) => left.endpoint.localeCompare(right.endpoint))
      .map(summarizeMetric);
  }

  totals(prefix) {
    const metrics = this.snapshot(prefix);
    return metrics.reduce((total, metric) => ({
      requests: total.requests + metric.requests,
      succeeded: total.succeeded + metric.succeeded,
      failed: total.failed + metric.failed,
      bytes: total.bytes + metric.bytes,
    }), { requests: 0, succeeded: 0, failed: 0, bytes: 0 });
  }
}

class SseMetrics {
  constructor(attempted) {
    this.attempted = attempted;
    this.connected = 0;
    this.bytes = 0;
    this.frames = 0;
    this.events = 0;
    this.heartbeats = 0;
    this.statuses = new Map();
    this.errors = new Map();
    this.failedConnections = new Set();
    this.connectLatencies = [];
    this.lifetimes = [];
  }

  status(connectionId, status, elapsedMs, accepted) {
    this.statuses.set(String(status), (this.statuses.get(String(status)) ?? 0) + 1);
    this.connectLatencies.push(elapsedMs);
    if (accepted) this.connected += 1;
    else this.failedConnections.add(connectionId);
  }

  error(connectionId, code) {
    this.errors.set(code, (this.errors.get(code) ?? 0) + 1);
    this.failedConnections.add(connectionId);
  }

  snapshot() {
    return {
      attempted: this.attempted,
      connected: this.connected,
      failed: this.failedConnections.size,
      statuses: mapObject(this.statuses),
      errors: mapObject(this.errors),
      connect_latency_ms: latencySummary(this.connectLatencies),
      lifetime_ms: latencySummary(this.lifetimes),
      bytes: this.bytes,
      frames: this.frames,
      events: this.events,
      heartbeats: this.heartbeats,
    };
  }
}

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,\s]+=)/);
}

function defaultCookiePath(pathname) {
  if (!pathname.startsWith("/") || pathname === "/") return "/";
  const finalSlash = pathname.lastIndexOf("/");
  return finalSlash <= 0 ? "/" : pathname.slice(0, finalSlash);
}

function domainMatches(hostname, domain, hostOnly) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const normalizedDomain = domain.toLowerCase().replace(/^\[|\]$/g, "");
  return hostOnly ? host === normalizedDomain : host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
}

function pathMatches(pathname, cookiePath) {
  if (pathname === cookiePath) return true;
  if (!pathname.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || pathname.charAt(cookiePath.length) === "/";
}

function envInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new HarnessError("invalid_config", `${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new HarnessError("invalid_config", `${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function envNumber(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(raw)) throw new HarnessError("invalid_config", `${name} must be a number.`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HarnessError("invalid_config", `${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function envBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw.toLowerCase() === "true") return true;
  if (raw.toLowerCase() === "false") return false;
  throw new HarnessError("invalid_config", `${name} must be true or false.`);
}

function isLoopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  if (!/^127(?:\.\d{1,3}){3}$/.test(host)) return false;
  return host.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function loadConfig() {
  let target;
  try {
    target = new URL(process.env.TARGET_URL || "http://127.0.0.1:8000");
  } catch {
    throw new HarnessError("invalid_config", "TARGET_URL must be a valid absolute URL.");
  }
  if (!new Set(["http:", "https:"]).has(target.protocol)) {
    throw new HarnessError("invalid_config", "TARGET_URL must use HTTP or HTTPS.");
  }
  if (target.username || target.password || target.search || target.hash || !["", "/"].includes(target.pathname)) {
    throw new HarnessError("invalid_config", "TARGET_URL must be an origin only, without credentials, path, query, or fragment.");
  }
  const local = isLoopback(target.hostname);
  const allowNonLocal = envBoolean("ALLOW_NON_LOCAL_TARGET");
  if (!local && !allowNonLocal) {
    throw new HarnessError(
      "remote_target_refused",
      "Refusing a non-loopback target. Set ALLOW_NON_LOCAL_TARGET=true only after obtaining authorization.",
    );
  }
  if (!local && target.protocol !== "https:") {
    throw new HarnessError("remote_http_refused", "Non-loopback targets must use HTTPS so credentials are not sent in clear text.");
  }

  const identifier = process.env.TEACHER_IDENTIFIER?.trim();
  const password = process.env.TEACHER_PASSWORD;
  if (!identifier) throw new HarnessError("missing_credentials", "TEACHER_IDENTIFIER is required.");
  if (!password) throw new HarnessError("missing_credentials", "TEACHER_PASSWORD is required.");

  const virtualUsers = envInteger("VIRTUAL_USERS", 10, 1, HARD_LIMITS.virtualUsers);
  const sessions = envInteger("SESSION_COUNT", Math.min(virtualUsers, 4), 1, HARD_LIMITS.sessions);
  if (sessions > virtualUsers) throw new HarnessError("invalid_config", "SESSION_COUNT cannot exceed VIRTUAL_USERS.");
  const authConcurrency = envInteger("AUTH_CONCURRENCY", Math.min(sessions, 2), 1, HARD_LIMITS.authConcurrency);
  const durationSeconds = envNumber("DURATION_SECONDS", 30, 1, HARD_LIMITS.durationSeconds);
  const requestsPerSecond = envNumber("REQUESTS_PER_SECOND", 20, 0.1, HARD_LIMITS.requestsPerSecond);
  const maxRequests = envInteger("MAX_REQUESTS", 10_000, 1, HARD_LIMITS.maxRequests);
  const requestTimeoutMs = envInteger("REQUEST_TIMEOUT_MS", 10_000, 100, HARD_LIMITS.requestTimeoutMs);
  const maxResponseBytes = envInteger("MAX_RESPONSE_BYTES", 5 * 1024 * 1024, 1_024, HARD_LIMITS.responseBytes);
  const homeWeight = envInteger("HOME_WEIGHT", 1, 0, 100);
  const registerWeight = envInteger("REGISTER_WEIGHT", 3, 0, 100);
  if (homeWeight + registerWeight === 0) throw new HarnessError("invalid_config", "At least one read weight must be greater than zero.");
  const date = process.env.DATE?.trim() || undefined;
  if (date && !isIsoDate(date)) throw new HarnessError("invalid_config", "DATE must be a real calendar date in YYYY-MM-DD format.");
  const classSectionId = process.env.CLASS_SECTION_ID?.trim() || undefined;
  const sseConnections = envInteger("SSE_CONNECTIONS", 0, 0, HARD_LIMITS.sseConnections);
  if (sseConnections > sessions) {
    throw new HarnessError("invalid_config", "SSE_CONNECTIONS cannot exceed SESSION_COUNT; this harness uses at most one SSE socket per session.");
  }
  const sseDurationSeconds = envNumber("SSE_DURATION_SECONDS", durationSeconds, 1, HARD_LIMITS.sseDurationSeconds);
  const sseBytesPerConnection = envInteger(
    "SSE_MAX_BYTES_PER_CONNECTION",
    10 * 1024 * 1024,
    1_024,
    HARD_LIMITS.sseBytesPerConnection,
  );
  const maxErrorRate = envNumber("MAX_ERROR_RATE", 0.01, 0, 1);
  const outputFormat = (process.env.OUTPUT_FORMAT || "text").toLowerCase();
  if (!new Set(["text", "json"]).has(outputFormat)) {
    throw new HarnessError("invalid_config", "OUTPUT_FORMAT must be text or json.");
  }

  return {
    origin: target.origin,
    local,
    identifier,
    password,
    virtualUsers,
    sessions,
    authConcurrency,
    durationSeconds,
    requestsPerSecond,
    maxRequests,
    requestTimeoutMs,
    maxResponseBytes,
    homeWeight,
    registerWeight,
    date,
    classSectionId,
    sseConnections,
    sseDurationSeconds,
    sseBytesPerConnection,
    maxErrorRate,
    outputFormat,
  };
}

function safeUrl(origin, path) {
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new HarnessError("unsafe_request", "Refusing a request outside TARGET_URL.");
  return url;
}

function assertAllowlisted(url, method) {
  const normalizedMethod = method.toUpperCase();
  const allowed = normalizedMethod === "GET"
    ? SAFE_GET_PATHS.has(url.pathname)
    : normalizedMethod === "POST" && SAFE_POST_PATHS.has(url.pathname);
  if (!allowed) {
    throw new HarnessError("unsafe_request", `Refusing non-allowlisted ${normalizedMethod} request to ${url.pathname}.`);
  }
}

function errorCode(error, timedOut, interrupted) {
  if (timedOut) return "timeout";
  if (interrupted) return "interrupted";
  if (error instanceof HarnessError) return error.code;
  if (error?.name === "AbortError") return "aborted";
  if (error instanceof TypeError) return "network_error";
  return "request_error";
}

async function readBodyLimited(response, maximumBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new HarnessError("body_too_large", "Response exceeded MAX_RESPONSE_BYTES.");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HarnessError("body_too_large", "Response exceeded MAX_RESPONSE_BYTES.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function measuredRequest(session, config, metrics, endpoint, path, init, runSignal) {
  const method = (init?.method || "GET").toUpperCase();
  const url = safeUrl(config.origin, path);
  assertAllowlisted(url, method);
  const controller = new AbortController();
  let timedOut = false;
  let status;
  let bytes = 0;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.requestTimeoutMs);
  const onRunAbort = () => controller.abort();
  runSignal?.addEventListener("abort", onRunAbort, { once: true });
  const startedAt = performance.now();
  try {
    const headers = new Headers(init?.headers);
    headers.set("Accept", headers.get("Accept") || "application/json");
    headers.set("User-Agent", USER_AGENT);
    headers.set("Cache-Control", "no-cache");
    const cookie = session.jar.header(url);
    if (cookie) headers.set("Cookie", cookie);
    if (method === "POST") {
      const csrfToken = session.jar.get("csrftoken", url);
      if (!csrfToken) throw new HarnessError("csrf_missing", "CSRF cookie was not established before login.");
      headers.set("X-CSRFToken", csrfToken);
      headers.set("Origin", config.origin);
      headers.set("Referer", `${config.origin}/`);
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(url, {
      ...init,
      method,
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
    status = response.status;
    session.jar.capture(response.headers, url);
    const body = await readBodyLimited(response, config.maxResponseBytes);
    bytes = body.byteLength;
    const httpError = response.ok ? undefined : `http_${response.status}`;
    metrics.record(endpoint, { elapsedMs: performance.now() - startedAt, status, bytes, error: httpError });
    return { ok: response.ok, status, body, error: httpError };
  } catch (error) {
    const code = errorCode(error, timedOut, Boolean(runSignal?.aborted));
    metrics.record(endpoint, { elapsedMs: performance.now() - startedAt, status, bytes, error: code });
    return { ok: false, status, body: new Uint8Array(), error: code };
  } finally {
    clearTimeout(timeout);
    runSignal?.removeEventListener("abort", onRunAbort);
  }
}

function parseJson(result, endpoint) {
  if (!result.ok) throw new HarnessError("setup_request_failed", `${endpoint} failed (${result.error || "unknown_error"}).`);
  try {
    return JSON.parse(new TextDecoder().decode(result.body));
  } catch {
    throw new HarnessError("invalid_json", `${endpoint} did not return valid JSON.`);
  }
}

async function authenticateSession(config, metrics, runSignal) {
  const session = { jar: new CookieJar(config.origin) };
  const csrf = await measuredRequest(
    session,
    config,
    metrics,
    "setup.csrf",
    "/api/v1/auth/csrf/",
    { method: "GET" },
    runSignal,
  );
  parseJson(csrf, "CSRF request");
  if (!session.jar.get("csrftoken", safeUrl(config.origin, "/api/v1/auth/login/"))) {
    throw new HarnessError("csrf_missing", "CSRF endpoint did not set a cookie usable by the login endpoint.");
  }
  const login = await measuredRequest(
    session,
    config,
    metrics,
    "setup.login",
    "/api/v1/auth/login/",
    { method: "POST", body: JSON.stringify({ identifier: config.identifier, password: config.password }) },
    runSignal,
  );
  const identity = parseJson(login, "Login");
  if (!identity?.user || !new Set(["staff", "admin"]).has(identity.user.role)) {
    throw new HarnessError("wrong_role", "Credentials must belong to an active staff or admin account.");
  }
  return session;
}

async function createSessions(config, metrics, runSignal) {
  const sessions = new Array(config.sessions);
  let next = 0;
  let firstError;
  const workers = Array.from({ length: Math.min(config.authConcurrency, config.sessions) }, async () => {
    while (!firstError) {
      const index = next++;
      if (index >= sessions.length) return;
      try {
        sessions[index] = await authenticateSession(config, metrics, runSignal);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.all(workers);
  if (firstError !== undefined) {
    const code = firstError instanceof HarnessError ? firstError.code : "authentication_failed";
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    throw new HarnessError(code, message);
  }
  return sessions;
}

function homePath(date) {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  return `/api/v1/screens/teacher/home/${query.size ? `?${query.toString()}` : ""}`;
}

function registerPath(classSectionId, date) {
  const query = new URLSearchParams({ class_section_id: classSectionId, date });
  return `/api/v1/screens/teacher/attendance/?${query.toString()}`;
}

async function discoverRegister(session, config, metrics, runSignal) {
  const result = await measuredRequest(
    session,
    config,
    metrics,
    "setup.teacher_home",
    homePath(config.date),
    { method: "GET" },
    runSignal,
  );
  const home = parseJson(result, "Teacher home discovery");
  const date = config.date || home?.date;
  if (!date || !isIsoDate(date)) throw new HarnessError("invalid_discovery", "Teacher home did not return a valid school date.");
  const classSectionId = config.classSectionId || home?.classes?.[0]?.class_section_id;
  if (config.registerWeight > 0 && !classSectionId) {
    throw new HarnessError(
      "class_not_found",
      "No assigned class was returned for this date. Set CLASS_SECTION_ID or choose a teaching day.",
    );
  }
  return { date, classSectionId };
}

async function preflightRegister(session, config, selection, metrics, runSignal) {
  if (config.registerWeight === 0) return;
  const result = await measuredRequest(
    session,
    config,
    metrics,
    "setup.attendance_register",
    registerPath(selection.classSectionId, selection.date),
    { method: "GET" },
    runSignal,
  );
  parseJson(result, "Attendance register preflight");
}

function chooseRead(index, config) {
  const slot = index % (config.homeWeight + config.registerWeight);
  return slot < config.homeWeight ? "home" : "register";
}

async function runReadLoad(sessions, config, selection, metrics, runSignal) {
  const plannedRequests = Math.min(config.maxRequests, Math.ceil(config.durationSeconds * config.requestsPerSecond));
  const intervalMs = 1_000 / config.requestsPerSecond;
  const startedAt = performance.now();
  const deadline = startedAt + config.durationSeconds * 1_000;
  let next = 0;
  let nextStartAt = startedAt;

  const workers = Array.from({ length: config.virtualUsers }, (_, workerIndex) => (async () => {
    const session = sessions[workerIndex % sessions.length];
    while (!runSignal.aborted) {
      const index = next++;
      if (index >= plannedRequests) return;
      // If all workers were busy, resume from "now" rather than replaying an
      // accumulated backlog as a catch-up burst.
      const scheduledAt = Math.max(nextStartAt, performance.now());
      nextStartAt = scheduledAt + intervalMs;
      if (scheduledAt >= deadline) return;
      const waitMs = scheduledAt - performance.now();
      if (waitMs > 0) {
        await sleep(waitMs, undefined, { signal: runSignal }).catch(() => undefined);
        if (runSignal.aborted) return;
      }
      const actualStart = performance.now();
      if (actualStart >= deadline) return;
      // Timers delayed by an event-loop stall are discarded, not replayed.
      if (actualStart - scheduledAt > intervalMs) continue;
      const read = chooseRead(index, config);
      if (read === "home") {
        await measuredRequest(
          session,
          config,
          metrics,
          "read.teacher_home",
          homePath(selection.date),
          { method: "GET" },
          runSignal,
        );
      } else {
        await measuredRequest(
          session,
          config,
          metrics,
          "read.attendance_register",
          registerPath(selection.classSectionId, selection.date),
          { method: "GET" },
          runSignal,
        );
      }
    }
  })());

  await Promise.all(workers);
  return {
    elapsedMs: performance.now() - startedAt,
    plannedRequests,
    scheduledWindowMs: Math.min(config.durationSeconds * 1_000, plannedRequests * intervalMs),
  };
}

function startSseConnection(connectionId, session, config, metrics, stopSignal, runSignal) {
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const done = (async () => {
    const url = safeUrl(config.origin, "/api/v1/events/stream/");
    assertAllowlisted(url, "GET");
    const controller = new AbortController();
    let connectTimedOut = false;
    let connected = false;
    let readyResolved = false;
    const startedAt = performance.now();
    const connectTimeout = setTimeout(() => {
      connectTimedOut = true;
      controller.abort();
    }, config.requestTimeoutMs);
    const stop = () => controller.abort();
    stopSignal.addEventListener("abort", stop, { once: true });
    runSignal.addEventListener("abort", stop, { once: true });
    try {
      const headers = new Headers({
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        "User-Agent": USER_AGENT,
      });
      const cookie = session.jar.header(url);
      if (cookie) headers.set("Cookie", cookie);
      const response = await fetch(url, { method: "GET", headers, redirect: "manual", signal: controller.signal });
      clearTimeout(connectTimeout);
      session.jar.capture(response.headers, url);
      const contentType = response.headers.get("content-type") || "";
      const accepted = response.status === 200 && /^text\/event-stream(?:\s*;|\s*$)/i.test(contentType) && Boolean(response.body);
      metrics.status(connectionId, response.status, performance.now() - startedAt, accepted);
      if (!response.ok) {
        metrics.error(connectionId, `http_${response.status}`);
        resolveReady(false);
        readyResolved = true;
        response.body?.cancel().catch(() => undefined);
        return;
      }
      if (!accepted) {
        metrics.error(connectionId, response.body ? "invalid_content_type" : "missing_body");
        resolveReady(false);
        readyResolved = true;
        response.body?.cancel().catch(() => undefined);
        return;
      }
      connected = true;
      resolveReady(true);
      readyResolved = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let totalBytes = 0;
      try {
        while (!stopSignal.aborted && !runSignal.aborted) {
          const next = await reader.read();
          if (next.done) {
            if (!stopSignal.aborted && !runSignal.aborted) metrics.error(connectionId, "unexpected_eof");
            break;
          }
          totalBytes += next.value.byteLength;
          metrics.bytes += next.value.byteLength;
          if (totalBytes > config.sseBytesPerConnection) {
            metrics.error(connectionId, "body_too_large");
            controller.abort();
            break;
          }
          buffered += decoder.decode(next.value, { stream: true });
          let delimiter = buffered.match(/\r\n\r\n|\n\n|\r\r/);
          while (delimiter?.index !== undefined) {
            const frame = buffered.slice(0, delimiter.index).replace(/\r\n|\r/g, "\n").trim();
            buffered = buffered.slice(delimiter.index + delimiter[0].length);
            if (frame) {
              metrics.frames += 1;
              if (frame.startsWith(":")) metrics.heartbeats += 1;
              if (/(?:^|\n)data:/.test(frame)) metrics.events += 1;
            }
            delimiter = buffered.match(/\r\n\r\n|\n\n|\r\r/);
          }
          if (buffered.length > 64 * 1024) {
            metrics.error(connectionId, "frame_too_large");
            controller.abort();
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (error) {
      const expectedAbort = stopSignal.aborted || runSignal.aborted;
      if (!expectedAbort) metrics.error(connectionId, errorCode(error, connectTimedOut, false));
    } finally {
      clearTimeout(connectTimeout);
      stopSignal.removeEventListener("abort", stop);
      runSignal.removeEventListener("abort", stop);
      if (connected) metrics.lifetimes.push(performance.now() - startedAt);
      if (!readyResolved) resolveReady(false);
    }
  })();
  return { ready, done };
}

function latencySummary(values) {
  if (!values.length) return { average: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1)];
  return {
    average: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    p99: round(percentile(0.99)),
    max: round(sorted[sorted.length - 1]),
  };
}

function summarizeMetric(metric) {
  return {
    endpoint: metric.endpoint,
    requests: metric.count,
    succeeded: metric.succeeded,
    failed: metric.httpFailed + metric.transportFailed,
    bytes: metric.bytes,
    statuses: mapObject(metric.statuses),
    errors: mapObject(metric.errors),
    latency_ms: latencySummary(metric.latencies),
  };
}

function mapObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function roundRatio(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatDistribution(value) {
  const entries = Object.entries(value);
  return entries.length ? entries.map(([key, count]) => `${key}:${count}`).join(",") : "-";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${round(bytes / 1024)} KiB`;
  return `${round(bytes / (1024 * 1024))} MiB`;
}

function printTable(rows) {
  const headings = ["endpoint", "requests", "ok", "failed", "avg ms", "p50", "p95", "p99", "max", "statuses"];
  const values = rows.map((row) => [
    row.endpoint,
    String(row.requests),
    String(row.succeeded),
    String(row.failed),
    String(row.latency_ms.average),
    String(row.latency_ms.p50),
    String(row.latency_ms.p95),
    String(row.latency_ms.p99),
    String(row.latency_ms.max),
    formatDistribution(row.statuses),
  ]);
  const widths = headings.map((heading, index) => Math.max(heading.length, ...values.map((row) => row[index].length)));
  const line = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  console.log(line(headings));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of values) console.log(line(row));
}

function sanitizedPlan(config) {
  const plannedRequests = Math.min(config.maxRequests, Math.ceil(config.durationSeconds * config.requestsPerSecond));
  return {
    target: config.origin,
    target_scope: config.local ? "loopback" : "explicitly-authorized non-local HTTPS",
    credentials: "loaded from environment; values suppressed",
    virtual_users: config.virtualUsers,
    sessions: config.sessions,
    auth_concurrency: config.authConcurrency,
    duration_seconds: config.durationSeconds,
    requests_per_second: config.requestsPerSecond,
    planned_request_cap: plannedRequests,
    request_timeout_ms: config.requestTimeoutMs,
    home_weight: config.homeWeight,
    register_weight: config.registerWeight,
    date: config.date || "discover from teacher home",
    class_section: config.classSectionId ? "explicit CLASS_SECTION_ID" : "discover first assigned class",
    sse_connections: config.sseConnections,
    sse_duration_seconds: config.sseDurationSeconds,
    max_error_rate: config.maxErrorRate,
    attendance_mutation: "disabled by fixed request allowlist",
  };
}

function printPlan(config) {
  const plan = sanitizedPlan(config);
  if (config.outputFormat === "json") {
    console.log(JSON.stringify({ plan }, null, 2));
    return;
  }
  console.log("OmniSchool morning-attendance read load test");
  console.log(`Target: ${plan.target} (${plan.target_scope})`);
  console.log(`Load: ${plan.virtual_users} VUs, ${plan.sessions} sessions, ${plan.requests_per_second} req/s for ${plan.duration_seconds}s (cap ${plan.planned_request_cap})`);
  console.log(`Mix: teacher home ${plan.home_weight}, attendance register ${plan.register_weight}`);
  console.log(`Selection: ${plan.date}; ${plan.class_section}`);
  console.log(`SSE: ${plan.sse_connections} connection(s) for ${plan.sse_duration_seconds}s`);
  console.log("Credentials: loaded from environment; values suppressed");
  console.log("Safety: attendance mutation is disabled by a fixed method/path allowlist");
  if (!config.local) console.log("WARNING: running against an explicitly opted-in non-local HTTPS target.");
}

function printResult(config, result) {
  if (config.outputFormat === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log("\nRead workload results");
  printTable(result.read_endpoints);
  console.log(`Elapsed: ${round(result.elapsed_ms / 1_000)}s; scheduled window: ${round(result.scheduled_window_ms / 1_000)}s; achieved: ${result.achieved_requests_per_second} req/s`);
  console.log(`Transferred: ${formatBytes(result.read_totals.bytes)}; error rate: ${(result.error_rate * 100).toFixed(2)}%`);
  const readErrors = result.read_endpoints.flatMap((row) => Object.entries(row.errors).map(([error, count]) => `${row.endpoint}/${error}:${count}`));
  if (readErrors.length) console.log(`Errors: ${readErrors.join(", ")}`);
  console.log("\nAuthentication/setup results");
  printTable(result.setup_endpoints);
  if (result.sse.attempted > 0) {
    console.log("\nSSE soak results");
    console.log(`Connected: ${result.sse.connected}/${result.sse.attempted}; statuses: ${formatDistribution(result.sse.statuses)}`);
    console.log(`Connect p50/p95/p99: ${result.sse.connect_latency_ms.p50}/${result.sse.connect_latency_ms.p95}/${result.sse.connect_latency_ms.p99} ms`);
    console.log(`Frames: ${result.sse.frames}; events: ${result.sse.events}; heartbeats: ${result.sse.heartbeats}; bytes: ${formatBytes(result.sse.bytes)}`);
    if (Object.keys(result.sse.errors).length) console.log(`SSE errors: ${formatDistribution(result.sse.errors)}`);
  }
  console.log(`\nOutcome: ${result.passed ? "PASS" : "FAIL"} (MAX_ERROR_RATE=${config.maxErrorRate})`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const unknown = args.filter((arg) => arg !== "--dry-run");
  if (unknown.length) throw new HarnessError("invalid_argument", "Unknown option. Use --help to list supported options.");
  const config = loadConfig();
  const dryRun = args.includes("--dry-run");
  if (config.outputFormat === "text" || dryRun) printPlan(config);
  if (dryRun) return 0;

  const metrics = new Metrics();
  const sseMetrics = new SseMetrics(config.sseConnections);
  const runController = new AbortController();
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    runController.abort();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    const sessions = await createSessions(config, metrics, runController.signal);
    const selection = await discoverRegister(sessions[0], config, metrics, runController.signal);
    await preflightRegister(sessions[0], config, selection, metrics, runController.signal);

    const sseStop = new AbortController();
    const sseHandles = Array.from({ length: config.sseConnections }, (_, index) => (
      startSseConnection(index, sessions[index], config, sseMetrics, sseStop.signal, runController.signal)
    ));
    await Promise.all(sseHandles.map((handle) => handle.ready));
    const sseTimer = config.sseConnections > 0
      ? setTimeout(() => sseStop.abort(), config.sseDurationSeconds * 1_000)
      : undefined;

    const workload = await runReadLoad(sessions, config, selection, metrics, runController.signal);
    if (sseHandles.length) await Promise.all(sseHandles.map((handle) => handle.done));
    if (sseTimer) clearTimeout(sseTimer);

    const readEndpoints = metrics.snapshot("read.");
    const setupEndpoints = metrics.snapshot("setup.");
    const readTotals = metrics.totals("read.");
    const errorRate = readTotals.requests ? readTotals.failed / readTotals.requests : 1;
    const sse = sseMetrics.snapshot();
    const ssePassed = !config.sseConnections || (sse.connected === sse.attempted && Object.keys(sse.errors).length === 0);
    const passed = !interrupted && readTotals.requests > 0 && errorRate <= config.maxErrorRate && ssePassed;
    const result = {
      plan: sanitizedPlan(config),
      selection: { date: selection.date, class_section: selection.classSectionId ? "resolved" : "not required" },
      elapsed_ms: round(workload.elapsedMs),
      scheduled_window_ms: round(workload.scheduledWindowMs),
      planned_requests: workload.plannedRequests,
      achieved_requests_per_second: round(readTotals.requests / Math.max(workload.scheduledWindowMs / 1_000, 0.001)),
      read_totals: readTotals,
      error_rate: roundRatio(errorRate),
      read_endpoints: readEndpoints,
      setup_endpoints: setupEndpoints,
      sse,
      interrupted,
      passed,
    };
    printResult(config, result);
    return interrupted ? 130 : passed ? 0 : 1;
  } catch (error) {
    if (interrupted) return 130;
    throw error;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  const message = error instanceof HarnessError ? error.message : "Unexpected harness failure.";
  console.error(`Load test did not run: ${message}`);
  process.exitCode = 1;
}
