import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function between(contents: string, start: string, end: string) {
  const from = contents.indexOf(start);
  const to = contents.indexOf(end, from + start.length);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing ${end}`).toBeGreaterThan(from);
  return contents.slice(from, to);
}

function expectTwoPhaseOrdering(
  operation: string,
  authoritativeMutation: string,
) {
  const preparation = operation.indexOf(
    "prepareEffectiveCoverageProjection",
  );
  const mutation = operation.indexOf(authoritativeMutation);
  const reconciliation = operation.indexOf("reconcileEffectiveCoverage");
  expect(preparation).toBeGreaterThanOrEqual(0);
  expect(mutation).toBeGreaterThan(preparation);
  expect(reconciliation).toBeGreaterThan(mutation);
  expect(operation.match(/coverageReconciliationInput/g)?.length).toBeGreaterThanOrEqual(3);
}

describe("accepted staff-cover mutation ordering", () => {
  it("bootstraps the current weekly source before timetable publication", () => {
    const operation = between(
      source("../src/schedule-planning/schedule-planning.service.ts"),
      "  publish(req:AuthenticatedRequest,id:string,body:unknown) {",
      "  prepareYear(req:AuthenticatedRequest,body:unknown) {",
    );
    expectTwoPhaseOrdering(
      operation,
      "UPDATE schedule_versions SET state='published'",
    );
  });

  it("bootstraps the current dated source before day-plan publication", () => {
    const operation = between(
      source("../src/day-plans/day-plan.service.ts"),
      "  publish(req: AuthenticatedRequest, id: string, body: unknown) {",
      "  respond(",
    );
    expectTwoPhaseOrdering(
      operation,
      "UPDATE day_plan_versions SET state='superseded'",
    );
  });

  it("bootstraps before a closure hides planned occurrences", () => {
    const contents = source("../src/school/school.service.ts");
    const operation = between(
      contents,
      "  async createSchoolClosure(",
      "  async deleteSchoolClosure(",
    );
    expectTwoPhaseOrdering(
      operation,
      'insertInto("school_calendar_days")',
    );
    expect(operation).toContain("source_record_id: pendingRows[0]!.id");
  });

  it("bootstraps before closure removal restores planned occurrences", () => {
    const contents = source("../src/school/school.service.ts");
    const operation = between(
      contents,
      "  async deleteSchoolClosure(",
      "  private async reconcileLegacyTimetableSubstitutions(",
    );
    expectTwoPhaseOrdering(
      operation,
      'deleteFrom("school_calendar_days")',
    );
  });

  it("takes the school schedule lock before the staff profile row lock", () => {
    const operation = between(
      source("../src/staff-operations/staff-operations.service.ts"),
      "  async updateOnboarding(",
      "  async createResponsibility(",
    );
    expect(operation.indexOf("pg_advisory_xact_lock"))
      .toBeLessThan(operation.indexOf(".forUpdate().executeTakeFirst()"));
    expect(operation.match(/pg_advisory_xact_lock/g)).toHaveLength(1);
  });

  it("bootstraps retained cover before deactivating a staff membership", () => {
    const operation = between(
      source("../src/operations/operations.service.ts"),
      "  async member(",
      "  async revokeInvitation(",
    );
    expectTwoPhaseOrdering(
      operation,
      'updateTable("school_memberships").set({ is_active: data.is_active })',
    );
    expect(operation).toContain("coverage_preparation: coveragePreparation");
  });
});
