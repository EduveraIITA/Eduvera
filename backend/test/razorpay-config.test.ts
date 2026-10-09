import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
beforeEach(() => {
  const env = {
    NODE_ENV: "test", DEPLOYMENT_ENVIRONMENT: "stage", DEMO_MODE: "false",
    DATABASE_URL: "postgresql://test:test@127.0.0.1/razorpay_test", EVENT_DATABASE_URL: "postgresql://test:test@127.0.0.1/razorpay_test",
    COOKIE_SECRET: "a".repeat(40), RESTRICTED_CASE_ENCRYPTION_KEY: "b".repeat(40), METRICS_TOKEN: "c".repeat(40),
    COOKIE_SECURE: "true", RATE_LIMIT_STORE: "postgres", RELEASE_SHA: "abcdef123",
    PUBLIC_URL: "https://sandbox.example.test", ALLOWED_ORIGINS: "https://sandbox.example.test", INVITATION_EMAIL_ENABLED: "false",
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  for (const name of ["RAZORPAY_ENABLED", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("enables the requested Stage sandbox defaults without enabling demo logins", () => {
  const value = loadConfig();
  expect(value.RAZORPAY_ENABLED).toBe(true);
  expect(value.DEMO_MODE).toBe(false);
  expect(value.RAZORPAY_KEY_ID.startsWith("rzp_test_")).toBe(true);
  expect(value.RAZORPAY_KEY_SECRET.length).toBeGreaterThan(10);
});
it("allows environment overrides and explicit disabling", () => {
  vi.stubEnv("RAZORPAY_ENABLED", "false");
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_override"); vi.stubEnv("RAZORPAY_KEY_SECRET", "override-secret");
  const value = loadConfig();
  expect(value.RAZORPAY_ENABLED).toBe(false);
  expect(value.RAZORPAY_KEY_ID).toBe("rzp_test_override"); expect(value.RAZORPAY_KEY_SECRET).toBe("override-secret");
});
it("does not install credentials outside Stage", () => {
  vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "test");
  expect(loadConfig().RAZORPAY_KEY_SECRET).toBe(""); expect(loadConfig().RAZORPAY_ENABLED).toBe(false);
  vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "production");
  expect(loadConfig().RAZORPAY_KEY_SECRET).toBe(""); expect(loadConfig().RAZORPAY_ENABLED).toBe(false);
});
it("rejects live keys", () => {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_forbidden");
  expect(() => loadConfig()).toThrow(/Razorpay sandbox requires/);
});
it("rejects activation in production", () => {
  vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "production"); vi.stubEnv("RAZORPAY_ENABLED", "true");
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_fixture"); vi.stubEnv("RAZORPAY_KEY_SECRET", "fixture-secret");
  expect(() => loadConfig()).toThrow(/Razorpay sandbox requires/);
});
