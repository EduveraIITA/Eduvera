import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";

export const AUTHORITY_EVALUATION_PORT = Symbol("AUTHORITY_EVALUATION_PORT");

export interface AuthorityEvaluationInput {
  school_id: string;
  actor_agent_id: string;
  capability: string;
  purpose: string;
  scope_entity_id: string | null;
  evaluated_at: string;
  correlation_id: string;
  causation_id: string | null;
  idempotency_key: string;
}

export interface AuthorityEvaluationReceipt {
  receipt_id: string;
  realm_id: string;
  environment_namespace_id: string;
  actor_agent_id: string;
  capability: string;
  purpose: string;
  scope_entity_id: string | null;
  decision: "allowed" | "denied";
  reason_codes: string[];
  authority_source_refs: unknown[];
  operating_rule_refs: unknown[];
  evaluated_at: string | Date;
  valid_until: string | Date | null;
  replayed: boolean;
}

export interface AuthorityEvaluationPort {
  evaluateAuthority(
    transaction: Transaction<Database>,
    input: AuthorityEvaluationInput,
  ): Promise<AuthorityEvaluationReceipt>;
}
