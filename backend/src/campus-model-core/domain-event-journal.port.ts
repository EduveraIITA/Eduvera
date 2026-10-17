import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { AcceptedDomainEvent } from "./contracts.js";

export const DOMAIN_EVENT_JOURNAL_PORT = Symbol("DOMAIN_EVENT_JOURNAL_PORT");

export interface DomainEventJournalReceipt {
  event_id: string;
  actor_agent_id: string;
  audience_agent_ids: string[];
  replayed: boolean;
}

export interface DomainEventJournalPort {
  recordAcceptedEvent(
    transaction: Transaction<Database>,
    input: AcceptedDomainEvent,
  ): Promise<DomainEventJournalReceipt>;
}
