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
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "kysely";
import { DOMAIN_COMMAND_GATEWAY_PORT } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT } from "../campus-model-core/domain-command-receipt-read.port.js";
import { COORDINATION_CONFIGURATION_PORT } from "../campus-model-core/coordination-configuration.port.js";
import { COORDINATION_RUNTIME_PORT } from "../campus-model-core/coordination-runtime.port.js";
import { HUMAN_AGENT_IDENTITY_PORT } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DatabaseService } from "../database/database.service.js";
import { schoolPermissionForUser } from "../roles/authorization.js";
import { confirmFeeAuthoritySchema, eligibleFeeAuthority, sameFeeAuthorityExpected } from "./fee-authority-basis.js";
import { GovernanceService } from "./governance.service.js";
import { configureFeeAuthorityRoute, feeAuthorityRouteReady } from "./fee-authority-routing.js";
const feeAuthorityResultSchema = z.object({ adoption_id: z.uuid(), rule_id: z.uuid(), revision: z.number().int().positive() }).strict();
let FeeAuthorityService = class FeeAuthorityService {
    db;
    identities;
    commands;
    receipts;
    governance;
    configuration;
    coordination;
    constructor(db, identities, commands, receipts, governance, configuration, coordination) {
        this.db = db;
        this.identities = identities;
        this.commands = commands;
        this.receipts = receipts;
        this.governance = governance;
        this.configuration = configuration;
        this.coordination = coordination;
    }
    async actor(tx, user, schoolId) {
        if (!user.is_active || user.active_school_id && user.active_school_id !== schoolId
            || executionEnvironmentStorage.getStore()?.institution_id && executionEnvironmentStorage.getStore().institution_id !== schoolId)
            throw new ForbiddenException("Use the currently selected campus to review Finance authority.");
        await schoolPermissionForUser(tx, user.id, schoolId, "fees.manage", true);
        const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
        if (!actor.acting)
            throw new ForbiddenException("Your current campus person/account link is unavailable.");
        return actor;
    }
    rule(tx, schoolId) {
        return tx.selectFrom("institution_decision_matter_rules").selectAll().where("school_id", "=", schoolId)
            .where("code", "=", "fee_instalment_decision").forShare().executeTakeFirst();
    }
    async workspace(user, schoolId, commandId) {
        if (commandId !== undefined)
            z.uuid().parse(commandId);
        // Read committed is important for outcome recovery: a command-key lock may
        // wait for an in-flight writer, and the receipt read must see its commit.
        return this.db.transaction().execute(async (tx) => {
            await this.actor(tx, user, schoolId);
            let confirmation;
            if (commandId) {
                const retained = await this.receipts.readDomainCommandReceipt(tx, { school_id: schoolId, actor_user_id: user.id, source_domain: "governance",
                    handler_key: "governance.fee_authority", handler_version: 1, idempotency_key: `fee-authority:${user.id}:${commandId}` });
                const accepted = retained?.state === "completed" && retained.receipt.terminal_state === "accepted";
                const metadata = retained?.state === "completed" ? retained.receipt.metadata : {};
                confirmation = { state: !retained ? "not_found" : retained.state === "pending" ? "pending" : accepted ? "accepted" : "not_accepted",
                    ...(accepted && z.uuid().safeParse(metadata.adoption_id).success && z.uuid().safeParse(metadata.rule_id).success && Number.isInteger(metadata.revision)
                        ? { adoption_id: String(metadata.adoption_id), rule_id: String(metadata.rule_id), revision: Number(metadata.revision) } : {}) };
            }
            const rule = await this.rule(tx, schoolId), available = await eligibleFeeAuthority(tx, schoolId, this.identities, executionNow());
            let route = {
                state: rule ? "unavailable" : "missing", reason: "An existing Finance authority holder must confirm payment-plan approval.", rule_id: rule?.id ?? null,
                revision: rule?.revision ?? 0, reviewer: null
            };
            try {
                const authority = await this.governance.resolveDecisionOwner(tx, schoolId, "fee_instalment_decision", executionNow());
                const holder = available.candidates.find(item => item.user_id === authority.user_id && item.office_id === authority.office.id);
                const ready = authority.fee_instalment_basis && await feeAuthorityRouteReady(tx, this.coordination, schoolId, { ...authority.fee_instalment_basis,
                    rule_id: authority.rule.id, revision: authority.rule.revision, user_id: authority.user_id, person_id: authority.person.id }, executionNow().toISOString());
                route = { state: ready ? "ready" : "unavailable", reason: ready ? null : "The current Finance holder must confirm delivery of payment-plan review requests.", rule_id: authority.rule.id, revision: authority.rule.revision,
                    reviewer: { user_id: authority.user_id, person_id: authority.person.id, name: holder?.holder_name ?? "Current Finance approver", office_title: holder?.office_title ?? "Finance approver" } };
            }
            catch (error) {
                if (!(error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException))
                    throw error;
                route.reason = error.message;
            }
            const candidates = available.candidates.filter(item => route.state !== "ready" && item.user_id === user.id)
                .filter(item => !rule || rule.status !== "confirmed" || ["individual", "delegated"].includes(rule.decision_mode) && rule.decision_office_id === item.office_id)
                .map(item => ({ ...item, can_confirm: true, expected: { ...item.expected, rule_revision: rule?.revision ?? 0 } }));
            const others = new Map(available.candidates.filter(item => item.user_id !== user.id).map(item => [item.user_id, { name: item.holder_name, office_title: item.office_title }]));
            return { school_id: schoolId, route, candidates, other_holders: [...others.values()], ...(confirmation ? { confirmation } : {}),
                reasons: available.reasons.length ? available.reasons : candidates.length || others.size ? [] : ["Record a current, explicitly bounded payment-plan mandate before enabling approvals. This does not block other fee work."] };
        });
    }
    async confirm(user, schoolId, body) {
        const parsed = confirmFeeAuthoritySchema.parse(body), data = { ...parsed,
            expected: { ...parsed.expected, source_revisions: [...parsed.expected.source_revisions].sort((a, b) => a.id.localeCompare(b.id)) } };
        return this.db.transaction().execute(async (tx) => {
            const actor = await this.actor(tx, user, schoolId);
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`fee-authority:${schoolId}`},0))`.execute(tx);
            const candidate = (await eligibleFeeAuthority(tx, schoolId, this.identities, executionNow())).candidates.find(item => item.mandate_id === data.mandate_id
                && item.user_id === user.id && item.person_id === actor.person_id);
            if (!candidate)
                throw new ForbiddenException("Only the current holder of this existing Finance mandate may confirm it. No new power or access is granted here.");
            const current = await this.rule(tx, schoolId);
            if (current?.status === "confirmed" && (!["individual", "delegated"].includes(current.decision_mode) || current.decision_office_id !== candidate.office_id))
                throw new ConflictException("A different adopted decision route already applies. Its authority owner must resolve the change; this confirmation cannot replace it.");
            const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
            const key = `fee-authority:${user.id}:${data.command_id}`;
            const retained = await this.receipts.readDomainCommandReceipt(tx, { school_id: schoolId, actor_user_id: user.id, source_domain: "governance",
                handler_key: "governance.fee_authority", handler_version: 1, idempotency_key: key });
            if (retained) {
                if (retained.actor_agent_id !== actor.agent_id || retained.command_type !== "governance.fee_authority.confirm"
                    || retained.target.domain !== "governance" || retained.target.kind !== "finance_authority" || retained.target.domain_id !== data.mandate_id
                    || retained.safe_context.payload_hash !== hash)
                    throw new ConflictException("This confirmation command was used for different authority details.");
                if (retained.state === "pending")
                    throw new ConflictException("This confirmation is still unconfirmed. Refresh Finance authority before retrying.");
                if (retained.receipt.terminal_state !== "accepted")
                    throw new ConflictException("This confirmation was not accepted. Review current Finance authority.");
                const result = feeAuthorityResultSchema.safeParse(retained.receipt.metadata);
                if (!result.success)
                    throw new ConflictException("The retained authority confirmation needs review before it can be shown.");
                return { ...result.data, replayed: true };
            }
            if (!sameFeeAuthorityExpected({ ...candidate.expected, rule_revision: current?.revision ?? 0 }, data.expected))
                throw new ConflictException("Finance authority changed. Refresh and review the current holder, source and limits before confirming.");
            let existingAuthority;
            if (current) {
                try {
                    existingAuthority = await this.governance.resolveDecisionOwner(tx, schoolId, "fee_instalment_decision", executionNow());
                }
                catch (error) {
                    if (!(error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException))
                        throw error;
                }
                if (existingAuthority?.fee_instalment_basis && await feeAuthorityRouteReady(tx, this.coordination, schoolId, { ...existingAuthority.fee_instalment_basis,
                    rule_id: existingAuthority.rule.id, revision: existingAuthority.rule.revision, user_id: existingAuthority.user_id, person_id: existingAuthority.person.id }, executionNow().toISOString()))
                    throw new ConflictException("Payment-plan authority is already confirmed. Refresh to view the current approver.");
            }
            const prepared = await this.commands.prepareDomainCommand(tx, { school_id: schoolId, actor_user_id: user.id, source_domain: "governance",
                command_type: "governance.fee_authority.confirm", handler_key: "governance.fee_authority", handler_version: 1,
                target: { kind: "finance_authority", domain: "governance", domain_id: data.mandate_id, label: "Payment-plan authority", lifecycle_state: "active", source_revision: candidate.expected.mandate_revision, metadata: {} },
                current_revision: candidate.expected.mandate_revision, expected_revision: data.expected.mandate_revision, capability: "fees.manage", purpose: "register_existing_payment_plan_authority",
                requested_at: executionNow().toISOString(), correlation_id: data.command_id, causation_id: null, idempotency_key: key,
                operating_rule_version_ref: null, configuration_refs: [], authority_attestation: { evaluator_domain: "governance", decision: "allowed",
                    reason_codes: ["current_existing_finance_mandate_holder", "explicit_holder_confirmation"], authority_source_refs: [candidate.expected], operating_rule_refs: [], valid_until: null },
                safe_context: { mandate_id: data.mandate_id, payload_hash: hash } });
            if (prepared.status !== "ready" || prepared.actor_agent_id !== actor.agent_id)
                throw new ConflictException("Refresh Finance authority before repeating this confirmation.");
            const today = (await tx.selectFrom("schools").select("timezone").where("id", "=", schoolId).executeTakeFirstOrThrow()).timezone;
            const effectiveFrom = new Intl.DateTimeFormat("en-CA", { timeZone: today }).format(executionNow());
            const values = { title: "Payment-plan approvals", category: "finance", initiation_summary: "An authorized payer proposes a payment schedule.",
                review_summary: "The recorded Finance mandate holder reviews the exact proposal.", decision_summary: "The existing Finance mandate holder decides within the recorded limits.",
                execution_summary: "Finance records the agreement without recording money received.", decision_mode: "individual", decision_office_id: candidate.office_id,
                decision_body_id: null, standing_mandate_id: null, authority_source_ids: candidate.sources.map(item => item.id),
                conditions_summary: candidate.max_amount_paise === null ? "Confirmed existing Finance mandate; no additional amount limit." : `Maximum amount INR ${candidate.max_amount_paise / 100}`,
                material_fields: ["invoice", "ledger_basis", "schedule", "request_revision"], status: "confirmed",
                effective_from: effectiveFrom, effective_until: candidate.effective_until };
            const reuse = existingAuthority?.fee_instalment_basis?.mandate_id === candidate.mandate_id ? existingAuthority : undefined;
            const rule = reuse && current ? current : current ? await tx.updateTable("institution_decision_matter_rules").set(values).where("id", "=", current.id).where("school_id", "=", schoolId).returningAll().executeTakeFirstOrThrow()
                : await tx.insertInto("institution_decision_matter_rules").values({ ...values, school_id: schoolId, code: "fee_instalment_decision", created_by: user.id }).returningAll().executeTakeFirstOrThrow();
            const adoptionId = reuse?.fee_instalment_basis?.adoption_id ?? randomUUID();
            if (!reuse)
                await sql `INSERT INTO fee_authority_adoptions(id,school_id,rule_id,rule_revision,mandate_id,mandate_revision,office_id,office_revision,
        appointment_id,appointment_revision,source_revisions,max_amount_paise,confirmed_by,person_id,command_id,attestation,created_at)
        VALUES(${adoptionId}::uuid,${schoolId}::uuid,${rule.id}::uuid,${rule.revision},${candidate.mandate_id}::uuid,${candidate.expected.mandate_revision},
          ${candidate.office_id}::uuid,${candidate.expected.office_revision},${candidate.appointment_id}::uuid,${candidate.expected.appointment_revision},
          ${JSON.stringify(candidate.expected.source_revisions)}::jsonb,${candidate.max_amount_paise},${user.id}::uuid,${actor.person_id}::uuid,${data.command_id}::uuid,true,${executionNow()}::timestamptz)`.execute(tx);
            await configureFeeAuthorityRoute(tx, this.configuration, this.commands, schoolId, candidate, { adoption_id: adoptionId, rule_id: rule.id, revision: rule.revision, mandate_id: candidate.mandate_id,
                mandate_revision: candidate.expected.mandate_revision, user_id: user.id, person_id: actor.person_id }, data.command_id, executionNow().toISOString());
            await tx.insertInto("institution_governance_audits").values({ school_id: schoolId, actor_id: user.id, action: "governance.fee_authority.confirmed",
                target_type: "decision_rule", target_id: rule.id, metadata: { adoption_id: adoptionId, mandate_id: candidate.mandate_id, rule_revision: rule.revision } }).execute();
            const eventId = randomUUID();
            await tx.insertInto("event_outbox").values({ id: eventId, school_id: schoolId, event_type: "fees.updated", aggregate_type: "fee_authority", aggregate_id: rule.id,
                audience_user_ids: [user.id], notification_user_ids: [], notification_payload: null,
                payload: { action: "payment_plan_authority_confirmed", rule_id: rule.id, revision: rule.revision, refresh: ["fees", "attention"] },
                idempotency_key: `fee-authority:${schoolId}:${data.command_id}` }).execute();
            const result = { adoption_id: adoptionId, rule_id: rule.id, revision: rule.revision };
            await this.commands.completeDomainCommand(tx, { school_id: schoolId, command_id: prepared.command_id, terminal_state: "accepted",
                code: "fee_authority_confirmed", explanation: "The current holder confirmed their existing payment-plan authority; no new authority or access was created.",
                resulting_revision: rule.revision, domain_event_id: eventId, metadata: result, completed_at: executionNow().toISOString() });
            return { ...result, replayed: false };
        });
    }
};
FeeAuthorityService = __decorate([
    Injectable(),
    __param(1, Inject(HUMAN_AGENT_IDENTITY_PORT)),
    __param(2, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(3, Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT)),
    __param(5, Inject(COORDINATION_CONFIGURATION_PORT)),
    __param(6, Inject(COORDINATION_RUNTIME_PORT)),
    __metadata("design:paramtypes", [DatabaseService, Object, Object, Object, GovernanceService, Object, Object])
], FeeAuthorityService);
export { FeeAuthorityService };
//# sourceMappingURL=fee-authority.service.js.map