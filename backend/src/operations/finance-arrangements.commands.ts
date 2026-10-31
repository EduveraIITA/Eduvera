import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import type { ActingHumanAgentIdentity } from "../campus-model-core/human-agent-identity.port.js";
import type { AuthUser } from "../common/request.js";
import type { Database } from "../database/types.js";
import { financeArrangementResult, type ArrangementCommand, type FinanceInvoice } from "./finance-arrangements.contracts.js";
import { financeHash } from "./finance-arrangements.store.js";
export const obsoleteFinanceArrangement = (message: string, proof: {
  invoice_id: string; command_id: string; expected_revision: number; current_revision: number;
  reason: "stream_advanced" | "ledger_basis_diverged"; request_id?: string;
}) => new ConflictException({ message, code: "fee_arrangement_obsolete", fields: {
  fee_arrangement_obsolete: { confirmation: "permanently_inapplicable", ...proof },
} });

@Injectable()
export class FinanceArrangementCommands {
  constructor(@Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort) {}
  async confirmation(db: Transaction<Database>, user: AuthUser, invoice: FinanceInvoice, commandId: string) {
    const retained = await this.receipts.readDomainCommandReceipt(db, { school_id: invoice.school_id, actor_user_id: user.id, source_domain: "finance",
      handler_key: "finance.instalment_arrangement", handler_version: 1, idempotency_key: `finance-arrangement:${user.id}:${commandId}` });
    if (!retained) return { state: "not_found" as const };
    if (retained.target.kind !== "fee_invoice" || retained.target.domain !== "finance" || retained.target.domain_id !== invoice.id
      || !["request", "decide", "withdraw", "self_payer.enable", "self_payer.revoke"].some(action => retained.command_type === `finance.instalment.${action}`))
      throw new ConflictException("This command does not belong to this fee account.");
    if (retained.state === "pending") return { state: "pending" as const };
    if (retained.receipt.terminal_state !== "accepted") return { state: "not_accepted" as const };
    const result = financeArrangementResult.safeParse(retained.receipt.metadata);
    if (!result.success || result.data.invoice_id !== invoice.id) throw new ConflictException("This fee command’s result is unavailable. No new action was sent.");
    return { state: "accepted" as const, result: result.data };
  }
  async prepare(db: Transaction<Database>, user: AuthUser, actor: ActingHumanAgentIdentity, invoice: FinanceInvoice,
    action: "request" | "decide" | "withdraw" | "self_payer.enable" | "self_payer.revoke", body: ArrangementCommand,
    revision: number, authority: unknown, context: Record<string, unknown> = {}) {
    const payloadHash = financeHash({ action, invoice_id: invoice.id, ...body, ...context });
    const key = `finance-arrangement:${user.id}:${body.command_id}`;
    const retained = await this.receipts.readDomainCommandReceipt(db, { school_id: invoice.school_id, actor_user_id: user.id,
      source_domain: "finance", handler_key: "finance.instalment_arrangement", handler_version: 1, idempotency_key: key });
    if (retained) {
      if (retained.actor_agent_id !== actor.agent_id || retained.command_type !== `finance.instalment.${action}` || retained.target.kind !== "fee_invoice"
        || retained.target.domain !== "finance" || retained.target.domain_id !== invoice.id || retained.expected_revision !== body.expected_revision
        || retained.safe_context.payload_hash !== payloadHash) throw new ConflictException("This command was already used for different fee work.");
      if (retained.state === "pending") throw new ConflictException("This action is awaiting confirmation. Refresh this fee account before retrying.");
      if (retained.receipt.terminal_state !== "accepted") throw new ConflictException("This fee action was not accepted. Review the current account.");
      return retained.receipt;
    }
    if (revision !== body.expected_revision) {
      if (revision > body.expected_revision) throw obsoleteFinanceArrangement("This fee arrangement changed. Refresh before continuing; your proposal has not been sent.", {
        invoice_id: invoice.id, command_id: body.command_id, expected_revision: body.expected_revision, current_revision: revision, reason: "stream_advanced",
        ...(typeof context.request_id === "string" ? { request_id: context.request_id } : "request_id" in body && typeof body.request_id === "string" ? { request_id: body.request_id } : {}),
      });
      throw new ConflictException("This fee arrangement revision is unavailable. Refresh the account.");
    }
    const result = await this.commands.prepareDomainCommand(db, { school_id: invoice.school_id, actor_user_id: user.id,
      command_type: `finance.instalment.${action}`, handler_key: "finance.instalment_arrangement", handler_version: 1, source_domain: "finance",
      target: { kind: "fee_invoice", domain: "finance", domain_id: invoice.id, label: "Fee account", lifecycle_state: "active", source_revision: Math.max(1, revision), metadata: {} },
      current_revision: revision, expected_revision: body.expected_revision, capability: action.startsWith("self_payer") ? "finance.self_payer.manage" : `finance.instalments.${action}`,
      purpose: `fee_arrangement_${action.replaceAll(".", "_")}`, requested_at: executionNow().toISOString(), correlation_id: body.command_id, causation_id: null,
      idempotency_key: key, operating_rule_version_ref: null, configuration_refs: [], authority_attestation: { evaluator_domain: "finance", decision: "allowed",
        reason_codes: ["current_invoice_authority"], authority_source_refs: [authority], operating_rule_refs: [], valid_until: null }, safe_context: { invoice_id: invoice.id, payload_hash: payloadHash } });
    if (result.status === "ready" && result.actor_agent_id !== actor.agent_id) throw new ForbiddenException("Your account link changed. Refresh before continuing.");
    return result;
  }
  finish(db: Transaction<Database>, invoice: FinanceInvoice, commandId: string, revision: number, eventId: string, result: Record<string, unknown>) {
    return this.commands.completeDomainCommand(db, { school_id: invoice.school_id, command_id: commandId, terminal_state: "accepted", code: "fee_arrangement_accepted",
      explanation: "Finance accepted this arrangement action. No charge or payment was created.", resulting_revision: revision, domain_event_id: eventId,
      metadata: result, completed_at: executionNow().toISOString() });
  }
}
