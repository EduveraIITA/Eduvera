var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { DOMAIN_COMMAND_GATEWAY_PORT } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT } from "../campus-model-core/domain-event-journal.port.js";
import { HUMAN_AGENT_IDENTITY_PORT } from "../campus-model-core/human-agent-identity.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { prepareAttachmentBatch, registerCreatedPerson } from "../people/person-attachment.js";
/** Compatibility account-coupled writers still register every new People identity.
 * The common People UI uses passive creation and explicit account invitations instead.
 */
let LegacyPeopleModelService = class LegacyPeopleModelService {
    gateway;
    journal;
    identity;
    constructor(gateway, journal, identity) {
        this.gateway = gateway;
        this.journal = journal;
        this.identity = identity;
    }
    async prepare(tx, input) {
        const correlationId = randomUUID();
        const prepared = await prepareAttachmentBatch(tx, { gateway: this.gateway, journal: this.journal, identity: this.identity }, {
            school_id: input.schoolId, actor_id: input.actorId, target_id: input.targetId, target_kind: input.kind,
            label: input.label, revision: input.currentRevision, command_type: input.operation, source_domain: "people",
            key: `legacy-people:${correlationId}`, correlation_id: correlationId,
            request_hash: createHash("sha256").update(JSON.stringify(input.payload)).digest("hex"), permission: "sis.manage",
        });
        return { prepared, correlationId, schoolId: input.schoolId, actorId: input.actorId };
    }
    async complete(tx, receipt, people, sourceEventKey) {
        const event = await tx.selectFrom("event_outbox").select("id").where("school_id", "=", receipt.schoolId)
            .where("idempotency_key", "=", sourceEventKey).executeTakeFirst();
        if (!event)
            throw new ConflictException("The owning people event was not retained. No person was created.");
        const unique = [...new Map(people.map(person => [person.id, person])).values()];
        let firstEvent = null, lastEvent = null;
        for (const person of unique) {
            const accepted = await registerCreatedPerson(tx, { gateway: this.gateway, journal: this.journal, identity: this.identity }, {
                school_id: receipt.schoolId, actor_id: receipt.actorId, person, correlation_id: receipt.correlationId,
                command_id: receipt.prepared.command_id, key: `legacy-person:${receipt.correlationId}:${person.id}`, account_created: true,
            });
            firstEvent ??= accepted.event_id;
            lastEvent = accepted.event_id;
        }
        await this.gateway.completeDomainCommand(tx, { school_id: receipt.schoolId, command_id: receipt.prepared.command_id,
            terminal_state: "accepted", code: "legacy_people_identity_registered",
            explanation: "The compatibility operation completed and its new campus people were registered in the Digital Twin.",
            resulting_revision: 1, domain_event_id: event.id,
            metadata: { registered_person_count: unique.length, first_model_event_id: firstEvent, last_model_event_id: lastEvent,
                compatibility_account_control: true }, completed_at: executionNow().toISOString() });
    }
};
LegacyPeopleModelService = __decorate([
    Injectable(),
    __param(0, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(1, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __param(2, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __metadata("design:paramtypes", [Object, Object, Object])
], LegacyPeopleModelService);
export { LegacyPeopleModelService };
//# sourceMappingURL=legacy-people-model.service.js.map