var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DatabaseService } from "../database/database.service.js";
import { FinanceArrangementsAccess } from "./finance-arrangements.access.js";
import { FinanceArrangementsBridge } from "./finance-arrangements.bridge.js";
import { FinanceArrangementCommands, obsoleteFinanceArrangement } from "./finance-arrangements.commands.js";
import { decideInstalments, enableSelfPayer, financeArrangementResult, financeId, requestInstalments, revokeSelfPayer, withdrawInstalments } from "./finance-arrangements.contracts.js";
import { arrangementBasis, arrangementHistory, arrangementInvoice, arrangementRevision, arrangementSource, financeBasisRevision, financeHash, financeObject } from "./finance-arrangements.store.js";
/** Current authority, not a new recipient selected merely because an office changed. */
export function financeDecisionRouteKey(value) {
    const receipt = financeObject(value), office = financeObject(receipt.office), appointment = financeObject(receipt.appointment), rule = financeObject(receipt.rule);
    return financeHash({ school_id: receipt.school_id, matter_code: receipt.matter_code, user_id: receipt.user_id,
        person_id: financeObject(receipt.person).id, office: { id: office.id, revision: office.revision },
        appointment: { id: appointment.id, revision: appointment.revision }, rule: { id: rule.id, revision: rule.revision },
        sources: Array.isArray(receipt.sources) ? receipt.sources.map(source => ({ id: financeObject(source).id, revision: financeObject(source).revision })) : [],
        fee_instalment_basis: receipt.fee_instalment_basis });
}
export function assertFinanceArrangementLimit(authority, amount) {
    const limit = financeObject(financeObject(authority).fee_instalment_basis).max_amount_paise;
    if (limit !== undefined && limit !== null && (!Number.isSafeInteger(limit) || Number(limit) < 1 || amount > Number(limit))) {
        throw new ForbiddenException("This obligation exceeds the current reviewer’s payment-plan authority. Finance must use an appropriate current mandate.");
    }
}
let FinanceArrangementsService = class FinanceArrangementsService {
    db;
    access;
    commands;
    bridge;
    constructor(db, access, commands, bridge) {
        this.db = db;
        this.access = access;
        this.commands = commands;
        this.bridge = bridge;
    }
    replay(invoice, metadata) {
        const parsed = financeArrangementResult.safeParse(metadata);
        if (!parsed.success || parsed.data.invoice_id !== invoice.id)
            throw new ConflictException("The saved fee result is unavailable. Refresh the source before continuing.");
        return { ...parsed.data, replayed: true };
    }
    async locked(db, user, schoolId, invoiceId) {
        financeId.parse(schoolId);
        financeId.parse(invoiceId);
        const campus = await this.access.campus(db, user, schoolId);
        // Same lock as existing receipt/credit writers; a plan cannot race a ledger change.
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(db);
        const invoice = await arrangementInvoice(db, schoolId, invoiceId, true);
        return { campus, invoice, revision: await arrangementRevision(db, schoolId, invoiceId) };
    }
    async sourceOpen(db, source) {
        const history = await arrangementHistory(db, source.school_id, source.invoice_id);
        if (history.find(row => row.id === source.id)?.status !== "pending")
            throw new ConflictException("This proposal is no longer awaiting a decision. Refresh the fee account.");
    }
    sameOwner(source, authority, actorPerson) {
        if (source.reviewer_user_id !== authority.user_id || source.reviewer_person_id !== actorPerson
            || financeDecisionRouteKey(source.authority_receipt) !== financeDecisionRouteKey(authority)) {
            throw new ConflictException("The review route changed. The requester can withdraw this proposal and send it to the current reviewer.");
        }
    }
    async finish(db, user, invoice, action, sourceId, commandId, revision, audience, result) {
        const eventType = `finance.${action}`, outbox = await this.bridge.outbox(db, invoice, sourceId, user.id, eventType, commandId, revision, audience);
        await this.bridge.accepted(db, invoice, sourceId, user.id, eventType, commandId, revision, outbox.id);
        await this.commands.finish(db, invoice, commandId, revision, outbox.id, result);
        return { outbox, result };
    }
    async enableSelfPayer(user, schoolId, invoiceId, body) {
        const data = enableSelfPayer.parse(body);
        return this.db.transaction().execute(async (db) => {
            const { campus, invoice, revision } = await this.locked(db, user, schoolId, invoiceId);
            const owner = await this.access.finance(db, user, schoolId);
            if (owner.authority.person.id !== campus.actor.person_id)
                throw new ForbiddenException("The decision account must be linked to the appointed person.");
            const prepared = await this.commands.prepare(db, user, campus.actor, invoice, "self_payer.enable", data, revision, owner.authority);
            if (prepared.status === "completed")
                return this.replay(invoice, prepared.metadata);
            assertFinanceArrangementLimit(owner.authority, (await arrangementBasis(db, invoice)).balance_paise);
            await this.access.bindInvoiceAccount(db, invoice);
            if (!invoice.user_id)
                throw new BadRequestException("Link this person’s app account before enabling self-service.");
            const payer = await this.access.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: invoice.user_id, at: executionNow().toISOString() });
            if (!payer.acting || payer.person_id !== invoice.person_id)
                throw new BadRequestException("This learner’s current person/account link needs review.");
            if (!(await this.access.family(db, { ...user, id: invoice.user_id }, invoice, payer)).self)
                throw new BadRequestException("An active learner account is required.");
            if (data.valid_from < campus.today)
                throw new BadRequestException("Self-service cannot begin in the past.");
            const existing = (await this.access.entitlement(db, invoice, campus.today)).all;
            if (existing.some(row => !row.revoked_at && row.valid_until >= campus.today))
                throw new ConflictException("Self-service is already active or scheduled. Revoke that access before replacing it.");
            const next = revision + 1;
            await sql `INSERT INTO fee_invoice_self_payer_entitlements(id,school_id,invoice_id,student_id,invoice_person_id,user_id,person_id,valid_from,valid_until,adult_self_payer_attested,
        approved_by,authority_receipt,stream_revision,command_id,created_at) VALUES(${data.entitlement_id}::uuid,${schoolId}::uuid,${invoice.id}::uuid,
        ${invoice.student_id}::uuid,${invoice.student_id ? null : invoice.person_id}::uuid,${invoice.user_id}::uuid,${invoice.person_id}::uuid,${data.valid_from}::date,${data.valid_until}::date,true,${user.id}::uuid,
        ${JSON.stringify(owner.authority)}::jsonb,${next},${prepared.command_id}::uuid,${executionNow()})`.execute(db);
            const result = { id: data.entitlement_id, invoice_id: invoice.id, revision: next, replayed: false };
            await this.finish(db, user, invoice, "self_payer.enabled", data.entitlement_id, prepared.command_id, next, [invoice.user_id], result);
            return result;
        });
    }
    async revokeSelfPayer(user, schoolId, invoiceId, body) {
        const data = revokeSelfPayer.parse(body);
        return this.db.transaction().execute(async (db) => {
            const { campus, invoice, revision } = await this.locked(db, user, schoolId, invoiceId), owner = await this.access.finance(db, user, schoolId);
            if (owner.authority.person.id !== campus.actor.person_id)
                throw new ForbiddenException("The decision account must be linked to the appointed person.");
            const prepared = await this.commands.prepare(db, user, campus.actor, invoice, "self_payer.revoke", data, revision, owner.authority);
            if (prepared.status === "completed")
                return this.replay(invoice, prepared.metadata);
            const entitlement = (await this.access.entitlement(db, invoice, campus.today)).all.find(row => row.id === data.entitlement_id);
            if (!entitlement || entitlement.revoked_at)
                throw new ConflictException("This self-service access is no longer available to revoke.");
            const id = randomUUID(), next = revision + 1;
            await sql `INSERT INTO fee_invoice_self_payer_revocations(id,school_id,invoice_id,entitlement_id,revoked_by,reason,authority_receipt,stream_revision,command_id,created_at)
        VALUES(${id}::uuid,${schoolId}::uuid,${invoice.id}::uuid,${data.entitlement_id}::uuid,${user.id}::uuid,${data.reason},
          ${JSON.stringify(owner.authority)}::jsonb,${next},${prepared.command_id}::uuid,${executionNow()})`.execute(db);
            const result = { id, invoice_id: invoice.id, revision: next, replayed: false };
            await this.finish(db, user, invoice, "self_payer.revoked", id, prepared.command_id, next, [entitlement.user_id], result);
            return result;
        });
    }
    async request(user, schoolId, invoiceId, body) {
        const data = requestInstalments.parse(body);
        return this.db.transaction().execute(async (db) => {
            const { campus, invoice, revision } = await this.locked(db, user, schoolId, invoiceId);
            const requester = await this.access.requester(db, user, invoice, campus.actor, campus.today);
            const owner = await this.access.authority.resolveDecisionOwner(db, schoolId, "fee_instalment_decision", executionNow());
            const reviewer = await this.access.identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: owner.user_id, at: executionNow().toISOString() });
            if (!reviewer.acting || reviewer.person_id !== owner.person.id || !await this.access.manages(db, { ...user, id: owner.user_id }, schoolId))
                throw new ConflictException("Finance’s current reviewer needs access before this proposal can be sent.");
            if (owner.user_id === user.id)
                throw new ForbiddenException("Another authorized Finance reviewer must decide your own proposal.");
            const prepared = await this.commands.prepare(db, user, campus.actor, invoice, "request", data, revision, { relationship: requester.relationship, person_id: campus.actor.person_id, entitlement_id: requester.entitlement?.id ?? null });
            if (prepared.status === "completed")
                return this.replay(invoice, prepared.metadata);
            const basis = await arrangementBasis(db, invoice);
            assertFinanceArrangementLimit(owner, basis.balance_paise);
            const basisRevision = financeBasisRevision(basis);
            if (basisRevision < data.basis_revision)
                throw new BadRequestException("This proposed ledger basis is unavailable. Refresh this account.");
            if (basisRevision > data.basis_revision || financeHash(basis) !== data.basis_hash)
                throw obsoleteFinanceArrangement("The fee balance changed. Refresh and review the amounts before sending your proposal.", {
                    invoice_id: invoice.id, command_id: data.command_id, request_id: data.request_id, expected_revision: data.expected_revision,
                    current_revision: revision, reason: "ledger_basis_diverged",
                });
            if (!basis.balance_paise || data.schedule.reduce((sum, row) => sum + row.amount_paise, 0) !== basis.balance_paise)
                throw new BadRequestException("The proposed amounts must add up to the current outstanding balance.");
            if (data.schedule.some(row => row.due_on < campus.today))
                throw new BadRequestException("Choose today or a later date for each instalment.");
            if ((await arrangementHistory(db, schoolId, invoice.id)).some(row => row.status === "pending"))
                throw new ConflictException("This invoice already has a proposal awaiting review. Open or withdraw it first.");
            const next = revision + 1, outbox = await this.bridge.outbox(db, invoice, data.request_id, user.id, "finance.instalment.requested", prepared.command_id, next, [owner.user_id]);
            const route = await this.bridge.requested(db, { invoice, request_id: data.request_id, actor_id: user.id, command_id: data.command_id,
                outbox_id: outbox.id, revision: next, owner });
            await sql `INSERT INTO fee_instalment_requests(id,school_id,invoice_id,student_id,beneficiary_person_id,submitted_by,submitter_person_id,submitter_relationship,entitlement_id,note,schedule,
        ledger_basis,basis_hash,reviewer_user_id,reviewer_person_id,authority_receipt,coordination_receipt,stream_revision,command_id,correlation_id,created_at)
        VALUES(${data.request_id}::uuid,${schoolId}::uuid,${invoice.id}::uuid,${invoice.student_id}::uuid,${invoice.student_id ? null : invoice.person_id}::uuid,${user.id}::uuid,${campus.actor.person_id}::uuid,
          ${requester.relationship},${requester.entitlement?.id ?? null}::uuid,${data.note},${JSON.stringify(data.schedule)}::jsonb,${JSON.stringify(basis)}::jsonb,
          ${data.basis_hash},${owner.user_id}::uuid,${owner.person.id}::uuid,${JSON.stringify(owner)}::jsonb,${JSON.stringify(route)}::jsonb,${next},
          ${prepared.command_id}::uuid,${data.command_id}::uuid,${executionNow()})`.execute(db);
            const result = { id: data.request_id, invoice_id: invoice.id, revision: next, replayed: false };
            await this.commands.finish(db, invoice, prepared.command_id, next, outbox.id, result);
            return result;
        });
    }
    async decide(user, schoolId, requestId, body) {
        financeId.parse(requestId);
        const data = decideInstalments.parse(body);
        return this.db.transaction().execute(async (db) => {
            await this.access.campus(db, user, schoolId);
            const source = await arrangementSource(db, schoolId, requestId), { campus, invoice, revision } = await this.locked(db, user, schoolId, source.invoice_id);
            const owner = await this.access.finance(db, user, schoolId);
            this.sameOwner(source, owner.authority, campus.actor.person_id);
            await this.bridge.assertCurrentRoute(db, source, false);
            if (source.submitted_by === user.id)
                throw new ForbiddenException("You cannot decide your own instalment proposal.");
            const prepared = await this.commands.prepare(db, user, campus.actor, invoice, "decide", data, revision, owner.authority, { request_id: source.id });
            if (prepared.status === "completed")
                return this.replay(invoice, prepared.metadata);
            await this.bridge.assertCurrentRoute(db, source);
            await this.sourceOpen(db, source);
            if (data.decision === "approved")
                assertFinanceArrangementLimit(owner.authority, source.schedule.reduce((sum, row) => sum + row.amount_paise, 0));
            if (data.decision === "approved" && financeHash(await arrangementBasis(db, invoice)) !== source.basis_hash)
                throw obsoleteFinanceArrangement("The ledger changed after this proposal. Reject it with an explanation so the payer can propose the current balance.", {
                    invoice_id: invoice.id, command_id: data.command_id, request_id: source.id, expected_revision: data.expected_revision,
                    current_revision: revision, reason: "ledger_basis_diverged",
                });
            const next = revision + 1, id = randomUUID();
            await sql `INSERT INTO fee_instalment_decisions(id,school_id,invoice_id,request_id,decision,response,decided_by,authority_receipt,stream_revision,command_id,created_at)
        VALUES(${id}::uuid,${schoolId}::uuid,${invoice.id}::uuid,${source.id}::uuid,${data.decision},${data.response},${user.id}::uuid,
          ${JSON.stringify(owner.authority)}::jsonb,${next},${prepared.command_id}::uuid,${executionNow()})`.execute(db);
            const result = { id, request_id: source.id, invoice_id: invoice.id, revision: next, decision: data.decision, replayed: false };
            const outbox = await this.bridge.outbox(db, invoice, source.id, user.id, "finance.instalment.decided", prepared.command_id, next, [source.submitted_by]);
            await this.bridge.decide(db, source, user.id, prepared.command_id, outbox.id, next, data.decision);
            await this.bridge.accepted(db, invoice, source.id, user.id, "finance.instalment.decided", prepared.command_id, next, outbox.id);
            await this.commands.finish(db, invoice, prepared.command_id, next, outbox.id, result);
            return result;
        });
    }
    async withdraw(user, schoolId, requestId, body) {
        financeId.parse(requestId);
        const data = withdrawInstalments.parse(body);
        return this.db.transaction().execute(async (db) => {
            await this.access.campus(db, user, schoolId);
            const source = await arrangementSource(db, schoolId, requestId), { campus, invoice, revision } = await this.locked(db, user, schoolId, source.invoice_id);
            const relation = await this.access.family(db, user, invoice, campus.actor);
            if (source.submitted_by !== user.id || source.submitter_person_id !== campus.actor.person_id || !relation.self && !relation.guardian)
                throw new ForbiddenException("Only the current linked requester can withdraw this proposal.");
            const prepared = await this.commands.prepare(db, user, campus.actor, invoice, "withdraw", data, revision, { person_id: campus.actor.person_id, relationship: relation }, { request_id: source.id });
            if (prepared.status === "completed")
                return this.replay(invoice, prepared.metadata);
            await this.sourceOpen(db, source);
            const next = revision + 1, id = randomUUID();
            await sql `INSERT INTO fee_instalment_withdrawals(id,school_id,invoice_id,request_id,withdrawn_by,stream_revision,command_id,created_at)
        VALUES(${id}::uuid,${schoolId}::uuid,${invoice.id}::uuid,${source.id}::uuid,${user.id}::uuid,${next},${prepared.command_id}::uuid,${executionNow()})`.execute(db);
            const outbox = await this.bridge.outbox(db, invoice, source.id, user.id, "finance.instalment.withdrawn", prepared.command_id, next, [source.reviewer_user_id]);
            const closure = await this.bridge.withdraw(db, source, user.id, prepared.command_id, outbox.id);
            const result = { id, request_id: source.id, invoice_id: invoice.id, revision: next, replayed: false, ...closure };
            await this.bridge.accepted(db, invoice, source.id, user.id, "finance.instalment.withdrawn", prepared.command_id, next, outbox.id);
            await this.commands.finish(db, invoice, prepared.command_id, next, outbox.id, result);
            return result;
        });
    }
};
FinanceArrangementsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, FinanceArrangementsAccess,
        FinanceArrangementCommands, FinanceArrangementsBridge])
], FinanceArrangementsService);
export { FinanceArrangementsService };
//# sourceMappingURL=finance-arrangements.service.js.map