import { ElectiveRuleRefusal, type ElectiveSelection } from "./learning-elective-change.contracts.js";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import { countExpectedOfferingSessionsBefore } from "../schedule-planning/activity-occurrence.engine.js";

/** Immutable review inputs for the existing Learning and Activity owners. */
export interface ElectiveRosterPreview {
  selection: ElectiveSelection;
  fingerprint: string;
  academic_context: { source_revision: number; destination_revision: number };
  schedule: { state: "ready" | "revision_required"; impacts: Array<{
    plan_id: string; revision: number; offering_id: string; title: string; starts_on: string; ends_on: string | null; replacement_starts_on: string;
  }> };
  catch_up: { prior_destination_sessions: number; instructor_person_id: string | null };
  prior_evidence: { attendance_registers: number; assessment_results: number; assignment_attempts: number };
}
export interface ElectiveRosterApplyReceipt {
  source_enrollment_id: string; destination_enrollment_id: string; effective_on: string;
  schedule_revisions: Array<{ previous_plan_id: string; plan_id: string; revision: number; command_id: string }>;
}
export interface ElectiveRosterSourceProof {
  command_id: string; correlation_id: string; change_id: string; finance_decision_id: string;
}

export async function previewOfferingElectiveRoster(tx: Transaction<Database>, schoolId: string, today: string, selection: ElectiveSelection): Promise<ElectiveRosterPreview> {
  if (selection.effective_on <= today) throw new ElectiveRuleRefusal("Choose a future effective date. Earlier teaching and actual evidence are retained.");
  const parents = await tx.selectFrom("learning_offerings").select(["id", "revision", "state"]).where("school_id", "=", schoolId)
    .where("id", "in", [selection.source_offering.id,selection.destination_offering.id]).orderBy("id").forShare().execute();
  for (const selected of [selection.source_offering,selection.destination_offering]) if (!parents.some(row => row.id === selected.id && row.revision === selected.expected_revision && row.state === "active"))
    throw new ElectiveRuleRefusal("A selected course changed or is unavailable. Review its current version.");
  const person = await tx.selectFrom("school_people").select(["id", "revision"]).where("school_id", "=", schoolId).where("id", "=", selection.person.id).where(sql<boolean>`retired_at IS NULL`).forShare().executeTakeFirst();
  if (!person || person.revision !== selection.person.expected_revision) throw new ElectiveRuleRefusal("The selected campus person changed. Review that exact person.");
  const enrollment = await tx.selectFrom("learning_offering_enrollments").selectAll().where("school_id", "=", schoolId).where("offering_id", "=", selection.source_offering.id)
    .where("id", "=", selection.source_enrollment.id).where("person_id", "=", person.id).forShare().executeTakeFirst();
  if (!enrollment || enrollment.revision !== selection.source_enrollment.expected_revision || enrollment.ends_on !== null || enrollment.starts_on > selection.effective_on)
    throw new ElectiveRuleRefusal("Choose the exact open source enrollment and its current revision.");
  const contexts = await tx.selectFrom("learning_offering_academic_contexts as binding").innerJoin("academic_terms as term", "term.id", "binding.term_id")
    .select(["binding.offering_id", "binding.revision", "binding.term_id", "binding.programme_key", "term.starts_on", "term.ends_on"])
    .where("binding.school_id", "=", schoolId).where("offering_id", "in", [selection.source_offering.id,selection.destination_offering.id]).orderBy("offering_id").forShare().execute();
  const source = contexts.find(row => row.offering_id === selection.source_offering.id), destination = contexts.find(row => row.offering_id === selection.destination_offering.id);
  if (!source || !destination || source.term_id !== destination.term_id || source.programme_key && destination.programme_key && source.programme_key !== destination.programme_key
    || selection.effective_on < destination.starts_on || selection.effective_on > destination.ends_on)
    throw new ElectiveRuleRefusal("Choose configured course offerings in the same term and compatible programme, with an effective date inside that term.");
  if (await tx.selectFrom("learning_offering_enrollments").select("id").where("school_id", "=", schoolId).where("offering_id", "=", destination.offering_id)
    .where("person_id", "=", person.id).where(eb => eb.or([eb("ends_on", "is", null),eb("ends_on", ">", selection.effective_on)])).executeTakeFirst())
    throw new ElectiveRuleRefusal("This person already has a destination enrollment covering the change. Review the existing enrollment.");
  const plans = (await sql<{ plan_id: string; revision: number; offering_id: string; title: string; starts_on: string; ends_on: string | null;
    pending: boolean; windows: Array<{ from: string; until: string | null }> }>`SELECT version.id AS plan_id,version.revision,version.offering_id,version.activity_title AS title,
    version.starts_on::text,version.ends_on::text,
    EXISTS(SELECT 1 FROM schedule_versions draft WHERE draft.school_id=version.school_id AND draft.replaces_version_id=version.id AND draft.state='draft') AS pending,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('from',(change.effective_from AT TIME ZONE version.activity_timezone)::date::text,
      'until',(change.effective_until AT TIME ZONE version.activity_timezone)::date::text) ORDER BY change.effective_from)
      FROM schedule_plan_supersessions change WHERE change.school_id=version.school_id AND change.previous_version_id=version.id),'[]'::jsonb) AS windows
    FROM schedule_versions version WHERE version.school_id=${schoolId}::uuid AND version.planning_origin='activity' AND version.state='published'
      AND version.offering_id=ANY(${[source.offering_id,destination.offering_id]}::uuid[]) AND(version.ends_on IS NULL OR version.ends_on>=${selection.effective_on}::date)
    ORDER BY version.id`.execute(tx)).rows;
  const impacts: ElectiveRosterPreview['schedule']['impacts'] = [];
  for (const plan of plans) {
    const from = plan.starts_on > selection.effective_on ? plan.starts_on : selection.effective_on;
    if (plan.windows.some(window => window.from <= from && (window.until === null || plan.ends_on !== null && window.until > plan.ends_on))) continue;
    if (plan.pending || plan.windows.some(window => (!plan.ends_on || window.from <= plan.ends_on) && (!window.until || window.until > from)))
      throw new ElectiveRuleRefusal("An affected course already has another dated timetable change. Finish that change or choose an effective date in its current replacement plan before reviewing this enrollment change.");
    impacts.push({ plan_id: plan.plan_id, revision: plan.revision, offering_id: plan.offering_id, title: plan.title, starts_on: plan.starts_on, ends_on: plan.ends_on, replacement_starts_on: from });
  }
  const prior = (await sql<{ attendance_registers: number; assessment_results: number; assignment_attempts: number; instructor_person_id: string | null }>`SELECT
    (SELECT count(DISTINCT register.id)::int FROM activity_attendance_registers register JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id AND occurrence.school_id=register.school_id
      JOIN schedule_activity_occurrence_people participant ON participant.occurrence_id=occurrence.id AND participant.school_id=occurrence.school_id
      WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.offering_id=${source.offering_id}::uuid AND participant.person_id=${person.id}::uuid
        -- Today may prepare an empty revision0 shell. Only accepted participation
        -- work is prior evidence that changes this reviewed enrollment decision.
        AND register.revision>0 AND occurrence.local_date<${selection.effective_on}::date) AS attendance_registers,
    (SELECT count(*)::int FROM assessment_results result JOIN assessments assessment ON assessment.school_id=result.school_id AND assessment.id=result.assessment_id
      WHERE result.school_id=${schoolId}::uuid AND result.person_id=${person.id}::uuid AND assessment.offering_id=${source.offering_id}::uuid) AS assessment_results,
    (SELECT count(*)::int FROM learning_assignment_attempts attempt JOIN learning_assignments assignment ON assignment.school_id=attempt.school_id AND assignment.id=attempt.assignment_id
      WHERE attempt.school_id=${schoolId}::uuid AND attempt.learner_id=${person.id}::uuid AND assignment.offering_id=${source.offering_id}::uuid) AS assignment_attempts,
    (SELECT appointment.person_id FROM learning_offering_teaching_assignments appointment WHERE appointment.school_id=${schoolId}::uuid
      AND appointment.offering_id=${destination.offering_id}::uuid AND appointment.can_publish AND appointment.starts_on<=${selection.effective_on}::date
      AND(appointment.ends_on IS NULL OR appointment.ends_on>${selection.effective_on}::date) ORDER BY appointment.id LIMIT 1) AS instructor_person_id`.execute(tx)).rows[0]!;
  const priorDestinationSessions=await countExpectedOfferingSessionsBefore(tx,schoolId,destination.offering_id,selection.effective_on);
  const review = { selection, academic_context: { source_revision: source.revision, destination_revision: destination.revision },
    schedule: { state: impacts.length ? "revision_required" as const : "ready" as const, impacts },
    catch_up: { prior_destination_sessions: priorDestinationSessions, instructor_person_id: prior.instructor_person_id },
    prior_evidence: { attendance_registers: prior.attendance_registers, assessment_results: prior.assessment_results, assignment_attempts: prior.assignment_attempts } };
  return { ...review, fingerprint: createHash("sha256").update(JSON.stringify(review)).digest("hex") };
}
