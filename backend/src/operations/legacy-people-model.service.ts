import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../database/types.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort, type PreparedDomainCommand } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { prepareAttachmentBatch, registerCreatedPerson } from "../people/person-attachment.js";

type CreationReceipt = { prepared: PreparedDomainCommand; correlationId: string; schoolId: string; actorId: string };
type CreatedPerson = { id: string; first_name: string; last_name: string };

/** Compatibility account-coupled writers still register every new People identity.
 * The common People UI uses passive creation and explicit account invitations instead.
 */
@Injectable()
export class LegacyPeopleModelService {
  constructor(@Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly gateway: DomainCommandGatewayPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identity: HumanAgentIdentityPort) {}

  async prepare(tx: Transaction<Database>, input: { schoolId: string; actorId: string; kind: "student" | "people_import";
    targetId: string; label: string; currentRevision: number; operation: string; payload: unknown }): Promise<CreationReceipt> {
    const correlationId = randomUUID();
    const prepared = await prepareAttachmentBatch(tx, { gateway: this.gateway, journal: this.journal, identity: this.identity }, {
      school_id: input.schoolId, actor_id: input.actorId, target_id: input.targetId, target_kind: input.kind,
      label: input.label, revision: input.currentRevision, command_type: input.operation, source_domain: "people",
      key: `legacy-people:${correlationId}`, correlation_id: correlationId,
      request_hash: createHash("sha256").update(JSON.stringify(input.payload)).digest("hex"), permission: "sis.manage",
    });
    return { prepared, correlationId, schoolId: input.schoolId, actorId: input.actorId };
  }

  async complete(tx: Transaction<Database>, receipt: CreationReceipt, people: readonly CreatedPerson[], sourceEventKey: string) {
    const event = await tx.selectFrom("event_outbox").select("id").where("school_id", "=", receipt.schoolId)
      .where("idempotency_key", "=", sourceEventKey).executeTakeFirst();
    if (!event) throw new ConflictException("The owning people event was not retained. No person was created.");
    const unique = [...new Map(people.map(person => [person.id, person])).values()];
    let firstEvent: string | null = null, lastEvent: string | null = null;
    for (const person of unique) {
      const accepted = await registerCreatedPerson(tx, { gateway: this.gateway, journal: this.journal, identity: this.identity }, {
        school_id: receipt.schoolId, actor_id: receipt.actorId, person, correlation_id: receipt.correlationId,
        command_id: receipt.prepared.command_id, key: `legacy-person:${receipt.correlationId}:${person.id}`, account_created: true,
      });
      firstEvent ??= accepted.event_id; lastEvent = accepted.event_id;
    }
    await this.gateway.completeDomainCommand(tx, { school_id: receipt.schoolId, command_id: receipt.prepared.command_id,
      terminal_state: "accepted", code: "legacy_people_identity_registered",
      explanation: "The compatibility operation completed and its new campus people were registered in the Digital Twin.",
      resulting_revision: 1, domain_event_id: event.id,
      metadata: { registered_person_count: unique.length, first_model_event_id: firstEvent, last_model_event_id: lastEvent,
        compatibility_account_control: true }, completed_at: executionNow().toISOString() });
  }
}
