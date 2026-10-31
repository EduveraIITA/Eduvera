import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { HUMAN_AGENT_IDENTITY_PORT, type ActingHumanAgentIdentity, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../common/request.js";
import type { Database } from "../database/types.js";
import { GOVERNANCE_DECISION_AUTHORITY_PORT, type GovernanceDecisionAuthorityPort } from "../governance/decision-authority.port.js";
import { operationalFeeAccess } from "./operational-fee-access.js";
import type { FinanceInvoice } from "./finance-arrangements.contracts.js";

export interface SelfPayerEntitlement { id: string; user_id: string; person_id: string; valid_from: string; valid_until: string; revoked_at: Date | string | null; stream_revision: number }
@Injectable()
export class FinanceArrangementsAccess {
  constructor(@Inject(HUMAN_AGENT_IDENTITY_PORT) readonly identities: HumanAgentIdentityPort,
    @Inject(GOVERNANCE_DECISION_AUTHORITY_PORT) readonly authority: GovernanceDecisionAuthorityPort) {}
  async campus(db: Transaction<Database>, user: AuthUser, schoolId: string) {
    if (!user.is_active || user.active_school_id !== schoolId) throw new ForbiddenException("Choose this campus before opening fees.");
    const selected = executionEnvironmentStorage.getStore();
    if (selected && selected.institution_id !== schoolId) throw new ForbiddenException("Fees must belong to the selected campus and world.");
    const school = await db.selectFrom("schools").select(["id", "timezone"]).where("id", "=", schoolId).executeTakeFirst();
    if (!school) throw new ForbiddenException("This campus is unavailable.");
    const actor = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException("Your current campus person/account link is unavailable.");
    return { ...school, actor, today: new Intl.DateTimeFormat("en-CA", { timeZone: school.timezone }).format(executionNow()) };
  }
  async manages(db: Transaction<Database>, user: AuthUser, schoolId: string) {
    try { return await operationalFeeAccess(db, user.id, schoolId, true); }
    catch (error) { if (error instanceof ForbiddenException) return null; throw error; }
  }
  async finance(db: Transaction<Database>, user: AuthUser, schoolId: string) {
    const technical = await this.manages(db, user, schoolId);
    if (!technical) throw new ForbiddenException("Current Finance access is required.");
    const authority = await this.authority.assertDecisionAuthority(db, schoolId, "fee_instalment_decision", user.id, executionNow());
    return { technical, authority };
  }
  async family(db: Transaction<Database>, user: AuthUser, invoice: FinanceInvoice, actor: ActingHumanAgentIdentity) {
    if (invoice.context_kind === "person") {
      await this.bindInvoiceAccount(db, invoice);
      const self = invoice.user_id === user.id && invoice.person_id === actor.person_id && Boolean((await db.selectFrom("school_memberships")
        .select("id").where("school_id", "=", invoice.school_id).where("user_id", "=", user.id).where("is_active", "=", true).executeTakeFirst()));
      return { self, guardian: false };
    }
    const family = (await sql<{ self: boolean; guardian: boolean }>`SELECT
      (${invoice.user_id}::uuid=${user.id}::uuid AND ${invoice.person_id}::uuid=${actor.person_id}::uuid AND EXISTS(
        SELECT 1 FROM school_memberships WHERE school_id=${invoice.school_id}::uuid AND user_id=${user.id}::uuid AND is_active AND role='student')) AS self,
      EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id
        JOIN guardian_school_profiles profile ON profile.school_id=relationship.school_id AND profile.guardian_id=parent.id
        JOIN school_memberships membership ON membership.school_id=relationship.school_id AND membership.user_id=parent.user_id AND membership.is_active AND membership.role='guardian'
        WHERE relationship.school_id=${invoice.school_id}::uuid AND relationship.student_id=${invoice.student_id}::uuid
          AND parent.user_id=${user.id}::uuid AND profile.person_id=${actor.person_id}::uuid) AS guardian`.execute(db)).rows[0]!;
    return family;
  }
  /** Resolve the current canonical endpoint through the owning identity port, including retained student/staff links. */
  async bindInvoiceAccount(db: Transaction<Database>, invoice: FinanceInvoice) {
    if (invoice.context_kind !== "person") return invoice;
    const endpoint = await this.identities.resolvePersonAgent(db, { school_id: invoice.school_id, person_id: invoice.person_id, at: executionNow().toISOString() });
    invoice.user_id = endpoint.acting ? endpoint.user_id : null;
    return invoice;
  }
  async entitlement(db: Transaction<Database>, invoice: FinanceInvoice, today: string) {
    const rows = (await sql<SelfPayerEntitlement>`SELECT entitlement.id,entitlement.user_id,entitlement.person_id,entitlement.valid_from::text,entitlement.valid_until::text,
      revocation.created_at AS revoked_at,entitlement.stream_revision FROM fee_invoice_self_payer_entitlements entitlement
      LEFT JOIN fee_invoice_self_payer_revocations revocation ON revocation.school_id=entitlement.school_id AND revocation.entitlement_id=entitlement.id
      WHERE entitlement.school_id=${invoice.school_id}::uuid AND entitlement.invoice_id=${invoice.id}::uuid
      ORDER BY entitlement.stream_revision DESC`.execute(db)).rows;
    const active = rows.filter(row => !row.revoked_at && row.valid_from <= today && row.valid_until >= today
      && row.user_id === invoice.user_id && row.person_id === invoice.person_id);
    if (active.length > 1) throw new ConflictException("This fee account has overlapping self-payer access. Ask Finance to review it.");
    return { current: active[0] ?? null, latest: rows[0] ?? null, all: rows };
  }
  async canRead(db: Transaction<Database>, user: AuthUser, invoice: FinanceInvoice, actor: ActingHumanAgentIdentity, today: string, manager?: boolean) {
    if (manager ?? Boolean(await this.manages(db, user, invoice.school_id))) return true;
    const relation = await this.family(db, user, invoice, actor);
    if (invoice.context_kind !== "person") return relation.self || relation.guardian;
    const entitlement = (await this.entitlement(db, invoice, today)).current;
    return relation.self && entitlement?.user_id === user.id && entitlement.person_id === actor.person_id;
  }
  async requester(db: Transaction<Database>, user: AuthUser, invoice: FinanceInvoice, actor: ActingHumanAgentIdentity, today: string) {
    const relationship = await this.family(db, user, invoice, actor);
    if (relationship.guardian) return { relationship: "guardian" as const, entitlement: null };
    const entitlement = (await this.entitlement(db, invoice, today)).current;
    if (relationship.self && entitlement?.user_id === user.id && entitlement.person_id === actor.person_id) return { relationship: "self" as const, entitlement };
    throw new ForbiddenException("A current linked guardian or explicitly enabled self-payer must request instalments.");
  }
}
