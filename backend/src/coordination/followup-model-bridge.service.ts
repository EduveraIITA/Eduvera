import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { AuthenticatedRequest } from "../common/request.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort, type PreparedDomainCommand } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { COORDINATION_RUNTIME_PORT, type CoordinationRuntimePort, type CoordinationPublishReceipt } from "../campus-model-core/coordination-runtime.port.js";

export interface FollowupModelSource {
  id: string; school_id: string; student_id: string; owner_user_id: string; revision: number; state: string;
}
export interface FollowupModelReceipt {
  command_id: string;
  event_id: string;
  source_revision: number;
  event_type: string;
  route: CoordinationPublishReceipt | null;
  manual_exception: "recipient_unresolved" | null;
  closure: "awaiting_guardian" | "awaiting_owner_review" | "terminal_domain_decision";
}
export const followupCoordinationSummary = (receipt: FollowupModelReceipt | null) => {
  if (!receipt) return { status: "historical_unlinked", message: "This historical follow-up has no retained mailbox trace. Continue through the authorized follow-up record." };
  if (receipt.closure === "terminal_domain_decision") return { status: "closed", message: "The follow-up was resolved by its owning service." };
  if (receipt.route?.status === "matched") return { status: "routed", message: "The configured recipient has durable follow-up work. Delivery is not acknowledgement or acceptance." };
  return { status: "manual_followup", exception_code: receipt.manual_exception ?? (receipt.route?.status === "unmatched" ? receipt.route.exception_code : "configuration_missing"),
    message: "The follow-up is saved, but its mailbox handoff is unavailable. The responsible staff member must continue through this record and ask an administrator to review the route." };
};

/** Coordination owns follow-up truth and private prose. Core receives only typed
 * references and current domain-authorized endpoints, never guessed recipients. */
@Injectable()
export class FollowupModelBridgeService {
  constructor(@Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort,
    @Inject(COORDINATION_RUNTIME_PORT) private readonly coordination: CoordinationRuntimePort) {}

  private subject(row: FollowupModelSource) {
    return { kind: "attendance_followup", domain: "coordination", domain_id: row.id, label: "Attendance follow-up",
      source_revision: Math.max(1, row.revision), lifecycle_state: row.state === "resolved" ? "inactive" as const : "active" as const, metadata: {} };
  }

  async prepare(db: Transaction<Database>, req: AuthenticatedRequest, row: FollowupModelSource, key: string, hash: string,
    action: string, context: "staff" | "guardian", prior: FollowupModelReceipt | null) {
    const prepared = await this.commands.prepareDomainCommand(db, { school_id: row.school_id, actor_user_id: req.authUser.id,
      command_type: `coordination.followup.${action}`, handler_key: "coordination.attendance_followup", handler_version: 1,
      source_domain: "coordination", target: this.subject(row), current_revision: row.revision, expected_revision: row.revision,
      capability: "followups.manage", purpose: context === "guardian" ? "reply_to_linked_learner_followup" : "manage_authorized_attendance_followup",
      requested_at: executionNow().toISOString(), correlation_id: row.id, causation_id: prior?.event_id ?? null,
      idempotency_key: `attendance-followup:${req.authUser.id}:${key}`, operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: "coordination", decision: "allowed", reason_codes: ["current_followup_domain_authority", `selected_${context}_context`],
        authority_source_refs: [{ school_id: row.school_id, student_id: row.student_id, actor_user_id: req.authUser.id, context }],
        operating_rule_refs: [], valid_until: null }, safe_context: { followup_id: row.id, payload_hash: hash, action, context } });
    if (prepared.status !== "ready") throw new ConflictException("This follow-up command already completed. Refresh its retained result.");
    return prepared;
  }

  async accepted(db: Transaction<Database>, req: AuthenticatedRequest, row: FollowupModelSource, prepared: PreparedDomainCommand,
    input: { action: string; key: string; outbox_id: string; previous: FollowupModelReceipt | null; recipient_user_ids: string[];
      response_recipient_user_id: string | null; channel: string; observed_at: string | null }) {
    const at = executionNow().toISOString(), eventType = `coordination.followup.${input.action}`;
    let protocolResponseAllowed = false;
    if (input.previous?.route?.status === "matched" && input.response_recipient_user_id === req.authUser.id && input.action !== "assisted_reply") {
      const retained = input.previous.route;
      const current = await this.coordination.resolveEventRoute(db, { school_id: row.school_id, source_domain: "coordination",
        event_type: input.previous.event_type, selector_key: input.previous.closure === "awaiting_guardian"
          ? "attendance_followup_guardians" : "attendance_followup_owner", occurred_at: at });
      if (current.status === "matched" && current.behaviour_version_id === retained.behaviour_version_id && current.subscription_id === retained.subscription_id) {
        const authority = await this.coordination.authorizeCandidateRecipients(db, { school_id: row.school_id,
          behaviour_version_id: current.behaviour_version_id, subscription_id: current.subscription_id, occurred_at: at,
          recipients: [{ agent_kind: "human", user_id: input.response_recipient_user_id }], scope: this.subject(row) });
        protocolResponseAllowed = authority.authorised.length === 1 && !authority.unresolved.length && !authority.unauthorized.length;
      }
    }
    const closure = row.state === "resolved" ? "terminal_domain_decision" as const
      : input.action === "opened" ? "awaiting_guardian" as const : "awaiting_owner_review" as const;
    const safe = { followup_id: row.id, student_id: row.student_id, source_revision: row.revision, state: row.state,
      action: input.action, source_command_id: prepared.command_id, closure,
      capture: { channel: input.channel, observed_at: input.observed_at, assisted_capture: input.action === "assisted_reply" } };
    const base = { school_id: row.school_id, source_outbox_event_id: input.outbox_id, event_type: eventType, subject: this.subject(row), context: null,
      actor_user_id: req.authUser.id, occurred_at: at, effective_from: at, effective_until: null, source_domain: "coordination", source_record_id: row.id,
      source_revision: row.revision, correlation_id: row.id, causation_event_id: input.previous?.event_id ?? null,
      idempotency_key: `followup-model:${row.id}:${row.revision}`, payload: safe };
    let eventId: string, route: CoordinationPublishReceipt | null = null;
    const recipients = [...new Set(input.recipient_user_ids)];
    if (closure === "terminal_domain_decision" || !recipients.length) {
      eventId = (await this.journal.recordAcceptedEvent(db, { ...base, audience_user_ids: [], payload: { ...safe,
        ...(closure !== "terminal_domain_decision" ? { coordination_exception: "recipient_unresolved", correction_owner_user_id: row.owner_user_id } : {}) } })).event_id;
    } else {
      route = await this.coordination.publishAcceptedEvent(db, { ...base, event_kind: "domain_event",
        message: { subject: closure === "awaiting_guardian" ? "Attendance follow-up needs a reply" : "Review attendance follow-up reply",
          summary: "Open the authorized follow-up record to continue. The attendance decision is unchanged by this message.",
          payload: { workflow: "attendance_followup", followup_id: row.id, student_id: row.student_id, source_revision: row.revision,
            action_path: `/areas/attendance/follow-ups?${closure === "awaiting_guardian" ? `scope=dependent&student_id=${encodeURIComponent(row.student_id)}&` : ""}followup=${encodeURIComponent(row.id)}` } },
        selector_input: { selector_key: closure === "awaiting_guardian" ? "attendance_followup_guardians" : "attendance_followup_owner",
          recipient_agents: recipients.map(user_id => ({ agent_kind: "human" as const, user_id })), scope: this.subject(row) } });
      eventId = route.event_id;
    }
    // The newly accepted event proves the exact source revision superseded the
    // old invitations. A guardian never impersonates another recipient or the
    // original sender; assisted capture remains staff evidence, not an app reply.
    if (input.previous?.route?.status === "matched") for (const delivery of input.previous.route.deliveries) {
      const trace = await this.coordination.findExactTrace(db, { school_id: row.school_id, source_domain: "coordination", source_record_id: row.id,
        event_type: input.previous.event_type, source_revision: input.previous.source_revision, message_id: delivery.message_id });
      if (!trace || trace.message_id !== delivery.message_id || trace.correlation_id !== row.id || !trace.message_state)
        throw new ConflictException("The exact follow-up handoff evidence is unavailable. Refresh before recording a response.");
      if (["responded", "cancelled", "expired", "dead_letter"].includes(trace.message_state)) continue;
      const responseRecipient = input.action !== "assisted_reply" && delivery.recipient.agent_kind === "human"
        && delivery.recipient.user_id === input.response_recipient_user_id && delivery.recipient.user_id === req.authUser.id;
      const beforeDue = !input.previous.route.route_snapshot?.response_due_at
        || Date.parse(at) <= Date.parse(input.previous.route.route_snapshot.response_due_at);
      if (responseRecipient && protocolResponseAllowed && trace.message_open === true && beforeDue) await this.coordination.recordRecipientResponse(db, { school_id: row.school_id,
        message_id: delivery.message_id, correlation_id: row.id, recipient: delivery.recipient, actor: { agent_kind: "human", user_id: req.authUser.id },
        expected_source_record_id: row.id, expected_source_revision: input.previous.source_revision, source_outbox_event_id: input.outbox_id,
        code: `attendance_followup_${input.action}`, explanation: "The owning follow-up service accepted this recipient's response; the attendance record remains independently owned.",
        response: { followup_id: row.id, resulting_revision: row.revision, action: input.action, channel: input.channel,
          assisted_capture: false, observed_at: input.observed_at }, occurred_at: at,
        idempotency_key: `followup-response:${input.key}:${delivery.message_id}` });
      else await this.coordination.supersedeDomainMessage(db, { school_id: row.school_id, command_id: prepared.command_id,
        message_id: delivery.message_id, previous_event_id: input.previous.event_id, resulting_event_id: eventId,
        required_capability: "followups.manage", occurred_at: at, idempotency_key: `followup-superseded:${input.key}:${delivery.message_id}` });
    }
    const receipt: FollowupModelReceipt = { command_id: prepared.command_id, event_id: eventId, source_revision: row.revision, event_type: eventType, route,
      manual_exception: closure !== "terminal_domain_decision" && !recipients.length ? "recipient_unresolved" : null, closure };
    await this.commands.completeDomainCommand(db, { school_id: row.school_id, command_id: prepared.command_id, terminal_state: "accepted",
      code: `attendance_followup_${input.action}`, explanation: "The owning Coordination service accepted the follow-up transition, without changing the attendance decision.",
      resulting_revision: row.revision, domain_event_id: input.outbox_id,
      metadata: { followup_id: row.id, model_event_id: eventId, coordination: followupCoordinationSummary(receipt), closure }, completed_at: at });
    return receipt;
  }
}
