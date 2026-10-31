import { createHash } from "node:crypto";
import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { COORDINATION_RUNTIME_PORT, type CoordinationRuntimePort } from "../campus-model-core/coordination-runtime.port.js";
import { COORDINATION_CONFIGURATION_PORT, coordinationConfigurationHash, type CoordinationConfigurationPort, type CoordinationRouteContent } from "../campus-model-core/coordination-configuration.port.js";
import { SchoolEventService } from "../school/school-event.service.js";
import type { AssignmentCommand } from "./learning-assignment.contracts.js";

type Source = { id: string; school_id: string; revision: number; class_section_id: string | null; title: string; context_kind?: string };
export type AssignmentRoute = { behaviour_version_id: string; subscription_id: string; selector_key: string };
export const assignmentHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Domain-specific bridge; no private text, filenames or byte content enters Core. */
@Injectable()
export class LearningAssignmentModelService {
  constructor(@Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identity: HumanAgentIdentityPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort,
    @Inject(COORDINATION_RUNTIME_PORT) private readonly coordination: CoordinationRuntimePort,
    @Inject(COORDINATION_CONFIGURATION_PORT) private readonly configuration: CoordinationConfigurationPort,
    private readonly events: SchoolEventService) {}

  identityPort() { return this.identity; }

  async offeringReceipt(tx: Transaction<Database>, user: AuthUser, schoolId: string, sourceId: string, commandId: string, action: string) {
    const actor = await this.acting(tx, user, schoolId);
    const prior = await this.receipts.readDomainCommandReceipt(tx, { school_id: schoolId, actor_user_id: user.id, source_domain: "learning",
      handler_key: "learning.offerings", handler_version: 1, idempotency_key: `learning-offering:${user.id}:${commandId}` });
    if (prior && (prior.actor_agent_id !== actor.agent_id || prior.command_type !== `learning.offering.${action}`
      || prior.target.domain !== "learning" || prior.target.domain_id !== sourceId || prior.target.kind !== "learning_offering"))
      throw new ConflictException("This command belongs to different learning group work.");
    return prior;
  }

  async prepareOffering(tx: Transaction<Database>, user: AuthUser, source: { id: string; school_id: string; revision: number },
    action: string, command: AssignmentCommand, payload: unknown) {
    const prior = await this.offeringReceipt(tx, user, source.school_id, source.id, command.command_id, action), hash = assignmentHash(payload);
    if (prior) {
      if (prior.safe_context.payload_hash !== hash || prior.expected_revision !== command.expected_revision) throw new ConflictException("This command was already used with different learning group details.");
      if (prior.state === "pending") throw new ConflictException("This learning group action is awaiting confirmation. Retry the same action.");
      if (prior.receipt.terminal_state !== "accepted") throw new ConflictException("This learning group action was not accepted.");
      return prior.receipt;
    }
    if (source.revision > command.expected_revision) throw new ConflictException({ code: "learning.offering_revision_obsolete",
      message: "This learning group changed. Review the current version before continuing.", fields: { offering_obsolete: {
        code: "learning.offering_revision_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.offerings",
        source_id: source.id, command_id: command.command_id, expected_revision: command.expected_revision, current_revision: source.revision } } });
    return this.commands.prepareDomainCommand(tx, { school_id: source.school_id, actor_user_id: user.id,
      command_type: `learning.offering.${action}`, source_domain: "learning", handler_key: "learning.offerings", handler_version: 1,
      target: { kind: "learning_offering", domain: "learning", domain_id: source.id, label: "Learning group", source_revision: Math.max(1, source.revision), lifecycle_state: "active", metadata: {} },
      expected_revision: command.expected_revision, current_revision: source.revision, capability: "campus.setup", purpose: `learning_offering_${action.replaceAll(".", "_")}`,
      requested_at: executionNow().toISOString(), correlation_id: command.command_id, causation_id: null, idempotency_key: `learning-offering:${user.id}:${command.command_id}`,
      operating_rule_version_ref: null, configuration_refs: [], authority_attestation: { evaluator_domain: "learning", decision: "allowed",
        reason_codes: ["current_protected_campus_setup_authority"], authority_source_refs: [{ school_id: source.school_id, user_id: user.id }], operating_rule_refs: [], valid_until: null },
      safe_context: { offering_id: source.id, payload_hash: hash } });
  }

  async finishOffering(tx: Transaction<Database>, source: { id: string; school_id: string; revision: number }, commandId: string, result: Record<string, unknown>, eventId: string) {
    await this.commands.completeDomainCommand(tx, { school_id: source.school_id, command_id: commandId, terminal_state: "accepted", code: "learning_offering_action_accepted",
      explanation: "The learning group service accepted this action.", resulting_revision: source.revision, domain_event_id: eventId, metadata: result, completed_at: executionNow().toISOString() });
  }

  async offeringEvent(tx: Transaction<Database>, user: AuthUser, source: { id: string; school_id: string; revision: number }, action: string, commandId: string, audience: string[]) {
    const safe = { offering_id: source.id, revision: source.revision, action }, key = `learning-offering:${user.id}:${source.id}:${commandId}:${action}`;
    await this.events.enqueueUserEvent(tx, { schoolId: source.school_id, eventType: "diary.updated", aggregateType: "learning_offering", aggregateId: source.id,
      audienceUserIds: [...new Set(audience)], payload: { ...safe, refresh: ["learning-assignments", "workspace"] }, idempotencyKey: key });
    const outbox = await tx.insertInto("event_outbox").values({ school_id: source.school_id, event_type: `learning.offering.${action}`, aggregate_type: "learning_offering",
      aggregate_id: source.id, audience_user_ids: [], payload: safe, idempotency_key: `model:${key}` }).returning("id").executeTakeFirstOrThrow();
    await this.journal.recordAcceptedEvent(tx, { school_id: source.school_id, source_outbox_event_id: outbox.id, event_type: `learning.offering.${action}`,
      subject: { kind: "learning_offering", domain: "learning", domain_id: source.id, label: "Learning group", source_revision: source.revision, lifecycle_state: "active", metadata: {} },
      context: null, actor_user_id: user.id, occurred_at: executionNow().toISOString(), effective_from: executionNow().toISOString(), effective_until: null,
      source_domain: "learning", source_record_id: source.id, source_revision: source.revision, correlation_id: commandId, causation_event_id: null,
      idempotency_key: key, audience_user_ids: [...new Set(audience)], payload: safe });
    return outbox.id;
  }

  async acting(tx: Transaction<Database>, user: AuthUser, schoolId: string) {
    const actor = await this.identity.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException("Your campus person/account link is unavailable. Ask your campus administrator to review it.");
    return actor;
  }

  async prepare(tx: Transaction<Database>, user: AuthUser, source: Source, action: string, command: AssignmentCommand,
    payload: unknown, authority: unknown[], self = false) {
    const actor = await this.acting(tx, user, source.school_id), hash = assignmentHash(payload);
    const key = `assignment:${user.id}:${command.command_id}`;
    const prior = await this.receipts.readDomainCommandReceipt(tx, { school_id: source.school_id, actor_user_id: user.id,
      source_domain: "learning_assignments", handler_key: "learning.assignments", handler_version: 1, idempotency_key: key });
    if (prior) {
      if (prior.actor_agent_id !== actor.agent_id || prior.command_type !== `learning.assignment.${action}` || prior.target.domain_id !== source.id
        || prior.target.domain !== "learning_assignments" || prior.expected_revision !== command.expected_revision || prior.safe_context.payload_hash !== hash)
        throw new ConflictException("This command was already used for different assignment work.");
      if (prior.state === "pending") throw new ConflictException("This action is awaiting confirmation. Refresh before retrying.");
      if (prior.receipt.terminal_state !== "accepted") throw new ConflictException("This action was not accepted. Refresh the assignment.");
      return prior.receipt;
    }
    // A newer monotonic native revision proves this exact, receipt-absent command
    // can never be accepted. Do not turn an arbitrary 409/read refresh into proof.
    if (source.revision > command.expected_revision) throw new ConflictException({ code: "assignment_revision_obsolete",
      message: "The saved version changed. Your text is kept; review the current version before continuing.", fields: { assignment_obsolete: {
        code: "assignment_revision_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.assignments", source_id: source.id,
        command_id: command.command_id, expected_revision: command.expected_revision, current_revision: source.revision } } });
    return this.commands.prepareDomainCommand(tx, { school_id: source.school_id, actor_user_id: user.id,
      command_type: `learning.assignment.${action}`, handler_key: "learning.assignments", handler_version: 1, source_domain: "learning_assignments",
      target: { kind: "learning_work", domain: "learning_assignments", domain_id: source.id, label: "Individual assignment", source_revision: Math.max(1, source.revision), lifecycle_state: "active", metadata: {} },
      expected_revision: command.expected_revision, current_revision: source.revision, capability: self ? "learning.assignment.self" : "learning.assignments.manage",
      purpose: `assignment_${action.replaceAll(".", "_")}`, requested_at: executionNow().toISOString(), correlation_id: command.command_id,
      causation_id: null, idempotency_key: key, operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: "learning_assignments", decision: "allowed", reason_codes: [self ? "exact_current_learner" : source.context_kind === "learning_offering" ? "current_offering_teaching_assignment" : "current_class_learning_assignment"],
        authority_source_refs: authority, operating_rule_refs: [], valid_until: null }, safe_context: { assignment_id: source.id, payload_hash: hash } });
  }

  async finish(tx: Transaction<Database>, source: Source, commandId: string, result: Record<string, unknown>, eventId: string | null = null) {
    await this.commands.completeDomainCommand(tx, { school_id: source.school_id, command_id: commandId, terminal_state: "accepted", code: "assignment_action_accepted",
      explanation: "The assignment action was accepted by its owning service.", resulting_revision: source.revision, domain_event_id: eventId,
      metadata: result, completed_at: executionNow().toISOString() });
  }

  /** Call only after prepare found no accepted receipt and an immutable terminal fact was read under the native lock. */
  obsoleteState(source: Source, command: AssignmentCommand, reason: "instructions_published" | "attempt_reviewed") {
    throw new ConflictException({ code: "assignment_state_obsolete", message: "This version is already final. Your text is kept; review the saved work.",
      fields: { assignment_obsolete: { code: "assignment_state_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent",
        handler: "learning.assignments", source_id: source.id, command_id: command.command_id, expected_revision: command.expected_revision,
        current_revision: source.revision, reason } } });
  }

  /** The publication/submission review explicitly approves this exact person route. */
  async route(tx: Transaction<Database>, user: AuthUser, source: Source, kind: "review" | "revision", recipientId: string, commandId: string) {
    const recipient = await this.identity.resolveAccountEndpoint(tx, { school_id: source.school_id, user_id: recipientId, at: executionNow().toISOString() });
    if (!recipient.acting) throw new ForbiddenException("The selected recipient needs a current campus account link.");
    const suffix = assignmentHash([source.id, kind, recipientId]).slice(0, 32), now = executionNow().toISOString();
    const selectorKey = `assignment_${kind}_${suffix}`, rule = `learning-assignment:${source.id}:${kind}:${recipient.person_id}`;
    const content: CoordinationRouteContent = { school_id: source.school_id, actor_user_id: user.id,
      configuration_key: selectorKey, source_domain: "learning_assignments", source_record_id: source.id, source_revision: source.revision,
      operating_rule_ref: rule, effective_from: now, enabled: true, behaviour_key: selectorKey, behaviour_schema_version: 1,
      behaviour_configuration: { workflow: `learning_assignment_${kind}`, assignment_id: source.id, recipient_user_id: recipientId,
        timing: "no_response_deadline", approved_in: kind === "review" ? "assignment_publication" : "learner_submission" },
      subscription: { source_domain: "learning_assignments", event_type: kind === "review" ? "learning.assignment.submitted" : "learning.assignment.changes_requested",
        reaction_kind: `learning_assignment_${kind}`, message_kind: "task", selector_key: selectorKey,
        required_capability: kind === "review" ? "learning.assignment.review.respond" : "learning.assignment.revision.respond",
        scope_mode: "event_scope", min_recipients: 1, max_recipients: 1, message_schema_version: 1,
        response_due_after_seconds: null, expires_after_seconds: null, max_attempts: 1, retry_after_seconds: null, priority: 2 },
      recipients: [{ person_id: recipient.person_id, user_id: recipientId }],
      approval_note: kind === "review" ? "Publication confirms the exact responsible reviewer; no review deadline or automatic reminders." : "Submission confirms that any requested changes return to this learner; no automatic deadline." };
    const hash = coordinationConfigurationHash(content);
    const prepare = (phase: "approve" | "activate", causation: string | null) => this.commands.prepareDomainCommand(tx, {
      school_id: source.school_id, actor_user_id: user.id, command_type: `learning_assignments.coordination.configure.${phase}`,
      handler_key: "learning_assignments.coordination.configure", handler_version: 1, source_domain: "learning_assignments",
      target: { kind: "learning_work", domain: "learning_assignments", domain_id: source.id, label: "Assignment routing", source_revision: source.revision, lifecycle_state: "active", metadata: {} },
      expected_revision: source.revision, current_revision: source.revision, capability: kind === "review" ? "learning.assignments.manage" : "learning.assignment.self",
      purpose: "assignment_route_confirmation", requested_at: now, correlation_id: commandId, causation_id: causation,
      idempotency_key: `${selectorKey}:${source.revision}:${commandId}:${phase}`, operating_rule_version_ref: rule, configuration_refs: [],
      authority_attestation: { evaluator_domain: "learning_assignments", decision: "allowed", reason_codes: ["explicit_exact_assignment_route"], authority_source_refs: [{ assignment_id: source.id, recipient_user_id: recipientId }], operating_rule_refs: [], valid_until: null },
      safe_context: { configuration_hash: hash, source_record_id: source.id, source_revision: source.revision, configuration_key: selectorKey } });
    const approval = await prepare("approve", null);
    if (approval.status !== "ready") throw new ConflictException("The assignment routing approval needs refresh.");
    await this.finish(tx, source, approval.command_id, { route: kind, configuration_hash: hash });
    const activation = await prepare("activate", approval.command_id);
    if (activation.status !== "ready") throw new ConflictException("The assignment routing activation needs refresh.");
    const route = await this.configuration.configureRoute(tx, { ...content, configuration_hash: hash,
      approval_command_id: approval.command_id, activation_command_id: activation.command_id });
    await this.finish(tx, source, activation.command_id, { route: kind, configuration_hash: hash });
    if (!route.behaviour_version_id || !route.subscription_id) throw new ConflictException("The assignment handoff is unavailable.");
    return { behaviour_version_id: route.behaviour_version_id, subscription_id: route.subscription_id, selector_key: selectorKey };
  }

  async event(tx: Transaction<Database>, user: AuthUser, source: Source, action: string, commandId: string, audience: string[],
    details: { student_id?: string; person_id?: string; attempt_id?: string } = {}, handoff?: { route: AssignmentRoute; recipient: string; href: string }) {
    const eventKey = `assignment:${user.id}:${source.id}:${commandId}:${action}`, now = executionNow().toISOString();
    const safe = { assignment_id: source.id, revision: source.revision, action, ...details };
    await this.events.enqueueUserEvent(tx, { schoolId: source.school_id, eventType: "diary.updated", aggregateType: "learning_assignment",
      aggregateId: source.id, audienceUserIds: [...new Set(audience)], payload: { ...safe, refresh: ["learning-assignments", "workspace", "requests", "today"] }, idempotencyKey: eventKey });
    // Typed accepted fact is distinct from the public Diary cache-refresh envelope.
    // No browser audience: ordinary screens receive the established diary.updated event.
    const sourceRecordId = details.attempt_id ?? source.id;
    const outbox = (await tx.insertInto("event_outbox").values({ school_id: source.school_id, event_type: `learning.assignment.${action}`,
      aggregate_type: details.attempt_id ? "learning_assignment_attempt" : "learning_assignment", aggregate_id: sourceRecordId,
      audience_user_ids: [], payload: safe, idempotency_key: `model:${eventKey}` }).returning("id").executeTakeFirstOrThrow());
    const base = { school_id: source.school_id, source_outbox_event_id: outbox.id, event_type: `learning.assignment.${action}`,
      subject: { kind: "learning_work", domain: "learning_assignments", domain_id: source.id, label: "Individual assignment", source_revision: source.revision, lifecycle_state: "active" as const, metadata: {} },
      context: null, actor_user_id: user.id, occurred_at: now, effective_from: now, effective_until: null,
      source_domain: "learning_assignments", source_record_id: details.attempt_id ?? source.id, source_revision: source.revision,
      correlation_id: commandId, causation_event_id: null, idempotency_key: eventKey, payload: safe };
    if (!handoff) {
      const recorded = await this.journal.recordAcceptedEvent(tx, { ...base, audience_user_ids: [...new Set(audience)] });
      return { event_id: outbox.id, model_event_id: recorded.event_id, message_id: null };
    }
    const routed = await this.coordination.publishAcceptedEvent(tx, { ...base, event_kind: "domain_event", expected_route: {
      behaviour_version_id: handoff.route.behaviour_version_id, subscription_id: handoff.route.subscription_id },
      message: { subject: action === "submitted" ? "Assignment ready to review" : "Changes requested", summary: "Open the exact assignment to continue.",
        payload: { workflow: `learning_assignment_${action === "submitted" ? "review" : "revision"}`, ...safe, href: handoff.href,
          assignment_id: source.id, source_action: action === "submitted" ? "review" : "revise" } },
      selector_input: { selector_key: handoff.route.selector_key, recipient_agents: [{ agent_kind: "human", user_id: handoff.recipient }], scope: base.subject } });
    if (routed.status !== "matched" || routed.message_ids.length !== 1) throw new ConflictException("The assignment handoff is unavailable. Your saved work remains available.");
    return { event_id: outbox.id, model_event_id: routed.event_id, message_id: routed.message_ids[0]! };
  }

  async respond(tx: Transaction<Database>, user: AuthUser, source: Source, messageId: string | null, action: string, commandId: string,
    sourceRecordId: string, triggeringAction: "submitted" | "changes_requested", outboxEventId: string) {
    if (!messageId) return;
    const trace = await this.coordination.findExactTrace(tx, { school_id: source.school_id, source_domain: "learning_assignments",
      source_record_id: sourceRecordId, event_type: `learning.assignment.${triggeringAction}`, source_revision: source.revision });
    if (!trace || trace.message_id !== messageId || trace.message_open !== true) throw new ConflictException("The retained assignment handoff is unavailable. Your saved work remains available; contact the responsible reviewer.");
    await this.coordination.recordRecipientResponse(tx, { school_id: source.school_id, message_id: messageId, correlation_id: trace.correlation_id,
      recipient: { agent_kind: "human", user_id: user.id }, actor: { agent_kind: "human", user_id: user.id },
      expected_source_record_id: sourceRecordId, expected_source_revision: source.revision,
      source_outbox_event_id: outboxEventId, code: `assignment_${action}`, explanation: "The owning assignment accepted the response.",
      response: { action, assignment_id: source.id }, occurred_at: executionNow().toISOString(), idempotency_key: `assignment-message:${commandId}:${action}` });
  }

  async handoffOpen(tx: Transaction<Database>, source: Source, attemptId: string, action: "submitted" | "changes_requested", messageId: string | null) {
    if (!messageId) return false;
    const trace = await this.coordination.findExactTrace(tx, { school_id: source.school_id, source_domain: "learning_assignments",
      source_record_id: attemptId, event_type: `learning.assignment.${action}`, source_revision: source.revision });
    return trace?.message_id === messageId && trace.message_open === true;
  }
}
