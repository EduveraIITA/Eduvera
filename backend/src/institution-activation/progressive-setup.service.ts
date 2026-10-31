import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { retainOperatingDestination } from "../institution-onboarding/operating-resume.js";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { AuthUser, AuthenticatedRequest } from "../common/request.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { TEMPORAL_CONTEXT_PORT, type TemporalContextPort } from "../campus-model-core/temporal-context.port.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { institutionSchoolPermission } from "../roles/authorization.js";
import { readParticipationFinalization } from "../attendance/participation-finalization.js";
import { ensureOperationalStaffProfile } from "../staff-operations/operational-staff-profile.js";
import { readTimetablePlanningReadiness, type TimetableOperationReadiness } from "../schedule-planning/activity-planning-readiness.js";
import { readAssignmentsReadiness, type AssignmentsOperationReadiness } from "../learning/learning-assignment-readiness.js";
import { readFeesReadiness, type FeesOperationReadiness } from "../operations/fees-first-readiness.js";
import { readResourceLoansReadiness, type ResourceLoansOperationReadiness } from "../resource-loans/resource-loan-readiness.js";
import { readFacilitiesReadiness, type FacilitiesOperationReadiness } from "../institution-onboarding/facilities-readiness.js";
import { readAccommodationReadiness, type AccommodationOperationReadiness } from "../institution-onboarding/accommodation-readiness.js";
import { readDiningReadiness, type DiningOperationReadiness } from "../institution-onboarding/dining-readiness.js";
import {
  attendanceProgressiveSetupSchema, datePlusDays, gateProgressiveSetupSchema,
  institutionLocalDate, institutionLocalWeekday, progressiveCapabilitySchema,
  type AttendanceOperationReadiness, type ProgressiveCapability,
} from "./progressive-setup.contracts.js";

type Readiness = {
  capability: ProgressiveCapability; label: string; status: "working" | "needs_setup";
  destination: string; setup_path: string; counts: Record<string, number>;
  missing: Array<{ key: string; label: string; reason: string; destination: string }>;
  operation?: AttendanceOperationReadiness;
  timetable_operation?: TimetableOperationReadiness;
  assignments_operation?: AssignmentsOperationReadiness;
  fees_operation?: FeesOperationReadiness;
  resources_operation?: ResourceLoansOperationReadiness;
  facilities_operation?: FacilitiesOperationReadiness;
  accommodation_operation?: AccommodationOperationReadiness;
  dining_operation?: DiningOperationReadiness;
};
type Db = DatabaseService | Transaction<Database>;

const definitions: Record<ProgressiveCapability, { label: string; destination: string }> = {
  attendance: { label: "Attendance", destination: "/areas/attendance/registers" },
  gate: { label: "Entry & exit", destination: "/areas/in-out/operate" },
  timetable: { label: "Timetable", destination: "/areas/timetable/planning" },
  assignments: { label: "Assignments", destination: "/areas/messages/assignments" },
  fees: { label: "Fees & receipts", destination: "/areas/fees/ledger" },
  resources: { label: "Resources & borrowing", destination: "/areas/resources" },
  facilities: { label: "Repairs & maintenance", destination: "/areas/facilities" },
  accommodation: { label: "Accommodation", destination: "/areas/accommodation" },
  dining: { label: "Dining", destination: "/areas/dining" },
  examinations: { label: "Examinations", destination: "/areas/assessments/manage" },
  performance: { label: "Student performance", destination: "/areas/assessments/manage" },
  staff: { label: "Staff coordination", destination: "/more/setup/responsibilities" },
  messages: { label: "Messages & family communication", destination: "/areas/messages/conversations" },
};

@Injectable()
export class ProgressiveSetupService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commandGateway: DomainCommandGatewayPort,
    @Inject(TEMPORAL_CONTEXT_PORT) private readonly temporal: TemporalContextPort,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
  ) {}

  private setupPath(capability: ProgressiveCapability) { return `/more/setup/capabilities?task=${capability}`; }

  private async access(user: AuthUser, schoolId: string) {
    await institutionSchoolPermission(this.db, user, schoolId, "sis.manage");
    const school = await this.db.selectFrom("schools").select(["id", "name", "timezone"]).where("id", "=", schoolId).executeTakeFirst();
    if (!school) throw new NotFoundException("Institution not found.");
    return school;
  }

  /**
   * An administrator seeing campus setup does not become the activity's operator.
   * Read the published appointment and current permission together, keeping old
   * submitted registers discoverable after their plan's final date.
   */
  private async attendanceOperation(user: AuthUser, schoolId: string, db: Db, at: string) {
    const identity = await this.identities.resolveAccountEndpoint(db as Transaction<Database>, {
      school_id: schoolId, user_id: user.id, at,
    });
    if (!identity.acting) return null;
    const occurrences = (await sql<{
      id: string; local_date: string; revision: number; starts_at: Date | string;
      register_id: string | null; register_revision: number | null; state: "draft" | "submitted" | "locked";
      can_record: boolean; can_review: boolean;
    }>`WITH permitted AS (
      SELECT occurrence.id,occurrence.local_date::text,occurrence.revision,occurrence.starts_at,
        register.id AS register_id,register.revision AS register_revision,COALESCE(register.state,'draft') AS state,
        bool_or(appointment.action='record' AND (EXISTS(SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=occurrence.school_id AND membership.user_id=${user.id}::uuid
            AND membership.is_active AND membership.role='admin')
          OR staff_has_resource_permission(occurrence.school_id,${user.id}::uuid,'attendance.record','institution',occurrence.school_id,
            (${at}::timestamptz AT TIME ZONE occurrence.timezone)::date))) AS can_record,
        bool_or(appointment.action='review' AND (EXISTS(SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=occurrence.school_id AND membership.user_id=${user.id}::uuid
            AND membership.is_active AND membership.role='admin')
          OR staff_has_resource_permission(occurrence.school_id,${user.id}::uuid,'attendance.review','institution',occurrence.school_id,
            (${at}::timestamptz AT TIME ZONE occurrence.timezone)::date))) AS can_review
      FROM schedule_activity_occurrences occurrence
      JOIN schedule_versions plan ON plan.school_id=occurrence.school_id AND plan.id=occurrence.plan_version_id
      JOIN schedule_activity_occurrence_recorders appointment ON appointment.school_id=occurrence.school_id
        AND appointment.occurrence_id=occurrence.id AND appointment.person_id=${identity.person_id}::uuid
      LEFT JOIN activity_attendance_registers register ON register.school_id=occurrence.school_id AND register.occurrence_id=occurrence.id
      WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.source='activity'
        AND occurrence.attendance_mode='roll_call' AND occurrence.state='expected'
        AND (plan.state='published' OR (plan.state='cancelled' AND occurrence.starts_at<plan.cancelled_at))
        AND EXISTS(SELECT 1 FROM schedule_activity_occurrence_people participant
          WHERE participant.school_id=occurrence.school_id AND participant.occurrence_id=occurrence.id AND participant.attendance_expected)
      GROUP BY occurrence.id,register.id
    ) SELECT * FROM permitted WHERE can_record OR can_review
      ORDER BY CASE WHEN state='submitted' AND can_review THEN 0
        WHEN state='draft' AND can_record AND starts_at<=${at}::timestamptz THEN 1
        WHEN state='draft' AND can_record THEN 2 WHEN state='draft' THEN 3 ELSE 4 END,
        CASE WHEN state='locked' THEN starts_at END DESC,starts_at,id`.execute(db)).rows;
    const finalization = await readParticipationFinalization(db, this.identities, schoolId,
      occurrences.filter(item => item.state === "submitted" && item.register_id).map(item => item.register_id!), at);
    // A future automatic outcome is viewable context, not this person's first
    // required review. Preserve the original ordering within each priority.
    const occurrence = occurrences.find(item => item.state === "submitted" && item.can_review
      && finalization.get(item.register_id!)?.state !== "automatic_pending")
      ?? occurrences.find(item => item.state === "draft" && item.can_record)
      ?? occurrences[0];
    if (occurrence) {
      const automaticPending = finalization.get(occurrence.register_id!)?.state === "automatic_pending";
      const action = occurrence.state === "submitted" && occurrence.can_review && !automaticPending ? "review"
        : occurrence.state === "draft" && occurrence.can_record ? "record" : "view";
      const startsAt = new Date(occurrence.starts_at).toISOString();
      const state: AttendanceOperationReadiness["state"] = occurrence.state === "locked" ? "complete"
        : automaticPending ? "automatic_pending"
        : action === "review" ? "ready"
          : action === "record" ? startsAt > at ? "opens_later" : "ready"
            : occurrence.state === "submitted" ? "waiting_for_review" : "waiting_for_recorder";
      return {
        destination: `/areas/attendance/registers?date=${occurrence.local_date}&occurrence_id=${occurrence.id}`,
        operation: { actor_user_id: user.id, action, state,
          scope: { kind: "occurrence", id: occurrence.id, date: occurrence.local_date },
          source_revision: occurrence.revision, register_revision: occurrence.register_revision,
          evaluated_at: at, starts_at: startsAt, requires_recheck: true } satisfies AttendanceOperationReadiness,
      };
    }
    // Retained class/day setup is a compatibility path, not evidence that this
    // actor can record every class because one class exists somewhere on campus.
    const assigned = (await sql<{ id: string; date: string }>`SELECT section.id,next.date::text
      FROM class_section_staff_assignments assignment
      JOIN class_sections section ON section.school_id=assignment.school_id AND section.id=assignment.class_section_id
      JOIN schools institution ON institution.id=section.school_id
      JOIN academic_terms term ON term.school_id=section.school_id AND term.academic_year=section.academic_year
      JOIN timetable_slots slot ON slot.class_section_id=section.id AND slot.term_id=term.id AND slot.slot_type IN ('class','activity')
      CROSS JOIN LATERAL (SELECT (${at}::timestamptz AT TIME ZONE institution.timezone)::date AS date) today
      CROSS JOIN LATERAL (SELECT today.date+((slot.weekday-extract(isodow FROM today.date)::int+7)%7) AS date) next
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.user_id=${user.id}::uuid AND assignment.ended_at IS NULL
        AND assignment.valid_from<=today.date AND (assignment.valid_until IS NULL OR assignment.valid_until>=today.date)
        AND assignment.valid_from<=next.date AND (assignment.valid_until IS NULL OR assignment.valid_until>=next.date)
        AND next.date BETWEEN term.starts_on AND term.ends_on
        AND NOT EXISTS(SELECT 1 FROM institution_operating_rules rules WHERE rules.school_id=section.school_id AND rules.attendance_academic_mode='none')
        AND staff_has_class_permission(section.school_id,${user.id}::uuid,'attendance.record',section.id,today.date)
        AND staff_has_class_permission(section.school_id,${user.id}::uuid,'attendance.record',section.id,next.date)
        AND EXISTS(SELECT 1 FROM enrollments enrollment WHERE enrollment.class_section_id=section.id AND enrollment.is_active)
      ORDER BY next.date,section.id LIMIT 1`.execute(db)).rows[0];
    return assigned ? {
      destination: `/areas/attendance/registers?class_section_id=${assigned.id}&date=${assigned.date}`,
      operation: { actor_user_id: user.id, action: "record", state: "requires_domain_check",
        scope: { kind: "class", id: assigned.id, date: assigned.date }, source_revision: null, register_revision: null,
        evaluated_at: at, starts_at: null, requires_recheck: true } satisfies AttendanceOperationReadiness,
    } : null;
  }

  private async readiness(user: AuthUser, schoolId: string, db: Db = this.db): Promise<Readiness[]> {
    const at = executionNow().toISOString();
    const attendance = await this.attendanceOperation(user, schoolId, db, at);
    const timetable = await readTimetablePlanningReadiness(db, this.identities, user, schoolId);
    const assignments = await readAssignmentsReadiness(db, this.identities, user, schoolId);
    const fees = await readFeesReadiness(db, this.identities, user, schoolId);
    const resources = await readResourceLoansReadiness(db, this.identities, user, schoolId);
    const facilities = await readFacilitiesReadiness(db, this.identities, user, schoolId);
    const accommodation = await readAccommodationReadiness(db, this.identities, user, schoolId);
    const dining = await readDiningReadiness(db, this.identities, user, schoolId);
    const c = (await sql<Record<string, number>>`SELECT
      (SELECT count(*)::int FROM schedule_versions plan JOIN schools school ON school.id=plan.school_id
        WHERE plan.school_id=${schoolId}::uuid AND plan.planning_origin='activity' AND plan.state='published'
          AND (plan.ends_on IS NULL OR plan.ends_on>=(${at}::timestamptz AT TIME ZONE school.timezone)::date)
          AND NOT EXISTS(SELECT 1 FROM schedule_plan_supersessions replacement WHERE replacement.school_id=plan.school_id
            AND replacement.previous_version_id=plan.id AND replacement.effective_from<=${at}::timestamptz
            AND (replacement.effective_until IS NULL OR replacement.effective_until>${at}::timestamptz))) activities,
      (SELECT count(*)::int FROM schedule_versions plan JOIN schools school ON school.id=plan.school_id
        WHERE plan.school_id=${schoolId}::uuid AND plan.planning_origin='activity' AND plan.state='published'
          AND plan.attendance_mode='roll_call' AND plan.recorder_person_id IS NOT NULL AND plan.reviewer_person_id IS NOT NULL
          AND (plan.ends_on IS NULL OR plan.ends_on>=(${at}::timestamptz AT TIME ZONE school.timezone)::date)
          AND NOT EXISTS(SELECT 1 FROM schedule_plan_supersessions replacement WHERE replacement.school_id=plan.school_id
            AND replacement.previous_version_id=plan.id AND replacement.effective_from<=${at}::timestamptz
            AND (replacement.effective_until IS NULL OR replacement.effective_until>${at}::timestamptz))) participation_plans,
      (SELECT count(*)::int FROM class_sections WHERE school_id=${schoolId}::uuid) classes,
      (SELECT count(*)::int FROM students WHERE school_id=${schoolId}::uuid) students,
      (SELECT count(*)::int FROM enrollments e JOIN class_sections x ON x.id=e.class_section_id WHERE x.school_id=${schoolId}::uuid AND e.is_active) enrollments,
      (SELECT count(*)::int FROM timetable_slots t JOIN class_sections x ON x.id=t.class_section_id WHERE x.school_id=${schoolId}::uuid) sessions,
      (SELECT count(*)::int FROM timetable_slots t JOIN class_sections x ON x.id=t.class_section_id WHERE x.school_id=${schoolId}::uuid AND t.slot_type='class') teaching_sessions,
      (SELECT count(DISTINCT x.id)::int FROM class_sections x
        WHERE x.school_id=${schoolId}::uuid
          AND EXISTS(SELECT 1 FROM enrollments e WHERE e.class_section_id=x.id AND e.is_active)
          AND EXISTS(SELECT 1 FROM timetable_slots t JOIN academic_terms term ON term.id=t.term_id
            WHERE t.class_section_id=x.id AND term.school_id=x.school_id AND term.academic_year=x.academic_year)) ready_attendance_groups,
      (SELECT count(*)::int FROM campus_spaces WHERE school_id=${schoolId}::uuid AND kind='gate' AND status='active') gates,
      (SELECT count(*)::int FROM staff_profiles WHERE school_id=${schoolId}::uuid AND status='active') staff,
      (SELECT count(*)::int FROM subjects WHERE school_id=${schoolId}::uuid) subjects,
      (SELECT count(*)::int FROM assessments WHERE school_id=${schoolId}::uuid AND status<>'cancelled') assessments,
      (SELECT count(*)::int FROM assessment_invigilation_policy_current current
        JOIN assessment_invigilation_policy_versions policy ON policy.id=current.policy_version_id AND policy.school_id=current.school_id
        WHERE current.school_id=${schoolId}::uuid AND policy.enabled AND EXISTS(
          SELECT 1 FROM assessment_invigilation_policy_recipients recipient
          JOIN school_memberships membership ON membership.school_id=recipient.school_id AND membership.user_id=recipient.user_id
            AND membership.is_active AND membership.role IN ('admin','staff')
          WHERE recipient.school_id=current.school_id AND recipient.policy_version_id=policy.id
            AND campus_model_account_person_is_active(current.school_id,recipient.user_id,recipient.person_id,${at}::timestamptz))) invigilation_ready,
      (SELECT count(*)::int FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id WHERE a.school_id=${schoolId}::uuid) results,
      (SELECT count(DISTINCT user_id)::int FROM school_memberships WHERE school_id=${schoolId}::uuid AND is_active) members,
      (SELECT count(*)::int FROM chat_conversations WHERE school_id=${schoolId}::uuid) conversations`.execute(db)).rows[0] ?? {};
    const count = (key: string) => Number(c[key] ?? 0);
    const missing = (key: string, label: string, reason: string, destination: string) => ({ key, label, reason, destination });
    const rows: Array<[ProgressiveCapability, boolean, Record<string, number>, Readiness["missing"]]> = [
      ["attendance", Boolean(attendance),
        { groups: count("classes"), ready_groups: count("ready_attendance_groups"), participants: count("students"), rostered: count("enrollments"), sessions: count("sessions"), activities: count("participation_plans") },
        attendance ? [] : [missing("activity", count("participation_plans") || count("ready_attendance_groups") ? "Your attendance responsibility" : "First activity",
          count("participation_plans") || count("ready_attendance_groups") ? "Choose an activity you’ll record or review."
            : "Choose the activity and people whose participation you’ll record.", "/areas/timetable/planning?create=attendance")]],
      ["gate", count("gates") > 0, { entry_points: count("gates") }, !count("gates") ? [missing("entry_point", "Entry point", "Name the gate or entry point people use.", this.setupPath("gate"))] : []],
      ["timetable", timetable.operation.action === "view",
        { groups: count("classes"), sessions: count("teaching_sessions"), activities: count("activities") },
        timetable.operation.action === "view" ? [] : [missing("activity",
          timetable.operation.action === "continue" ? "Your draft activity" : timetable.operation.action === "create" ? "First activity" : "Your timetable access",
          timetable.operation.action === "continue" ? "Continue the activity you saved."
            : timetable.operation.action === "create" ? "Schedule a lesson, duty, meeting or another campus activity." : "Ask the campus administrator for the right responsibility.",
          timetable.destination)]],
      ["assignments", assignments.operation.state === "published", {},
        assignments.operation.state === "published" ? [] : [missing("assignment",
          assignments.operation.state === "draft" ? "Your draft assignment" : "Assignments",
          assignments.operation.state === "draft" ? "Continue the assignment you saved."
            : assignments.operation.state === "unavailable" ? "Review your current assignment responsibility."
              : "Start with one learning group and its people.", "/areas/messages/assignments")]],
      ["fees", fees.operation.state === "charge_recorded", {},
        fees.operation.state === "charge_recorded" ? [] : [missing("charge", "First charge",
          fees.operation.state === "unavailable" ? "Review your current Finance access."
            : "Choose a person and record a charge. No class or term is needed.", fees.operation.destination)]],
      ["resources", resources.operation.action === "view", {}, resources.operation.action === "view" ? []
        : [missing("loan", "First loan", resources.operation.action === "unavailable"
          ? "Review your borrowing responsibility or current person link."
          : "Start with one item, one person and a due date.", resources.operation.destination)]],
      ["facilities", facilities.operation.state === "repair_recorded", {}, facilities.operation.state === "repair_recorded" ? []
        : [missing("repair", facilities.operation.action === "configure" ? "Repair intake" : "First repair",
          facilities.operation.action === "configure" ? "Choose who receives repairs and who checks the result."
            : facilities.operation.action === "unavailable" ? "Ask your campus to confirm the repair handler and your current access."
              : "Report one problem. No complete building or item catalogue is needed.", facilities.operation.destination)]],
      ["accommodation", accommodation.operation.state === "arrangement_recorded", {}, accommodation.operation.state === "arrangement_recorded" ? []
        : [missing("stay", accommodation.operation.state === "offer_recorded" ? "Your accommodation offer"
          : accommodation.operation.action === "configure" ? "First room" : "First arrangement",
          accommodation.operation.state === "offer_recorded" ? "Follow the offered place. An offer is not yet an accepted arrangement."
            : accommodation.operation.action === "configure" ? "Register one room and its sleeping capacity."
              : accommodation.operation.action === "unavailable" ? "Review your accommodation responsibility or own stay."
                : "Offer one place to a person. No hostel tree or repair is required.", accommodation.operation.destination)]],
      ["dining", dining.operation.state === "menu_published", {}, dining.operation.state === "menu_published" ? []
        : [missing("menu", dining.operation.state === "draft_recorded" ? "Your draft menu"
          : dining.operation.action === "configure" ? "First dining service" : "First menu",
          dining.operation.state === "draft_recorded" ? "Continue the menu you saved."
            : dining.operation.action === "configure" ? "Name one service and choose its coordinator."
              : dining.operation.action === "unavailable" ? "Review your current dining responsibility."
                : "Publish one menu with serving hours. No hostel or payment setup is required.", dining.operation.destination)]],
      ["examinations", count("enrollments") > 0 && count("subjects") > 0 && count("assessments") > 0 && count("invigilation_ready") > 0,
        { candidates: count("enrollments"), subjects: count("subjects"), assessments: count("assessments"), invitations_ready: count("invigilation_ready") },
        !count("enrollments") ? [missing("candidates", "Candidate group", "Choose the people taking this exam.", "/areas/people/records")]
          : !count("subjects") ? [missing("assessment", "Assessment subject", "Add the subject for this exam.", "/more/setup/institution/academics")]
          : !count("invigilation_ready") ? [missing("invigilation_invitations", "Invigilation invitations", "Approve invitation rules and choose eligible recipients before assigning examination duties.", `/more/setup/institution/operating-rules?school=${schoolId}&rule=examinations`)]
          : !count("assessments") ? [missing("plan", "Examination plan", "Create your first examination plan.", "/areas/assessments/manage")] : []],
      ["performance", count("students") > 0 && count("results") > 0, { participants: count("students"), recorded_results: count("results") }, !count("students") ? [missing("participants", "Participants", "Add learners to follow their progress.", "/areas/people/records")] : !count("results") ? [missing("evidence", "Assessment evidence", "Record and publish an assessment result first.", "/areas/assessments/manage")] : []],
      ["staff", count("staff") > 0, { active_staff: count("staff") }, !count("staff") ? [missing("staff", "Staff member", "Add a colleague and choose their responsibility.", "/more/setup/responsibilities")] : []],
      ["messages", count("members") > 1, { reachable_members: count("members"), conversations: count("conversations") }, count("members") <= 1 ? [missing("audience", "Audience", "Invite or connect one recipient before starting a conversation.", "/more/setup/people/invitations?from=staff")] : []],
    ];
    return rows.map(([capability, ready, counts, gaps]) => ({ capability, label: definitions[capability].label, status: ready ? "working" : "needs_setup",
      destination: capability === "attendance" && attendance ? attendance.destination
        : capability === "timetable" ? timetable.destination
          : capability === "assignments" ? assignments.operation.destination
            : capability === "fees" ? fees.operation.destination : capability === "resources" ? resources.operation.destination
              : capability === "facilities" ? facilities.operation.destination
                : capability === "accommodation" ? accommodation.operation.destination
                  : capability === "dining" ? dining.operation.destination : definitions[capability].destination,
      setup_path: this.setupPath(capability), counts, missing: gaps,
      ...(capability === "attendance" && attendance ? { operation: attendance.operation } : {}),
      ...(capability === "timetable" ? { timetable_operation: timetable.operation } : {}),
      ...(capability === "assignments" ? { assignments_operation: assignments.operation } : {}),
      ...(capability === "fees" ? { fees_operation: fees.operation } : {}),
      ...(capability === "resources" ? { resources_operation: resources.operation } : {}),
      ...(capability === "facilities" ? { facilities_operation: facilities.operation } : {}),
      ...(capability === "accommodation" ? { accommodation_operation: accommodation.operation } : {}),
      ...(capability === "dining" ? { dining_operation: dining.operation } : {}) }));
  }

  async workspace(user: AuthUser, schoolId: string) {
    await this.access(user, schoolId);
    const [readiness, classes, students, staff, gates, selectedGoals] = await Promise.all([
      this.readiness(user, schoolId),
      this.db.selectFrom("class_sections").select(["id", "grade", "section"]).where("school_id", "=", schoolId).orderBy("grade").orderBy("section").execute(),
      this.db.selectFrom("students as s").innerJoin("school_people as p", "p.id", "s.person_id").select(["s.id", "p.first_name", "p.last_name", "s.admission_number"]).where("s.school_id", "=", schoolId).orderBy("p.first_name").limit(200).execute(),
      this.db.selectFrom("school_memberships as m").innerJoin("users as u", "u.id", "m.user_id").select(["u.id", "u.first_name", "u.last_name", "m.role"]).where("m.school_id", "=", schoolId).where("m.is_active", "=", true).where("m.role", "in", ["admin", "staff"]).orderBy("u.first_name").execute(),
      this.db.selectFrom("campus_spaces").select(["id", "name", "campus_id"]).where("school_id", "=", schoolId).where("kind", "=", "gate").where("status", "=", "active").orderBy("name").execute(),
      this.db.selectFrom("progressive_onboarding_goal_selections as selection")
        .innerJoin("progressive_onboarding_workspaces as workspace", "workspace.id", "selection.workspace_id")
        .select(["selection.goal_key", "selection.priority"]).where("workspace.school_id", "=", schoolId)
        .orderBy("selection.priority").execute(),
    ]);
    const working = readiness.filter((item) => item.status === "working");
    const notReady = readiness.filter((item) => item.status === "needs_setup");
    const selected = selectedGoals.map((item) => item.goal_key).filter((key): key is ProgressiveCapability => progressiveCapabilitySchema.safeParse(key).success);
    const suggestedKeys = selected.length ? selected : notReady.slice(0, 3).map((item) => item.capability);
    const suggested = new Set(suggestedKeys);
    const useful = suggestedKeys.map((key) => notReady.find((item) => item.capability === key)).filter((item): item is Readiness => Boolean(item));
    return {
      school_id: schoolId,
      working_now: working,
      useful_next: useful,
      available_anytime: notReady.filter((item) => !suggested.has(item.capability)),
      options: {
        classes: classes.map((item) => ({ id: item.id, label: `${item.grade}${item.section}`.trim() })),
        students: students.map((item) => ({ id: item.id, label: `${item.first_name} ${item.last_name}`.trim(), detail: item.admission_number })),
        staff: [...new Map(staff.map((item) => [item.id, { id: item.id, label: `${item.first_name} ${item.last_name}`.trim() || "Unnamed account", role: item.role }])).values()],
        gates: gates.map((item) => ({ id: item.id, label: item.name, campus_id: item.campus_id })),
      },
    };
  }

  private splitName(name: string) {
    const parts = name.trim().replace(/\s+/g, " ").split(" ");
    return { first: parts.shift()!, last: parts.join(" ") };
  }

  private setupAdmission(schoolId: string, group: string, name: string) {
    return `START-${createHash("sha256").update(`${schoolId}:${group}:${name.toLocaleLowerCase()}`).digest("hex").slice(0, 12).toUpperCase()}`;
  }

  private async audit(db: Transaction<Database>, request: AuthenticatedRequest, schoolId: string, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) {
    await db.insertInto("audit_events").values({ actor_id: request.authUser.id, school_id: schoolId, action, target_type: targetType, target_id: targetId, request_id: request.requestId, ip_hash: null, metadata }).execute();
    return db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "administration.updated", aggregate_type: targetType, aggregate_id: targetId, audience_user_ids: [request.authUser.id], payload: { action, refresh: ["principal.get-started", "principal.administration", "principal.attendance", "teacher.attendance"] }, idempotency_key: `progressive-setup:${request.requestId}:${action}:${targetId}` }).onConflict((conflict) => conflict.column("idempotency_key").doUpdateSet({ payload: { action, refresh: ["principal.get-started", "principal.administration", "principal.attendance", "teacher.attendance"] } })).returning("id").executeTakeFirstOrThrow();
  }

  async setupAttendance(user: AuthUser, schoolId: string, body: unknown, request: AuthenticatedRequest) {
    const input = attendanceProgressiveSetupSchema.parse(body);
    const school = await this.access(user, schoolId);
    const today = institutionLocalDate(school.timezone);
    const endsOn = datePlusDays(today, 364);
    const weekdays = [...new Set(input.session.weekdays ?? [institutionLocalWeekday(school.timezone)])].sort();
    const responsibleId = input.responsible.kind === "current_user" ? user.id : input.responsible.user_id;
    return this.db.transaction().execute(async (db) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`progressive-attendance:${schoolId}`},0))`.execute(db);
      // The minimum path creates one class/day register, not subject sessions.
      // Serialize with the normal Operating rules editor and retain the explicit
      // initial choice instead of inheriting its historical session-mode fallback.
      await db.selectFrom("schools").select("id").where("id", "=", schoolId).forUpdate().executeTakeFirstOrThrow();
      const configuredRules = (await sql<{ attendance_academic_mode: "daily_class" | "scheduled_session" | "none"; revision: number }>`
        SELECT attendance_academic_mode,revision FROM institution_operating_rules
        WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(db)).rows[0];
      if (configuredRules && configuredRules.attendance_academic_mode !== "daily_class") {
        throw new ConflictException(configuredRules.attendance_academic_mode === "scheduled_session"
          ? "This campus uses subject-session attendance. Add the subject and its teaching session in Timetable, or review the attendance grain in Operating rules before creating a class register."
          : "Academic attendance is disabled in Operating rules. Review that setting before creating a class register.");
      }
      if (!configuredRules) {
        await sql`INSERT INTO institution_operating_rules(school_id,attendance_academic_mode,updated_by)
          VALUES(${schoolId}::uuid,'daily_class',${user.id}::uuid)`.execute(db);
        await db.insertInto("audit_events").values({
          actor_id: user.id, school_id: schoolId, action: "operating_rules.attendance.initialized",
          target_type: "school", target_id: schoolId, request_id: request.requestId, ip_hash: null,
          metadata: { source: "explicit_progressive_class_register_setup", attendance_academic_mode: "daily_class", revision: 1 },
        }).execute();
      }
      const member = await db.selectFrom("school_memberships").select(["role"]).where("school_id", "=", schoolId).where("user_id", "=", responsibleId).where("is_active", "=", true).where("role", "in", ["admin", "staff"]).executeTakeFirst();
      if (!member) throw new BadRequestException("Choose an active administrator or staff member from this institution.");
      if (input.responsible.kind === "current_user" && input.responsible.display_name && !`${user.first_name} ${user.last_name}`.trim()) {
        const name = this.splitName(input.responsible.display_name);
        await db.updateTable("users").set({ first_name: name.first, last_name: name.last, updated_at: executionNow() }).where("id", "=", user.id).execute();
        // The account endpoint and its human agent identify the authoritative campus person.
        // Keep that identity in sync instead of leaving the provisional onboarding label behind.
        const identity = await this.identities.resolveAccountEndpoint(db, {
          school_id: schoolId, user_id: user.id, at: executionNow().toISOString(),
        });
        if (!identity.acting) throw new ConflictException("Your campus person identity is unavailable. Restore account access before setting up Attendance.");
        await db.updateTable("school_people").set({ first_name: name.first, last_name: name.last })
          .where("id", "=", identity.person_id).where("school_id", "=", schoolId).execute();
      }
      let term = await db.selectFrom("academic_terms").selectAll().where("school_id", "=", schoolId).where("starts_on", "<=", today).where("ends_on", ">=", today).orderBy("is_active", "desc").orderBy("starts_on", "desc").executeTakeFirst();
      let createdTerm = false;
      if (!term) {
        const year = Number(today.slice(0, 4));
        term = await db.insertInto("academic_terms").values({ school_id: schoolId, academic_year: `${year}-${String(year + 1).slice(-2)}`, name: "Attendance setup period", starts_on: today, ends_on: endsOn, attendance_threshold: "75", is_active: true, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
        createdTerm = true;
      }
      let group = input.existing_class_id ? await db.selectFrom("class_sections").selectAll().where("school_id", "=", schoolId).where("id", "=", input.existing_class_id).executeTakeFirst() : null;
      if (input.existing_class_id && !group) throw new NotFoundException("The selected group is not available in this institution.");
      let createdGroup = false;
      if (!group) {
        group = await db.selectFrom("class_sections").selectAll().where("school_id", "=", schoolId).where("academic_year", "=", term.academic_year).where("grade", "=", input.group_name!).where("section", "=", "").executeTakeFirst();
        if (!group) {
          group = await db.insertInto("class_sections").values({ school_id: schoolId, academic_year: term.academic_year, grade: input.group_name!, section: "", board: "", room_number: "", updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
          createdGroup = true;
        }
      }
      if (group.academic_year !== term.academic_year) {
        const compatible = await db.selectFrom("academic_terms").selectAll().where("school_id", "=", schoolId).where("academic_year", "=", group.academic_year).where("starts_on", "<=", today).where("ends_on", ">=", today).executeTakeFirst();
        if (!compatible) throw new ConflictException("This group has no current operating period. Add a current term from Timetable before using it.");
        term = compatible;
      }
      const requestedAt = executionNow().toISOString();
      const preparedCommand = await this.commandGateway.prepareDomainCommand(db, {
        school_id: schoolId, actor_user_id: user.id,
        command_type: "progressive.attendance.configure",
        handler_key: "institution_activation.attendance_configure", handler_version: 1,
        source_domain: "academic_structure",
        target: { kind: "class", domain: "academic_structure", domain_id: group.id, label: group.grade, lifecycle_state: "active", source_revision: group.revision, metadata: {} },
        current_revision: group.revision, expected_revision: group.revision,
        capability: "institution:configure", purpose: "configure_attendance_capability",
        requested_at: requestedAt, correlation_id: request.requestId, causation_id: null,
        idempotency_key: `progressive-attendance:${request.requestId}`,
        operating_rule_version_ref: null, configuration_refs: [],
        authority_attestation: { evaluator_domain: "institution_activation", decision: "allowed", reason_codes: ["active_institution_administrator"], authority_source_refs: [{ school_id: schoolId, membership_role: "admin" }], operating_rule_refs: [], valid_until: null },
        safe_context: { responsible_user_id: responsibleId },
      });
      if (preparedCommand.status !== "ready") throw new ConflictException("This attendance setup command was already completed.");
      const existingStudents = input.existing_student_ids.length ? await db.selectFrom("students").select(["id"]).where("school_id", "=", schoolId).where("id", "in", input.existing_student_ids).execute() : [];
      if (existingStudents.length !== new Set(input.existing_student_ids).size) throw new BadRequestException("One or more selected participants are unavailable in this institution.");
      const studentIds = existingStudents.map((item) => item.id);
      let createdParticipants = 0;
      let reusedParticipants = studentIds.length;
      for (const participantName of input.participant_names) {
        const admission = this.setupAdmission(schoolId, group.id, participantName);
        let student = await db.selectFrom("students").select(["id"]).where("school_id", "=", schoolId).where("admission_number", "=", admission).executeTakeFirst();
        if (!student) {
          const name = this.splitName(participantName);
          const person = await db.insertInto("school_people").values({ school_id: schoolId, first_name: name.first, last_name: name.last }).returning("id").executeTakeFirstOrThrow();
          student = await db.insertInto("students").values({ school_id: schoolId, person_id: person.id, user_id: null, admission_number: admission, date_of_birth: null, blood_group: null, emergency_contact: null }).returning("id").executeTakeFirstOrThrow();
          createdParticipants++;
        } else reusedParticipants++;
        studentIds.push(student.id);
      }
      let roll = Number((await db.selectFrom("enrollments").select(sql<number>`coalesce(max(roll_number),0)`.as("max")).where("class_section_id", "=", group.id).where("term_id", "=", term.id).executeTakeFirst())?.max ?? 0);
      for (const studentId of [...new Set(studentIds)]) {
        const elsewhere = await db.selectFrom("enrollments as e").innerJoin("class_sections as x", "x.id", "e.class_section_id").select(["e.class_section_id"]).where("e.student_id", "=", studentId).where("e.is_active", "=", true).where("x.school_id", "=", schoolId).where("e.class_section_id", "!=", group.id).executeTakeFirst();
        if (elsewhere) throw new ConflictException("A selected participant is already active in another group. Move them from the People workspace instead of silently duplicating the roster.");
        const enrolled = await db.selectFrom("enrollments").select("id").where("student_id", "=", studentId).where("class_section_id", "=", group.id).where("term_id", "=", term.id).where("is_active", "=", true).executeTakeFirst();
        if (!enrolled) await db.insertInto("enrollments").values({ student_id: studentId, class_section_id: group.id, term_id: term.id, roll_number: ++roll, enrolled_on: today, is_active: true }).execute();
      }
      let role = await db.selectFrom("staff_responsibility_types").selectAll().where("school_id", "=", schoolId).where("code", "=", "class_teacher").executeTakeFirst();
      if (!role) role = await db.insertInto("staff_responsibility_types").values({ school_id: schoolId, code: "class_teacher", name: "Class teacher", category: "academic", scope_kind: "class_section", context_kind: "class", workflow_family: "attendance", source_kind: "system", cloned_from_type_id: null, description: "Operate the assigned group register and timetable.", access_summary: "Attendance and timetable for this group", capability_permissions: ["attendance.view", "attendance.record", "timetable.view"], requires_acceptance: false, restricted: false, is_active: true, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
      await ensureOperationalStaffProfile(db, this.identities, {
        school_id: schoolId, user_id: responsibleId, actor_user_id: user.id, at: requestedAt,
        staff_kind: "teaching", designation: "Attendance responsible person",
      });
      const assignment = await db.selectFrom("class_section_staff_assignments").select("id").where("school_id", "=", schoolId).where("class_section_id", "=", group.id).where("user_id", "=", responsibleId).where("role", "=", "class_teacher").where("ended_at", "is", null).executeTakeFirst();
      if (!assignment) await db.insertInto("class_section_staff_assignments").values({ school_id: schoolId, class_section_id: group.id, user_id: responsibleId, access_role_id: role.id, role: "class_teacher", subject_id: null, valid_from: term.starts_on, valid_until: term.ends_on, assigned_by: user.id }).execute();
      if (member.role === "admin") {
        await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: responsibleId, role: "staff", is_active: true })
          .onConflict((conflict) => conflict.columns(["user_id", "school_id", "role"]).doUpdateSet({ is_active: true })).execute();
      }
      const slots = [];
      let createdSessions = 0;
      for (const weekday of weekdays) {
        let slot = await db.selectFrom("timetable_slots").selectAll().where("class_section_id", "=", group.id).where("term_id", "=", term.id).where("weekday", "=", weekday).where("starts_at", "=", input.session.starts_at).where("ends_at", "=", input.session.ends_at).executeTakeFirst();
        if (!slot) {
          const period = Number((await db.selectFrom("timetable_slots").select(sql<number>`coalesce(max(period_number),0)`.as("max")).where("class_section_id", "=", group.id).where("term_id", "=", term.id).where("weekday", "=", weekday).executeTakeFirst())?.max ?? 0) + 1;
          slot = await db.insertInto("timetable_slots").values({ class_section_id: group.id, term_id: term.id, subject_id: null, weekday, period_number: period, starts_at: input.session.starts_at, ends_at: input.session.ends_at, slot_type: "activity", title: "Daily attendance", room: "", space_id: null, teacher_user_id: responsibleId, teacher_designation: "Responsible person", updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
          createdSessions++;
          await this.temporal.recordLegacyTimetableSlotChange(db, { school_id: schoolId, actor_user_id: user.id, action: "created", source_record_id: slot.id, source_revision: slot.revision, previous_source_revision: null, term_id: term.id, starts_on: term.starts_on, ends_on: term.ends_on, timezone: school.timezone, occurred_at: executionNow().toISOString(), class_section: { kind: "class", domain: "academic_structure", domain_id: group.id, label: group.grade, lifecycle_state: "active", source_revision: group.revision, metadata: {} }, slot: { weekday, period_number: period, starts_at: input.session.starts_at, ends_at: input.session.ends_at, title: "Daily attendance", slot_type: "activity", teacher_user_id: responsibleId, subject: null, space: null, room_snapshot: "" }, correlation_id: request.requestId });
        }
        slots.push(slot.id);
      }
      const event = await this.audit(db, request, schoolId, "progressive.attendance.configured", "class_section", group.id, { term_id: term.id, participants: studentIds.length, responsible_user_id: responsibleId, slot_ids: slots });
      await this.commandGateway.completeDomainCommand(db, { school_id: schoolId, command_id: preparedCommand.command_id, terminal_state: "accepted", code: "attendance_ready", explanation: "The Attendance domain accepted the group, roster, responsibility and expected sessions.", resulting_revision: group.revision, domain_event_id: event.id, metadata: { participant_count: [...new Set(studentIds)].length, session_count: slots.length }, completed_at: executionNow().toISOString() });
      const readiness = (await this.readiness(user, schoolId, db)).find((item) => item.capability === "attendance")!;
      const destination = responsibleId === user.id
        ? `/areas/attendance/registers?class_section_id=${group.id}&date=${today}`
        : "/more/setup/responsibilities";
      await retainOperatingDestination(db, user, schoolId, "attendance", destination);
      return { capability: "attendance" as const, status: "working" as const, readiness, resources: { class_section_id: group.id, term_id: term.id, student_ids: [...new Set(studentIds)], responsible_user_id: responsibleId, timetable_slot_ids: slots }, created: { group: createdGroup, participants: createdParticipants, assignment: !assignment, sessions: createdSessions }, reused: { group: !createdGroup, participants: reusedParticipants, sessions: slots.length - createdSessions }, destination, notes: [...(!configuredRules ? ["Attendance is configured as one class register per day. Review this choice anytime in Operating rules."] : []), ...(createdTerm ? ["ThatCampus created an editable rolling Attendance setup period because this job does not require a full academic-year setup."] : []), ...(!input.session.weekdays ? ["The first register is scheduled for today's institution-local weekday; edit its schedule anytime in Timetable."] : []), ...(input.responsible.kind === "current_user" && member.role === "admin" ? ["You explicitly chose to take this register. Its class responsibility is now available alongside your administrator access."] : []), "New names create new participant identities. Choose an existing participant to reuse a known person safely."] };
    });
  }

  async setupGate(user: AuthUser, schoolId: string, body: unknown, request: AuthenticatedRequest) {
    const input = gateProgressiveSetupSchema.parse(body);
    const school = await this.access(user, schoolId);
    const operatorId = input.operator.kind === "current_user" ? user.id : input.operator.user_id;
    const today = institutionLocalDate(school.timezone);
    return this.db.transaction().execute(async (db) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`progressive-gate:${schoolId}`},0))`.execute(db);
      const operator = await db.selectFrom("school_memberships").select("role").where("school_id", "=", schoolId).where("user_id", "=", operatorId).where("is_active", "=", true).where("role", "in", ["admin", "staff"]).executeTakeFirst();
      if (!operator) throw new BadRequestException("Choose an active administrator or staff operator from this institution.");
      let campus = await db.selectFrom("institution_campuses").selectAll().where("school_id", "=", schoolId).where("status", "=", "active").orderBy("is_primary", "desc").executeTakeFirst();
      if (!campus) campus = await db.insertInto("institution_campuses").values({ school_id: schoolId, parent_campus_id: null, name: `${school.name} campus`, code: "MAIN", campus_type: "main", status: "active", is_primary: true, timezone: school.timezone, created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
      let gate = input.existing_gate_id ? await db.selectFrom("campus_spaces").selectAll().where("school_id", "=", schoolId).where("id", "=", input.existing_gate_id).where("kind", "=", "gate").executeTakeFirst() : null;
      if (input.existing_gate_id && !gate) throw new NotFoundException("The selected entry point is not available in this institution.");
      let createdGate = false;
      if (!gate) {
        gate = await db.selectFrom("campus_spaces").selectAll().where("school_id", "=", schoolId).where("campus_id", "=", campus.id).where("kind", "=", "gate").where(sql`lower(trim(name))`, "=", input.gate_name!.toLocaleLowerCase()).executeTakeFirst();
        if (!gate) {
          const code = `GATE-${createHash("sha256").update(input.gate_name!.toLocaleLowerCase()).digest("hex").slice(0, 8).toUpperCase()}`;
          gate = await db.insertInto("campus_spaces").values({ school_id: schoolId, campus_id: campus.id, parent_space_id: null, name: input.gate_name!, code, kind: "gate", capacity: null, is_accessible: true, is_bookable: false, status: "active", attributes: {}, created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
          createdGate = true;
        }
      }
      const requestedAt = executionNow().toISOString();
      const preparedCommand = await this.commandGateway.prepareDomainCommand(db, {
        school_id: schoolId, actor_user_id: user.id,
        command_type: "progressive.gate.configure",
        handler_key: "institution_activation.gate_configure", handler_version: 1,
        source_domain: "campus_topology",
        target: { kind: "space", domain: "campus_topology", domain_id: gate.id, label: gate.name, lifecycle_state: "active", source_revision: gate.revision, metadata: { space_kind: "gate", campus_id: campus.id } },
        current_revision: gate.revision, expected_revision: gate.revision,
        capability: "institution:configure", purpose: "configure_gate_capability",
        requested_at: requestedAt, correlation_id: request.requestId, causation_id: null,
        idempotency_key: `progressive-gate:${request.requestId}`,
        operating_rule_version_ref: null, configuration_refs: [],
        authority_attestation: { evaluator_domain: "institution_activation", decision: "allowed", reason_codes: ["active_institution_administrator"], authority_source_refs: [{ school_id: schoolId, membership_role: "admin" }], operating_rule_refs: [], valid_until: null },
        safe_context: { operator_user_id: operatorId, campus_id: campus.id },
      });
      if (preparedCommand.status !== "ready") throw new ConflictException("This gate setup command was already completed.");
      // Selecting an operator is an explicit operational appointment. Admin
      // setup authority alone never supplies its canonical gate responsibility.
      const until = datePlusDays(today, 364);
      const profile = await ensureOperationalStaffProfile(db, this.identities, {
        school_id: schoolId, user_id: operatorId, actor_user_id: user.id, at: requestedAt,
        staff_kind: "non_teaching", designation: "Entry point operator",
      });
      await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: operatorId, role: "staff", is_active: true })
        .onConflict((conflict) => conflict.columns(["user_id", "school_id", "role"]).doUpdateSet({ is_active: true })).execute();
      let gatekeeper = await db.selectFrom("staff_responsibility_types").select("id").where("school_id", "=", schoolId).where("code", "=", "gatekeeper").where("is_active", "=", true).executeTakeFirst();
      if (!gatekeeper) gatekeeper = await db.insertInto("staff_responsibility_types").values({ school_id: schoolId, code: "gatekeeper", name: "Entry point operator", category: "operations", scope_kind: "school", context_kind: "institution", workflow_family: "gate", source_kind: "system", cloned_from_type_id: null, description: "Operate accepted entry, exit and visitor workflows.", access_summary: "Entry & exit operations", capability_permissions: ["gate.manage"], requires_acceptance: false, restricted: false, is_active: true, updated_by: user.id }).returning("id").executeTakeFirstOrThrow();
      const existing = await db.selectFrom("staff_responsibility_assignments").select("id").where("school_id", "=", schoolId).where("responsibility_type_id", "=", gatekeeper.id).where("staff_profile_id", "=", profile.id).where("status", "=", "active").where("starts_on", "<=", today).where((expression) => expression.or([expression("ends_on", "is", null), expression("ends_on", ">=", today)])).executeTakeFirst();
      const assignment = existing ?? await db.insertInto("staff_responsibility_assignments").values({ school_id: schoolId, responsibility_type_id: gatekeeper.id, staff_profile_id: profile.id, class_section_id: null, subject_id: null, event_id: null, scope_label: gate.name, location: gate.name, starts_on: today, ends_on: until, starts_at: null, ends_at: null, status: "active", notes: "Explicit operator selected during progressive setup", assigned_by: user.id, responded_at: executionNow(), revoked_by: null, revoked_at: null, backup_staff_profile_id: null }).returning("id").executeTakeFirstOrThrow();
      if (!existing) await db.insertInto("staff_responsibility_audits").values({ school_id: schoolId, assignment_id: assignment.id, actor_id: user.id, action: "activated", from_status: null, to_status: "active", note: "Explicit operator selected during progressive setup" }).execute();
      const event = await this.audit(db, request, schoolId, "progressive.gate.configured", "campus_space", gate.id, { campus_id: campus.id, operator_user_id: operatorId, operator_assignment_id: assignment.id });
      await this.commandGateway.completeDomainCommand(db, { school_id: schoolId, command_id: preparedCommand.command_id, terminal_state: "accepted", code: "gate_ready", explanation: "The Campus topology domain accepted the entry point and its operator scope.", resulting_revision: gate.revision, domain_event_id: event.id, metadata: { campus_id: campus.id, operator_user_id: operatorId, operator_assignment_id: assignment.id }, completed_at: executionNow().toISOString() });
      const readiness = (await this.readiness(user, schoolId, db)).find((item) => item.capability === "gate")!;
      const destination = readiness.destination;
      await retainOperatingDestination(db, user, schoolId, "gate", destination);
      return { capability: "gate" as const, status: "working" as const, readiness, resources: { campus_id: campus.id, gate_space_id: gate.id, operator_user_id: operatorId, operator_assignment_id: assignment.id }, created: { gate: createdGate, operator_authority: !existing }, reused: { gate: !createdGate, operator_authority: Boolean(existing) }, destination, notes: ["Entry & exit can begin with visitor operations; classes, subjects and academic terms are not prerequisites.", "The operator has an explicit, reviewable one-year entry-point responsibility."] };
    });
  }

  async setup(user: AuthUser, schoolId: string, capabilityInput: string, body: unknown, request: AuthenticatedRequest) {
    const capability = progressiveCapabilitySchema.parse(capabilityInput);
    if (capability === "attendance") return this.setupAttendance(user, schoolId, body, request);
    if (capability === "gate") return this.setupGate(user, schoolId, body, request);
    await this.access(user, schoolId);
    const readiness = (await this.readiness(user, schoolId)).find((item) => item.capability === capability)!;
    return { capability, status: readiness.status, readiness, destination: readiness.destination, notes: ["Continue in the owning workspace. ThatCampus will not claim this capability is ready until its accepted domain prerequisites exist."] };
  }
}
