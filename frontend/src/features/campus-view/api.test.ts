import { describe, expect, it } from "vitest";
import { activityTruthDimension } from "./api";

describe("Campus View activity truth", () => {
  it("keeps pending attendance observation separate from accepted evidence", () => {
    expect(activityTruthDimension("attendance", "pending")).toBe("observed");
    expect(activityTruthDimension("attendance", "accepted")).toBe("accepted");
  });

  it("does not promote pending or review command states into campus truth", () => {
    expect(activityTruthDimension("setup", "pending")).toBe("unknown");
    expect(activityTruthDimension("examination", "review_required")).toBe("unknown");
    expect(activityTruthDimension("setup", "failed")).toBe("unknown");
  });
});
