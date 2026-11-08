import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import type { Database } from "../database/types.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";

export type CatalogueSaved = Record<string, unknown> & { id: string; school_id: string; revision: number };
export type CatalogueKind = "terms" | "classes" | "subjects";
export type CatalogueCommand = { command_id: string; catalog_id: string; expected_revision: number };
const handler = "academic.catalogue", domain = "academic_catalogue";
const key = (actor: string, command: string) => `academic-catalogue:${actor}:${command}`;
/** Field order is normalized by the owning catalogue schemas before hashing. */
export const cataloguePayloadHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const saved = z.object({ id: z.uuid(), school_id: z.uuid(), revision: z.number().int().positive() }).catchall(z.unknown());
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Exact action receipts, never a comparison against a similarly named saved row. */
@Injectable()
export class AcademicCatalogueModelService {
  constructor(@Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identity: HumanAgentIdentityPort) {}

  private async receipt(tx: Transaction<Database>, user: AuthUser, schoolId: string, kind: CatalogueKind, id: string, commandId: string) {
    const actor = await this.identity.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException("Current campus account access is required.");
    const prior = await this.receipts.readDomainCommandReceipt(tx, { school_id: schoolId, actor_user_id: user.id,
      source_domain: domain, handler_key: handler, handler_version: 1, idempotency_key: key(user.id, commandId) });
    if (prior && (prior.actor_agent_id !== actor.agent_id || prior.target.kind !== "academic_catalogue_record"
      || prior.target.domain !== domain || prior.target.domain_id !== id || prior.safe_context.catalog_kind !== kind
      || !["academic.catalogue.created", "academic.catalogue.updated"].includes(prior.command_type)))
      throw new ConflictException("This receipt belongs to a different academic catalogue action.");
    return prior;
  }

  async prepare(tx: Transaction<Database>, user: AuthUser, schoolId: string, kind: CatalogueKind, command: CatalogueCommand,
    currentRevision: number, payload: unknown) {
    const prior = await this.receipt(tx, user, schoolId, kind, command.catalog_id, command.command_id);
    const payloadHash = cataloguePayloadHash(payload);
    if (prior) {
      if (prior.safe_context.payload_hash !== payloadHash || prior.expected_revision !== command.expected_revision)
        throw new ConflictException("This command was already used with different catalogue details.");
      if (prior.state === "pending") throw new ConflictException("This exact catalogue action is still awaiting confirmation.");
      if (prior.receipt.terminal_state !== "accepted") throw new ConflictException("This catalogue action was not accepted.");
      const result = saved.parse(prior.receipt.metadata.result);
      if (result.id !== command.catalog_id || result.school_id !== schoolId || result.revision !== command.expected_revision + 1)
        throw new ConflictException("The retained catalogue receipt does not match this action.");
      return { replay: result };
    }
    if (currentRevision !== command.expected_revision) throw new ConflictException({
      code: "catalogue_revision_obsolete", message: "This academic record changed. Review its current details before saving.",
      fields: { catalogue_obsolete: { confirmation: "permanently_inapplicable", receipt_state: "absent", handler,
        source_id: command.catalog_id, command_id: command.command_id, expected_revision: command.expected_revision,
        current_revision: currentRevision } },
    });
    const prepared = await this.commands.prepareDomainCommand(tx, { school_id: schoolId, actor_user_id: user.id,
      source_domain: domain, command_type: `academic.catalogue.${command.expected_revision === 0 ? "created" : "updated"}`,
      handler_key: handler, handler_version: 1,
      target: { kind: "academic_catalogue_record", domain, domain_id: command.catalog_id, label: "Academic catalogue record",
        source_revision: Math.max(1, currentRevision), lifecycle_state: "active", metadata: { catalog_kind: kind } },
      current_revision: currentRevision, expected_revision: command.expected_revision, capability: "sis.manage",
      purpose: "academic_catalogue_change", requested_at: executionNow().toISOString(), correlation_id: command.command_id,
      causation_id: null, idempotency_key: key(user.id, command.command_id), operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: domain, decision: "allowed", reason_codes: ["current_sis_manage_authority"],
        authority_source_refs: [{ school_id: schoolId, user_id: user.id }], operating_rule_refs: [], valid_until: null },
      safe_context: { catalog_kind: kind, payload_hash: payloadHash } });
    if (prepared.status !== "ready") throw new ConflictException("Confirm the retained catalogue action before continuing.");
    return { command: prepared.command_id };
  }

  async complete(tx: Transaction<Database>, user: AuthUser, schoolId: string, kind: CatalogueKind, commandId: string,
    result: Record<string, unknown>, correlationId: string) {
    const id = String(result.id), revision = Number(result.revision), action = revision === 1 ? "created" : "updated";
    const outbox = await tx.selectFrom("event_outbox").select("id").where("school_id", "=", schoolId)
      .where("idempotency_key", "=", `administration:${kind}:${id}:${revision}:${action}`).executeTakeFirst();
    if (!outbox) throw new ConflictException("The catalogue update evidence was not retained. Nothing was saved.");
    await this.journal.recordAcceptedEvent(tx, { school_id: schoolId, source_outbox_event_id: outbox.id,
      event_type: "administration.updated",
      subject: { kind: "academic_catalogue_record", domain, domain_id: id, label: "Academic catalogue record", source_revision: revision,
        lifecycle_state: "active", metadata: { catalog_kind: kind } }, context: null, actor_user_id: user.id,
      occurred_at: executionNow().toISOString(), effective_from: executionNow().toISOString(), effective_until: null,
      source_domain: domain, source_record_id: id, source_revision: revision, correlation_id: correlationId, causation_event_id: null,
      idempotency_key: `academic-catalogue-event:${commandId}`, audience_user_ids: [user.id], payload: { catalog_kind: kind, revision, source_command_id: commandId } });
    await this.commands.completeDomainCommand(tx, { school_id: schoolId, command_id: commandId, terminal_state: "accepted",
      code: "academic_catalogue_saved", explanation: "The exact reviewed catalogue change was saved.", resulting_revision: revision,
      domain_event_id: outbox.id, metadata: { result: json(result) }, completed_at: executionNow().toISOString() });
  }

  async confirmation(tx: Transaction<Database>, user: AuthUser, schoolId: string, kind: CatalogueKind, id: string, commandId: string) {
    const prior = await this.receipt(tx, user, schoolId, kind, id, commandId);
    if (!prior) throw new NotFoundException("No receipt for this exact catalogue action is available.");
    if (prior.state === "pending" || prior.receipt.terminal_state !== "accepted")
      throw new ConflictException("This exact catalogue action has not been confirmed as saved.");
    return { handler, school_id: schoolId, kind, source_id: id, command_id: commandId, state: "accepted" as const,
      expected_revision: prior.expected_revision, result: saved.parse(prior.receipt.metadata.result) };
  }
}
