import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");

describe("academic and participation theme foundations", () => {
  it("binds both calendar engines to the same selected-world palette", () => {
    for (const [path, selector] of [
      ["features/planner/principal-planner.css", /\.principal-planner \.school-calendar-engine\s*\{([^}]+)\}/],
      ["features/activities/activities.css", /\.activity-calendar \.school-calendar-engine\s*\{([^}]+)\}/],
    ] as const) {
      const engine = source(path).match(selector)?.[1];
      expect(engine).toBeDefined();
      expect(engine).toContain("--fc-monarch-background:var(--thatcampus-surface)");
      expect(engine).toContain("--fc-monarch-foreground:var(--thatcampus-ink)");
      expect(engine).toContain("--fc-monarch-primary:var(--thatcampus-action)");
      expect(engine).toContain("--fc-monarch-primary-foreground:var(--thatcampus-on-action)");
      expect(engine).not.toMatch(/#[a-f\d]{3,8}\b/i);
    }
  });

  it("keeps assessment and report actions theme-aware without decorative selected stripes", () => {
    for (const path of ["features/assessments/assessments.css", "features/academic-reports/academic-reports.css"]) {
      const css = source(path);
      expect(css).toMatch(/background:\s*var\(--thatcampus-action\)/);
      expect(css).toMatch(/color:\s*var\(--thatcampus-on-action\)/);
      expect(css).not.toMatch(/linear-gradient|box-shadow:\s*inset 3px 0/);
    }
    expect(source("features/academic-reports/academic-reports.css")).not.toContain("border-left: 3px");
    expect(source("features/assessments/family-results.css")).not.toContain("border-left: 3px");
  });

  it("keeps identity accents from overriding Live or Simulation's application theme", () => {
    const shell = source("pages/parent/ParentShell.tsx");
    const variables = shell.match(/function accentVariables\([^]*?return \{([^]*?)\} as CSSProperties/)?.[1];
    expect(variables).toContain('"--profile-accent": theme.bright');
    expect(variables).toContain('"--profile-soft": theme.strong');
    expect(variables).not.toMatch(/--(?:thatcampus|parent-primary|surface-|primary)/);
    const css = source("pages/parent/parent-pages.css");
    expect(css).not.toMatch(/--thatcampus-brand\s*:/);
    expect(css).not.toContain("--thatcampus-feature-gradient:");
  });

  it("keeps important mobile controls readable and comfortably tappable", () => {
    const calendar = source("features/calendar/calendar.css");
    expect(calendar.match(/\.cal-inline-error button\s*\{([^}]+)\}/)?.[1]).toContain("min-height: 44px");
    expect(calendar.match(/\.cal-action\s*\{([^}]+)\}/)?.[1]).toContain("min-height: 44px");
    const planner = source("features/planner/principal-planner.css");
    expect(planner.match(/\.planner-toolbar__date > button:not\(\.planner-toolbar__today\)\s*\{([^}]+)\}/)?.[1]).toContain("flex:0 0 44px");
    expect(planner.match(/\.planner-filter-row select\s*\{([^}]+)\}/)?.[1]).toContain("font-size: 16px");
    expect(source("features/academic-reports/academic-reports.css")).toMatch(/\.report-dialog select\s*\{[^}]*font-size: 16px;[^}]*min-height: 48px/);
  });

  it("keeps warm logo motifs illustrative instead of changing status semantics", () => {
    const activities = source("features/activities/activities.css");
    expect(activities.match(/\.activity-agenda > button > svg:first-child\s*\{([^}]+)\}/)?.[1]).toContain("var(--thatcampus-logo-green-soft)");
    expect(activities.match(/\.activity-empty > svg\s*\{([^}]+)\}/)?.[1]).toContain("var(--thatcampus-logo-yellow-soft)");
    const register = source("features/attendance/attendance-participant.css");
    expect(register).toContain(".roll-call-choice.is-present[aria-pressed=\"true\"] { color: var(--thatcampus-positive)");
    expect(register).toContain(".roll-call-choice.is-absent[aria-pressed=\"true\"] { color: var(--thatcampus-danger)");
  });
});
