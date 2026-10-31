import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const directory = resolve(process.cwd(), "src/features/office");
const styles = readdirSync(directory).filter((name) => name.endsWith(".css"))
  .map((name) => ({ name, css: readFileSync(resolve(directory, name), "utf8") }));
function lastDeclaration(file: string, selector: string, property: string) {
  const css = styles.find((style) => style.name === file)!.css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1]!.trim().split(/,(?![^()]*\))/).map((part) => part.trim()).includes(selector));
  return blocks.flatMap((match) => [...match[2]!.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "g"))])
    .at(-1)?.[1]?.trim();
}

describe("office appearance contract", () => {
  it("uses the common surface and execution palette in every inventoried style sheet", () => {
    expect(styles.map(style => style.name)).toEqual([
      "campus-observation-sources.css", "campus-operational-signals.css",
      "family-fees.css", "fee-authority.css", "fee-ledger-paging.css", "fees-workspace.css", "finance-arrangements.css",
      "office.css", "operating-rules.css", "person-fees.css",
    ]);
    for (const { name, css } of styles) {
      expect(css, name).not.toMatch(/var\(--appearance-/);
      expect(css, name).not.toMatch(/var\(--thatcampus-(?:blue|success|text-muted|text-secondary|surface-muted)\b/);
      expect(css, name).toContain("--thatcampus-");
    }
  });

  it("preserves the exact monochrome print statement independently of the screen theme", () => {
    const css = styles.find((style) => style.name === "family-fees.css")!.css;
    const start = css.indexOf("@media print {");
    const end = css.indexOf("\n}\n", start) + 3;
    const print = css.slice(start, end);
    expect(createHash("sha256").update(print).digest("hex")).toBe("a825970d091c6e053a106e0638407ce307b074ca2a7460449cc04460240bee51");
    expect(print).toContain("color: #111; background: #fff;");
    expect(css).toContain("@media screen and (max-width: 480px)");
  });

  it("keeps readable fields, touch targets and truthful status colours separate", () => {
    const office = styles.find((style) => style.name === "office.css")!.css;
    const rules = styles.find((style) => style.name === "operating-rules.css")!.css;
    expect(office).toContain("font-size: 16px;");
    expect(office).toContain("min-height: 44px;");
    expect(office).toContain("color: var(--thatcampus-on-action); background: var(--thatcampus-action)");
    expect(rules).toContain(".rule-switch { display: flex; min-width: 51px; min-height: 44px;");
    expect(rules).toContain(".coverage-rule__error { background: var(--thatcampus-danger-soft);");
  });

  it("keeps mobile fee hover surfaces and highlighted details inset from rounded edges", () => {
    for (const [file, selector] of [
      ["family-fees.css", ".family-fee-row"],
      ["fees-workspace.css", ".fee-context-row"],
      ["office.css", ".office-fee-detail.attention-focus"],
      ["office.css", ".office-link-grid a"],
    ]) {
      expect(lastDeclaration(file!, selector!, "padding-inline") ?? lastDeclaration(file!, selector!, "padding"), `${file}: ${selector} inset`).toBe("var(--thatcampus-row-inset)");
      expect(lastDeclaration(file!, selector!, "border-radius"), `${file}: ${selector} radius`).toBe("var(--thatcampus-radius-row)");
    }
    expect(lastDeclaration("family-fees.css", ".family-fee-records li", "background")).toBe("transparent");
    expect(lastDeclaration("office.css", ".office-fee-detail.attention-focus", "margin-inline")).toBe("0");
  });

  it("gives ordinary fee controls depth while preserving actionable card hierarchy", () => {
    for (const selector of [".office-primary", ".office-secondary", ".office-sheet__header > button"]) {
      expect(lastDeclaration("office.css", selector, "border-color"), selector).toBe("transparent");
      expect(lastDeclaration("office.css", selector, "box-shadow"), selector).toBe("var(--thatcampus-shadow-control)");
      expect(lastDeclaration("office.css", `${selector}:active`, "box-shadow"), selector).toBe("var(--thatcampus-shadow-control-pressed)");
    }
    expect(lastDeclaration("office.css", ".office-link-grid a", "box-shadow")).toBe("var(--thatcampus-shadow-card)");
  });
  it("keeps person-first financial controls themed and phone actions inset", () => {
    const css = styles.find(style => style.name === "person-fees.css")!.css;
    expect(css).toContain("color:var(--thatcampus-on-action)");
    expect(css).toContain("box-shadow:var(--thatcampus-shadow-control)");
    expect(css).toContain("padding:20px var(--thatcampus-row-inset)");
    expect(css).toContain("@media(max-width:360px)");
    expect(css).toContain("font-size:16px");
  });
});
