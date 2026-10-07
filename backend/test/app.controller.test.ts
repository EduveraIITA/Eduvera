import { UnauthorizedException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppController } from "../src/app.controller.js";

describe("AppController monitoring metrics", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalMetricsToken = process.env.METRICS_TOKEN;

  beforeAll(() => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://127.0.0.1/omnischool_metrics_test";
    process.env.METRICS_TOKEN = "unit-test-metrics-token-that-is-long-enough";
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalMetricsToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = originalMetricsToken;
  });

  it("sets the Prometheus content type only after a monitoring token is accepted", () => {
    const header = vi.fn();
    const controller = new AppController(
      {} as never,
      { prometheusMetrics: () => "omnischool_event_broker_ready 1\n" } as never,
    );

    expect(() => controller.metrics(undefined, { header } as never)).toThrow(UnauthorizedException);
    expect(header).not.toHaveBeenCalled();

    expect(controller.metrics(
      "Bearer unit-test-metrics-token-that-is-long-enough",
      { header } as never,
    )).toContain("omnischool_event_broker_ready");
    expect(header).toHaveBeenCalledWith("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  });
});
