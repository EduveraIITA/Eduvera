import { describe, expect, it } from "vitest";
import { planOccurrenceSchema } from "../src/campus-model-core/plan-occurrence.port.js";

const entity = (kind: string, domain: string, id: string) => ({
  kind, domain, domain_id: id, label: "Fictional context", lifecycle_state: "active" as const,
  source_revision: 1, metadata: {},
});
const base = {
  occurrence_key: "fictional-lunch:2026-10-26",
  occurrence: entity("schedule_occurrence", "dining", "fictional-lunch:2026-10-26"),
  local_date: "2026-10-26", starts_at: "2026-10-26T06:30:00Z", ends_at: "2026-10-26T08:30:00Z",
  time_zone: "Asia/Kolkata", context: entity("space", "campus_topology", "fictional-hall"),
  participants: [], resources: [entity("space", "campus_topology", "fictional-hall")], state: "expected" as const,
};

describe("typed plan availability", () => {
  it("retains existing exclusive caller semantics and explicitly identifies non-reserving availability", () => {
    expect(planOccurrenceSchema.parse(base).claim_kind).toBeUndefined();
    expect(planOccurrenceSchema.parse({ ...base, claim_kind: "availability" })).toMatchObject({
      claim_kind: "availability", participants: [], context: { domain: "campus_topology" },
    });
    expect(planOccurrenceSchema.safeParse({ ...base, claim_kind: "implicit_reservation" }).success).toBe(false);
  });

  it("never disguises a human assignment as optional availability participation", () => {
    const participant = { person: entity("person", "people", "fictional-person"), role: "operator", required: false,
      source_ref: "fictional-duty", source_revision: 1 };
    expect(planOccurrenceSchema.safeParse({ ...base, claim_kind: "availability", participants: [participant] }).success).toBe(false);
    expect(planOccurrenceSchema.safeParse({ ...base, participants: [participant] }).success).toBe(true);
  });
});
