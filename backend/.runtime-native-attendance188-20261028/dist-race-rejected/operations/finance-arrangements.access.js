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
import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { HUMAN_AGENT_IDENTITY_PORT } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { GOVERNANCE_DECISION_AUTHORITY_PORT } from "../governance/decision-authority.port.js";
import { operationalFeeAccess } from "./operational-fee-access.js";
let FinanceArrangementsAccess = class FinanceArrangementsAccess {
    identities;
    authority;
    constructor(identities, authority) {
        this.identities = identities;
        this.authority = authority;
    }
    async campus(db, user, schoolId) {
        if (!user.is_active || user.active_school_id !== schoolId)
            throw new ForbiddenException("Choose this campus before opening fees.");
        const selected = executionEnvironmentStorage.getStore();
        if (selected && selected.institution_id !== schoolId)
            throw new ForbiddenException("Fees must belong to the selected campus and world.");
        const school = await db.selectFrom("schools").select(["id", "timezone"]).where("id", "=", schoolId).executeTakeFirst();
        if (!school)
            throw new ForbiddenException("This campus is unavailable.");
        const actor = await this.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
        if (!actor.acting)
            throw new ForbiddenException("Your current campus person/account link is unavailable.");
        return { ...school, actor, today: new Intl.DateTimeFormat("en-CA", { timeZone: school.timezone }).format(executionNow()) };
    }
    async manages(db, user, schoolId) {
        try {
            return await operationalFeeAccess(db, user.id, schoolId, true);
        }
        catch (error) {
            if (error instanceof ForbiddenException)
                return null;
            throw error;
        }
    }
    async finance(db, user, schoolId) {
        const technical = await this.manages(db, user, schoolId);
        if (!technical)
            throw new ForbiddenException("Current Finance access is required.");
        const authority = await this.authority.assertDecisionAuthority(db, schoolId, "fee_instalment_decision", user.id, executionNow());
        return { technical, authority };
    }
    async family(db, user, invoice, actor) {
        if (invoice.context_kind === "person") {
            await this.bindInvoiceAccount(db, invoice);
            const self = invoice.user_id === user.id && invoice.person_id === actor.person_id && Boolean((await db.selectFrom("school_memberships")
                .select("id").where("school_id", "=", invoice.school_id).where("user_id", "=", user.id).where("is_active", "=", true).executeTakeFirst()));
            return { self, guardian: false };
        }
        const family = (await sql `SELECT
      (${invoice.user_id}::uuid=${user.id}::uuid AND ${invoice.person_id}::uuid=${actor.person_id}::uuid AND EXISTS(
        SELECT 1 FROM school_memberships WHERE school_id=${invoice.school_id}::uuid AND user_id=${user.id}::uuid AND is_active AND role='student')) AS self,
      EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id
        JOIN guardian_school_profiles profile ON profile.school_id=relationship.school_id AND profile.guardian_id=parent.id
        JOIN school_memberships membership ON membership.school_id=relationship.school_id AND membership.user_id=parent.user_id AND membership.is_active AND membership.role='guardian'
        WHERE relationship.school_id=${invoice.school_id}::uuid AND relationship.student_id=${invoice.student_id}::uuid
          AND parent.user_id=${user.id}::uuid AND profile.person_id=${actor.person_id}::uuid) AS guardian`.execute(db)).rows[0];
        return family;
    }
    /** Resolve the current canonical endpoint through the owning identity port, including retained student/staff links. */
    async bindInvoiceAccount(db, invoice) {
        if (invoice.context_kind !== "person")
            return invoice;
        const endpoint = await this.identities.resolvePersonAgent(db, { school_id: invoice.school_id, person_id: invoice.person_id, at: executionNow().toISOString() });
        invoice.user_id = endpoint.acting ? endpoint.user_id : null;
        return invoice;
    }
    async entitlement(db, invoice, today) {
        const rows = (await sql `SELECT entitlement.id,entitlement.user_id,entitlement.person_id,entitlement.valid_from::text,entitlement.valid_until::text,
      revocation.created_at AS revoked_at,entitlement.stream_revision FROM fee_invoice_self_payer_entitlements entitlement
      LEFT JOIN fee_invoice_self_payer_revocations revocation ON revocation.school_id=entitlement.school_id AND revocation.entitlement_id=entitlement.id
      WHERE entitlement.school_id=${invoice.school_id}::uuid AND entitlement.invoice_id=${invoice.id}::uuid
      ORDER BY entitlement.stream_revision DESC`.execute(db)).rows;
        const active = rows.filter(row => !row.revoked_at && row.valid_from <= today && row.valid_until >= today
            && row.user_id === invoice.user_id && row.person_id === invoice.person_id);
        if (active.length > 1)
            throw new ConflictException("This fee account has overlapping self-payer access. Ask Finance to review it.");
        return { current: active[0] ?? null, latest: rows[0] ?? null, all: rows };
    }
    async canRead(db, user, invoice, actor, today, manager) {
        if (manager ?? Boolean(await this.manages(db, user, invoice.school_id)))
            return true;
        const relation = await this.family(db, user, invoice, actor);
        if (invoice.context_kind !== "person")
            return relation.self || relation.guardian;
        const entitlement = (await this.entitlement(db, invoice, today)).current;
        return relation.self && entitlement?.user_id === user.id && entitlement.person_id === actor.person_id;
    }
    async requester(db, user, invoice, actor, today) {
        const relationship = await this.family(db, user, invoice, actor);
        if (relationship.guardian)
            return { relationship: "guardian", entitlement: null };
        const entitlement = (await this.entitlement(db, invoice, today)).current;
        if (relationship.self && entitlement?.user_id === user.id && entitlement.person_id === actor.person_id)
            return { relationship: "self", entitlement };
        throw new ForbiddenException("A current linked guardian or explicitly enabled self-payer must request instalments.");
    }
};
FinanceArrangementsAccess = __decorate([
    Injectable(),
    __param(0, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(1, Inject(GOVERNANCE_DECISION_AUTHORITY_PORT)),
    __metadata("design:paramtypes", [Object, Object])
], FinanceArrangementsAccess);
export { FinanceArrangementsAccess };
//# sourceMappingURL=finance-arrangements.access.js.map