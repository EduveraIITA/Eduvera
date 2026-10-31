import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort, type PreparedDomainCommand } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import type { CampusDateDto } from "./campus-dates.contracts.js";
type Tx = Transaction<Database>;
@Injectable()
export class CampusDatesModel {
  constructor(@Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly gateway: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort) {}
  private key(user: AuthUser, key: string) { return `campus-dates:${user.id}:${key}`; }
  async prepare(tx: Tx, user: AuthUser, school: string, id: string, revision: number, action: string,
    input: { idempotency_key: string; expected_revision?: number }, authority: unknown) {
    const hash = createHash("sha256").update(JSON.stringify({ id, action, input })).digest("hex"), expected = input.expected_revision ?? 0;
    const previous = await this.receipts.readDomainCommandReceipt(tx, { school_id: school, actor_user_id: user.id, source_domain: "campus_dates",
      handler_key: "campus_dates.commands", handler_version: 1, idempotency_key: this.key(user, input.idempotency_key) });
    if (previous) {
      if (previous.command_type !== `campus_dates.${action}` || previous.target.domain_id !== id || previous.expected_revision !== expected || previous.safe_context.payload_hash !== hash)
        throw new ConflictException("This retry belongs to a different campus-date change.");
      if (previous.state === "pending") throw new ConflictException("This exact publication is awaiting confirmation. Retry the same action.");
      if (previous.receipt.terminal_state !== "accepted") throw new ConflictException("This change was not accepted. Review the current campus date.");
      return { replay: true as const, result: previous.receipt.metadata.result as CampusDateDto };
    }
    if (revision !== expected) throw new ConflictException("This campus date changed. Review its latest revision.");
    const prepared = await this.gateway.prepareDomainCommand(tx, { school_id: school, actor_user_id: user.id,
      command_type: `campus_dates.${action}`, handler_key: "campus_dates.commands", handler_version: 1, source_domain: "campus_dates",
      target: { kind: "campus_date", domain: "campus_dates", domain_id: id, label: "Campus date", lifecycle_state: "active", source_revision: Math.max(1, revision), metadata: {} },
      current_revision: revision, expected_revision: expected, capability: "calendar.manage", purpose: `campus_date_${action}`,
      requested_at: executionNow().toISOString(), correlation_id: input.idempotency_key, causation_id: null, idempotency_key: this.key(user, input.idempotency_key),
      operating_rule_version_ref: null, configuration_refs: [], authority_attestation: { evaluator_domain: "campus_dates", decision: "allowed",
        reason_codes: ["current_institution_calendar_publication_permission"], authority_source_refs: [authority], operating_rule_refs: [], valid_until: null }, safe_context: { payload_hash: hash, actor_user_id: user.id } });
    if (prepared.status !== "ready") throw new ConflictException("Check this exact publication before continuing.");
    return { replay: false as const, prepared };
  }
  async finish(tx: Tx, user: AuthUser, item: CampusDateDto, action: string, prepared: PreparedDomainCommand) {
    const at = executionNow().toISOString(), eventType = `campus_dates.${action}`;
    const members = await sql<{ user_id: string }>`SELECT DISTINCT membership.user_id FROM school_memberships membership JOIN users account ON account.id=membership.user_id
      WHERE membership.school_id=${item.school_id}::uuid AND membership.is_active AND account.is_active`.execute(tx);
    const outbox = await tx.insertInto("event_outbox").values({ school_id: item.school_id, event_type: eventType, aggregate_type: "campus_date", aggregate_id: item.id,
      audience_user_ids: members.rows.map(member => member.user_id), notification_user_ids: [], notification_payload: null, created_at: at, idempotency_key: `campus-date-event:${prepared.command_id}`,
      payload: { date_id: item.id, revision: item.revision, action, source_command_id: prepared.command_id, refresh: ["calendar"] } }).returning("id").executeTakeFirstOrThrow();
    await this.journal.recordAcceptedEvent(tx, { school_id: item.school_id, source_outbox_event_id: outbox.id, event_type: eventType,
      subject: { kind: "campus_date", domain: "campus_dates", domain_id: item.id, label: item.title, lifecycle_state: item.state === "cancelled" ? "retired" : "active", source_revision: item.revision, metadata: {} },
      context: null, actor_user_id: user.id, audience_user_ids: [], occurred_at: at, effective_from: at, effective_until: null,
      source_domain: "campus_dates", source_record_id: item.id, source_revision: item.revision, correlation_id: prepared.command_id, causation_event_id: null,
      idempotency_key: `campus-date-journal:${prepared.command_id}`, payload: { date_id: item.id, revision: item.revision, action, starts_on: item.starts_on, ends_on: item.ends_on } });
    await this.gateway.completeDomainCommand(tx, { school_id: item.school_id, command_id: prepared.command_id, terminal_state: "accepted", code: "campus_date_accepted",
      explanation: "The published informational campus date was saved. It does not change sessions, enrollment, attendance or payments.", resulting_revision: item.revision,
      domain_event_id: outbox.id, metadata: { result: item }, completed_at: at });
  }
}
