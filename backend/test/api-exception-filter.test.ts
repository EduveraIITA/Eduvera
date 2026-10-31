import { Controller, Get, HttpException, Module, Param } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiExceptionFilter } from "../src/common/errors.js";
import { SimulationCapacityException } from "../src/simulation/simulation-resource-policy.js";

const resources = ["worlds", "running_runs", "storage", "pinned_runs"] as const;

@Controller("filter-contract")
class FilterContractController {
  @Get("capacity/:resource")
  capacity(@Param("resource") resource: string) {
    if (!resources.includes(resource as typeof resources[number])) throw new Error("Invalid test resource");
    throw new SimulationCapacityException(resource as typeof resources[number], resource === "storage" ? 2_147_483_648 : 12);
  }

  @Get("generic")
  generic() {
    throw new HttpException({ code: "simulation_institution_capacity", message: "Public message",
      resource: "worlds", limit: 12, secret: "must-not-escape", arbitrary: { private: true } }, 429);
  }
}

@Module({ controllers: [FilterContractController] })
class FilterContractModule {}

describe("ApiExceptionFilter Simulation capacity HTTP contract", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(FilterContractModule, new FastifyAdapter(), { logger: false });
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => { await app?.close(); });

  it.each(resources)("preserves only the native safe %s capacity hints through actual HTTP serialization", async resource => {
    const response = await app.inject({ method: "GET", url: `/filter-contract/capacity/${resource}` });
    expect(response.statusCode).toBe(429);
    const body = response.json();
    expect(body).toEqual({ error: { status: 429, code: "simulation_institution_capacity", detail: expect.any(String),
      resource, limit: resource === "storage" ? 2_147_483_648 : 12 } });
    expect(Object.keys(body.error).sort()).toEqual(["code", "detail", "limit", "resource", "status"]);
  });

  it("does not widen generic HttpException payloads even when they claim the same public code", async () => {
    const response = await app.inject({ method: "GET", url: "/filter-contract/generic" });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: { status: 429, code: "simulation_institution_capacity", detail: "Public message" } });
    expect(response.body).not.toContain("must-not-escape");
    expect(response.body).not.toContain("arbitrary");
    expect(response.body).not.toContain("resource");
  });
});
