import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import { PREPARED_DOMAIN_COMMAND_VERIFICATION_PORT, type PreparedDomainCommandVerificationPort } from "../campus-model-core/domain-command-gateway.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { FinanceArrangementsAccess } from "./finance-arrangements.access.js";
import { operationalFeeAccess } from "./operational-fee-access.js";
import { arrangementBasis, arrangementInvoice, financeBasisRevision, financeHash } from "./finance-arrangements.store.js";
import { ElectiveRuleRefusal, type ElectiveFinanceReviewer } from "../learning/learning-elective-change.contracts.js";

export interface ElectiveFinanceDecisionRow {
  id: string; school_id: string; change_id: string; action_id: string; reviewer_id: string; reviewer_person_id: string; reviewer_eligibility_hash: string;
  outcome: "no_financial_change" | "requires_financial_review"; ledger_basis_hash: string; ledger_basis: Record<string, unknown>; reason: string; created_at: Date;
}
/** Purpose-specific Finance port. Classifies exact current evidence; never posts money,
 * waives a charge, grants access or borrows the instalment decision mandate. */
@Injectable()
export class ElectiveFinanceReviewService {
  constructor(readonly access: FinanceArrangementsAccess,
    @Inject(PREPARED_DOMAIN_COMMAND_VERIFICATION_PORT) private readonly commands: PreparedDomainCommandVerificationPort) {}
  async reviewer(tx: Transaction<Database>, schoolId: string, userId: string): Promise<ElectiveFinanceReviewer | null> {
    let technical;
    try { technical = await operationalFeeAccess(tx, userId, schoolId, true); } catch (cause) { if (cause instanceof ForbiddenException) return null; throw cause; }
    const actor = await this.access.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: userId, at: executionNow().toISOString() });
    if (!actor.acting) return null;
    const sources = [...technical.sources].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { user_id: userId, person_id: actor.person_id, label: actor.label, eligibility_hash: financeHash({ user_id: userId, person_id: actor.person_id, endpoint_id: actor.endpoint_id, sources }) };
  }
  async reviewers(tx: Transaction<Database>, schoolId: string) {
    const candidates = (await sql<{ user_id: string }>`SELECT DISTINCT membership.user_id FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.is_active AND membership.role IN ('admin','staff')
        AND(membership.role='admin' OR EXISTS(SELECT 1 FROM staff_role_bindings binding WHERE binding.school_id=membership.school_id AND binding.user_id=membership.user_id
          AND binding.context_kind='institution' AND binding.scope_id=${schoolId}::uuid AND binding.status='active' AND binding.role_active AND 'fees.manage'=ANY(binding.permissions))
          OR EXISTS(SELECT 1 FROM school_access_exceptions exception WHERE exception.school_id=membership.school_id AND exception.user_id=membership.user_id
            AND exception.permission='fees.manage' AND exception.scope_kind='institution' AND exception.status='active')) ORDER BY membership.user_id LIMIT 201`.execute(tx)).rows;
    if (candidates.length > 200) throw new ConflictException("Narrow the institution Finance responsibility before choosing a reviewer.");
    const result: ElectiveFinanceReviewer[] = [];
    for (const candidate of candidates) { const reviewer = await this.reviewer(tx, schoolId, candidate.user_id); if (reviewer) result.push(reviewer); }
    return result.sort((a, b) => a.label.localeCompare(b.label) || a.user_id.localeCompare(b.user_id));
  }
  async campus(tx: Transaction<Database>, user: AuthUser, schoolId: string) {
    const campus = await this.access.campus(tx, user, schoolId), technical = await operationalFeeAccess(tx, user.id, schoolId, true);
    return { ...campus, technical };
  }
  async basis(tx: Transaction<Database>, schoolId: string, personId: string) {
    // All existing native charge/correction/payment owners serialize on this same
    // institution key. It also prevents a new invoice escaping the reviewed set.
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(tx);
    if (!await tx.selectFrom("school_people").select("id").where("school_id", "=", schoolId).where("id", "=", personId).forShare().executeTakeFirst())
      throw new ForbiddenException("This learner's canonical campus person is unavailable.");
    const ids = (await sql<{ id: string }>`SELECT invoice.id FROM fee_invoices invoice LEFT JOIN students student ON student.school_id=invoice.school_id AND student.id=invoice.student_id
      WHERE invoice.school_id=${schoolId}::uuid AND coalesce(invoice.person_id,student.person_id)=${personId}::uuid ORDER BY invoice.id LIMIT 101`.execute(tx)).rows;
    if (ids.length > 100) throw new ConflictException("Finance must reconcile this person's account before this bounded elective review.");
    const invoices = [];
    for (const { id } of ids) {
      const invoice = await arrangementInvoice(tx, schoolId, id, true); if (invoice.person_id !== personId) throw new ConflictException("This fee invoice belongs to a different canonical person.");
      const ledger = await arrangementBasis(tx, invoice);
      invoices.push({ invoice_id: invoice.id, student_id: invoice.student_id, person_id: invoice.person_id, reference: invoice.reference,
        due_on: invoice.due_on, amount_paise: invoice.amount_paise, revision: financeBasisRevision(ledger), ledger });
    }
    const basis = { school_id: schoolId, person_id: personId, invoices };
    return { basis, hash: financeHash(basis) };
  }
  async latest(tx: Transaction<Database>, schoolId: string, changeId: string) {
    return (await sql<ElectiveFinanceDecisionRow>`SELECT review.* FROM fee_elective_change_reviews review
      JOIN learning_elective_change_actions action ON action.school_id=review.school_id AND action.id=review.action_id
      WHERE review.school_id=${schoolId}::uuid AND review.change_id=${changeId}::uuid ORDER BY action.revision DESC LIMIT 1`.execute(tx)).rows[0] ?? null;
  }
  async record(tx: Transaction<Database>, user: AuthUser, input: { school_id: string; change_id: string; person_id: string; action_id: string; command_id: string;
    correlation_id: string; decision_id: string; reviewer: ElectiveFinanceReviewer; expected_ledger_basis_hash: string; outcome: ElectiveFinanceDecisionRow['outcome']; reason: string }) {
    const campus = await this.campus(tx, user, input.school_id), current = await this.reviewer(tx, input.school_id, user.id);
    if (!current || current.user_id !== input.reviewer.user_id || current.person_id !== input.reviewer.person_id || current.eligibility_hash !== input.reviewer.eligibility_hash)
      throw new ForbiddenException("Only the exact currently eligible named Finance recorder can classify this elective change.");
    const prepared = await this.commands.verifyPreparedDomainCommand(tx, { school_id: input.school_id, actor_user_id: user.id, command_id: input.command_id,
      correlation_id: input.correlation_id, source_domain: "learning_elective", required_capability: "fees.manage", allowed_command_types: ["learning.elective_change.finance.classify"] });
    if (prepared.safe_context.elective_change_id !== input.change_id || campus.actor.person_id !== current.person_id) throw new ConflictException("The Finance command belongs to different elective work.");
    const reviewed = await this.basis(tx, input.school_id, input.person_id);
    if (reviewed.hash !== input.expected_ledger_basis_hash) throw new ElectiveRuleRefusal("The current invoice or ledger basis changed. Review Finance's current evidence before classifying this change.");
    const id = input.decision_id;
    await sql`INSERT INTO fee_elective_change_reviews(id,school_id,change_id,action_id,reviewer_id,reviewer_person_id,reviewer_eligibility_hash,outcome,ledger_basis_hash,ledger_basis,reason,created_at)
      VALUES(${id}::uuid,${input.school_id}::uuid,${input.change_id}::uuid,${input.action_id}::uuid,${user.id}::uuid,${current.person_id}::uuid,${current.eligibility_hash},${input.outcome},
        ${reviewed.hash},${JSON.stringify(reviewed.basis)}::jsonb,${input.reason},${executionNow()})`.execute(tx);
    return { id, outcome: input.outcome, ledger_basis_hash: reviewed.hash };
  }
  async assertNoChange(tx: Transaction<Database>, schoolId: string, changeId: string, personId: string, reviewer: ElectiveFinanceReviewer | null) {
    const decision = await this.latest(tx, schoolId, changeId);
    if (!decision || decision.outcome !== "no_financial_change" || !reviewer || decision.reviewer_id !== reviewer.user_id
      || decision.reviewer_person_id !== reviewer.person_id || decision.reviewer_eligibility_hash !== reviewer.eligibility_hash)
      throw new ElectiveRuleRefusal("The current named Finance recorder must explicitly confirm the exact financial impact before this elective change.");
    const current = await this.reviewer(tx, schoolId, reviewer.user_id);
    if (!current || current.person_id !== reviewer.person_id || current.eligibility_hash !== reviewer.eligibility_hash)
      throw new ElectiveRuleRefusal("The retained Finance responsibility changed. Assign and review the current responsibility explicitly.");
    if ((await this.basis(tx, schoolId, personId)).hash !== decision.ledger_basis_hash)
      throw new ElectiveRuleRefusal("The invoice or ledger changed after Finance's classification. Finance must review the current basis before the elective can change.");
    return decision;
  }
}
