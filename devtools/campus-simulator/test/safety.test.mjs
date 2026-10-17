import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeEnvironment, verifyLocalApi } from "../src/safety.mjs";

function environment(overrides = {}) {
  return {
    CAMPUS_SIMULATOR_ENABLED: "true",
    NODE_ENV: "development",
    DEPLOYMENT_ENVIRONMENT: "development",
    CAMPUS_SIMULATOR_API_ORIGIN: "http://127.0.0.1:8001",
    CAMPUS_LAB_PROXY_KEY: "local-development-key-123456789",
    CAMPUS_SIMULATOR_DEMO_PASSWORD: "local-fixture-password",
    CAMPUS_SIMULATOR_PORT: "8002",
    INVITATION_EMAIL_ENABLED: "false",
    PHOTO_ATTENDANCE_ENABLED: "false",
    RAZORPAY_ENABLED: "false",
    TELEGRAM_AUTO_REGISTER_WEBHOOK: "false",
    TELEGRAM_BOT_ENABLED: "false",
    ...overrides,
  };
}

test("accepts only an explicitly enabled loopback development harness", () => {
  assert.deepEqual(assertSafeEnvironment(environment()), {
    apiOrigin: "http://127.0.0.1:8001",
    proxyKey: "local-development-key-123456789",
    port: 8002,
    demoPassword: "local-fixture-password",
  });
});

test("fails closed for production, managed hosting, non-loopback APIs and live connectors", () => {
  assert.throws(() => assertSafeEnvironment(environment({ NODE_ENV: "production" })), /development environment/);
  assert.throws(() => assertSafeEnvironment(environment({ K_SERVICE: "thatcampus-api" })), /Cloud Run/);
  assert.throws(() => assertSafeEnvironment(environment({ CAMPUS_SIMULATOR_API_ORIGIN: "https://thatcampus.com" })), /loopback/);
  assert.throws(() => assertSafeEnvironment(environment({ TELEGRAM_BOT_ENABLED: "true" })), /must be disabled/);
  assert.throws(() => assertSafeEnvironment(environment({ PHOTO_ATTENDANCE_ENABLED: "1" })), /must be disabled/);
  assert.throws(() => assertSafeEnvironment(environment({ CAMPUS_SIMULATOR_DEMO_PASSWORD: "" })), /fixture credential/);
});

test("verifies the connected API is a private development demo", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/releasez")) return Response.json({ release_sha: "development", environment: "development" });
    return Response.json({ demo_mode: true, public_demo: false });
  };
  await verifyLocalApi("http://localhost:8001", { fetchImpl });
  assert.equal(calls.length, 2);

  await assert.rejects(
    verifyLocalApi("http://localhost:8001", {
      fetchImpl: async (url) => url.endsWith("/releasez")
        ? Response.json({ environment: "production" })
        : Response.json({ demo_mode: true, public_demo: false }),
    }),
    /development release/,
  );
});
