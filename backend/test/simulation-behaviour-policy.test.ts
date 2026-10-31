import { describe, expect, it } from "vitest";
import {
  configureSimulationBehaviourSchema,
  normalizeSimulationBehaviourConfiguration,
} from "../src/simulation/simulation.contracts.js";
import { syntheticOfferResponse } from "../src/simulation/simulation-offer-response.adapter.js";

const attendance = {
  enabled: true,
  present: 0.8,
  late: 0.1,
  absent: 0.05,
  excused: 0.05,
  submission_delay_minutes: 8,
};

describe("Simulation behaviour policy", () => {
  it("normalizes retained v1 attendance policy without enabling hidden responses", () => {
    const retained = configureSimulationBehaviourSchema.parse({
      schema_version: 1,
      attendance,
    });

    expect(normalizeSimulationBehaviourConfiguration(retained)).toEqual({
      schema_version: 2,
      attendance,
      coverage_offers: {
        enabled: false,
        accepted: 0,
        declined: 0,
        no_response: 1,
        response_delay_minutes: 10,
      },
      invigilation_offers: {
        enabled: false,
        accepted: 0,
        declined: 0,
        no_response: 1,
        response_delay_minutes: 10,
      },
    });
  });

  it("requires each declared outcome distribution to total one", () => {
    const parsed = configureSimulationBehaviourSchema.safeParse({
      schema_version: 2,
      attendance,
      coverage_offers: {
        enabled: true,
        accepted: 0.7,
        declined: 0.2,
        no_response: 0.2,
        response_delay_minutes: 15,
      },
      invigilation_offers: {
        enabled: false,
        accepted: 0,
        declined: 0,
        no_response: 1,
        response_delay_minutes: 10,
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("draws repeatably from the run seed and canonical configuration hash", () => {
    const policy = {
      enabled: true,
      accepted: 0.55,
      declined: 0.25,
      no_response: 0.2,
      response_delay_minutes: 12,
    };
    const first = syntheticOfferResponse("run-seed", "a".repeat(64), "coverage:task-1:3", policy);
    const replay = syntheticOfferResponse("run-seed", "a".repeat(64), "coverage:task-1:3", policy);

    expect(replay).toBe(first);
    expect(["accepted", "declined", "no_response"]).toContain(first);
  });

  it("honours explicit deterministic boundary policies", () => {
    expect(syntheticOfferResponse("seed", "b".repeat(64), "offer", {
      enabled: true,
      accepted: 1,
      declined: 0,
      no_response: 0,
      response_delay_minutes: 0,
    })).toBe("accepted");
    expect(syntheticOfferResponse("seed", "b".repeat(64), "offer", {
      enabled: true,
      accepted: 0,
      declined: 0,
      no_response: 1,
      response_delay_minutes: 0,
    })).toBe("no_response");
  });
});
