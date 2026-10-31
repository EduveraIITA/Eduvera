import { ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import type { TeachingAccess, TeachingSource } from "./teaching-session-context.service.js";
import { sessionHash, type SessionCommand } from "./teaching-session.contracts.js";
import { SchoolEventService } from "../school/school-event.service.js";

export interface TeachingRefusal { status: "refused"; error: { code: string; message: string; fields: { lesson_obsolete: Record<string,unknown> } } }

@Injectable()
export class TeachingSessionModelService {
  constructor(@Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identity: HumanAgentIdentityPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort,
    @Optional() private readonly events?: SchoolEventService) {}

  async prepare(tx: Transaction<Database>, user: AuthUser, access: TeachingAccess, action: string,
    command: SessionCommand, payload: unknown, revision: number) {
    const source = access.source, actor = await this.identity.resolveAccountEndpoint(tx, { school_id: source.school_id, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting || actor.person_id !== access.person_id) throw new ConflictException("Your current teaching identity changed. Reopen the session.");
    const hash = sessionHash(payload), key = `teaching-session:${user.id}:${command.command_id}`;
    const prior = await this.receipts.readDomainCommandReceipt(tx, { school_id: source.school_id, actor_user_id: user.id,
      source_domain: "teaching_sessions", handler_key: "learning.sessions", handler_version: 1, idempotency_key: key });
    if (prior) {
      if (prior.actor_agent_id !== actor.agent_id || prior.command_type !== `learning.session.${action}` || prior.target.domain_id !== source.id
        || prior.target.domain !== "teaching_sessions" || prior.expected_revision !== command.expected_revision || prior.safe_context.payload_hash !== hash)
        throw new ConflictException("This command was already used for different teaching work.");
      if (prior.state === "pending") throw new ConflictException("This teaching action is awaiting confirmation. Retry the same action.");
      if (prior.receipt.terminal_state === "conflicted" && prior.receipt.code === "learning_session_source_changed") {
        return { status: "refused", error: prior.receipt.metadata.refusal } as TeachingRefusal;
      }
      if (prior.receipt.terminal_state !== "accepted") throw new ConflictException("The teaching action was not accepted. Reopen the session.");
      return prior.receipt;
    }
    const proof = { confirmation: "permanently_inapplicable", receipt_state: "absent", handler: "learning.sessions",
      command_id: command.command_id, source_id: source.id, expected_revision: command.expected_revision, current_revision: revision };
    if (revision > command.expected_revision) throw new ConflictException({ code: "learning.session_revision_obsolete",
      message: "The lesson record changed. Your text is kept; review the saved version.", fields: { lesson_obsolete: { ...proof, code: "learning.session_revision_obsolete" } } });
    if (revision !== command.expected_revision) throw new ConflictException("The lesson version does not match. Open the current record.");
    const prepared = await this.commands.prepareDomainCommand(tx, { school_id: source.school_id, actor_user_id: user.id,
      command_type: `learning.session.${action}`, source_domain: "teaching_sessions", handler_key: "learning.sessions", handler_version: 1,
      target: { kind: "learning_work", domain: "teaching_sessions", domain_id: source.id, label: "Teaching session", lifecycle_state: "active", source_revision: Math.max(1,revision), metadata: {} },
      current_revision: revision, expected_revision: command.expected_revision, capability: "learning.sessions.manage", purpose: "teaching_session_record",
      requested_at: executionNow().toISOString(), correlation_id: command.command_id, causation_id: null, idempotency_key: key,
      operating_rule_version_ref: null, configuration_refs: [], authority_attestation: { evaluator_domain: "teaching_sessions", decision: "allowed",
        reason_codes: [source.is_cover ? "exact_accepted_session_cover_with_lesson_grant" : "current_named_instructor_with_lesson_grant"],
        authority_source_refs: [...access.grants, { source_fingerprint: source.source_fingerprint, session_id: source.id }], operating_rule_refs: [], valid_until: null },
      safe_context: { session_id: source.id, date: source.date, payload_hash: hash } });
    if (command.source_fingerprint !== source.source_fingerprint) {
      // Fingerprints can return to an earlier value. Retain an exact terminal
      // refusal before releasing the user's draft for a new review; an ABA source
      // change cannot make this same command executable later.
      const error = { code: "learning.session_source_changed", message: "The schedule changed. Your text is kept; review the current session.",
        fields: { lesson_obsolete: { ...proof, code: "learning.session_source_changed", receipt_state: "conflicted",
          current_source_fingerprint: source.source_fingerprint, reviewed_source_fingerprint: command.source_fingerprint } } };
      if (prepared.status !== "ready") throw new ConflictException("The source refusal could not be confirmed. Retry the same action.");
      await this.commands.completeDomainCommand(tx,{ school_id:source.school_id,command_id:prepared.command_id,terminal_state:"conflicted",
        code:"learning_session_source_changed",explanation:error.message,resulting_revision:revision,domain_event_id:null,metadata:{refusal:error},completed_at:executionNow().toISOString() });
      return { status:"refused",error } satisfies TeachingRefusal;
    }
    return prepared;
  }

  async finish(tx: Transaction<Database>, user: AuthUser, source: TeachingSource, commandId: string, revision: number,
    action: string, result: Record<string, unknown>) {
    const safe = { session_id: source.id, revision, action, date: source.date }, key = `teaching-session:${user.id}:${commandId}:${action}`;
    await tx.insertInto("audit_events").values({ school_id: source.school_id, actor_id: user.id, action: `learning.session.${action}`,
      target_type: "teaching_session", target_id: source.id, request_id: commandId, ip_hash: null,
      metadata: { ...safe, command_id: commandId, source_fingerprint: source.source_fingerprint } }).execute();
    const event = await tx.insertInto("event_outbox").values({ school_id: source.school_id, event_type: `learning.session.${action}`,
      aggregate_type: "teaching_session", aggregate_id: source.id, audience_user_ids: [], payload: safe, idempotency_key: key }).returning("id").executeTakeFirstOrThrow();
    await this.journal.recordAcceptedEvent(tx, { school_id: source.school_id, source_outbox_event_id: event.id,
      event_type: `learning.session.${action}`, subject: { kind: "learning_work", domain: "teaching_sessions", domain_id: source.id,
        label: "Teaching session", lifecycle_state: "active", source_revision: revision, metadata: {} }, context: null,
      actor_user_id: user.id, occurred_at: executionNow().toISOString(), effective_from: executionNow().toISOString(), effective_until: null,
      source_domain: "teaching_sessions", source_record_id: source.id, source_revision: revision, correlation_id: commandId,
      causation_event_id: null, idempotency_key: key, audience_user_ids: [], payload: safe });
    await this.commands.completeDomainCommand(tx, { school_id: source.school_id, command_id: commandId, terminal_state: "accepted",
      code: "teaching_session_action_accepted", explanation: "The teaching service recorded this action.", resulting_revision: revision,
      domain_event_id: event.id, metadata: result, completed_at: executionNow().toISOString() });
    if(this.events){
      const shared=action==="lesson.reported"||action==="lesson.corrected"||action==="work.linked"||result.shared===true;
      const people=!shared?[]:source.source_kind==="activity" ? (await sql<{person_id:string}>`SELECT person_id FROM schedule_activity_occurrence_people
        WHERE school_id=${source.school_id}::uuid AND occurrence_id=${source.occurrence_id}::uuid
          AND(participation_role='participant' OR attendance_expected)`.execute(tx)).rows
        : (await sql<{person_id:string}>`SELECT DISTINCT student.person_id FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id
          WHERE student.school_id=${source.school_id}::uuid AND enrollment.class_section_id=${source.class_section_id}::uuid
            AND enrollment.term_id=${source.term_id}::uuid AND enrollment.is_active AND enrollment.enrolled_on<=${source.date}::date
            AND(enrollment.inactive_from IS NULL OR enrollment.inactive_from>${source.date}::date)
            AND enrollment.enrolled_on<=(${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date
            AND(enrollment.inactive_from IS NULL OR enrollment.inactive_from>(${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date)`.execute(tx)).rows;
      const audience=[user.id];
      for(const person of people){
        const endpoint=await this.identity.resolvePersonAgent(tx,{school_id:source.school_id,person_id:person.person_id,at:executionNow().toISOString()});
        if(endpoint.acting)audience.push(endpoint.user_id);
      }
      // Refresh IDs only; learner text, staff preparation, resource names/bytes
      // and private Learning work never enter generic mailbox or event payloads.
      await this.events.enqueueUserEvent(tx,{schoolId:source.school_id,eventType:"diary.updated",aggregateType:"teaching_session",aggregateId:source.id,
        audienceUserIds:[...new Set(audience)],payload:{...safe,command_id:commandId,source_domain:"teaching_sessions",audience_scope:shared?"shared":"staff",
          refresh:["teaching-sessions","workspace"]},idempotencyKey:`refresh:${key}`});
    }
  }

  async lock(tx: Transaction<Database>, schoolId: string, id: string) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`teaching-session:${schoolId}:${id}`},0))`.execute(tx);
    return tx.selectFrom("teaching_sessions").selectAll().where("school_id","=",schoolId).where("id","=",id).forUpdate().executeTakeFirst();
  }

  async ensure(tx: Transaction<Database>, source: TeachingSource) {
    await tx.insertInto("teaching_sessions").values({ id: source.id, school_id: source.school_id, source_kind: source.source_kind,
      logical_key: source.logical_key, session_date: source.date, class_section_id: source.class_section_id, subject_id: source.subject_id, original_teacher_id: source.original_teacher_id,
      source_fingerprint: source.source_fingerprint, source_evidence: JSON.stringify(source.source_evidence), revision: 0, state: "prepared",
      preparation: "", topic: "", learner_notes: "", reported_at: null, created_at: executionNow(), updated_at: executionNow() })
      .onConflict(oc => oc.columns(["school_id","id"]).doNothing()).execute();
  }
}
