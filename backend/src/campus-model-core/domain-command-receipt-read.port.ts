import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { ReplayedDomainCommand } from "./domain-command-gateway.port.js";

export const DOMAIN_COMMAND_RECEIPT_READ_PORT = Symbol("DOMAIN_COMMAND_RECEIPT_READ_PORT");

export interface DomainCommandReceiptReadInput {
  school_id: string;
  actor_user_id: string;
  source_domain: string;
  handler_key: string;
  handler_version: number;
  idempotency_key: string;
}

type RetainedDomainCommand = {
  command_type: string;
  actor_agent_id: string;
  target: { kind: string; domain: string; domain_id: string };
  expected_revision: number;
  safe_context: Record<string, unknown>;
};
export type DomainCommandReceiptRead = RetainedDomainCommand & (
  | { state: "pending"; receipt: null }
  | { state: "completed"; receipt: ReplayedDomainCommand }
);

/** Replay discovery only, not authorization or a command writer. The owning
 * domain must recheck current authority and compare its exact payload commitment,
 * source and action before returning a completed outcome. A pending receipt never
 * permits repeating native effects. The lookup is actor/handler/world qualified
 * and serialized with the same gateway command key.
 */
export interface DomainCommandReceiptReadPort {
  readDomainCommandReceipt(transaction: Transaction<Database>, input: DomainCommandReceiptReadInput): Promise<DomainCommandReceiptRead | null>;
}
