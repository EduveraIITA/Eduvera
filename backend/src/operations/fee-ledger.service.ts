import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { financeHash } from "./finance-arrangements.store.js";
import { retainFeesContinuation } from "../institution-onboarding/operating-resume.js";
import { operationalFeeAccess } from "./operational-fee-access.js";

export const personInvoiceSchema = z.object({ command_id: z.uuid(), invoice_id: z.uuid(),
  beneficiary: z.object({ person_id: z.uuid(), expected_revision: z.number().int().positive() }).strict(),
  reference: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(200),
  amount_paise: z.number().int().min(1).max(100_000_000), due_on: z.iso.date() }).strict();
const issueResult = z.object({ id: z.uuid(), invoice_id: z.uuid(), revision: z.literal(1), replayed: z.boolean() }).strict();

/** Native charge issue extends the same immutable ledger; it creates no payment or authority. */
@Injectable()
export class FeeLedgerService {
  constructor(private readonly db: DatabaseService,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort) {}
  private async campus(db: Transaction<Database>, user: AuthUser, schoolId: string) {
    z.uuid().parse(schoolId);
    if (!user.is_active || user.active_school_id !== schoolId) throw new ForbiddenException("Choose this campus before opening fees.");
    const selected = executionEnvironmentStorage.getStore();
    if (selected && selected.institution_id !== schoolId) throw new ForbiddenException("Fees must belong to the selected campus and world.");
    const school = await db.selectFrom("schools").select(["id", "timezone"]).where("id", "=", schoolId).executeTakeFirst();
    if (!school) throw new NotFoundException("This campus is unavailable.");
    const actor = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException("Your current campus person/account link is unavailable.");
    if (!await db.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true).executeTakeFirst())
      throw new ForbiddenException("Current campus membership is required.");
    return { ...school, actor, today: new Intl.DateTimeFormat("en-CA", { timeZone: school.timezone }).format(executionNow()) };
  }
  private key(user: AuthUser, id: string) { return `finance-charge:${user.id}:${id}`; }
  private receipt(db: Transaction<Database>, user: AuthUser, schoolId: string, commandId: string) {
    return this.receipts.readDomainCommandReceipt(db, { school_id: schoolId, actor_user_id: user.id, source_domain: "finance",
      handler_key: "finance.charge", handler_version: 1, idempotency_key: this.key(user, commandId) });
  }
  async confirmation(user: AuthUser, schoolId: string, invoiceId: string, commandId: string) {
    z.uuid().parse(invoiceId); z.uuid().parse(commandId);
    return this.db.transaction().execute(async db => {
      await this.campus(db, user, schoolId); await operationalFeeAccess(db, user.id, schoolId, true);
      const retained = await this.receipt(db, user, schoolId, commandId), base = { handler: "finance.charge" as const, source_id: invoiceId, command_id: commandId, action: "issue" as const };
      if (!retained) return { ...base, state: "not_found" as const };
      if (retained.target.domain_id !== invoiceId || retained.target.kind !== "fee_invoice" || retained.target.domain !== "finance" || retained.command_type !== "finance.charge.issue")
        throw new ConflictException("This command does not belong to this charge.");
      if (retained.state === "pending") return { ...base, state: "pending" as const };
      if (retained.receipt.terminal_state !== "accepted") return { ...base, state: "not_accepted" as const };
      const result = issueResult.parse(retained.receipt.metadata);
      if (result.invoice_id !== invoiceId) throw new ConflictException("This charge receipt is unavailable.");
      return { ...base, state: "accepted" as const, result };
    });
  }
  async issue(user: AuthUser, schoolId: string, raw: unknown) {
    const data = personInvoiceSchema.parse(raw), payloadHash = financeHash(data);
    return this.db.transaction().execute(async db => {
      const campus = await this.campus(db, user, schoolId), technical = await operationalFeeAccess(db, user.id, schoolId, true);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
      // Exact retained acceptance precedes mutable person/ledger checks.
      const retained = await this.receipt(db, user, schoolId, data.command_id);
      if (retained) {
        if (retained.actor_agent_id !== campus.actor.agent_id || retained.target.domain_id !== data.invoice_id || retained.target.domain !== "finance"
          || retained.target.kind !== "fee_invoice" || retained.command_type !== "finance.charge.issue" || retained.safe_context.payload_hash !== payloadHash)
          throw new ConflictException("This command was already used for different fee work.");
        if (retained.state === "pending") throw new ConflictException("This charge is awaiting confirmation. Keep the same command while checking its receipt.");
        if (retained.receipt.terminal_state !== "accepted") throw new ConflictException("This charge was not accepted. Review the current account.");
        return { ...issueResult.parse(retained.receipt.metadata), replayed: true };
      }
      const person = await db.selectFrom("school_people").select(["id", "revision"]).where("school_id", "=", schoolId).where("id", "=", data.beneficiary.person_id)
        .where(sql<boolean>`retired_at IS NULL`).forShare().executeTakeFirst();
      if (person && person.revision > data.beneficiary.expected_revision) throw new ConflictException({ code: "finance.charge_person_obsolete",
        message: "This person's details changed. Review the person before issuing the charge.", fields: { charge_obsolete: {
          code: "finance.charge_person_obsolete", confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "finance.charge",
          invoice_id: data.invoice_id, command_id: data.command_id, person_id: person.id, expected_person_revision: data.beneficiary.expected_revision, current_person_revision: person.revision } } });
      if (!person || person.revision !== data.beneficiary.expected_revision) throw new ConflictException("The selected person is unavailable. Review this charge.");
      if (await db.selectFrom("fee_invoices").select("id").where("id", "=", data.invoice_id).executeTakeFirst()) throw new ConflictException("This charge identifier is already in use.");
      if (await db.selectFrom("fee_invoices").select("id").where("school_id", "=", schoolId).where("reference", "=", data.reference).executeTakeFirst())
        throw new BadRequestException({ message: "This charge reference is already in use. Check the existing charge or choose another reference.", fields: { reference: "Use a unique charge reference." } });
      const prepared = await this.commands.prepareDomainCommand(db, { school_id: schoolId, actor_user_id: user.id, command_type: "finance.charge.issue",
        handler_key: "finance.charge", handler_version: 1, source_domain: "finance", target: { kind: "fee_invoice", domain: "finance", domain_id: data.invoice_id,
          label: "Fee account", lifecycle_state: "active", source_revision: 1, metadata: {} }, current_revision: 0, expected_revision: 0,
        capability: "finance.charge.issue", purpose: "fee_charge_issue", requested_at: executionNow().toISOString(), correlation_id: data.command_id,
        causation_id: null, idempotency_key: this.key(user, data.command_id), operating_rule_version_ref: null, configuration_refs: [],
        authority_attestation: { evaluator_domain: "finance", decision: "allowed", reason_codes: ["current_fee_recording_access"], authority_source_refs: [technical], operating_rule_refs: [], valid_until: null },
        safe_context: { invoice_id: data.invoice_id, payload_hash: payloadHash } });
      if (prepared.status === "completed") return { ...issueResult.parse(prepared.metadata), replayed: true };
      if (prepared.actor_agent_id !== campus.actor.agent_id) throw new ForbiddenException("Your account link changed. Refresh before continuing.");
      await db.insertInto("fee_invoices").values({ id: data.invoice_id, school_id: schoolId, student_id: null, person_id: person.id, selected_person_revision: person.revision,
        reference: data.reference, description: data.description, amount_paise: data.amount_paise, due_on: data.due_on, created_by: user.id, created_at: executionNow() }).execute();
      await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata) VALUES(${schoolId}::uuid,${user.id}::uuid,'fee.invoice_posted',${data.invoice_id}::uuid,
        ${JSON.stringify({ command_id: prepared.command_id, beneficiary_person_id: person.id })}::jsonb)`.execute(db);
      const payload = { invoice_id: data.invoice_id, person_id: person.id, revision: 1, refresh: ["fees", "attention", "workspace"] };
      const audience = (await sql<{ user_id: string }>`SELECT DISTINCT user_id FROM school_memberships WHERE school_id=${schoolId}::uuid AND is_active
        AND event_user_is_authorized(${schoolId}::uuid,'fees.updated',${JSON.stringify(payload)}::jsonb,user_id)`.execute(db)).rows.map(row => row.user_id);
      const event = await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "finance.charge.issued", aggregate_type: "fee_invoice", aggregate_id: data.invoice_id,
        audience_user_ids: audience, payload, idempotency_key: `fee-charge:${prepared.command_id}`, notification_user_ids: [], notification_payload: null, created_at: executionNow() }).returning("id").executeTakeFirstOrThrow();
      await db.insertInto("event_outbox").values({ school_id: schoolId, event_type: "fees.updated", aggregate_type: "fee_invoice", aggregate_id: data.invoice_id,
        audience_user_ids: audience, payload, idempotency_key: `fee-charge-refresh:${prepared.command_id}`, notification_user_ids: [], notification_payload: null, created_at: executionNow() }).execute();
      const at = executionNow().toISOString();
      await this.journal.recordAcceptedEvent(db, { school_id: schoolId, source_outbox_event_id: event.id, event_type: "finance.charge.issued",
        subject: { kind: "fee_invoice", domain: "finance", domain_id: data.invoice_id, label: "Fee account", lifecycle_state: "active", source_revision: 1, metadata: {} }, context: null,
        actor_user_id: user.id, audience_user_ids: audience, occurred_at: at, effective_from: at, effective_until: null, source_domain: "finance", source_record_id: data.invoice_id,
        source_revision: 1, correlation_id: data.command_id, causation_event_id: null, idempotency_key: `fee-charge-event:${prepared.command_id}`, payload: { invoice_id: data.invoice_id, revision: 1 } });
      const result = { id: data.invoice_id, invoice_id: data.invoice_id, revision: 1 as const, replayed: false };
      await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: prepared.command_id, terminal_state: "accepted", code: "fee_charge_issued",
        explanation: "The charge was issued. No payment was recorded.", resulting_revision: 1, domain_event_id: event.id, metadata: result, completed_at: at });
      await retainFeesContinuation(db, user, schoolId, { id: data.invoice_id, person_id: person.id, created_by: user.id });
      return result;
    });
  }
  async accountContext(db: Transaction<Database>, user: AuthUser, schoolId: string, personId?: string, invoiceId?: string) {
    const campus = await this.campus(db, user, schoolId); let canIssue = false;
    try { await operationalFeeAccess(db, user.id, schoolId); canIssue = true; } catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
    if (!personId && !canIssue) throw new ForbiddenException("Current institution-scoped Finance recording access is required.");
    if (personId && personId !== campus.actor.person_id && !canIssue) throw new ForbiddenException("This fee account is not yours.");
    if (personId && !canIssue) {
      const access = (await sql`SELECT 1 FROM fee_invoices i WHERE i.school_id=${schoolId}::uuid AND i.person_id=${personId}::uuid
        AND (${invoiceId ?? null}::uuid IS NULL OR i.id=${invoiceId ?? null}::uuid)
        AND EXISTS(SELECT 1 FROM fee_invoice_self_payer_entitlements e WHERE e.school_id=i.school_id AND e.invoice_id=i.id AND e.person_id=i.person_id
          AND e.user_id=${user.id}::uuid AND ${campus.today}::date BETWEEN e.valid_from AND e.valid_until
          AND NOT EXISTS(SELECT 1 FROM fee_invoice_self_payer_revocations r WHERE r.school_id=e.school_id AND r.entitlement_id=e.id)) LIMIT 1`.execute(db)).rows[0];
      if (!access) throw new ForbiddenException("This fee account needs current explicit access.");
    }
    return { school_id: schoolId, today: campus.today, timezone: campus.timezone, can_issue: canIssue };
  }
  async accounts(user: AuthUser, schoolId: string) {
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db => {
      const campus = await this.campus(db, user, schoolId); let canIssue = false;
      try { await operationalFeeAccess(db, user.id, schoolId); canIssue = true; } catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
      const items = (await sql<{ kind: "person" | "student"; person_id: string | null; student_id: string | null; name: string }>`
        SELECT 'person'::text AS kind,p.id AS person_id,NULL::uuid AS student_id,trim(concat_ws(' ',p.first_name,p.last_name)) AS name FROM school_people p
          WHERE p.school_id=${schoolId}::uuid AND p.id=${campus.actor.person_id}::uuid AND p.retired_at IS NULL
            AND EXISTS(SELECT 1 FROM fee_invoices i JOIN fee_invoice_self_payer_entitlements e ON e.school_id=i.school_id AND e.invoice_id=i.id AND e.person_id=i.person_id
              WHERE i.school_id=p.school_id AND i.person_id=p.id AND e.user_id=${user.id}::uuid AND ${campus.today}::date BETWEEN e.valid_from AND e.valid_until
                AND NOT EXISTS(SELECT 1 FROM fee_invoice_self_payer_revocations r WHERE r.school_id=e.school_id AND r.entitlement_id=e.id))
        UNION ALL SELECT 'student',s.person_id,s.id,trim(concat_ws(' ',p.first_name,p.last_name)) FROM students s
          JOIN school_people p ON p.school_id=s.school_id AND p.id=s.person_id WHERE s.school_id=${schoolId}::uuid AND (
            s.user_id=${user.id}::uuid AND s.person_id=${campus.actor.person_id}::uuid AND EXISTS(SELECT 1 FROM school_memberships m WHERE m.school_id=s.school_id AND m.user_id=${user.id}::uuid AND m.is_active AND m.role='student')
            OR EXISTS(SELECT 1 FROM parents g JOIN guardian_relationships r ON r.guardian_id=g.id AND r.school_id=s.school_id AND r.student_id=s.id
              JOIN guardian_school_profiles gp ON gp.school_id=r.school_id AND gp.guardian_id=g.id
              JOIN school_memberships m ON m.school_id=r.school_id AND m.user_id=g.user_id AND m.is_active AND m.role='guardian'
              WHERE g.user_id=${user.id}::uuid AND gp.person_id=${campus.actor.person_id}::uuid)) ORDER BY name,student_id LIMIT 100`.execute(db)).rows;
      return { school_id: schoolId, today: campus.today, timezone: campus.timezone, can_issue: canIssue,
        items: items.map(item => ({ ...item, href: item.kind === "person" ? `/areas/fees/account?scope=person&person_id=${item.person_id}` : `/areas/fees/account?scope=${item.person_id === campus.actor.person_id ? "self" : "dependent"}&student_id=${item.student_id}` })) };
    });
  }
}
