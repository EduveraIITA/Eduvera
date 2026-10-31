import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");
const rule = (path: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = source(path).match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  expect(declaration, `${path}: ${selector}`).toBeDefined();
  return declaration ?? "";
};

describe("academic surfaces keep breathing room", () => {
  it("insets standalone filled context and focused rows without negative gutters", () => {
    for (const [path, selector] of [
      ["features/timetable/timetable-workspace.css", ".timetable-workspace-context"],
      ["features/planner/timetable-rehearsal.css", ".planner-rehearsal"],
      ["features/day-plans/day-plans.css", ".day-period.is-attention-target"],
      ["features/day-plans/day-plans.css", ".day-teaching-list > li.is-rehearsal-now"],
      ["features/attendance/attendance-participant.css", ".attendance-participant.has-conflict"],
    ]) {
      const css = rule(path, selector);
      expect(css).toContain("var(--thatcampus-row-inset)");
      expect(css).toContain("var(--thatcampus-radius-row)");
      expect(css).not.toMatch(/margin-inline:\s*-/);
    }
  });

  it("keeps schedule, document and ranking surfaces comfortably inset", () => {
    for (const [path, selector] of [
      ["pages/student/student-pages.css", ".leader-row"],
      ["pages/student/student-pages.css", ".ranking-row"],
      ["pages/student/student-pages.css", ".timeline-period"],
      ["pages/student/student-pages.css", ".student-home-actions button"],
      ["pages/parent/parent-pages.css", ".current-period"],
      ["pages/parent/parent-pages.css", ".document-row"],
      ["pages/parent/parent-pages.css", ".packing-list label"],
      ["features/academic-reports/academic-reports.css", ".report-summary"],
      ["features/assessments/assessments.css", ".assessment-summary"],
    ]) expect(rule(path, selector)).toContain("var(--thatcampus-row-inset)");
    const student = source("pages/student/student-pages.css");
    expect(student).not.toContain(".timeline-period { padding: 10px 9px");
    expect(student).not.toContain("article.is-focus { margin-inline: -6px");
    expect(source("features/principal-insights/unified-insights.css")).not.toContain(".attendance-review__list a { padding:16px 12px");
    expect(source("features/principal-home/principal-home.css")).not.toContain(".principal-home__rows > li > a { padding: 14px 12px");
  });

  it("uses shared subtle depth on actual controls while retaining input and evidence borders", () => {
    for (const [path, selector] of [
      ["features/timetable/timetable-workspace.css", ".timetable-workspace-context__actions > a"],
      ["features/day-plans/day-plans.css", ".day-primary"],
      ["features/principal-insights/principal-insights.css", ".principal-insights__refresh"],
      ["pages/operations/timetable-builder.css", ".timetable-sheet footer button"],
      ["pages/parent/parent-pages.css", ".button--white"],
    ]) {
      const css = rule(path, selector);
      expect(css).toMatch(/border:\s*1px solid transparent/);
      expect(css).toContain("var(--thatcampus-shadow-control)");
    }
    expect(rule("features/timetable/timetable-workspace.css", ".timetable-workspace-context select")).toContain("border: 1px solid var(--thatcampus-border)");
    expect(source("features/attendance/attendance-participant.css")).toContain(".roll-call-choice.is-present[aria-pressed=\"true\"] { color: var(--thatcampus-positive); border-color: var(--thatcampus-positive)");
  });
});
