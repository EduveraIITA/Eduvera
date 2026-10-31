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
import { COORDINATION_RUNTIME_PORT, } from "../campus-model-core/coordination-runtime.port.js";
import { GOVERNANCE_DECISION_AUTHORITY_PORT, } from "../governance/decision-authority.port.js";
/**
 * Departure & Transport owns duty changes and trip assignment invariants. This
 * adapter connects those accepted domain transitions to the behaviour-neutral
 * model runtime. It contains no recipient fallback or broad role audience.
 */
let TransportDutyModelBridgeService = class TransportDutyModelBridgeService {
    decisionAuthority;
    coordination;
    constructor(decisionAuthority, coordination) {
        this.decisionAuthority = decisionAuthority;
        this.coordination = coordination;
    }
    resolveDecisionOwner(transaction, schoolId, at) {
        return this.decisionAuthority.resolveDecisionOwner(transaction, schoolId, "transport_duty_change_decision", at);
    }
    assertDecisionAuthority(transaction, schoolId, userId, at) {
        return this.decisionAuthority.assertDecisionAuthority(transaction, schoolId, "transport_duty_change_decision", userId, at);
    }
    async trace(transaction, schoolId, changeId, eventType, sourceRevision) {
        const trace = await this.coordination.findExactTrace(transaction, {
            school_id: schoolId,
            source_domain: "departure_transport",
            source_record_id: changeId,
            event_type: eventType,
            source_revision: sourceRevision,
        });
        if (!trace)
            throw new ConflictException("The exact transport duty coordination request is unavailable or ambiguous.");
        return trace;
    }
    async publishRequested(transaction, input) {
        const receipt = await this.coordination.publishAcceptedEvent(transaction, {
            school_id: input.school_id,
            source_outbox_event_id: input.source_outbox_event_id,
            event_kind: "domain_event",
            event_type: "transport.duty_change.requested",
            subject: {
                kind: "transport_duty_change",
                domain: "departure_transport",
                domain_id: input.change.id,
                label: "Transport duty change",
                lifecycle_state: "active",
                source_revision: input.change.revision,
                metadata: {},
            },
            context: {
                kind: "transport_trip",
                domain: "departure_transport",
                domain_id: input.change.requester_trip_id,
                label: "Dated transport trip",
                lifecycle_state: "active",
                source_revision: input.requester_trip_revision,
                metadata: {},
            },
            actor_user_id: input.actor_user_id,
            occurred_at: input.occurred_at,
            effective_from: input.occurred_at,
            effective_until: null,
            source_domain: "departure_transport",
            source_record_id: input.change.id,
            source_revision: input.change.revision,
            correlation_id: input.correlation_id,
            causation_event_id: null,
            idempotency_key: `transport-duty-change-requested:${input.change.id}:${input.change.revision}`,
            // The private reason remains in the transport domain. The offer contains
            // only the minimum identifiers needed to open the authorized workflow.
            payload: {
                duty_change_id: input.change.id,
                request_type: input.change.request_type,
                requester_trip_id: input.change.requester_trip_id,
                target_trip_id: input.change.target_trip_id,
                status: input.change.status,
                revision: input.change.revision,
            },
            message: {
                subject: input.change.request_type === "exchange"
                    ? "Transport duty exchange offered"
                    : "Transport duty cover offered",
                summary: "A colleague has asked you to take part in a dated transport duty change.",
                payload: {
                    duty_change_id: input.change.id,
                    source_revision: input.change.revision,
                    action_path: `/areas/departure/operate?swap=${input.change.id}&swap_revision=${input.change.revision}`,
                },
            },
            selector_input: {
                selector_key: "transport_duty_target_colleague",
                recipient_agents: [{ agent_kind: "human", user_id: input.change.target_user_id }],
                scope: null,
            },
        });
        if (receipt.status !== "matched") {
            throw new ConflictException("This duty change could not be requested because colleague coordination is not fully configured.");
        }
        if (receipt.deliveries.length !== 1
            || receipt.deliveries[0]?.recipient.agent_kind !== "human"
            || receipt.deliveries[0].recipient.user_id !== input.change.target_user_id) {
            throw new ConflictException("The configured colleague offer recipient is ambiguous.");
        }
        return receipt;
    }
    recordTargetResponse(transaction, input) {
        if (input.actor_user_id !== input.change.target_user_id) {
            throw new ConflictException("Only the colleague assigned this offer can respond.");
        }
        return this.coordination.recordRecipientResponse(transaction, {
            school_id: input.school_id,
            message_id: input.message_id,
            correlation_id: input.correlation_id,
            recipient: { agent_kind: "human", user_id: input.change.target_user_id },
            actor: { agent_kind: "human", user_id: input.actor_user_id },
            expected_source_record_id: input.change.id,
            expected_source_revision: input.source_revision,
            source_outbox_event_id: input.source_outbox_event_id,
            code: input.decision === "accepted"
                ? "transport_duty_offer_accepted"
                : "transport_duty_offer_rejected",
            explanation: input.decision === "accepted"
                ? "The specifically invited colleague accepted the transport duty offer."
                : "The specifically invited colleague rejected the transport duty offer.",
            response: {
                duty_change_id: input.change.id,
                decision: input.decision,
                resulting_revision: input.change.revision,
            },
            occurred_at: input.occurred_at,
            idempotency_key: `transport-duty-target-response:${input.change.id}:${input.message_id}:${input.actor_user_id}:${input.command_id}`,
        });
    }
    async publishAccepted(transaction, input) {
        const receipt = await this.coordination.publishAcceptedEvent(transaction, {
            school_id: input.school_id,
            source_outbox_event_id: input.source_outbox_event_id,
            event_kind: "domain_event",
            event_type: "transport.duty_change.accepted",
            subject: {
                kind: "transport_duty_change",
                domain: "departure_transport",
                domain_id: input.change.id,
                label: "Transport duty change",
                lifecycle_state: "active",
                source_revision: input.change.revision,
                metadata: {},
            },
            context: null,
            actor_user_id: input.actor_user_id,
            occurred_at: input.occurred_at,
            effective_from: input.occurred_at,
            effective_until: null,
            source_domain: "departure_transport",
            source_record_id: input.change.id,
            source_revision: input.change.revision,
            correlation_id: input.correlation_id,
            causation_event_id: input.causation_event_id,
            idempotency_key: `transport-duty-change-accepted:${input.change.id}:${input.change.revision}`,
            payload: {
                duty_change_id: input.change.id,
                request_type: input.change.request_type,
                requester_trip_id: input.change.requester_trip_id,
                target_trip_id: input.change.target_trip_id,
                status: input.change.status,
                revision: input.change.revision,
            },
            message: {
                subject: "Review transport duty change",
                summary: "The invited colleague accepted. The configured owner must decide before responsibility changes.",
                payload: {
                    duty_change_id: input.change.id,
                    source_revision: input.change.revision,
                    action_path: `/areas/departure/manage?section=roster&swap=${input.change.id}&swap_revision=${input.change.revision}`,
                },
            },
            selector_input: {
                selector_key: "transport_duty_change_decision_owner",
                recipient_agents: [{ agent_kind: "human", user_id: input.decision_owner.user_id }],
                scope: null,
            },
        });
        if (receipt.status !== "matched") {
            throw new ConflictException("The accepted duty change could not be routed because its decision route is not fully configured.");
        }
        if (receipt.deliveries.length !== 1
            || receipt.deliveries[0]?.recipient.agent_kind !== "human"
            || receipt.deliveries[0].recipient.user_id !== input.decision_owner.user_id) {
            throw new ConflictException("The configured transport decision recipient is ambiguous.");
        }
        return receipt;
    }
    recordDecisionResponse(transaction, input) {
        if (input.authority.user_id !== input.actor_user_id) {
            throw new ConflictException("The decision authority receipt does not identify this actor.");
        }
        return this.coordination.recordRecipientResponse(transaction, {
            school_id: input.school_id,
            message_id: input.message_id,
            correlation_id: input.correlation_id,
            recipient: { agent_kind: "human", user_id: input.authority.user_id },
            actor: { agent_kind: "human", user_id: input.actor_user_id },
            expected_source_record_id: input.change.id,
            expected_source_revision: input.source_revision,
            source_outbox_event_id: input.source_outbox_event_id,
            code: input.decision === "approved"
                ? "transport_duty_change_approved"
                : "transport_duty_change_declined",
            explanation: input.decision === "approved"
                ? "The current configured decision owner approved the transport duty change."
                : "The current configured decision owner declined the transport duty change.",
            response: {
                duty_change_id: input.change.id,
                decision: input.decision,
                resulting_revision: input.change.revision,
            },
            occurred_at: input.occurred_at,
            idempotency_key: `transport-duty-decision-response:${input.change.id}:${input.message_id}:${input.actor_user_id}:${input.command_id}`,
        });
    }
};
TransportDutyModelBridgeService = __decorate([
    Injectable(),
    __param(0, Inject(GOVERNANCE_DECISION_AUTHORITY_PORT)),
    __param(1, Inject(COORDINATION_RUNTIME_PORT)),
    __metadata("design:paramtypes", [Object, Object])
], TransportDutyModelBridgeService);
export { TransportDutyModelBridgeService };
//# sourceMappingURL=transport-duty-model-bridge.service.js.map