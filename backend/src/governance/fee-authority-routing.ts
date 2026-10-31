import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { CoordinationRuntimePort } from "../campus-model-core/coordination-runtime.port.js";
import { coordinationConfigurationHash, type CoordinationConfigurationPort, type CoordinationRouteContent } from "../campus-model-core/coordination-configuration.port.js";
import type { DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import type { FeeAuthorityCandidate } from "./fee-authority-basis.js";

export const feeReviewRoute = { source_domain: "finance", event_type: "finance.instalment.requested", selector_key: "fee_instalment_decision_owner" } as const;
export interface FeeRouteBasis { adoption_id: string; rule_id: string; revision: number; mandate_id: string; mandate_revision: number; user_id: string; person_id: string }

export async function feeAuthorityRouteReady(tx: Transaction<Database>, runtime: CoordinationRuntimePort, schoolId: string, basis: FeeRouteBasis, at: string) {
  const route = await runtime.resolveEventRoute(tx, { school_id: schoolId, ...feeReviewRoute, occurred_at: at });
  if (route.status !== "matched") return false;
  const config = route.behaviour_configuration as Record<string, unknown> | null;
  if (!config || config.authority_adoption_id !== basis.adoption_id || config.decision_rule_id !== basis.rule_id || config.decision_rule_revision !== basis.revision
    || config.mandate_id !== basis.mandate_id || config.mandate_revision !== basis.mandate_revision || config.reviewer_user_id !== basis.user_id
    || config.reviewer_person_id !== basis.person_id || route.reaction_kind !== "fee_instalment_review" || route.message_kind !== "request"
    || route.selector.required_capability !== "finance.instalments.decide" || route.selector.scope_mode !== "institution"
    || route.selector.min_recipients !== 1 || route.selector.max_recipients !== 1 || route.response_due_after_seconds !== null || route.expires_after_seconds !== null) return false;
  const permitted = await runtime.authorizeCandidateRecipients(tx, { school_id: schoolId, behaviour_version_id: route.behaviour_version_id,
    subscription_id: route.subscription_id, occurred_at: at, recipients: [{ agent_kind: "human", user_id: basis.user_id }], scope: null });
  return permitted.authorised.length === 1 && permitted.unresolved.length === 0 && permitted.unauthorized.length === 0;
}

/** Explicit holder confirmation also approves only this minimum delivery route.
 * Existing native authority still independently gates each request/decision. */
export async function configureFeeAuthorityRoute(tx: Transaction<Database>, configuration: CoordinationConfigurationPort, commands: DomainCommandGatewayPort,
  schoolId: string, candidate: FeeAuthorityCandidate, basis: FeeRouteBasis, parentCommand: string, at: string) {
  const revision = (await sql<{ value: number }>`SELECT COALESCE(max(revision),0)::int+1 AS value FROM fee_authority_route_approvals
    WHERE school_id=${schoolId}::uuid AND adoption_id=${basis.adoption_id}::uuid`.execute(tx)).rows[0]!.value;
  const configurationKey = `fee_instalment_review_${basis.adoption_id.replaceAll("-", "")}`;
  const ruleRef = `fee-authority:${basis.adoption_id}:${revision}`;
  const content: CoordinationRouteContent = { school_id: schoolId, actor_user_id: basis.user_id, source_domain: "finance", source_record_id: basis.adoption_id,
    source_revision: revision, configuration_key: configurationKey, operating_rule_ref: ruleRef, effective_from: at, enabled: true,
    behaviour_key: "fee_instalment_review", behaviour_schema_version: 1,
    behaviour_configuration: { schema_version: 1, workflow: "fee_instalment_review", authority_adoption_id: basis.adoption_id,
      decision_rule_id: basis.rule_id, decision_rule_revision: basis.revision, mandate_id: basis.mandate_id, mandate_revision: basis.mandate_revision,
      reviewer_user_id: basis.user_id, reviewer_person_id: basis.person_id },
    subscription: { ...feeReviewRoute, reaction_kind: "fee_instalment_review", message_kind: "request", message_schema_version: 1,
      required_capability: "finance.instalments.decide", scope_mode: "institution", min_recipients: 1, max_recipients: 1,
      response_due_after_seconds: null, expires_after_seconds: null, retry_after_seconds: null, max_attempts: 1, priority: 5 },
    recipients: [{ person_id: basis.person_id, user_id: basis.user_id }],
    approval_note: "The current holder explicitly receives payment-plan review requests under their existing Finance mandate. No review deadline, expiry, reminder or automatic decision is enabled." };
  const hash = coordinationConfigurationHash(content);
  const prepare = (phase: "approve" | "activate", causation: string | null) => commands.prepareDomainCommand(tx, {
    school_id: schoolId, actor_user_id: basis.user_id, source_domain: "finance", command_type: `finance.coordination.configure.${phase}`,
    handler_key: "finance.coordination.configure", handler_version: 1, target: { kind: "finance_review_route", domain: "finance", domain_id: basis.adoption_id,
      label: "Payment-plan review delivery", lifecycle_state: "active", source_revision: revision, metadata: {} }, current_revision: revision - 1, expected_revision: revision - 1,
    capability: "fees.manage", purpose: "configure_existing_finance_review_delivery", requested_at: at, correlation_id: parentCommand, causation_id: causation,
    idempotency_key: `fee-authority-route:${parentCommand}:${phase}`, operating_rule_version_ref: ruleRef,
    configuration_refs: [{ kind: "fee_authority_adoption", ref: basis.adoption_id, version: String(basis.revision) }],
    authority_attestation: { evaluator_domain: "finance", decision: "allowed", reason_codes: ["current_existing_finance_mandate_holder", "explicit_review_delivery_approval"],
      authority_source_refs: [candidate.expected], operating_rule_refs: [], valid_until: null },
    safe_context: { configuration_hash: hash, source_record_id: basis.adoption_id, source_revision: revision, configuration_key: configurationKey } });
  const approval = await prepare("approve", null);
  if (approval.status !== "ready") throw new ConflictException("Review the current payment-plan routing confirmation before retrying.");
  await commands.completeDomainCommand(tx, { school_id: schoolId, command_id: approval.command_id, terminal_state: "accepted", code: "fee_review_route_approved",
    explanation: "The current Finance authority holder explicitly approved payment-plan request delivery to themselves.", resulting_revision: revision,
    domain_event_id: null, metadata: { configuration_hash: hash }, completed_at: at });
  const activation = await prepare("activate", approval.command_id);
  if (activation.status !== "ready") throw new ConflictException("Review the current payment-plan routing activation before retrying.");
  await configuration.configureRoute(tx, { ...content, configuration_hash: hash, approval_command_id: approval.command_id, activation_command_id: activation.command_id });
  await commands.completeDomainCommand(tx, { school_id: schoolId, command_id: activation.command_id, terminal_state: "accepted", code: "fee_review_route_activated",
    explanation: "Only the explicitly approved payment-plan review delivery route was activated.", resulting_revision: revision, domain_event_id: null,
    metadata: { configuration_hash: hash }, completed_at: at });
  await sql`INSERT INTO fee_authority_route_approvals(id,school_id,adoption_id,revision,configuration_hash,confirmed_by,command_id,created_at)
    VALUES(${randomUUID()}::uuid,${schoolId}::uuid,${basis.adoption_id}::uuid,${revision},${hash},${basis.user_id}::uuid,${parentCommand}::uuid,${at}::timestamptz)`.execute(tx);
}
