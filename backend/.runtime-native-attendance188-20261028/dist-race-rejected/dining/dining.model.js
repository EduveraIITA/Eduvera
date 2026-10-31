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
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { DOMAIN_COMMAND_GATEWAY_PORT, } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, } from "../campus-model-core/domain-command-receipt-read.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, } from "../campus-model-core/domain-event-journal.port.js";
import { COORDINATION_CONFIGURATION_PORT, coordinationConfigurationHash, } from "../campus-model-core/coordination-configuration.port.js";
import { COORDINATION_RUNTIME_PORT, } from "../campus-model-core/coordination-runtime.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { diningHref } from "./dining.contracts.js";
let DiningModel = class DiningModel {
    gateway;
    receipts;
    journal;
    configuration;
    coordination;
    constructor(gateway, receipts, journal, configuration, coordination) {
        this.gateway = gateway;
        this.receipts = receipts;
        this.journal = journal;
        this.configuration = configuration;
        this.coordination = coordination;
    }
    retained(tx, user, school, command) {
        return this.receipts.readDomainCommandReceipt(tx, {
            school_id: school,
            actor_user_id: user.id,
            source_domain: "dining",
            handler_key: "dining.commands",
            handler_version: 1,
            idempotency_key: `dining:${user.id}:${command}`,
        });
    }
    async prepare(tx, user, actor, source, kind, action, body, capability, authority) {
        const hash = createHash("sha256")
            .update(JSON.stringify({ source_id: source.id, kind, action, ...body }))
            .digest("hex");
        const old = await this.retained(tx, user, source.school_id, body.command_id);
        if (old) {
            if (old.actor_agent_id !== actor.agent_id ||
                old.target.domain_id !== source.id ||
                old.command_type !== `dining.${kind}.${action}` ||
                old.expected_revision !== body.expected_revision ||
                old.safe_context.payload_hash !== hash)
                throw new ConflictException("This save belongs to different dining work.");
            if (old.state === "pending")
                throw new ConflictException({
                    code: "dining_pending",
                    message: "This exact save is awaiting confirmation. Retry the same action.",
                });
            if (old.receipt.terminal_state !== "accepted")
                throw new ConflictException("This exact save was not accepted. Review the current record.");
            return {
                replay: true,
                result: old.receipt.metadata,
            };
        }
        if (source.revision !== body.expected_revision)
            throw new ConflictException({
                code: "dining_obsolete",
                message: "This record changed. Review its latest version.",
                fields: {
                    dining_obsolete: {
                        confirmation: "permanently_inapplicable",
                        receipt_state: "absent",
                        source_id: source.id,
                        command_id: body.command_id,
                        expected_revision: body.expected_revision,
                        current_revision: source.revision,
                        reason: "stream_advanced",
                    },
                },
            });
        const prepared = await this.gateway.prepareDomainCommand(tx, {
            school_id: source.school_id,
            actor_user_id: user.id,
            command_type: `dining.${kind}.${action}`,
            handler_key: "dining.commands",
            handler_version: 1,
            source_domain: "dining",
            target: {
                kind: `dining_${kind}`,
                domain: "dining",
                domain_id: source.id,
                label: "Dining",
                lifecycle_state: "active",
                source_revision: Math.max(1, source.revision),
                metadata: {},
            },
            current_revision: source.revision,
            expected_revision: body.expected_revision,
            capability,
            purpose: `dining_${kind}_${action}`,
            requested_at: executionNow().toISOString(),
            correlation_id: source.id,
            causation_id: source.coordination_receipt
                ?.event_id ?? null,
            idempotency_key: `dining:${user.id}:${body.command_id}`,
            operating_rule_version_ref: null,
            configuration_refs: [],
            authority_attestation: {
                evaluator_domain: "dining",
                decision: "allowed",
                reason_codes: [
                    capability === "dining.manage"
                        ? "explicit_institution_dining_authority"
                        : "exact_current_dining_responsibility",
                ],
                authority_source_refs: [authority],
                operating_rule_refs: [],
                valid_until: null,
            },
            safe_context: {
                source_id: source.id,
                source_kind: kind,
                payload_hash: hash,
            },
        });
        if (prepared.status !== "ready")
            throw new ConflictException("Refresh this exact dining operation.");
        return { replay: false, prepared };
    }
    complete(tx, user, source, kind, command, event) {
        return this.gateway.completeDomainCommand(tx, {
            school_id: source.school_id,
            command_id: command.command_id,
            terminal_state: "accepted",
            code: "dining_accepted",
            explanation: "The exact dining record was saved. Menu publication, reported serving and financial outcomes remain separate.",
            resulting_revision: source.revision,
            domain_event_id: event,
            metadata: {
                id: source.id,
                kind,
                revision: source.revision,
                ...(source.series_id ? { series_id: source.series_id } : {}),
                ...source.command_metadata,
            },
            completed_at: executionNow().toISOString(),
        });
    }
    async configure(tx, user, source, kind, action, capability, recipient) {
        const key = `dining_${source.id.replaceAll("-", "")}`, at = source.updated_at.toISOString();
        const content = {
            school_id: source.school_id,
            actor_user_id: user.id,
            source_domain: "dining",
            source_record_id: source.id,
            source_revision: source.revision,
            configuration_key: key,
            operating_rule_ref: `dining-responsibility:${source.id}:${source.revision}`,
            effective_from: at,
            enabled: Boolean(recipient),
            behaviour_key: key,
            behaviour_schema_version: 1,
            behaviour_configuration: {
                workflow: `dining_${kind}`,
                source_id: source.id,
                recipient_person_id: recipient?.person_id ?? null,
                timing: "no_automatic_deadline",
            },
            subscription: {
                source_domain: "dining",
                event_type: `dining.${kind}.${action}`,
                reaction_kind: kind === "issue" ? "dining_issue_action" : "dining_session_action",
                message_kind: "task",
                selector_key: key,
                required_capability: kind === "issue" ? "dining.resolve" : "dining.operate",
                scope_mode: "event_scope",
                min_recipients: 1,
                max_recipients: 1,
                message_schema_version: 1,
                response_due_after_seconds: null,
                expires_after_seconds: null,
                retry_after_seconds: null,
                max_attempts: 1,
                priority: 3,
            },
            recipients: recipient ? [recipient] : [],
            approval_note: "This exact authorized source names its next accountable person. No financial authority, food-safety approval, serving event or automatic deadline is inferred.",
        };
        const hash = coordinationConfigurationHash(content);
        let approval = null;
        for (const phase of ["approve", "activate"]) {
            const c = await this.gateway.prepareDomainCommand(tx, {
                school_id: source.school_id,
                actor_user_id: user.id,
                command_type: `dining.coordination.configure.${phase}`,
                handler_key: "dining.coordination.configure",
                handler_version: 1,
                source_domain: "dining",
                target: {
                    kind: `dining_${kind}`,
                    domain: "dining",
                    domain_id: source.id,
                    label: "Dining",
                    lifecycle_state: "active",
                    source_revision: source.revision,
                    metadata: {},
                },
                current_revision: source.revision,
                expected_revision: source.revision,
                capability,
                purpose: "explicit_dining_next_responsibility",
                requested_at: at,
                correlation_id: source.id,
                causation_id: approval,
                idempotency_key: `${key}:${source.revision}:${phase}`,
                operating_rule_version_ref: content.operating_rule_ref,
                configuration_refs: [
                    {
                        kind: "accepted_dining_source",
                        ref: source.id,
                        version: String(source.revision),
                    },
                ],
                authority_attestation: {
                    evaluator_domain: "dining",
                    decision: "allowed",
                    reason_codes: ["explicit_current_dining_responsibility"],
                    authority_source_refs: [
                        { source_id: source.id, source_revision: source.revision },
                    ],
                    operating_rule_refs: [],
                    valid_until: null,
                },
                safe_context: {
                    configuration_hash: hash,
                    source_record_id: source.id,
                    source_revision: source.revision,
                    configuration_key: key,
                },
            });
            if (c.status !== "ready")
                throw new ConflictException("The exact dining handoff needs a refresh.");
            if (phase === "approve") {
                approval = c.command_id;
                await this.complete(tx, user, source, kind, c, null);
            }
            else {
                const result = await this.configuration.configureRoute(tx, {
                    ...content,
                    configuration_hash: hash,
                    approval_command_id: approval,
                    activation_command_id: c.command_id,
                });
                await this.complete(tx, user, source, kind, c, null);
                return { ...result, selector_key: key };
            }
        }
        throw new ConflictException("Dining coordination could not be configured.");
    }
    async finish(tx, user, source, kind, action, command, capability, recipient, audience, sessionId) {
        const at = source.updated_at.toISOString(), eventType = `dining.${kind}.${action}`, payload = {
            source_id: source.id,
            source_kind: kind,
            revision: source.revision,
            action,
            source_command_id: command.command_id,
        };
        const outbox = await tx
            .insertInto("event_outbox")
            .values({
            school_id: source.school_id,
            event_type: eventType,
            aggregate_type: `dining_${kind}_event`,
            aggregate_id: source.id,
            audience_user_ids: [],
            payload,
            idempotency_key: `dining-source:${command.command_id}`,
            created_at: source.updated_at,
            notification_user_ids: [],
            notification_payload: null,
        })
            .returning("id")
            .executeTakeFirstOrThrow();
        const previous = source.coordination_receipt;
        const trace = previous?.message_id
            ? await this.coordination.findExactTrace(tx, {
                school_id: source.school_id,
                source_domain: "dining",
                source_record_id: source.id,
                event_type: previous.event_type,
                source_revision: previous.source_revision,
                message_id: previous.message_id,
            })
            : null;
        if (previous?.message_id &&
            trace?.message_open &&
            previous.recipient_user_id === user.id)
            await this.coordination.recordRecipientResponse(tx, {
                school_id: source.school_id,
                message_id: previous.message_id,
                correlation_id: source.id,
                recipient: { agent_kind: "human", user_id: user.id },
                actor: { agent_kind: "human", user_id: user.id },
                expected_source_record_id: source.id,
                expected_source_revision: previous.source_revision,
                source_outbox_event_id: outbox.id,
                code: `dining_${action}`,
                explanation: "The exact responsible person acted through the owning dining operation.",
                response: { source_id: source.id, revision: source.revision, action },
                occurred_at: at,
                idempotency_key: `dining-response:${command.command_id}`,
            });
        const route = kind !== "service" && kind !== "plan"
            ? await this.configure(tx, user, source, kind, action, capability, recipient)
            : null;
        const space = source.space_id
            ? await tx
                .selectFrom("campus_spaces")
                .select(["id", "name", "revision", "status", "kind"])
                .where("school_id", "=", source.school_id)
                .where("id", "=", source.space_id)
                .executeTakeFirst()
            : null;
        const context = space
            ? {
                kind: "space",
                domain: "campus_topology",
                domain_id: space.id,
                label: space.name,
                lifecycle_state: space.status,
                source_revision: space.revision,
                metadata: { space_kind: space.kind },
            }
            : null;
        const event = {
            school_id: source.school_id,
            source_outbox_event_id: outbox.id,
            event_type: eventType,
            subject: {
                kind: `dining_${kind}`,
                domain: "dining",
                domain_id: source.id,
                label: "Dining",
                lifecycle_state: "active",
                source_revision: source.revision,
                metadata: {},
            },
            context,
            actor_user_id: user.id,
            occurred_at: at,
            effective_from: at,
            effective_until: null,
            source_domain: "dining",
            source_record_id: source.id,
            source_revision: source.revision,
            correlation_id: source.id,
            causation_event_id: previous?.event_id ?? null,
            idempotency_key: `dining-event:${command.command_id}`,
            payload,
        };
        let eventId, messageId = null;
        if (recipient && route) {
            const result = await this.coordination.publishAcceptedEvent(tx, {
                ...event,
                event_kind: "domain_event",
                expected_route: {
                    behaviour_version_id: route.behaviour_version_id,
                    subscription_id: route.subscription_id,
                },
                message: {
                    subject: kind === "issue"
                        ? "Resolve dining report"
                        : "Continue dining service",
                    summary: "Open this exact source for its current authorized action.",
                    payload: {
                        workflow: `dining_${kind}`,
                        source_id: source.id,
                        source_revision: source.revision,
                        action_path: diningHref(sessionId ?? source.id, kind === "issue" ? source.id : undefined),
                    },
                },
                selector_input: {
                    selector_key: route.selector_key,
                    recipient_agents: [
                        { agent_kind: "human", user_id: recipient.user_id },
                    ],
                    scope: event.subject,
                },
            });
            if (result.status !== "matched" || result.message_ids.length !== 1)
                throw new ConflictException("The named dining participant could not receive its work.");
            eventId = result.event_id;
            messageId = result.message_ids[0];
        }
        else
            eventId = (await this.journal.recordAcceptedEvent(tx, {
                ...event,
                audience_user_ids: [user.id],
            })).event_id;
        if (previous?.message_id &&
            trace?.message_open &&
            previous.recipient_user_id !== user.id)
            await this.coordination.supersedeDomainMessage(tx, {
                school_id: source.school_id,
                command_id: command.command_id,
                message_id: previous.message_id,
                previous_event_id: previous.event_id,
                resulting_event_id: eventId,
                required_capability: capability,
                occurred_at: at,
                idempotency_key: `dining-supersede:${command.command_id}`,
            });
        const receipt = {
            event_id: eventId,
            event_type: eventType,
            source_revision: source.revision,
            message_id: messageId,
            recipient_person_id: recipient?.person_id ?? null,
            recipient_user_id: recipient?.user_id ?? null,
            route_unavailable: false,
        };
        if (kind === "session")
            await tx
                .updateTable("dining_sessions")
                .set({ coordination_receipt: receipt })
                .where("school_id", "=", source.school_id)
                .where("id", "=", source.id)
                .execute();
        if (kind === "issue")
            await tx
                .updateTable("dining_issues")
                .set({ coordination_receipt: receipt })
                .where("school_id", "=", source.school_id)
                .where("id", "=", source.id)
                .execute();
        await this.complete(tx, user, source, kind, command, outbox.id);
        const refreshPayload = {
            source_id: source.id,
            source_kind: kind,
            revision: source.revision,
            source_command_id: command.command_id,
            refresh: ["dining", "workspace", "attention"],
        };
        const acceptedAudience = (await sql `SELECT user_id FROM unnest(${[...new Set(audience)]}::uuid[]) user_id WHERE dining_event_recipient_valid(${source.school_id}::uuid,${JSON.stringify(refreshPayload)}::jsonb,user_id)`.execute(tx)).rows.map((r) => r.user_id);
        await tx
            .insertInto("event_outbox")
            .values({
            school_id: source.school_id,
            event_type: "dining.updated",
            aggregate_type: `dining_${kind}`,
            aggregate_id: source.id,
            audience_user_ids: acceptedAudience,
            payload: refreshPayload,
            idempotency_key: `dining-refresh:${command.command_id}`,
            created_at: source.updated_at,
            notification_user_ids: [],
            notification_payload: null,
        })
            .execute();
        return receipt;
    }
};
DiningModel = __decorate([
    Injectable(),
    __param(0, Inject(DOMAIN_COMMAND_GATEWAY_PORT)),
    __param(1, Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT)),
    __param(2, Inject(DOMAIN_EVENT_JOURNAL_PORT)),
    __param(3, Inject(COORDINATION_CONFIGURATION_PORT)),
    __param(4, Inject(COORDINATION_RUNTIME_PORT)),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object])
], DiningModel);
export { DiningModel };
//# sourceMappingURL=dining.model.js.map