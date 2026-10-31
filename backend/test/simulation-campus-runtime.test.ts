import { describe, expect, it } from "vitest";
import {
  simulationAttendanceRoute,
  syntheticAttendanceStatus,
} from "../src/database/simulation-campus-runtime.service.js";

describe("Simulation campus runtime routing", () => {
  it("uses the session domain only when a scheduled register exists", () => {
    expect(simulationAttendanceRoute("scheduled_session", "session-1")).toBe("scheduled_session");
    expect(simulationAttendanceRoute("scheduled_session", null)).toBe("daily_class");
    expect(simulationAttendanceRoute("daily_register", "session-1")).toBe("daily_class");
  });

  it("keeps approved cohort draws deterministic without inferring a person state", () => {
    const policy = {
      enabled: true,
      present: 0.7,
      late: 0.1,
      absent: 0.1,
      excused: 0.1,
      submission_delay_minutes: 0,
    } as const;
    const first = syntheticAttendanceStatus("run-seed", "slot:student", policy);
    expect(syntheticAttendanceStatus("run-seed", "slot:student", policy)).toBe(first);
    expect(["present", "late", "absent", "excused"]).toContain(first);
  });
});
