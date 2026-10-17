import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { staffCoverageCommandHash } from "../src/staff-operations/staff-operations.service.js";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/113_staff_coverage_effective_timetable.sql"),
  "utf8",
);
const service = readFileSync(
  resolve(process.cwd(), "src/staff-operations/staff-operations.service.ts"),
  "utf8",
);
const schedule = readFileSync(
  resolve(process.cwd(), "src/day-plans/schedule.ts"),
  "utf8",
);

describe("accepted staff cover becomes effective timetable truth", () => {
  it("hashes the exact actor response material deterministically", () => {
    const taskId = "11111111-1111-4111-8111-111111111111";
    const left = staffCoverageCommandHash("respond", taskId, {
      expected_revision: 2,
      note: "Handover reviewed",
      decision: "accepted",
    });
    const same = staffCoverageCommandHash("respond", taskId, {
      decision: "accepted",
      note: "Handover reviewed",
      expected_revision: 2,
    });
    const changed = staffCoverageCommandHash("respond", taskId, {
      decision: "declined",
      note: "Handover reviewed",
      expected_revision: 2,
    });
    expect(left).toBe(same);
    expect(changed).not.toBe(left);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });

  it("retains tenant-safe occurrence provenance and idempotent audit evidence", () => {
    expect(migration).toContain("CREATE TABLE public.staff_timetable_substitutions");
    expect(migration).toContain("source_occurrence_key char(64) NOT NULL");
    expect(migration).toContain("source_kind IN ('daily_plan','published_timetable','legacy_timetable')");
    expect(migration).toContain("source_record_id uuid NOT NULL");
    expect(migration).toContain("source_revision integer NOT NULL");
    expect(migration).toContain("UNIQUE(school_id,coverage_task_id)");
    expect(migration).toContain("staff_timetable_substitutions_effective_occurrence");
    expect(migration).toContain("REFERENCES public.staff_coverage_tasks(id,school_id) ON DELETE RESTRICT");
    expect(migration).toContain("REFERENCES public.staff_profiles(id,school_id) ON DELETE RESTRICT");
    expect(migration).toContain("CREATE TABLE public.staff_coverage_commands");
    expect(migration).toContain("UNIQUE(school_id,actor_id,command_id)");
    expect(migration).toContain("authority_receipt jsonb NOT NULL");
    expect(migration).toContain("schedule_provenance jsonb NOT NULL");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE FUNCTION public.planned_school_schedule_v2");
    expect(migration).toContain("status<>'cancelled'");
    expect(migration).toContain("NEW.accepted_by IS DISTINCT FROM NEW.replacement_teacher_user_id");
    expect(migration).toContain("staff_timetable_substitution_delete_guard");
  });

  it("separates planned truth from effective staffing and exposes the explanation contract", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.effective_school_schedule(p_school uuid,p_date date)");
    expect(migration).toContain("FROM public.planned_school_schedule_v2(p_school,p_date) planned");
    expect(migration).toContain("substitution.source_schedule_id=planned.id");
    expect(migration).toContain("substitution.starts_at=planned.starts_at");
    expect(migration).toContain("substitution.ends_at=planned.ends_at");
    expect(migration).toContain("WHEN active_replacement.user_id IS NOT NULL THEN active_replacement.user_id");
    expect(migration).toContain("ELSE NULL::uuid");
    expect(migration).toContain("ELSE 'unassigned'::text");
    expect(migration).toContain("CREATE FUNCTION public.effective_school_schedule_v3");
    expect(migration).toContain("substitution.source_revision=schedule.source_revision");
    expect(schedule).toContain("effective_school_schedule_v3");
  });

  it("does not turn an unaccepted dated assignment into class authority", () => {
    const assignmentResolver = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.schedule_teacher_assigned"),
      migration.indexOf("ALTER TABLE public.staff_timetable_substitutions ENABLE ROW LEVEL SECURITY"),
    );
    expect(assignmentResolver).toContain(
      "schedule.coverage_status IN ('not_required','accepted')",
    );
  });

  it("keeps elapsed accepted cover historical while reconciling ineligible future cover", () => {
    expect(migration).toMatch(
      /p_date<\(\s*SELECT \(now\(\) AT TIME ZONE school\.timezone\)::date/,
    );
    expect(migration).toContain(
      "substitution.duty_date>=(now() AT TIME ZONE school.timezone)::date",
    );
    expect(migration).toContain("ELSE 'replacement_unavailable'");
    expect(migration).toContain(
      "CREATE FUNCTION public.reconcile_staff_timetable_substitution_details",
    );
    expect(migration).toContain(
      "RETURNS TABLE(substitution_id uuid,coverage_task_id uuid,reason text)",
    );
    expect(migration).toContain(
      "FROM public.reconcile_staff_timetable_substitution_details(",
    );
  });

  it("treats closures as temporary conditions and never prospectively rewrites completed cover", () => {
    const reconciliation = migration.slice(
      migration.indexOf("CREATE FUNCTION public.reconcile_staff_timetable_substitution_details"),
      migration.indexOf("-- Compatibility wrapper retained"),
    );
    expect(reconciliation).toContain("FROM public.school_calendar_days closure");
    expect(reconciliation).toContain("AND NOT closure.is_instructional");
    expect(reconciliation).toContain("JOIN public.staff_coverage_tasks current_task");
    expect(reconciliation).toContain("AND current_task.status='accepted'");
    expect(reconciliation).not.toContain("task.status IN ('accepted','completed')");
  });

  it("checks replay before workflow state and revalidates the source before accepting", () => {
    const response = service.slice(
      service.indexOf("async respondCoverage"),
      service.indexOf("async withdrawLeave"),
    );
    expect(response.indexOf("priorCoverageCommand")).toBeGreaterThanOrEqual(0);
    expect(response.indexOf("priorCoverageCommand")).toBeLessThan(response.indexOf('task.status !== "offered"'));
    expect(response.indexOf("planned_school_schedule_v2")).toBeLessThan(response.indexOf('.set({ status: data.decision'));
    expect(response.indexOf("staff_timetable_substitutions")).toBeGreaterThan(response.indexOf('.set({ status: data.decision'));
    expect(response).toContain("The timetable occurrence changed after this cover was offered");
    expect(response).toContain("exact_configured_coverage_offer_recipient");
    expect(response).toContain("exact_manual_coverage_task_recipient");
    expect(response).toContain("effective_timetable: true");
  });

  it("reconciles future accepted cover when onboarding removes replacement eligibility", () => {
    const onboarding = service.slice(
      service.indexOf("async updateOnboarding"),
      service.indexOf("async createResponsibility"),
    );
    const prepareAt = onboarding.indexOf("prepareEffectiveCoverageProjection");
    const statusWriteAt = onboarding.indexOf('updateTable("staff_profiles")');
    const reconcileAt = onboarding.indexOf("reconcileEffectiveCoverage");
    expect(onboarding).toContain('profile.status === "active" && nextStatus !== "active"');
    expect(onboarding).toContain("pg_advisory_xact_lock");
    expect(onboarding).toContain("staff_profile_eligibility_changed");
    expect(prepareAt).toBeGreaterThanOrEqual(0);
    expect(prepareAt).toBeLessThan(statusWriteAt);
    expect(reconcileAt).toBeGreaterThan(statusWriteAt);
    expect(onboarding).toContain("coverage_preparation: coveragePreparation");
    expect(onboarding).toContain("coverage_reconciliation: coverageReceipt");
  });

  it("does not invent an automatic replacement or fallback", () => {
    expect(migration).not.toMatch(/replacement_teacher_user_id[^\n]*DEFAULT/i);
    expect(migration).not.toMatch(/original_teacher_user_id[^\n]*DEFAULT/i);
    expect(service).not.toContain("defaultReplacement");
    expect(service).not.toContain("automaticReplacement");
  });
});
