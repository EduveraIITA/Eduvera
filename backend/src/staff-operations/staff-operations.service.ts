import { issueInvitationCode } from '../common/invitation-code.js';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { accessRoleCatalogue, staffRoleAssignments } from "../roles/access-roles.service.js";
import { roleOptions } from "../roles/scoped-role-policy.js";
import { TEMPORAL_CONTEXT_PORT, type TemporalContextPort } from "../campus-model-core/temporal-context.port.js";
import {
  DOMAIN_COMMAND_GATEWAY_PORT,
  type DomainCommandGatewayPort,
} from "../campus-model-core/domain-command-gateway.port.js";
import {
  STAFF_COVERAGE_RECONCILIATION_PORT,
  type CoverageReconciliationInput,
  type StaffCoverageReconciliationPort,
} from "./staff-coverage-reconciliation.service.js";
import { StaffLeaveModelBridgeService } from "./staff-leave-model-bridge.service.js";
import { StaffCoverageOfferBridgeService } from "./staff-coverage-offer-bridge.service.js";

type Db = Kysely<Database> | Transaction<Database>;
type MembershipRole = "staff" | "admin";
const uuid = z.string().uuid();
const date = z.iso.date();

const profileInput = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().max(100).default(""),
  email: z.email().trim().toLowerCase(),
  phone: z.string().trim().max(30).default(""),
  staff_code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9/_-]{1,39}$/),
  staff_kind: z.enum(["teaching", "non_teaching"]),
  designation: z.string().trim().min(2).max(120),
  department: z.string().trim().max(120).default(""),
  employment_type: z.enum(["full_time", "part_time", "contract"]),
  joined_on: date,
});
const policyInput = z.object({
  academic_year: z.string().trim().min(4).max(20),
  code: z.string().trim().min(2).max(24).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(100),
  annual_allowance: z.coerce.number().min(0).max(366),
  carry_forward_limit: z.coerce.number().min(0).max(366).default(0),
  requires_document_after_days: z.coerce.number().positive().max(366).nullable().default(null),
  is_paid: z.boolean().default(true),
  is_statutory: z.boolean().default(false),
  is_active: z.boolean().default(true),
  expected_revision: z.number().int().positive().optional(),
});
const assignmentInput = z.object({
  responsibility_type_id: uuid,
  staff_profile_id: uuid,
  class_section_id: uuid.nullable().default(null),
  subject_id: uuid.nullable().default(null),
  event_id: uuid.nullable().default(null),
  scope_label: z.string().trim().max(180).default(""),
  location: z.string().trim().max(120).default(""),
  starts_on: date,
  ends_on: date.nullable().default(null),
  starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  ends_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  notes: z.string().trim().max(1000).default(""),
  backup_staff_profile_id: uuid.nullable().default(null),
});
const coveragePolicyInput = z.object({
  enabled: z.boolean(),
  deadline_minutes_before: z.number().int().min(0).max(1440),
  fallback_kind: z.enum(["independent_study", "physical_activity", "library_period", "merge_class", "cancelled_period"]),
  fallback_label: z.string().trim().min(3).max(120),
  supervisor_staff_profile_id: uuid.nullable().default(null),
  expected_revision: z.number().int().nonnegative(),
});
const requestLeaveInput = z.object({
  policy_id: uuid,
  starts_on: date,
  ends_on: date,
  portion: z.enum(["full_day", "first_half", "second_half"]).default("full_day"),
  reason: z.string().trim().min(8).max(1000),
  handover_note: z.string().trim().max(1000).default(""),
  command_id: uuid,
}).strict();
const decideLeaveInput = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(1000).default(""),
  expected_revision: z.number().int().positive(),
  command_id: uuid,
}).strict();
const withdrawLeaveInput = z.object({
  expected_revision: z.number().int().positive(),
  command_id: uuid,
}).strict();
const respondCoverageInput = z.object({
  decision: z.enum(["accepted", "declined"]),
  note: z.string().trim().max(500).default(""),
  expected_revision: z.number().int().positive(),
  command_id: uuid,
}).strict();

type StaffLeaveCommandType = "submit" | "decide" | "withdraw";
type StaffCoverageCommandType = "respond";
type RetainedOutboxEvent = {
  id: string;
  school_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_matches: boolean;
  audience_matches: boolean;
  notification_users_match: boolean;
  notification_payload_matches: boolean;
};
type StaffLeaveCommandEvidence = {
  correlation_id: string;
  causation_event_id: string | null;
  authority_receipt: Record<string, unknown> | null;
  coordination_receipt: Record<string, unknown> | null;
};
type EffectiveCoverageSource = {
  id: string;
  class_section_id: string;
  subject_id: string | null;
  period_number: number;
  starts_at: string;
  ends_at: string;
  teacher_user_id: string | null;
  occurrence_key: string;
  source_kind: "daily_plan" | "published_timetable" | "legacy_timetable";
  source_record_id: string;
  source_revision: number;
  source_version: number | null;
  title: string;
  slot_type: "class" | "break" | "activity";
  room: string;
  timezone: string;
  class_label: string;
  subject_name: string | null;
  subject_code: string | null;
  space_id: string | null;
  space_name: string | null;
  space_revision: number | null;
};

export type StaffProjectionMutation =
  | "profile_created"
  | "onboarding_updated"
  | "leave_policy_created"
  | "leave_policy_updated"
  | "leave_balance_adjusted"
  | "coverage_policy_updated";

const STAFF_PROJECTION_EVENTS = {
  profile_created: {
    eventType: "staff.access.updated",
    aggregateType: "staff_profile",
    refresh: ["staff-operations", "principal.home", "institution-activation", "campus-view"],
  },
  onboarding_updated: {
    eventType: "staff.access.updated",
    aggregateType: "staff_profile",
    refresh: [
      "staff.access",
      "staff-operations",
      "teacher.home",
      "teacher.attendance",
      "principal.home",
      "institution-activation",
      "campus-view",
    ],
  },
  leave_policy_created: {
    eventType: "administration.updated",
    aggregateType: "staff_leave_policy",
    refresh: ["staff-operations"],
  },
  leave_policy_updated: {
    eventType: "administration.updated",
    aggregateType: "staff_leave_policy",
    refresh: ["staff-operations"],
  },
  leave_balance_adjusted: {
    eventType: "administration.updated",
    aggregateType: "staff_leave_balance_adjustment",
    refresh: ["staff-operations"],
  },
  coverage_policy_updated: {
    eventType: "administration.updated",
    aggregateType: "staff_coverage_policy",
    refresh: ["staff-operations"],
  },
} as const satisfies Record<StaffProjectionMutation, {
  eventType: "staff.access.updated" | "administration.updated";
  aggregateType: string;
  refresh: readonly string[];
}>;

export function staffProjectionUpdateEvent(input: {
  mutation: StaffProjectionMutation;
  schoolId: string;
  aggregateId: string;
  revision: number;
  audienceUserIds: string[];
  metadata?: Record<string, unknown>;
  extraRefresh?: string[];
}) {
  const contract = STAFF_PROJECTION_EVENTS[input.mutation];
  return {
    eventType: contract.eventType,
    aggregateType: contract.aggregateType,
    aggregateId: input.aggregateId,
    audienceUserIds: [...new Set(input.audienceUserIds)].sort(),
    idempotencyNamespace: `staff.${input.mutation}`,
    payload: {
      school_id: input.schoolId,
      action: input.mutation,
      revision: input.revision,
      ...(input.metadata ?? {}),
      refresh: [...new Set([...contract.refresh, ...(input.extraRefresh ?? [])])],
    },
  };
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]));
  }
  return value;
}

export function staffLeaveCommandHash(operation: StaffLeaveCommandType, targetRequestId: string | null, input: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalJson({ operation, target_request_id: targetRequestId, input }))).digest("hex");
}

export function staffCoverageCommandHash(operation: StaffCoverageCommandType, targetTaskId: string, input: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalJson({ operation, target_task_id: targetTaskId, input }))).digest("hex");
}

export function assertRetainedStaffLeaveOutbox(
  retained: RetainedOutboxEvent | undefined,
  expected: Omit<RetainedOutboxEvent, "id" | "payload_matches" | "audience_matches" | "notification_users_match" | "notification_payload_matches">,
) {
  if (!retained || retained.school_id !== expected.school_id || retained.event_type !== expected.event_type
    || retained.aggregate_type !== expected.aggregate_type || retained.aggregate_id !== expected.aggregate_id
    || !retained.payload_matches || !retained.audience_matches
    || !retained.notification_users_match || !retained.notification_payload_matches) {
    throw new ConflictException("The retained outbox key belongs to different event details.");
  }
  return retained.id;
}

export {
  profileInput, policyInput, assignmentInput, coveragePolicyInput,
  requestLeaveInput, decideLeaveInput, withdrawLeaveInput, respondCoverageInput,
};

@Injectable()
export class StaffOperationsService implements OnModuleInit, OnModuleDestroy {
  private coverageTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: DatabaseService,
    private readonly staffLeaveModel: StaffLeaveModelBridgeService,
    private readonly coverageOffers: StaffCoverageOfferBridgeService,
    @Inject(STAFF_COVERAGE_RECONCILIATION_PORT) private readonly coverage: StaffCoverageReconciliationPort,
    @Inject(TEMPORAL_CONTEXT_PORT) private readonly temporal: TemporalContextPort,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commandGateway: DomainCommandGatewayPort,
  ) {}

  onModuleInit() {
    this.coverageTimer = setInterval(() => {
      void this.reconcileCoverageDeadlines().catch(() => undefined);
    }, 60_000);
    this.coverageTimer.unref();
  }

  onModuleDestroy() {
    if (this.coverageTimer) clearInterval(this.coverageTimer);
  }

  private async membership(user: AuthUser, schoolId: string, roles: MembershipRole[], db: Db = this.db) {
    uuid.parse(schoolId);
    const result = await db.selectFrom("school_memberships").select("role")
      .where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true)
      .where("role", "in", roles).orderBy(sql`role='admin'`, "desc").executeTakeFirst();
    if (!result) throw new ForbiddenException("Active school staff access is required.");
    return result as { role: MembershipRole };
  }

  private async principal(user: AuthUser, schoolId: string, db: Db = this.db) {
    return this.membership(user, schoolId, ["admin"], db);
  }

  private async canReviewStaffLeave(
    user: AuthUser,
    schoolId: string,
    transaction: Transaction<Database>,
  ) {
    try {
      await this.staffLeaveModel.assertDecisionAuthority(
        transaction,
        schoolId,
        user.id,
        new Date(),
      );
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException
        || error instanceof ConflictException
        || error instanceof NotFoundException) return false;
      throw error;
    }
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, action: string, targetId: string, metadata: Record<string, unknown> = {}) {
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES (${schoolId}::uuid,${user.id}::uuid,${action},${targetId}::uuid,${JSON.stringify(metadata)}::jsonb)`.execute(db);
  }

  private async activeMemberAudience(
    db: Transaction<Database>,
    schoolId: string,
    roles: MembershipRole[],
  ) {
    const rows = await db.selectFrom("school_memberships as membership")
      .innerJoin("users as account", "account.id", "membership.user_id")
      .select("membership.user_id")
      .where("membership.school_id", "=", schoolId)
      .where("membership.is_active", "=", true)
      .where("membership.role", "in", roles)
      .where("account.is_active", "=", true)
      .execute();
    return rows.map((row) => row.user_id);
  }

  private async enqueueStaffProjectionUpdate(
    db: Transaction<Database>,
    input: Parameters<typeof staffProjectionUpdateEvent>[0],
  ) {
    const event = staffProjectionUpdateEvent(input);
    await this.enqueue(
      db,
      input.schoolId,
      event.aggregateId,
      event.eventType,
      event.audienceUserIds,
      [],
      null,
      event.payload,
      event.aggregateType,
      event.idempotencyNamespace,
    );
  }

  private async enqueue(db: Transaction<Database>, schoolId: string, requestId: string, event: string, audience: string[], notificationUsers: string[], notification: Record<string, unknown> | null, payload: Record<string, unknown>, aggregateType = "staff_leave_request", idempotencyNamespace = event) {
    const revision = typeof payload.revision === "number" ? payload.revision : 1;
    const idempotencyKey = `${idempotencyNamespace}:${requestId}:${revision}`;
    const exactAudience = [...new Set(audience)].sort();
    const exactNotificationUsers = [...new Set(notificationUsers)].sort();
    const inserted = await db.insertInto("event_outbox").values({
      school_id: schoolId, event_type: event, aggregate_type: aggregateType, aggregate_id: requestId,
      audience_user_ids: exactAudience, payload,
      idempotency_key: idempotencyKey,
      notification_user_ids: exactNotificationUsers, notification_payload: notification as any,
    }).onConflict((conflict) => conflict.column("idempotency_key").doNothing())
      .returning("id").executeTakeFirst();
    if (inserted) return inserted.id;
    const retained = (await sql<RetainedOutboxEvent>`SELECT id,school_id,event_type,aggregate_type,aggregate_id,
        payload=${JSON.stringify(payload)}::jsonb AS payload_matches,
        audience_user_ids=${exactAudience}::uuid[] AS audience_matches,
        notification_user_ids=${exactNotificationUsers}::uuid[] AS notification_users_match,
        notification_payload IS NOT DISTINCT FROM ${notification ? JSON.stringify(notification) : null}::jsonb
          AS notification_payload_matches
      FROM event_outbox WHERE idempotency_key=${idempotencyKey} FOR UPDATE`.execute(db)).rows[0];
    return assertRetainedStaffLeaveOutbox(retained, {
      school_id: schoolId,
      event_type: event,
      aggregate_type: aggregateType,
      aggregate_id: requestId,
    });
  }

  private async priorLeaveCommand<T>(
    db: Transaction<Database>,
    schoolId: string,
    actorId: string,
    commandId: string,
    commandType: StaffLeaveCommandType,
    requestHash: string,
  ) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-leave:${schoolId}:${actorId}:${commandId}`},0))`.execute(db);
    const prior = (await sql<{
      command_type: StaffLeaveCommandType;
      request_hash: string;
      result: T;
      target_request_id: string;
      outbox_event_id: string;
      correlation_id: string;
      causation_event_id: string | null;
      authority_receipt: Record<string, unknown> | null;
      coordination_receipt: Record<string, unknown> | null;
    }>`SELECT command_type,request_hash,result,target_request_id,outbox_event_id,
        correlation_id,causation_event_id,authority_receipt,coordination_receipt
      FROM staff_leave_commands
      WHERE school_id=${schoolId}::uuid AND actor_id=${actorId}::uuid AND command_id=${commandId}::uuid`.execute(db)).rows[0];
    if (!prior) return null;
    if (prior.command_type !== commandType || prior.request_hash !== requestHash) {
      throw new ConflictException("This command ID was already used for different leave details.");
    }
    return prior;
  }

  private async saveLeaveCommand(
    db: Transaction<Database>,
    schoolId: string,
    actorId: string,
    commandId: string,
    commandType: StaffLeaveCommandType,
    targetRequestId: string,
    requestHash: string,
    result: unknown,
    outboxEventId: string,
    evidence: StaffLeaveCommandEvidence,
  ) {
    await sql`INSERT INTO staff_leave_commands(
        school_id,actor_id,command_id,command_type,target_request_id,request_hash,result,outbox_event_id,
        correlation_id,causation_event_id,authority_receipt,coordination_receipt
      ) VALUES(
        ${schoolId}::uuid,${actorId}::uuid,${commandId}::uuid,${commandType},${targetRequestId}::uuid,
        ${requestHash},${JSON.stringify(result)}::jsonb,${outboxEventId}::uuid,
        ${evidence.correlation_id}::uuid,${evidence.causation_event_id}::uuid,
        ${evidence.authority_receipt ? JSON.stringify(evidence.authority_receipt) : null}::jsonb,
        ${evidence.coordination_receipt ? JSON.stringify(evidence.coordination_receipt) : null}::jsonb
      )`.execute(db);
  }

  private async priorCoverageCommand<T>(
    db: Transaction<Database>,
    schoolId: string,
    actorId: string,
    commandId: string,
    targetTaskId: string,
    requestHash: string,
  ) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-coverage:${schoolId}:${actorId}:${commandId}`},0))`.execute(db);
    const prior = (await sql<{
      command_type: StaffCoverageCommandType;
      target_task_id: string;
      request_hash: string;
      result: T;
    }>`SELECT command_type,target_task_id,request_hash,result
      FROM staff_coverage_commands
      WHERE school_id=${schoolId}::uuid
        AND actor_id=${actorId}::uuid
        AND command_id=${commandId}::uuid`.execute(db)).rows[0];
    if (!prior) return null;
    if (prior.command_type !== "respond"
      || prior.target_task_id !== targetTaskId
      || prior.request_hash !== requestHash) {
      throw new ConflictException("This command ID was already used for different cover details.");
    }
    return prior.result;
  }

  private async saveCoverageCommand(
    db: Transaction<Database>,
    input: {
      school_id: string;
      actor_id: string;
      command_id: string;
      decision: "accepted" | "declined";
      target_task_id: string;
      request_hash: string;
      source_task_revision: number;
      resulting_task_revision: number;
      result: unknown;
      outbox_event_id: string;
      substitution_id: string | null;
      authority_receipt: Record<string, unknown>;
      schedule_provenance: Record<string, unknown>;
    },
  ) {
    await sql`INSERT INTO staff_coverage_commands(
        school_id,actor_id,command_id,command_type,decision,target_task_id,
        request_hash,source_task_revision,resulting_task_revision,result,
        outbox_event_id,substitution_id,authority_receipt,schedule_provenance
      ) VALUES(
        ${input.school_id}::uuid,${input.actor_id}::uuid,${input.command_id}::uuid,
        'respond',${input.decision},${input.target_task_id}::uuid,${input.request_hash},
        ${input.source_task_revision},${input.resulting_task_revision},
        ${JSON.stringify(input.result)}::jsonb,${input.outbox_event_id}::uuid,
        ${input.substitution_id}::uuid,${JSON.stringify(input.authority_receipt)}::jsonb,
        ${JSON.stringify(input.schedule_provenance)}::jsonb
      )`.execute(db);
  }

  private async leaveSubmissionTrace(
    db: Transaction<Database>,
    schoolId: string,
    requestId: string,
  ) {
    const rows = (await sql<{
      correlation_id: string;
      authority_receipt: Record<string, unknown>;
      coordination_receipt: Record<string, unknown>;
    }>`SELECT correlation_id,authority_receipt,coordination_receipt
      FROM staff_leave_commands
      WHERE school_id=${schoolId}::uuid AND target_request_id=${requestId}::uuid
        AND command_type='submit'
      FOR SHARE`.execute(db)).rows;
    if (rows.length !== 1) {
      throw new ConflictException("The staff-leave coordination trace is missing or ambiguous.");
    }
    const eventId = rows[0]!.coordination_receipt?.event_id;
    if (typeof eventId !== "string" || !uuid.safeParse(eventId).success) {
      throw new ConflictException("The staff-leave coordination event is not available.");
    }
    const messageIds = rows[0]!.coordination_receipt?.message_ids;
    const originalOwnerId = rows[0]!.authority_receipt?.user_id;
    if (!Array.isArray(messageIds) || messageIds.length !== 1
      || typeof messageIds[0] !== "string" || !uuid.safeParse(messageIds[0]).success
      || typeof originalOwnerId !== "string" || !uuid.safeParse(originalOwnerId).success) {
      throw new ConflictException("The staff-leave coordination recipient trace is not available.");
    }
    return {
      correlation_id: rows[0]!.correlation_id,
      causation_event_id: eventId,
      message_id: messageIds[0],
      original_owner_user_id: originalOwnerId,
    };
  }

  async reconcileCoverageDeadlines(schoolId?: string) {
    if (schoolId) uuid.parse(schoolId);
    return this.db.transaction().execute(async (db) => {
      const candidates = await sql<{
        id: string;
        school_id: string;
        title: string;
        duty_date: string;
        status: "open" | "offered" | "declined";
        period_ended: boolean;
        policy_enabled: boolean;
        deadline_minutes_before: number;
        fallback_kind: "independent_study" | "physical_activity" | "library_period" | "merge_class" | "cancelled_period";
        fallback_label: string;
        supervisor_staff_profile_id: string | null;
        policy_revision: number;
        policy_actor_id: string;
      }>`
        SELECT task.id,task.school_id,task.title,task.duty_date::text,task.status,
          now() >= ((task.duty_date + COALESCE(task.ends_at,task.starts_at,time '23:59')) AT TIME ZONE school.timezone) AS period_ended,
          COALESCE(policy.enabled,false) AS policy_enabled,
          COALESCE(policy.deadline_minutes_before,30)::int AS deadline_minutes_before,
          COALESCE(policy.fallback_kind,'independent_study') AS fallback_kind,
          COALESCE(policy.fallback_label,'Independent study') AS fallback_label,
          policy.supervisor_staff_profile_id,
          COALESCE(policy.revision,0)::int AS policy_revision,
          COALESCE(policy.updated_by,administrator.user_id) AS policy_actor_id
        FROM staff_coverage_tasks task
        JOIN schools school ON school.id=task.school_id
        JOIN LATERAL (
          SELECT membership.user_id FROM school_memberships membership
          WHERE membership.school_id=task.school_id AND membership.role='admin' AND membership.is_active
          ORDER BY membership.created_at,membership.id LIMIT 1
        ) administrator ON true
        LEFT JOIN staff_coverage_policies policy ON policy.school_id=task.school_id
        WHERE task.status IN ('open','offered','declined')
          AND (${schoolId ?? null}::uuid IS NULL OR task.school_id=${schoolId ?? null}::uuid)
          AND (
            now() >= ((task.duty_date + COALESCE(task.ends_at,task.starts_at,time '23:59')) AT TIME ZONE school.timezone)
            OR (COALESCE(policy.enabled,false) AND now() >=
              ((task.duty_date + COALESCE(task.starts_at,time '00:00')) AT TIME ZONE school.timezone)
              - make_interval(mins=>policy.deadline_minutes_before))
          )
        ORDER BY task.duty_date,task.starts_at NULLS LAST,task.id
        FOR UPDATE OF task SKIP LOCKED
        LIMIT 250`.execute(db);

      let resolved = 0;
      for (const item of candidates.rows) {
        const expired = item.period_ended;
        // A configured fallback is the school's administrative decision. It is
        // safe to record even when reconciliation runs late, provided we never
        // describe it as proof that a teacher or activity actually took place.
        const fallbackDecided = item.policy_enabled;
        const nextStatus = fallbackDecided ? "fallback_applied" : "expired_unconfirmed";
        const label = fallbackDecided
          ? item.fallback_label
          : "Period ended without a recorded cover decision";
        const updated = await db.updateTable("staff_coverage_tasks").set({
          status: nextStatus,
          fallback_kind: fallbackDecided ? item.fallback_kind : "unconfirmed",
          fallback_label: label,
          fallback_supervisor_staff_profile_id: fallbackDecided ? item.supervisor_staff_profile_id : null,
          resolution_policy_revision: fallbackDecided ? item.policy_revision : null,
          resolved_at: new Date(),
          updated_at: new Date(),
        }).where("id", "=", item.id)
          .where("status", "in", ["open", "offered", "declined"])
          .returningAll().executeTakeFirst();
        if (!updated) continue;
        resolved += 1;
        await db.insertInto("staff_coverage_task_audits").values({
          school_id: item.school_id,
          task_id: item.id,
          actor_id: item.policy_actor_id,
          action: nextStatus,
          from_status: item.status,
          to_status: nextStatus,
          note: label,
          automated: true,
        }).execute();
        const recipients = await sql<{ user_id: string }>`
          SELECT membership.user_id FROM school_memberships membership
          WHERE membership.school_id=${item.school_id}::uuid AND membership.role='admin' AND membership.is_active
          UNION
          SELECT profile.user_id FROM staff_profiles profile
          WHERE profile.id=${fallbackDecided ? item.supervisor_staff_profile_id : null}::uuid
            AND profile.status='active' AND profile.user_id IS NOT NULL`.execute(db);
        const userIds = recipients.rows.map((row) => row.user_id);
        await this.enqueue(db, item.school_id, item.id, `staff.coverage.${nextStatus}`, userIds, expired ? [] : userIds, expired ? null : {
          kind: "general",
          title: "Cover fallback decided",
          body: `${item.title} will use ${label}.`,
          admin_link: `/principal/staff?section=leave&coverage=${item.id}&coverage_revision=${updated.revision}`,
        }, {
          school_id: item.school_id,
          status: nextStatus,
          revision: updated.revision,
          fallback_kind: updated.fallback_kind,
          refresh: ["staff-operations", "requests", "notifications", "attention"],
        }, "staff_coverage_task");
        await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
          VALUES(${item.school_id}::uuid,${item.policy_actor_id}::uuid,${`staff.coverage.${nextStatus}`},${item.id}::uuid,
          ${JSON.stringify({ automated: true, from_status: item.status, fallback_kind: updated.fallback_kind, policy_revision: updated.resolution_policy_revision })}::jsonb)`.execute(db);
      }
      return { resolved };
    });
  }

  async saveCoveragePolicy(user: AuthUser, schoolId: string, body: unknown) {
    const data = coveragePolicyInput.parse(body);
    const saved = await this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const current = await db.selectFrom("staff_coverage_policies").selectAll()
        .where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if ((current?.revision ?? 0) !== data.expected_revision) {
        throw new ConflictException("The cover fallback policy changed. Refresh before saving.");
      }
      if (data.supervisor_staff_profile_id) {
        const supervisor = await db.selectFrom("staff_profiles").select(["id", "user_id"])
          .where("id", "=", data.supervisor_staff_profile_id).where("school_id", "=", schoolId)
          .where("status", "=", "active").executeTakeFirst();
        if (!supervisor?.user_id) throw new BadRequestException("Choose an active fallback supervisor with account access.");
      }
      const values = {
        enabled: data.enabled,
        deadline_minutes_before: data.deadline_minutes_before,
        fallback_kind: data.fallback_kind,
        // Administrators can give the configured outcome the language their
        // staff use (for example, "Games period" rather than a generic label).
        fallback_label: data.fallback_label,
        supervisor_staff_profile_id: data.supervisor_staff_profile_id,
        updated_by: user.id,
        updated_at: new Date(),
      };
      const policy = current
        ? await db.updateTable("staff_coverage_policies").set(values).where("school_id", "=", schoolId).returningAll().executeTakeFirstOrThrow()
        : await db.insertInto("staff_coverage_policies").values({ school_id: schoolId, ...values }).returningAll().executeTakeFirstOrThrow();
      await this.audit(db, user, schoolId, "staff.coverage.policy.updated", schoolId, {
        enabled: policy.enabled,
        deadline_minutes_before: policy.deadline_minutes_before,
        fallback_kind: policy.fallback_kind,
        supervisor_staff_profile_id: policy.supervisor_staff_profile_id,
        revision: policy.revision,
      });
      const audience = await this.activeMemberAudience(db, schoolId, ["admin", "staff"]);
      await this.enqueueStaffProjectionUpdate(db, {
        mutation: "coverage_policy_updated",
        schoolId,
        aggregateId: schoolId,
        revision: policy.revision,
        audienceUserIds: audience,
        metadata: { enabled: policy.enabled },
      });
      return policy;
    });
    await this.reconcileCoverageDeadlines(schoolId);
    return saved;
  }

  private async createCoverageTasks(db: Transaction<Database>, actorId: string, schoolId: string, request: { id: string; staff_profile_id: string; starts_on: string; ends_on: string; portion: string; handover_note: string }, profile: { user_id: string | null }) {
    const ids = await this.coverage.createTasksForApprovedLeave(db, {
      school_id: schoolId,
      actor_user_id: actorId,
      request,
      absent_teacher_user_id: profile.user_id,
    });
    return ids.length;
  }

  async workspace(user: AuthUser, schoolId: string, focusedRequestId?: string) {
    if (focusedRequestId) uuid.parse(focusedRequestId);
    await this.reconcileCoverageDeadlines(schoolId);
    return this.db.transaction().execute(async (db) => {
    const member = await this.membership(user, schoolId, ["admin", "staff"], db);
    const canReviewStaffLeave = await this.canReviewStaffLeave(user, schoolId, db);
    const [accessRoles, roleAssignments] = await Promise.all([
      member.role === "admin" ? accessRoleCatalogue(db, schoolId) : Promise.resolve([]),
      staffRoleAssignments(db, schoolId, member.role === "staff" ? user.id : undefined),
    ]);
    const access = { access_roles: accessRoles, role_assignments: roleAssignments,
      ...(member.role === "admin" ? { role_options: roleOptions() } : {}) };
    const yearResult = await sql<{ academic_year: string }>`SELECT academic_year FROM academic_terms
      WHERE school_id=${schoolId}::uuid ORDER BY is_active DESC,(CURRENT_DATE BETWEEN starts_on AND ends_on) DESC,starts_on DESC LIMIT 1`.execute(db);
    const academicYear = yearResult.rows[0]?.academic_year ?? "";
    const coveragePolicyResult = await sql`SELECT policy.*,
        supervisor.first_name AS supervisor_first_name,supervisor.last_name AS supervisor_last_name
      FROM staff_coverage_policies policy
      LEFT JOIN staff_profiles supervisor ON supervisor.id=policy.supervisor_staff_profile_id
      WHERE policy.school_id=${schoolId}::uuid`.execute(db);
    const coveragePolicy = coveragePolicyResult.rows[0] ?? {
      school_id: schoolId,
      enabled: false,
      deadline_minutes_before: 30,
      fallback_kind: "independent_study",
      fallback_label: "Independent study",
      supervisor_staff_profile_id: null,
      supervisor_first_name: null,
      supervisor_last_name: null,
      revision: 0,
    };
    const policies = await sql`SELECT * FROM staff_leave_policies WHERE school_id=${schoolId}::uuid
      AND (${academicYear}='' OR academic_year=${academicYear}) ORDER BY is_active DESC,name`.execute(db);
    const requests = await sql`SELECT r.*,p.name AS policy_name,p.code AS policy_code,
        profile.first_name,profile.last_name,profile.staff_code,profile.designation,profile.user_id,
        COALESCE((SELECT count(*)::int FROM generate_series(r.starts_on,r.ends_on,interval '1 day') day
          CROSS JOIN LATERAL planned_school_schedule_v2(r.school_id,day::date) schedule
          WHERE schedule.teacher_user_id=profile.user_id AND schedule.slot_type='class'),0) AS affected_periods,
        COALESCE((SELECT count(*)::int FROM staff_coverage_tasks task WHERE task.leave_request_id=r.id),0) AS coverage_tasks,
        COALESCE((SELECT count(*)::int FROM staff_coverage_tasks task WHERE task.leave_request_id=r.id AND task.status IN ('open','offered','declined')),0) AS coverage_open,
        COALESCE((SELECT count(*)::int FROM staff_coverage_tasks task WHERE task.leave_request_id=r.id AND task.status='fallback_applied'),0) AS coverage_fallback,
        COALESCE((SELECT count(*)::int FROM staff_coverage_tasks task WHERE task.leave_request_id=r.id AND task.status IN ('accepted','completed')),0) AS coverage_filled,
        COALESCE((SELECT count(*)::int FROM staff_coverage_tasks task WHERE task.leave_request_id=r.id AND task.status='expired_unconfirmed'),0) AS coverage_expired,
        COALESCE((SELECT string_agg(DISTINCT task.fallback_label, ', ' ORDER BY task.fallback_label)
          FROM staff_coverage_tasks task WHERE task.leave_request_id=r.id AND task.status='fallback_applied' AND task.fallback_label<>''),'') AS coverage_fallback_labels
      FROM staff_leave_requests r JOIN staff_profiles profile ON profile.id=r.staff_profile_id
      JOIN staff_leave_policies p ON p.id=r.policy_id
      WHERE r.school_id=${schoolId}::uuid
        AND (${canReviewStaffLeave} OR profile.user_id=${user.id}::uuid)
      ORDER BY (r.id=${focusedRequestId ?? null}::uuid) DESC,(r.status='submitted') DESC,r.starts_on DESC,r.created_at DESC LIMIT 100`.execute(db);

    const responsibilityTypes = await sql`SELECT type.*,
        COALESCE((SELECT count(*)::int FROM staff_responsibility_assignments assignment
          WHERE assignment.responsibility_type_id=type.id AND assignment.status IN ('offered','active')),0) AS active_assignment_count
      FROM staff_responsibility_types type
      WHERE type.school_id=${schoolId}::uuid AND (${member.role}='admin' OR type.is_active)
      ORDER BY type.is_active DESC,type.category,type.name`.execute(db);
    const assignments = await sql<any>`SELECT assignment.*,type.code AS type_code,type.name AS type_name,type.category,type.scope_kind,
        type.description,type.access_summary,type.requires_acceptance,type.restricted,
        profile.first_name,profile.last_name,profile.staff_code,profile.designation,profile.user_id,profile_user.avatar_url,
        backup.first_name AS backup_first_name,backup.last_name AS backup_last_name,
        CASE WHEN section.id IS NULL THEN NULL ELSE 'Class ' || section.grade || section.section END AS class_name,
        subject.name AS subject_name,event.title AS event_title
      FROM staff_responsibility_assignments assignment
      JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id
      JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id
      LEFT JOIN users profile_user ON profile_user.id=profile.user_id
      LEFT JOIN staff_profiles backup ON backup.id=assignment.backup_staff_profile_id
      LEFT JOIN class_sections section ON section.id=assignment.class_section_id
      LEFT JOIN subjects subject ON subject.id=assignment.subject_id
      LEFT JOIN campus_events event ON event.id=assignment.event_id
      WHERE assignment.school_id=${schoolId}::uuid
        AND (${member.role}='admin' OR (
          profile.user_id=${user.id}::uuid
          AND (assignment.status<>'offered' OR profile.status='active')
        ))
      ORDER BY (assignment.status='offered') DESC,(assignment.status='active') DESC,assignment.starts_on,assignment.created_at DESC`.execute(db);
    const coverageTasks = await sql`SELECT
        task.id,task.school_id,task.leave_request_id,task.absent_staff_profile_id,
        task.replacement_staff_profile_id,task.responsibility_assignment_id,
        task.source_schedule_id,task.class_section_id,task.subject_id,task.duty_date,
        task.period_number,task.starts_at,task.ends_at,task.title,task.location,task.status,
        CASE WHEN ${canReviewStaffLeave} OR absent.user_id=${user.id}::uuid
            OR replacement.user_id=${user.id}::uuid
          THEN task.handover_note ELSE '' END AS handover_note,
        task.assigned_by,task.offered_at,task.responded_at,task.response_note,task.revision,
        task.fallback_kind,task.fallback_label,task.fallback_supervisor_staff_profile_id,
        task.resolution_policy_revision,task.resolved_at,task.created_at,task.updated_at,
        absent.first_name AS absent_first_name,absent.last_name AS absent_last_name,absent.designation AS absent_designation,
        replacement.first_name AS replacement_first_name,replacement.last_name AS replacement_last_name,replacement.user_id AS replacement_user_id,
        fallback_supervisor.first_name AS fallback_supervisor_first_name,fallback_supervisor.last_name AS fallback_supervisor_last_name,
        CASE WHEN section.id IS NULL THEN '' ELSE 'Class ' || section.grade || section.section END AS class_name,
        subject.name AS subject_name,
        offer_route.status AS offer_route_status,
        offer_route.route_kind AS offer_route_kind,
        offer_route.explanation AS offer_route_explanation,
        offer_route.response_due_at AS offer_response_due_at,
        offer_route.expires_at AS offer_expires_at,
        CASE WHEN ${canReviewStaffLeave} OR absent.user_id=${user.id}::uuid
          THEN leave_request.reason ELSE NULL END AS leave_reason
      FROM staff_coverage_tasks task
      JOIN staff_profiles absent ON absent.id=task.absent_staff_profile_id
      LEFT JOIN staff_profiles replacement ON replacement.id=task.replacement_staff_profile_id
      LEFT JOIN staff_profiles fallback_supervisor ON fallback_supervisor.id=task.fallback_supervisor_staff_profile_id
      LEFT JOIN class_sections section ON section.id=task.class_section_id
      LEFT JOIN subjects subject ON subject.id=task.subject_id
      LEFT JOIN LATERAL (
        SELECT route.status,route.route_kind,route.explanation,
          route.response_due_at,route.expires_at
        FROM staff_coverage_offer_routes route
        WHERE route.school_id=task.school_id AND route.coverage_task_id=task.id
        ORDER BY route.route_round DESC
        LIMIT 1
      ) offer_route ON true
      JOIN staff_leave_requests leave_request ON leave_request.id=task.leave_request_id
      WHERE task.school_id=${schoolId}::uuid
        AND (${member.role}='admin' OR absent.user_id=${user.id}::uuid OR (
          replacement.user_id=${user.id}::uuid
          AND (task.status<>'offered' OR replacement.status='active')
        ))
      ORDER BY task.duty_date,task.starts_at NULLS LAST,task.period_number NULLS LAST`.execute(db);
    if (member.role === "staff") {
      const profile = await sql`SELECT profile.*,u.avatar_url FROM staff_profiles profile LEFT JOIN users u ON u.id=profile.user_id
        WHERE profile.school_id=${schoolId}::uuid AND profile.user_id=${user.id}::uuid`.execute(db);
      if (!profile.rows[0]) throw new NotFoundException("Your staff profile is not ready. Ask the school office to complete onboarding.");
      const balances = await sql`SELECT p.id AS policy_id,p.code,p.name,p.annual_allowance,p.carry_forward_limit,p.requires_document_after_days,
          p.is_paid,p.is_statutory,p.academic_year,
          COALESCE((SELECT sum(a.days) FROM staff_leave_balance_adjustments a WHERE a.staff_profile_id=${(profile.rows[0] as { id: string }).id}::uuid AND a.policy_id=p.id),0) AS adjustments,
          COALESCE((SELECT sum(r.requested_days) FROM staff_leave_requests r WHERE r.staff_profile_id=${(profile.rows[0] as { id: string }).id}::uuid AND r.policy_id=p.id AND r.status='approved'),0) AS used,
          COALESCE((SELECT sum(r.requested_days) FROM staff_leave_requests r WHERE r.staff_profile_id=${(profile.rows[0] as { id: string }).id}::uuid AND r.policy_id=p.id AND r.status='submitted'),0) AS pending
        FROM staff_leave_policies p WHERE p.school_id=${schoolId}::uuid AND p.academic_year=${academicYear} AND p.is_active ORDER BY p.name`.execute(db);
      return { ...access, mode: "staff", can_review_staff_leave: canReviewStaffLeave, academic_year: academicYear, profile: profile.rows[0], policies: policies.rows, balances: balances.rows, requests: requests.rows, coverage_policy: coveragePolicy, work_types: responsibilityTypes.rows, responsibility_types: responsibilityTypes.rows, assignments: assignments.rows, coverage_tasks: coverageTasks.rows };
    }

    const profiles = await sql`SELECT profile.*,u.avatar_url,
        count(item.id)::int AS onboarding_total,count(item.completed_at)::int AS onboarding_complete,
        CASE WHEN ${canReviewStaffLeave} THEN
          COALESCE((SELECT count(*)::int FROM staff_leave_requests r WHERE r.staff_profile_id=profile.id AND r.status='submitted'),0)
        ELSE 0 END AS pending_requests
      FROM staff_profiles profile LEFT JOIN users u ON u.id=profile.user_id
      LEFT JOIN staff_onboarding_items item ON item.staff_profile_id=profile.id
      WHERE profile.school_id=${schoolId}::uuid GROUP BY profile.id,u.avatar_url ORDER BY profile.status,profile.first_name,profile.last_name`.execute(db);
    const items = await sql`SELECT item.* FROM staff_onboarding_items item JOIN staff_profiles profile ON profile.id=item.staff_profile_id
      WHERE profile.school_id=${schoolId}::uuid ORDER BY item.staff_profile_id,item.label`.execute(db);
    const balances = await sql`SELECT profile.id AS staff_profile_id,p.id AS policy_id,p.name,p.code,p.annual_allowance,
        COALESCE((SELECT sum(a.days) FROM staff_leave_balance_adjustments a WHERE a.staff_profile_id=profile.id AND a.policy_id=p.id),0) AS adjustments,
        COALESCE((SELECT sum(r.requested_days) FROM staff_leave_requests r WHERE r.staff_profile_id=profile.id AND r.policy_id=p.id AND r.status='approved'),0) AS used,
        COALESCE((SELECT sum(r.requested_days) FROM staff_leave_requests r WHERE r.staff_profile_id=profile.id AND r.policy_id=p.id AND r.status='submitted'),0) AS pending
      FROM staff_profiles profile CROSS JOIN staff_leave_policies p
      WHERE profile.school_id=${schoolId}::uuid AND p.school_id=${schoolId}::uuid AND p.academic_year=${academicYear} AND p.is_active`.execute(db);
    const classes = await sql`SELECT id,'Class ' || grade || section AS name FROM class_sections WHERE school_id=${schoolId}::uuid AND academic_year=${academicYear} ORDER BY grade,section`.execute(db);
    const subjects = await sql`SELECT id,name FROM subjects WHERE school_id=${schoolId}::uuid ORDER BY name`.execute(db);
    const events = await sql`SELECT id,title,starts_at,ends_at FROM campus_events WHERE school_id=${schoolId}::uuid AND status IN ('draft','published') AND ends_at >= now() - interval '1 day' ORDER BY starts_at LIMIT 100`.execute(db);
    return { ...access, mode: "admin", can_review_staff_leave: canReviewStaffLeave, academic_year: academicYear, profiles: profiles.rows, onboarding_items: items.rows, policies: policies.rows, balances: balances.rows, requests: requests.rows, coverage_policy: coveragePolicy, work_types: responsibilityTypes.rows, responsibility_types: responsibilityTypes.rows, assignments: assignments.rows, coverage_tasks: coverageTasks.rows, references: { classes: classes.rows, subjects: subjects.rows, events: events.rows } };
    });
  }


  async createProfile(user: AuthUser, schoolId: string, body: unknown) {
    await this.principal(user, schoolId);
    const data = profileInput.parse(body);
    try {
      return await this.db.transaction().execute(async (db) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
        await this.principal(user, schoolId, db);
        const account = await sql<{ id: string }>`SELECT u.id FROM users u JOIN school_memberships m ON m.user_id=u.id
          WHERE m.school_id=${schoolId}::uuid AND m.role='staff' AND m.is_active AND lower(u.email)=${data.email} LIMIT 1`.execute(db);
        const profile = await db.insertInto("staff_profiles").values({
          school_id: schoolId, user_id: account.rows[0]?.id ?? null, staff_code: data.staff_code,
          first_name: data.first_name, last_name: data.last_name, email: data.email, phone: data.phone,
          staff_kind: data.staff_kind, designation: data.designation, department: data.department,
          employment_type: data.employment_type, joined_on: data.joined_on,
          status: account.rows[0] ? "onboarding" : "onboarding", created_by: user.id, updated_by: user.id,
        }).returningAll().executeTakeFirstOrThrow();
        const labels = [
          ["identity", "Identity verified"], ["service_contract", "Service contract recorded"],
          ["qualifications", "Qualifications checked"], ["emergency_contact", "Emergency contact recorded"],
          ["account_access", "School account active"],
        ] as const;
        await db.insertInto("staff_onboarding_items").values(labels.map(([item_key, label]) => ({
          school_id: schoolId, staff_profile_id: profile.id, item_key, label,
          ...(item_key === "account_access" && account.rows[0] ? { completed_at: new Date(), completed_by: user.id } : {}),
        }))).execute();
        let invitation: { token: string; expires_at: Date; id: string } | null = null;
        if (!account.rows[0]) {
          const {token,tokenHash}=await issueInvitationCode(db,data.email);
          await sql`UPDATE school_invitations SET revoked_at=now() WHERE school_id=${schoolId}::uuid AND lower(email)=${data.email} AND accepted_at IS NULL AND revoked_at IS NULL`.execute(db);
          const invite = await sql<{ id: string; expires_at: Date }>`INSERT INTO school_invitations(school_id,email,role,token_hash,created_by,expires_at)
            VALUES (${schoolId}::uuid,${data.email},'staff',${tokenHash},${user.id}::uuid,now()+interval '30 minutes') RETURNING id,expires_at`.execute(db);
          invitation = { ...invite.rows[0]!, token };
        }
        await this.audit(db, user, schoolId, "staff.profile.created", profile.id, { staff_kind: profile.staff_kind, position: profile.designation, invitation_created: Boolean(invitation) });
        const audience = await this.activeMemberAudience(db, schoolId, ["admin"]);
        await this.enqueueStaffProjectionUpdate(db, {
          mutation: "profile_created",
          schoolId,
          aggregateId: profile.id,
          revision: profile.revision,
          audienceUserIds: [...audience, ...(profile.user_id ? [profile.user_id] : [])],
          metadata: { status: profile.status },
          extraRefresh: invitation ? ["principal.administration"] : [],
        });
        return { profile, invitation };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException("Staff code or email is already in use.");
      throw error;
    }
  }

  async updateOnboarding(user: AuthUser, schoolId: string, profileId: string, body: unknown) {
    uuid.parse(profileId);
    const data = z.object({ item_id: uuid, completed: z.boolean(), note: z.string().trim().max(500).default(""), expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      // All staff eligibility paths acquire the school schedule lock before
      // profile rows. Cover acceptance uses the same order, preventing a
      // schedule/profile lock inversion under concurrent decisions.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${schoolId}`},0))`.execute(db);
      const profile = await db.selectFrom("staff_profiles").selectAll().where("id", "=", profileId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!profile) throw new NotFoundException();
      if (profile.revision !== data.expected_revision) throw new ConflictException("This staff record changed. Refresh before continuing.");
      const item = await db.selectFrom("staff_onboarding_items").selectAll().where("id", "=", data.item_id).where("staff_profile_id", "=", profileId).executeTakeFirst();
      if (!item) throw new NotFoundException();
      await db.updateTable("staff_onboarding_items").set({ completed_at: data.completed ? new Date() : null, completed_by: data.completed ? user.id : null, note: data.note, updated_at: new Date() }).where("id", "=", item.id).execute();
      const remaining = await sql<{ count: number }>`SELECT count(*)::int AS count FROM staff_onboarding_items WHERE staff_profile_id=${profileId}::uuid AND required AND completed_at IS NULL`.execute(db);
      const nextStatus = remaining.rows[0]!.count === 0 && profile.user_id ? "active" : "onboarding";
      const losesCoverageEligibility = profile.status === "active" && nextStatus !== "active";
      const correlationId = losesCoverageEligibility ? randomUUID() : null;
      let coverageInput: CoverageReconciliationInput | null = null;
      let coveragePreparation: { model_event_ids: string[] } | null = null;
      if (losesCoverageEligibility) {
        // Profile eligibility and timetable substitution truth share the same
        // school schedule lock. Bootstrap retained accepted evidence while the
        // actor endpoint is still eligible, then let the prospective reconciler
        // close only future accepted cover after the authoritative status write.
        const range = (await sql<{ today: string; last_date: string }>`SELECT
            (now() AT TIME ZONE school.timezone)::date::text AS today,
            GREATEST(
              (now() AT TIME ZONE school.timezone)::date,
              COALESCE((SELECT max(substitution.duty_date)
                FROM staff_timetable_substitutions substitution
                WHERE substitution.school_id=school.id
                  AND substitution.replacement_staff_profile_id=${profileId}::uuid
                  AND substitution.state='effective'
                  AND substitution.duty_date>=(now() AT TIME ZONE school.timezone)::date),
                (now() AT TIME ZONE school.timezone)::date)
            )::text AS last_date
          FROM schools school WHERE school.id=${schoolId}::uuid`.execute(db)).rows[0]!;
        coverageInput = {
          school_id: schoolId,
          from: range.today,
          to: range.last_date,
          actor_user_id: user.id,
          correlation_id: correlationId!,
          cause: {
            kind: "staff_profile_eligibility_changed",
            source_domain: "staff_operations",
            source_record_id: profileId,
            source_revision: profile.revision + 1,
          },
        };
        coveragePreparation = await this.coverage.prepareEffectiveCoverageProjection(
          db,
          coverageInput,
        );
      }
      const updated = await db.updateTable("staff_profiles").set({ status: nextStatus, updated_by: user.id, updated_at: new Date() }).where("id", "=", profileId).returningAll().executeTakeFirstOrThrow();
      if (coverageInput && updated.revision !== coverageInput.cause.source_revision) {
        throw new ConflictException("The staff eligibility revision changed while coverage was being prepared.");
      }
      const coverageReceipt = coverageInput
        ? await this.coverage.reconcileEffectiveCoverage(db, coverageInput)
        : null;
      await this.audit(db, user, schoolId, "staff.onboarding.updated", profileId, {
        item_key: item.item_key,
        completed: data.completed,
        revision: updated.revision,
        previous_status: profile.status,
        status: updated.status,
        correlation_id: correlationId,
        coverage_preparation: coveragePreparation,
        coverage_reconciliation: coverageReceipt,
      });
      const audience = await this.activeMemberAudience(db, schoolId, ["admin"]);
      await this.enqueueStaffProjectionUpdate(db, {
        mutation: "onboarding_updated",
        schoolId,
        aggregateId: profileId,
        revision: updated.revision,
        audienceUserIds: [...audience, ...(profile.user_id ? [profile.user_id] : [])],
        metadata: { status: updated.status },
      });
      return { ...updated, coverage_reconciliation: coverageReceipt };
    });
  }

  async createResponsibility(user: AuthUser, schoolId: string, body: unknown) {
    const data = assignmentInput.parse(body);
    if (data.ends_on && data.ends_on < data.starts_on) throw new BadRequestException("End date cannot be before the start date.");
    if (Boolean(data.starts_at) !== Boolean(data.ends_at) || (data.starts_at && data.ends_at && data.ends_at <= data.starts_at)) throw new BadRequestException("Add a valid start and end time together.");
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const type = await db.selectFrom("staff_responsibility_types").selectAll().where("id", "=", data.responsibility_type_id).where("school_id", "=", schoolId).where("is_active", "=", true).executeTakeFirst();
      if (!type) throw new NotFoundException("This work type is not available.");
      if(["assessment","trip","restricted_care"].includes(type.context_kind))throw new BadRequestException("Assign this person in the assessment, journey or restricted-care planning screen. A free-text duty cannot grant that access.");
      const profile = await db.selectFrom("staff_profiles").selectAll().where("id", "=", data.staff_profile_id).where("school_id", "=", schoolId).where("status", "=", "active").executeTakeFirst();
      if (!profile) throw new BadRequestException("Choose an active staff member.");
      if (!profile.user_id) throw new BadRequestException("Complete account onboarding before assigning work.");
      if (data.backup_staff_profile_id) {
        const backup = await db.selectFrom("staff_profiles").select(["id", "user_id"]).where("id", "=", data.backup_staff_profile_id).where("school_id", "=", schoolId).where("status", "=", "active").executeTakeFirst();
        if (!backup?.user_id) throw new BadRequestException("Choose an active backup staff member.");
      }
      if (type.scope_kind === "class_section" && (!data.class_section_id || data.event_id)) throw new BadRequestException("Choose only a class scope for this work.");
      if (type.scope_kind === "event" && (!data.event_id || data.class_section_id || data.subject_id)) throw new BadRequestException("Choose only an event scope for this work.");
      if (["school", "scheduled_duty"].includes(type.scope_kind) && (data.class_section_id || data.event_id)) throw new BadRequestException("This work does not use a class or event scope.");
      if (type.scope_kind === "scheduled_duty" && (!data.ends_on || !data.starts_at || !data.ends_at)) throw new BadRequestException("Dated duties need an end date and time window.");
      if (data.class_section_id && !(await db.selectFrom("class_sections").select("id").where("id", "=", data.class_section_id).where("school_id", "=", schoolId).executeTakeFirst())) throw new BadRequestException("Choose a class in this school.");
      if (data.subject_id && !(await db.selectFrom("subjects").select("id").where("id", "=", data.subject_id).where("school_id", "=", schoolId).executeTakeFirst())) throw new BadRequestException("Choose a subject in this school.");
      if (data.event_id && !(await db.selectFrom("campus_events").select("id").where("id", "=", data.event_id).where("school_id", "=", schoolId).executeTakeFirst())) throw new BadRequestException("Choose an event in this school.");
      const duplicate = await sql`SELECT 1 FROM staff_responsibility_assignments WHERE school_id=${schoolId}::uuid
        AND responsibility_type_id=${type.id}::uuid AND staff_profile_id=${profile.id}::uuid AND status IN ('offered','active')
        AND class_section_id IS NOT DISTINCT FROM ${data.class_section_id}::uuid AND subject_id IS NOT DISTINCT FROM ${data.subject_id}::uuid
        AND event_id IS NOT DISTINCT FROM ${data.event_id}::uuid
        AND daterange(starts_on,COALESCE(ends_on,'infinity'::date),'[]') && daterange(${data.starts_on}::date,COALESCE(${data.ends_on}::date,'infinity'::date),'[]') LIMIT 1`.execute(db);
      if (duplicate.rows.length) throw new ConflictException("This work is already assigned for the selected dates.");
      const status = type.requires_acceptance ? "offered" : "active";
      const assignment = await db.insertInto("staff_responsibility_assignments").values({
        school_id: schoolId, responsibility_type_id: type.id, staff_profile_id: profile.id,
        class_section_id: data.class_section_id, subject_id: data.subject_id, event_id: data.event_id,
        scope_label: data.scope_label, location: data.location, starts_on: data.starts_on, ends_on: data.ends_on,
        starts_at: data.starts_at, ends_at: data.ends_at, status, notes: data.notes, assigned_by: user.id,
        backup_staff_profile_id: data.backup_staff_profile_id, responded_at: status === "active" ? new Date() : null,
        revoked_by: null, revoked_at: null,
      }).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_responsibility_audits").values({ school_id: schoolId, assignment_id: assignment.id, actor_id: user.id, action: status === "active" ? "activated" : "offered", from_status: null, to_status: status }).execute();
      const admins = await sql<{ user_id: string }>`SELECT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND role='admin' AND is_active`.execute(db);
      const audience = [...admins.rows.map((row) => row.user_id), ...(profile.user_id ? [profile.user_id] : [])];
      await this.enqueue(db, schoolId, assignment.id, `staff.responsibility.${status}`, audience, status === "offered" && profile.user_id ? [profile.user_id] : [], status === "offered" ? {
        kind: "general",
        title: "New work assignment",
        body: `${type.name} needs your response.`,
        staff_link: `/teacher/responsibilities?assignment=${assignment.id}&assignment_revision=${assignment.revision}`,
        attention_eligible: true,
        attention_portal: "teacher",
        attention_module: "responsibilities",
        attention_source_kind: "responsibility_offer",
        attention_source_id: assignment.id,
        attention_source_revision: assignment.revision,
        attention_topic_key: `staff-responsibility:${assignment.id}`,
        attention_subject_label: type.name,
      } : null, { school_id: schoolId, status, revision: assignment.revision, responsibility_type: type.code }, "staff_responsibility");
      await this.audit(db, user, schoolId, `staff.responsibility.${status}`, assignment.id, { responsibility_type: type.code, staff_profile_id: profile.id });
      return assignment;
    });
  }

  async respondResponsibility(user: AuthUser, schoolId: string, assignmentId: string, body: unknown) {
    uuid.parse(assignmentId);
    const data = z.object({ decision: z.enum(["accepted", "declined"]), note: z.string().trim().max(500).default(""), expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.membership(user, schoolId, ["staff"], db);
      const result = await sql<any>`SELECT assignment.*,type.name AS type_name,type.code AS type_code,profile.user_id
        FROM staff_responsibility_assignments assignment JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id
        JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id
        WHERE assignment.id=${assignmentId}::uuid AND assignment.school_id=${schoolId}::uuid
          AND profile.user_id=${user.id}::uuid AND profile.status='active' FOR UPDATE`.execute(db);
      const assignment = result.rows[0];
      if (!assignment) throw new NotFoundException();
      if (assignment.status !== "offered" || assignment.revision !== data.expected_revision) throw new ConflictException("This offer changed. Refresh before responding.");
      if (data.decision === "declined" && data.note.length < 4) throw new BadRequestException("Add a short reason when declining.");
      const status = data.decision === "accepted" ? "active" : "declined";
      const updated = await db.updateTable("staff_responsibility_assignments").set({ status, responded_at: new Date(), response_note: data.note, updated_at: new Date() }).where("id", "=", assignmentId).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_responsibility_audits").values({ school_id: schoolId, assignment_id: assignmentId, actor_id: user.id, action: data.decision, from_status: "offered", to_status: status, note: data.note }).execute();
      const admins = await sql<{ user_id: string }>`SELECT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND role='admin' AND is_active`.execute(db);
      await this.enqueue(db, schoolId, assignmentId, `staff.responsibility.${data.decision}`, [user.id, ...admins.rows.map((row) => row.user_id)], admins.rows.map((row) => row.user_id), {
        kind: "general",
        title: `Work assignment ${data.decision}`,
        body: `${assignment.type_name} was ${data.decision}.`,
        admin_link: `/principal/staff/${assignment.staff_profile_id}?assignment=${assignmentId}&assignment_revision=${updated.revision}`,
        attention_eligible: true,
        attention_portal: "principal",
        attention_module: "staff",
        attention_source_kind: "responsibility_response",
        attention_source_id: assignmentId,
        attention_source_revision: updated.revision,
        attention_topic_key: `staff-responsibility:${assignmentId}`,
        attention_subject_label: assignment.type_name,
      }, { school_id: schoolId, status, revision: updated.revision }, "staff_responsibility");
      await this.audit(db, user, schoolId, `staff.responsibility.${data.decision}`, assignmentId, { note: data.note });
      return updated;
    });
  }

  async revokeResponsibility(user: AuthUser, schoolId: string, assignmentId: string, body: unknown) {
    uuid.parse(assignmentId);
    const data = z.object({ reason: z.string().trim().min(4).max(500), expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const assignment = await db.selectFrom("staff_responsibility_assignments").selectAll().where("id", "=", assignmentId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!assignment) throw new NotFoundException();
      if (!["offered", "active"].includes(assignment.status) || assignment.revision !== data.expected_revision) throw new ConflictException("This work assignment changed. Refresh before ending it.");
      const updated = await db.updateTable("staff_responsibility_assignments").set({ status: "revoked", revoked_by: user.id, revoked_at: new Date(), revocation_reason: data.reason, updated_at: new Date() }).where("id", "=", assignmentId).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_responsibility_audits").values({ school_id: schoolId, assignment_id: assignmentId, actor_id: user.id, action: "revoked", from_status: assignment.status, to_status: "revoked", note: data.reason }).execute();
      await this.audit(db, user, schoolId, "staff.responsibility.revoked", assignmentId, { reason: data.reason });
      const holder=await db.selectFrom("staff_profiles").select(["user_id","first_name","last_name"]).where("id","=",assignment.staff_profile_id).executeTakeFirst();
      await this.enqueue(db,schoolId,assignmentId,"staff.access.updated",[user.id,...(holder?.user_id?[holder.user_id]:[])],holder?.user_id?[holder.user_id]:[],holder?.user_id?{
        kind:"general",
        title:"Work assignment ended",
        body:data.reason,
        staff_link:`/teacher/responsibilities?assignment=${assignmentId}&assignment_revision=${updated.revision}`,
        attention_eligible:true,
        attention_portal:"teacher",
        attention_module:"responsibilities",
        attention_source_kind:"responsibility_revocation",
        attention_source_id:assignmentId,
        attention_source_revision:updated.revision,
        attention_topic_key:`staff-responsibility:${assignmentId}`,
        attention_subject_label:`${holder.first_name} ${holder.last_name}`.trim(),
      }:null,{school_id:schoolId,revision:updated.revision,status:updated.status},"staff_responsibility");
      return updated;
    });
  }

  async savePolicy(user: AuthUser, schoolId: string, body: unknown, policyId?: string) {
    if (policyId) uuid.parse(policyId);
    await this.principal(user, schoolId);
    const data = policyInput.parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      if (!policyId) {
        const created = await db.insertInto("staff_leave_policies").values({
          school_id: schoolId, academic_year: data.academic_year, code: data.code, name: data.name,
          annual_allowance: data.annual_allowance.toFixed(2), carry_forward_limit: data.carry_forward_limit.toFixed(2),
          requires_document_after_days: data.requires_document_after_days?.toFixed(2) ?? null,
          is_paid: data.is_paid, is_statutory: data.is_statutory, is_active: data.is_active, updated_by: user.id,
        }).returningAll().executeTakeFirstOrThrow();
        await this.audit(db, user, schoolId, "staff.leave_policy.created", created.id);
        const audience = await this.activeMemberAudience(db, schoolId, ["admin", "staff"]);
        await this.enqueueStaffProjectionUpdate(db, {
          mutation: "leave_policy_created",
          schoolId,
          aggregateId: created.id,
          revision: created.revision,
          audienceUserIds: audience,
          metadata: { academic_year: created.academic_year, active: created.is_active },
        });
        return created;
      }
      if (!data.expected_revision) throw new BadRequestException("Refresh this policy before editing it.");
      const updated = await db.updateTable("staff_leave_policies").set({
        name: data.name, annual_allowance: data.annual_allowance.toFixed(2), carry_forward_limit: data.carry_forward_limit.toFixed(2),
        requires_document_after_days: data.requires_document_after_days?.toFixed(2) ?? null,
        is_paid: data.is_paid, is_statutory: data.is_statutory, is_active: data.is_active, updated_by: user.id, updated_at: new Date(),
      }).where("id", "=", policyId).where("school_id", "=", schoolId).where("revision", "=", data.expected_revision).returningAll().executeTakeFirst();
      if (!updated) throw new ConflictException("This policy changed. Refresh and review the latest values.");
      await this.audit(db, user, schoolId, "staff.leave_policy.updated", updated.id, { revision: updated.revision });
      const audience = await this.activeMemberAudience(db, schoolId, ["admin", "staff"]);
      await this.enqueueStaffProjectionUpdate(db, {
        mutation: "leave_policy_updated",
        schoolId,
        aggregateId: updated.id,
        revision: updated.revision,
        audienceUserIds: audience,
        metadata: { academic_year: updated.academic_year, active: updated.is_active },
      });
      return updated;
    });
  }

  async adjustBalance(user: AuthUser, schoolId: string, body: unknown) {
    await this.principal(user, schoolId);
    const data = z.object({ staff_profile_id: uuid, policy_id: uuid, days: z.coerce.number().min(-366).max(366).refine((value) => value !== 0), reason: z.string().trim().min(8).max(500) }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const profile = await db.selectFrom("staff_profiles").select(["id", "user_id"])
        .where("id", "=", data.staff_profile_id).where("school_id", "=", schoolId).executeTakeFirst();
      const policy = await db.selectFrom("staff_leave_policies").select("id")
        .where("id", "=", data.policy_id).where("school_id", "=", schoolId).executeTakeFirst();
      if (!profile || !policy) throw new BadRequestException("Choose a staff member and leave policy from this school.");
      const adjustment = await db.insertInto("staff_leave_balance_adjustments").values({ school_id: schoolId, staff_profile_id: data.staff_profile_id, policy_id: data.policy_id, days: data.days.toFixed(2), reason: data.reason, recorded_by: user.id }).returningAll().executeTakeFirstOrThrow();
      await this.audit(db, user, schoolId, "staff.leave_balance.adjusted", adjustment.id, { staff_profile_id: data.staff_profile_id, policy_id: data.policy_id, days: data.days, reason: data.reason });
      const audience = await this.activeMemberAudience(db, schoolId, ["admin"]);
      await this.enqueueStaffProjectionUpdate(db, {
        mutation: "leave_balance_adjusted",
        schoolId,
        aggregateId: adjustment.id,
        revision: 1,
        audienceUserIds: [...audience, ...(profile.user_id ? [profile.user_id] : [])],
        metadata: { staff_profile_id: profile.id, policy_id: policy.id },
      });
      return adjustment;
    });
  }

  async requestLeave(user: AuthUser, schoolId: string, body: unknown) {
    const data = requestLeaveInput.parse(body);
    const { command_id: commandId, ...commandInput } = data;
    const requestHash = staffLeaveCommandHash("submit", null, commandInput);
    return this.db.transaction().execute(async (db) => {
      await this.membership(user, schoolId, ["staff"], db);
      const prior = await this.priorLeaveCommand<Record<string, unknown>>(db, schoolId, user.id, commandId, "submit", requestHash);
      if (prior) return prior.result;
      if (data.ends_on < data.starts_on) throw new BadRequestException("Leave end date cannot be before the start date.");
      if (data.portion !== "full_day" && data.starts_on !== data.ends_on) throw new BadRequestException("Half-day leave must use one date.");
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${schoolId}:${user.id}`},0))`.execute(db);
      const profile = await db.selectFrom("staff_profiles").selectAll().where("school_id", "=", schoolId).where("user_id", "=", user.id).where("status", "!=", "inactive").executeTakeFirst();
      if (!profile) throw new NotFoundException("Your active staff profile is not ready.");
      const policy = await db.selectFrom("staff_leave_policies").selectAll().where("id", "=", data.policy_id).where("school_id", "=", schoolId).where("is_active", "=", true).executeTakeFirst();
      if (!policy) throw new NotFoundException("This leave policy is not available.");
      const term = await sql`SELECT 1 FROM academic_terms WHERE school_id=${schoolId}::uuid AND academic_year=${policy.academic_year}
        AND ${data.starts_on}::date BETWEEN starts_on AND ends_on AND ${data.ends_on}::date BETWEEN starts_on AND ends_on LIMIT 1`.execute(db);
      if (!term.rows.length) throw new BadRequestException("Choose dates within the policy academic year.");
      const overlap = await sql`SELECT 1 FROM staff_leave_requests WHERE staff_profile_id=${profile.id}::uuid AND status IN ('submitted','approved')
        AND daterange(starts_on,ends_on,'[]') && daterange(${data.starts_on}::date,${data.ends_on}::date,'[]') LIMIT 1`.execute(db);
      if (overlap.rows.length) throw new ConflictException("A pending or approved leave request already covers these dates.");
      const counted = await sql<{ days: string }>`SELECT CASE WHEN ${data.portion} <> 'full_day' THEN 0.5::numeric ELSE count(*)::numeric END AS days
        FROM generate_series(${data.starts_on}::date,${data.ends_on}::date,interval '1 day') day
        WHERE extract(isodow FROM day) <> 7 AND NOT EXISTS (
          SELECT 1 FROM school_calendar_days calendar WHERE calendar.school_id=${schoolId}::uuid AND calendar.date=day::date AND NOT calendar.is_instructional
        )`.execute(db);
      const requestedDays = Number(counted.rows[0]?.days ?? 0);
      if (requestedDays <= 0) throw new BadRequestException("The selected dates contain no working days.");
      if (requestedDays > 62) throw new BadRequestException("One request cannot exceed 62 working days. Contact the school office for extended leave.");
      const totals = await sql<{ used: string; pending: string; adjustments: string }>`SELECT
        COALESCE((SELECT sum(requested_days) FROM staff_leave_requests WHERE staff_profile_id=${profile.id}::uuid AND policy_id=${policy.id}::uuid AND status='approved'),0) AS used,
        COALESCE((SELECT sum(requested_days) FROM staff_leave_requests WHERE staff_profile_id=${profile.id}::uuid AND policy_id=${policy.id}::uuid AND status='submitted'),0) AS pending,
        COALESCE((SELECT sum(days) FROM staff_leave_balance_adjustments WHERE staff_profile_id=${profile.id}::uuid AND policy_id=${policy.id}::uuid),0) AS adjustments`.execute(db);
      const available = Number(policy.annual_allowance) + Number(totals.rows[0]!.adjustments) - Number(totals.rows[0]!.used) - Number(totals.rows[0]!.pending);
      if (requestedDays > available) throw new BadRequestException(`Only ${available.toFixed(1)} days are available under ${policy.name}.`);
      const occurredAt = new Date();
      const decisionOwner = await this.staffLeaveModel.resolveDecisionOwner(
        db,
        schoolId,
        occurredAt,
      );
      const request = await db.insertInto("staff_leave_requests").values({ school_id: schoolId, staff_profile_id: profile.id, policy_id: policy.id, starts_on: data.starts_on, ends_on: data.ends_on, portion: data.portion, requested_days: requestedDays.toFixed(2), reason: data.reason, handover_note: data.handover_note }).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_leave_request_audits").values({ school_id: schoolId, request_id: request.id, actor_id: user.id, action: "submitted", from_status: null, to_status: "submitted" }).execute();
      const outboxEventId = await this.enqueue(db, schoolId, request.id, "staff.leave.submitted", [user.id, decisionOwner.user_id], [decisionOwner.user_id], {
        kind: "leave",
        title: "Staff leave needs review",
        body: `${profile.first_name} ${profile.last_name} requested ${requestedDays} day${requestedDays === 1 ? "" : "s"}.`,
        link: `/work/staff-leave?school=${schoolId}&request=${request.id}&request_revision=${request.revision}`,
        attention_eligible: true,
        attention_portal: "principal",
        attention_module: "staff",
        attention_source_kind: "staff_leave_review",
        attention_source_id: request.id,
        attention_source_revision: request.revision,
        attention_topic_key: `staff-leave-review:${request.id}`,
        attention_subject_label: `${profile.first_name} ${profile.last_name}`.trim(),
      }, { school_id: schoolId, status: request.status, revision: request.revision });
      const coordination = await this.staffLeaveModel.publishSubmitted(db, {
        school_id: schoolId,
        actor_user_id: user.id,
        request: { ...request, staff_profile_revision: profile.revision },
        source_outbox_event_id: outboxEventId,
        command_id: commandId,
        occurred_at: occurredAt.toISOString(),
        decision_owner: decisionOwner,
      });
      await this.audit(db, user, schoolId, "staff.leave.submitted", request.id, {
        requested_days: requestedDays,
        policy_id: policy.id,
        command_id: commandId,
        source_outbox_event_id: outboxEventId,
        correlation_id: commandId,
        coordination_event_id: coordination.event_id,
        behaviour_version_id: coordination.behaviour_version_id,
        subscription_id: coordination.subscription_id,
        decision_rule_id: decisionOwner.rule.id,
        decision_appointment_id: decisionOwner.appointment.id,
      });
      await this.saveLeaveCommand(db, schoolId, user.id, commandId, "submit", request.id, requestHash, request, outboxEventId, {
        correlation_id: commandId,
        causation_event_id: null,
        authority_receipt: decisionOwner as unknown as Record<string, unknown>,
        coordination_receipt: coordination as unknown as Record<string, unknown>,
      });
      return request;
    });
  }

  async decideLeave(user: AuthUser, schoolId: string, requestId: string, body: unknown) {
    uuid.parse(requestId);
    const data = decideLeaveInput.parse(body);
    const { command_id: commandId, ...commandInput } = data;
    const requestHash = staffLeaveCommandHash("decide", requestId, commandInput);
    return this.db.transaction().execute(async (db) => {
      await this.membership(user, schoolId, ["admin", "staff"], db);
      const prior = await this.priorLeaveCommand<Record<string, unknown>>(db, schoolId, user.id, commandId, "decide", requestHash);
      if (prior) return prior.result;
      const occurredAt = new Date();
      const decisionAuthority = await this.staffLeaveModel.assertDecisionAuthority(
        db,
        schoolId,
        user.id,
        occurredAt,
      );
      const request = await db.selectFrom("staff_leave_requests").selectAll().where("id", "=", requestId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!request) throw new NotFoundException();
      if (request.status !== "submitted") throw new ConflictException("This leave request has already been decided.");
      if (request.revision !== data.expected_revision) throw new ConflictException("This request changed. Refresh before deciding.");
      if (data.decision === "rejected" && data.note.length < 4) throw new BadRequestException("Add a short reason when declining leave.");
      const submissionTrace = await this.leaveSubmissionTrace(db, schoolId, request.id);
      if (submissionTrace.original_owner_user_id !== decisionAuthority.user_id) {
        throw new ConflictException(
          "The staff-leave decision owner changed after submission. Rerouting is not available yet; an administrator must restore or correct the route before this request can be decided.",
        );
      }
      const preparedCommand = await this.commandGateway.prepareDomainCommand(db, {
        school_id: schoolId,
        actor_user_id: user.id,
        command_type: "staff.leave.decide",
        handler_key: "staff_operations.leave_decide",
        handler_version: 1,
        source_domain: "staff_operations",
        target: {
          kind: "staff_leave_request",
          domain: "staff_operations",
          domain_id: request.id,
          label: "Staff leave request",
          lifecycle_state: "active",
          source_revision: request.revision,
          metadata: {},
        },
        current_revision: request.revision,
        expected_revision: data.expected_revision,
        capability: "staff_leave:decide",
        purpose: "decide_staff_leave",
        requested_at: occurredAt.toISOString(),
        correlation_id: submissionTrace.correlation_id,
        causation_id: submissionTrace.causation_event_id,
        idempotency_key: `staff-leave-decide:${commandId}`,
        operating_rule_version_ref: `governance-decision:${decisionAuthority.rule.id}:${decisionAuthority.rule.revision}`,
        configuration_refs: [
          { kind: "governance_rule", ref: decisionAuthority.rule.id, version: String(decisionAuthority.rule.revision) },
          { kind: "appointment", ref: decisionAuthority.appointment.id, version: String(decisionAuthority.appointment.revision) },
        ],
        authority_attestation: {
          evaluator_domain: "governance",
          decision: "allowed",
          reason_codes: ["current_governance_officeholder"],
          authority_source_refs: decisionAuthority.sources.map((source) => ({
            source_id: source.id,
            revision: source.revision,
            verification_state: source.verification_state,
          })),
          operating_rule_refs: [{
            rule_id: decisionAuthority.rule.id,
            revision: decisionAuthority.rule.revision,
            appointment_id: decisionAuthority.appointment.id,
            appointment_revision: decisionAuthority.appointment.revision,
          }],
          valid_until: null,
        },
        safe_context: { decision: data.decision, request_id: request.id },
      });
      if (preparedCommand.status !== "ready") {
        throw new ConflictException("This leave decision was already completed through the campus command gateway.");
      }
      const profile = await db.selectFrom("staff_profiles").selectAll().where("id", "=", request.staff_profile_id).executeTakeFirstOrThrow();
      if (data.decision === "approved") {
        const policy = await db.selectFrom("staff_leave_policies").selectAll().where("id", "=", request.policy_id).executeTakeFirstOrThrow();
        const totals = await sql<{ used: string; adjustments: string }>`SELECT
          COALESCE((SELECT sum(requested_days) FROM staff_leave_requests WHERE staff_profile_id=${profile.id}::uuid AND policy_id=${policy.id}::uuid AND status='approved'),0) AS used,
          COALESCE((SELECT sum(days) FROM staff_leave_balance_adjustments WHERE staff_profile_id=${profile.id}::uuid AND policy_id=${policy.id}::uuid),0) AS adjustments`.execute(db);
        const available = Number(policy.annual_allowance) + Number(totals.rows[0]!.adjustments) - Number(totals.rows[0]!.used);
        if (Number(request.requested_days) > available) throw new ConflictException("The leave balance changed and is no longer sufficient.");
      }
      const updated = await db.updateTable("staff_leave_requests").set({ status: data.decision, revision: request.revision + 1, decided_by: user.id, decided_at: new Date(), decision_note: data.note, updated_at: new Date() }).where("id", "=", request.id).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_leave_request_audits").values({ school_id: schoolId, request_id: request.id, actor_id: user.id, action: data.decision, from_status: request.status, to_status: data.decision, note: data.note }).execute();
      if (data.decision === "approved") await this.createCoverageTasks(db, user.id, schoolId, request, profile);
      const coverage = data.decision === "approved"
        ? await sql<{ affected: number }>`SELECT count(*)::int AS affected FROM staff_coverage_tasks WHERE leave_request_id=${request.id}::uuid`.execute(db)
        : await sql<{ affected: number }>`SELECT count(*)::int AS affected FROM generate_series(${request.starts_on}::date,${request.ends_on}::date,interval '1 day') day
          CROSS JOIN LATERAL planned_school_schedule_v2(${schoolId}::uuid,day::date) schedule
          WHERE schedule.teacher_user_id=${profile.user_id}::uuid AND schedule.slot_type='class'`.execute(db);
      const coverageCount = coverage.rows[0]?.affected ?? 0;
      const audience = [decisionAuthority.user_id, ...(profile.user_id ? [profile.user_id] : [])];
      const outboxEventId = await this.enqueue(db, schoolId, request.id, `staff.leave.${data.decision}`, audience, profile.user_id ? [profile.user_id] : [], {
        kind: "leave",
        title: `Leave ${data.decision}`,
        body: data.decision === "approved" ? `${request.requested_days} day(s) approved. ${coverageCount} timetable period(s) need coverage.` : data.note,
        staff_link: `/teacher/leave?request=${request.id}`,
        attention_eligible: true,
        attention_school_id: schoolId,
        attention_portal: "teacher",
        attention_module: "leave",
        attention_source_kind: "staff_leave_decision",
        attention_source_id: request.id,
        attention_source_revision: updated.revision,
        attention_topic_key: `staff-leave:${request.id}`,
      }, {
        school_id: schoolId,
        status: updated.status,
        revision: updated.revision,
        affected_periods: coverageCount,
        refresh: ["principal.staff", "teacher.leave", "principal.timetable", "notifications", "attention"],
      });
      const coordination = await this.staffLeaveModel.recordDecisionResponse(db, {
        school_id: schoolId,
        actor_user_id: user.id,
        decision: data.decision,
        message_id: submissionTrace.message_id,
        request_id: request.id,
        source_revision: request.revision,
        resulting_revision: updated.revision,
        affected_periods: coverageCount,
        source_outbox_event_id: outboxEventId,
        correlation_id: submissionTrace.correlation_id,
        command_id: commandId,
        occurred_at: occurredAt.toISOString(),
        decision_authority: decisionAuthority,
      });
      const gatewayOutcome = await this.commandGateway.completeDomainCommand(db, {
        school_id: schoolId,
        command_id: preparedCommand.command_id,
        terminal_state: "accepted",
        code: `staff_leave_${data.decision}`,
        explanation: data.decision === "approved"
          ? "The Staff domain approved the current leave-request revision."
          : "The Staff domain rejected the current leave-request revision.",
        resulting_revision: updated.revision,
        domain_event_id: outboxEventId,
        metadata: {
          affected_periods: coverageCount,
          message_outcome_id: coordination.outcome_id,
        },
        completed_at: new Date().toISOString(),
      });
      const result = { ...updated, affected_periods: coverageCount };
      await this.audit(db, user, schoolId, `staff.leave.${data.decision}`, request.id, {
        requested_days: request.requested_days,
        affected_periods: coverageCount,
        note: data.note,
        command_id: commandId,
        source_outbox_event_id: outboxEventId,
        correlation_id: submissionTrace.correlation_id,
        causation_event_id: submissionTrace.causation_event_id,
        message_id: coordination.message_id,
        message_outcome_id: coordination.outcome_id,
        decision_rule_id: decisionAuthority.rule.id,
        decision_appointment_id: decisionAuthority.appointment.id,
        model_command_id: preparedCommand.command_id,
        model_command_outcome_id: gatewayOutcome.outcome_id,
        authority_receipt_id: preparedCommand.authority_receipt_id,
      });
      await this.saveLeaveCommand(db, schoolId, user.id, commandId, "decide", request.id, requestHash, result, outboxEventId, {
        correlation_id: submissionTrace.correlation_id,
        causation_event_id: submissionTrace.causation_event_id,
        authority_receipt: decisionAuthority as unknown as Record<string, unknown>,
        coordination_receipt: coordination as unknown as Record<string, unknown>,
      });
      return result;
    });
  }

  async assignCoverage(user: AuthUser, schoolId: string, taskId: string, body: unknown) {
    uuid.parse(taskId);
    const data = z.object({ replacement_staff_profile_id: uuid, note: z.string().trim().max(500).default(""), expected_revision: z.number().int().positive() }).parse(body);
    return this.db.transaction().execute(async (db) => {
      await this.principal(user, schoolId, db);
      const task = await db.selectFrom("staff_coverage_tasks").selectAll().where("id", "=", taskId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!task) throw new NotFoundException();
      if (!["open", "declined", "offered"].includes(task.status) || task.revision !== data.expected_revision) throw new ConflictException("This cover task changed. Refresh before assigning it.");
      const replacement = await db.selectFrom("staff_profiles").selectAll().where("id", "=", data.replacement_staff_profile_id).where("school_id", "=", schoolId).where("status", "=", "active").executeTakeFirst();
      if (!replacement?.user_id) throw new BadRequestException("Choose an active staff member with account access.");
      if (replacement.id === task.absent_staff_profile_id) throw new BadRequestException("The absent staff member cannot cover their own duty.");
      const leaveConflict = await sql`SELECT 1 FROM staff_leave_requests WHERE staff_profile_id=${replacement.id}::uuid AND status='approved'
        AND ${task.duty_date}::date BETWEEN starts_on AND ends_on LIMIT 1`.execute(db);
      if (leaveConflict.rows.length) throw new ConflictException("This staff member has approved leave on that date.");
      if (task.starts_at && task.ends_at) {
        const scheduleConflict = await sql`SELECT 1 FROM effective_school_schedule(${schoolId}::uuid,${task.duty_date}::date) schedule
          WHERE schedule.teacher_user_id=${replacement.user_id}::uuid AND schedule.starts_at < ${task.ends_at}::time AND schedule.ends_at > ${task.starts_at}::time AND NOT schedule.cancelled LIMIT 1`.execute(db);
        const coverConflict = await sql`SELECT 1 FROM staff_coverage_tasks WHERE replacement_staff_profile_id=${replacement.id}::uuid AND duty_date=${task.duty_date}::date
          AND status IN ('offered','accepted') AND id<>${task.id}::uuid AND starts_at < ${task.ends_at}::time AND ends_at > ${task.starts_at}::time LIMIT 1`.execute(db);
        if (scheduleConflict.rows.length || coverConflict.rows.length) throw new ConflictException("This staff member already has a class or cover duty at that time.");
      }
      const action = task.replacement_staff_profile_id ? "reassigned" : "offered";
      const updated = await db.updateTable("staff_coverage_tasks").set({ replacement_staff_profile_id: replacement.id, status: "offered", assigned_by: user.id, offered_at: new Date(), responded_at: null, response_note: data.note, updated_at: new Date() }).where("id", "=", task.id).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_coverage_task_audits").values({ school_id: schoolId, task_id: task.id, actor_id: user.id, action, from_status: task.status, to_status: "offered", note: data.note }).execute();
      await this.enqueue(db, schoolId, task.id, "staff.coverage.offered", [user.id, replacement.user_id], [replacement.user_id], {
        kind: "general",
        title: "Cover duty offered",
        body: `${task.title} on ${task.duty_date} needs your response.`,
        staff_link: `/teacher/responsibilities?coverage=${task.id}&coverage_revision=${updated.revision}`,
        attention_eligible: true,
        attention_portal: "teacher",
        attention_module: "responsibilities",
        attention_source_kind: "coverage_offer",
        attention_source_id: task.id,
        attention_source_revision: updated.revision,
        attention_topic_key: `staff-coverage:${task.id}`,
        attention_subject_label: task.title,
      }, { school_id: schoolId, status: "offered", revision: updated.revision, duty_date: task.duty_date }, "staff_coverage_task");
      await this.audit(db, user, schoolId, `staff.coverage.${action}`, task.id, { replacement_staff_profile_id: replacement.id });
      return updated;
    });
  }

  async respondCoverage(user: AuthUser, schoolId: string, taskId: string, body: unknown) {
    uuid.parse(taskId);
    const data = respondCoverageInput.parse(body);
    const { command_id: commandId, ...commandInput } = data;
    const requestHash = staffCoverageCommandHash("respond", taskId, commandInput);
    return this.db.transaction().execute(async (db) => {
      await this.membership(user, schoolId, ["staff"], db);
      // Serialize acceptance with timetable publication, dated plans, closures,
      // and membership deactivation so exact-source validation cannot race.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${schoolId}`},0))`.execute(db);
      const prior = await this.priorCoverageCommand<Record<string, unknown>>(
        db, schoolId, user.id, commandId, taskId, requestHash,
      );
      if (prior) return prior;
      const result = await sql<any>`SELECT task.*,profile.user_id,profile.first_name,profile.last_name,
          absent.user_id AS absent_user_id
        FROM staff_coverage_tasks task
        JOIN staff_profiles profile ON profile.id=task.replacement_staff_profile_id
        JOIN staff_profiles absent ON absent.id=task.absent_staff_profile_id
        WHERE task.id=${taskId}::uuid AND task.school_id=${schoolId}::uuid
          AND profile.user_id=${user.id}::uuid AND profile.status='active' FOR UPDATE`.execute(db);
      const task = result.rows[0];
      if (!task) throw new NotFoundException();
      if (task.status !== "offered" || task.revision !== data.expected_revision) throw new ConflictException("This cover offer changed. Refresh before responding.");
      if (data.decision === "declined" && data.note.length < 4) throw new BadRequestException("Add a short reason when declining cover.");
      const offerBinding = await this.coverageOffers.currentResponseBinding(db, {
        school_id: schoolId,
        task_id: task.id,
        task_revision: task.revision,
        selected_staff_profile_id: task.replacement_staff_profile_id,
        selected_user_id: task.user_id,
      });

      let substitutionId: string | null = null;
      let scheduleProvenance: Record<string, unknown> = {
        effective_timetable: false,
        reason: "non_schedule_duty",
      };
      let sourceSchedule: EffectiveCoverageSource | null = null;

      if (data.decision === "accepted" && task.source_schedule_id) {
        if (!task.class_section_id || !task.period_number || !task.starts_at || !task.ends_at) {
          throw new ConflictException("This cover offer has incomplete timetable provenance.");
        }
        sourceSchedule = (await sql<EffectiveCoverageSource>`SELECT
            schedule.id,schedule.class_section_id,schedule.subject_id,schedule.period_number,
            schedule.starts_at::text,schedule.ends_at::text,schedule.teacher_user_id,
            schedule.occurrence_key,schedule.source_kind,schedule.source_record_id,
            schedule.source_revision,schedule.source_version,schedule.title,
            schedule.slot_type,schedule.room,school.timezone,
            concat('Class ',section.grade,section.section) AS class_label,
            subject.name AS subject_name,subject.code AS subject_code,
            space.id AS space_id,space.name AS space_name,space.revision AS space_revision
          FROM planned_school_schedule_v2(${schoolId}::uuid,${task.duty_date}::date) schedule
          JOIN schools school ON school.id=${schoolId}::uuid
          JOIN class_sections section ON section.id=schedule.class_section_id
            AND section.school_id=${schoolId}::uuid
          LEFT JOIN subjects subject ON subject.id=schedule.subject_id
          LEFT JOIN schedule_periods recurring_period
            ON schedule.source_kind='published_timetable' AND recurring_period.id=schedule.id
          LEFT JOIN day_plan_periods dated_period
            ON schedule.source_kind='daily_plan' AND dated_period.id=schedule.id
              AND dated_period.version=schedule.source_version
          LEFT JOIN timetable_slots legacy_period
            ON schedule.source_kind='legacy_timetable' AND legacy_period.id=schedule.id
          LEFT JOIN campus_spaces space ON space.school_id=${schoolId}::uuid
            AND space.id=COALESCE(dated_period.space_id,recurring_period.space_id,legacy_period.space_id)
          WHERE schedule.id=${task.source_schedule_id}::uuid
            AND schedule.class_section_id=${task.class_section_id}::uuid
            AND schedule.period_number=${task.period_number}
            AND schedule.starts_at=${task.starts_at}::time
            AND schedule.ends_at=${task.ends_at}::time
            AND NOT schedule.cancelled
          LIMIT 1`.execute(db)).rows[0] ?? null;
        if (!sourceSchedule || sourceSchedule.teacher_user_id !== task.absent_user_id
          || sourceSchedule.subject_id !== task.subject_id) {
          throw new ConflictException("The timetable occurrence changed after this cover was offered. Ask the coordinator to review it again.");
        }

        const leaveConflict = await sql`SELECT 1 FROM staff_leave_requests
          WHERE staff_profile_id=${task.replacement_staff_profile_id}::uuid
            AND status='approved'
            AND ${task.duty_date}::date BETWEEN starts_on AND ends_on
          LIMIT 1`.execute(db);
        const scheduleConflict = await sql`SELECT 1
          FROM effective_school_schedule(${schoolId}::uuid,${task.duty_date}::date) schedule
          WHERE schedule.teacher_user_id=${task.user_id}::uuid
            AND schedule.id<>${task.source_schedule_id}::uuid
            AND schedule.starts_at<${task.ends_at}::time
            AND schedule.ends_at>${task.starts_at}::time
            AND NOT schedule.cancelled
          LIMIT 1`.execute(db);
        const coverConflict = await sql`SELECT 1 FROM staff_coverage_tasks
          WHERE replacement_staff_profile_id=${task.replacement_staff_profile_id}::uuid
            AND duty_date=${task.duty_date}::date
            AND status='accepted'
            AND id<>${task.id}::uuid
            AND starts_at<${task.ends_at}::time
            AND ends_at>${task.starts_at}::time
          LIMIT 1`.execute(db);
        if (leaveConflict.rows.length || scheduleConflict.rows.length || coverConflict.rows.length) {
          throw new ConflictException("This cover can no longer be accepted because the replacement is unavailable at that time.");
        }
        substitutionId = randomUUID();
        scheduleProvenance = {
          effective_timetable: true,
          occurrence_key: sourceSchedule.occurrence_key,
          source_kind: sourceSchedule.source_kind,
          source_record_id: sourceSchedule.source_record_id,
          source_revision: sourceSchedule.source_revision,
          source_version: sourceSchedule.source_version,
          source_schedule_id: sourceSchedule.id,
          original_teacher_user_id: sourceSchedule.teacher_user_id,
          replacement_teacher_user_id: task.user_id,
        };
      }

      const updated = await db.updateTable("staff_coverage_tasks").set({ status: data.decision, responded_at: new Date(), response_note: data.note, updated_at: new Date() }).where("id", "=", task.id).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_coverage_task_audits").values({ school_id: schoolId, task_id: task.id, actor_id: user.id, action: data.decision, from_status: "offered", to_status: data.decision, note: data.note }).execute();

      if (substitutionId && sourceSchedule) {
        await sql`INSERT INTO staff_timetable_substitutions(
            id,school_id,coverage_task_id,class_section_id,subject_id,duty_date,
            period_number,starts_at,ends_at,source_schedule_id,source_occurrence_key,
            source_kind,source_record_id,source_revision,source_version,
            original_teacher_user_id,replacement_staff_profile_id,
            replacement_teacher_user_id,coverage_task_revision,accepted_by,accepted_at
          ) VALUES(
            ${substitutionId}::uuid,${schoolId}::uuid,${task.id}::uuid,
            ${sourceSchedule.class_section_id}::uuid,${sourceSchedule.subject_id}::uuid,
            ${task.duty_date}::date,${sourceSchedule.period_number},
            ${sourceSchedule.starts_at}::time,${sourceSchedule.ends_at}::time,
            ${sourceSchedule.id}::uuid,${sourceSchedule.occurrence_key},
            ${sourceSchedule.source_kind},${sourceSchedule.source_record_id}::uuid,
            ${sourceSchedule.source_revision},${sourceSchedule.source_version},
            ${sourceSchedule.teacher_user_id}::uuid,
            ${task.replacement_staff_profile_id}::uuid,${task.user_id}::uuid,
            ${updated.revision},${user.id}::uuid,${updated.responded_at}
          )`.execute(db);
      }

      const admins = await sql<{ user_id: string }>`SELECT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND role='admin' AND is_active`.execute(db);
      const outboxEventId = await this.enqueue(db, schoolId, task.id, `staff.coverage.${data.decision}`, [user.id, ...admins.rows.map((row) => row.user_id)], admins.rows.map((row) => row.user_id), {
        kind: "general",
        title: `Cover duty ${data.decision}`,
        body: `${task.first_name} ${task.last_name} ${data.decision} ${task.title}.`,
        admin_link: `/principal/staff?section=leave&coverage=${task.id}&coverage_revision=${updated.revision}`,
        attention_eligible: true,
        attention_portal: "principal",
        attention_module: "staff",
        attention_source_kind: "coverage_response",
        attention_source_id: task.id,
        attention_source_revision: updated.revision,
        attention_topic_key: `staff-coverage:${task.id}`,
        attention_subject_label: `${task.first_name} ${task.last_name}`.trim(),
      }, {
        school_id: schoolId,
        status: data.decision,
        revision: updated.revision,
        substitution_id: substitutionId,
        effective_timetable: Boolean(substitutionId),
        ...(substitutionId ? scheduleProvenance : {}),
        refresh: substitutionId ? [
          "staff-operations", "requests", "attention", "teacher.home",
          "teacher.attendance", "principal.home", "principal.timetable",
          "student.home", "student.timetable", "parent.home", "parent.timetable",
          "calendar", "campus-view",
        ] : ["staff-operations", "requests", "attention", "teacher.home", "principal.home"],
      }, "staff_coverage_task");
      if (substitutionId) {
        await sql`UPDATE staff_timetable_substitutions
          SET effective_event_id=${outboxEventId}::uuid
          WHERE id=${substitutionId}::uuid AND school_id=${schoolId}::uuid`.execute(db);
      }
      if (substitutionId && sourceSchedule) {
        const dailyPlan = sourceSchedule.source_kind === "daily_plan";
        const scheduleDomain = dailyPlan ? "day_plan" : "timetable";
        const scheduleDomainId = dailyPlan
          ? `${sourceSchedule.source_record_id}:${sourceSchedule.source_version}`
          : sourceSchedule.source_kind === "published_timetable"
            ? sourceSchedule.source_record_id
            : `legacy:${sourceSchedule.source_record_id}`;
        const periodDomainId = dailyPlan
          ? `${sourceSchedule.id}:${sourceSchedule.source_version}`
          : sourceSchedule.id;
        const projection = await this.temporal.recordAcceptedScheduleSubstitution(db, {
          school_id: schoolId,
          actor_user_id: user.id,
          substitution_id: substitutionId,
          coverage_task_id: task.id,
          coverage_task_revision: updated.revision,
          source_outbox_event_id: outboxEventId,
          occurrence_key: sourceSchedule.occurrence_key,
          source_kind: sourceSchedule.source_kind,
          source_schedule_id: sourceSchedule.id,
          source_record_id: sourceSchedule.source_record_id,
          source_revision: sourceSchedule.source_revision,
          source_version: sourceSchedule.source_version,
          schedule: {
            kind: "schedule",
            domain: scheduleDomain,
            domain_id: scheduleDomainId,
            label: dailyPlan
              ? `${sourceSchedule.class_label} plan for ${task.duty_date}`
              : `${sourceSchedule.class_label} timetable`,
            lifecycle_state: "active",
            source_revision: sourceSchedule.source_revision,
            metadata: { source_kind: sourceSchedule.source_kind },
          },
          period: {
            kind: "schedule_period",
            domain: scheduleDomain,
            domain_id: periodDomainId,
            label: sourceSchedule.title,
            lifecycle_state: "active",
            source_revision: sourceSchedule.source_revision,
            metadata: { period_number: sourceSchedule.period_number },
          },
          class_section: {
            kind: "class",
            domain: "academic_structure",
            domain_id: sourceSchedule.class_section_id,
            label: sourceSchedule.class_label,
            lifecycle_state: "active",
            source_revision: 1,
            metadata: {},
          },
          subject: sourceSchedule.subject_id ? {
            kind: "subject",
            domain: "academic_structure",
            domain_id: sourceSchedule.subject_id,
            label: sourceSchedule.subject_name ?? sourceSchedule.subject_code ?? sourceSchedule.title,
            lifecycle_state: "active",
            source_revision: 1,
            metadata: { code: sourceSchedule.subject_code },
          } : null,
          space: sourceSchedule.space_id ? {
            kind: "space",
            domain: "campus_topology",
            domain_id: sourceSchedule.space_id,
            label: sourceSchedule.space_name ?? sourceSchedule.room,
            lifecycle_state: "active",
            source_revision: sourceSchedule.space_revision ?? 1,
            metadata: {},
          } : null,
          duty_date: String(task.duty_date),
          period_number: sourceSchedule.period_number,
          starts_at: sourceSchedule.starts_at,
          ends_at: sourceSchedule.ends_at,
          title: sourceSchedule.title,
          slot_type: sourceSchedule.slot_type,
          room_snapshot: sourceSchedule.room,
          original_teacher_user_id: sourceSchedule.teacher_user_id!,
          replacement_teacher_user_id: task.user_id,
          accepted_at: new Date(updated.responded_at!).toISOString(),
          correlation_id: commandId,
        });
        if (projection.projection_status !== "applied") {
          throw new ConflictException(
            "The timetable changed while this cover was being accepted. Refresh and ask the coordinator to offer it again.",
          );
        }
        scheduleProvenance = {
          ...scheduleProvenance,
          campus_model_event_id: projection.event_id,
          campus_model_projection_status: projection.projection_status,
          campus_model_replayed: projection.replayed,
        };
      }
      const coordinationOutcome = offerBinding
        ? await this.coverageOffers.recordResponse(db, {
          school_id: schoolId,
          actor_user_id: user.id,
          task_id: task.id,
          decision: data.decision,
          source_task_revision: task.revision,
          resulting_task_revision: updated.revision,
          source_outbox_event_id: outboxEventId,
          command_id: commandId,
          occurred_at: new Date(updated.responded_at!).toISOString(),
          binding: offerBinding,
        })
        : null;
      const response = {
        ...updated,
        effective_substitution: substitutionId ? {
          id: substitutionId,
          ...scheduleProvenance,
        } : null,
      };
      const authorityReceipt = {
        authority_kind: offerBinding
          ? "exact_configured_coverage_offer_recipient"
          : "exact_manual_coverage_task_recipient",
        task_id: task.id,
        offered_revision: task.revision,
        replacement_staff_profile_id: task.replacement_staff_profile_id,
        recipient_user_id: user.id,
        ...(offerBinding ? {
          route_id: offerBinding.route_id,
          message_id: offerBinding.message_id,
          behaviour_version_id: offerBinding.behaviour_version_id,
          subscription_id: offerBinding.subscription_id,
          response_due_at: offerBinding.response_due_at,
          expires_at: offerBinding.expires_at,
          message_outcome_id: coordinationOutcome!.outcome_id,
        } : {}),
      };
      await this.audit(db, user, schoolId, `staff.coverage.${data.decision}`, task.id, {
        command_id: commandId,
        source_task_revision: task.revision,
        resulting_task_revision: updated.revision,
        source_outbox_event_id: outboxEventId,
        substitution_id: substitutionId,
        authority: authorityReceipt,
        schedule_provenance: scheduleProvenance,
      });
      await this.saveCoverageCommand(db, {
        school_id: schoolId,
        actor_id: user.id,
        command_id: commandId,
        decision: data.decision,
        target_task_id: task.id,
        request_hash: requestHash,
        source_task_revision: task.revision,
        resulting_task_revision: updated.revision,
        result: response,
        outbox_event_id: outboxEventId,
        substitution_id: substitutionId,
        authority_receipt: authorityReceipt,
        schedule_provenance: scheduleProvenance,
      });
      return response;
    });
  }

  async withdrawLeave(user: AuthUser, schoolId: string, requestId: string, body: unknown) {
    uuid.parse(requestId);
    const data = withdrawLeaveInput.parse(body);
    const { command_id: commandId, ...commandInput } = data;
    const requestHash = staffLeaveCommandHash("withdraw", requestId, commandInput);
    return this.db.transaction().execute(async (db) => {
      await this.membership(user, schoolId, ["staff"], db);
      const prior = await this.priorLeaveCommand<Record<string, unknown>>(db, schoolId, user.id, commandId, "withdraw", requestHash);
      if (prior) return prior.result;
      const request = await sql<{ id: string; revision: number; status: string; staff_profile_id: string }>`SELECT r.id,r.revision,r.status,r.staff_profile_id FROM staff_leave_requests r JOIN staff_profiles profile ON profile.id=r.staff_profile_id
        WHERE r.id=${requestId}::uuid AND r.school_id=${schoolId}::uuid AND profile.user_id=${user.id}::uuid FOR UPDATE`.execute(db);
      const current = request.rows[0];
      if (!current) throw new NotFoundException();
      if (current.status !== "submitted" || current.revision !== data.expected_revision) throw new ConflictException("Only the latest pending request can be withdrawn.");
      const occurredAt = new Date();
      const submissionTrace = await this.leaveSubmissionTrace(db, schoolId, requestId);
      const updated = await db.updateTable("staff_leave_requests").set({ status: "withdrawn", updated_at: new Date() }).where("id", "=", requestId).returningAll().executeTakeFirstOrThrow();
      await db.insertInto("staff_leave_request_audits").values({ school_id: schoolId, request_id: requestId, actor_id: user.id, action: "withdrawn", from_status: "submitted", to_status: "withdrawn" }).execute();
      const outboxEventId = await this.enqueue(
        db,
        schoolId,
        requestId,
        "staff.leave.withdrawn",
        [user.id, submissionTrace.original_owner_user_id],
        [submissionTrace.original_owner_user_id],
        {
          kind: "leave",
          title: "Leave request withdrawn",
          body: "A pending staff leave request was withdrawn by its requester.",
          attention_eligible: false,
        },
        { school_id: schoolId, status: "withdrawn", revision: updated.revision },
      );
      const coordination = await this.staffLeaveModel.cancelSubmittedRequest(db, {
        school_id: schoolId,
        actor_user_id: user.id,
        message_id: submissionTrace.message_id,
        source_outbox_event_id: outboxEventId,
        command_id: commandId,
        occurred_at: occurredAt.toISOString(),
      });
      await this.audit(db, user, schoolId, "staff.leave.withdrawn", requestId, {
        command_id: commandId,
        source_outbox_event_id: outboxEventId,
        correlation_id: submissionTrace.correlation_id,
        causation_event_id: submissionTrace.causation_event_id,
        message_id: coordination.message_id,
        message_outcome_id: coordination.outcome_id,
        cancellation_authority: "original_message_sender",
        original_recipient_user_id: submissionTrace.original_owner_user_id,
      });
      await this.saveLeaveCommand(db, schoolId, user.id, commandId, "withdraw", requestId, requestHash, updated, outboxEventId, {
        correlation_id: submissionTrace.correlation_id,
        causation_event_id: submissionTrace.causation_event_id,
        authority_receipt: {
          cancellation_authority: "original_message_sender",
          requester_user_id: user.id,
          original_recipient_user_id: submissionTrace.original_owner_user_id,
          message_id: submissionTrace.message_id,
        },
        coordination_receipt: coordination as unknown as Record<string, unknown>,
      });
      return updated;
    });
  }
}
