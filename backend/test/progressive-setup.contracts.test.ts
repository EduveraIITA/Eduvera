import { describe, expect, it } from "vitest";
import {
  attendanceProgressiveSetupSchema,
  datePlusDays,
  gateProgressiveSetupSchema,
  institutionLocalDate,
  institutionLocalWeekday,
  progressiveCapabilitySchema,
} from "../src/institution-activation/progressive-setup.contracts.js";

describe("progressive capability setup contracts", () => {
  it("offers the implemented Assignments and Fees first-use capabilities", () => {
    expect(progressiveCapabilitySchema.parse("assignments")).toBe("assignments");
    expect(progressiveCapabilitySchema.parse("fees")).toBe("fees");
    expect(progressiveCapabilitySchema.safeParse("unsupported_capability").success).toBe(false);
  });
  it("accepts the minimum attendance job without institution-wide setup", () => {
    const result = attendanceProgressiveSetupSchema.parse({
      group_name: "Batch A",
      participant_names: ["Aarav Singh"],
      responsible: { kind: "current_user", self_teaches: true, display_name: "Kavita Mehta" },
      session: { starts_at: "09:00", ends_at: "09:15" },
    });
    expect(result.existing_class_id).toBeUndefined();
    expect(result.participant_names).toEqual(["Aarav Singh"]);
  });

  it("supports reusing the connected campus model", () => {
    const result = attendanceProgressiveSetupSchema.parse({
      existing_class_id: "10000000-0000-4000-a000-000000000001",
      existing_student_ids: ["20000000-0000-4000-a000-000000000001"],
      responsible: { kind: "staff", user_id: "30000000-0000-4000-a000-000000000001" },
      session: { starts_at: "10:00", ends_at: "10:30", weekdays: [1, 3, 5] },
    });
    expect(result.existing_student_ids).toHaveLength(1);
  });

  it("does not allow ambiguous or empty attendance setup", () => {
    const result = attendanceProgressiveSetupSchema.safeParse({
      group_name: "A", existing_class_id: "10000000-0000-4000-a000-000000000001",
      participant_names: [], responsible: { kind: "current_user", self_teaches: true },
      session: { starts_at: "10:00", ends_at: "09:00" },
    });
    expect(result.success).toBe(false);
  });

  it("keeps gate setup independent from academic terms and rosters", () => {
    expect(gateProgressiveSetupSchema.parse({ gate_name: "North gate", operator: { kind: "current_user", confirm: true } })).toEqual({
      gate_name: "North gate", operator: { kind: "current_user", confirm: true },
    });
  });

  it("derives institution-local dates, weekdays and rolling dates deterministically", () => {
    const instant = new Date("2026-10-18T20:00:00.000Z");
    expect(institutionLocalDate("Asia/Kolkata", instant)).toBe("2026-10-19");
    expect(institutionLocalWeekday("Asia/Kolkata", instant)).toBe(1);
    expect(datePlusDays("2026-10-18", 364)).toBe("2027-10-17");
  });
});
