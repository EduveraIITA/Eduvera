import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { ExamOperationsService } from "../assessments/exam-operations.service.js";
import type { SimulationExecutionEnvironment } from "../campus-model-core/execution-environment.contracts.js";
import { createSimulationExecutionEnvironment } from "../campus-model-core/execution-environment.runtime.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { ExecutionDataPlaneScope } from "../database/execution-data-plane.js";
import { StaffOperationsService } from "../staff-operations/staff-operations.service.js";
import type {
  SimulationBehaviourConfigurationV2,
  SimulationOfferResponseBehaviour,
} from "./simulation.contracts.js";
import type { AdvanceSimulationWorldInput } from "./simulation-world.port.js";

export type SyntheticOfferResponse = "accepted" | "declined" | "no_response";

export interface ApprovedSimulationBehaviourConfiguration {
  readonly version_ref: string;
  /** Canonical SHA-256 of the normalized policy, shared by controlled duplicates. */
  readonly configuration_hash: string;
  readonly configuration: SimulationBehaviourConfigurationV2;
}

export interface SimulationOfferResponseSummary {
  readonly coverage_offers: Readonly<Record<SyntheticOfferResponse | "refused", number>>;
  readonly invigilation_offers: Readonly<Record<SyntheticOfferResponse | "refused", number>>;
}

interface OfferCandidate {
  id: string;
  revision: number;
  due_at: Date | string;
  user_id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: AuthUser["role"];
  is_active: boolean;
}

interface InvigilationOfferCandidate extends OfferCandidate {
  assessment_id: string;
}

function emptyCounts(): Record<SyntheticOfferResponse | "refused", number> {
  return { accepted: 0, declined: 0, no_response: 0, refused: 0 };
}

function deterministicUuid(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** Stable cohort draw. It is a declared assumption, never inferred person intent. */
export function syntheticOfferResponse(
  deterministicSeed: string,
  configurationHash: string,
  context: string,
  policy: SimulationOfferResponseBehaviour,
): SyntheticOfferResponse {
  const sample = createHash("sha256")
    .update(`${deterministicSeed}:${configurationHash}:${context}`)
    .digest()
    .readUInt32BE(0) / 0x1_0000_0000;
  if (sample < policy.accepted) return "accepted";
  if (sample < policy.accepted + policy.declined) return "declined";
  return "no_response";
}

function actor(candidate: OfferCandidate, institutionId: string): AuthUser {
  return {
    id: candidate.user_id,
    username: candidate.username,
    email: candidate.email,
    first_name: candidate.first_name,
    last_name: candidate.last_name,
    role: candidate.role,
    is_active: candidate.is_active,
    active_school_id: institutionId,
  };
}

function environmentAt(
  environment: SimulationExecutionEnvironment,
  instant: Date | string,
): SimulationExecutionEnvironment {
  const now = new Date(instant).toISOString();
  return createSimulationExecutionEnvironment({
    institution_id: environment.institution_id,
    scenario_id: environment.scenario_id,
    run_id: environment.run_id,
    source_snapshot_ref: environment.source_snapshot_ref,
    coverage_gate: environment.coverage_gate,
    expires_at: environment.expires_at,
    virtual_clock: {
      now: () => new Date(now),
      nowIso: () => now,
      advanceBy: () => { throw new Error("Only the durable Simulation worker may advance virtual time."); },
      advanceTo: () => { throw new Error("Only the durable Simulation worker may advance virtual time."); },
    },
  });
}

/**
 * Runs only administrator-approved cohort assumptions through the same native
 * recipient, revision, authority, invariant, audit and Core coordination paths
 * as Live. It never creates an offer, chooses its recipient, or widens authority.
 */
@Injectable()
export class SimulationOfferResponseAdapter {
  constructor(
    private readonly db: DatabaseService,
    private readonly scope: ExecutionDataPlaneScope,
    private readonly staff: StaffOperationsService,
    private readonly examinations: ExamOperationsService,
  ) {}

  async advanceOfferResponses(
    input: AdvanceSimulationWorldInput,
    environment: SimulationExecutionEnvironment,
    approved: ApprovedSimulationBehaviourConfiguration,
  ): Promise<SimulationOfferResponseSummary> {
    if (!/^[0-9a-f]{64}$/u.test(approved.configuration_hash)) {
      throw new Error("The approved Simulation behaviour has no canonical configuration hash.");
    }
    const coverage = emptyCounts();
    const invigilation = emptyCounts();
    if (approved.configuration.coverage_offers.enabled) {
      await this.advanceCoverageOffers(input, environment, approved, coverage);
    }
    if (approved.configuration.invigilation_offers.enabled) {
      await this.advanceInvigilationOffers(input, environment, approved, invigilation);
    }
    return { coverage_offers: coverage, invigilation_offers: invigilation };
  }

  private async advanceCoverageOffers(
    input: AdvanceSimulationWorldInput,
    environment: SimulationExecutionEnvironment,
    approved: ApprovedSimulationBehaviourConfiguration,
    counts: Record<SyntheticOfferResponse | "refused", number>,
  ): Promise<void> {
    const policy = approved.configuration.coverage_offers;
    const candidates = (await sql<OfferCandidate>`SELECT task.id,task.revision,
        task.offered_at+make_interval(mins=>${policy.response_delay_minutes}) AS due_at,
        profile.user_id,person.username,person.email,person.first_name,person.last_name,
        person.role,person.is_active
      FROM staff_coverage_tasks task
      JOIN staff_profiles profile ON profile.id=task.replacement_staff_profile_id
      JOIN users person ON person.id=profile.user_id
      WHERE task.school_id=${input.institution_id}::uuid AND task.status='offered'
        AND task.offered_at IS NOT NULL AND profile.status='active' AND person.is_active
        AND task.offered_at+make_interval(mins=>${policy.response_delay_minutes})>${input.virtual_from}::timestamptz
        AND task.offered_at+make_interval(mins=>${policy.response_delay_minutes})<=${input.virtual_to}::timestamptz
      ORDER BY due_at,task.id`.execute(this.db)).rows;

    for (const candidate of candidates) {
      const context = `coverage:${candidate.id}:${candidate.revision}`;
      const outcome = syntheticOfferResponse(
        input.deterministic_seed,
        approved.configuration_hash,
        context,
        policy,
      );
      await this.applyResponse({
        input,
        environment,
        approved,
        candidate,
        domain: "coverage_offer",
        outcome,
        counts,
        execute: async (commandId) => this.staff.respondCoverage(
          actor(candidate, input.institution_id),
          input.institution_id,
          candidate.id,
          {
            command_id: commandId,
            expected_revision: candidate.revision,
            decision: outcome,
            note: outcome === "declined"
              ? "Synthetic cohort decline in this Simulation run."
              : "Synthetic cohort acceptance in this Simulation run.",
          },
        ),
      });
    }
  }

  private async advanceInvigilationOffers(
    input: AdvanceSimulationWorldInput,
    environment: SimulationExecutionEnvironment,
    approved: ApprovedSimulationBehaviourConfiguration,
    counts: Record<SyntheticOfferResponse | "refused", number>,
  ): Promise<void> {
    const policy = approved.configuration.invigilation_offers;
    const candidates = (await sql<InvigilationOfferCandidate>`SELECT assignment.id,assignment.assessment_id,
        assignment.revision,assignment.assigned_at+make_interval(mins=>${policy.response_delay_minutes}) AS due_at,
        person.id AS user_id,person.username,person.email,person.first_name,person.last_name,
        person.role,person.is_active
      FROM assessment_sitting_invigilators assignment
      JOIN users person ON person.id=assignment.user_id
      WHERE assignment.school_id=${input.institution_id}::uuid AND assignment.status='offered'
        AND person.is_active
        AND assignment.assigned_at+make_interval(mins=>${policy.response_delay_minutes})>${input.virtual_from}::timestamptz
        AND assignment.assigned_at+make_interval(mins=>${policy.response_delay_minutes})<=${input.virtual_to}::timestamptz
      ORDER BY due_at,assignment.id`.execute(this.db)).rows;

    for (const candidate of candidates) {
      const context = `invigilation:${candidate.id}:${candidate.revision}`;
      const outcome = syntheticOfferResponse(
        input.deterministic_seed,
        approved.configuration_hash,
        context,
        policy,
      );
      await this.applyResponse({
        input,
        environment,
        approved,
        candidate,
        domain: "invigilation_offer",
        outcome,
        counts,
        execute: async (commandId) => this.examinations.respondInvigilator(
          actor(candidate, input.institution_id),
          input.institution_id,
          candidate.assessment_id,
          candidate.id,
          {
            command_id: commandId,
            expected_revision: candidate.revision,
            decision: outcome,
            note: outcome === "declined"
              ? "Synthetic cohort decline in this Simulation run."
              : "Synthetic cohort acceptance in this Simulation run.",
          },
        ),
      });
    }
  }

  private async applyResponse(input: {
    input: AdvanceSimulationWorldInput;
    environment: SimulationExecutionEnvironment;
    approved: ApprovedSimulationBehaviourConfiguration;
    candidate: OfferCandidate;
    domain: "coverage_offer" | "invigilation_offer";
    outcome: SyntheticOfferResponse;
    counts: Record<SyntheticOfferResponse | "refused", number>;
    execute: (commandId: string) => Promise<unknown>;
  }): Promise<void> {
    const key = `${input.input.run_id}:${input.domain}:${input.candidate.id}:${input.candidate.revision}:${input.approved.configuration_hash}`;
    const receiptId = deterministicUuid(`simulation-behaviour-receipt:${key}`);
    const prior = await this.db.selectFrom("audit_events").select("id").where("id", "=", receiptId).executeTakeFirst();
    if (prior) return;
    const commandId = deterministicUuid(`simulation-behaviour-command:${key}`);
    const actionEnvironment = environmentAt(input.environment, input.candidate.due_at);
    if (input.outcome === "no_response") {
      await this.recordReceipt({ ...input, receiptId, commandId, action: "simulation.actor.no_response" });
      input.counts.no_response += 1;
      return;
    }
    try {
      await this.scope.run(actionEnvironment, () => input.execute(commandId));
      await this.recordReceipt({ ...input, receiptId, commandId, action: "simulation.actor.synthetic_response" });
      input.counts[input.outcome] += 1;
    } catch (error) {
      await this.recordReceipt({
        ...input,
        receiptId,
        commandId,
        action: "simulation.actor.domain_refused",
        refusal: error instanceof Error ? error.message.slice(0, 300) : "The owning domain refused the synthetic action.",
      });
      input.counts.refused += 1;
    }
  }

  private async recordReceipt(input: {
    input: AdvanceSimulationWorldInput;
    approved: ApprovedSimulationBehaviourConfiguration;
    candidate: OfferCandidate;
    domain: "coverage_offer" | "invigilation_offer";
    outcome: SyntheticOfferResponse;
    receiptId: string;
    commandId: string;
    action: string;
    refusal?: string;
  }): Promise<void> {
    await this.db.insertInto("audit_events").values({
      id: input.receiptId,
      action: input.action,
      actor_id: input.candidate.user_id,
      school_id: input.input.institution_id,
      target_type: input.domain,
      target_id: input.candidate.id,
      request_id: input.commandId,
      ip_hash: null,
      metadata: {
        environment: "simulation",
        run_id: input.input.run_id,
        policy_version: input.approved.version_ref,
        configuration_hash: input.approved.configuration_hash,
        declared_cohort_outcome: input.outcome,
        evidence_mode: "synthetic_cohort_assumption",
        ...(input.refusal ? { refusal: input.refusal } : {}),
      },
    }).onConflict((conflict) => conflict.column("id").doNothing()).execute();
  }
}
