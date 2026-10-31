import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { ExecutionEnvironment } from "./execution-environment.contracts.js";

export const RESPONSIBILITY_PROJECTION_PORT = Symbol("RESPONSIBILITY_PROJECTION_PORT");

export interface EffectiveResponsibilityRecord {
  id: string; owner_agent_id: string; capability_key: string; action_key: string;
  scope_kind: string; scope_domain: string; scope_domain_id: string; scope_label: string;
  effective_from: Date | string; effective_until: Date | string | null; effective_schedule: unknown;
  authority_source_kind: string; authority_source_ref: string; fallback_agent_id: string | null;
  source_domain: string; source_record_id: string; source_revision: number; revision: number;
}

export interface OwnedOperationalMessageRecord {
  id: string; message_kind: "request" | "task" | "offer";
  state: "queued" | "delivered" | "acknowledged"; subject: string; summary: string;
  payload: unknown; reaction_kind: string; source_domain: string;
  response_due_at: Date | string | null; expires_at: Date | string | null;
  queued_at: Date | string; updated_at: Date | string;
}

export interface EffectiveAgentWorkProjection {
  realm_id: string; environment_namespace_id: string;
  acting_agent_id: string | null; owner_agent_ids: string[];
  assignments: EffectiveResponsibilityRecord[]; messages: OwnedOperationalMessageRecord[];
}

/** Read-only, environment-qualified facts. Application/domain composition and
 * actions remain with their owning modules; this port grants no authority.
 */
export interface ResponsibilityProjectionPort {
  listPlanningTeams(transaction: Transaction<Database>, input: { school_id: string; at: string }): Promise<Array<{ id: string; label: string }>>;
  listPlanningTeamPeople(transaction: Transaction<Database>, input: { school_id: string; team_id: string; at: string }): Promise<Array<{ person_id: string; source_ref: string; source_revision: number }>>;
  snapshotPlanningTeamPeople(transaction: Transaction<Database>, input: { school_id: string; team_id: string; from: string; until: string | null }): Promise<Array<{
    person_id: string; source_ref: string; source_revision: number; effective_from: string; effective_until: string | null;
  }>>;
  /** Complete permitted unresolved mailbox, not a silently capped head. The
   * application paginates this read; a future paged port must retain full counts. */
  loadEffectiveAgentWork(transaction: Transaction<Database>, input: {
    user_id: string; school_id: string; at: Date;
    execution_environment: ExecutionEnvironment | null;
  }): Promise<EffectiveAgentWorkProjection>;
}
