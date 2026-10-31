import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalCss = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");
const appearanceCss = readFileSync(resolve(process.cwd(), "src/styles/appearance.css"), "utf8");
const block = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing theme selector ${selector}`);
  return css.slice(start + selector.length + 2, css.indexOf("}", start));
};
function properties(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) result[match[1]] = match[2].trim();
  return result;
}
function color(tokens: Record<string, string>, key: string, seen: string[] = []): string {
  if (seen.includes(key)) throw new Error(`Circular token: ${key}`);
  const value = tokens[key];
  if (!value) throw new Error(`Missing token: ${key}`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  return reference ? color(tokens, reference[1], [...seen, key]) : value;
}
function luminance(hex: string) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected reviewed opaque hex, got ${hex}`);
  const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}
describe.each([{ dark: false, simulation: false }, { dark: true, simulation: false }, { dark: false, simulation: true }, { dark: true, simulation: true }])("shared theme $dark dark / $simulation simulation", ({ dark, simulation }) => {
  const tokens = {
    ...properties(block(globalCss, ":root")), ...properties(block(appearanceCss, ":root")),
    ...(dark ? properties(block(appearanceCss, ':root[data-theme="dark"]')) : {}),
    ...(simulation ? properties(block(appearanceCss, ':root[data-execution-environment="simulation"]')) : {}),
    ...(dark && simulation ? properties(block(appearanceCss, ':root[data-theme="dark"][data-execution-environment="simulation"]')) : {}),
  };
  it.each(["--thatcampus-ink", "--thatcampus-ink-secondary", "--thatcampus-ink-muted"])("keeps %s readable on canvas and surfaces", ink => {
    for (const surface of ["--thatcampus-canvas", "--thatcampus-surface", "--thatcampus-surface-row"]) {
      expect(contrast(color(tokens, ink), color(tokens, surface)), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("pairs filled-action ink and surface at normal-text contrast", () => {
    expect(contrast(color(tokens, "--thatcampus-action"), color(tokens, "--thatcampus-on-action"))).toBeGreaterThanOrEqual(4.5);
  });
  it("resolves Repairs and Accommodation tokens and preserves status and warning contrast", () => {
    const css = ["facilities/facilities.css", "accommodation/accommodation.css"].map(path => readFileSync(resolve(process.cwd(), `src/features/${path}`), "utf8")).join("\n");
    for (const match of css.matchAll(/var\((--thatcampus-[\w-]+)/g)) expect(color(tokens, match[1])).toBeTruthy();
    for (const ink of ["--thatcampus-positive", "--thatcampus-warning", "--thatcampus-danger"]) {
      expect(contrast(color(tokens, ink), color(tokens, "--thatcampus-surface-row"))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(color(tokens, "--thatcampus-warning"), color(tokens, "--thatcampus-warning-soft"))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(["--thatcampus-logo-green", "--thatcampus-logo-yellow-ink", "--thatcampus-icon-blue", "--thatcampus-accent"])("keeps flat icon outlines %s distinguishable", ink => {
    expect(contrast(color(tokens, ink), color(tokens, "--thatcampus-surface"))).toBeGreaterThanOrEqual(3);
  });
  it("binds legacy aliases to the selected world instead of light-only fallbacks", () => {
    expect(color(tokens, "--appearance-surface")).toBe(color(tokens, "--thatcampus-surface"));
    expect(color(tokens, "--appearance-brand")).toBe(color(tokens, "--thatcampus-brand"));
  });
  it("keeps filled entry surfaces distinct from the canvas in both appearances", () => {
    expect(contrast(color(tokens, "--thatcampus-surface-row"), color(tokens, "--thatcampus-canvas"))).toBeGreaterThanOrEqual(1.05);
  });
  it("defines a complete, restrained depth hierarchy in the selected appearance", () => {
    for (const depth of ["--thatcampus-shadow-control", "--thatcampus-shadow-card", "--thatcampus-shadow-raised", "--thatcampus-shadow-inset", "--thatcampus-shadow-control-pressed"]) {
      expect(color(tokens, depth)).toMatch(/(?:rgb|rgba)\(/);
    }
    expect(color(tokens, "--thatcampus-shadow-inset")).toContain("inset");
    expect(color(tokens, "--thatcampus-shadow-control-pressed")).toContain("inset");
  });
});

describe("shared filled row geometry", () => {
  const tokens = properties(block(globalCss, ":root"));
  it("keeps leave review identity unsqueezed and avoids nested cards and impact chips", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/staff-operations/staff-operations.css"), "utf8");
    expect(block(css, ".staff-leave-queue")).toContain("border: 0");
    expect(block(css, ".staff-leave-queue .staff-request > header")).toContain("grid-template-columns: 36px minmax(0, 1fr)");
    expect(block(css, ".staff-leave-queue .staff-request > header > .staff-status")).toContain("grid-column: 2");
    expect(block(css, ".staff-leave-queue .staff-impact > span")).toContain("display: block");
    expect(block(css, ".staff-leave-queue .staff-request")).toContain("border-radius: var(--thatcampus-radius-row)");
  });
  it("keeps nested Work corners concentric and Assistant edges on the card radius", () => {
    expect(tokens["--thatcampus-radius-control-inset"]).toBe("calc(var(--thatcampus-radius-control) - 4px)");
    const workspace = readFileSync(resolve(process.cwd(), "src/features/workspace/workspace.css"), "utf8");
    expect(block(workspace, ".workspace-work-tabs button")).toContain("border-radius: var(--thatcampus-radius-control-inset)");
    const assistant = readFileSync(resolve(process.cwd(), "src/features/assistant/assistant.css"), "utf8");
    expect(block(assistant, ".assistant-electric-border")).toContain("border-radius: var(--thatcampus-radius-card)");
    expect(block(assistant, ".assistant-electric-border::after")).toContain("border-radius: inherit");
    const component = readFileSync(resolve(process.cwd(), "src/features/assistant/AssistantElectricBorder.tsx"), "utf8");
    expect(component).not.toContain("style=");
  });
  it("uses rounder controls and rows without unsafe edge alignment", () => {
    expect(color(tokens, "--thatcampus-radius-control")).toBe("16px");
    expect(color(tokens, "--thatcampus-radius-row")).toBe("20px");
    expect(color(tokens, "--thatcampus-radius-card")).toBe("24px");
    expect(color(tokens, "--thatcampus-row-inset")).toBe("16px");
  });
  it("shares the inset corner rule across equivalent segmented controls", () => {
    for (const [path, selector] of [
      ["features/simulation/simulation-workspace.css", ".simulation-view-switcher--workspace button"],
      ["features/more/more-workspace-routes.css", ".more-workspace-segmented button"],
      ["pages/student/student-pages.css", ".segmented-control button"],
      ["pages/parent/parent-pages.css", ".leave-tabs button"],
    ]) {
      const css = readFileSync(resolve(process.cwd(), `src/${path}`), "utf8");
      expect(block(css, selector)).toContain("border-radius: var(--thatcampus-radius-control-inset)");
    }
  });
  it("keeps Repairs rows compact and their sticky actions inset and keyboard-safe", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/facilities/facilities.css"), "utf8");
    expect(css).toContain("padding:12px var(--thatcampus-row-inset)");
    expect(css).toContain("grid-template-columns:28px minmax(0,1fr) auto");
    expect(css).toContain("max(16px,env(safe-area-inset-bottom))");
    expect(css).toContain("font-size:16px");
    expect(css).not.toMatch(/swipe|touch-action:pan-x|linear-gradient/);
  });
  it("keeps Accommodation compact, theme-owned and keyboard-safe without card swipe controls", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/accommodation/accommodation.css"), "utf8");
    expect(css).toContain("padding:12px var(--thatcampus-row-inset)");
    expect(css).toContain("grid-template-columns:28px minmax(0,1fr) auto");
    expect(css).toContain("max(16px,env(safe-area-inset-bottom))");
    expect(css).toContain("font-size:16px");
    expect(css).not.toMatch(/swipe|touch-action:pan-x|linear-gradient|#[\da-f]{3,8}/i);
  });
  it("uses visible rounded, inset and raised Attendance entries, not white-on-white slabs", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/activities/activities.css"), "utf8");
    const row = block(css, ".activity-agenda > button");
    expect(row).toContain("padding:20px var(--thatcampus-row-inset)");
    expect(row).toContain("border-radius:var(--thatcampus-radius-row)");
    expect(row).toContain("background:var(--thatcampus-surface-row)");
    expect(row).toContain("box-shadow:var(--thatcampus-shadow-card)");
  });
  it("keeps shared sheets raised and People Cancel controls neutral without a decorative outline", () => {
    const plannerCss = readFileSync(resolve(process.cwd(), "src/features/planner/principal-planner.css"), "utf8");
    expect(block(plannerCss, ".planner-dialog")).toContain("box-shadow:var(--thatcampus-shadow-raised)");
    expect(block(plannerCss, ".planner-dialog")).toContain("border-radius:var(--thatcampus-radius-feature)");
    const peopleCss = readFileSync(resolve(process.cwd(), "src/features/people/people.css"), "utf8");
    expect(block(peopleCss, ".planner-lesson-form.people-editor-form footer button.is-secondary")).toContain("border:1px solid transparent");
    expect(block(peopleCss, ".planner-lesson-form.people-editor-form footer button.is-secondary")).toContain("box-shadow:var(--thatcampus-shadow-control)");
  });
  it("keeps participant marking controls inside their rounded painted row at every breakpoint", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/attendance/attendance-participant.css"), "utf8");
    const row = block(css, ".attendance-participant");
    expect(row).toContain("padding: 20px var(--thatcampus-row-inset)");
    expect(row).toContain("border-radius: var(--thatcampus-radius-row)");
    expect(row).toContain("background: var(--thatcampus-surface-row)");
    expect(css).not.toMatch(/\.attendance-participant\s*\{[^}]*padding:\s*20px 0/);
  });
});
