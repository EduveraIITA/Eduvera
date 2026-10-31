var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import { configureSimulationBehaviourSchema, normalizeSimulationBehaviourConfiguration, } from "./simulation.contracts.js";
import { simulationMetricLabel } from "./simulation-metrics.js";
import { SimulationCapacityException, } from "./simulation-resource-policy.js";
function iso(value) {
    if (value === null)
        return null;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()))
        throw new Error("Simulation persistence returned an invalid instant.");
    return parsed.toISOString();
}
function integer(value, label) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0)
        throw new Error(`${label} is outside the safe integer range.`);
    return parsed;
}
function sourceRevisions(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return Object.freeze({});
    const entries = Object.entries(value).filter((entry) => typeof entry[1] === "string");
    return Object.freeze(Object.fromEntries(entries));
}
function persistedRun(row) {
    if (!row.namespace_id.startsWith(`scenario:${row.scenario_id}:run:${row.id}`)) {
        throw new Error("Simulation persistence returned a mismatched namespace.");
    }
    return {
        id: row.id,
        school_id: row.school_id,
        scenario_id: row.scenario_id,
        namespace_id: row.namespace_id,
        created_by_user_id: row.created_by_user_id,
        kind: row.kind,
        name: row.name,
        status: row.status,
        speed: Number(row.speed),
        deterministic_seed: row.deterministic_seed,
        time_zone: row.time_zone,
        source_snapshot_ref: row.source_snapshot_ref,
        source_snapshot_hash: row.source_snapshot_hash,
        source_snapshot_at: iso(row.source_snapshot_at),
        source_revisions: sourceRevisions(row.source_revisions),
        world_ref: row.world_ref,
        world_revision: integer(row.world_revision, "World revision"),
        pending_advance: row.pending_advance_to ? {
            virtual_from: iso(row.pending_advance_from), virtual_to: iso(row.pending_advance_to),
            world_revision: integer(row.pending_advance_world_revision, "Pending world revision"),
        } : null,
        manifest_ref: row.manifest_ref,
        manifest_checked_at: iso(row.manifest_checked_at),
        limitations: Object.freeze([...(row.limitations ?? [])]),
        virtual_started_at: iso(row.virtual_started_at),
        virtual_now: iso(row.virtual_now),
        simulated_elapsed_ms: integer(row.simulated_elapsed_ms, "Simulated duration"),
        end_at: iso(row.end_at),
        retention_expires_at: iso(row.retention_expires_at),
        resource_reservation_bytes: integer(row.resource_reservation_bytes, "Resource reservation"),
        observed_storage_bytes: integer(row.observed_storage_bytes, "Observed storage"),
        storage_measured_at: iso(row.storage_measured_at),
        resource_paused_at: iso(row.resource_paused_at),
        resource_pause_reason: row.resource_pause_reason,
        lease_recovery_count: row.lease_recovery_count,
        retention_policy_version: row.retention_policy_version,
        retention_started_at: iso(row.retention_started_at),
        pinned_at: iso(row.pinned_at),
        pinned_by_user_id: row.pinned_by_user_id,
        gc_state: row.gc_state,
        gc_lease_owner: row.gc_lease_owner,
        gc_lease_token: row.gc_lease_token,
        gc_lease_until: iso(row.gc_lease_until),
        gc_lease_fence: integer(row.gc_lease_fence, "Garbage-collection lease fence"),
        gc_failure_count: row.gc_failure_count,
        gc_failure_reason: row.gc_failure_reason,
        gc_next_attempt_at: iso(row.gc_next_attempt_at),
        world_discarded_at: iso(row.world_discarded_at),
        wall_anchor_at: iso(row.wall_anchor_at),
        virtual_anchor_at: iso(row.virtual_anchor_at),
        next_wake_at: iso(row.next_wake_at),
        next_event_at: iso(row.next_event_at),
        last_checkpoint_at: iso(row.last_checkpoint_at),
        event_count: integer(row.event_count, "Event count"),
        checkpoint_count: integer(row.checkpoint_count, "Checkpoint count"),
        failure_reason: row.failure_reason,
        created_at: iso(row.created_at),
        updated_at: iso(row.updated_at),
        started_at: iso(row.started_at),
        paused_at: iso(row.paused_at),
        stopped_at: iso(row.stopped_at),
        completed_at: iso(row.completed_at),
        lease_owner: row.lease_owner,
        lease_token: row.lease_token,
        lease_until: iso(row.lease_until),
        lease_fence: integer(row.lease_fence, "Lease fence"),
        failure_count: row.failure_count,
        revision: integer(row.revision, "Run revision"),
    };
}
function metric(row) {
    return {
        key: row.metric_key,
        label: simulationMetricLabel(row.metric_key, row.label),
        unit: row.unit,
        value: row.value === null ? null : Number(row.value),
        measured_at: iso(row.measured_at),
        simulated_elapsed_ms: integer(row.simulated_elapsed_ms, "Metric duration"),
    };
}
function digest(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function configureStoredBehaviour(value) {
    const parsed = configureSimulationBehaviourSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
let SimulationRepository = class SimulationRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async lockInstitution(executor, schoolId, now) {
        await sql `INSERT INTO simulation_institution_resource_states(school_id,updated_at)
      VALUES(${schoolId}::uuid,${now}::timestamptz)
      ON CONFLICT(school_id) DO NOTHING`.execute(executor);
        await sql `SELECT school_id FROM simulation_institution_resource_states
      WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(executor);
    }
    async assertAdmissionCapacity(executor, schoolId, policy, additionalBytes) {
        const usage = (await sql `SELECT count(*) AS worlds,
        COALESCE(sum(GREATEST(resource_reservation_bytes,observed_storage_bytes)),0) AS accounted_bytes
      FROM simulation_runs
      WHERE school_id=${schoolId}::uuid AND gc_state<>'deleted'`.execute(executor)).rows[0];
        const worlds = integer(usage?.worlds ?? 0, "Institution world count");
        const accountedBytes = integer(usage?.accounted_bytes ?? 0, "Institution storage accounting");
        if (worlds >= policy.max_worlds_per_institution) {
            throw new SimulationCapacityException("worlds", policy.max_worlds_per_institution);
        }
        if (accountedBytes + additionalBytes > policy.max_storage_bytes_per_institution) {
            throw new SimulationCapacityException("storage", policy.max_storage_bytes_per_institution);
        }
    }
    async assertRunningCapacity(executor, schoolId, runId, policy) {
        const usage = (await sql `SELECT
        count(*) FILTER(WHERE status='running' AND id<>${runId}::uuid) AS running,
        COALESCE(sum(GREATEST(resource_reservation_bytes,observed_storage_bytes))
          FILTER(WHERE gc_state<>'deleted'),0) AS accounted_bytes
      FROM simulation_runs WHERE school_id=${schoolId}::uuid`.execute(executor)).rows[0];
        const running = integer(usage?.running ?? 0, "Institution running-run count");
        const accountedBytes = integer(usage?.accounted_bytes ?? 0, "Institution storage accounting");
        if (running >= policy.max_running_runs_per_institution) {
            throw new SimulationCapacityException("running_runs", policy.max_running_runs_per_institution);
        }
        if (accountedBytes > policy.max_storage_bytes_per_institution) {
            throw new SimulationCapacityException("storage", policy.max_storage_bytes_per_institution);
        }
    }
    async hasActiveAdminMembership(userId, schoolId) {
        const row = await this.db.selectFrom("school_memberships")
            .select("id")
            .where("user_id", "=", userId)
            .where("school_id", "=", schoolId)
            .where("role", "=", "admin")
            .where("is_active", "=", true)
            .executeTakeFirst();
        return Boolean(row);
    }
    async createPreparing(input) {
        return this.db.transaction().execute(async (transaction) => {
            await this.lockInstitution(transaction, input.school_id, input.now);
            const existing = (await sql `SELECT * FROM simulation_runs
        WHERE school_id=${input.school_id}::uuid AND created_by_user_id=${input.created_by_user_id}::uuid
          AND idempotency_key=${input.idempotency_key}`.execute(transaction)).rows[0];
            if (existing) {
                if (existing.request_hash !== input.request_hash) {
                    throw new ConflictException("This Simulation idempotency key was already used for another request.");
                }
                return persistedRun(existing);
            }
            await this.assertAdmissionCapacity(transaction, input.school_id, input.resource_policy, input.resource_policy.run_storage_reservation_bytes);
            const inserted = (await sql `INSERT INTO simulation_runs(
          id,school_id,scenario_id,namespace_id,created_by_user_id,kind,name,status,speed,
          deterministic_seed,end_at,idempotency_key,request_hash,resource_reservation_bytes,
          created_at,updated_at
        ) VALUES (
          ${input.id}::uuid,${input.school_id}::uuid,${input.scenario_id}::uuid,${input.namespace_id},
          ${input.created_by_user_id}::uuid,${input.kind},${input.name},'preparing',${input.speed},
          ${input.deterministic_seed},${input.end_at}::timestamptz,${input.idempotency_key},
          ${input.request_hash},${input.resource_policy.run_storage_reservation_bytes},
          clock_timestamp(),clock_timestamp()
        ) RETURNING *`.execute(transaction)).rows[0];
            if (!inserted)
                throw new ConflictException("The Simulation draft could not be created.");
            return persistedRun(inserted);
        });
    }
    async completeCapture(input) {
        return this.db.transaction().execute(async (transaction) => {
            const updated = (await sql `UPDATE simulation_runs SET
          status='draft',time_zone=${input.capture.time_zone},
          source_snapshot_ref=${input.capture.source_snapshot.ref},
          source_snapshot_hash=${input.capture.source_snapshot.hash},
          source_snapshot_at=${input.capture.source_snapshot.captured_at}::timestamptz,
          source_revisions=${JSON.stringify(input.capture.source_snapshot.source_revisions)}::jsonb,
          world_ref=${input.capture.world_ref},world_revision=${input.capture.world_revision},
          manifest_ref=${input.capture.manifest_ref},manifest_checked_at=${input.capture.manifest_checked_at}::timestamptz,
          limitations=${[...input.capture.limitations]}::text[],
          observed_storage_bytes=GREATEST(observed_storage_bytes,${input.observed_storage_bytes}),
          storage_measured_at=${input.storage_measured_at}::timestamptz,
          virtual_started_at=${input.capture.virtual_start_at}::timestamptz,
          virtual_now=${input.capture.virtual_start_at}::timestamptz,end_at=${input.end_at}::timestamptz,
          simulated_elapsed_ms=0,checkpoint_count=1,last_checkpoint_at=${input.now}::timestamptz,
          revision=revision+1,updated_at=${input.now}::timestamptz
        WHERE id=${input.run_id}::uuid AND created_by_user_id=${input.owner_id}::uuid AND status='preparing'
        RETURNING *`.execute(transaction)).rows[0];
            if (!updated) {
                const replay = await this.runById(transaction, input.run_id, input.owner_id);
                if (replay?.source_snapshot_hash === input.capture.source_snapshot.hash)
                    return replay;
                throw new ConflictException("The Simulation draft is no longer awaiting snapshot capture.");
            }
            await sql `INSERT INTO simulation_run_checkpoints(
          run_id,school_id,sequence,virtual_from,virtual_to,simulated_elapsed_ms,
          world_checkpoint_ref,world_revision,emitted_event_count,next_event_at,metrics_hash,recorded_at
        ) VALUES (${updated.id}::uuid,${updated.school_id}::uuid,0,
          ${input.capture.virtual_start_at}::timestamptz,${input.capture.virtual_start_at}::timestamptz,0,
          ${`${input.capture.world_ref}:captured`},${input.capture.world_revision},0,NULL,${digest([])},
          ${input.now}::timestamptz)`.execute(transaction);
            return persistedRun(updated);
        });
    }
    async failPreparing(runId, ownerId, reason, now, retentionExpiresAt) {
        await sql `UPDATE simulation_runs SET status='failed',failure_reason=${reason.slice(0, 500)},
      retention_started_at=${now}::timestamptz,retention_expires_at=${retentionExpiresAt}::timestamptz,
      updated_at=${now}::timestamptz,revision=revision+1
      WHERE id=${runId}::uuid AND created_by_user_id=${ownerId}::uuid AND status='preparing'`.execute(this.db);
    }
    /**
     * Recovers a process crash during synchronous capture. The transition is
     * control-plane only: exact target data stays retained and becomes eligible
     * for the ordinary fenced GC path through its origin_run_id lineage.
     */
    async failNextStalePreparing(policy) {
        const row = (await sql `WITH tenant AS MATERIALIZED (
        SELECT state.school_id,stale.created_at
        FROM simulation_institution_resource_states state
        CROSS JOIN LATERAL (
          SELECT run.created_at FROM simulation_runs run
          WHERE run.school_id=state.school_id AND run.status='preparing'
            AND run.gc_state<>'deleted'
            AND run.created_at<=clock_timestamp()-(${policy.preparation_timeout_ms} * interval '1 millisecond')
          ORDER BY run.created_at,run.id LIMIT 1
        ) stale
        ORDER BY stale.created_at,state.school_id
        FOR UPDATE OF state SKIP LOCKED LIMIT 1
      ), candidate AS (
        SELECT run.id FROM simulation_runs run JOIN tenant ON tenant.school_id=run.school_id
        WHERE run.status='preparing' AND run.gc_state<>'deleted'
          AND run.created_at<=clock_timestamp()-(${policy.preparation_timeout_ms} * interval '1 millisecond')
        ORDER BY run.created_at,run.id FOR UPDATE OF run SKIP LOCKED LIMIT 1
      ) UPDATE simulation_runs run SET status='failed',
        failure_reason='Simulation preparation timed out before its snapshot was durably attached.',
        retention_started_at=clock_timestamp(),
        retention_expires_at=clock_timestamp()+(${policy.terminal_retention_ms} * interval '1 millisecond'),
        updated_at=clock_timestamp(),revision=revision+1
      FROM candidate WHERE run.id=candidate.id AND run.status='preparing'
      RETURNING run.*`.execute(this.db)).rows[0];
        return row ? persistedRun(row) : null;
    }
    async runById(executor, runId, ownerId) {
        const row = (await sql `SELECT * FROM simulation_runs
      WHERE id=${runId}::uuid AND created_by_user_id=${ownerId}::uuid`.execute(executor)).rows[0];
        return row ? persistedRun(row) : null;
    }
    async getOwned(runId, ownerId, schoolId) {
        const row = (await sql `SELECT * FROM simulation_runs
      WHERE id=${runId}::uuid AND created_by_user_id=${ownerId}::uuid AND school_id=${schoolId}::uuid`
            .execute(this.db)).rows[0];
        return row ? persistedRun(row) : null;
    }
    async listOwned(ownerId, schoolId, limit) {
        const rows = (await sql `SELECT * FROM simulation_runs
      WHERE created_by_user_id=${ownerId}::uuid AND school_id=${schoolId}::uuid
      ORDER BY created_at DESC,id DESC LIMIT ${limit}`.execute(this.db)).rows;
        return rows.map(persistedRun);
    }
    async listRetainedOwned(ownerId, schoolId, page) {
        const pageSize = 5;
        // One statement shares a single MVCC snapshot for the count and page. Recent
        // history remains its original latest-ten view; this is capacity recovery.
        const result = (await sql `
      WITH retained AS MATERIALIZED (
        SELECT * FROM simulation_runs
        WHERE school_id=${schoolId}::uuid AND created_by_user_id=${ownerId}::uuid
          AND gc_state<>'deleted'
      ), page AS (
        SELECT * FROM retained ORDER BY created_at DESC,id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      )
      SELECT (SELECT count(*) FROM retained) AS total,
        COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb) AS runs
    `.execute(this.db)).rows[0];
        const total = integer(result?.total ?? 0, "Retained Simulation count");
        return {
            runs: (result?.runs ?? []).map(persistedRun),
            page: { number: page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) },
        };
    }
    async claimRequestedRemoval(input) {
        return this.db.transaction().execute(async (transaction) => {
            // Match Auth's final selection lock before acquiring the run row. A
            // selected world is never removed, even if another session raced the UI.
            await sql `SELECT pg_advisory_xact_lock(hashtextextended(
        ${'simulation-retention:' + input.run_id},0))`.execute(transaction);
            const membership = (await sql `SELECT membership.id FROM school_memberships membership
        JOIN users account ON account.id=membership.user_id
        WHERE membership.user_id=${input.owner_id}::uuid AND membership.school_id=${input.school_id}::uuid
          AND membership.role='admin' AND membership.is_active AND account.is_active
        FOR SHARE OF membership,account`.execute(transaction)).rows[0];
            if (!membership)
                throw new ForbiddenException("An active institution administrator membership is required.");
            const row = (await sql `SELECT *,
          COALESCE(gc_lease_until>clock_timestamp(),false) AS gc_lease_current FROM simulation_runs
        WHERE id=${input.run_id}::uuid AND school_id=${input.school_id}::uuid
          AND created_by_user_id=${input.owner_id}::uuid FOR UPDATE`.execute(transaction)).rows[0];
            if (!row)
                throw new NotFoundException("Simulation run not found.");
            const current = persistedRun(row);
            // The request receipt commits with the claim, before isolated deletion.
            // It binds retry to this actor and exact reviewed control revision, even
            // if a response is lost or the target adapter needs a fresh fenced retry.
            const prior = (await sql `SELECT id FROM audit_events
        WHERE action='simulation.world_removal.requested'
          AND actor_id=${input.owner_id}::uuid AND school_id=${input.school_id}::uuid
          AND target_type='simulation_run' AND target_id=${input.run_id}::uuid
          AND metadata->>'expected_revision'=${String(input.expected_revision)}
        LIMIT 1`.execute(transaction)).rows[0];
            if (prior && current.gc_state === 'deleted' && current.world_discarded_at) {
                return { run: current, lease: null };
            }
            if (!prior && current.revision !== input.expected_revision) {
                throw new ConflictException("This simulation changed. Refresh it before choosing removal again.");
            }
            if (!["stopped", "completed", "failed"].includes(current.status)
                || current.pinned_at || current.world_discarded_at || current.gc_state === 'deleted'
                || current.lease_token || current.pending_advance
                || (current.gc_state === 'deleting' && row.gc_lease_current)) {
                throw new ConflictException("Only an ended, unpinned simulation with no work in progress can be removed.");
            }
            const selected = (await sql `SELECT EXISTS(
        SELECT 1 FROM auth_session_execution_environments environment
        JOIN auth_sessions session ON session.token_hash=environment.token_hash
        WHERE environment.run_id=${input.run_id}::uuid AND environment.school_id=${input.school_id}::uuid
          AND environment.expires_at>clock_timestamp() AND session.expires_at>clock_timestamp()
      ) AS present`.execute(transaction)).rows[0]?.present;
            if (selected)
                throw new ConflictException("Return every session using this simulation to Live before removing it.");
            if (!prior) {
                await transaction.insertInto("audit_events").values({
                    action: "simulation.world_removal.requested",
                    actor_id: input.owner_id,
                    school_id: input.school_id,
                    target_type: "simulation_run",
                    target_id: input.run_id,
                    request_id: randomUUID(),
                    ip_hash: null,
                    metadata: { expected_revision: input.expected_revision, source_snapshot_ref: current.source_snapshot_ref,
                        world_ref: current.world_ref, authority: "current_admin_and_run_owner" },
                }).execute();
            }
            const worker = `simulation-remove:${input.owner_id}`;
            const claimed = (await sql `UPDATE simulation_runs SET
          retention_expires_at=clock_timestamp(),gc_state='deleting',
          gc_lease_owner=${worker},gc_lease_token=${input.lease_token}::uuid,
          gc_lease_until=clock_timestamp()+make_interval(secs=>${input.lease_seconds}),
          gc_lease_fence=gc_lease_fence+1,gc_failure_reason=NULL,gc_next_attempt_at=NULL,
          updated_at=clock_timestamp(),revision=revision+1
        WHERE id=${input.run_id}::uuid RETURNING *`.execute(transaction)).rows[0];
            if (!claimed)
                throw new ConflictException("The simulation could not be claimed for removal.");
            const run = persistedRun(claimed);
            return { run, lease: { run, lease_owner: worker, lease_token: input.lease_token,
                    lease_until: run.gc_lease_until, lease_fence: run.gc_lease_fence } };
        });
    }
    async updateDraft(input) {
        const hasName = input.name !== undefined;
        const hasSpeed = input.speed !== undefined;
        const hasEnd = Object.prototype.hasOwnProperty.call(input, "end_at");
        const row = (await sql `UPDATE simulation_runs SET
        name=CASE WHEN ${hasName} THEN ${input.name ?? null} ELSE name END,
        speed=CASE WHEN ${hasSpeed} THEN ${input.speed ?? 20} ELSE speed END,
        end_at=CASE WHEN ${hasEnd} THEN ${input.end_at ?? null}::timestamptz ELSE end_at END,
        updated_at=${input.now}::timestamptz,revision=revision+1
      WHERE id=${input.run_id}::uuid AND created_by_user_id=${input.owner_id}::uuid AND status='draft'
        AND (NOT ${hasEnd} OR ${input.end_at ?? null}::timestamptz IS NULL
          OR ${input.end_at ?? null}::timestamptz>virtual_started_at)
      RETURNING *`.execute(this.db)).rows[0];
        if (!row)
            throw new ConflictException("Only a captured draft can be edited, and its end must follow its start.");
        return persistedRun(row);
    }
    async start(input) {
        const hasEnd = Object.prototype.hasOwnProperty.call(input, "end_at");
        return this.db.transaction().execute(async (transaction) => {
            await this.lockInstitution(transaction, input.school_id, input.now);
            await this.assertRunningCapacity(transaction, input.school_id, input.run_id, input.resource_policy);
            const row = (await sql `UPDATE simulation_runs SET status='running',
          speed=COALESCE(${input.speed ?? null},speed),
          end_at=CASE WHEN ${hasEnd} THEN ${input.end_at ?? null}::timestamptz ELSE end_at END,
          wall_anchor_at=${input.now}::timestamptz,virtual_anchor_at=virtual_now,
          next_wake_at=${input.next_wake_at}::timestamptz,started_at=COALESCE(started_at,${input.now}::timestamptz),
          paused_at=NULL,resource_paused_at=NULL,resource_pause_reason=NULL,
          updated_at=${input.now}::timestamptz,revision=revision+1
        WHERE id=${input.run_id}::uuid AND school_id=${input.school_id}::uuid
          AND created_by_user_id=${input.owner_id}::uuid AND status='draft'
          AND (NOT ${hasEnd} OR ${input.end_at ?? null}::timestamptz IS NULL
            OR ${input.end_at ?? null}::timestamptz>virtual_now)
        RETURNING *`.execute(transaction)).rows[0];
            if (!row)
                throw new ConflictException("Only a captured draft can start, and its end must follow the current virtual time.");
            return persistedRun(row);
        });
    }
    async pause(runId, ownerId, now) {
        const row = (await sql `UPDATE simulation_runs SET status='paused',
        wall_anchor_at=NULL,virtual_anchor_at=NULL,next_wake_at=NULL,paused_at=${now}::timestamptz,
        resource_paused_at=NULL,resource_pause_reason=NULL,
        lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=${now}::timestamptz,revision=revision+1
      WHERE id=${runId}::uuid AND created_by_user_id=${ownerId}::uuid AND status='running'
        AND lease_token IS NULL AND pending_advance_to IS NULL
      RETURNING *`.execute(this.db)).rows[0];
        if (!row)
            throw new ConflictException("The run is not running or has a checkpoint awaiting recovery. Let it finish before pausing.");
        return persistedRun(row);
    }
    async resume(input) {
        return this.db.transaction().execute(async (transaction) => {
            await this.lockInstitution(transaction, input.school_id, input.now);
            await this.assertRunningCapacity(transaction, input.school_id, input.run_id, input.resource_policy);
            const row = (await sql `UPDATE simulation_runs SET status='running',
          speed=COALESCE(${input.speed ?? null},speed),wall_anchor_at=${input.now}::timestamptz,
          virtual_anchor_at=virtual_now,next_wake_at=${input.next_wake_at}::timestamptz,paused_at=NULL,
          resource_paused_at=NULL,resource_pause_reason=NULL,
          updated_at=${input.now}::timestamptz,revision=revision+1
        WHERE id=${input.run_id}::uuid AND school_id=${input.school_id}::uuid
          AND created_by_user_id=${input.owner_id}::uuid AND status='paused'
          AND (end_at IS NULL OR virtual_now<end_at)
        RETURNING *`.execute(transaction)).rows[0];
            if (!row)
                throw new ConflictException("Only a paused, unfinished run can resume.");
            return persistedRun(row);
        });
    }
    async stop(runId, ownerId, now, retentionExpiresAt) {
        const row = (await sql `UPDATE simulation_runs SET status='stopped',
        stopped_at=${now}::timestamptz,wall_anchor_at=NULL,virtual_anchor_at=NULL,next_wake_at=NULL,
        retention_started_at=${now}::timestamptz,retention_expires_at=${retentionExpiresAt}::timestamptz,
        resource_paused_at=NULL,resource_pause_reason=NULL,
        lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=${now}::timestamptz,revision=revision+1
      WHERE id=${runId}::uuid AND created_by_user_id=${ownerId}::uuid
        AND status IN ('draft','running','paused') AND lease_token IS NULL AND pending_advance_to IS NULL
      RETURNING *`.execute(this.db)).rows[0];
        if (!row)
            throw new ConflictException("This run is already terminal or has a checkpoint awaiting recovery. Resume it to finish that checkpoint before stopping.");
        return persistedRun(row);
    }
    async pin(input) {
        return this.db.transaction().execute(async (transaction) => {
            await this.lockInstitution(transaction, input.school_id, input.now);
            const current = await this.runById(transaction, input.run_id, input.owner_id);
            if (!current || current.school_id !== input.school_id) {
                throw new NotFoundException("Simulation run not found.");
            }
            if (current.pinned_at)
                return current;
            const pinned = (await sql `SELECT count(*) AS count
        FROM simulation_runs WHERE school_id=${input.school_id}::uuid
          AND pinned_at IS NOT NULL AND world_discarded_at IS NULL`.execute(transaction)).rows[0];
            if (integer(pinned?.count ?? 0, "Institution pinned-run count")
                >= input.resource_policy.max_pinned_runs_per_institution) {
                throw new SimulationCapacityException("pinned_runs", input.resource_policy.max_pinned_runs_per_institution);
            }
            const row = (await sql `UPDATE simulation_runs SET
          pinned_at=${input.now}::timestamptz,pinned_by_user_id=${input.owner_id}::uuid,
          retention_expires_at=NULL,gc_state='retained',gc_failure_count=0,
          gc_failure_reason=NULL,gc_next_attempt_at=NULL,
          updated_at=${input.now}::timestamptz,revision=revision+1
        WHERE id=${input.run_id}::uuid AND school_id=${input.school_id}::uuid
          AND created_by_user_id=${input.owner_id}::uuid
          AND status IN ('stopped','completed','failed') AND world_discarded_at IS NULL
          AND world_ref IS NOT NULL AND source_snapshot_ref IS NOT NULL
          AND gc_state<>'deleting'
        RETURNING *`.execute(transaction)).rows[0];
            if (!row)
                throw new ConflictException("Only a retained terminal Simulation world can be pinned.");
            return persistedRun(row);
        });
    }
    async unpin(input) {
        const row = (await sql `UPDATE simulation_runs SET
        pinned_at=NULL,pinned_by_user_id=NULL,retention_started_at=${input.now}::timestamptz,
        retention_expires_at=${input.retention_expires_at}::timestamptz,
        updated_at=${input.now}::timestamptz,revision=revision+1
      WHERE id=${input.run_id}::uuid AND school_id=${input.school_id}::uuid
        AND created_by_user_id=${input.owner_id}::uuid AND pinned_at IS NOT NULL
        AND status IN ('stopped','completed','failed') AND world_discarded_at IS NULL
      RETURNING *`.execute(this.db)).rows[0];
        if (!row)
            throw new ConflictException("This Simulation run is not a pinned retained world.");
        return persistedRun(row);
    }
    async recordStorageMeasurement(input) {
        await sql `UPDATE simulation_runs SET
        observed_storage_bytes=GREATEST(observed_storage_bytes,${input.observed_storage_bytes}),
        storage_measured_at=${input.measured_at}::timestamptz
      WHERE id=${input.run_id}::uuid AND gc_state<>'deleted'`.execute(this.db);
    }
    async recordDraftChange(input) {
        const requestHash = digest({
            domain: input.change.domain,
            change_kind: input.change.change_kind,
            target_ref: input.change.target_ref,
            summary: input.change.summary,
            source_revision: input.change.source_revision,
        });
        const row = (await sql `INSERT INTO simulation_run_draft_changes(
        run_id,school_id,actor_user_id,domain,change_kind,target_ref,summary,source_revision,
        idempotency_key,request_hash,recorded_at
      ) SELECT run.id,run.school_id,${input.actor_id}::uuid,${input.change.domain},${input.change.change_kind},
        ${input.change.target_ref},${input.change.summary},${input.change.source_revision},${input.change.idempotency_key},
        ${requestHash},${input.now}::timestamptz FROM simulation_runs run
      WHERE run.id=${input.run_id}::uuid AND run.school_id=${input.school_id}::uuid
        AND run.created_by_user_id=${input.actor_id}::uuid AND run.kind='scenario' AND run.status='draft'
      ON CONFLICT(run_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
        WHERE simulation_run_draft_changes.request_hash=EXCLUDED.request_hash
      RETURNING id,domain,change_kind,target_ref,summary,source_revision,recorded_at`.execute(this.db)).rows[0];
        if (!row) {
            const replay = (await sql `SELECT request_hash
        FROM simulation_run_draft_changes WHERE run_id=${input.run_id}::uuid
          AND idempotency_key=${input.change.idempotency_key}`.execute(this.db)).rows[0];
            if (replay && replay.request_hash !== requestHash) {
                throw new ConflictException("This draft-change idempotency key was already used for another receipt.");
            }
            throw new ConflictException("Draft changes can be recorded only for an editable scenario draft.");
        }
        return { ...row, recorded_at: iso(row.recorded_at) };
    }
    async metrics(runId, duration) {
        const rows = duration === undefined
            ? (await sql `SELECT DISTINCT ON(metric_key) metric_key,label,unit,value,measured_at,simulated_elapsed_ms
          FROM simulation_run_metric_samples WHERE run_id=${runId}::uuid
          ORDER BY metric_key,simulated_elapsed_ms DESC`.execute(this.db)).rows
            : (await sql `SELECT metric_key,label,unit,value,measured_at,simulated_elapsed_ms
          FROM simulation_run_metric_samples WHERE run_id=${runId}::uuid AND simulated_elapsed_ms=${duration}
          ORDER BY metric_key`.execute(this.db)).rows;
        return rows.map(metric);
    }
    async draftChanges(runId) {
        const rows = (await sql `SELECT id,domain,change_kind,target_ref,summary,source_revision,recorded_at
      FROM simulation_run_draft_changes WHERE run_id=${runId}::uuid ORDER BY recorded_at,id`
            .execute(this.db)).rows;
        return rows.map((row) => ({ ...row, recorded_at: iso(row.recorded_at) }));
    }
    async recordBehaviour(input) {
        await this.db.transaction().execute(async (transaction) => {
            const locked = (await sql `SELECT id FROM simulation_runs
        WHERE id=${input.run_id}::uuid AND school_id=${input.school_id}::uuid
          AND created_by_user_id=${input.actor_id}::uuid AND status='draft'
        FOR UPDATE`.execute(transaction)).rows[0];
            if (!locked)
                throw new ConflictException("Simulation behaviour can be configured only while the run is a draft.");
            await sql `INSERT INTO simulation_run_behaviour_configurations(
          run_id,school_id,behaviour_key,configuration_revision,configuration,version_ref,
          configuration_hash,approved_by_agent_id,configured_by_user_id,configured_at
        ) SELECT ${input.run_id}::uuid,${input.school_id}::uuid,'simulation_campus_activity',
          COALESCE(max(configuration_revision),0)+1,${JSON.stringify(input.configuration)}::jsonb,
          ${input.receipt.version_ref},${input.receipt.configuration_hash},
          ${input.receipt.approved_by_agent_id}::uuid,${input.actor_id}::uuid,
          ${input.receipt.configured_at}::timestamptz
        FROM simulation_run_behaviour_configurations WHERE run_id=${input.run_id}::uuid
        ON CONFLICT(run_id,version_ref) DO NOTHING`.execute(transaction);
            await sql `UPDATE simulation_runs SET updated_at=${input.receipt.configured_at}::timestamptz,
        revision=revision+1 WHERE id=${input.run_id}::uuid`.execute(transaction);
        });
    }
    async behaviour(runId) {
        const row = (await sql `SELECT configuration,version_ref,configuration_hash,approved_by_agent_id,configured_at
      FROM simulation_run_behaviour_configurations WHERE run_id=${runId}::uuid
        AND behaviour_key='simulation_campus_activity'
      ORDER BY configuration_revision DESC LIMIT 1`.execute(this.db)).rows[0];
        if (!row || !row.configuration || typeof row.configuration !== "object" || Array.isArray(row.configuration))
            return null;
        const parsed = configureStoredBehaviour(row.configuration);
        if (!parsed)
            return null;
        const normalized = normalizeSimulationBehaviourConfiguration(parsed);
        const provenance = {
            version_ref: row.version_ref,
            configuration_hash: row.configuration_hash,
            approved_by_agent_id: row.approved_by_agent_id,
            configured_at: iso(row.configured_at),
        };
        return {
            ...normalized,
            attendance: { ...normalized.attendance, ...provenance },
            provenance,
        };
    }
    async checkpointOffsets(runIds) {
        const rows = (await sql `
      SELECT run_id,simulated_elapsed_ms FROM simulation_run_checkpoints
      WHERE run_id=ANY(${[...runIds]}::uuid[]) ORDER BY run_id,simulated_elapsed_ms`.execute(this.db)).rows;
        const result = new Map(runIds.map((runId) => [runId, []]));
        for (const row of rows)
            result.get(row.run_id)?.push(integer(row.simulated_elapsed_ms, "Checkpoint duration"));
        return result;
    }
    async latestCheckpointRef(runId) {
        const row = (await sql `SELECT world_checkpoint_ref
      FROM simulation_run_checkpoints WHERE run_id=${runId}::uuid ORDER BY sequence DESC LIMIT 1`
            .execute(this.db)).rows[0];
        return row?.world_checkpoint_ref ?? null;
    }
    async pauseNextRunOverBudget(now, policy) {
        const row = (await sql `WITH tenant AS MATERIALIZED (
        SELECT state.school_id,usage.running,usage.accounted_bytes
        FROM simulation_institution_resource_states state
        CROSS JOIN LATERAL (
          SELECT count(*) FILTER(WHERE run.status='running') AS running,
            COALESCE(sum(GREATEST(run.resource_reservation_bytes,run.observed_storage_bytes))
              FILTER(WHERE run.gc_state<>'deleted'),0) AS accounted_bytes
          FROM simulation_runs run WHERE run.school_id=state.school_id
        ) usage
        WHERE usage.running>${policy.max_running_runs_per_institution}
          OR usage.accounted_bytes>${policy.max_storage_bytes_per_institution}
        ORDER BY state.school_id
        FOR UPDATE OF state SKIP LOCKED LIMIT 1
      ), candidate AS (
        SELECT run.id,
          CASE WHEN tenant.running>${policy.max_running_runs_per_institution}
            THEN 'Institution Simulation running-run budget reached.'
            ELSE 'Institution Simulation storage budget reached.' END AS reason
        FROM simulation_runs run JOIN tenant ON tenant.school_id=run.school_id
        WHERE run.status='running' AND run.lease_token IS NULL
        ORDER BY run.started_at DESC NULLS LAST,run.id DESC
        FOR UPDATE OF run SKIP LOCKED LIMIT 1
      ) UPDATE simulation_runs run SET status='paused',
        paused_at=${now}::timestamptz,resource_paused_at=${now}::timestamptz,
        resource_pause_reason=candidate.reason,wall_anchor_at=NULL,virtual_anchor_at=NULL,
        next_wake_at=NULL,updated_at=${now}::timestamptz,revision=revision+1
      FROM candidate WHERE run.id=candidate.id RETURNING run.*`.execute(this.db)).rows[0];
        return row ? persistedRun(row) : null;
    }
    async claimDue(workerId, leaseToken, _now, leaseSeconds, maxLeasesPerInstitution) {
        const row = (await sql `WITH tenant AS MATERIALIZED (
        SELECT state.school_id
        FROM simulation_institution_resource_states state
        CROSS JOIN LATERAL (
          SELECT min(run.next_wake_at) AS due_at FROM simulation_runs run
          WHERE run.school_id=state.school_id AND run.status='running'
            AND run.next_wake_at<=clock_timestamp()
            AND (run.lease_until IS NULL OR run.lease_until<clock_timestamp())
        ) due
        WHERE due.due_at IS NOT NULL
          AND (SELECT count(*) FROM simulation_runs active
            WHERE active.school_id=state.school_id AND active.status='running'
              AND active.lease_token IS NOT NULL AND active.lease_until>=clock_timestamp())
            < ${maxLeasesPerInstitution}
        ORDER BY due.due_at,state.school_id
        FOR UPDATE OF state SKIP LOCKED LIMIT 1
      ), candidate AS (
        SELECT run.id,run.lease_token AS expired_token
        FROM simulation_runs run JOIN tenant ON tenant.school_id=run.school_id
        WHERE run.status='running' AND run.next_wake_at<=clock_timestamp()
          AND (run.lease_until IS NULL OR run.lease_until<clock_timestamp())
        ORDER BY run.next_wake_at,run.id FOR UPDATE OF run SKIP LOCKED LIMIT 1
      ) UPDATE simulation_runs run SET lease_owner=${workerId},lease_token=${leaseToken}::uuid,
        lease_until=clock_timestamp()+make_interval(secs=>${leaseSeconds}),
        lease_fence=run.lease_fence+1,
        lease_recovery_count=run.lease_recovery_count+CASE WHEN candidate.expired_token IS NULL THEN 0 ELSE 1 END,
        updated_at=clock_timestamp()
      FROM candidate WHERE run.id=candidate.id RETURNING run.*`.execute(this.db)).rows[0];
        if (!row)
            return null;
        const run = persistedRun(row);
        return { run, lease_owner: workerId, lease_token: leaseToken,
            lease_until: run.lease_until, lease_fence: run.lease_fence };
    }
    async retainAdvanceTarget(lease, virtualTo) {
        const row = (await sql `UPDATE simulation_runs SET
        pending_advance_from=COALESCE(pending_advance_from,virtual_now),
        pending_advance_to=COALESCE(pending_advance_to,${virtualTo}::timestamptz),
        pending_advance_world_revision=COALESCE(pending_advance_world_revision,world_revision)
      WHERE id=${lease.run.id}::uuid AND school_id=${lease.run.school_id}::uuid
        AND status='running' AND lease_owner=${lease.lease_owner} AND lease_token=${lease.lease_token}::uuid
        AND lease_fence=${lease.lease_fence} AND lease_until>clock_timestamp()
        AND virtual_now=${lease.run.virtual_now}::timestamptz AND world_revision=${lease.run.world_revision}
        AND ${virtualTo}::timestamptz>virtual_now
      RETURNING *`.execute(this.db)).rows[0];
        if (!row)
            throw new ConflictException("The Simulation checkpoint target could not be retained under this lease.");
        const target = persistedRun(row).pending_advance;
        if (target.virtual_from !== lease.run.virtual_now || target.world_revision !== lease.run.world_revision) {
            throw new ConflictException("The pending Simulation checkpoint no longer matches its control-plane base.");
        }
        return target;
    }
    async completeAdvance(input) {
        return this.db.transaction().execute(async (transaction) => {
            await this.lockInstitution(transaction, input.lease.run.school_id, input.now);
            const checkpointId = (await sql `INSERT INTO simulation_run_checkpoints(
          run_id,school_id,sequence,virtual_from,virtual_to,simulated_elapsed_ms,world_checkpoint_ref,
          world_revision,emitted_event_count,lease_fence,lease_token,next_event_at,metrics_hash,recorded_at
        ) SELECT run.id,run.school_id,run.checkpoint_count,${input.checkpoint.virtual_from}::timestamptz,
          ${input.checkpoint.virtual_to}::timestamptz,${input.checkpoint.simulated_elapsed_ms},
          ${input.checkpoint.world_checkpoint_ref},${input.checkpoint.world_revision},
          ${input.checkpoint.emitted_event_count},${input.checkpoint.lease_fence},
          ${input.checkpoint.lease_token}::uuid,${input.checkpoint.next_event_at}::timestamptz,
          ${digest(input.checkpoint.metrics)},${input.now}::timestamptz FROM simulation_runs run
        WHERE run.id=${input.lease.run.id}::uuid AND run.lease_owner=${input.lease.lease_owner}
          AND run.lease_token=${input.lease.lease_token}::uuid AND run.status='running'
          AND run.lease_fence=${input.lease.lease_fence}
          AND run.lease_until>clock_timestamp()
          AND run.pending_advance_from=${input.checkpoint.virtual_from}::timestamptz
          AND run.pending_advance_to=${input.checkpoint.virtual_to}::timestamptz
          AND run.pending_advance_world_revision=${input.checkpoint.world_revision - 1}
        RETURNING id`.execute(transaction)).rows[0]?.id;
            if (!checkpointId)
                throw new ConflictException("The Simulation checkpoint lease is unavailable or expired.");
            for (const sample of input.checkpoint.metrics) {
                await sql `INSERT INTO simulation_run_metric_samples(
            checkpoint_id,run_id,metric_key,label,unit,value,measured_at,simulated_elapsed_ms
          ) VALUES (${checkpointId}::uuid,${input.lease.run.id}::uuid,${sample.key},${sample.label},${sample.unit},
            ${sample.value},${sample.measured_at}::timestamptz,${sample.simulated_elapsed_ms})`.execute(transaction);
            }
            const otherUsage = (await sql `SELECT
          COALESCE(sum(GREATEST(resource_reservation_bytes,observed_storage_bytes)),0) AS accounted_bytes
        FROM simulation_runs WHERE school_id=${input.lease.run.school_id}::uuid
          AND id<>${input.lease.run.id}::uuid AND gc_state<>'deleted'`.execute(transaction)).rows[0];
            const currentAccounted = Math.max(input.lease.run.resource_reservation_bytes, input.lease.run.observed_storage_bytes, input.observed_storage_bytes);
            const institutionBytes = integer(otherUsage?.accounted_bytes ?? 0, "Institution storage accounting") + currentAccounted;
            const resourcePaused = !input.completed
                && institutionBytes > input.max_storage_bytes_per_institution;
            const row = (await sql `UPDATE simulation_runs SET
          status=CASE WHEN ${input.completed} THEN 'completed'
            WHEN ${resourcePaused} THEN 'paused' ELSE 'running' END,
          virtual_now=${input.checkpoint.virtual_to}::timestamptz,
          simulated_elapsed_ms=${input.checkpoint.simulated_elapsed_ms},
          world_revision=${input.checkpoint.world_revision},
          observed_storage_bytes=GREATEST(observed_storage_bytes,${input.observed_storage_bytes}),
          storage_measured_at=COALESCE(${input.storage_measured_at}::timestamptz,storage_measured_at),
          next_event_at=${input.checkpoint.next_event_at}::timestamptz,
          next_wake_at=CASE WHEN ${input.completed} OR ${resourcePaused} THEN NULL
            ELSE ${input.next_wake_at}::timestamptz END,
          wall_anchor_at=CASE WHEN ${input.completed} OR ${resourcePaused} THEN NULL ELSE wall_anchor_at END,
          virtual_anchor_at=CASE WHEN ${input.completed} OR ${resourcePaused} THEN NULL ELSE virtual_anchor_at END,
          last_checkpoint_at=${input.now}::timestamptz,event_count=event_count+${input.checkpoint.emitted_event_count},
          checkpoint_count=checkpoint_count+1,completed_at=CASE WHEN ${input.completed} THEN ${input.now}::timestamptz ELSE NULL END,
          paused_at=CASE WHEN ${resourcePaused} THEN ${input.now}::timestamptz ELSE paused_at END,
          resource_paused_at=CASE WHEN ${resourcePaused} THEN ${input.now}::timestamptz ELSE NULL END,
          resource_pause_reason=CASE WHEN ${resourcePaused}
            THEN 'Institution Simulation storage budget reached.' ELSE NULL END,
          retention_started_at=CASE WHEN ${input.completed} THEN ${input.now}::timestamptz ELSE retention_started_at END,
          retention_expires_at=CASE WHEN ${input.completed}
            THEN ${input.retention_expires_at}::timestamptz ELSE retention_expires_at END,
          lease_owner=NULL,lease_token=NULL,lease_until=NULL,failure_count=0,failure_reason=NULL,
          pending_advance_from=NULL,pending_advance_to=NULL,pending_advance_world_revision=NULL,
          updated_at=${input.now}::timestamptz,revision=revision+1
        WHERE id=${input.lease.run.id}::uuid
          AND lease_owner=${input.lease.lease_owner}
          AND lease_token=${input.lease.lease_token}::uuid
          AND lease_fence=${input.lease.lease_fence}
          AND lease_until>clock_timestamp()
        RETURNING *`.execute(transaction)).rows[0];
            if (!row)
                throw new ConflictException("The Simulation checkpoint could not be committed under this lease.");
            return persistedRun(row);
        });
    }
    async failAdvance(input) {
        const row = (await sql `UPDATE simulation_runs SET
        failure_count=failure_count+1,
        status=CASE WHEN failure_count+1>=${input.max_failures} THEN 'failed' ELSE 'running' END,
        failure_reason=${input.reason.slice(0, 500)},
        next_wake_at=CASE WHEN failure_count+1>=${input.max_failures} THEN NULL ELSE ${input.retry_at}::timestamptz END,
        wall_anchor_at=CASE WHEN failure_count+1>=${input.max_failures} THEN NULL ELSE wall_anchor_at END,
        virtual_anchor_at=CASE WHEN failure_count+1>=${input.max_failures} THEN NULL ELSE virtual_anchor_at END,
        retention_started_at=CASE WHEN failure_count+1>=${input.max_failures}
          THEN ${input.now}::timestamptz ELSE retention_started_at END,
        retention_expires_at=CASE WHEN failure_count+1>=${input.max_failures}
          THEN ${input.retention_expires_at}::timestamptz ELSE retention_expires_at END,
        lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=${input.now}::timestamptz,revision=revision+1
      WHERE id=${input.lease.run.id}::uuid AND lease_owner=${input.lease.lease_owner}
        AND lease_token=${input.lease.lease_token}::uuid AND lease_fence=${input.lease.lease_fence}
        AND lease_until>clock_timestamp()
      RETURNING *`.execute(this.db)).rows[0];
        if (!row)
            throw new ConflictException("The failed Simulation lease is no longer owned by this worker.");
        return persistedRun(row);
    }
    async pauseAdvanceForResource(input) {
        const row = (await sql `UPDATE simulation_runs SET
        status='paused',paused_at=${input.now}::timestamptz,
        resource_paused_at=${input.now}::timestamptz,
        resource_pause_reason=${input.reason.slice(0, 240)},
        wall_anchor_at=NULL,virtual_anchor_at=NULL,next_wake_at=NULL,
        lease_owner=NULL,lease_token=NULL,lease_until=NULL,
        updated_at=${input.now}::timestamptz,revision=revision+1
      WHERE id=${input.lease.run.id}::uuid AND status='running'
        AND lease_owner=${input.lease.lease_owner}
        AND lease_token=${input.lease.lease_token}::uuid
        AND lease_fence=${input.lease.lease_fence}
        AND lease_until>clock_timestamp()
      RETURNING *`.execute(this.db)).rows[0];
        if (!row)
            throw new ConflictException("The resource-paused Simulation lease is no longer owned by this worker.");
        return persistedRun(row);
    }
    async claimGarbageCollection(input) {
        return this.db.transaction().execute(async (transaction) => {
            // Discover without retaining a row lock, then acquire the same advisory
            // lock used by the final Auth session binding before touching the run.
            // Keeping that lock order consistent avoids an Auth(advisory -> row) /
            // GC(row -> advisory) deadlock while the UPDATE below performs the full
            // eligibility recheck under its row lock.
            const candidate = (await sql `SELECT run.id FROM simulation_runs run
        WHERE run.status IN ('stopped','completed','failed')
          AND run.pinned_at IS NULL AND run.world_discarded_at IS NULL
          AND run.retention_expires_at IS NOT NULL
          AND run.retention_expires_at<=clock_timestamp()
          AND (run.gc_next_attempt_at IS NULL OR run.gc_next_attempt_at<=clock_timestamp())
          AND (run.gc_state IN ('retained','failed')
            OR (run.gc_state='deleting' AND run.gc_lease_until<clock_timestamp()))
          AND run.lease_token IS NULL
          AND NOT EXISTS(
            SELECT 1 FROM auth_session_execution_environments environment
            JOIN auth_sessions session ON session.token_hash=environment.token_hash
            WHERE environment.school_id=run.school_id AND environment.run_id=run.id
              AND environment.expires_at>clock_timestamp()
              AND session.expires_at>clock_timestamp()
          )
        ORDER BY run.retention_expires_at,run.id LIMIT 1`.execute(transaction)).rows[0];
            if (!candidate)
                return null;
            const acquired = (await sql `SELECT pg_try_advisory_xact_lock(
          hashtextextended(${'simulation-retention:' + candidate.id},0)
        ) AS acquired`.execute(transaction)).rows[0]?.acquired;
            if (!acquired)
                return null;
            const row = (await sql `UPDATE simulation_runs run SET gc_state='deleting',
          gc_lease_owner=${input.worker_id},gc_lease_token=${input.lease_token}::uuid,
          gc_lease_until=clock_timestamp()+make_interval(secs=>${input.lease_seconds}),
          gc_lease_fence=gc_lease_fence+1,gc_failure_reason=NULL,
          updated_at=clock_timestamp()
        WHERE run.id=${candidate.id}::uuid
          AND run.status IN ('stopped','completed','failed')
          AND run.pinned_at IS NULL AND run.world_discarded_at IS NULL
          AND run.retention_expires_at IS NOT NULL
          AND run.retention_expires_at<=clock_timestamp()
          AND (run.gc_next_attempt_at IS NULL OR run.gc_next_attempt_at<=clock_timestamp())
          AND (run.gc_state IN ('retained','failed')
            OR (run.gc_state='deleting' AND run.gc_lease_until<clock_timestamp()))
          AND run.lease_token IS NULL
          AND NOT EXISTS(
            SELECT 1 FROM auth_session_execution_environments environment
            JOIN auth_sessions session ON session.token_hash=environment.token_hash
            WHERE environment.school_id=run.school_id AND environment.run_id=run.id
              AND environment.expires_at>clock_timestamp()
              AND session.expires_at>clock_timestamp()
          )
        RETURNING run.*`.execute(transaction)).rows[0];
            if (!row)
                return null;
            const run = persistedRun(row);
            return {
                run,
                lease_owner: input.worker_id,
                lease_token: input.lease_token,
                lease_until: run.gc_lease_until,
                lease_fence: run.gc_lease_fence,
            };
        });
    }
    async hasActiveSessionReference(runId, schoolId, _now) {
        void _now;
        const row = (await sql `SELECT EXISTS(
        SELECT 1 FROM auth_session_execution_environments environment
        JOIN auth_sessions session ON session.token_hash=environment.token_hash
        WHERE environment.run_id=${runId}::uuid AND environment.school_id=${schoolId}::uuid
          AND environment.expires_at>clock_timestamp()
          AND session.expires_at>clock_timestamp()
      ) AS present`.execute(this.db)).rows[0];
        return row?.present === true;
    }
    async insertGcReceipt(executor, input) {
        const run = input.lease.run;
        await sql `INSERT INTO simulation_run_gc_receipts(
        run_id,school_id,gc_lease_fence,outcome,reason,source_snapshot_ref,
        source_snapshot_hash,world_ref,adapter_receipt_ref,accounted_bytes,released_bytes,
        retained_shared_snapshot,failure_reason,attempted_at,completed_at
      ) VALUES (${run.id}::uuid,${run.school_id}::uuid,${input.lease.lease_fence},
        ${input.outcome},${input.reason},${run.source_snapshot_ref},${run.source_snapshot_hash},
        ${run.world_ref},${input.adapter_receipt_ref},
        ${Math.max(run.resource_reservation_bytes, run.observed_storage_bytes)},
        ${input.released_bytes},${input.retained_shared_snapshot},${input.failure_reason},
        ${input.lease.run.updated_at}::timestamptz,${input.completed_at}::timestamptz)
      ON CONFLICT(run_id,gc_lease_fence) DO NOTHING`.execute(executor);
    }
    async deferGarbageCollection(input) {
        await this.db.transaction().execute(async (transaction) => {
            const updated = (await sql `UPDATE simulation_runs SET
          gc_state='retained',gc_lease_owner=NULL,gc_lease_token=NULL,gc_lease_until=NULL,
          gc_next_attempt_at=${input.retry_at}::timestamptz,
          updated_at=${input.now}::timestamptz,revision=revision+1
        WHERE id=${input.lease.run.id}::uuid
          AND gc_lease_owner=${input.lease.lease_owner}
          AND gc_lease_token=${input.lease.lease_token}::uuid
          AND gc_lease_fence=${input.lease.lease_fence}
          AND gc_lease_until>clock_timestamp()
        RETURNING id`.execute(transaction)).rows[0];
            if (!updated)
                throw new ConflictException("The retained-world cleanup lease is no longer owned by this worker.");
            await this.insertGcReceipt(transaction, {
                lease: input.lease,
                outcome: "deferred",
                reason: input.reason,
                adapter_receipt_ref: null,
                released_bytes: 0,
                retained_shared_snapshot: null,
                failure_reason: null,
                completed_at: input.now,
            });
        });
    }
    async completeGarbageCollection(input) {
        await this.db.transaction().execute(async (transaction) => {
            const updated = (await sql `UPDATE simulation_runs SET
          gc_state='deleted',gc_lease_owner=NULL,gc_lease_token=NULL,gc_lease_until=NULL,
          gc_failure_count=0,gc_failure_reason=NULL,gc_next_attempt_at=NULL,
          world_discarded_at=${input.now}::timestamptz,resource_reservation_bytes=0,
          observed_storage_bytes=0,updated_at=${input.now}::timestamptz,revision=revision+1
        WHERE id=${input.lease.run.id}::uuid
          AND gc_lease_owner=${input.lease.lease_owner}
          AND gc_lease_token=${input.lease.lease_token}::uuid
          AND gc_lease_fence=${input.lease.lease_fence}
          AND gc_lease_until>clock_timestamp()
        RETURNING id`.execute(transaction)).rows[0];
            if (!updated)
                throw new ConflictException("The retained-world cleanup lease is no longer owned by this worker.");
            await this.insertGcReceipt(transaction, {
                lease: input.lease,
                outcome: "completed",
                reason: input.reason ?? "retention_expired",
                adapter_receipt_ref: input.adapter_receipt_ref,
                released_bytes: input.released_bytes,
                retained_shared_snapshot: input.retained_shared_snapshot,
                failure_reason: null,
                completed_at: input.now,
            });
        });
    }
    async failGarbageCollection(input) {
        await this.db.transaction().execute(async (transaction) => {
            const updated = (await sql `UPDATE simulation_runs SET
          gc_state='failed',gc_lease_owner=NULL,gc_lease_token=NULL,gc_lease_until=NULL,
          gc_failure_count=gc_failure_count+1,gc_failure_reason=${input.reason.slice(0, 500)},
          gc_next_attempt_at=${input.retry_at}::timestamptz,
          updated_at=${input.now}::timestamptz,revision=revision+1
        WHERE id=${input.lease.run.id}::uuid
          AND gc_lease_owner=${input.lease.lease_owner}
          AND gc_lease_token=${input.lease.lease_token}::uuid
          AND gc_lease_fence=${input.lease.lease_fence}
          AND gc_lease_until>clock_timestamp()
        RETURNING id`.execute(transaction)).rows[0];
            if (!updated)
                throw new ConflictException("The failed retained-world cleanup lease is no longer owned by this worker.");
            await this.insertGcReceipt(transaction, {
                lease: input.lease,
                outcome: "failed",
                reason: input.reason_code ?? "retention_expired",
                adapter_receipt_ref: null,
                released_bytes: 0,
                retained_shared_snapshot: null,
                failure_reason: input.reason.slice(0, 500),
                completed_at: input.now,
            });
        });
    }
    async requireOwned(runId, ownerId, schoolId) {
        const run = await this.getOwned(runId, ownerId, schoolId);
        if (!run)
            throw new NotFoundException("Simulation run not found.");
        return run;
    }
};
SimulationRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService])
], SimulationRepository);
export { SimulationRepository };
//# sourceMappingURL=simulation.repository.js.map