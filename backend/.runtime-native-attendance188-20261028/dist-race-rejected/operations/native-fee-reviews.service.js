var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DatabaseService } from "../database/database.service.js";
import { operationalFeeAccess } from "./operational-fee-access.js";
import { FinanceArrangementsAccess } from "./finance-arrangements.access.js";
import { arrangementBasis, arrangementInvoice, financeBasisRevision, financeHash } from "./finance-arrangements.store.js";
import { nativeFeeDecision, nativeFeeReport, nativeFeeWithdraw } from "./native-fee-reviews.contracts.js";
import { NativeFeeReviewsModel, nativeFeeReviewHref, obsoleteNativeFeeReview } from "./native-fee-reviews.model.js";
export async function nativeFeeReviewRevision(tx, schoolId, invoiceId) {
    return (await sql `SELECT coalesce(max(stream_revision),0)::int AS revision FROM (
    SELECT stream_revision FROM fee_native_review_requests WHERE school_id=${schoolId}::uuid AND invoice_id=${invoiceId}::uuid
    UNION ALL SELECT stream_revision FROM fee_native_review_decisions WHERE school_id=${schoolId}::uuid AND invoice_id=${invoiceId}::uuid
    UNION ALL SELECT stream_revision FROM fee_native_review_withdrawals WHERE school_id=${schoolId}::uuid AND invoice_id=${invoiceId}::uuid
  ) revisions`.execute(tx)).rows[0].revision;
}
async function nativeHistory(tx, schoolId, invoiceId) {
    return (await sql `SELECT request.*,coalesce(decision.outcome,CASE WHEN withdrawal.id IS NOT NULL THEN 'withdrawn' ELSE 'pending' END) AS status,
    decision.response,decision.payment_id,decision.created_at AS decided_at
    FROM fee_native_review_requests request LEFT JOIN fee_native_review_decisions decision ON decision.school_id=request.school_id AND decision.review_id=request.id
    LEFT JOIN fee_native_review_withdrawals withdrawal ON withdrawal.school_id=request.school_id AND withdrawal.review_id=request.id
    WHERE request.school_id=${schoolId}::uuid AND request.invoice_id=${invoiceId}::uuid ORDER BY request.stream_revision DESC`.execute(tx)).rows;
}
let NativeFeeReviewsService = class NativeFeeReviewsService {
    db;
    access;
    model;
    constructor(db, access, model) {
        this.db = db;
        this.access = access;
        this.model = model;
    }
    async reviewer(tx, schoolId, userId) {
        let access;
        try {
            access = await operationalFeeAccess(tx, userId, schoolId, true);
        }
        catch (error) {
            if (error instanceof ForbiddenException)
                return null;
            throw error;
        }
        const actor = await this.access.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: userId, at: executionNow().toISOString() });
        if (!actor.acting)
            return null;
        const sources = [...access.sources].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        return { user_id: userId, person_id: actor.person_id, label: actor.label, sources,
            eligibility_hash: financeHash({ user_id: userId, person_id: actor.person_id, endpoint_id: actor.endpoint_id, sources }) };
    }
    async reviewers(tx, schoolId, actor) {
        // The query enumerates potential operational reviewers only, never a general
        // member directory. Current native access and identity are checked per row.
        const ids = (await sql `WITH campus AS (SELECT (${executionNow()}::timestamptz AT TIME ZONE timezone)::date AS today FROM schools WHERE id=${schoolId}::uuid)
      SELECT DISTINCT membership.user_id FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active CROSS JOIN campus
      WHERE membership.school_id=${schoolId}::uuid AND membership.is_active AND membership.role IN ('staff','admin') AND membership.user_id<>${actor.user_id}::uuid
        AND (membership.role='admin' OR EXISTS(SELECT 1 FROM staff_role_bindings binding WHERE binding.school_id=membership.school_id AND binding.user_id=membership.user_id
          AND binding.context_kind='institution' AND binding.scope_id=${schoolId}::uuid
          AND binding.status='active' AND binding.role_active AND binding.starts_on<=campus.today AND(binding.ends_on IS NULL OR binding.ends_on>=campus.today)
          AND 'fees.manage'=ANY(binding.permissions)) OR EXISTS(SELECT 1 FROM school_access_exceptions exception WHERE exception.school_id=membership.school_id
          AND exception.user_id=membership.user_id AND exception.permission='fees.manage' AND exception.scope_kind='institution'
          AND exception.status='active' AND campus.today BETWEEN exception.valid_from AND exception.valid_until))
      ORDER BY membership.user_id LIMIT 201`.execute(tx)).rows;
        if (ids.length > 200)
            throw new ConflictException("There are too many possible Finance operators. Ask campus setup to narrow the responsibility before selecting a reviewer.");
        const result = [];
        for (const row of ids) {
            const candidate = await this.reviewer(tx, schoolId, row.user_id);
            if (candidate && candidate.person_id !== actor.person_id)
                result.push({ user_id: candidate.user_id, person_id: candidate.person_id, label: candidate.label, eligibility_hash: candidate.eligibility_hash });
        }
        return result.sort((a, b) => a.label.localeCompare(b.label) || a.user_id.localeCompare(b.user_id));
    }
    async relation(tx, user, invoice, campus) {
        const manager = await this.access.manages(tx, user, invoice.school_id), family = await this.access.family(tx, user, invoice, campus.actor);
        if (!manager && !family.self && !family.guardian)
            throw new ForbiddenException("This fee account is not in your current responsibility or relationship.");
        return { manager, ...family };
    }
    async requester(tx, user, invoice, campus) {
        const relation = await this.relation(tx, user, invoice, campus);
        if (relation.guardian)
            return { relationship: "guardian", entitlement: null };
        if (relation.self) {
            const entitlement = (await this.access.entitlement(tx, invoice, campus.today)).current;
            if (entitlement?.user_id === user.id && entitlement.person_id === campus.actor.person_id)
                return { relationship: "self", entitlement };
        }
        if (relation.manager)
            return { relationship: "assisted", entitlement: null };
        throw new ForbiddenException("Finance must explicitly enable your current invoice access before you can report a payment or ask a fee question.");
    }
    async routeState(tx, request) {
        const reviewer = await this.reviewer(tx, request.school_id, request.reviewer_user_id);
        const protocol = await this.model.routeState(tx, request);
        return { reviewer, ...protocol, state: !reviewer || reviewer.person_id !== request.reviewer_person_id || reviewer.eligibility_hash !== request.reviewer_basis.eligibility_hash
                ? "needs_reassignment" : !protocol.open ? "route_unavailable" : "waiting_for_review" };
    }
    async audit(tx, user, invoice, reviewId, action) {
        await sql `INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES(${invoice.school_id}::uuid,${user.id}::uuid,${`finance.payment_review.${action}`},${reviewId}::uuid,${JSON.stringify({ invoice_id: invoice.id })}::jsonb)`.execute(tx);
    }
    async workspace(user, schoolId, query = {}) {
        z.uuid().parse(schoolId);
        for (const value of Object.values(query))
            if (value)
                z.uuid().parse(value);
        if (query.student_id && query.person_id)
            throw new BadRequestException("Open one exact fee account.");
        if (query.command_id && !query.invoice_id)
            throw new BadRequestException("Open the exact invoice to confirm the pending action.");
        return this.db.transaction().execute(async (tx) => {
            const campus = await this.access.campus(tx, user, schoolId), manager = await this.access.manages(tx, user, schoolId);
            if (!manager && !query.invoice_id && !query.student_id && !query.person_id)
                throw new ForbiddenException("Open your exact fee account.");
            if (!manager && query.person_id && query.person_id !== campus.actor.person_id)
                throw new ForbiddenException("Open your own exact fee account.");
            if (query.command_id)
                await sql `SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(tx);
            const ids = (await sql `SELECT invoice.id FROM fee_invoices invoice
        LEFT JOIN students student ON student.school_id=invoice.school_id AND student.id=invoice.student_id
        WHERE invoice.school_id=${schoolId}::uuid AND (${query.invoice_id ?? null}::uuid IS NULL OR invoice.id=${query.invoice_id ?? null}::uuid)
          AND (${query.student_id ?? null}::uuid IS NULL OR invoice.student_id=${query.student_id ?? null}::uuid)
          AND (${query.person_id ?? null}::uuid IS NULL OR coalesce(invoice.person_id,student.person_id)=${query.person_id ?? null}::uuid)
        ORDER BY invoice.created_at DESC,invoice.id LIMIT 101`.execute(tx)).rows;
            if (ids.length > 100)
                throw new ConflictException("Open one fee account or invoice to review its reports.");
            const invoices = [];
            for (const { id } of ids) {
                const invoice = await arrangementInvoice(tx, schoolId, id), relation = await this.relation(tx, user, invoice, campus);
                if (!await this.access.canRead(tx, user, invoice, campus.actor, campus.today, Boolean(relation.manager))) {
                    if (query.invoice_id)
                        throw new ForbiddenException("Your current invoice access is unavailable.");
                    continue;
                }
                const basis = await arrangementBasis(tx, invoice), history = await nativeHistory(tx, schoolId, id);
                let permission = null;
                try {
                    permission = await this.requester(tx, user, invoice, campus);
                }
                catch (error) {
                    if (!(error instanceof ForbiddenException))
                        throw error;
                }
                const reviewers = permission ? await this.reviewers(tx, schoolId, campus.actor) : [];
                const reviews = [];
                for (const row of history) {
                    if (row.route_kind === "guardian_queue")
                        continue; // Same source owner, different established authorization/action adapter.
                    const route = row.status === "pending" ? await this.routeState(tx, row) : null;
                    reviews.push({ id: row.id, invoice_id: id, kind: row.kind, amount_paise: row.amount_paise, method: row.method, reference: row.reference, note: row.note,
                        submitted_at: new Date(row.created_at).toISOString(), status: row.status, revision: row.stream_revision,
                        reviewer: { user_id: row.reviewer_user_id, person_id: row.reviewer_person_id, label: row.reviewer_basis.label },
                        route_state: route?.state ?? null, basis_changed: row.basis_hash !== financeHash(basis),
                        can_decide: Boolean(row.status === "pending" && relation.manager && row.reviewer_user_id === user.id && row.reviewer_person_id === campus.actor.person_id
                            && row.submitted_by !== user.id && route?.state === "waiting_for_review"),
                        can_verify: Boolean(row.status === "pending" && row.kind === "payment" && row.reviewer_user_id === user.id && route?.state === "waiting_for_review" && row.basis_hash === financeHash(basis)),
                        can_withdraw: row.status === "pending" && row.submitted_by === user.id && row.submitter_person_id === campus.actor.person_id,
                        response: row.response, payment_id: row.payment_id, decided_at: row.decided_at ? new Date(row.decided_at).toISOString() : null });
                }
                invoices.push({ id, student_id: invoice.student_id, person_id: invoice.person_id, context_kind: invoice.context_kind,
                    label: invoice.student_label, reference: invoice.reference, description: invoice.description, balance_paise: basis.balance_paise,
                    basis_hash: financeHash(basis), basis_revision: financeBasisRevision(basis),
                    stream_revision: await nativeFeeReviewRevision(tx, schoolId, id),
                    can_report: Boolean(permission && reviewers.length && basis.balance_paise > 0 && !history.some(row => row.kind === "payment" && row.status === "pending")),
                    can_question: Boolean(permission && reviewers.length && !history.some(row => row.kind === "charge" && row.status === "pending")), reviewers, reviews });
            }
            if (query.invoice_id && !invoices.length)
                throw new NotFoundException("This fee account is unavailable.");
            const confirmation = query.command_id && query.invoice_id ? await this.model.confirmation(tx, user, await arrangementInvoice(tx, schoolId, query.invoice_id), query.command_id) : undefined;
            return { school_id: schoolId, today: campus.today, timezone: campus.timezone, can_manage: Boolean(manager), invoices, ...(confirmation ? { confirmation } : {}) };
        });
    }
    async report(user, schoolId, invoiceId, body) {
        z.uuid().parse(schoolId);
        z.uuid().parse(invoiceId);
        const data = nativeFeeReport.parse(body);
        return this.db.transaction().execute(async (tx) => {
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(tx);
            const campus = await this.access.campus(tx, user, schoolId), invoice = await arrangementInvoice(tx, schoolId, invoiceId, true);
            const requester = await this.requester(tx, user, invoice, campus), revision = await nativeFeeReviewRevision(tx, schoolId, invoiceId);
            const prepared = await this.model.prepare(tx, user, campus.actor, invoice, data.review_id, "report", data, revision, { relationship: requester.relationship, person_id: campus.actor.person_id, entitlement_id: requester.entitlement?.id ?? null });
            if (prepared.replay)
                return prepared.replay;
            const candidate = await this.reviewer(tx, schoolId, data.reviewer.user_id);
            if (!candidate || candidate.person_id !== data.reviewer.person_id || candidate.eligibility_hash !== data.reviewer.eligibility_hash)
                throw new BadRequestException("The selected Finance operator changed. Review the current recipient before sending.");
            if (candidate.user_id === user.id || candidate.person_id === campus.actor.person_id)
                throw new ForbiddenException("Choose another fee operator. Nobody may verify their own report.");
            const basis = await arrangementBasis(tx, invoice);
            const basisRevision = financeBasisRevision(basis);
            if (data.basis_hash !== financeHash(basis) || data.basis_revision !== basisRevision) {
                if (basisRevision > data.basis_revision)
                    throw obsoleteNativeFeeReview(invoice.id, data.review_id, data, revision, "ledger_basis_diverged");
                throw new ConflictException("This ledger basis is unavailable. Refresh the exact account; keep the same pending action until its outcome is known.");
            }
            if ((await nativeHistory(tx, schoolId, invoiceId)).some(row => row.kind === data.kind && row.status === "pending"))
                throw new BadRequestException("This invoice already has that kind of review pending.");
            if (data.kind === "payment") {
                if (data.amount_paise > basis.balance_paise)
                    throw new BadRequestException("The reported amount exceeds this invoice’s current balance.");
                if (await this.duplicate(tx, schoolId, data.method, data.reference))
                    throw new BadRequestException("This payment reference is already recorded or awaiting review.");
            }
            if ((await sql `SELECT 1 FROM fee_native_review_requests WHERE id=${data.review_id}::uuid`.execute(tx)).rows.length)
                throw new BadRequestException("This review identity is already used.");
            const next = revision + 1, route = await this.model.route(tx, user, invoice, data.review_id, next, candidate, data.command_id, { relationship: requester.relationship, person_id: campus.actor.person_id });
            const event = await this.model.event(tx, user, invoice, data.review_id, next, data.command_id, "reported", [user.id, candidate.user_id], { ...route, recipient: candidate.user_id });
            // Store the complete retained route once. Delivery, native state and the
            // accepted command share this transaction and roll back together.
            await sql `INSERT INTO fee_native_review_requests(id,school_id,invoice_id,kind,amount_paise,method,reference,note,submitted_by,submitter_person_id,
        submitter_relationship,entitlement_id,reviewer_user_id,reviewer_person_id,reviewer_basis,ledger_basis,basis_hash,coordination_receipt,stream_revision,command_id,created_at)
        VALUES(${data.review_id}::uuid,${schoolId}::uuid,${invoiceId}::uuid,${data.kind},${data.kind === "payment" ? data.amount_paise : null},
          ${data.kind === "payment" ? data.method : null},${data.kind === "payment" ? data.reference : null},${data.note},${user.id}::uuid,${campus.actor.person_id}::uuid,
          ${requester.relationship},${requester.entitlement?.id ?? null}::uuid,${candidate.user_id}::uuid,${candidate.person_id}::uuid,
          ${JSON.stringify({ eligibility_hash: candidate.eligibility_hash, label: candidate.label })}::jsonb,${JSON.stringify(basis)}::jsonb,${financeHash(basis)},
          ${JSON.stringify({ ...route, ...event.receipt })}::jsonb,${next},${data.command_id}::uuid,${executionNow()}::timestamptz)`.execute(tx);
            await this.audit(tx, user, invoice, data.review_id, "reported");
            const result = { id: data.review_id, invoice_id: invoiceId, revision: next, replayed: false };
            await this.model.finish(tx, invoice, prepared.command_id, next, event.outbox_id, result);
            return result;
        });
    }
    async duplicate(tx, schoolId, method, reference) {
        return Boolean((await sql `SELECT 1 FROM fee_effective_payments WHERE school_id=${schoolId}::uuid AND method=${method} AND lower(trim(reference))=lower(trim(${reference}))
      UNION ALL SELECT 1 FROM fee_native_review_requests request WHERE request.school_id=${schoolId}::uuid AND request.kind='payment' AND request.method=${method}
        AND lower(trim(request.reference))=lower(trim(${reference}))
        AND NOT EXISTS(SELECT 1 FROM fee_native_review_decisions d WHERE d.school_id=request.school_id AND d.review_id=request.id)
        AND NOT EXISTS(SELECT 1 FROM fee_native_review_withdrawals w WHERE w.school_id=request.school_id AND w.review_id=request.id)`.execute(tx)).rows.length);
    }
    async source(tx, schoolId, reviewId) {
        const row = (await sql `SELECT request.*,coalesce(decision.outcome,CASE WHEN withdrawal.id IS NOT NULL THEN 'withdrawn' ELSE 'pending' END) AS status,
      decision.response,decision.payment_id,decision.created_at AS decided_at FROM fee_native_review_requests request
      LEFT JOIN fee_native_review_decisions decision ON decision.school_id=request.school_id AND decision.review_id=request.id
      LEFT JOIN fee_native_review_withdrawals withdrawal ON withdrawal.school_id=request.school_id AND withdrawal.review_id=request.id
      WHERE request.school_id=${schoolId}::uuid AND request.id=${reviewId}::uuid AND request.route_kind='named'`.execute(tx)).rows[0];
        if (!row)
            throw new NotFoundException("This fee review is unavailable.");
        return row;
    }
    async decide(user, schoolId, reviewId, body) {
        z.uuid().parse(schoolId);
        z.uuid().parse(reviewId);
        const data = nativeFeeDecision.parse(body);
        return this.db.transaction().execute(async (tx) => {
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(tx);
            const campus = await this.access.campus(tx, user, schoolId), request = await this.source(tx, schoolId, reviewId);
            const invoice = await arrangementInvoice(tx, schoolId, request.invoice_id, true), reviewer = await this.reviewer(tx, schoolId, user.id);
            if (!reviewer || reviewer.person_id !== request.reviewer_person_id || user.id !== request.reviewer_user_id)
                throw new ForbiddenException("Only the same currently eligible named fee operator can decide this review.");
            if (user.id === request.submitted_by || campus.actor.person_id === request.submitter_person_id)
                throw new ForbiddenException("Another fee operator must independently verify your report.");
            const revision = await nativeFeeReviewRevision(tx, schoolId, invoice.id), prepared = await this.model.prepare(tx, user, campus.actor, invoice, reviewId, "decide", data, revision, { reviewer_person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash, sources: reviewer.sources });
            if (prepared.replay)
                return prepared.replay;
            if (reviewer.eligibility_hash !== request.reviewer_basis.eligibility_hash)
                throw new ForbiddenException("This fee reviewer’s retained responsibility changed. The sender can withdraw and send it again.");
            if (request.status !== "pending")
                throw obsoleteNativeFeeReview(invoice.id, reviewId, data, revision, "already_decided");
            if (request.kind === "charge" ? data.outcome !== "answered" : !["verified", "rejected"].includes(data.outcome))
                throw new BadRequestException("Choose a decision appropriate to this fee review.");
            if ((await this.routeState(tx, request)).state !== "waiting_for_review")
                throw new ConflictException("This fee review delivery changed. Its sender can withdraw and send it again.");
            let paymentId = null;
            if (data.outcome === "verified") {
                if (!data.verified_funds)
                    throw new BadRequestException("Confirm the funds were independently checked and any cheque has cleared.");
                const basis = await arrangementBasis(tx, invoice);
                if (request.basis_hash !== financeHash(basis))
                    throw obsoleteNativeFeeReview(invoice.id, reviewId, data, revision, "ledger_basis_diverged");
                if (!request.amount_paise || request.amount_paise > basis.balance_paise)
                    throw new ConflictException("The remaining balance no longer supports this reported amount.");
                const duplicate = (await sql `SELECT 1 FROM fee_effective_payments WHERE school_id=${schoolId}::uuid AND method=${request.method}
          AND lower(trim(reference))=lower(trim(${request.reference}))`.execute(tx)).rows;
                if (duplicate.length)
                    throw new BadRequestException("This payment reference is already in the ledger. Reject the duplicate report with an explanation.");
                paymentId = (await sql `INSERT INTO fee_payments(school_id,invoice_id,amount_paise,method,reference,idempotency_key,recorded_by,created_at)
          VALUES(${schoolId}::uuid,${invoice.id}::uuid,${request.amount_paise},${request.method},${request.reference},${reviewId}::uuid,${user.id}::uuid,${executionNow()}::timestamptz) RETURNING id`.execute(tx)).rows[0].id;
            }
            const next = revision + 1, decisionId = randomUUID();
            await sql `INSERT INTO fee_native_review_decisions(id,school_id,invoice_id,review_id,outcome,response,payment_id,reviewed_by,reviewer_person_id,authority_receipt,stream_revision,command_id,created_at)
        VALUES(${decisionId}::uuid,${schoolId}::uuid,${invoice.id}::uuid,${reviewId}::uuid,${data.outcome},${data.response},${paymentId}::uuid,${user.id}::uuid,${reviewer.person_id}::uuid,
          ${JSON.stringify({ eligibility_hash: reviewer.eligibility_hash, sources: reviewer.sources })}::jsonb,${next},${data.command_id}::uuid,${executionNow()}::timestamptz)`.execute(tx);
            const event = await this.model.event(tx, user, invoice, reviewId, next, data.command_id, "decided", [user.id, request.submitted_by]);
            await this.model.close(tx, user, request, data.command_id, event.outbox_id, "decided");
            await this.audit(tx, user, invoice, reviewId, "decided");
            const result = { id: reviewId, invoice_id: invoice.id, revision: next, replayed: false, payment_id: paymentId, outcome: data.outcome };
            await this.model.finish(tx, invoice, prepared.command_id, next, event.outbox_id, result);
            return result;
        });
    }
    async withdraw(user, schoolId, reviewId, body) {
        z.uuid().parse(schoolId);
        z.uuid().parse(reviewId);
        const data = nativeFeeWithdraw.parse(body);
        return this.db.transaction().execute(async (tx) => {
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(tx);
            const campus = await this.access.campus(tx, user, schoolId), request = await this.source(tx, schoolId, reviewId), invoice = await arrangementInvoice(tx, schoolId, request.invoice_id, true);
            if (request.submitted_by !== user.id || request.submitter_person_id !== campus.actor.person_id)
                throw new ForbiddenException("Only this report’s sender can withdraw it.");
            const revision = await nativeFeeReviewRevision(tx, schoolId, invoice.id), prepared = await this.model.prepare(tx, user, campus.actor, invoice, reviewId, "withdraw", data, revision, { submitter_person_id: campus.actor.person_id });
            if (prepared.replay)
                return prepared.replay;
            if (request.status !== "pending")
                throw obsoleteNativeFeeReview(invoice.id, reviewId, data, revision, "already_decided");
            const next = revision + 1;
            await sql `INSERT INTO fee_native_review_withdrawals(id,school_id,invoice_id,review_id,withdrawn_by,stream_revision,command_id,created_at)
        VALUES(${randomUUID()}::uuid,${schoolId}::uuid,${invoice.id}::uuid,${reviewId}::uuid,${user.id}::uuid,${next},${data.command_id}::uuid,${executionNow()}::timestamptz)`.execute(tx);
            const event = await this.model.event(tx, user, invoice, reviewId, next, data.command_id, "withdrawn", [user.id, request.reviewer_user_id]);
            await this.model.close(tx, user, request, data.command_id, event.outbox_id, "withdrawn");
            await this.audit(tx, user, invoice, reviewId, "withdrawn");
            const result = { id: reviewId, invoice_id: invoice.id, revision: next, replayed: false, outcome: "withdrawn" };
            await this.model.finish(tx, invoice, prepared.command_id, next, event.outbox_id, result);
            return result;
        });
    }
    /** Narrow correction path for the exact sender after broader invoice or
     * operator access ends. It cannot read the private account or replace review. */
    async recovery(user, schoolId, reviewId, commandId) {
        z.uuid().parse(schoolId);
        z.uuid().parse(reviewId);
        if (commandId)
            z.uuid().parse(commandId);
        return this.db.transaction().execute(async (tx) => {
            const campus = await this.access.campus(tx, user, schoolId);
            if (commandId)
                await sql `SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(tx);
            const source = await this.source(tx, schoolId, reviewId);
            if (source.submitted_by !== user.id || source.submitter_person_id !== campus.actor.person_id)
                throw new ForbiddenException("Only this report’s current original sender can open its withdrawal recovery.");
            const confirmation = commandId ? await this.model.confirmation(tx, user, await arrangementInvoice(tx, schoolId, source.invoice_id), commandId) : undefined;
            if (confirmation && confirmation.state !== "not_found" && (confirmation.source_id !== reviewId || confirmation.action !== "withdraw"))
                throw new ConflictException("This confirmation does not belong to this exact withdrawal.");
            return { id: source.id, invoice_id: source.invoice_id, stream_revision: await nativeFeeReviewRevision(tx, schoolId, source.invoice_id), status: source.status,
                reviewer: { user_id: source.reviewer_user_id, label: source.reviewer_basis.label }, can_withdraw: source.status === "pending", ...(confirmation ? { confirmation } : {}) };
        });
    }
    async work(user, schoolId) {
        return this.db.transaction().setIsolationLevel("repeatable read").execute(async (tx) => {
            let campus;
            try {
                campus = await this.access.campus(tx, user, schoolId);
            }
            catch (error) {
                if (error instanceof ForbiddenException && error.message.includes("person/account link"))
                    return { needs_me: [], waiting: [] };
                throw error;
            }
            const sources = (await sql `SELECT request.* FROM fee_native_review_requests request
        WHERE request.school_id=${schoolId}::uuid AND request.route_kind='named' AND (request.submitted_by=${user.id}::uuid OR request.reviewer_user_id=${user.id}::uuid)
          AND NOT EXISTS(SELECT 1 FROM fee_native_review_decisions d WHERE d.school_id=request.school_id AND d.review_id=request.id)
          AND NOT EXISTS(SELECT 1 FROM fee_native_review_withdrawals w WHERE w.school_id=request.school_id AND w.review_id=request.id)
        ORDER BY request.created_at,request.id LIMIT 100`.execute(tx)).rows;
            const needs_me = [], waiting = [];
            for (const row of sources) {
                const invoice = await arrangementInvoice(tx, schoolId, row.invoice_id), route = await this.routeState(tx, row);
                const base = { id: row.id, invoice_id: invoice.id, revision: row.stream_revision, kind: row.kind, created_at: new Date(row.created_at).toISOString(),
                    message_id: route.message_id, title: row.kind === "payment" ? "Payment reported" : "Fee question", reviewer: { user_id: row.reviewer_user_id, label: row.reviewer_basis.label } };
                if (row.reviewer_user_id === user.id && row.reviewer_person_id === campus.actor.person_id && route.state === "waiting_for_review")
                    needs_me.push({ ...base, state: "review_needed", href: nativeFeeReviewHref(invoice, row.id, true) });
                if (row.submitted_by === user.id && row.submitter_person_id === campus.actor.person_id) {
                    const manager = await this.access.manages(tx, user, schoolId), canRead = await this.access.canRead(tx, user, invoice, campus.actor, campus.today, Boolean(manager));
                    waiting.push({ ...base, state: canRead ? route.state : "access_ended", href: canRead
                            ? nativeFeeReviewHref(invoice, row.id, Boolean(manager), row.submitter_relationship) : `/work/fee-reviews/${encodeURIComponent(row.id)}` });
                }
            }
            return { needs_me, waiting };
        });
    }
};
NativeFeeReviewsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, FinanceArrangementsAccess, NativeFeeReviewsModel])
], NativeFeeReviewsService);
export { NativeFeeReviewsService };
//# sourceMappingURL=native-fee-reviews.service.js.map