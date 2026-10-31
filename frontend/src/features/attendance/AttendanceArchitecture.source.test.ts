import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const path = (relative: string) => join(process.cwd(), "src", relative);
const source = (relative: string) => readFileSync(path(relative), "utf8");
const adapters = [
  "features/attendance/AcademicAttendanceRegister.tsx",
  "features/activities/ActivityRegisterEditor.tsx",
  "features/campus-events/EventRegisterPage.tsx",
] as const;
const rowConsumers = [
  ...adapters,
  "features/assessments/ExamDayPanel.tsx",
] as const;
const composition = [
  "AttendanceRegisterView",
  "AttendanceRegisterHeader",
  "AttendanceRegisterProgress",
  "AttendanceRegisterTools",
  "AttendanceRegisterRoster",
  "AttendanceRegisterFooter",
] as const;

describe("one canonical attendance presentation", () => {
  it("retires the monolithic page, old participant wrapper and displaced styles", () => {
    expect(source("pages/operations/TeacherPages.tsx")).not.toMatch(/\bTeacherAttendancePage\b/);
    for (const retired of [
      "pages/operations/AttendanceStudentRow.tsx",
      "pages/operations/AttendanceParticipantRow.tsx",
      "pages/operations/attendance-register.css",
      "features/activities/attendance-register-detail.css",
    ]) expect(existsSync(path(retired)), `${retired} must remain retired`).toBe(false);
    // Family records and date controls still own this active sheet; only its
    // superseded register-presentation overrides have been retired.
    expect(source("features/attendance/attendance-simple.css")).not.toMatch(/\.roll-call-(?:summary|totals|toolbar|submit-bar)\b/);
  });

  it("composes full-page register adapters from the same register view", () => {
    for (const adapter of adapters) {
      const code = source(adapter);
      const imports = code.match(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*AttendanceRegisterView["']/)?.[1];
      expect(imports, `${adapter} must import the common presentation`).toBeDefined();
      for (const component of composition) {
        expect(imports).toMatch(new RegExp(`\\b${component}\\b`));
        expect(code).toMatch(new RegExp(`<${component}(?:\\s|>)`));
      }
    }
  });

  it("uses the neutral participant row for every owning register adapter", () => {
    for (const consumer of rowConsumers) {
      const code = source(consumer);
      expect(code).toMatch(/from\s*["'](?:\.\.\/attendance\/|\.\/)AttendanceParticipantRow["']/);
      expect(code).toContain("<AttendanceParticipantRow");
      expect(code).not.toMatch(/\bAttendanceStudentRow\b/);
      expect(code).not.toMatch(/import\s*["'][^"']*(?:attendance-register|attendance-simple|attendance-register-detail)\.css["']/);
    }
  });

  it("routes academic work to its canonical attendance adapter", () => {
    const routes = source("features/operations/OperationsRoutes.tsx");
    expect(routes).toMatch(/import\s*\{\s*AcademicAttendanceRegister\s*\}\s*from\s*["']\.\.\/attendance\/AcademicAttendanceRegister["']/);
    expect(routes).toMatch(/<AcademicAttendanceRegister(?:\s|>)/);
    expect(routes).not.toMatch(/\bTeacherAttendancePage\b/);
  });
});
