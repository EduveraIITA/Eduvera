var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { TEMPORAL_CONTEXT_PORT } from "../campus-model-core/temporal-context.port.js";
import { StaffCoverageOfferBridgeService } from "./staff-coverage-offer-bridge.service.js";
import { staffLeaveResponsibilitySources, staffLeaveScheduleSources } from "./staff-leave-impact.query.js";
export const STAFF_COVERAGE_RECONCILIATION_PORT = Symbol("STAFF_COVERAGE_RECONCILIATION_PORT");
export function acceptedCoverageImportPayload(evidence, importedAt) {
    return {
        school_id: evidence.school_id,
        status: "accepted",
        revision: evidence.coverage_task_revision,
        substitution_id: evidence.substitution_id,
        effective_timetable: true,
        occurrence_key: evidence.source_occurrence_key,
        source_kind: evidence.source_kind,
        source_record_id: evidence.source_record_id,
        source_revision: evidence.source_revision,
        source_version: evidence.source_version,
        source_schedule_id: evidence.source_schedule_id,
        original_teacher_user_id: evidence.original_teacher_user_id,
        replacement_teacher_user_id: evidence.replacement_teacher_user_id,
        import_reason: "pre_core_projection_backfill",
        imported_at: importedAt,
    };
}
let StaffCoverageReconciliationService = class StaffCoverageReconciliationService {
    temporal;
    coverageOffers;
    constructor(temporal, coverageOffers) {
        this.temporal = temporal;
        this.coverageOffers = coverageOffers;
    }
    async activeAdmins(transaction, schoolId) {
        return (await sql `SELECT membership.user_id
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid
        AND membership.role='admin' AND membership.is_active
      ORDER BY membership.user_id`.execute(transaction)).rows.map((row) => row.user_id);
    }
    async enqueue(transaction, input) {
        const audience = [...new Set(input.audience_user_ids)].sort();
        const notificationUsers = [...new Set(input.notification_user_ids ?? [])].sort();
        const notification = input.notification_payload ?? null;
        const idempotencyKey = `${input.event_type}:${input.aggregate_id}:${input.revision}`;
        const inserted = (await sql `INSERT INTO event_outbox(
        school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,
        idempotency_key,notification_user_ids,notification_payload
      ) VALUES(
        ${input.school_id}::uuid,${input.event_type},'staff_coverage_task',
        ${input.aggregate_id}::uuid,${audience}::uuid[],${JSON.stringify(input.payload)}::jsonb,
        ${idempotencyKey},${notificationUsers}::uuid[],
        ${notification ? JSON.stringify(notification) : null}::jsonb
      ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`.execute(transaction)).rows[0];
        if (inserted)
            return inserted.id;
        const retained = (await sql `SELECT id,
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
    async ensureAcceptedImportOutbox(transaction, schoolId, evidence) {
        const idempotencyKey = [
            "staff.coverage.accepted-import",
            evidence.substitution_id,
            String(evidence.coverage_task_revision),
        ].join(":");
        const findRetained = async () => (await sql `SELECT
        id,payload->>'imported_at' AS imported_at
      FROM event_outbox
      WHERE school_id=${schoolId}::uuid AND idempotency_key=${idempotencyKey}
      FOR UPDATE`.execute(transaction)).rows[0];
        let retained = await findRetained();
        const importedAt = retained?.imported_at ?? executionNow().toISOString();
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
            retained = (await sql `INSERT INTO event_outbox(
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
        const exact = retained && (await sql `SELECT EXISTS(
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
            throw new ConflictException("The retained accepted-cover import key belongs to different evidence.");
        }
        return retained;
    }
    async prepareEffectiveCoverageProjection(transaction, input) {
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${input.school_id}`},0))`.execute(transaction);
        // Migration 113 retained already-accepted tasks as timetable substitutions,
        // but deliberately did not manufacture a user command or Model Core event.
        // A live post-migration acceptance always has a staff_coverage_commands row
        // and is projected in its originating transaction, so command absence is the
        // domain-owned marker for this narrow, replayable import bridge.
        const retained = (await sql `SELECT
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
        const eventIds = [];
        for (const evidence of retained) {
            if (evidence.accepted_by !== evidence.replacement_teacher_user_id) {
                throw new ConflictException("The retained accepted cover does not identify its accepting teacher.");
            }
            const acceptedDate = new Date(evidence.accepted_at);
            if (!Number.isFinite(acceptedDate.getTime())) {
                throw new ConflictException("The retained accepted cover has an invalid accepted time.");
            }
            const acceptedAt = acceptedDate.toISOString();
            const outbox = await this.ensureAcceptedImportOutbox(transaction, input.school_id, evidence);
            await sql `UPDATE staff_timetable_substitutions
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
            const projection = await this.temporal.recordImportedAcceptedScheduleSubstitution(transaction, {
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
            });
            if (projection.projection_status === "source_mismatch") {
                throw new ConflictException("The retained accepted cover does not match the campus timetable projection.");
            }
            eventIds.push(projection.event_id);
        }
        return { model_event_ids: eventIds };
    }
    async createTasksForApprovedLeave(transaction, input) {
        const window = { school_id: input.school_id, staff_profile_id: input.request.staff_profile_id,
            teacher_user_id: input.absent_teacher_user_id, starts_on: input.request.starts_on, ends_on: input.request.ends_on, portion: input.request.portion };
        const scheduleTasks = await sql `INSERT INTO staff_coverage_tasks(
        school_id,leave_request_id,absent_staff_profile_id,source_schedule_id,class_section_id,subject_id,
        duty_date,period_number,starts_at,ends_at,title,location,handover_note)
      SELECT ${input.school_id}::uuid,${input.request.id}::uuid,
        ${input.request.staff_profile_id}::uuid,schedule.id,schedule.class_section_id,schedule.subject_id,
        schedule.duty_date,schedule.period_number,schedule.starts_at,schedule.ends_at,schedule.title,
        schedule.room,${input.request.handover_note}
      FROM (${staffLeaveScheduleSources(window)}) schedule
      ON CONFLICT DO NOTHING RETURNING id`.execute(transaction);
        const responsibilityTasks = await sql `INSERT INTO staff_coverage_tasks(
        school_id,leave_request_id,absent_staff_profile_id,responsibility_assignment_id,class_section_id,subject_id,
        duty_date,starts_at,ends_at,title,location,handover_note)
      SELECT assignment.school_id,${input.request.id}::uuid,assignment.staff_profile_id,
        assignment.id,assignment.class_section_id,assignment.subject_id,assignment.duty_date,
        assignment.starts_at,assignment.ends_at,
        assignment.title,
        assignment.location,${input.request.handover_note}
      FROM (${staffLeaveResponsibilitySources(window)}) assignment
      ON CONFLICT DO NOTHING RETURNING id`.execute(transaction);
        const ids = [...scheduleTasks.rows, ...responsibilityTasks.rows].map((row) => row.id);
        if (!ids.length)
            return ids;
        await transaction.insertInto("staff_coverage_task_audits").values(ids.map((task_id) => ({
            school_id: input.school_id,
            task_id,
            actor_id: input.actor_user_id,
            action: "created",
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
    async reconcileEffectiveCoverage(transaction, input) {
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${input.school_id}`},0))`.execute(transaction);
        const prepared = await this.prepareEffectiveCoverageProjection(transaction, input);
        const stale = (await sql `SELECT *
      FROM reconcile_staff_timetable_substitution_details(
        ${input.school_id}::uuid,${input.from}::date,${input.to}::date,
        ${input.class_section_id ?? null}::uuid
      )`.execute(transaction)).rows;
        const receipt = {
            superseded_substitution_ids: stale.map((row) => row.substitution_id),
            cancelled_task_ids: [],
            reopened_task_ids: [],
            model_event_ids: [...prepared.model_event_ids],
        };
        if (!stale.length)
            return receipt;
        const admins = await this.activeAdmins(transaction, input.school_id);
        const leaveIds = new Set();
        for (const staleRow of stale) {
            const evidence = (await sql `SELECT
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
            if (!evidence)
                throw new ConflictException("The stale cover evidence is no longer available.");
            if (evidence.task_status !== "accepted")
                continue;
            const note = staleRow.reason === "replacement_unavailable"
                ? "The accepted substitute is no longer available. A new cover decision is required."
                : staleRow.reason === "source_changed"
                    ? "The timetable occurrence changed. Review cover against the latest schedule."
                    : "The approved-leave coverage obligation changed.";
            const updated = await transaction.updateTable("staff_coverage_tasks").set({
                status: "cancelled",
                response_note: note,
                resolved_at: executionNow(),
                updated_at: executionNow(),
            }).where("id", "=", evidence.coverage_task_id)
                .where("school_id", "=", input.school_id)
                .where("status", "=", "accepted")
                .returningAll().executeTakeFirst();
            if (!updated)
                continue;
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
            const replacementActive = (await sql `SELECT EXISTS(
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
                    staff_link: `/areas/responsibilities/mine?coverage=${updated.id}&coverage_revision=${updated.revision}`,
                    attention_eligible: false,
                } : null,
                payload,
            });
            await sql `INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
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
                cancelled_at: executionNow().toISOString(),
                correlation_id: input.correlation_id,
            });
            if (model.projection_status === "source_mismatch") {
                throw new ConflictException("The accepted cover no longer matches the campus timetable projection. No reconciliation was saved.");
            }
            receipt.model_event_ids.push(model.event_id);
        }
        for (const leaveRequestId of leaveIds) {
            const leave = (await sql `SELECT request.id,request.staff_profile_id,request.starts_on::text,
          request.ends_on::text,request.portion,request.handover_note,profile.user_id
        FROM staff_leave_requests request
        JOIN staff_profiles profile ON profile.id=request.staff_profile_id
          AND profile.school_id=request.school_id
        WHERE request.school_id=${input.school_id}::uuid
          AND request.id=${leaveRequestId}::uuid AND request.status='approved'
        FOR SHARE OF request`.execute(transaction)).rows[0];
            if (!leave)
                continue;
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
};
StaffCoverageReconciliationService = __decorate([
    Injectable(),
    __param(0, Inject(TEMPORAL_CONTEXT_PORT)),
    __metadata("design:paramtypes", [Object, StaffCoverageOfferBridgeService])
], StaffCoverageReconciliationService);
export { StaffCoverageReconciliationService };
//# sourceMappingURL=staff-coverage-reconciliation.service.js.map