import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "migrations", "078_departure_plan_exception_attention.sql"),
  "utf8",
);
const departure = readFileSync(
  join(process.cwd(), "src", "departure-coordination", "departure-coordination.service.ts"),
  "utf8",
);
const projection = readFileSync(
  join(process.cwd(), "src", "attention", "notification-attention.service.ts"),
  "utf8",
);
const materializer = readFileSync(
  join(process.cwd(), "src", "school", "school-event.service.ts"),
  "utf8",
);

describe("durable departure-plan exception attention", () => {
  it("extends the typed contract with one exact parent departure source", () => {
    expect(migration).toContain("'departure_plan_exception'");
    expect(migration).toContain("WHEN 'departure_plan_exception' THEN attention_portal='parent'");
    expect(migration).toContain("attention_module='departure'");
    expect(materializer).toContain("'departure_plan_exception'");
    expect(materializer).toContain("WHEN 'departure_plan_exception' THEN role_context.portal='parent'");
  });

  it("rechecks the exact current unresolved plan and live guardian access", () => {
    expect(migration).toContain("CREATE FUNCTION notification_departure_plan_exception_is_currently_authorized(");
    for (const evidence of [
      "account.is_active",
      "membership.is_active",
      "relationship.student_id=plan.student_id",
      "plan.is_current",
      "plan.state='exception'",
      "plan.revision=notification.attention_source_revision",
      "notification.recipient_id=actor",
    ]) expect(migration).toContain(evidence);
    expect(migration).toContain("IF notification_source_kind='departure_plan_exception' THEN");
    expect(migration).toContain("RETURN notification_departure_plan_exception_is_currently_authorized(");
    expect(projection).toContain("WHEN notification.attention_source_kind='departure_plan_exception' THEN");
    expect(projection).not.toMatch(
      /AND notification_attention_is_currently_authorized\([\s\S]{0,180}\$\{parentScope\}[\s\S]{0,180}WHEN notification\.attention_source_kind='departure_plan_exception'/,
    );
  });

  it("raises exceptions from every authoritative transition with an exact destination", () => {
    expect(departure).toContain('sourceKind:"departure_plan_exception"');
    expect(departure).toContain('action:"collection_authority_revoked"');
    expect(departure).toContain('action:"transport_trip_cancelled"');
    expect(departure).toContain("riderExceptions.push(updated)");
    expect(departure).toContain('sourceKind:"transport_rider_exception"');
    for (const parameter of ["student_id=", "date=", "plan_id=", "plan_revision="]) {
      expect(departure).toContain(parameter);
    }
  });

  it("does not duplicate a cancelled afternoon journey for learners with affected plans", () => {
    expect(departure).toContain("const affectedPlanStudents=new Set(affectedPlans.map(plan=>plan.student_id))");
    expect(departure).toContain("[...new Set(students)].filter(id=>!affectedPlanStudents.has(id))");
    expect(departure.indexOf("affectedPlanStudents")).toBeLessThan(
      departure.indexOf('sourceKind:"transport_trip_cancellation"'),
    );
  });

  it("backfills only authoritative current future exceptions", () => {
    expect(migration).toContain("FROM departure_plans plan");
    expect(migration).toContain("WHERE plan.is_current");
    expect(migration).toContain("AND plan.state='exception'");
    expect(migration).toContain("AND plan.service_date >= (now() AT TIME ZONE school.timezone)::date");
    expect(migration).not.toMatch(/notification\.(title|body)\s*(=|LIKE|~)/);
  });
});
