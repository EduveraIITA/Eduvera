import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const style = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");

describe("activity visual foundations", () => {
  it("binds the calendar engine's own palette to the selected app theme", () => {
    const styles = style("features/activities/activities.css");
    const engine = styles.match(/\.activity-calendar \.school-calendar-engine\s*\{([^}]+)\}/)?.[1];
    expect(engine).toBeDefined();
    expect(engine).toContain("--fc-monarch-background:var(--thatcampus-surface)");
    expect(engine).toContain("--fc-monarch-foreground:var(--thatcampus-ink)");
    expect(engine).toContain("--fc-monarch-primary:var(--thatcampus-action)");
    expect(engine).toContain("--fc-monarch-border:var(--thatcampus-border)");
    expect(engine).not.toMatch(/#[a-f\d]{3,8}\b/i);
  });

  it("keeps onboarding on shared theme values instead of a separate blue or dark palette", () => {
    const styles = style("features/onboarding/progressive-onboarding.css");
    expect(styles).toContain("--start-ink: var(--thatcampus-ink)");
    expect(styles).toContain("--start-surface: var(--thatcampus-surface)");
    expect(styles).toContain("background: var(--thatcampus-action)");
    expect(styles).not.toMatch(/#[a-f\d]{3,8}\b/i);
    expect(styles).not.toContain(":root[data-theme=dark]");
  });

  it("keeps sheet actions opaque and theme-aware in dark mode", () => {
    const styles = style("pages/operations/timetable-builder.css");
    const footer = styles.match(/\.timetable-sheet footer\s*\{([^}]+)\}/)?.[1];
    expect(footer).toContain("position: sticky");
    expect(footer).toContain("background: var(--thatcampus-surface)");
    expect(footer).not.toContain("255 255 255");
  });
});
