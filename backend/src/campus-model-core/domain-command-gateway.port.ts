import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { CampusModelEntitySnapshot } from "./contracts.js";

export const DOMAIN_COMMAND_GATEWAY_PORT = Symbol("DOMAIN_COMMAND_GATEWAY_PORT");

export type DomainCommandTerminalState =
  | "accepted"
  | "rejected"
  | "conflicted"
  | "review_required"
  | "failed"
  | "uncertain"
  | "cancelled"
  | "expired";

export interface PrepareDomainCommandInput {
  school_id: string;
  actor_user_id: string;
  command_type: string;
  handler_key: string;
  handler_version: number;
  source_domain: string;
  target: CampusModelEntitySnapshot;
  current_revision: number;
  expected_revision: number;
  capability: string;
  purpose: string;
  requested_at: string;
  correlation_id: string;
  causation_id: string | null;
  idempotency_key: string;
  operating_rule_version_ref: string | null;
  configuration_refs: Array<{ kind: string; ref: string; version: string }>;
  authority_attestation: {
    evaluator_domain: string;
    decision: "allowed" | "denied";
    reason_codes: string[];
    authority_source_refs: unknown[];
    operating_rule_refs: unknown[];
    valid_until: string | null;
  } | null;
  safe_context: Record<string, unknown>;
}

export interface PreparedDomainCommand {
  status: "ready";
  command_id: string;
  realm_id: string;
  environment_namespace_id: string;
  target_entity_id: string;
  actor_agent_id: string;
  authority_receipt_id: string;
  request_hash: string;
  replayed: boolean;
}

export interface ReplayedDomainCommand {
  status: "completed";
  command_id: string;
  terminal_state: DomainCommandTerminalState;
  code: string;
  explanation: string;
  resulting_revision: number | null;
  domain_event_id: string | null;
  metadata: Record<string, unknown>;
  replayed: true;
}

export type PrepareDomainCommandReceipt = PreparedDomainCommand | ReplayedDomainCommand;

export interface CompleteDomainCommandInput {
  school_id: string;
  command_id: string;
  terminal_state: DomainCommandTerminalState;
  code: string;
  explanation: string;
  resulting_revision: number | null;
  domain_event_id: string | null;
  metadata: Record<string, unknown>;
  completed_at: string;
}

export interface CompleteDomainCommandReceipt extends CompleteDomainCommandInput {
  outcome_id: number;
  replayed: boolean;
}

export interface DomainCommandGatewayPort {
  prepareDomainCommand(
    transaction: Transaction<Database>,
    input: PrepareDomainCommandInput,
  ): Promise<PrepareDomainCommandReceipt>;
  completeDomainCommand(
    transaction: Transaction<Database>,
    input: CompleteDomainCommandInput,
  ): Promise<CompleteDomainCommandReceipt>;
}
