import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import type { SimulationExecutionEnvironment } from "../campus-model-core/execution-environment.contracts.js";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { AttendanceModelService } from "../attendance-model/attendance-model.service.js";
import { ActivityAttendanceService } from "../attendance/activity-attendance.service.js";
import { ActivityPlanningService } from "../schedule-planning/activity-planning.service.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { SchoolService } from "../school/school.service.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { StaffOperationsService } from "../staff-operations/staff-operations.service.js";
import { PeopleImportService } from "../people/people-import.service.js";
import { TransportRetentionService } from "../departure-coordination/transport-retention.service.js";
import { configureSimulationBehaviourSchema, normalizeSimulationBehaviourConfiguration } from "../simulation/simulation.contracts.js";
import { SimulationOfferResponseAdapter } from "../simulation/simulation-offer-response.adapter.js";
import { RazorpayService } from "../operations/razorpay.service.js";
import { PaymentEmailService } from "../operations/payment-email.service.js";
import { MatrixTransportService } from "../chat/matrix/matrix-transport.service.js";
import type { AdvanceSimulationWorldInput } from "../simulation/simulation-world.port.js";
import { DatabaseService } from "./database.service.js";
import { ExecutionDataPlaneScope } from "./execution-data-plane.js";
import { simulationRequestEnvironment, type SimulationDomainRuntime } from "./simulation-world.service.js";

export const simulationAttendanceBehaviourSchema = z.object({
  schema_version: z.literal(1),
  attendance: z.object({ enabled: z.boolean(), present: z.number().min(0).max(1), late: z.number().min(0).max(1),
    absent: z.number().min(0).max(1), excused: z.number().min(0).max(1), submission_delay_minutes: z.number().min(0).max(120) }).strict(),
}).strict().refine((value) => Math.abs(value.attendance.present + value.attendance.late + value.attendance.absent + value.attendance.excused - 1) < 0.000001,
  "Synthetic attendance proportions must sum to 100%.");

/** A repeatable cohort draw, never a prediction about an identified person. */
export function syntheticAttendanceStatus(seed: string, context: string, policy: z.infer<typeof simulationAttendanceBehaviourSchema>["attendance"]): "present" | "late" | "absent" | "excused" {
  const sample = createHash("sha256").update(`${seed}:${context}`).digest().readUInt32BE(0) / 0x1_0000_0000;
  let boundary = 0;
  for (const status of ["present", "late", "absent", "excused"] as const) {
    boundary += policy[status];
    if (sample < boundary) return status;
  }
  return "excused";
}

function actionId(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function simulationAttendanceRoute(
  workspaceMode: string,
  sessionId: string | null,
): "scheduled_session" | "daily_class" {
  return workspaceMode === "scheduled_session" && sessionId !== null
    ? "scheduled_session"
    : "daily_class";
}

/** Campus adapter: routine actions use the same owning-domain services as Live. */
@Injectable()
export class SimulationCampusRuntimeService implements SimulationDomainRuntime {
  constructor(private readonly db: DatabaseService, private readonly scope: ExecutionDataPlaneScope,
    private readonly attendance: AttendanceModelService, private readonly school: SchoolService,
    private readonly staff: StaffOperationsService, private readonly events: SchoolEventService,
    private readonly offers: SimulationOfferResponseAdapter, private readonly imports: PeopleImportService,
    private readonly transportRetention: TransportRetentionService, private readonly payments: RazorpayService,
    private readonly paymentEmails: PaymentEmailService, private readonly matrix: MatrixTransportService,
    private readonly activityPlanning: ActivityPlanningService, private readonly participation: ActivityAttendanceService,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort) {}

  async advance(input: AdvanceSimulationWorldInput, environment: SimulationExecutionEnvironment): Promise<void> {
    const admin = await this.db.selectFrom("users").innerJoin("school_memberships", "school_memberships.user_id", "users.id")
      .select(["users.id", "users.username", "users.email", "users.first_name", "users.last_name", "users.role", "users.is_active"])
      .where("school_memberships.school_id", "=", input.institution_id).where("school_memberships.role", "=", "admin")
      .where("school_memberships.is_active", "=", true).where("users.is_active", "=", true).orderBy("users.id").executeTakeFirst();
    if (!admin) throw new Error("The frozen campus has no active administrator to resolve routine operations.");
    const actor: AuthUser = { ...admin, active_school_id: input.institution_id };
    const dateRows = (await sql<{ date: string }>`SELECT day::date::text AS date FROM schools school,
      LATERAL generate_series((${input.virtual_from}::timestamptz AT TIME ZONE school.timezone)::date,
        (${input.virtual_to}::timestamptz AT TIME ZONE school.timezone)::date,interval '1 day') day
      WHERE school.id=${input.institution_id}::uuid`.execute(this.db)).rows;
    const behaviour = (await this.db.selectFrom("campus_model_behaviour_versions").select(["id", "configuration"])
      .where("school_id", "=", input.institution_id).where("behaviour_key", "=", "simulation_campus_activity")
      .where("status", "=", "approved").where("approved_at", "is not", null).where("effective_from", "<=", new Date(input.virtual_to))
      .where((expression) => expression.or([expression("effective_until", "is", null), expression("effective_until", ">", new Date(input.virtual_from))]))
      .orderBy("version", "desc").executeTakeFirst());
    const configured = behaviour ? configureSimulationBehaviourSchema.safeParse(behaviour.configuration) : null;
    if (behaviour && !configured?.success) throw new Error("The approved synthetic activity policy is invalid; the run was stopped before inventing actions.");
    const normalizedConfiguration = configured?.success
      ? normalizeSimulationBehaviourConfiguration(configured.data)
      : null;
    const configurationHash = normalizedConfiguration
      ? createHash("sha256").update(JSON.stringify(normalizedConfiguration)).digest("hex")
      : null;
    for (const { date } of dateRows) {
      // Materialization is a projection of the frozen publication, not a new
      // administrator action. It runs even when synthetic participation is off.
      const activityOccurrences = await this.activityPlanning.ensureOccurrences(input.institution_id, date, date);
      const workspace = await this.attendance.workspace(actor, date);
      if (!normalizedConfiguration?.attendance.enabled || !configurationHash) continue;
      const policy = normalizedConfiguration.attendance;
      const endpoints = await this.db.transaction().execute(tx => this.identities.listActingPeople(tx, {
        school_id: input.institution_id, at: input.virtual_to,
      }));
      for (const occurrence of activityOccurrences) {
        if (occurrence.source !== "activity" || occurrence.state !== "expected" || occurrence.attendance_mode === "none"
          || !occurrence.recorder_person_id) continue;
        const due = new Date(Date.parse(occurrence.starts_at) + policy.submission_delay_minutes * 60_000);
        if (due.getTime() <= Date.parse(input.virtual_from) || due.getTime() > Date.parse(input.virtual_to)) continue;
        const endpoint = endpoints.find(person => person.person_id === occurrence.recorder_person_id);
        if (!endpoint) continue;
        const account = await this.db.selectFrom("users").select(["id", "username", "email", "first_name", "last_name", "role", "is_active"])
          .where("id", "=", endpoint.user_id).where("is_active", "=", true).executeTakeFirst();
        if (!account) continue;
        const user: AuthUser = { ...account, active_school_id: input.institution_id };
        const actionEnvironment = simulationRequestEnvironment({ institution_id: input.institution_id,
          scenario_id: input.scenario_id, run_id: input.run_id, virtual_now: due.toISOString(),
          source_snapshot_ref: environment.source_snapshot_ref, manifest_ref: environment.coverage_gate.manifest_ref,
          checked_at: environment.coverage_gate.checked_at });
        const actionKey = `${input.run_id}:participation:${occurrence.id}`;
        const request = { authUser: user, requestId: actionId(actionKey), headers: { "idempotency-key": `simulation:${actionId(actionKey)}` },
          executionEnvironment: actionEnvironment, executionEnvironmentView: { mode: "simulation" }, sessionHash: `simulation-counterpart:${user.id}` } as unknown as AuthenticatedRequest;
        try {
          await this.scope.run(actionEnvironment, async () => {
            const registerId = await this.participation.ensureRegister(input.institution_id, occurrence.id);
            const screen = await this.participation.detail(user, input.institution_id, registerId);
            if (screen.register.state !== "draft" || !screen.roster.length || !screen.capabilities.can_record) return;
            await this.participation.submitRecords(user, input.institution_id, registerId, {
              expected_revision: screen.register.revision,
              reason: `Synthetic cohort activity under approved Simulation policy ${behaviour!.id}.`,
              records: screen.roster.map(person => ({ person_id: person.person_id,
                status: syntheticAttendanceStatus(input.deterministic_seed, `${configurationHash}:${occurrence.id}:${person.person_id}`, policy), remarks: "" })),
            }, request);
          });
        } catch (error) {
          await this.recordRefusal(input, user, actionKey, request.requestId, behaviour!.id, error);
        }
      }
      const candidates = (await sql<{ id: string; class_section_id: string; teacher_id: string; due_at: Date; session_id: string | null }>`SELECT schedule.id,schedule.class_section_id,
          schedule.teacher_user_id AS teacher_id,
          ((${date}::date+schedule.starts_at) AT TIME ZONE school.timezone)+make_interval(mins=>${policy.submission_delay_minutes}) AS due_at,
          register.id AS session_id
        FROM schools school CROSS JOIN LATERAL effective_school_schedule_v4(school.id,${date}::date) schedule
        LEFT JOIN attendance_session_registers register ON register.school_id=school.id AND register.session_date=${date}::date AND register.schedule_slot_id=schedule.id
        WHERE school.id=${input.institution_id}::uuid AND NOT schedule.cancelled AND schedule.slot_type IN ('class','activity')
          AND schedule.teacher_user_id IS NOT NULL
          AND ((${date}::date+schedule.starts_at) AT TIME ZONE school.timezone)+make_interval(mins=>${policy.submission_delay_minutes})>${input.virtual_from}::timestamptz
          AND ((${date}::date+schedule.starts_at) AT TIME ZONE school.timezone)+make_interval(mins=>${policy.submission_delay_minutes})<=${input.virtual_to}::timestamptz
          AND NOT EXISTS(SELECT 1 FROM staff_leave_requests leave JOIN staff_profiles staff ON staff.id=leave.staff_profile_id
            WHERE staff.school_id=school.id AND staff.user_id=schedule.teacher_user_id AND leave.status='approved'
              AND ${date}::date BETWEEN leave.starts_on AND leave.ends_on)
        ORDER BY due_at,schedule.class_section_id,schedule.id`.execute(this.db)).rows;
      const completedDaily = new Set<string>();
      for (const candidate of candidates) {
        const attendanceRoute = simulationAttendanceRoute(workspace.mode, candidate.session_id);
        if (attendanceRoute === "daily_class" && completedDaily.has(candidate.class_section_id)) continue;
        const teacher = await this.db.selectFrom("users").select(["id", "username", "email", "first_name", "last_name", "role", "is_active"])
          .where("id", "=", candidate.teacher_id).where("is_active", "=", true).executeTakeFirst();
        if (!teacher) continue;
        const user: AuthUser = { ...teacher, active_school_id: input.institution_id };
        const virtualNow = new Date(candidate.due_at).toISOString();
        const actionEnvironment = simulationRequestEnvironment({ institution_id: input.institution_id,
          scenario_id: input.scenario_id, run_id: input.run_id, virtual_now: virtualNow,
          source_snapshot_ref: environment.source_snapshot_ref, manifest_ref: environment.coverage_gate.manifest_ref,
          checked_at: environment.coverage_gate.checked_at });
        const actionKey = `${input.run_id}:attendance:${attendanceRoute === "scheduled_session" ? candidate.session_id : candidate.class_section_id}:${date}`;
        const request = { authUser: user, requestId: actionId(actionKey), headers: { "idempotency-key": `simulation:${actionId(actionKey)}` },
          executionEnvironment: actionEnvironment, executionEnvironmentView: { mode: "simulation" }, sessionHash: `simulation-counterpart:${user.id}` } as unknown as AuthenticatedRequest;
        try {
          await this.scope.run(actionEnvironment, async () => {
            if (attendanceRoute === "scheduled_session" && candidate.session_id) {
              const screen = await this.attendance.screen(user, candidate.session_id);
              if (screen.register.state !== "draft" || !screen.roster.length) return;
              await this.attendance.save(user, candidate.session_id, { expected_revision: screen.register.revision,
                reason: `Synthetic cohort activity under approved Simulation policy ${behaviour!.id}.`,
                records: screen.roster.map((student: { id: string }) => ({ student_id: student.id,
                  status: syntheticAttendanceStatus(input.deterministic_seed, `${configurationHash}:${date}:${candidate.id}:${student.id}`, policy), remarks: "" })) }, request);
            } else {
              const screen = await this.school.teacherAttendanceScreen(user, candidate.class_section_id, date);
              if (screen.register.state !== "draft" || !screen.roster.length || !screen.availability.can_mark) return;
              await this.school.saveTeacherAttendance(user, { class_section_id: candidate.class_section_id, date,
                expected_revision: screen.register.revision, reason: `Synthetic cohort activity under approved Simulation policy ${behaviour!.id}.`,
                records: screen.roster.map((student: { id: string }) => ({ student_id: student.id,
                  status: syntheticAttendanceStatus(input.deterministic_seed, `${configurationHash}:${date}:${candidate.class_section_id}:${student.id}`, policy), remarks: "" })) }, request);
            }
          });
          if (attendanceRoute === "daily_class") completedDaily.add(candidate.class_section_id);
        } catch (error) {
          // An actual domain refusal remains unresolved work. It never permits
          // the synthetic actor to bypass access, locked evidence or timetable rules.
          await this.recordRefusal(input, user, actionKey, request.requestId, behaviour!.id, error);
        }
      }
    }
    if (behaviour && normalizedConfiguration && configurationHash) {
      await this.offers.advanceOfferResponses(input, environment, { version_ref: behaviour.id,
        configuration: normalizedConfiguration, configuration_hash: configurationHash });
    }
    await this.staff.reconcileCoverageDeadlines(input.institution_id);
    await this.events.advanceSimulationDomainWork();
    await this.imports.expireDrafts();
    await this.transportRetention.purgeExpired();
    await this.payments.reconcilePending();
    await this.paymentEmails.deliverPending();
    await this.matrix.drainPending();
  }

  private async recordRefusal(input: AdvanceSimulationWorldInput, user: AuthUser, actionKey: string, requestId: string, policyId: string, error: unknown) {
    await this.db.insertInto("audit_events").values({ id: actionId(`refusal:${actionKey}`), action: "simulation.actor.domain_refused", actor_id: user.id,
      school_id: input.institution_id, target_type: "simulation_action", target_id: requestId,
      request_id: requestId, ip_hash: null, metadata: { run_id: input.run_id, policy_version: policyId,
        evidence_mode: "simulation", reason: error instanceof Error ? error.message.slice(0, 300) : "Domain refused the synthetic action." } })
      .onConflict((conflict) => conflict.column("id").doNothing()).execute();
  }
}
