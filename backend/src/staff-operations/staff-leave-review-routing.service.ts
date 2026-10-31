import { createHash } from "node:crypto";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import { COORDINATION_CONFIGURATION_PORT, COORDINATION_CONFIGURATION_READ_PORT, coordinationConfigurationHash, type CoordinationConfigurationPort, type CoordinationConfigurationReadPort, type CoordinationRouteContent } from "../campus-model-core/coordination-configuration.port.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { StaffLeaveModelBridgeService } from "./staff-leave-model-bridge.service.js";
import { canonicalLeaveReviewRouteBasis, leaveReviewRouteBasis, leaveReviewRouteBasisSchema } from "./staff-leave-review-routing.contracts.js";

const confirmationSchema = z.object({ command_id: z.uuid(), expected: leaveReviewRouteBasisSchema, confirmed: z.literal(true) }).strict();

/** Confirms delivery under an existing institutional decision route. It neither
 * adopts authority nor appoints a reviewer, and never changes pending requests. */
@Injectable()
export class StaffLeaveReviewRoutingService {
  constructor(private readonly db: DatabaseService, private readonly leave: StaffLeaveModelBridgeService,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(COORDINATION_CONFIGURATION_PORT) private readonly configuration: CoordinationConfigurationPort,
    @Inject(COORDINATION_CONFIGURATION_READ_PORT) private readonly configurationReads: CoordinationConfigurationReadPort) {}

  private selected(user: AuthUser, schoolId: string) {
    z.uuid().parse(schoolId);
    const environment = executionEnvironmentStorage.getStore();
    if (!user.is_active || user.active_school_id && user.active_school_id !== schoolId
      || environment?.institution_id && environment.institution_id !== schoolId)
      throw new ForbiddenException("Use your currently selected campus to set up leave review.");
  }

  async workspace(user: AuthUser, schoolId: string) {
    this.selected(user, schoolId);
    return this.db.transaction().execute(async tx => {
      const identity = await this.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
      if (!identity.acting) throw new ForbiddenException("A current campus person and active account are required.");
      // Do not expose a campus-wide authority directory to an unrelated member.
      const membership = await tx.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId)
        .where("user_id", "=", user.id).where("is_active", "=", true).where("role", "in", ["admin", "staff"]).executeTakeFirst();
      try {
        const owner = await this.leave.resolveDecisionOwner(tx, schoolId, executionNow());
        if (!membership && owner.user_id !== user.id) throw new ForbiddenException("Current staff access or an explicit leave-review responsibility is required.");
        const reviewer = await this.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: owner.user_id, at: executionNow().toISOString() });
        const ready = await this.leave.deliveryReady(tx, schoolId, owner, executionNow().toISOString());
        const own = owner.user_id === user.id && owner.person.id === identity.person_id;
        return { state: ready ? "ready" as const : "needs_configuration" as const,
          reason: ready ? null : "The current leave approver must enable review requests.",
          reviewer: { user_id: owner.user_id, name: reviewer.acting ? reviewer.label : "Current leave approver" },
          can_configure: !ready && own, expected: own ? leaveReviewRouteBasis(owner) : null };
      } catch (error) {
        if (!(error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException)) throw error;
        return { state: "unavailable" as const, reason: error.message, reviewer: null, can_configure: false, expected: null };
      }
    });
  }

  async confirm(user: AuthUser, schoolId: string, body: unknown) {
    this.selected(user, schoolId);
    const input = confirmationSchema.parse(body), expected = canonicalLeaveReviewRouteBasis(input.expected);
    const payloadHash = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
    const key = `staff-leave-review-routing:${user.id}:${input.command_id}`;
    return this.db.transaction().execute(async tx => {
      // One selected-world rule/recipient confirmation at a time. The governance
      // receipt is re-evaluated after taking the lock, not accepted from the UI.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-leave-review-routing:${schoolId}`},0))`.execute(tx);
      const authority = await this.leave.assertDecisionAuthority(tx, schoolId, user.id, executionNow());
      const identity = await this.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
      if (!identity.acting || identity.person_id !== authority.person.id)
        throw new ForbiddenException("Only the current leave authority holder can enable their review requests.");
      const retained = await this.receipts.readDomainCommandReceipt(tx, { school_id: schoolId, actor_user_id: user.id,
        source_domain: "staff_operations", handler_key: "staff_operations.leave_review_routing", handler_version: 1, idempotency_key: key });
      if (retained) {
        if (retained.actor_agent_id !== identity.agent_id || retained.command_type !== "staff_operations.leave_review_routing.confirm"
          || retained.target.domain !== "staff_operations" || retained.target.kind !== "staff_leave_review_route"
          || retained.target.domain_id !== expected.rule.id || retained.safe_context.payload_hash !== payloadHash)
          throw new ConflictException("This confirmation command was used for different leave-review details.");
        if (retained.state === "pending") throw new ConflictException("This confirmation is not yet confirmed. Refresh leave review before retrying.");
        if (retained.receipt.terminal_state !== "accepted") throw new ConflictException("This confirmation was not accepted. Review the current leave route.");
        return { confirmed: true as const, replayed: true };
      }
      if (JSON.stringify(leaveReviewRouteBasis(authority)) !== JSON.stringify(expected))
        throw new ConflictException("Leave authority changed. Refresh the approver and authority details before confirming.");
      if (await this.leave.deliveryReady(tx, schoolId, authority, executionNow().toISOString()))
        throw new ConflictException("Leave review requests are already enabled. Refresh to see the current reviewer.");
      const at = executionNow().toISOString();
      const attestation = { evaluator_domain: "staff_operations", decision: "allowed" as const,
        reason_codes: ["current_governance_leave_decision_holder", "explicit_review_delivery_confirmation"],
        authority_source_refs: authority.sources.map(source => ({ id: source.id, revision: source.revision, verification_state: source.verification_state })),
        operating_rule_refs: [{ rule_id: authority.rule.id, revision: authority.rule.revision,
          appointment_id: authority.appointment.id, appointment_revision: authority.appointment.revision }], valid_until: null };
      const prepared = await this.commands.prepareDomainCommand(tx, { school_id: schoolId, actor_user_id: user.id,
        source_domain: "staff_operations", command_type: "staff_operations.leave_review_routing.confirm",
        handler_key: "staff_operations.leave_review_routing", handler_version: 1,
        target: { kind: "staff_leave_review_route", domain: "staff_operations", domain_id: authority.rule.id,
          label: "Staff leave review", lifecycle_state: "active", source_revision: authority.rule.revision, metadata: {} },
        current_revision: authority.rule.revision, expected_revision: expected.rule.revision,
        capability: "staff_leave:configure_review_delivery", purpose: "confirm_existing_staff_leave_review_delivery",
        requested_at: at, correlation_id: input.command_id, causation_id: null, idempotency_key: key,
        operating_rule_version_ref: `governance-decision:${authority.rule.id}:${authority.rule.revision}`,
        configuration_refs: [{ kind: "governance_rule", ref: authority.rule.id, version: String(authority.rule.revision) },
          { kind: "appointment", ref: authority.appointment.id, version: String(authority.appointment.revision) }],
        authority_attestation: attestation, safe_context: { payload_hash: payloadHash } });
      if (prepared.status !== "ready") throw new ConflictException("Review the retained confirmation before enabling leave review again.");

      // Stable route identity ensures supersession revokes former reply grants.
      // The accepted confirmation command is its immutable source record; Core
      // retains delivery versions without a second policy or authority table.
      const configurationKey = "staff_leave_review";
      const configurationRevision = 1 + await this.configurationReads.latestRevision(tx, { school_id: schoolId,
        source_domain: "staff_operations", configuration_key: configurationKey });
      const ruleRef = `staff-leave-review-confirmation:${input.command_id}`;
      const content: CoordinationRouteContent = { school_id: schoolId, actor_user_id: user.id, source_domain: "staff_operations",
        source_record_id: prepared.command_id, source_revision: configurationRevision, configuration_key: configurationKey, operating_rule_ref: ruleRef,
        effective_from: at, enabled: true, behaviour_key: "staff_leave_decision_review", behaviour_schema_version: 1,
        behaviour_configuration: { schema_version: 1, workflow: "staff_leave_decision_review", reviewer_user_id: user.id,
          reviewer_person_id: identity.person_id, authority_basis: expected },
        subscription: { source_domain: "staff_operations", event_type: "staff.leave.submitted", reaction_kind: "staff_leave_decision_review",
          message_kind: "request", message_schema_version: 1, selector_key: "leave_decision_owner", required_capability: "staff_leave:decide",
          scope_mode: "institution", min_recipients: 1, max_recipients: 1, response_due_after_seconds: null, expires_after_seconds: null,
          retry_after_seconds: null, max_attempts: 1, priority: 5 },
        recipients: [{ person_id: identity.person_id, user_id: user.id }],
        approval_note: "The existing leave authority holder explicitly receives review requests. No new institutional authority, automatic decision, reminder, deadline or expiry is created." };
      const configurationHash = coordinationConfigurationHash(content);
      const phase = async (action: "approve" | "activate", causation: string) => this.commands.prepareDomainCommand(tx, {
        school_id: schoolId, actor_user_id: user.id, source_domain: "staff_operations",
        command_type: `staff_operations.coordination.configure.${action}`, handler_key: "staff_operations.coordination.configure", handler_version: 1,
        target: { kind: "staff_leave_review_confirmation", domain: "staff_operations", domain_id: input.command_id,
          label: "Leave review delivery", lifecycle_state: "active", source_revision: configurationRevision, metadata: {} }, current_revision: configurationRevision - 1, expected_revision: configurationRevision - 1,
        capability: "staff_leave:configure_review_delivery", purpose: "configure_existing_staff_leave_review_delivery", requested_at: at,
        correlation_id: input.command_id, causation_id: causation, idempotency_key: `${key}:${action}`, operating_rule_version_ref: ruleRef,
        configuration_refs: [{ kind: "governance_rule", ref: authority.rule.id, version: String(authority.rule.revision) }],
        authority_attestation: attestation, safe_context: { configuration_hash: configurationHash, source_record_id: prepared.command_id,
          source_revision: configurationRevision, configuration_key: configurationKey } });
      const approval = await phase("approve", prepared.command_id);
      if (approval.status !== "ready") throw new ConflictException("The leave review delivery approval requires refresh.");
      await this.commands.completeDomainCommand(tx, { school_id: schoolId, command_id: approval.command_id, terminal_state: "accepted",
        code: "staff_leave_review_delivery_approved", explanation: "The current authority holder explicitly approved their review-request delivery.",
        resulting_revision: configurationRevision, domain_event_id: null, metadata: { configuration_hash: configurationHash }, completed_at: at });
      const activation = await phase("activate", approval.command_id);
      if (activation.status !== "ready") throw new ConflictException("The leave review delivery activation requires refresh.");
      await this.configuration.configureRoute(tx, { ...content, configuration_hash: configurationHash,
        approval_command_id: approval.command_id, activation_command_id: activation.command_id });
      await this.commands.completeDomainCommand(tx, { school_id: schoolId, command_id: activation.command_id, terminal_state: "accepted",
        code: "staff_leave_review_delivery_activated", explanation: "Only the explicitly approved review-request delivery was activated.",
        resulting_revision: configurationRevision, domain_event_id: null, metadata: { configuration_hash: configurationHash }, completed_at: at });
      await tx.insertInto("institution_governance_audits").values({ school_id: schoolId, actor_id: user.id,
        action: "staff.leave_review_delivery.confirmed", target_type: "decision_rule", target_id: authority.rule.id,
        metadata: { command_id: input.command_id, authority_basis: expected, configuration_hash: configurationHash } }).execute();
      await this.commands.completeDomainCommand(tx, { school_id: schoolId, command_id: prepared.command_id, terminal_state: "accepted",
        code: "staff_leave_review_delivery_confirmed", explanation: "Existing staff-leave decision authority was retained; only delivery to that holder was confirmed.",
        resulting_revision: authority.rule.revision, domain_event_id: null, metadata: { confirmed: true, configuration_hash: configurationHash }, completed_at: at });
      return { confirmed: true as const, replayed: false };
    });
  }
}
