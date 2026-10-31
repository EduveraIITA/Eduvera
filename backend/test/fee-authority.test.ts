import { describe, expect, it } from "vitest";
import { confirmFeeAuthoritySchema, feeMandateLimit, sameFeeAuthorityExpected } from "../src/governance/fee-authority-basis.js";
import { randomUUID } from "node:crypto";

describe("existing Finance authority confirmation contract", () => {
  it("supports only empty conditions or a documented whole-INR cap", () => {
    expect(feeMandateLimit({}, "")).toBeNull();
    expect(feeMandateLimit({ max_amount_inr: 30000 }, "Maximum amount INR 30000")).toBe(3_000_000);
    expect(feeMandateLimit({ max_amount_inr: 30000 }, "")).toBe(3_000_000);
    for (const [conditions, summary] of [[{ unknown_approval: true }, ""], [{ max_amount_inr: 0 }, ""], [{ max_amount_inr: 1.5 }, ""],
      [{}, "Only one department"], [{ max_amount_inr: 30000 }, "Maximum amount INR 50000"], [null, ""]] as const)
      expect(() => feeMandateLimit(conditions, summary)).toThrow();
  });
  it("requires an explicit current-source snapshot and holder attestation, without actor/authority creation fields", () => {
    const input = { command_id: randomUUID(), mandate_id: randomUUID(), attestation: true, expected: { mandate_revision: 1, office_revision: 1,
      appointment_revision: 1, rule_revision: 0, source_revisions: [{ id: randomUUID(), revision: 1 }] } };
    expect(confirmFeeAuthoritySchema.safeParse(input).success).toBe(true);
    expect(sameFeeAuthorityExpected(input.expected, { source_revisions: input.expected.source_revisions,
      rule_revision: 0, appointment_revision: 1, office_revision: 1, mandate_revision: 1 })).toBe(true);
    for (const invalid of [{ ...input, attestation: false }, { ...input, expected: { ...input.expected, source_revisions: [] } },
      { ...input, acting_user_id: randomUUID() }, { ...input, new_mandate: true }, { ...input, expected: { ...input.expected, rule_revision: -1 } }])
      expect(confirmFeeAuthoritySchema.safeParse(invalid).success).toBe(false);
  });
});
