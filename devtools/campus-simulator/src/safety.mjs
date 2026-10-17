const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const EXTERNAL_CONNECTOR_FLAGS = [
  "INVITATION_EMAIL_ENABLED",
  "PHOTO_ATTENDANCE_ENABLED",
  "RAZORPAY_ENABLED",
  "TELEGRAM_AUTO_REGISTER_WEBHOOK",
  "TELEGRAM_BOT_ENABLED",
];

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export function assertLoopbackOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("CAMPUS_SIMULATOR_API_ORIGIN must be a valid loopback HTTP origin.");
  }
  if (
    parsed.protocol !== "http:"
    || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("The campus simulator may connect only to an exact loopback HTTP origin.");
  }
  return parsed.origin;
}

export function assertSafeEnvironment(environment = process.env) {
  if (!enabled(environment.CAMPUS_SIMULATOR_ENABLED)) {
    throw new Error("CAMPUS_SIMULATOR_ENABLED=true is required for the development harness.");
  }
  const hosted = enabled(environment.CAMPUS_SIMULATOR_HOSTED);
  if (hosted) {
    if (environment.NODE_ENV !== "production" || environment.DEPLOYMENT_ENVIRONMENT !== "stage") {
      throw new Error("The hosted campus simulator is restricted to the Stage environment.");
    }
    if (environment.K_SERVICE !== "eduvera-stage-simulator") {
      throw new Error("The hosted campus simulator may run only in its dedicated Cloud Run service.");
    }
  } else {
    if (environment.NODE_ENV !== "development" || environment.DEPLOYMENT_ENVIRONMENT !== "development") {
      throw new Error("The local campus simulator is restricted to the development environment.");
    }
    if (environment.K_SERVICE) throw new Error("The local campus simulator cannot run inside a managed Cloud Run service.");
  }
  for (const name of EXTERNAL_CONNECTOR_FLAGS) {
    if (enabled(environment[name])) {
      throw new Error(`${name} must be disabled while the campus simulator is running.`);
    }
  }
  const rawOrigin = environment.CAMPUS_SIMULATOR_API_ORIGIN ?? "http://127.0.0.1:8001";
  const apiOrigin = hosted ? new URL(rawOrigin).origin : assertLoopbackOrigin(rawOrigin);
  if (hosted && apiOrigin !== "https://app.thatcampus.com") {
    throw new Error("The hosted campus simulator may connect only to the canonical Stage application origin.");
  }
  const proxyKey = String(environment.CAMPUS_LAB_PROXY_KEY ?? "");
  if (proxyKey.length < 24 || /\s/.test(proxyKey)) {
    throw new Error("CAMPUS_LAB_PROXY_KEY must be a non-whitespace secret with at least 24 characters.");
  }
  const port = Number(hosted ? (environment.PORT ?? 8080) : (environment.CAMPUS_SIMULATOR_PORT ?? 8002));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("CAMPUS_SIMULATOR_PORT must be a valid TCP port.");
  }
  const demoPassword = String(environment.CAMPUS_SIMULATOR_DEMO_PASSWORD ?? "");
  if (!hosted && demoPassword.length < 8) {
    throw new Error("CAMPUS_SIMULATOR_DEMO_PASSWORD must provide the private Cambridge fixture credential.");
  }
  const serviceToken = String(environment.CAMPUS_SIMULATOR_SERVICE_TOKEN ?? "");
  if (hosted && (serviceToken.length < 32 || /\s/.test(serviceToken))) {
    throw new Error("CAMPUS_SIMULATOR_SERVICE_TOKEN must be a rotated non-whitespace service secret.");
  }
  return { apiOrigin, proxyKey, port, demoPassword, hosted, serviceToken, host: hosted ? "0.0.0.0" : "127.0.0.1" };
}

async function checkedJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Local API safety check failed with HTTP ${response.status}.`);
  return response.json();
}

export async function verifyApplicationApi(apiOrigin, { fetchImpl = fetch, hosted = false } = {}) {
  const origin = hosted ? new URL(apiOrigin).origin : assertLoopbackOrigin(apiOrigin);
  const [release, session] = await Promise.all([
    checkedJson(fetchImpl, `${origin}/releasez`),
    checkedJson(fetchImpl, `${origin}/api/v1/auth/session/`),
  ]);
  if (release?.environment !== (hosted ? "stage" : "development")) {
    throw new Error(`The connected application did not identify itself as a ${hosted ? "Stage" : "development"} release.`);
  }
  if (!hosted && (session?.demo_mode !== true || session?.public_demo === true)) {
    throw new Error("The connected application must use private local demo mode, not the public demo.");
  }
  if (hosted && (session?.demo_mode !== false || session?.authenticated === true)) {
    throw new Error("The hosted simulator safety probe requires anonymous Stage with password demo mode disabled.");
  }
  return { release, session };
}

export const verifyLocalApi = verifyApplicationApi;

export function assertCambridgeFixture(setup, fixture) {
  if (setup?.school?.code !== "cis" || fixture?.school_code !== "cis") {
    throw new Error("The development harness is restricted to the Cambridge 'cis' dummy school.");
  }
  if (setup?.school?.timezone !== "Asia/Kolkata" || fixture?.timezone !== "Asia/Kolkata") {
    throw new Error("The Cambridge development fixture requires the Asia/Kolkata timezone.");
  }
}

export const safetyInternals = { enabled, EXTERNAL_CONNECTOR_FLAGS, LOOPBACK_HOSTS };
