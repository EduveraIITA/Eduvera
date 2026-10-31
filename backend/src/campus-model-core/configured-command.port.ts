import { z } from "zod";
import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { AcceptedDomainEvent } from "./contracts.js";
import type { PrepareDomainCommandInput, PrepareDomainCommandReceipt } from "./domain-command-gateway.port.js";
import type { DomainEventJournalReceipt } from "./domain-event-journal.port.js";

export const CONFIGURED_COMMAND_PORT = Symbol("CONFIGURED_COMMAND_PORT");
export const configuredSoftwareActorSchema = z.object({
  school_id: z.string().uuid(), approved_by_user_id: z.string().uuid(),
  source_domain: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), source_record_id: z.string().min(1).max(160),
  source_revision: z.number().int().positive(), configuration_hash: z.string().regex(/^(?:sha256:)?[0-9a-f]{64}$/),
  operating_rule_ref: z.string().min(1).max(240), allowed_commands: z.array(z.string().min(3).max(120)).min(1).max(30),
  approved_at: z.string().datetime({ offset: true }), effective_from: z.string().datetime({ offset: true }),
  label: z.string().trim().min(1).max(200),
}).strict().superRefine((value, context) => {
  if (new Set(value.allowed_commands).size !== value.allowed_commands.length
    || value.allowed_commands.some((command) => !command.startsWith(`${value.source_domain}.`))) {
    context.addIssue({ code: "custom", path: ["allowed_commands"], message: "Configured commands must be unique and belong to the approving domain." });
  }
});
export type ConfiguredSoftwareActorInput = z.infer<typeof configuredSoftwareActorSchema>;
export type PrepareSoftwareDomainCommandInput = Omit<PrepareDomainCommandInput, "actor_user_id"> & {
  actor_agent_id: string; behaviour_version_id: string;
};
export type SoftwareDomainEvent = Omit<AcceptedDomainEvent, "actor_user_id"> & {
  actor_agent_id: string; behaviour_version_id: string;
};
/** Approved owning-domain policy supplies behavior. Core supplies execution only. */
export interface ConfiguredCommandPort {
  /** Historical classification only; this never grants current authority or activates an actor. */
  listRecordedSoftwareActors(tx: Transaction<Database>, input: { school_id: string; agent_ids: string[] }): Promise<Array<{ agent_id: string }>>;
  configureSoftwareActor(tx: Transaction<Database>, input: ConfiguredSoftwareActorInput): Promise<{ agent_id: string; behaviour_version_id: string }>;
  prepareSoftwareCommand(tx: Transaction<Database>, input: PrepareSoftwareDomainCommandInput): Promise<PrepareDomainCommandReceipt>;
  recordSoftwareEvent(tx: Transaction<Database>, input: SoftwareDomainEvent): Promise<DomainEventJournalReceipt>;
}
