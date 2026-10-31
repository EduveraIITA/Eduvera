import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { ExecutionEnvironment } from "../campus-model-core/execution-environment.contracts.js";
import {
  RESPONSIBILITY_PROJECTION_PORT, type EffectiveResponsibilityRecord, type OwnedOperationalMessageRecord,
  type ResponsibilityProjectionPort,
} from "../campus-model-core/responsibility-projection.port.js";
import { DatabaseService } from "../database/database.service.js";
import type { InstitutionMembershipRole } from "../common/request.js";
import type { Database } from "../database/types.js";
import type {
  OwnedMessageProjection,
  RelationshipAreaProjection,
  ResponsibilityAssignmentProjection,
  WorkspaceRepositorySnapshot,
  WorkspaceScopeKind,
} from "./workspace.contracts.js";

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function scopeKind(kind: string): WorkspaceScopeKind {
  switch (kind) {
    case "institution": case "campus": case "class": case "offering": case "person": case "event": case "assessment":
    case "trip": case "space": case "resource": return kind;
    default: return "other";
  }
}

function assignment(row: EffectiveResponsibilityRecord): ResponsibilityAssignmentProjection {
  return {
    id: row.id,
    owner_agent_id: row.owner_agent_id,
    capability_key: row.capability_key,
    action_key: row.action_key,
    scope: { kind: scopeKind(row.scope_kind), id: row.scope_domain_id, label: row.scope_label },
    effective_from: iso(row.effective_from),
    effective_until: row.effective_until ? iso(row.effective_until) : null,
    effective_schedule: row.effective_schedule,
    authority_source_kind: row.authority_source_kind,
    authority_source_ref: row.authority_source_ref,
    fallback_agent_id: row.fallback_agent_id,
    source_domain: row.source_domain,
    source_record_id: row.source_record_id,
    source_revision: row.source_revision,
    revision: row.revision,
    projection_source: "canonical",
  };
}

@Injectable()
export class WorkspaceRepository {
  constructor(
    private readonly db: DatabaseService,
    @Inject(RESPONSIBILITY_PROJECTION_PORT) private readonly projection: ResponsibilityProjectionPort,
  ) {}

  load(input: {
    user_id: string;
    school_id: string;
    at: Date;
    execution_environment: ExecutionEnvironment | null;
  }): Promise<WorkspaceRepositorySnapshot> {
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async (transaction) => {
      const institution = (await sql<{ id: string; name: string; code: string; timezone: string }>`SELECT id::text,name,code,timezone
        FROM schools WHERE id=${input.school_id}::uuid`.execute(transaction)).rows[0];
      if (!institution) throw new NotFoundException("The selected institution is unavailable.");

      const memberships = (await sql<{ role: InstitutionMembershipRole; access_scope: 'campus' | 'assigned_work' }>`SELECT role,access_scope
        FROM school_memberships
        WHERE school_id=${input.school_id}::uuid AND user_id=${input.user_id}::uuid AND is_active
        ORDER BY role`.execute(transaction)).rows;
      if (!memberships.length) throw new ForbiddenException("You no longer have an active relationship with this institution.");
      const limited = memberships.every(item => item.access_scope === 'assigned_work');

      const model = await this.projection.loadEffectiveAgentWork(transaction, input);
      const messages = limited ? [] : await this.messages(transaction, input, model.messages);
      const relationships = limited ? [] : await this.relationships(transaction, input);

      return {
        institution,
        membership_roles: memberships.map((item) => item.role),
        access_scope: limited ? 'assigned_work' : 'campus',
        realm_id: model.realm_id,
        environment_namespace_id: model.environment_namespace_id,
        acting_agent_id: model.acting_agent_id,
        owner_agent_ids: model.owner_agent_ids,
        assignments: limited ? [] : model.assignments.map(assignment),
        messages,
        relationships,
      };
    });
  }

  private async messages(
    transaction: Transaction<Database>,
    input: { school_id: string },
    rows: readonly OwnedOperationalMessageRecord[],
  ): Promise<OwnedMessageProjection[]> {
    const payloadOf = (row: OwnedOperationalMessageRecord): Record<string, unknown> =>
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? row.payload as Record<string, unknown> : {};
    const changeIds = [...new Set(rows.map((row) => payloadOf(row).duty_change_id)
      .filter((value): value is string => typeof value === "string"))];
    const changes = changeIds.length ? (await sql<{ id: string; requester_trip_id: string }>`SELECT id::text,requester_trip_id::text
      FROM transport_duty_swap_requests WHERE school_id=${input.school_id}::uuid
        AND id::text=ANY(${sql.val(changeIds)}::text[])`.execute(transaction)).rows : [];
    const trips = new Map(changes.map((change) => [change.id, change.requester_trip_id]));
    return rows.map((row) => ({
      ...row,
      payload: { ...payloadOf(row), ...(trips.has(String(payloadOf(row).duty_change_id))
        ? { requester_trip_id: trips.get(String(payloadOf(row).duty_change_id)) } : {}) },
      response_due_at: row.response_due_at ? iso(row.response_due_at) : null,
      expires_at: row.expires_at ? iso(row.expires_at) : null,
      queued_at: iso(row.queued_at),
      updated_at: iso(row.updated_at),
    }));
  }

  private async relationships(
    transaction: Transaction<Database>,
    input: { user_id: string; school_id: string; at: Date },
  ): Promise<RelationshipAreaProjection[]> {
    const rows = (await sql<{
      relationship: "self" | "dependent"; student_id: string; student_label: string;
      class_section_id: string | null; class_label: string | null; enrollment_revision: number | null;
    }>`WITH account_students AS (
        SELECT 'self'::text AS relationship,student.id,person.first_name,person.last_name
        FROM students student
        JOIN school_memberships membership ON membership.school_id=student.school_id
          AND membership.user_id=student.user_id AND membership.role='student' AND membership.is_active
        JOIN school_people person ON person.id=student.person_id AND person.school_id=student.school_id
        WHERE student.school_id=${input.school_id}::uuid AND student.user_id=${input.user_id}::uuid
        UNION
        SELECT 'dependent'::text,student.id,person.first_name,person.last_name
        FROM parents guardian
        JOIN guardian_school_profiles profile ON profile.guardian_id=guardian.id AND profile.school_id=${input.school_id}::uuid
        JOIN school_memberships membership ON membership.school_id=profile.school_id
          AND membership.user_id=guardian.user_id AND membership.role='guardian' AND membership.is_active
        JOIN guardian_relationships relationship ON relationship.guardian_id=guardian.id
        JOIN students student ON student.id=relationship.student_id AND student.school_id=profile.school_id
        JOIN school_people person ON person.id=student.person_id AND person.school_id=student.school_id
        WHERE guardian.user_id=${input.user_id}::uuid
      ), current_enrollment AS (
        SELECT DISTINCT ON(enrollment.student_id) enrollment.student_id,enrollment.class_section_id,
          enrollment.revision,section.grade||section.section AS class_label
        FROM enrollments enrollment
        JOIN academic_terms term ON term.id=enrollment.term_id
        JOIN class_sections section ON section.id=enrollment.class_section_id
          AND section.school_id=${input.school_id}::uuid
        JOIN schools school ON school.id=section.school_id
        WHERE enrollment.is_active AND enrollment.enrolled_on<=(${input.at}::timestamptz AT TIME ZONE school.timezone)::date
          AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>(${input.at}::timestamptz AT TIME ZONE school.timezone)::date)
          AND term.starts_on<=(${input.at}::timestamptz AT TIME ZONE school.timezone)::date
          AND term.ends_on>=(${input.at}::timestamptz AT TIME ZONE school.timezone)::date
        ORDER BY enrollment.student_id,enrollment.enrolled_on DESC,enrollment.id DESC
      )
      SELECT account.relationship,account.id::text AS student_id,
        btrim(account.first_name||' '||account.last_name) AS student_label,
        enrollment.class_section_id::text,enrollment.class_label,enrollment.revision AS enrollment_revision
      FROM account_students account
      LEFT JOIN current_enrollment enrollment ON enrollment.student_id=account.id
      ORDER BY account.relationship,student_label,account.id`.execute(transaction)).rows;
    return rows;
  }
}
