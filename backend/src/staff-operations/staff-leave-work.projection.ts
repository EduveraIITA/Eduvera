import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage } from "../campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { GOVERNANCE_DECISION_AUTHORITY_PORT, type GovernanceDecisionAuthorityPort } from "../governance/decision-authority.port.js";

export interface StaffLeaveWaitingRecord {
  id: string;
  revision: number;
  policy_label: string;
  starts_on: string;
  ends_on: string;
  created_at: string;
  submitted_at: string;
  reviewer: { user_id: string; label: string } | null;
  state: "waiting_for_review" | "needs_reassignment" | "route_unavailable";
  response_due_at: string | null;
  message_id: string | null;
}

export interface StaffLeaveDiscovery {
  has_personal_staff_work: boolean;
  can_review_staff_leave: boolean;
  coverage_available: boolean;
  source_revisions: string[];
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const uuid = (value: unknown) => z.uuid().safeParse(value).success ? String(value) : null;
const instant = (value: unknown) => z.iso.datetime({ offset: true }).safeParse(value).success ? new Date(String(value)).toISOString() : null;

/** Staff owns this outgoing view. It neither transfers a request nor reads Core tables. */
@Injectable()
export class StaffLeaveWorkProjection {
  constructor(private readonly db: DatabaseService,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
    @Inject(GOVERNANCE_DECISION_AUTHORITY_PORT) private readonly authority: GovernanceDecisionAuthorityPort) {}

  /** Navigation is a read-only projection of native employment and current
   * decision authority, not a fabricated dated duty or administrator grant. */
  async discovery(user: AuthUser, schoolId: string, at: Date): Promise<StaffLeaveDiscovery> {
    const environment = executionEnvironmentStorage.getStore();
    if ((user.active_school_id && user.active_school_id !== schoolId) || (environment?.institution_id && environment.institution_id !== schoolId))
      throw new ForbiddenException("Staff work must belong to the selected campus.");
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => {
      const empty: StaffLeaveDiscovery = { has_personal_staff_work: false, can_review_staff_leave: false, coverage_available: false, source_revisions: [] };
      const identity = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: at.toISOString() });
      if (!identity.acting) return empty;
      const memberships = await db.selectFrom("school_memberships").select(["id", "role"]).where("school_id", "=", schoolId)
        .where("user_id", "=", user.id).where("is_active", "=", true).where("role", "in", ["admin", "staff"]).execute();
      if (!memberships.length) return empty;
      const sourceRevisions = memberships.map(membership => `membership:${membership.id}:${membership.role}`).sort();
      let personal = false, reviewer = false;
      let activeProfileId: string | null = null;
      if (memberships.some(membership => membership.role === "staff")) {
        const profile = await db.selectFrom("staff_profiles").select(["id", "revision", "status"]).where("school_id", "=", schoolId)
          .where("user_id", "=", user.id).where("person_id", "=", identity.person_id).where("status", "!=", "inactive").executeTakeFirst();
        if (profile) { personal = true; activeProfileId = profile.status === "active" ? profile.id : null; sourceRevisions.push(`staff-profile:${profile.id}:${profile.revision}`); }
      }
      try {
        const authority = await this.authority.assertDecisionAuthority(db, schoolId, "staff_leave_decision", user.id, at);
        if (authority.person.id === identity.person_id) {
          reviewer = true;
          sourceRevisions.push(`leave-rule:${authority.rule.id}:${authority.rule.revision}`,
            `leave-office:${authority.office.id}:${authority.office.revision}`,
            `leave-appointment:${authority.appointment.id}:${authority.appointment.revision}`,
            ...authority.sources.map(source => `leave-source:${source.id}:${source.revision}`).sort());
        }
      } catch (error) {
        if (!(error instanceof ForbiddenException || error instanceof ConflictException || error instanceof NotFoundException)) throw error;
      }
      const administrator = memberships.some(membership => membership.role === "admin");
      const coverage = (await sql<{ total: number; latest_revision: number; latest_update: string | null }>`SELECT count(*)::int AS total,
          coalesce(max(task.revision),0)::int AS latest_revision,max(task.updated_at)::text AS latest_update
        FROM staff_coverage_tasks task WHERE task.school_id=${schoolId}::uuid AND (${administrator}
          OR (${activeProfileId}::uuid IS NOT NULL AND (task.absent_staff_profile_id=${activeProfileId}::uuid
            OR task.replacement_staff_profile_id=${activeProfileId}::uuid)))`.execute(db)).rows[0]!;
      if (coverage.total) sourceRevisions.push(`coverage:${coverage.total}:${coverage.latest_revision}:${coverage.latest_update}`);
      return { has_personal_staff_work: personal, can_review_staff_leave: reviewer, coverage_available: coverage.total > 0, source_revisions: sourceRevisions };
    });
  }

  /** Recheck both mirrors of a leave decision against its owning source and
   * retained route. A new mandate is not an implicit transfer of old work. */
  async reviewable(user: AuthUser, schoolId: string, ids: readonly string[], at: Date): Promise<ReadonlyMap<string, { message_id: string; revision: number }>> {
    const validIds = [...new Set(ids.filter(id => uuid(id)))];
    if (!validIds.length) return new Map();
    const environment = executionEnvironmentStorage.getStore();
    if ((user.active_school_id && user.active_school_id !== schoolId) || (environment?.institution_id && environment.institution_id !== schoolId)) {
      throw new ForbiddenException("Leave decisions must belong to the selected campus.");
    }
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => {
      const identity = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: at.toISOString() });
      if (!identity.acting) return new Map();
      try { await this.authority.assertDecisionAuthority(db, schoolId, "staff_leave_decision", user.id, at); }
      catch (error) {
        if (error instanceof ForbiddenException || error instanceof ConflictException || error instanceof NotFoundException) return new Map();
        throw error;
      }
      const rows = (await sql<{ id: string; revision: number; message_id: string }>`SELECT request.id,request.revision,
          submission.coordination_receipt->'message_ids'->>0 AS message_id FROM staff_leave_requests request
        JOIN LATERAL (SELECT command.authority_receipt,command.coordination_receipt,command.result
          FROM staff_leave_commands command WHERE command.school_id=request.school_id AND command.target_request_id=request.id
            AND command.command_type IN ('submit','reroute') ORDER BY (command.result->>'revision')::integer DESC LIMIT 1) submission ON true
        WHERE request.school_id=${schoolId}::uuid AND request.id=ANY(${validIds}::uuid[]) AND request.status='submitted'
          AND (submission.result->>'revision')::integer=request.revision
          AND submission.authority_receipt->>'user_id'=${user.id}
          AND submission.authority_receipt->>'school_id'=${schoolId}
          AND submission.authority_receipt->>'matter_code'='staff_leave_decision'
          AND submission.authority_receipt->'person'->>'id'=${identity.person_id}
          AND CASE WHEN jsonb_typeof(submission.coordination_receipt->'message_ids')='array'
            THEN jsonb_array_length(submission.coordination_receipt->'message_ids') ELSE 0 END=1`.execute(db)).rows;
      return new Map(rows.filter(row => uuid(row.message_id)).map(row => [row.id, { message_id: row.message_id, revision: row.revision }]));
    });
  }

  async waiting(user: AuthUser, schoolId: string, at: Date): Promise<StaffLeaveWaitingRecord[]> {
    const environment = executionEnvironmentStorage.getStore();
    if ((user.active_school_id && user.active_school_id !== schoolId) || (environment?.institution_id && environment.institution_id !== schoolId)) {
      throw new ForbiddenException("Waiting work must belong to the selected campus.");
    }
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => {
      const identity = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: at.toISOString() });
      if (!identity.acting) return [];
      const rows = (await sql<{ id: string; revision: number; policy_label: string; starts_on: string; ends_on: string;
        created_at: Date | string; submitted_at: Date | string; authority_receipt: unknown; coordination_receipt: unknown; route_revision: number | null }>`
        SELECT request.id,request.revision,policy.name AS policy_label,request.starts_on::text,request.ends_on::text,
          request.created_at,request.submitted_at,submission.authority_receipt,submission.coordination_receipt,
          (submission.result->>'revision')::integer AS route_revision
        FROM staff_leave_requests request JOIN staff_profiles profile ON profile.id=request.staff_profile_id AND profile.school_id=request.school_id
        JOIN staff_leave_policies policy ON policy.id=request.policy_id AND policy.school_id=request.school_id
        LEFT JOIN LATERAL (SELECT command.authority_receipt,command.coordination_receipt,command.result
          FROM staff_leave_commands command WHERE command.school_id=request.school_id AND command.target_request_id=request.id
            AND command.command_type IN ('submit','reroute') ORDER BY (command.result->>'revision')::integer DESC LIMIT 1) submission ON true
        WHERE request.school_id=${schoolId}::uuid AND profile.user_id=${user.id}::uuid AND request.status='submitted'
          AND EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=request.school_id
            AND membership.user_id=${user.id}::uuid AND membership.is_active AND membership.role IN ('staff','admin'))
        ORDER BY request.submitted_at,request.id`.execute(db)).rows;
      if (!rows.length) return [];
      let currentOwner: string | null = null;
      try { currentOwner = (await this.authority.resolveDecisionOwner(db, schoolId, "staff_leave_decision", at)).user_id; }
      catch (error) {
        if (!(error instanceof ForbiddenException || error instanceof ConflictException || error instanceof NotFoundException)) throw error;
      }
      const result: StaffLeaveWaitingRecord[] = [];
      const reviewers = new Map<string, Awaited<ReturnType<HumanAgentIdentityPort["resolveAccountEndpoint"]>>>();
      for (const row of rows) {
        const retained = object(row.authority_receipt), route = object(row.coordination_receipt);
        const ownerId = uuid(retained.user_id);
        const ownerPerson = uuid(object(retained.person).id);
        const messages = Array.isArray(route.message_ids) ? route.message_ids : [];
        const messageId = messages.length === 1 ? uuid(messages[0]) : null;
        // Names identify only the reviewer retained for this already-authorized
        // request. An inactive endpoint does not silently select its successor.
        if (ownerId && !reviewers.has(ownerId)) reviewers.set(ownerId, await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: ownerId, at: at.toISOString() }));
        const reviewer = ownerId ? reviewers.get(ownerId) : null;
        const routeValid = Boolean(ownerId && ownerPerson && messageId && row.route_revision === row.revision
          && retained.school_id === schoolId && retained.matter_code === "staff_leave_decision");
        const sameReviewer = reviewer?.acting && reviewer.person_id === ownerPerson;
        result.push({ id: row.id, revision: row.revision, policy_label: row.policy_label, starts_on: row.starts_on, ends_on: row.ends_on,
          created_at: new Date(row.created_at).toISOString(), submitted_at: new Date(row.submitted_at).toISOString(),
          reviewer: ownerId ? { user_id: ownerId, label: sameReviewer ? reviewer.label : "Previous reviewer" } : null,
          state: !routeValid ? "route_unavailable" : currentOwner !== ownerId || !sameReviewer ? "needs_reassignment" : "waiting_for_review",
          response_due_at: routeValid ? instant(object(route.route_snapshot).response_due_at) : null,
          message_id: routeValid ? messageId : null });
      }
      return result;
    });
  }
}
