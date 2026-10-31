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
import { matchesLeaveReviewRouteBasis } from "./staff-leave-review-routing.contracts.js";
/**
 * Staff Operations owns leave state. This adapter only connects that state to
 * the provider-neutral Campus Model coordination contracts inside the owning
 * domain transaction. It intentionally contains no recipient or fallback
 * default: governance and the approved behaviour configuration must both agree.
 */
let StaffLeaveModelBridgeService = class StaffLeaveModelBridgeService {
    decisionAuthority;
    coordination;
    constructor(decisionAuthority, coordination) {
        this.decisionAuthority = decisionAuthority;
        this.coordination = coordination;
    }
    resolveDecisionOwner(transaction, schoolId, at) {
        return this.decisionAuthority.resolveDecisionOwner(transaction, schoolId, "staff_leave_decision", at);
    }
    assertDecisionAuthority(transaction, schoolId, userId, at) {
        return this.decisionAuthority.assertDecisionAuthority(transaction, schoolId, "staff_leave_decision", userId, at);
    }
    async deliveryReady(transaction, schoolId, owner, at) {
        const route = await this.coordination.resolveEventRoute(transaction, { school_id: schoolId, source_domain: "staff_operations",
            event_type: "staff.leave.submitted", selector_key: "leave_decision_owner", occurred_at: at });
        if (route.status !== "matched" || route.message_kind !== "request" || route.message_schema_version !== 1
            || route.response_due_after_seconds !== null || route.expires_after_seconds !== null || route.reaction_kind !== "staff_leave_decision_review"
            || route.selector.required_capability !== "staff_leave:decide" || route.selector.scope_mode !== "institution"
            || route.selector.min_recipients !== 1 || route.selector.max_recipients !== 1)
            return false;
        const config = route.behaviour_configuration;
        if (!config || config.workflow !== "staff_leave_decision_review" || config.reviewer_user_id !== owner.user_id
            || config.reviewer_person_id !== owner.person.id || !matchesLeaveReviewRouteBasis(config.authority_basis, owner))
            return false;
        const recipients = await this.coordination.authorizeCandidateRecipients(transaction, { school_id: schoolId,
            behaviour_version_id: route.behaviour_version_id, subscription_id: route.subscription_id, occurred_at: at,
            recipients: [{ agent_kind: "human", user_id: owner.user_id }], scope: null });
        return recipients.authorised.length === 1 && recipients.unresolved.length === 0 && recipients.unauthorized.length === 0;
    }
    async supersedeReview(transaction, input) {
        const trace = await this.coordination.findExactTrace(transaction, { school_id: input.school_id, source_domain: "staff_operations",
            source_record_id: input.request_id, event_type: "staff.leave.submitted", source_revision: input.previous_revision,
            message_id: input.previous_message_id });
        if (!trace || trace.event_id !== input.previous_event_id || trace.message_id !== input.previous_message_id
            || trace.correlation_id !== input.correlation_id || !trace.message_state)
            throw new ConflictException("The exact previous leave-review handoff is unavailable.");
        if (["cancelled", "responded", "expired", "dead_letter"].includes(trace.message_state))
            return null;
        return this.coordination.supersedeDomainMessage(transaction, { school_id: input.school_id, command_id: input.command_id,
            message_id: input.previous_message_id, previous_event_id: input.previous_event_id, resulting_event_id: input.resulting_event_id,
            required_capability: input.capability, occurred_at: input.occurred_at,
            idempotency_key: `staff-leave-supersede:${input.command_id}:${input.previous_message_id}` });
    }
    async publishSubmitted(transaction, input) {
        if (!await this.deliveryReady(transaction, input.school_id, input.decision_owner, input.occurred_at)) {
            throw new ConflictException("The current leave reviewer must confirm delivery of review requests before this request can be submitted.");
        }
        const receipt = await this.coordination.publishAcceptedEvent(transaction, {
            school_id: input.school_id,
            source_outbox_event_id: input.source_outbox_event_id,
            event_kind: "domain_event",
            event_type: "staff.leave.submitted",
            subject: {
                kind: "staff_leave_request",
                domain: "staff_operations",
                domain_id: input.request.id,
                label: "Staff leave request",
                lifecycle_state: "active",
                source_revision: input.request.revision,
                metadata: {},
            },
            context: {
                kind: "staff_profile",
                domain: "staff_operations",
                domain_id: input.request.staff_profile_id,
                label: "Staff member",
                lifecycle_state: "active",
                source_revision: input.request.staff_profile_revision,
                metadata: {},
            },
            actor_user_id: input.actor_user_id,
            occurred_at: input.occurred_at,
            effective_from: input.occurred_at,
            effective_until: null,
            source_domain: "staff_operations",
            source_record_id: input.request.id,
            source_revision: input.request.revision,
            correlation_id: input.reroute?.correlation_id ?? input.command_id,
            causation_event_id: input.reroute?.previous_event_id ?? null,
            idempotency_key: `staff-leave-submitted:${input.request.id}:${input.request.revision}`,
            // Deliberately omit the private reason and handover note. The assigned
            // owner reads those only through the authorized Staff Operations API.
            payload: {
                request_id: input.request.id,
                staff_profile_id: input.request.staff_profile_id,
                policy_id: input.request.policy_id,
                starts_on: input.request.starts_on,
                ends_on: input.request.ends_on,
                portion: input.request.portion,
                requested_days: input.request.requested_days,
                status: input.request.status,
                revision: input.request.revision,
                ...(input.reroute ? { action: "review_rerouted", source_command_id: input.reroute.source_command_id,
                    previous_message_id: input.reroute.previous_message_id } : {}),
            },
            message: {
                subject: "Review staff leave request",
                summary: "A submitted staff leave request requires your authorized decision.",
                payload: {
                    request_id: input.request.id,
                    source_revision: input.request.revision,
                    action_path: `/work/staff-leave?school=${input.school_id}&request=${input.request.id}&request_revision=${input.request.revision}`,
                },
            },
            selector_input: {
                selector_key: "leave_decision_owner",
                recipient_agents: [{
                        agent_kind: "human",
                        user_id: input.decision_owner.user_id,
                    }],
                scope: null,
            },
        });
        if (receipt.status !== "matched") {
            throw new ConflictException("Staff leave could not be submitted because its decision route is not fully configured.");
        }
        if (receipt.deliveries.length !== 1
            || receipt.deliveries[0]?.recipient.agent_kind !== "human"
            || receipt.deliveries[0].recipient.user_id !== input.decision_owner.user_id) {
            throw new ConflictException("Staff leave could not be submitted because its configured decision recipient is ambiguous.");
        }
        return receipt;
    }
    recordDecisionResponse(transaction, input) {
        if (input.decision_authority.user_id !== input.actor_user_id) {
            throw new ConflictException("The decision authority receipt does not identify this actor.");
        }
        return this.coordination.recordRecipientResponse(transaction, {
            school_id: input.school_id,
            message_id: input.message_id,
            correlation_id: input.correlation_id,
            recipient: { agent_kind: "human", user_id: input.decision_authority.user_id },
            actor: { agent_kind: "human", user_id: input.actor_user_id },
            expected_source_record_id: input.request_id,
            expected_source_revision: input.source_revision,
            source_outbox_event_id: input.source_outbox_event_id,
            code: input.decision === "approved" ? "staff_leave_approved" : "staff_leave_rejected",
            explanation: input.decision === "approved"
                ? "The current configured decision owner approved the staff leave request."
                : "The current configured decision owner rejected the staff leave request.",
            response: {
                request_id: input.request_id,
                decision: input.decision,
                resulting_revision: input.resulting_revision,
                affected_periods: input.affected_periods,
            },
            occurred_at: input.occurred_at,
            idempotency_key: `staff-leave-response:${input.request_id}:${input.message_id}:${input.actor_user_id}:${input.command_id}`,
        });
    }
    cancelSubmittedRequest(transaction, input) {
        return this.coordination.recordMessageOutcome(transaction, {
            school_id: input.school_id,
            message_id: input.message_id,
            state: "cancelled",
            actor: { agent_kind: "human", user_id: input.actor_user_id },
            source_outbox_event_id: input.source_outbox_event_id,
            code: "staff_leave_withdrawn",
            explanation: "The requesting staff member withdrew the pending leave request.",
            response: null,
            occurred_at: input.occurred_at,
            idempotency_key: `staff-leave-withdrawal:${input.message_id}:${input.actor_user_id}:${input.command_id}`,
        });
    }
};
StaffLeaveModelBridgeService = __decorate([
    Injectable(),
    __param(0, Inject(GOVERNANCE_DECISION_AUTHORITY_PORT)),
    __param(1, Inject(COORDINATION_RUNTIME_PORT)),
    __metadata("design:paramtypes", [Object, Object])
], StaffLeaveModelBridgeService);
export { StaffLeaveModelBridgeService };
//# sourceMappingURL=staff-leave-model-bridge.service.js.map