import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import { TEMPORAL_CONTEXT_PORT, type TemporalContextPort } from "../campus-model-core/temporal-context.port.js";
import { StaffCoverageOfferBridgeService } from "./staff-coverage-offer-bridge.service.js";

export const STAFF_COVERAGE_RECONCILIATION_PORT = Symbol("STAFF_COVERAGE_RECONCILIATION_PORT");

type ReconciliationReason =
  | "source_changed"
  | "coverage_obligation_changed"
  | "replacement_unavailable";

export interface CoverageReconciliationInput {
  school_id: string;
  from: string;
  to: string;
  class_section_id?: string | null;
  actor_user_id: string;
  correlation_id: string;
  cause: {
    kind: string;
    source_domain: string;
    source_record_id: string;
    source_revision: number;
  };
}

export interface CoverageReconciliationReceipt {
  superseded_substitution_ids: string[];
  cancelled_task_ids: string[];
  reopened_task_ids: string[];
  model_event_ids: string[];
}

export interface CoverageProjectionPreparationReceipt {
  model_event_ids: string[];
}

export interface ApprovedLeaveCoverageInput {
  school_id: string;
  actor_user_id: string;
  request: {
    id: string;
    staff_profile_id: string;
    starts_on: string;
    ends_on: string;
    portion: string;
    handover_note: string;
  };
  absent_teacher_user_id: string | null;
}

export interface StaffCoverageReconciliationPort {
  createTasksForApprovedLeave(
    transaction: Transaction<Database>,
    input: ApprovedLeaveCoverageInput,
  ): Promise<string[]>;
  prepareEffectiveCoverageProjection(
    transaction: Transaction<Database>,
    input: CoverageReconciliationInput,
  ): Promise<CoverageProjectionPreparationReceipt>;
  reconcileEffectiveCoverage(
    transaction: Transaction<Database>,
    input: CoverageReconciliationInput,
  ): Promise<CoverageReconciliationReceipt>;
}

type StaleSubstitution = {
  substitution_id: string;
  coverage_task_id: string;
  reason: ReconciliationReason;
};

type SubstitutionEvidence = {
  id: string;
  coverage_task_id: string;
  source_occurrence_key: string;
  source_kind: "daily_plan" | "published_timetable" | "legacy_timetable";
  source_record_id: string;
  source_revision: number;
  source_version: number | null;
  original_teacher_user_id: string;
  replacement_teacher_user_id: string;
  coverage_task_revision: number;
  duty_date: string;
  task_status: string;
  task_revision: number;
  leave_request_id: string;
  replacement_staff_profile_id: string;
};

type AcceptedSubstitutionBootstrapEvidence = {
  substitution_id: string;
  coverage_task_id: string;
  coverage_task_revision: number;
  source_occurrence_key: string;
  source_kind: "daily_plan" | "published_timetable" | "legacy_timetable";
  source_schedule_id: string;
  source_record_id: string;
  source_revision: number;
  source_version: number | null;
  original_teacher_user_id: string;
  replacement_teacher_user_id: string;
  accepted_by: string;
  accepted_at: Date | string;
  duty_date: string;
  period_number: number;
  starts_at: string;
  ends_at: string;
  title: string;
  slot_type: "class" | "break" | "activity";
  room: string;
  class_section_id: string;
  class_label: string;
  class_revision: number;
  subject_id: string | null;
  subject_label: string | null;
  subject_code: string | null;
  subject_revision: number | null;
  space_id: string | null;
  space_label: string | null;
  space_revision: number | null;
  snapshot_source: "planned_schedule" | "retained_source" | "coverage_task";
};

type AcceptedImportOutbox = {
  id: string;
  imported_at: string;
};

type AcceptedImportEvidence = Pick<
  AcceptedSubstitutionBootstrapEvidence,
  | "substitution_id"
  | "coverage_task_revision"
  | "source_occurrence_key"
  | "source_kind"
  | "source_schedule_id"
  | "source_record_id"
  | "source_revision"
  | "source_version"
  | "original_teacher_user_id"
  | "replacement_teacher_user_id"
> & { school_id: string };

export function acceptedCoverageImportPayload(
  evidence: AcceptedImportEvidence,
  importedAt: string,
) {
  return {
    school_id: evidence.school_id,
    status: "accepted" as const,
    revision: evidence.coverage_task_revision,
    substitution_id: evidence.substitution_id,
    effective_timetable: true as const,
    occurrence_key: evidence.source_occurrence_key,
    source_kind: evidence.source_kind,
    source_record_id: evidence.source_record_id,
    source_revision: evidence.source_revision,
    source_version: evidence.source_version,
    source_schedule_id: evidence.source_schedule_id,
    original_teacher_user_id: evidence.original_teacher_user_id,
    replacement_teacher_user_id: evidence.replacement_teacher_user_id,
    import_reason: "pre_core_projection_backfill" as const,
    imported_at: importedAt,
  };
}

@Injectable()
export class StaffCoverageReconciliationService implements StaffCoverageReconciliationPort {
  constructor(
    @Inject(TEMPORAL_CONTEXT_PORT) private readonly temporal: TemporalContextPort,
    private readonly coverageOffers: StaffCoverageOfferBridgeService,
  ) {}

  private async activeAdmins(transaction: Transaction<Database>, schoolId: string) {
    return (await sql<{ user_id: string }>`SELECT membership.user_id
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid
        AND membership.role='admin' AND membership.is_active
      ORDER BY membership.user_id`.execute(transaction)).rows.map((row) => row.user_id);
  }

  private async enqueue(
    transaction: Transaction<Database>,
    input: {
      school_id: string;
      event_type: string;
      aggregate_id: string;
      revision: number;
      audience_user_ids: string[];
      notification_user_ids?: string[];
      notification_payload?: Record<string, unknown> | null;
      payload: Record<string, unknown>;
    },
  ) {
    const audience = [...new Set(input.audience_user_ids)].sort();
    const notificationUsers = [...new Set(input.notification_user_ids ?? [])].sort();
    const notification = input.notification_payload ?? null;
    const idempotencyKey = `${input.event_type}:${input.aggregate_id}:${input.revision}`;
    const inserted = (await sql<{ id: string }>`INSERT INTO event_outbox(
        school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,
        idempotency_key,notification_user_ids,notification_payload
      ) VALUES(
        ${input.school_id}::uuid,${input.event_type},'staff_coverage_task',
        ${input.aggregate_id}::uuid,${audience}::uuid[],${JSON.stringify(input.payload)}::jsonb,
        ${idempotencyKey},${notificationUsers}::uuid[],
        ${notification ? JSON.stringify(notification) : null}::jsonb
      ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`.execute(transaction)).rows[0];
    if (inserted) return inserted.id;
    const retained = (await sql<{ id: string; exact: boolean }>`SELECT id,
        school_id=${input.school_id}::uuid
          AND event_type=${input.event_type}
          AND aggregate_type='staff_coverage_task'
          AND aggregate_id=${input.aggregate_id}::uuid
          AND audience_user_ids=${audience}::uuid[]
          AND payload=${JSON.stringify(input.payload)}::jsonb
          AND notification_user_ids=${notificationUsers}::uuid[]
          AND notification_payload IS NOT DISTINCT FROM
            ${notification ? JSON.stringify(notification) : null}::jsonb AS exact
      FROM event_outbox WHERE idempotency_key=${idempotencyKey} FOR UPDATE`.execute(transaction)).rows[0];
    if (!retained?.exact) {
      throw new ConflictException("The retained cover event key belongs to different evidence.");
    }
    return retained.id;
  }

  private async ensureAcceptedImportOutbox(
    transaction: Transaction<Database>,
    schoolId: string,
    evidence: AcceptedSubstitutionBootstrapEvidence,
  ): Promise<AcceptedImportOutbox> {
    const idempotencyKey = [
      "staff.coverage.accepted-import",
      evidence.substitution_id,
      String(evidence.coverage_task_revision),
    ].join(":");
    const findRetained = async () => (await sql<AcceptedImportOutbox>`SELECT
        id,payload->>'imported_at' AS imported_at
      FROM event_outbox
      WHERE school_id=${schoolId}::uuid AND idempotency_key=${idempotencyKey}
      FOR UPDATE`.execute(transaction)).rows[0];
    let retained = await findRetained();
    const importedAt = retained?.imported_at ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(importedAt))) {
      throw new ConflictException("The retained cover import has an invalid recorded time.");
    }
    const payload = acceptedCoverageImportPayload({
      school_id: schoolId,
      substitution_id: evidence.substitution_id,
      coverage_task_revision: evidence.coverage_task_revision,
      source_occurrence_key: evidence.source_occurrence_key,
      source_kind: evidence.source_kind,
      source_schedule_id: evidence.source_schedule_id,
      source_record_id: evidence.source_record_id,
      source_revision: evidence.source_revision,
      source_version: evidence.source_version,
      original_teacher_user_id: evidence.original_teacher_user_id,
      replacement_teacher_user_id: evidence.replacement_teacher_user_id,
    }, importedAt);
    if (!retained) {
      retained = (await sql<AcceptedImportOutbox>`INSERT INTO event_outbox(
          school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,
          idempotency_key,notification_user_ids,notification_payload
        ) VALUES(
          ${schoolId}::uuid,'staff.coverage.accepted','staff_coverage_task',
          ${evidence.coverage_task_id}::uuid,'{}'::uuid[],${JSON.stringify(payload)}::jsonb,
          ${idempotencyKey},'{}'::uuid[],NULL
        ) ON CONFLICT(idempotency_key) DO NOTHING
        RETURNING id,payload->>'imported_at' AS imported_at`.execute(transaction)).rows[0]
        ?? await findRetained();
    }
    const exact = retained && (await sql<{ exact: boolean }>`SELECT EXISTS(
        SELECT 1 FROM event_outbox
        WHERE id=${retained.id}::uuid AND school_id=${schoolId}::uuid
          AND event_type='staff.coverage.accepted'
          AND aggregate_type='staff_coverage_task'
          AND aggregate_id=${evidence.coverage_task_id}::uuid
          AND audience_user_ids='{}'::uuid[]
          AND payload=${JSON.stringify(payload)}::jsonb
          AND notification_user_ids='{}'::uuid[]
          AND notification_payload IS NULL
      ) AS exact`.execute(transaction)).rows[0]?.exact;
    if (!retained || !exact) {
      throw new ConflictException(
        "The retained accepted-cover import key belongs to different evidence.",
      );
    }
    return retained;
  }

  async prepareEffectiveCoverageProjection(
    transaction: Transaction<Database>,
    input: CoverageReconciliationInput,
  ): Promise<CoverageProjectionPreparationReceipt> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${input.school_id}`},0))`.execute(transaction);
    // Migration 113 retained already-accepted tasks as timetable substitutions,
    // but deliberately did not manufacture a user command or Model Core event.
    // A live post-migration acceptance always has a staff_coverage_commands row
    // and is projected in its originating transaction, so command absence is the
    // domain-owned marker for this narrow, replayable import bridge.
    const retained = (await sql<AcceptedSubstitutionBootstrapEvidence>`SELECT
        substitution.id AS substitution_id,
        substitution.coverage_task_id,substitution.coverage_task_revision,
        substitution.source_occurrence_key,substitution.source_kind,
        substitution.source_schedule_id,substitution.source_record_id,
        substitution.source_revision,substitution.source_version,
        substitution.original_teacher_user_id,substitution.replacement_teacher_user_id,
        substitution.accepted_by,substitution.accepted_at,
        substitution.duty_date::text,substitution.period_number,
        substitution.starts_at::text,substitution.ends_at::text,
        COALESCE(planned.title,
          CASE WHEN published_version.id IS NOT NULL THEN published_period.title END,
          dated_period.title,task.title)::text AS title,
        COALESCE(planned.slot_type,
          CASE WHEN published_version.id IS NOT NULL THEN published_period.slot_type END,
          dated_period.slot_type,'class')::varchar AS slot_type,
        COALESCE(planned.room,
          CASE WHEN published_version.id IS NOT NULL THEN published_period.room END,
          dated_period.room,task.location,'')::text AS room,
        section.id AS class_section_id,
        concat('Class ',section.grade,section.section) AS class_label,
        section.revision AS class_revision,
        subject.id AS subject_id,
        COALESCE(subject.name,subject.short_name,subject.code) AS subject_label,
        subject.code AS subject_code,subject.revision AS subject_revision,
        space.id AS space_id,space.name AS space_label,space.revision AS space_revision,
        CASE
          WHEN planned.id IS NOT NULL THEN 'planned_schedule'
          WHEN published_version.id IS NOT NULL OR dated_period.id IS NOT NULL
            THEN 'retained_source'
          ELSE 'coverage_task'
        END AS snapshot_source
      FROM staff_timetable_substitutions substitution
      JOIN staff_coverage_tasks task
        ON task.id=substitution.coverage_task_id AND task.school_id=substitution.school_id
      JOIN class_sections section
        ON section.id=substitution.class_section_id AND section.school_id=substitution.school_id
      LEFT JOIN subjects subject
        ON subject.id=substitution.subject_id AND subject.school_id=substitution.school_id
      LEFT JOIN LATERAL (
        SELECT schedule.*
        FROM planned_school_schedule_v2(substitution.school_id,substitution.duty_date) schedule
        WHERE schedule.id=substitution.source_schedule_id
          AND schedule.occurrence_key=substitution.source_occurrence_key
          AND schedule.source_kind=substitution.source_kind
          AND schedule.source_record_id=substitution.source_record_id
          AND schedule.source_revision=substitution.source_revision
          AND schedule.source_version IS NOT DISTINCT FROM substitution.source_version
          AND schedule.class_section_id=substitution.class_section_id
          AND schedule.subject_id IS NOT DISTINCT FROM substitution.subject_id
          AND schedule.period_number=substitution.period_number
          AND schedule.starts_at=substitution.starts_at
          AND schedule.ends_at=substitution.ends_at
          AND schedule.teacher_user_id=substitution.original_teacher_user_id
        LIMIT 1
      ) planned ON true
      LEFT JOIN schedule_periods published_period
        ON substitution.source_kind='published_timetable'
        AND published_period.id=substitution.source_schedule_id
        AND published_period.version_id=substitution.source_record_id
      LEFT JOIN schedule_versions published_version
        ON published_version.id=published_period.version_id
        AND published_version.school_id=substitution.school_id
        AND published_version.revision=substitution.source_revision
      LEFT JOIN day_plan_periods dated_period
        ON substitution.source_kind='daily_plan'
        AND dated_period.id=substitution.source_schedule_id
        AND dated_period.school_id=substitution.school_id
        AND dated_period.plan_id=substitution.source_record_id
        AND dated_period.version=substitution.source_version
      LEFT JOIN timetable_slots legacy_period
        ON substitution.source_kind='legacy_timetable'
        AND legacy_period.id=substitution.source_schedule_id
        AND legacy_period.id=substitution.source_record_id
      LEFT JOIN campus_spaces space
        ON space.school_id=substitution.school_id
        AND space.id=COALESCE(
          CASE WHEN published_version.id IS NOT NULL THEN published_period.space_id END,
          dated_period.space_id,
          CASE WHEN planned.id IS NOT NULL THEN legacy_period.space_id END
        )
      WHERE substitution.school_id=${input.school_id}::uuid
        AND substitution.state='effective' AND task.status='accepted'
        AND substitution.duty_date BETWEEN ${input.from}::date AND ${input.to}::date
        AND (${input.class_section_id ?? null}::uuid IS NULL
          OR substitution.class_section_id=${input.class_section_id ?? null}::uuid)
        AND NOT EXISTS(
          SELECT 1 FROM staff_coverage_commands command
          WHERE command.school_id=substitution.school_id
            AND command.substitution_id=substitution.id
        )
      ORDER BY substitution.duty_date,substitution.period_number,substitution.id
      FOR SHARE OF substitution,task`.execute(transaction)).rows;
    const eventIds: string[] = [];
    for (const evidence of retained) {
      if (evidence.accepted_by !== evidence.replacement_teacher_user_id) {
        throw new ConflictException(
          "The retained accepted cover does not identify its accepting teacher.",
        );
      }
      const acceptedDate = new Date(evidence.accepted_at);
      if (!Number.isFinite(acceptedDate.getTime())) {
        throw new ConflictException("The retained accepted cover has an invalid accepted time.");
      }
      const acceptedAt = acceptedDate.toISOString();
      const outbox = await this.ensureAcceptedImportOutbox(
        transaction,
        input.school_id,
        evidence,
      );
      await sql`UPDATE staff_timetable_substitutions
        SET effective_event_id=${outbox.id}::uuid
        WHERE id=${evidence.substitution_id}::uuid AND school_id=${input.school_id}::uuid
          AND state='effective'
          AND effective_event_id IS DISTINCT FROM ${outbox.id}::uuid`.execute(transaction);
      const dailyPlan = evidence.source_kind === "daily_plan";
      const scheduleDomain = dailyPlan ? "day_plan" : "timetable";
      const scheduleDomainId = dailyPlan
        ? `${evidence.source_record_id}:${evidence.source_version}`
        : evidence.source_kind === "published_timetable"
          ? evidence.source_record_id
          : `legacy:${evidence.source_record_id}`;
      const periodDomainId = dailyPlan
        ? `${evidence.source_schedule_id}:${evidence.source_version}`
        : evidence.source_schedule_id;
      const projection = await this.temporal.recordImportedAcceptedScheduleSubstitution(
        transaction,
        {
          school_id: input.school_id,
          actor_user_id: evidence.accepted_by,
          imported_by_user_id: input.actor_user_id,
          substitution_id: evidence.substitution_id,
          coverage_task_id: evidence.coverage_task_id,
          coverage_task_revision: evidence.coverage_task_revision,
          source_outbox_event_id: outbox.id,
          occurrence_key: evidence.source_occurrence_key,
          source_kind: evidence.source_kind,
          source_schedule_id: evidence.source_schedule_id,
          source_record_id: evidence.source_record_id,
          source_revision: evidence.source_revision,
          source_version: evidence.source_version,
          schedule: {
            kind: "schedule",
            domain: scheduleDomain,
            domain_id: scheduleDomainId,
            label: dailyPlan
              ? `${evidence.class_label} plan for ${evidence.duty_date}`
              : `${evidence.class_label} timetable`,
            lifecycle_state: "active",
            source_revision: evidence.source_revision,
            metadata: {
              source_kind: evidence.source_kind,
              snapshot_source: evidence.snapshot_source,
            },
          },
          period: {
            kind: "schedule_period",
            domain: scheduleDomain,
            domain_id: periodDomainId,
            label: evidence.title,
            lifecycle_state: "active",
            source_revision: evidence.source_revision,
            metadata: {
              period_number: evidence.period_number,
              snapshot_source: evidence.snapshot_source,
            },
          },
          class_section: {
            kind: "class",
            domain: "academic_structure",
            domain_id: evidence.class_section_id,
            label: evidence.class_label,
            lifecycle_state: "active",
            source_revision: evidence.class_revision,
            metadata: {},
          },
          subject: evidence.subject_id ? {
            kind: "subject",
            domain: "academic_structure",
            domain_id: evidence.subject_id,
            label: evidence.subject_label ?? evidence.title,
            lifecycle_state: "active",
            source_revision: evidence.subject_revision ?? 1,
            metadata: { code: evidence.subject_code },
          } : null,
          space: evidence.space_id ? {
            kind: "space",
            domain: "campus_topology",
            domain_id: evidence.space_id,
            label: evidence.space_label ?? evidence.room,
            lifecycle_state: "active",
            source_revision: evidence.space_revision ?? 1,
            metadata: {},
          } : null,
          duty_date: evidence.duty_date,
          period_number: evidence.period_number,
          starts_at: evidence.starts_at,
          ends_at: evidence.ends_at,
          title: evidence.title,
          slot_type: evidence.slot_type,
          room_snapshot: evidence.room,
          original_teacher_user_id: evidence.original_teacher_user_id,
          replacement_teacher_user_id: evidence.replacement_teacher_user_id,
          accepted_at: acceptedAt,
          imported_at: outbox.imported_at,
          correlation_id: outbox.id,
          import_reason: "pre_core_projection_backfill",
        },
      );
      if (projection.projection_status === "source_mismatch") {
        throw new ConflictException(
          "The retained accepted cover does not match the campus timetable projection.",
        );
      }
      eventIds.push(projection.event_id);
    }
    return { model_event_ids: eventIds };
  }

  async createTasksForApprovedLeave(
    transaction: Transaction<Database>,
    input: ApprovedLeaveCoverageInput,
  ) {
    const scheduleTasks = await sql<{ id: string }>`INSERT INTO staff_coverage_tasks(
        school_id,leave_request_id,absent_staff_profile_id,source_schedule_id,class_section_id,subject_id,
        duty_date,period_number,starts_at,ends_at,title,location,handover_note)
      SELECT ${input.school_id}::uuid,${input.request.id}::uuid,
        ${input.request.staff_profile_id}::uuid,schedule.id,schedule.class_section_id,schedule.subject_id,
        day::date,schedule.period_number,schedule.starts_at,schedule.ends_at,schedule.title,
        schedule.room,${input.request.handover_note}
      FROM generate_series(${input.request.starts_on}::date,${input.request.ends_on}::date,interval '1 day') day
      CROSS JOIN LATERAL planned_school_schedule_v2(${input.school_id}::uuid,day::date) schedule
      WHERE schedule.teacher_user_id=${input.absent_teacher_user_id}::uuid
        AND schedule.slot_type='class' AND NOT schedule.cancelled
        AND (${input.request.portion}='full_day'
          OR (${input.request.portion}='first_half' AND schedule.starts_at<time '12:00')
          OR (${input.request.portion}='second_half' AND schedule.starts_at>=time '12:00'))
      ON CONFLICT DO NOTHING RETURNING id`.execute(transaction);
    const responsibilityTasks = await sql<{ id: string }>`INSERT INTO staff_coverage_tasks(
        school_id,leave_request_id,absent_staff_profile_id,responsibility_assignment_id,class_section_id,subject_id,
        duty_date,starts_at,ends_at,title,location,handover_note)
      SELECT assignment.school_id,${input.request.id}::uuid,assignment.staff_profile_id,
        assignment.id,assignment.class_section_id,assignment.subject_id,assignment.starts_on,
        assignment.starts_at,assignment.ends_at,
        type.name||CASE WHEN assignment.scope_label='' THEN '' ELSE ' · '||assignment.scope_label END,
        assignment.location,${input.request.handover_note}
      FROM staff_responsibility_assignments assignment
      JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id
      WHERE assignment.school_id=${input.school_id}::uuid
        AND assignment.staff_profile_id=${input.request.staff_profile_id}::uuid
        AND assignment.status='active' AND type.scope_kind IN ('event','scheduled_duty')
        AND assignment.starts_on BETWEEN ${input.request.starts_on}::date AND ${input.request.ends_on}::date
        AND (${input.request.portion}='full_day' OR assignment.starts_at IS NULL
          OR (${input.request.portion}='first_half' AND assignment.starts_at<time '12:00')
          OR (${input.request.portion}='second_half' AND assignment.starts_at>=time '12:00'))
      ON CONFLICT DO NOTHING RETURNING id`.execute(transaction);
    const ids = [...scheduleTasks.rows, ...responsibilityTasks.rows].map((row) => row.id);
    if (!ids.length) return ids;
    await transaction.insertInto("staff_coverage_task_audits").values(ids.map((task_id) => ({
      school_id: input.school_id,
      task_id,
      actor_id: input.actor_user_id,
      action: "created" as const,
      from_status: null,
      to_status: "open",
      note: "Created automatically from approved leave.",
      automated: true,
    }))).execute();
    const admins = await this.activeAdmins(transaction, input.school_id);
    const created = await transaction.selectFrom("staff_coverage_tasks")
      .select(["id", "duty_date", "revision", "title", "class_section_id"])
      .where("school_id", "=", input.school_id).where("id", "in", ids).execute();
    for (const task of created) {
      const openedOutboxEventId = await this.enqueue(transaction, {
        school_id: input.school_id,
        event_type: "staff.coverage.opened",
        aggregate_id: task.id,
        revision: task.revision,
        audience_user_ids: admins,
        payload: {
          school_id: input.school_id,
          status: "open",
          revision: task.revision,
          duty_date: String(task.duty_date),
          class_section_id: task.class_section_id,
          title: task.title,
          automated: true,
          refresh: ["staff-operations", "requests", "attention", "principal.home", "principal.timetable"],
        },
      });
      await this.coverageOffers.routeFirstOffer(transaction, {
        school_id: input.school_id,
        actor_user_id: input.actor_user_id,
        task_id: task.id,
        source_task_revision: task.revision,
        source_outbox_event_id: openedOutboxEventId,
        route_kind: "automatic",
      });
    }
    return ids;
  }

  async reconcileEffectiveCoverage(
    transaction: Transaction<Database>,
    input: CoverageReconciliationInput,
  ): Promise<CoverageReconciliationReceipt> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${input.school_id}`},0))`.execute(transaction);
    const prepared = await this.prepareEffectiveCoverageProjection(
      transaction,
      input,
    );
    const stale = (await sql<StaleSubstitution>`SELECT *
      FROM reconcile_staff_timetable_substitution_details(
        ${input.school_id}::uuid,${input.from}::date,${input.to}::date,
        ${input.class_section_id ?? null}::uuid
      )`.execute(transaction)).rows;
    const receipt: CoverageReconciliationReceipt = {
      superseded_substitution_ids: stale.map((row) => row.substitution_id),
      cancelled_task_ids: [],
      reopened_task_ids: [],
      model_event_ids: [...prepared.model_event_ids],
    };
    if (!stale.length) return receipt;

    const admins = await this.activeAdmins(transaction, input.school_id);
    const leaveIds = new Set<string>();
    for (const staleRow of stale) {
      const evidence = (await sql<SubstitutionEvidence>`SELECT
          substitution.id,substitution.coverage_task_id,substitution.source_occurrence_key,
          substitution.source_kind,substitution.source_record_id,substitution.source_revision,
          substitution.source_version,substitution.original_teacher_user_id,
          substitution.replacement_teacher_user_id,substitution.coverage_task_revision,
          substitution.duty_date::text,task.status AS task_status,task.revision AS task_revision,
          task.leave_request_id,task.replacement_staff_profile_id
        FROM staff_timetable_substitutions substitution
        JOIN staff_coverage_tasks task ON task.id=substitution.coverage_task_id
          AND task.school_id=substitution.school_id
        WHERE substitution.school_id=${input.school_id}::uuid
          AND substitution.id=${staleRow.substitution_id}::uuid
        FOR UPDATE OF task`.execute(transaction)).rows[0];
      if (!evidence) throw new ConflictException("The stale cover evidence is no longer available.");
      if (evidence.task_status !== "accepted") continue;
      const note = staleRow.reason === "replacement_unavailable"
        ? "The accepted substitute is no longer available. A new cover decision is required."
        : staleRow.reason === "source_changed"
          ? "The timetable occurrence changed. Review cover against the latest schedule."
          : "The approved-leave coverage obligation changed.";
      const updated = await transaction.updateTable("staff_coverage_tasks").set({
        status: "cancelled",
        response_note: note,
        resolved_at: new Date(),
        updated_at: new Date(),
      }).where("id", "=", evidence.coverage_task_id)
        .where("school_id", "=", input.school_id)
        .where("status", "=", "accepted")
        .returningAll().executeTakeFirst();
      if (!updated) continue;
      receipt.cancelled_task_ids.push(updated.id);
      leaveIds.add(evidence.leave_request_id);
      await transaction.insertInto("staff_coverage_task_audits").values({
        school_id: input.school_id,
        task_id: updated.id,
        actor_id: input.actor_user_id,
        action: "cancelled",
        from_status: "accepted",
        to_status: "cancelled",
        note,
        automated: true,
      }).execute();
      const replacementActive = (await sql<{ active: boolean }>`SELECT EXISTS(
          SELECT 1 FROM staff_profiles profile
          JOIN users account ON account.id=profile.user_id AND account.is_active
          JOIN school_memberships membership ON membership.school_id=profile.school_id
            AND membership.user_id=profile.user_id AND membership.role='staff' AND membership.is_active
          WHERE profile.id=${evidence.replacement_staff_profile_id}::uuid
            AND profile.school_id=${input.school_id}::uuid AND profile.status='active'
        ) AS active`.execute(transaction)).rows[0]?.active ?? false;
      const payload = {
        school_id: input.school_id,
        status: "cancelled",
        revision: updated.revision,
        substitution_id: evidence.id,
        occurrence_key: evidence.source_occurrence_key,
        reason: staleRow.reason,
        source_kind: evidence.source_kind,
        source_record_id: evidence.source_record_id,
        source_revision: evidence.source_revision,
        source_version: evidence.source_version,
        original_teacher_user_id: evidence.original_teacher_user_id,
        replacement_teacher_user_id: evidence.replacement_teacher_user_id,
        effective_timetable: false,
        cause: input.cause,
        refresh: [
          "staff-operations", "requests", "attention", "teacher.home",
          "teacher.attendance", "principal.home", "principal.timetable",
          "student.home", "student.timetable", "parent.home", "parent.timetable",
          "calendar", "campus-view",
        ],
      };
      const outboxEventId = await this.enqueue(transaction, {
        school_id: input.school_id,
        event_type: "staff.coverage.cancelled",
        aggregate_id: updated.id,
        revision: updated.revision,
        audience_user_ids: [...admins, evidence.replacement_teacher_user_id],
        notification_user_ids: replacementActive ? [evidence.replacement_teacher_user_id] : [],
        notification_payload: replacementActive ? {
          kind: "general",
          title: "Cover duty changed",
          body: note,
          staff_link: `/teacher/responsibilities?coverage=${updated.id}&coverage_revision=${updated.revision}`,
          attention_eligible: false,
        } : null,
        payload,
      });
      await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
        VALUES(${input.school_id}::uuid,${input.actor_user_id}::uuid,
          'staff.coverage.cancelled',${updated.id}::uuid,
          ${JSON.stringify({
            automated: true,
            reason: staleRow.reason,
            substitution_id: evidence.id,
            correlation_id: input.correlation_id,
            source_outbox_event_id: outboxEventId,
            cause: input.cause,
          })}::jsonb)`.execute(transaction);
      // The exact temporal reversal is recorded after the authoritative Staff
      // task and outbox evidence exist. The implementation is deliberately
      // invoked through the Model Core port rather than writing model tables.
      const model = await this.temporal.recordCancelledScheduleSubstitution(transaction, {
        school_id: input.school_id,
        actor_user_id: input.actor_user_id,
        substitution_id: evidence.id,
        coverage_task_id: updated.id,
        coverage_task_revision: updated.revision,
        source_outbox_event_id: outboxEventId,
        occurrence_key: evidence.source_occurrence_key,
        reason: staleRow.reason,
        source_kind: evidence.source_kind,
        source_record_id: evidence.source_record_id,
        source_revision: evidence.source_revision,
        source_version: evidence.source_version,
        original_teacher_user_id: evidence.original_teacher_user_id,
        replacement_teacher_user_id: evidence.replacement_teacher_user_id,
        cancelled_at: new Date().toISOString(),
        correlation_id: input.correlation_id,
      });
      if (model.projection_status === "source_mismatch") {
        throw new ConflictException(
          "The accepted cover no longer matches the campus timetable projection. No reconciliation was saved.",
        );
      }
      receipt.model_event_ids.push(model.event_id);
    }

    for (const leaveRequestId of leaveIds) {
      const leave = (await sql<{
        id: string; staff_profile_id: string; starts_on: string; ends_on: string;
        portion: string; handover_note: string; user_id: string | null;
      }>`SELECT request.id,request.staff_profile_id,request.starts_on::text,
          request.ends_on::text,request.portion,request.handover_note,profile.user_id
        FROM staff_leave_requests request
        JOIN staff_profiles profile ON profile.id=request.staff_profile_id
          AND profile.school_id=request.school_id
        WHERE request.school_id=${input.school_id}::uuid
          AND request.id=${leaveRequestId}::uuid AND request.status='approved'
        FOR SHARE OF request`.execute(transaction)).rows[0];
      if (!leave) continue;
      const ids = await this.createTasksForApprovedLeave(transaction, {
        school_id: input.school_id,
        actor_user_id: input.actor_user_id,
        request: leave,
        absent_teacher_user_id: leave.user_id,
      });
      receipt.reopened_task_ids.push(...ids);
    }
    return receipt;
  }
}
