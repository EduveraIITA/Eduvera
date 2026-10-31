import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const folders = ["staff-operations", "organization", "roles", "governance", "gate", "departure", "operating-day", "setup", "institutions", "campus-view", "coordination"];
const sheets = folders.flatMap((folder) => {
  const directory = resolve(process.cwd(), "src/features", folder);
  return readdirSync(directory).filter((file) => file.endsWith(".css"))
    .map((file) => ({ name: `${folder}/${file}`, css: readFileSync(resolve(directory, file), "utf8") }));
});
function lastDeclaration(sheet: string, selector: string, property: string) {
  const css = sheets.find((item) => item.name === sheet)!.css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1]!.trim().split(/,(?![^()]*\))/).map((part) => part.trim()).includes(selector));
  return blocks.flatMap((match) => [...match[2]!.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "g"))])
    .at(-1)?.[1]?.trim();
}

describe("operational feature theme contract", () => {
  it("resolves owned feature colours through the common appearance and execution tokens", () => {
    expect(sheets).toHaveLength(15);
    for (const sheet of sheets) {
      expect(sheet.css, sheet.name).not.toMatch(/var\(--appearance-/);
      expect(sheet.css, sheet.name).toContain("--thatcampus-");
    }
  });

  it("pairs filled operational actions with the shared on-action colour", () => {
    for (const name of ["staff-operations/staff-operations.css", "organization/organization.css", "governance/governance.css", "departure/departure.css", "setup/setup-workspace.css", "institutions/institutions.css", "coordination/followups.css"]) {
      const css = sheets.find((sheet) => sheet.name === name)!.css;
      expect(css, name).toContain("background: var(--thatcampus-action)");
      expect(css, name).toContain("color: var(--thatcampus-on-action)");
    }
  });

  it("styles the actual policy links and plain acknowledgement note, not a legacy hero", () => {
    const css = sheets.find((sheet) => sheet.name === "governance/governance.css")!.css;
    expect(css).toContain(".policy-library__item > a { display: grid;");
    expect(css).toContain(".policy-library__intro { display: block;");
    expect(css).toContain(".governance-rule-detail dl");
  });

  it("keeps filled and highlighted row content inside shared rounded edges", () => {
    for (const [sheet, selector] of [
      ["roles/roles.css", ".roles-duty"],
      ["gate/gate.css", ".gate-approval-row"],
      ["campus-view/campus-kpi.css", ".campus-scenario-entry"],
      ["operating-day/operating-day.css", ".operating-day__review"],
      ["staff-operations/assignment-overview.css", ".staff-assignment-scope.is-attention-target"],
    ]) {
      expect(lastDeclaration(sheet!, selector!, "padding-inline") ?? lastDeclaration(sheet!, selector!, "padding"), `${sheet}: ${selector} inset`).toBe("var(--thatcampus-row-inset)");
      expect(lastDeclaration(sheet!, selector!, "border-radius"), `${sheet}: ${selector} radius`).toBe("var(--thatcampus-radius-row)");
    }
    for (const [sheet, selector] of [
      ["governance/governance.css", ".policy-library__item"],
      ["gate/gate.css", ".gate-visitor-card"],
      ["coordination/followups.css", ".followup-list > article"],
    ]) expect(lastDeclaration(sheet!, selector!, "background"), `${sheet}: ${selector} remains flat`).toBe("transparent");
  });

  it("uses subtle control depth instead of decorative borders without elevating every row", () => {
    for (const [sheet, selector] of [
      ["staff-operations/staff-operations.css", ".staff-secondary"],
      ["organization/organization.css", ".org-secondary"],
      ["governance/governance.css", ".governance-secondary"],
      ["gate/gate.css", ".gate-shell .gate-search-submit"],
      ["gate/visitor-approvals.css", ".gate-approval-actions button"],
      ["departure/departure.css", ".departure-page button.departure-primary"],
      ["setup/setup-workspace.css", ".setup-workspace__start > a"],
      ["institutions/institutions.css", ".institution-panel .institution-primary"],
      ["coordination/followups.css", ".followup-secondary"],
      ["campus-view/campus-kpi.css", ".campus-scenario-run"],
    ]) {
      expect(lastDeclaration(sheet!, selector!, "border-color"), `${sheet}: ${selector} border`).toBe("transparent");
      expect(lastDeclaration(sheet!, selector!, "box-shadow"), `${sheet}: ${selector} depth`).toBe("var(--thatcampus-shadow-control)");
      expect(lastDeclaration(sheet!, `${selector}:active`, "box-shadow"), `${sheet}: ${selector} pressed`).toBe("var(--thatcampus-shadow-control-pressed)");
    }
  });
});
