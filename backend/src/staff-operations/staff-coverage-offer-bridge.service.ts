import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import {
  COORDINATION_RUNTIME_PORT,
  type CoordinationRuntimePort,
  type MatchedCoordinationRouteResolution,
  type OperationalMessageOutcomeReceipt,
} from "../campus-model-core/coordination-runtime.port.js";
import type { CampusModelEntitySnapshot } from "../campus-model-core/contracts.js";
import type { Database } from "../database/types.js";

export const STAFF_COVERAGE_OFFER_SELECTOR_KEY = "staff_coverage_offer_recipient";

export const staffCoverageOfferBehaviourSchema = z.object({
  workflow: z.literal("staff_coverage_offer_routing"),
  candidate_strategy: z.enum(["least_recently_accepted", "staff_code_ascending"]),
  candidate_pool: z.object({
    staff_kind: z.enum(["teaching", "any"]),
    department_scope: z.enum(["same_as_absent", "institution"]),
  }).strict(),
  outcomes: z.object({
    no_eligible_candidate: z.literal("manual_review"),
    declined: z.literal("manual_review"),
    expired: z.literal("manual_review"),
  }).strict(),
  manual_override: z.enum(["allowed", "disabled"]),
}).strict();

export type StaffCoverageOfferRouteStatus =
  | "configuration_missing"
  | "configuration_invalid"
  | "no_eligible_candidate"
  | "offered"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled";

export interface StaffCoverageOfferRoutingInput {
  school_id: string;
  actor_user_id: string;
  task_id: string;
  source_task_revision: number;
  source_outbox_event_id: string;
  route_kind: "automatic" | "manual_override";
  manual_candidate_profile_id?: string | null;
}

export interface StaffCoverageOfferRoutingReceipt {
  route_id: string;
  status: StaffCoverageOfferRouteStatus;
  task_id: string;
  source_task_revision: number;
  offered_task_revision: number | null;
  selected_staff_profile_id: string | null;
  selected_user_id: string | null;
  message_id: string | null;
  explanation: string;
  replayed: boolean;
}

export interface StaffCoverageOfferResponseBinding {
  route_id: string;
  message_id: string;
  correlation_id: string;
  source_task_revision: number;
  offered_task_revision: number;
  selected_staff_profile_id: string;
  selected_user_id: string;
  behaviour_version_id: string;
  subscription_id: string;
  response_due_at: string;
  expires_at: string;
}

type CoverageTaskForRouting = {
  id: string;
  school_id: string;
  revision: number;
  status: "open" | "offered" | "accepted" | "declined" | "completed" | "cancelled" |
    "fallback_applied" | "expired_unconfirmed";
  absent_staff_profile_id: string;
  replacement_staff_profile_id: string | null;
  source_schedule_id: string | null;
  class_section_id: string | null;
  subject_id: string | null;
  duty_date: string;
  period_number: number | null;
  starts_at: string | null;
  ends_at: string | null;
  title: string;
  location: string;
  absent_department: string;
  class_revision: number | null;
  class_label: string | null;
};

type EligibleCandidate = {
  profile_id: string;
  user_id: string;
  staff_code: string;
  department: string;
  accepted_count: number;
  last_accepted_at: Date | string | null;
};

type RetainedRoute = {
  id: string;
  status: StaffCoverageOfferRouteStatus;
  coverage_task_id: string;
  source_task_revision: number;
  offered_task_revision: number | null;
  selected_staff_profile_id: string | null;
  selected_user_id: string | null;
  message_id: string | null;
  explanation: string;
};

@Injectable()
export class StaffCoverageOfferBridgeService {
  constructor(
    @Inject(COORDINATION_RUNTIME_PORT)
    private readonly coordination: CoordinationRuntimePort,
  ) {}

  private receipt(route: RetainedRoute, replayed: boolean): StaffCoverageOfferRoutingReceipt {
    return {
      route_id: route.id,
      status: route.status,
      task_id: route.coverage_task_id,
      source_task_revision: route.source_task_revision,
      offered_task_revision: route.offered_task_revision,
      selected_staff_profile_id: route.selected_staff_profile_id,
      selected_user_id: route.selected_user_id,
      message_id: route.message_id,
      explanation: route.explanation,
      replayed,
    };
  }

  private async retainedRoute(
    transaction: Transaction<Database>,
    schoolId: string,
    taskId: string,
    sourceRevision: number,
  ) {
    return (await sql<RetainedRoute>`SELECT id,status,coverage_task_id,source_task_revision,
        offered_task_revision,selected_staff_profile_id,selected_user_id,message_id,explanation
      FROM staff_coverage_offer_routes
      WHERE school_id=${schoolId}::uuid AND coverage_task_id=${taskId}::uuid
        AND source_task_revision=${sourceRevision}
      FOR UPDATE`.execute(transaction)).rows[0] ?? null;
  }

  private async routeRound(
    transaction: Transaction<Database>,
    schoolId: string,
    taskId: string,
  ) {
    return (await sql<{ round: number }>`SELECT COALESCE(max(route_round),0)::int+1 AS round
      FROM staff_coverage_offer_routes
      WHERE school_id=${schoolId}::uuid AND coverage_task_id=${taskId}::uuid`.execute(transaction)).rows[0]!.round;
  }

  private scopeFor(task: CoverageTaskForRouting): CampusModelEntitySnapshot | null {
    if (!task.class_section_id) return null;
    return {
      kind: "class",
      domain: "academic_structure",
      domain_id: task.class_section_id,
      label: task.class_label ?? "Class",
      lifecycle_state: "active",
      source_revision: task.class_revision ?? 1,
      metadata: {},
    };
  }

  private sortCandidates(
    candidates: EligibleCandidate[],
    strategy: z.infer<typeof staffCoverageOfferBehaviourSchema>["candidate_strategy"],
  ) {
    return [...candidates].sort((left, right) => {
      if (strategy === "least_recently_accepted") {
        const leftTime = left.last_accepted_at ? new Date(left.last_accepted_at).getTime() : Number.NEGATIVE_INFINITY;
        const rightTime = right.last_accepted_at ? new Date(right.last_accepted_at).getTime() : Number.NEGATIVE_INFINITY;
        if (leftTime !== rightTime) return leftTime - rightTime;
        if (left.accepted_count !== right.accepted_count) return left.accepted_count - right.accepted_count;
      }
      const byCode = left.staff_code.localeCompare(right.staff_code, "en", { sensitivity: "base", numeric: true });
      return byCode || left.profile_id.localeCompare(right.profile_id);
    });
  }

  private async candidates(
    transaction: Transaction<Database>,
    task: CoverageTaskForRouting,
    config: z.infer<typeof staffCoverageOfferBehaviourSchema>,
  ) {
    const candidates = (await sql<EligibleCandidate>`SELECT
        profile.id AS profile_id,profile.user_id,profile.staff_code,profile.department,
        COALESCE(history.accepted_count,0)::int AS accepted_count,
        history.last_accepted_at
      FROM staff_profiles profile
      JOIN users account ON account.id=profile.user_id AND account.is_active
      JOIN school_memberships membership ON membership.school_id=profile.school_id
        AND membership.user_id=profile.user_id AND membership.role='staff' AND membership.is_active
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS accepted_count,max(previous.responded_at) AS last_accepted_at
        FROM staff_coverage_tasks previous
        WHERE previous.school_id=profile.school_id
          AND previous.replacement_staff_profile_id=profile.id
          AND previous.status IN ('accepted','completed')
      ) history ON true
      WHERE profile.school_id=${task.school_id}::uuid AND profile.status='active'
        AND profile.user_id IS NOT NULL
        AND profile.id<>${task.absent_staff_profile_id}::uuid
        AND (${config.candidate_pool.staff_kind}='any' OR profile.staff_kind='teaching')
        AND (${config.candidate_pool.department_scope}='institution'
          OR profile.department=${task.absent_department})
        AND NOT EXISTS(
          SELECT 1 FROM staff_leave_requests leave_request
          WHERE leave_request.school_id=profile.school_id
            AND leave_request.staff_profile_id=profile.id
            AND leave_request.status='approved'
            AND ${task.duty_date}::date BETWEEN leave_request.starts_on AND leave_request.ends_on
        )
        AND (
          ${task.starts_at}::time IS NULL OR ${task.ends_at}::time IS NULL
          OR NOT EXISTS(
            SELECT 1 FROM effective_school_schedule(${task.school_id}::uuid,${task.duty_date}::date) schedule
            WHERE schedule.teacher_user_id=profile.user_id
              AND schedule.starts_at<${task.ends_at}::time
              AND schedule.ends_at>${task.starts_at}::time
              AND NOT schedule.cancelled
          )
        )
        AND (
          ${task.starts_at}::time IS NULL OR ${task.ends_at}::time IS NULL
          OR NOT EXISTS(
            SELECT 1 FROM staff_coverage_tasks cover
            WHERE cover.school_id=profile.school_id
              AND cover.replacement_staff_profile_id=profile.id
              AND cover.id<>${task.id}::uuid
              AND cover.duty_date=${task.duty_date}::date
              AND cover.status IN ('offered','accepted')
              AND cover.starts_at<${task.ends_at}::time
              AND cover.ends_at>${task.starts_at}::time
          )
        )
      ORDER BY lower(profile.staff_code),profile.id
      FOR SHARE OF profile,account,membership`.execute(transaction)).rows;
    return this.sortCandidates(candidates, config.candidate_strategy);
  }

  private async insertFailure(
    transaction: Transaction<Database>,
    input: StaffCoverageOfferRoutingInput,
    task: CoverageTaskForRouting,
    routeRound: number,
    status: "configuration_missing" | "configuration_invalid" | "no_eligible_candidate",
    explanation: string,
    correlationId: string,
    route: MatchedCoordinationRouteResolution | null,
    behaviourSnapshot: Record<string, unknown>,
    selectorSnapshot: Record<string, unknown>,
    eligibilitySnapshot: Record<string, unknown>,
  ) {
    const row = (await sql<RetainedRoute>`INSERT INTO staff_coverage_offer_routes(
        school_id,coverage_task_id,route_round,route_kind,status,source_task_revision,
        source_outbox_event_id,routed_by,behaviour_version_id,subscription_id,
        correlation_id,selector_key,required_capability,candidate_strategy,
        behaviour_snapshot,selector_snapshot,eligibility_snapshot,explanation
      ) VALUES(
        ${input.school_id}::uuid,${task.id}::uuid,${routeRound},${input.route_kind},${status},
        ${input.source_task_revision},${input.source_outbox_event_id}::uuid,
        ${input.actor_user_id}::uuid,${route?.behaviour_version_id ?? null}::uuid,
        ${route?.subscription_id ?? null}::uuid,${correlationId}::uuid,
        ${STAFF_COVERAGE_OFFER_SELECTOR_KEY},${route?.selector.required_capability ?? null},
        ${behaviourSnapshot.candidate_strategy ?? null},
        ${JSON.stringify(behaviourSnapshot)}::jsonb,${JSON.stringify(selectorSnapshot)}::jsonb,
        ${JSON.stringify(eligibilitySnapshot)}::jsonb,${explanation}
      ) RETURNING id,status,coverage_task_id,source_task_revision,offered_task_revision,
        selected_staff_profile_id,selected_user_id,message_id,explanation`.execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The coverage routing exception could not be retained.");
    return this.receipt(row, false);
  }

  private async admins(transaction: Transaction<Database>, schoolId: string) {
    return (await sql<{ user_id: string }>`SELECT membership.user_id
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid
        AND membership.role='admin' AND membership.is_active
      ORDER BY membership.user_id`.execute(transaction)).rows.map((row) => row.user_id);
  }

  private async enqueueOffered(
    transaction: Transaction<Database>,
    task: CoverageTaskForRouting,
    revision: number,
    actorUserId: string,
    recipientUserId: string,
  ) {
    const admins = await this.admins(transaction, task.school_id);
    const audience = [...new Set([...admins, actorUserId, recipientUserId])].sort();
    const payload = {
      school_id: task.school_id,
      status: "offered",
      revision,
      duty_date: task.duty_date,
      refresh: ["staff-operations", "requests", "attention", "teacher.home", "principal.home"],
    };
    const notification = {
      kind: "general",
      title: "Cover duty offered",
      body: `${task.title} on ${task.duty_date} needs your response.`,
      staff_link: `/teacher/responsibilities?coverage=${task.id}&coverage_revision=${revision}`,
      attention_eligible: true,
      attention_portal: "teacher",
      attention_module: "responsibilities",
      attention_source_kind: "coverage_offer",
      attention_source_id: task.id,
      attention_source_revision: revision,
      attention_topic_key: `staff-coverage:${task.id}`,
      attention_subject_label: task.title,
    };
    const idempotencyKey = `staff.coverage.offered:${task.id}:${revision}`;
    const inserted = (await sql<{ id: string }>`INSERT INTO event_outbox(
        school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,
        idempotency_key,notification_user_ids,notification_payload
      ) VALUES(
        ${task.school_id}::uuid,'staff.coverage.offered','staff_coverage_task',${task.id}::uuid,
        ${audience}::uuid[],${JSON.stringify(payload)}::jsonb,${idempotencyKey},
        ${[recipientUserId]}::uuid[],${JSON.stringify(notification)}::jsonb
      ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`.execute(transaction)).rows[0];
    if (inserted) return inserted.id;
    const retained = (await sql<{ id: string; exact: boolean }>`SELECT id,
        school_id=${task.school_id}::uuid
          AND event_type='staff.coverage.offered'
          AND aggregate_type='staff_coverage_task'
          AND aggregate_id=${task.id}::uuid
          AND audience_user_ids=${audience}::uuid[]
          AND payload=${JSON.stringify(payload)}::jsonb
          AND notification_user_ids=${[recipientUserId]}::uuid[]
          AND notification_payload=${JSON.stringify(notification)}::jsonb AS exact
      FROM event_outbox WHERE idempotency_key=${idempotencyKey} FOR UPDATE`.execute(transaction)).rows[0];
    if (!retained?.exact) {
      throw new ConflictException("The retained coverage Offer event belongs to different evidence.");
    }
    return retained.id;
  }

  async routeFirstOffer(
    transaction: Transaction<Database>,
    input: StaffCoverageOfferRoutingInput,
  ): Promise<StaffCoverageOfferRoutingReceipt> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${input.school_id}`},0))`.execute(transaction);
    const replay = await this.retainedRoute(
      transaction,
      input.school_id,
      input.task_id,
      input.source_task_revision,
    );
    if (replay) return this.receipt(replay, true);

    const task = (await sql<CoverageTaskForRouting>`SELECT
        task.id,task.school_id,task.revision,task.status,task.absent_staff_profile_id,
        task.replacement_staff_profile_id,task.source_schedule_id,task.class_section_id,
        task.subject_id,task.duty_date::text,task.period_number,task.starts_at::text,
        task.ends_at::text,task.title,task.location,absent.department AS absent_department,
        section.revision AS class_revision,
        CASE WHEN section.id IS NULL THEN NULL ELSE concat('Class ',section.grade,section.section) END AS class_label
      FROM staff_coverage_tasks task
      JOIN staff_profiles absent ON absent.id=task.absent_staff_profile_id
        AND absent.school_id=task.school_id
      LEFT JOIN class_sections section ON section.id=task.class_section_id
        AND section.school_id=task.school_id
      WHERE task.id=${input.task_id}::uuid AND task.school_id=${input.school_id}::uuid
      FOR UPDATE OF task`.execute(transaction)).rows[0];
    if (!task) throw new ConflictException("The coverage task is no longer available.");
    if (task.revision !== input.source_task_revision || task.status !== "open") {
      throw new ConflictException("The coverage task changed before its Offer could be routed.");
    }
    const source = (await sql<{ created_at: Date | string; exact: boolean }>`SELECT created_at,
        event_type='staff.coverage.opened'
          AND aggregate_type='staff_coverage_task'
          AND aggregate_id=${task.id}::uuid
          AND payload->>'revision'=${String(input.source_task_revision)} AS exact
      FROM event_outbox
      WHERE id=${input.source_outbox_event_id}::uuid AND school_id=${input.school_id}::uuid
      FOR KEY SHARE`.execute(transaction)).rows[0];
    if (!source?.exact) {
      throw new ConflictException("The coverage routing event does not match this task revision.");
    }
    const occurredAt = new Date(source.created_at).toISOString();
    const correlationId = randomUUID();
    const round = await this.routeRound(transaction, input.school_id, task.id);
    const resolved = await this.coordination.resolveEventRoute(transaction, {
      school_id: input.school_id,
      source_domain: "staff_coverage",
      event_type: "staff.coverage.opened",
      selector_key: STAFF_COVERAGE_OFFER_SELECTOR_KEY,
      occurred_at: occurredAt,
    });
    if (resolved.status === "unmatched") {
      return this.insertFailure(
        transaction,
        input,
        task,
        round,
        resolved.exception_code,
        resolved.explanation,
        correlationId,
        null,
        {},
        { selector_key: STAFF_COVERAGE_OFFER_SELECTOR_KEY },
        { evaluated: false },
      );
    }
    const route = resolved;
    const config = staffCoverageOfferBehaviourSchema.safeParse(route.behaviour_configuration);
    const timingInvalid = route.message_kind !== "offer"
      || route.selector.min_recipients !== 1
      || route.selector.max_recipients !== 1
      || route.response_due_after_seconds === null
      || route.response_due_after_seconds <= 0
      || route.expires_after_seconds === null
      || route.expires_after_seconds <= 0
      || route.response_due_after_seconds > route.expires_after_seconds;
    if (!config.success || route.configuration_schema_version !== 1 || timingInvalid) {
      return this.insertFailure(
        transaction,
        input,
        task,
        round,
        "configuration_invalid",
        "The approved staff-coverage Offer behaviour is incomplete or invalid.",
        correlationId,
        route,
        config.success ? config.data : { schema_errors: config.error?.issues.map((issue) => issue.path.join(".")) ?? [] },
        { selector: route.selector, message_kind: route.message_kind },
        { evaluated: false },
      );
    }
    if (input.route_kind === "manual_override" && config.data.manual_override !== "allowed") {
      return this.insertFailure(
        transaction,
        input,
        task,
        round,
        "configuration_invalid",
        "The approved staff-coverage behaviour does not permit manual candidate override.",
        correlationId,
        route,
        config.data,
        { selector: route.selector },
        { evaluated: false, manual_candidate_profile_id: input.manual_candidate_profile_id ?? null },
      );
    }
    const domainCandidates = await this.candidates(transaction, task, config.data);
    const candidatePool = input.route_kind === "manual_override"
      ? domainCandidates.filter((candidate) => candidate.profile_id === input.manual_candidate_profile_id)
      : domainCandidates;
    const scope = this.scopeFor(task);
    if (route.selector.scope_mode === "event_scope" && !scope) {
      return this.insertFailure(
        transaction,
        input,
        task,
        round,
        "configuration_invalid",
        "This coverage route requires a class scope, but the duty has no class.",
        correlationId,
        route,
        config.data,
        { selector: route.selector },
        { evaluated: true, domain_candidate_count: domainCandidates.length },
      );
    }
    if (route.selector.scope_mode === "institution" && scope) {
      // The scope is used only when the configured selector asks for it.
    }
    const authorization = await this.coordination.authorizeCandidateRecipients(transaction, {
      school_id: input.school_id,
      behaviour_version_id: route.behaviour_version_id,
      subscription_id: route.subscription_id,
      occurred_at: occurredAt,
      recipients: candidatePool.map((candidate) => ({ agent_kind: "human" as const, user_id: candidate.user_id })),
      scope: route.selector.scope_mode === "event_scope" ? scope : null,
    });
    const authorisedUserIds = new Set(authorization.authorised.flatMap((recipient) => recipient.agent_kind === "human" ? [recipient.user_id] : []));
    const eligible = candidatePool.filter((candidate) => authorisedUserIds.has(candidate.user_id));
    if (eligible.length === 0) {
      return this.insertFailure(
        transaction,
        input,
        task,
        round,
        "no_eligible_candidate",
        input.route_kind === "manual_override"
          ? "The selected staff member is not currently eligible and authorized for this cover Offer."
          : "No active, available and authorized staff member currently matches the configured candidate strategy.",
        correlationId,
        route,
        config.data,
        { selector: route.selector },
        {
          evaluated: true,
          strategy: config.data.candidate_strategy,
          domain_candidate_count: domainCandidates.length,
          considered_profile_ids: candidatePool.map((candidate) => candidate.profile_id),
          unresolved_recipient_count: authorization.unresolved.length,
          unauthorized_recipient_count: authorization.unauthorized.length,
          configured_disposition: config.data.outcomes.no_eligible_candidate,
        },
      );
    }
    const selected = eligible[0]!;
    const publish = await this.coordination.publishAcceptedEvent(transaction, {
      school_id: input.school_id,
      source_outbox_event_id: input.source_outbox_event_id,
      event_kind: "domain_event",
      event_type: "staff.coverage.opened",
      subject: {
        kind: "staff_coverage_task",
        domain: "staff_coverage",
        domain_id: task.id,
        label: "Staff cover duty",
        lifecycle_state: "active",
        source_revision: task.revision,
        metadata: {},
      },
      context: route.selector.scope_mode === "event_scope" ? scope : null,
      actor_user_id: input.actor_user_id,
      occurred_at: occurredAt,
      effective_from: occurredAt,
      effective_until: null,
      source_domain: "staff_coverage",
      source_record_id: task.id,
      source_revision: task.revision,
      correlation_id: correlationId,
      causation_event_id: null,
      idempotency_key: `staff-coverage-offer:${task.id}:${task.revision}`,
      expected_route: {
        behaviour_version_id: route.behaviour_version_id,
        subscription_id: route.subscription_id,
      },
      payload: {
        coverage_task_id: task.id,
        revision: task.revision,
        duty_date: task.duty_date,
        class_section_id: task.class_section_id,
        subject_id: task.subject_id,
        period_number: task.period_number,
      },
      message: {
        subject: "Cover duty offered",
        summary: "A dated staff cover duty needs your response.",
        payload: {
          coverage_task_id: task.id,
          source_revision: task.revision,
          duty_date: task.duty_date,
          starts_at: task.starts_at,
          ends_at: task.ends_at,
          action_path: `/teacher/responsibilities?coverage=${task.id}&coverage_revision=${task.revision + 1}`,
        },
      },
      selector_input: {
        selector_key: STAFF_COVERAGE_OFFER_SELECTOR_KEY,
        recipient_agents: [{ agent_kind: "human", user_id: selected.user_id }],
        scope: route.selector.scope_mode === "event_scope" ? scope : null,
      },
    });
    if (publish.status !== "matched"
      || publish.behaviour_version_id !== route.behaviour_version_id
      || publish.subscription_id !== route.subscription_id
      || publish.deliveries.length !== 1
      || publish.deliveries[0]?.recipient.agent_kind !== "human"
      || publish.deliveries[0].recipient.user_id !== selected.user_id
      || publish.route_snapshot?.message_kind !== "offer"
      || !publish.route_snapshot.response_due_at
      || !publish.route_snapshot.expires_at) {
      throw new ConflictException("The configured coverage Offer route changed while it was being published.");
    }
    const updated = await transaction.updateTable("staff_coverage_tasks").set({
      replacement_staff_profile_id: selected.profile_id,
      status: "offered",
      assigned_by: input.actor_user_id,
      offered_at: new Date(occurredAt),
      responded_at: null,
      response_note: "",
      updated_at: new Date(),
    }).where("id", "=", task.id)
      .where("school_id", "=", input.school_id)
      .where("revision", "=", task.revision)
      .where("status", "=", "open")
      .returningAll().executeTakeFirst();
    if (!updated) throw new ConflictException("The coverage task changed while its Offer was being published.");

    const explanation = input.route_kind === "manual_override"
      ? "An administrator explicitly selected an eligible, currently authorized staff member."
      : config.data.candidate_strategy === "least_recently_accepted"
        ? "Selected the available authorized staff member who least recently accepted cover, with staff code as the stable tie-breaker."
        : "Selected the first available authorized staff member in stable staff-code order.";
    const row = (await sql<RetainedRoute>`INSERT INTO staff_coverage_offer_routes(
        school_id,coverage_task_id,route_round,route_kind,status,source_task_revision,
        offered_task_revision,source_outbox_event_id,routed_by,selected_staff_profile_id,
        selected_user_id,behaviour_version_id,subscription_id,model_event_id,reaction_id,
        message_id,correlation_id,selector_key,required_capability,candidate_strategy,
        response_due_at,expires_at,behaviour_snapshot,selector_snapshot,
        eligibility_snapshot,explanation
      ) VALUES(
        ${input.school_id}::uuid,${task.id}::uuid,${round},${input.route_kind},'offered',
        ${task.revision},${updated.revision},${input.source_outbox_event_id}::uuid,
        ${input.actor_user_id}::uuid,${selected.profile_id}::uuid,${selected.user_id}::uuid,
        ${route.behaviour_version_id}::uuid,${route.subscription_id}::uuid,
        ${publish.event_id}::uuid,${publish.deliveries[0].reaction_id}::uuid,
        ${publish.deliveries[0].message_id}::uuid,${correlationId}::uuid,
        ${STAFF_COVERAGE_OFFER_SELECTOR_KEY},${route.selector.required_capability},
        ${config.data.candidate_strategy},${publish.route_snapshot.response_due_at}::timestamptz,
        ${publish.route_snapshot.expires_at}::timestamptz,
        ${JSON.stringify({
          behaviour_key: route.behaviour_key,
          version: route.behaviour_version,
          configuration_schema_version: route.configuration_schema_version,
          configuration: config.data,
          subscription: {
            subscription_key: route.subscription_key,
            reaction_kind: route.reaction_kind,
            message_kind: route.message_kind,
            message_schema_version: route.message_schema_version,
            response_due_after_seconds: route.response_due_after_seconds,
            expires_after_seconds: route.expires_after_seconds,
            max_attempts: route.max_attempts,
            retry_after_seconds: route.retry_after_seconds,
            priority: route.priority,
          },
        })}::jsonb,
        ${JSON.stringify({ selector: route.selector, scope })}::jsonb,
        ${JSON.stringify({
          strategy: config.data.candidate_strategy,
          route_kind: input.route_kind,
          considered_profile_ids: candidatePool.map((candidate) => candidate.profile_id),
          eligible_profile_ids: eligible.map((candidate) => candidate.profile_id),
          unresolved_recipient_count: authorization.unresolved.length,
          unauthorized_recipient_count: authorization.unauthorized.length,
          selected_profile_id: selected.profile_id,
          selected_staff_code: selected.staff_code,
          selected_prior_acceptance_count: selected.accepted_count,
          selected_last_accepted_at: selected.last_accepted_at,
          configured_outcomes: config.data.outcomes,
        })}::jsonb,${explanation}
      ) RETURNING id,status,coverage_task_id,source_task_revision,offered_task_revision,
        selected_staff_profile_id,selected_user_id,message_id,explanation`.execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The coverage Offer binding could not be retained.");

    await transaction.insertInto("staff_coverage_task_audits").values({
      school_id: input.school_id,
      task_id: task.id,
      actor_id: input.actor_user_id,
      action: "offered",
      from_status: "open",
      to_status: "offered",
      note: explanation,
      automated: input.route_kind === "automatic",
    }).execute();
    const offeredOutboxId = await this.enqueueOffered(
      transaction,
      task,
      updated.revision,
      input.actor_user_id,
      selected.user_id,
    );
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES(${input.school_id}::uuid,${input.actor_user_id}::uuid,'staff.coverage.offered',
        ${task.id}::uuid,${JSON.stringify({
          automated: input.route_kind === "automatic",
          route_kind: input.route_kind,
          route_id: row.id,
          source_task_revision: task.revision,
          resulting_task_revision: updated.revision,
          source_outbox_event_id: input.source_outbox_event_id,
          offered_outbox_event_id: offeredOutboxId,
          behaviour_version_id: route.behaviour_version_id,
          subscription_id: route.subscription_id,
          message_id: publish.deliveries[0].message_id,
          candidate_strategy: config.data.candidate_strategy,
        })}::jsonb)`.execute(transaction);
    return this.receipt(row, false);
  }

  async currentResponseBinding(
    transaction: Transaction<Database>,
    input: {
      school_id: string;
      task_id: string;
      task_revision: number;
      selected_staff_profile_id: string;
      selected_user_id: string;
    },
  ): Promise<StaffCoverageOfferResponseBinding | null> {
    const route = (await sql<StaffCoverageOfferResponseBinding & {
      before_due: boolean;
      before_expiry: boolean;
      exact_current_recipient: boolean;
    }>`SELECT
        id AS route_id,message_id,correlation_id,source_task_revision,
        offered_task_revision,selected_staff_profile_id,selected_user_id,
        behaviour_version_id,subscription_id,response_due_at::text,expires_at::text,
        CURRENT_TIMESTAMP<=response_due_at AS before_due,
        CURRENT_TIMESTAMP<expires_at AS before_expiry,
        offered_task_revision=${input.task_revision}
          AND selected_staff_profile_id=${input.selected_staff_profile_id}::uuid
          AND selected_user_id=${input.selected_user_id}::uuid AS exact_current_recipient
      FROM staff_coverage_offer_routes
      WHERE school_id=${input.school_id}::uuid AND coverage_task_id=${input.task_id}::uuid
        AND status='offered'
      FOR UPDATE`.execute(transaction)).rows;
    if (route.length === 0) return null;
    if (route.length !== 1) {
      throw new ConflictException("The exact current coverage Offer binding is missing or ambiguous.");
    }
    const binding = route[0]!;
    if (!binding.exact_current_recipient) {
      throw new ConflictException("The exact current coverage Offer binding does not match this task revision and recipient.");
    }
    if (!binding.before_due) throw new ConflictException("The response deadline for this coverage Offer has passed.");
    if (!binding.before_expiry) throw new ConflictException("This coverage Offer has expired.");
    return binding;
  }

  async recordResponse(
    transaction: Transaction<Database>,
    input: {
      school_id: string;
      actor_user_id: string;
      task_id: string;
      decision: "accepted" | "declined";
      source_task_revision: number;
      resulting_task_revision: number;
      source_outbox_event_id: string;
      command_id: string;
      occurred_at: string;
      binding: StaffCoverageOfferResponseBinding;
    },
  ): Promise<OperationalMessageOutcomeReceipt> {
    if (input.actor_user_id !== input.binding.selected_user_id
      || input.source_task_revision !== input.binding.offered_task_revision) {
      throw new ConflictException("Only the exact current coverage Offer recipient can respond.");
    }
    const outcome = await this.coordination.recordRecipientResponse(transaction, {
      school_id: input.school_id,
      message_id: input.binding.message_id,
      correlation_id: input.binding.correlation_id,
      recipient: { agent_kind: "human", user_id: input.binding.selected_user_id },
      actor: { agent_kind: "human", user_id: input.actor_user_id },
      expected_source_record_id: input.task_id,
      expected_source_revision: input.binding.source_task_revision,
      source_outbox_event_id: input.source_outbox_event_id,
      code: input.decision === "accepted"
        ? "staff_coverage_offer_accepted"
        : "staff_coverage_offer_declined",
      explanation: input.decision === "accepted"
        ? "The specifically offered staff member accepted the cover duty."
        : "The specifically offered staff member declined the cover duty.",
      response: {
        coverage_task_id: input.task_id,
        decision: input.decision,
        resulting_revision: input.resulting_task_revision,
      },
      occurred_at: input.occurred_at,
      idempotency_key: `staff-coverage-offer-response:${input.task_id}:${input.binding.message_id}:${input.actor_user_id}:${input.command_id}`,
    });
    const updated = (await sql<{ id: string }>`UPDATE staff_coverage_offer_routes
      SET status=${input.decision},response_outbox_event_id=${input.source_outbox_event_id}::uuid,
        responded_at=${input.occurred_at}::timestamptz
      WHERE id=${input.binding.route_id}::uuid AND school_id=${input.school_id}::uuid
        AND status='offered' AND message_id=${input.binding.message_id}::uuid
      RETURNING id`.execute(transaction)).rows[0];
    if (!updated) throw new ConflictException("The coverage Offer was already closed.");
    return outcome;
  }

}
