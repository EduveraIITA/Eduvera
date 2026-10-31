import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import {
  DOMAIN_EVENT_JOURNAL_PORT,
  type DomainEventJournalPort,
  type DomainEventJournalReceipt,
} from "../campus-model-core/domain-event-journal.port.js";
import type { Database } from "../database/types.js";

export type ChatModelEventType =
  | "communication.conversation.created"
  | "communication.message.sent"
  | "communication.message.edited"
  | "communication.conversation.read";

export interface ChatModelEventInput {
  school_id: string;
  actor_user_id: string;
  audience_user_ids: string[];
  event_type: ChatModelEventType;
  source_record_id: string;
  conversation_id: string;
  occurred_at: string;
  correlation_id: string;
  idempotency_key: string;
  subject_kind: "conversation" | "communication_message";
  subject_label: string;
  payload: Record<string, unknown>;
}

/** Messaging owns content and delivery. This adapter exposes only typed,
 * privacy-safe accepted facts to the Model Core and maps every participant to
 * their stable human agent. It never interprets prose as a command. */
@Injectable()
export class ChatModelBridgeService {
  constructor(
    @Inject(DOMAIN_EVENT_JOURNAL_PORT)
    private readonly journal: DomainEventJournalPort,
  ) {}

  async record(
    transaction: Transaction<Database>,
    input: ChatModelEventInput,
  ): Promise<DomainEventJournalReceipt> {
    const audience = [...new Set(input.audience_user_ids)].filter((id) => id !== input.actor_user_id);
    const outbox = (await sql<{ id: string }>`INSERT INTO event_outbox(
        school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key
      ) VALUES (
        ${input.school_id}::uuid,${input.event_type},${input.subject_kind},${input.source_record_id}::uuid,
        ${[input.actor_user_id, ...audience]}::uuid[],
        ${JSON.stringify({
          conversation_id: input.conversation_id,
          change_kind: input.event_type.split(".").at(-1),
          refresh: ["messages", "notifications", "attention"],
        })}::jsonb,
        ${`model:${input.idempotency_key}`}
      ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`.execute(transaction)).rows[0]
      ?? (await sql<{ id: string }>`SELECT id FROM event_outbox
        WHERE school_id=${input.school_id}::uuid AND idempotency_key=${`model:${input.idempotency_key}`}
        FOR UPDATE`.execute(transaction)).rows[0];
    if (!outbox) throw new Error("The communication event could not be retained.");

    return this.journal.recordAcceptedEvent(transaction, {
      school_id: input.school_id,
      source_outbox_event_id: outbox.id,
      event_type: input.event_type,
      subject: {
        kind: input.subject_kind,
        domain: "communication",
        domain_id: input.source_record_id,
        label: input.subject_label,
        lifecycle_state: "active",
        source_revision: 1,
        metadata: {},
      },
      context: input.subject_kind === "communication_message" ? {
        kind: "conversation",
        domain: "communication",
        domain_id: input.conversation_id,
        label: "School conversation",
        lifecycle_state: "active",
        source_revision: 1,
        metadata: {},
      } : null,
      actor_user_id: input.actor_user_id,
      audience_user_ids: audience,
      occurred_at: input.occurred_at,
      effective_from: input.occurred_at,
      effective_until: null,
      source_domain: "communication",
      source_record_id: input.source_record_id,
      source_revision: 1,
      correlation_id: input.correlation_id,
      causation_event_id: null,
      idempotency_key: input.idempotency_key,
      payload: input.payload,
    });
  }
}
