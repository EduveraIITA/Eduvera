import { describe, expect, it } from "vitest";
import { resultsInput } from "../src/assessments/assessments.service.js";

const input = (marks?: unknown) => ({
  expected_assessment_revision: 3,
  results: [{ result_id: "81917b64-571a-4390-8431-4292d58c8a59", outcome: "scored", marks,
    expected_revision: 1, reason: "Initial marks entry" }],
});

describe("assessment score input truth", () => {
  it.each(["", " ", "0", "12.5", false, true, [], {}, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.005])(
    "rejects non-numeric or invalid marks without coercing them: %s", marks => {
      expect(resultsInput.safeParse(input(marks)).success).toBe(false);
    },
  );

  it.each([0, 12.5, 20])("retains an explicit numeric score %s", marks => {
    expect(resultsInput.parse(input(marks)).results[0]!.marks).toBe(marks);
  });

  it.each([null, undefined])("keeps a missing score %s null, never zero", marks => {
    expect(resultsInput.parse(input(marks)).results[0]!.marks).toBeNull();
  });
});
