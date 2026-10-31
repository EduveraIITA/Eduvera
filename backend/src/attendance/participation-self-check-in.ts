import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../database/types.js";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import type { DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import type { DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import type { ConfiguredCommandPort } from "../campus-model-core/configured-command.port.js";
import type { HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import type { ObservationIngressPort } from "../campus-model-core/observation-ingress.port.js";
import type { CampusModelEntitySnapshot } from "../campus-model-core/contracts.js";
import type { ParticipationKernelRegister } from "./activity-attendance.service.js";

type Tx = Transaction<Database>;
export interface ParticipationSelfCheckInInput {
  source_reference: string;
  window: { opens_at: string; closes_at: string };
}
interface Runtime {
  commands: DomainCommandGatewayPort; journal: DomainEventJournalPort; configured: ConfiguredCommandPort;
  identities: HumanAgentIdentityPort; observations: ObservationIngressPort;
  register: () => Promise<ParticipationKernelRegister>;
  assertRoster: (register: ParticipationKernelRegister) => Promise<void>;
  target: (register: ParticipationKernelRegister, revision?: number) => CampusModelEntitySnapshot;
  audience: (register: ParticipationKernelRegister, actorId: string) => Promise<string[]>;
  observe: (register: ParticipationKernelRegister, personId: string, sourceId: string, state: "pending" | "accepted", eventId: string,
    now: Date, evidenceRefs: string[], software?: {agent_id:string;behaviour_version_id:string;command_id:string}) => Promise<string[]>;
  synchronize: () => Promise<void>;
  effects: (revision:number,operation:string,actorId:string|null) => Promise<void>;
}

/** Internal part of the one attendance kernel. The owning QR adapter validates
 * the short-lived challenge and its academic window before invoking this path.
 * A real human reports their own evidence; a separately configured software
 * actor may accept it. No other existing mark is overwritten automatically. */
export async function recordParticipationSelfCheckIn(tx: Tx, runtime: Runtime, user: AuthUser, schoolId: string,
  rawInput: ParticipationSelfCheckInInput, request: AuthenticatedRequest) {
  const input = z.object({ source_reference: z.string().uuid(), window: z.object({
    opens_at: z.string().datetime({ offset: true }), closes_at: z.string().datetime({ offset: true }),
  }).strict() }).strict().parse(rawInput);
  const now = executionNow();
  if (Date.parse(input.window.opens_at) > now.getTime() || Date.parse(input.window.closes_at) <= now.getTime()) {
    throw new BadRequestException("Check-in is outside this activity’s approved attendance window.");
  }
  if (user.active_school_id !== schoolId) throw new ForbiddenException("Select this institution before checking in.");
  const identity = await runtime.identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: now.toISOString() });
  if (!identity.acting) throw new ForbiddenException("An active campus identity is required for your own check-in.");
  const register = await runtime.register();
  if (register.source !== "academic") throw new ConflictException("This check-in source is not configured for the selected context.");
  if (register.state === "locked" || register.occurrence_state !== "expected") throw new ForbiddenException("This attendance register is final or no longer expected.");
  await runtime.assertRoster(register);
  const roster = (await sql<{ person_id: string }>`SELECT person_id FROM activity_attendance_roster
    WHERE school_id=${schoolId}::uuid AND register_id=${register.id}::uuid AND person_id=${identity.person_id}::uuid FOR SHARE`.execute(tx)).rows[0];
  if (!roster) throw new ForbiddenException("This check-in is not for your retained activity roster.");
  const policy = (await sql<{ revision: number; mode: string; channels: string[]; updated_by: string | null; updated_at: Date }>`
    SELECT revision,attendance_self_check_in_mode AS mode,attendance_academic_channels AS channels,updated_by,updated_at
    FROM institution_operating_rules WHERE school_id=${schoolId}::uuid FOR SHARE`.execute(tx)).rows[0];
  if (!policy || policy.revision <= 0 || !policy.updated_by || policy.mode === "disabled" || !policy.channels.includes("student_qr")) {
    throw new ConflictException("Check-in needs an explicitly approved current institution rule.");
  }
  const previous = (await sql<{ id: string; state: string }>`SELECT id,state FROM activity_attendance_evidence
    WHERE school_id=${schoolId}::uuid AND register_id=${register.id}::uuid AND person_id=${identity.person_id}::uuid
      AND capture_channel='self_check_in' AND source_reference=${input.source_reference} AND legacy_source_ref IS NULL`.execute(tx)).rows[0];
  if (previous) return { status: previous.state === "accepted" ? "recorded" : "pending_review", evidence_id: previous.id, register_id: register.id };

  const reportRevision = register.revision + 1, key = `qr-report:${register.id}:${user.id}:${input.source_reference}`;
  const report = await runtime.commands.prepareDomainCommand(tx, {
    school_id: schoolId, actor_user_id: user.id, command_type: "attendance.participation.self_report",
    handler_key: "attendance.participation_self_report", handler_version: 1, source_domain: "attendance",
    target: runtime.target(register), current_revision: register.revision, expected_revision: register.revision,
    capability: "attendance:self_report", purpose: "report_own_participation", requested_at: now.toISOString(),
    correlation_id: request.requestId, causation_id: null, idempotency_key: key,
    operating_rule_version_ref: `institution_operating_rules:${schoolId}:${policy.revision}`, configuration_refs: [],
    authority_attestation: { evaluator_domain: "attendance", decision: "allowed", reason_codes: ["own_active_person_in_retained_roster"],
      authority_source_refs: [{ person_id: identity.person_id, register_id: register.id, source_reference: input.source_reference }],
      operating_rule_refs: [{ revision: policy.revision }], valid_until: input.window.closes_at }, safe_context: { occurrence_id: register.occurrence_id },
  });
  if (report.status !== "ready") throw new ConflictException("The original check-in result must be refreshed before retrying.");
  const evidenceId = randomUUID();
  const snapshot = { source: "academic_qr_challenge", challenge_id: input.source_reference, policy_revision: policy.revision,
    mode: policy.mode, window: input.window, reported_by: user.id, observed_at: now.toISOString() };
  await sql`INSERT INTO activity_attendance_evidence(id,school_id,register_id,person_id,claimed_status,capture_channel,state,
    observed_at,received_at,submitted_by,source_reference,note,source_snapshot)
    VALUES(${evidenceId}::uuid,${schoolId}::uuid,${register.id}::uuid,${identity.person_id}::uuid,'present','self_check_in','pending',
      ${now},${now},${user.id}::uuid,${input.source_reference},'Own check-in reported through the approved activity source',${JSON.stringify(snapshot)}::jsonb)`.execute(tx);
  const audience = await runtime.audience(register, user.id);
  const emit = async (operation: string, revision: number, actor?: { agent_id: string; behaviour_version_id: string }, cause: string | null = null) => {
    const outboxId = randomUUID();
    await sql`INSERT INTO event_outbox(id,school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key)
      VALUES(${outboxId}::uuid,${schoolId}::uuid,'attendance.participation.updated','attendance_register',${register.id}::uuid,
        ${audience}::uuid[],${JSON.stringify({ operation,register_id: register.id,occurrence_id: register.occurrence_id,revision,
          refresh: ["attendance","activities","workspace","today"] })}::jsonb,${`participation-qr:${outboxId}`})`.execute(tx);
    const event = { school_id: schoolId,source_outbox_event_id: outboxId,event_type: "attendance.participation.updated",
      subject: runtime.target(register,revision),context: null,audience_user_ids: audience,occurred_at: now.toISOString(),effective_from: now.toISOString(),effective_until: null,
      source_domain: "attendance",source_record_id: register.id,source_revision: revision,correlation_id: request.requestId,
      causation_event_id: cause,idempotency_key: `participation-qr-model:${outboxId}`,payload: { operation,evidence_id: evidenceId,register_revision: revision } };
    const journal = actor ? await runtime.configured.recordSoftwareEvent(tx,{ ...event,actor_agent_id: actor.agent_id,behaviour_version_id: actor.behaviour_version_id })
      : await runtime.journal.recordAcceptedEvent(tx,{ ...event,actor_user_id: user.id });
    return { outboxId,modelEventId: journal.event_id };
  };
  await sql`UPDATE activity_attendance_registers SET revision=${reportRevision},updated_at=${now} WHERE id=${register.id}::uuid`.execute(tx);
  const reported = await emit("self_report",reportRevision);
  const observationIds = await runtime.observe(register,identity.person_id,evidenceId,"pending",reported.outboxId,now,[`attendance_qr_challenge:${input.source_reference}`]);
  await sql`UPDATE activity_attendance_evidence SET observation_id=${observationIds[0] ?? null}::uuid WHERE id=${evidenceId}::uuid`.execute(tx);
  await runtime.commands.completeDomainCommand(tx,{ school_id: schoolId,command_id: report.command_id,terminal_state: "accepted",code: "own_participation_reported",
    explanation: "The identified participant reported their own check-in. Acceptance is a separate decision.",resulting_revision: reportRevision,
    domain_event_id: reported.outboxId,metadata: { evidence_id: evidenceId,model_event_id: reported.modelEventId },completed_at: now.toISOString() });
  await sql`INSERT INTO activity_attendance_audits(school_id,register_id,action,actor_id,reason,register_revision,request_id,source_refs)
    VALUES(${schoolId}::uuid,${register.id}::uuid,'self_report',${user.id}::uuid,'Participant reported their own check-in',${reportRevision},
      ${request.requestId}::uuid,${JSON.stringify([snapshot])}::jsonb)`.execute(tx);

  const existing = (await sql<{ id: string; status: string | null; remarks: string }>`SELECT id,status,remarks FROM activity_attendance_entries
    WHERE register_id=${register.id}::uuid AND person_id=${identity.person_id}::uuid FOR UPDATE`.execute(tx)).rows[0];
  let accepted = false;
  if (policy.mode === "automatic" && !existing?.status) {
    const configurationHash = createHash("sha256").update(JSON.stringify({ revision: policy.revision,mode: policy.mode,channels: policy.channels,
      approved_by: policy.updated_by,approved_at: policy.updated_at.toISOString() })).digest("hex");
    const ruleRef = `institution_operating_rules:${schoolId}:${policy.revision}`;
    const actor = await runtime.configured.configureSoftwareActor(tx,{ school_id: schoolId,approved_by_user_id: policy.updated_by,
      source_domain: "attendance",source_record_id: schoolId,source_revision: policy.revision,configuration_hash: configurationHash,
      operating_rule_ref: ruleRef,allowed_commands: ["attendance.participation.accept_configured_evidence"],approved_at: policy.updated_at.toISOString(),
      effective_from: policy.updated_at.toISOString(),label: "Configured participation check-in acceptance" });
    const current = { ...register,revision: reportRevision }, revision = reportRevision + 1;
    const software = await runtime.configured.prepareSoftwareCommand(tx,{ school_id: schoolId,actor_agent_id: actor.agent_id,
      behaviour_version_id: actor.behaviour_version_id,command_type: "attendance.participation.accept_configured_evidence",
      handler_key: "attendance.participation_configured_evidence",handler_version: 1,source_domain: "attendance",target: runtime.target(current),
      current_revision: reportRevision,expected_revision: reportRevision,capability: "attendance:review",purpose: "accept_configured_own_report",
      requested_at: now.toISOString(),correlation_id: request.requestId,causation_id: reported.modelEventId,idempotency_key: `qr-accept:${evidenceId}`,
      operating_rule_version_ref: ruleRef,configuration_refs: [{ kind: "behaviour",ref: actor.behaviour_version_id,version: String(policy.revision) }],
      authority_attestation: { evaluator_domain: "attendance",decision: "allowed",reason_codes: ["explicit_current_self_check_in_policy"],
        authority_source_refs: [{ rule_ref: ruleRef,evidence_id: evidenceId,configuration_hash: configurationHash }],operating_rule_refs: [{ ref: ruleRef }],valid_until: input.window.closes_at },
      safe_context: { occurrence_id: register.occurrence_id,evidence_id: evidenceId,no_existing_decision: true } });
    if (software.status !== "ready") throw new ConflictException("The configured check-in decision has already completed.");
    const entry = (await sql<{ id: string }>`INSERT INTO activity_attendance_entries(school_id,register_id,person_id,status,remarks,capture_channel,
      observed_at,recorded_by,recorded_by_agent_id,revision,updated_at) VALUES(${schoolId}::uuid,${register.id}::uuid,${identity.person_id}::uuid,'present',${existing?.remarks ?? ""},'self_check_in',
        ${now},NULL,${actor.agent_id}::uuid,${revision},${now}) ON CONFLICT(register_id,person_id) DO UPDATE SET status='present',remarks=excluded.remarks,capture_channel='self_check_in',
        observed_at=excluded.observed_at,recorded_by=NULL,recorded_by_agent_id=excluded.recorded_by_agent_id,revision=excluded.revision,updated_at=excluded.updated_at
      RETURNING id`.execute(tx)).rows[0]!;
    const history = (await sql<{ id: string }>`INSERT INTO activity_attendance_entry_revisions(school_id,register_id,entry_id,person_id,previous_status,new_status,
      previous_remarks,new_remarks,capture_channel,observed_at,reason,changed_by,changed_by_agent_id,request_id,register_revision)
      VALUES(${schoolId}::uuid,${register.id}::uuid,${entry.id}::uuid,${identity.person_id}::uuid,NULL,'present',${existing?.remarks ?? null},${existing?.remarks ?? ""},'self_check_in',${now},
        'Accepted own evidence under the explicitly approved institution rule',NULL,${actor.agent_id}::uuid,${request.requestId}::uuid,${revision}) RETURNING id::text`.execute(tx)).rows[0]!;
    await sql`UPDATE activity_attendance_evidence SET state='accepted',decided_by=NULL,decided_by_agent_id=${actor.agent_id}::uuid,
      decided_at=${now},decision_note='Accepted own evidence under the explicitly approved institution rule' WHERE id=${evidenceId}::uuid`.execute(tx);
    await sql`UPDATE activity_attendance_registers SET revision=${revision},updated_at=${now} WHERE id=${register.id}::uuid`.execute(tx);
    const decided = await emit("automatic_evidence",revision,actor,reported.modelEventId);
    await runtime.observations.transitionObservations(tx,{ school_id: schoolId,source_type: "attendance.participation",source_ref: evidenceId,state: "accepted" });
    await sql`INSERT INTO activity_attendance_audits(school_id,register_id,action,actor_id,reason,register_revision,request_id,source_refs)
      VALUES(${schoolId}::uuid,${register.id}::uuid,'automatic_evidence',NULL,'Explicit configured check-in acceptance',${revision},${request.requestId}::uuid,
        ${JSON.stringify([{ actor_agent_id: actor.agent_id,behaviour_version_id: actor.behaviour_version_id,rule_ref: ruleRef,evidence_id: evidenceId }])}::jsonb)`.execute(tx);
    const result = { status: "recorded",evidence_id: evidenceId,register_id: register.id };
    await sql`INSERT INTO activity_attendance_commands(school_id,register_id,actor_id,actor_agent_id,model_command_id,operation,idempotency_key,request_hash,request_id,register_revision,result_body)
      VALUES(${schoolId}::uuid,${register.id}::uuid,NULL,${actor.agent_id}::uuid,${software.command_id}::uuid,'automatic_evidence',${`qr-accept:${evidenceId}`},
        ${configurationHash},${request.requestId}::uuid,${revision},${JSON.stringify(result)}::jsonb)`.execute(tx);
    await runtime.commands.completeDomainCommand(tx,{ school_id: schoolId,command_id: software.command_id,terminal_state: "accepted",code: "configured_own_report_accepted",
      explanation: "An identified software actor accepted the original participant report under current approved policy, without replacing another decision.",
      resulting_revision: revision,domain_event_id: decided.outboxId,metadata: { evidence_id: evidenceId,model_event_id: decided.modelEventId,
        actor_agent_id: actor.agent_id,behaviour_version_id: actor.behaviour_version_id },completed_at: now.toISOString() });
    await runtime.observe(current,identity.person_id,history.id,"accepted",decided.outboxId,now,[`activity_attendance_evidence:${evidenceId}`,`configured_actor:${actor.agent_id}`],
      {...actor,command_id:software.command_id});
    await runtime.effects(revision,"automatic_evidence",null);
    accepted = true;
  }
  const result = { status: accepted ? "recorded" : "pending_review",evidence_id: evidenceId,register_id: register.id };
  await sql`INSERT INTO activity_attendance_commands(school_id,register_id,actor_id,model_command_id,operation,idempotency_key,request_hash,request_id,register_revision,result_body)
    VALUES(${schoolId}::uuid,${register.id}::uuid,${user.id}::uuid,${report.command_id}::uuid,'self_report',${key},
      ${createHash("sha256").update(JSON.stringify({ register_id: register.id,person_id: identity.person_id,source: input.source_reference })).digest("hex")},
      ${request.requestId}::uuid,${reportRevision},${JSON.stringify(result)}::jsonb)`.execute(tx);
  await runtime.synchronize();
  if (!accepted) await runtime.effects(reportRevision,"self_report",user.id);
  return result;
}
