import { ConflictException, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { ExecutionDataPlaneScope } from "../database/execution-data-plane.js";
import type { Database } from "../database/types.js";
import type {
  BeginSnapshotProvisionInput,
  BeginSnapshotRestoreInput,
  ExecutionProvisioningPort,
  SnapshotContributionInput,
  SnapshotProvisionReceipt,
  SnapshotRestoreContributionInput,
  SnapshotRestoreReceipt,
} from "./execution-provisioning.port.js";
import type { EnvironmentRetentionJob, EnvironmentRetentionPort, ScheduleEnvironmentRetentionInput } from "./environment-retention.port.js";
import type {
  ProjectionRecoveryJob,
  ProjectionRecoveryPort,
  ProjectionReplayQuarantineInput,
  ScheduleProjectionRecoveryInput,
} from "./projection-recovery.port.js";
import { resolveOperationalRealmScope } from "./operational-realm.js";

const identifier = z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,99}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const positiveLease = z.number().int().min(5).max(900);
const beginProvisionSchema = z.object({
  school_id: z.string().uuid(), source_snapshot_ref: z.string().trim().min(3).max(240),
  requested_modules: z.array(identifier).min(1).max(200),
  source_recorded_at: z.string().datetime({ offset: true }), expires_at: z.string().datetime({ offset: true }),
  requested_by_agent_id: z.string().uuid(), authority_receipt_id: z.string().uuid(),
  correlation_id: z.string().uuid(), idempotency_key: z.string().trim().min(8).max(240),
}).strict();
const contributionSchema = z.object({
  school_id: z.string().uuid(), provision_id: z.string().uuid(), adapter_definition_id: z.string().uuid(),
  adapter_version: z.number().int().positive(), module_id: identifier,
  artifact_ref: z.string().trim().min(3).max(500), artifact_hash: sha256,
  restore_schema_version: z.number().int().positive(),
  record_count: z.number().int().nonnegative(), source_revision_watermark: z.string().trim().min(1).max(240),
  privacy_transform_ref: z.string().trim().min(3).max(240), capture_schema_version: z.number().int().positive(),
  captured_at: z.string().datetime({ offset: true }), metadata: z.record(z.string(), z.unknown()),
}).strict();
const beginRestoreSchema = z.object({
  school_id: z.string().uuid(), provision_id: z.string().uuid(), execution_snapshot_id: z.string().uuid(),
  started_at: z.string().datetime({ offset: true }),
}).strict();
const restoreContributionSchema = z.object({
  school_id: z.string().uuid(), restore_id: z.string().uuid(), adapter_definition_id: z.string().uuid(),
  adapter_version: z.number().int().positive(), artifact_hash: sha256,
  restore_schema_version: z.number().int().positive(),
  restored_record_count: z.number().int().nonnegative(), restored_at: z.string().datetime({ offset: true }),
  receipt: z.record(z.string(), z.unknown()),
}).strict();
const scheduleRecoverySchema = z.object({
  school_id: z.string().uuid(), consumer: identifier,
  mode: z.enum(["rebuild", "replay", "verify"]), from_sequence: z.number().int().nonnegative(),
  through_sequence: z.number().int().nonnegative().nullable(), max_attempts: z.number().int().min(1).max(20),
  retry_policy_ref: z.string().trim().min(3).max(200),
  retry_delays_seconds: z.array(z.number().int().min(0).max(86_400)).max(19),
  available_at: z.string().datetime({ offset: true }), requested_by_agent_id: z.string().uuid(),
  authority_receipt_id: z.string().uuid(), correlation_id: z.string().uuid(),
  idempotency_key: z.string().trim().min(8).max(240),
}).strict().superRefine((value, context) => {
  if (value.through_sequence !== null && value.through_sequence < value.from_sequence) {
    context.addIssue({ code: "custom", path: ["through_sequence"], message: "Replay end cannot precede its start." });
  }
  if (value.retry_delays_seconds.length !== value.max_attempts - 1) {
    context.addIssue({ code: "custom", path: ["retry_delays_seconds"], message: "Provide one configured delay before every retry." });
  }
});
const quarantineSchema = z.object({
  school_id: z.string().uuid(), job_id: z.string().uuid(), worker_id: z.string().trim().min(3).max(160),
  event_id: z.string().uuid(), delivery_sequence: z.number().int().nonnegative(),
  error_code: z.string().trim().min(3).max(100), schema_ref: z.string().trim().min(1).max(240).nullable(),
  safe_diagnostics: z.record(z.string(), z.unknown()), quarantined_at: z.string().datetime({ offset: true }),
}).strict();

interface AdapterRow {
  adapter_definition_id: string; adapter_version: number; module_id: string;
  capture_schema_version: number; restore_schema_version: number; content_hash: string;
}
interface ProvisionRow {
  id: string; state: SnapshotProvisionReceipt["state"]; expected_adapter_count: number;
  missing_modules: string[]; coverage_hash: string; manifest_hash: string | null;
}
interface RestoreRow {
  id: string; state: SnapshotRestoreReceipt["state"]; expected_adapter_count: number;
  restored_adapter_count: number; manifest_hash: string;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

@Injectable()
export class ExecutionProvisioningService implements ExecutionProvisioningPort, ProjectionRecoveryPort, EnvironmentRetentionPort {
  constructor(
    @Optional() private readonly executionScope?: ExecutionDataPlaneScope,
  ) {}

  private async scope(transaction: Transaction<Database>, schoolId: string) {
    return resolveOperationalRealmScope(transaction, schoolId, this.executionScope?.current());
  }

  private async assertAllowedReceipt(
    transaction: Transaction<Database>, realmId: string, namespaceId: string,
    receiptId: string, actorId: string, correlationId: string, capability: string,
  ): Promise<void> {
    const allowed = (await sql<{ allowed: boolean }>`SELECT EXISTS(SELECT 1 FROM campus_model_authority_receipts
      WHERE id=${receiptId}::uuid AND realm_id=${realmId}::uuid AND environment_namespace_id=${namespaceId}
        AND actor_agent_id=${actorId}::uuid AND correlation_id=${correlationId}::uuid
        AND capability=${capability} AND decision='allowed'
        AND (valid_until IS NULL OR valid_until>CURRENT_TIMESTAMP)) AS allowed`.execute(transaction)).rows[0]?.allowed;
    if (!allowed) throw new ConflictException("This operation requires a current allowed authority receipt in the selected environment.");
  }

  private async provisionReceipt(
    transaction: Transaction<Database>, provisionId: string, realmId: string, namespaceId: string, replayed: boolean,
  ): Promise<SnapshotProvisionReceipt> {
    const row = (await sql<ProvisionRow & { contributed_adapter_count: number }>`SELECT provision.id,provision.state,
        provision.expected_adapter_count,provision.missing_modules,provision.coverage_hash,provision.manifest_hash,
        count(contribution.id)::int AS contributed_adapter_count
      FROM campus_model_snapshot_provisions provision
      LEFT JOIN campus_model_snapshot_contributions contribution ON contribution.provision_id=provision.id
      WHERE provision.id=${provisionId}::uuid AND provision.realm_id=${realmId}::uuid
        AND provision.source_environment_namespace_id=${namespaceId}
      GROUP BY provision.id`.execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The snapshot provision does not exist.");
    return { provision_id: row.id, state: row.state, expected_adapter_count: row.expected_adapter_count,
      contributed_adapter_count: row.contributed_adapter_count, missing_modules: row.missing_modules,
      coverage_hash: row.coverage_hash, manifest_hash: row.manifest_hash, replayed };
  }

  async beginSnapshotProvision(transaction: Transaction<Database>, raw: BeginSnapshotProvisionInput): Promise<SnapshotProvisionReceipt> {
    const input = beginProvisionSchema.parse(raw);
    if (this.executionScope?.current()?.kind === "simulation") {
      throw new ConflictException("A source snapshot can be captured only from Live.");
    }
    const scope = await this.scope(transaction, input.school_id);
    await this.assertAllowedReceipt(transaction, scope.realm_id, scope.environment_namespace_id,
      input.authority_receipt_id, input.requested_by_agent_id, input.correlation_id, "model.snapshot.provision");
    const modules = [...new Set(input.requested_modules)].sort();
    const adapters = (await sql<AdapterRow>`SELECT definition.id AS adapter_definition_id,
        definition.version AS adapter_version,activation.module_id,definition.capture_schema_version,
        definition.restore_schema_version,definition.content_hash
      FROM realm_snapshot_adapter_activations activation
      JOIN model_snapshot_adapter_definitions definition ON definition.id=activation.adapter_definition_id
        AND definition.version=activation.adapter_version AND definition.module_id=activation.module_id
      JOIN realm_model_contract_activations contract ON contract.realm_id=activation.realm_id
        AND contract.contract_kind='capability_manifest'
        AND contract.contract_id=definition.capability_manifest_id
        AND contract.status='active' AND contract.effective_from<=${input.source_recorded_at}::timestamptz
        AND (contract.effective_until IS NULL OR contract.effective_until>${input.source_recorded_at}::timestamptz)
      WHERE activation.realm_id=${scope.realm_id}::uuid AND activation.module_id=ANY(${modules}::text[])
        AND activation.required AND activation.status='active' AND definition.status='active'
        AND activation.effective_from<=${input.source_recorded_at}::timestamptz
        AND (activation.effective_until IS NULL OR activation.effective_until>${input.source_recorded_at}::timestamptz)
      ORDER BY activation.module_id,definition.namespace,definition.adapter_key,definition.version`
      .execute(transaction)).rows;
    const ambiguousModules = modules.filter((moduleId) => adapters.filter((adapter) => adapter.module_id === moduleId).length > 1);
    if (ambiguousModules.length > 0) {
      throw new ConflictException(`Snapshot coverage is ambiguous for: ${ambiguousModules.join(", ")}.`);
    }
    const covered = new Set(adapters.map((adapter) => adapter.module_id));
    const missingModules = modules.filter((moduleId) => !covered.has(moduleId));
    const coverageHash = digest({ modules, adapters });
    const requestHash = digest({ ...input, requested_modules: modules });
    const existing = (await sql<{ id: string; request_hash: string }>`SELECT id,request_hash FROM campus_model_snapshot_provisions
      WHERE realm_id=${scope.realm_id}::uuid AND (
        (source_environment_namespace_id=${scope.environment_namespace_id} AND idempotency_key=${input.idempotency_key})
        OR source_snapshot_ref=${input.source_snapshot_ref}
      ) FOR SHARE`.execute(transaction)).rows[0];
    if (existing) {
      if (existing.request_hash !== requestHash) throw new ConflictException("This snapshot provision key was already used for another request.");
      return this.provisionReceipt(transaction, existing.id, scope.realm_id, scope.environment_namespace_id, true);
    }
    const inserted = (await sql<{ id: string }>`INSERT INTO campus_model_snapshot_provisions(
        school_id,realm_id,source_environment_namespace_id,source_snapshot_ref,state,requested_modules,
        missing_modules,expected_adapter_count,coverage_hash,source_recorded_at,expires_at,
        requested_by_agent_id,authority_receipt_id,correlation_id,idempotency_key,request_hash
      ) VALUES (${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
        ${input.source_snapshot_ref},${missingModules.length ? "blocked" : "collecting"},${modules}::text[],
        ${missingModules}::text[],${adapters.length},${coverageHash},${input.source_recorded_at}::timestamptz,
        ${input.expires_at}::timestamptz,${input.requested_by_agent_id}::uuid,${input.authority_receipt_id}::uuid,
        ${input.correlation_id}::uuid,${input.idempotency_key},${requestHash}) RETURNING id`.execute(transaction)).rows[0];
    if (!inserted) throw new ConflictException("The snapshot provision could not be created.");
    for (const adapter of adapters) {
      await sql`INSERT INTO campus_model_snapshot_expected_adapters(
          provision_id,realm_id,source_environment_namespace_id,adapter_definition_id,adapter_version,module_id,
          capture_schema_version,restore_schema_version,content_hash
        ) VALUES (${inserted.id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
          ${adapter.adapter_definition_id}::uuid,${adapter.adapter_version},${adapter.module_id},
          ${adapter.capture_schema_version},${adapter.restore_schema_version},${adapter.content_hash})`.execute(transaction);
    }
    return this.provisionReceipt(transaction, inserted.id, scope.realm_id, scope.environment_namespace_id, false);
  }

  async recordSnapshotContribution(transaction: Transaction<Database>, raw: SnapshotContributionInput): Promise<SnapshotProvisionReceipt> {
    const input = contributionSchema.parse(raw);
    const scope = await this.scope(transaction, input.school_id);
    const expected = (await sql<{ found: boolean }>`SELECT EXISTS(SELECT 1
      FROM campus_model_snapshot_expected_adapters expected JOIN campus_model_snapshot_provisions provision ON provision.id=expected.provision_id
      WHERE expected.provision_id=${input.provision_id}::uuid AND expected.realm_id=${scope.realm_id}::uuid
        AND expected.source_environment_namespace_id=${scope.environment_namespace_id}
        AND expected.adapter_definition_id=${input.adapter_definition_id}::uuid
        AND expected.adapter_version=${input.adapter_version} AND expected.module_id=${input.module_id}
        AND expected.capture_schema_version=${input.capture_schema_version}
        AND expected.restore_schema_version=${input.restore_schema_version}
        AND provision.state='collecting') AS found`
      .execute(transaction)).rows[0]?.found;
    if (!expected) throw new ConflictException("This adapter is not part of the sealed snapshot coverage plan.");
    const inserted = (await sql<{ inserted: boolean }>`INSERT INTO campus_model_snapshot_contributions(
        provision_id,realm_id,source_environment_namespace_id,adapter_definition_id,adapter_version,module_id,
        artifact_ref,artifact_hash,restore_schema_version,record_count,source_revision_watermark,privacy_transform_ref,
        capture_schema_version,captured_at,metadata
      ) VALUES (${input.provision_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
        ${input.adapter_definition_id}::uuid,${input.adapter_version},${input.module_id},${input.artifact_ref},
        ${input.artifact_hash},${input.restore_schema_version},${input.record_count},${input.source_revision_watermark},${input.privacy_transform_ref},
        ${input.capture_schema_version},${input.captured_at}::timestamptz,${JSON.stringify(input.metadata)}::jsonb)
      ON CONFLICT(provision_id,adapter_definition_id) DO NOTHING RETURNING true AS inserted`.execute(transaction)).rows[0];
    const retained = (await sql<{ matches: boolean }>`SELECT artifact_hash=${input.artifact_hash}
        AND adapter_version=${input.adapter_version} AND module_id=${input.module_id}
        AND restore_schema_version=${input.restore_schema_version}
        AND record_count=${input.record_count} AND source_revision_watermark=${input.source_revision_watermark}
        AND privacy_transform_ref=${input.privacy_transform_ref}
        AND capture_schema_version=${input.capture_schema_version} AS matches
      FROM campus_model_snapshot_contributions
      WHERE provision_id=${input.provision_id}::uuid AND adapter_definition_id=${input.adapter_definition_id}::uuid`
      .execute(transaction)).rows[0]?.matches;
    if (!retained) throw new ConflictException("This adapter contribution was already retained with different evidence.");
    return this.provisionReceipt(transaction, input.provision_id, scope.realm_id, scope.environment_namespace_id, !inserted);
  }

  async sealSnapshotProvision(transaction: Transaction<Database>, schoolId: string, provisionId: string): Promise<SnapshotProvisionReceipt> {
    z.string().uuid().parse(provisionId);
    const scope = await this.scope(transaction, z.string().uuid().parse(schoolId));
    const contributions = (await sql<{ adapter_definition_id: string; adapter_version: number; module_id: string; artifact_hash: string }>`SELECT
        contribution.adapter_definition_id,contribution.adapter_version,contribution.module_id,contribution.artifact_hash
      FROM campus_model_snapshot_contributions contribution
      JOIN campus_model_snapshot_provisions provision ON provision.id=contribution.provision_id
      WHERE provision.id=${provisionId}::uuid AND provision.realm_id=${scope.realm_id}::uuid
        AND provision.source_environment_namespace_id=${scope.environment_namespace_id} AND provision.state='collecting'
      ORDER BY contribution.module_id,contribution.adapter_definition_id`.execute(transaction)).rows;
    const current = await this.provisionReceipt(transaction, provisionId, scope.realm_id, scope.environment_namespace_id, false);
    if (current.state === "ready") return { ...current, replayed: true };
    if (current.state !== "collecting" || contributions.length !== current.expected_adapter_count) {
      throw new ConflictException("Every expected adapter must contribute before the snapshot can be sealed.");
    }
    const manifestHash = digest(contributions);
    await sql`UPDATE campus_model_snapshot_provisions SET state='ready',manifest_hash=${manifestHash},sealed_at=now()
      WHERE id=${provisionId}::uuid AND realm_id=${scope.realm_id}::uuid
        AND source_environment_namespace_id=${scope.environment_namespace_id} AND state='collecting'`.execute(transaction);
    return this.provisionReceipt(transaction, provisionId, scope.realm_id, scope.environment_namespace_id, false);
  }

  private async restoreReceipt(
    transaction: Transaction<Database>, restoreId: string, realmId: string, namespaceId: string, replayed: boolean,
  ): Promise<SnapshotRestoreReceipt> {
    const row = (await sql<RestoreRow>`SELECT id,state,expected_adapter_count,restored_adapter_count,manifest_hash
      FROM campus_model_snapshot_restores WHERE id=${restoreId}::uuid AND realm_id=${realmId}::uuid
        AND target_environment_namespace_id=${namespaceId}`.execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The snapshot restore does not exist.");
    return { restore_id: row.id, state: row.state, expected_adapter_count: row.expected_adapter_count,
      restored_adapter_count: row.restored_adapter_count, manifest_hash: row.manifest_hash, replayed };
  }

  async beginSnapshotRestore(transaction: Transaction<Database>, raw: BeginSnapshotRestoreInput): Promise<SnapshotRestoreReceipt> {
    const input = beginRestoreSchema.parse(raw);
    const environment = this.executionScope?.current();
    if (environment?.kind !== "simulation") throw new ConflictException("Snapshot restore requires an isolated Simulation environment.");
    const scope = await this.scope(transaction, input.school_id);
    const source = (await sql<{ manifest_hash: string; expected_adapter_count: number }>`SELECT
        provision.manifest_hash,provision.expected_adapter_count
      FROM campus_model_snapshot_provisions provision
      JOIN campus_model_execution_snapshots snapshot ON snapshot.id=${input.execution_snapshot_id}::uuid
        AND snapshot.realm_id=${scope.realm_id}::uuid AND snapshot.environment_namespace_id=${scope.environment_namespace_id}
        AND snapshot.source_snapshot_ref=provision.source_snapshot_ref
      WHERE provision.id=${input.provision_id}::uuid AND provision.realm_id=${scope.realm_id}::uuid
        AND provision.state='ready' AND provision.manifest_hash IS NOT NULL AND provision.expires_at>CURRENT_TIMESTAMP`
      .execute(transaction)).rows[0];
    if (!source) throw new ConflictException("The sealed source manifest is unavailable or does not match this Simulation snapshot.");
    const existing = (await sql<{ id: string }>`SELECT id FROM campus_model_snapshot_restores
      WHERE realm_id=${scope.realm_id}::uuid AND target_environment_namespace_id=${scope.environment_namespace_id}`
      .execute(transaction)).rows[0];
    if (existing) return this.restoreReceipt(transaction, existing.id, scope.realm_id, scope.environment_namespace_id, true);
    const inserted = (await sql<{ id: string }>`INSERT INTO campus_model_snapshot_restores(
        provision_id,execution_snapshot_id,realm_id,target_environment_namespace_id,state,
        expected_adapter_count,manifest_hash,started_at
      ) VALUES (${input.provision_id}::uuid,${input.execution_snapshot_id}::uuid,${scope.realm_id}::uuid,
        ${scope.environment_namespace_id},'restoring',${source.expected_adapter_count},${source.manifest_hash},
        ${input.started_at}::timestamptz) RETURNING id`.execute(transaction)).rows[0];
    if (!inserted) throw new ConflictException("The snapshot restore could not be started.");
    return this.restoreReceipt(transaction, inserted.id, scope.realm_id, scope.environment_namespace_id, false);
  }

  async recordSnapshotRestoreContribution(transaction: Transaction<Database>, raw: SnapshotRestoreContributionInput): Promise<SnapshotRestoreReceipt> {
    const input = restoreContributionSchema.parse(raw);
    const scope = await this.scope(transaction, input.school_id);
    const expected = (await sql<{ found: boolean }>`SELECT EXISTS(SELECT 1 FROM campus_model_snapshot_restores restore
      JOIN campus_model_snapshot_expected_adapters expected ON expected.provision_id=restore.provision_id
      JOIN campus_model_snapshot_contributions captured ON captured.provision_id=restore.provision_id
        AND captured.adapter_definition_id=expected.adapter_definition_id
      WHERE restore.id=${input.restore_id}::uuid AND restore.realm_id=${scope.realm_id}::uuid
        AND restore.target_environment_namespace_id=${scope.environment_namespace_id} AND restore.state='restoring'
        AND expected.adapter_definition_id=${input.adapter_definition_id}::uuid
        AND expected.adapter_version=${input.adapter_version}
        AND expected.restore_schema_version=${input.restore_schema_version}
        AND captured.restore_schema_version=${input.restore_schema_version}
        AND captured.artifact_hash=${input.artifact_hash}) AS found`
      .execute(transaction)).rows[0]?.found;
    if (!expected) throw new ConflictException("The restore receipt does not match a captured adapter artifact.");
    const inserted = (await sql<{ inserted: boolean }>`INSERT INTO campus_model_snapshot_restore_contributions(
        restore_id,realm_id,target_environment_namespace_id,adapter_definition_id,adapter_version,
        artifact_hash,restore_schema_version,restored_record_count,restored_at,receipt
      ) VALUES (${input.restore_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
        ${input.adapter_definition_id}::uuid,${input.adapter_version},${input.artifact_hash},${input.restore_schema_version},
        ${input.restored_record_count},${input.restored_at}::timestamptz,${JSON.stringify(input.receipt)}::jsonb)
      ON CONFLICT(restore_id,adapter_definition_id) DO NOTHING RETURNING true AS inserted`.execute(transaction)).rows[0];
    const retained = (await sql<{ matches: boolean }>`SELECT artifact_hash=${input.artifact_hash}
        AND adapter_version=${input.adapter_version} AND restore_schema_version=${input.restore_schema_version}
        AND restored_record_count=${input.restored_record_count} AND receipt=${JSON.stringify(input.receipt)}::jsonb AS matches
      FROM campus_model_snapshot_restore_contributions
      WHERE restore_id=${input.restore_id}::uuid AND adapter_definition_id=${input.adapter_definition_id}::uuid`
      .execute(transaction)).rows[0]?.matches;
    if (!retained) throw new ConflictException("This restore contribution was already retained with a different receipt.");
    if (inserted) await sql`UPDATE campus_model_snapshot_restores SET restored_adapter_count=restored_adapter_count+1
      WHERE id=${input.restore_id}::uuid`.execute(transaction);
    return this.restoreReceipt(transaction, input.restore_id, scope.realm_id, scope.environment_namespace_id, !inserted);
  }

  async completeSnapshotRestore(transaction: Transaction<Database>, schoolId: string, restoreId: string): Promise<SnapshotRestoreReceipt> {
    const scope = await this.scope(transaction, z.string().uuid().parse(schoolId));
    const updated = (await sql<{ id: string }>`UPDATE campus_model_snapshot_restores SET state='ready',completed_at=now()
      WHERE id=${z.string().uuid().parse(restoreId)}::uuid AND realm_id=${scope.realm_id}::uuid
        AND target_environment_namespace_id=${scope.environment_namespace_id} AND state='restoring'
        AND restored_adapter_count=expected_adapter_count RETURNING id`.execute(transaction)).rows[0];
    if (!updated) {
      const current = await this.restoreReceipt(transaction, restoreId, scope.realm_id, scope.environment_namespace_id, false);
      if (current.state === "ready") return { ...current, replayed: true };
      throw new ConflictException("Every captured adapter must restore successfully before Simulation can become ready.");
    }
    return this.restoreReceipt(transaction, restoreId, scope.realm_id, scope.environment_namespace_id, false);
  }

  async scheduleProjectionRecovery(transaction: Transaction<Database>, raw: ScheduleProjectionRecoveryInput): Promise<ProjectionRecoveryJob> {
    const input = scheduleRecoverySchema.parse(raw);
    const scope = await this.scope(transaction, input.school_id);
    await this.assertAllowedReceipt(transaction, scope.realm_id, scope.environment_namespace_id,
      input.authority_receipt_id, input.requested_by_agent_id, input.correlation_id, "model.projection.recover");
    const requestHash = digest(input);
    const existing = (await sql<{ id: string; request_hash: string }>`SELECT id,request_hash
      FROM campus_model_projection_recovery_jobs WHERE realm_id=${scope.realm_id}::uuid
        AND environment_namespace_id=${scope.environment_namespace_id} AND idempotency_key=${input.idempotency_key}`
      .execute(transaction)).rows[0];
    if (existing?.request_hash !== undefined && existing.request_hash !== requestHash) {
      throw new ConflictException("This projection recovery key was already used for another request.");
    }
    const row = (await sql<ProjectionRecoveryJob>`INSERT INTO campus_model_projection_recovery_jobs(
        school_id,realm_id,environment_namespace_id,consumer,mode,state,from_sequence,through_sequence,
        max_attempts,retry_policy_ref,retry_delays_seconds,available_at,requested_by_agent_id,
        authority_receipt_id,correlation_id,idempotency_key,request_hash
      ) VALUES (${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},
        ${input.consumer},${input.mode},'scheduled',${input.from_sequence},${input.through_sequence},
        ${input.max_attempts},${input.retry_policy_ref},${input.retry_delays_seconds}::integer[],
        ${input.available_at}::timestamptz,${input.requested_by_agent_id}::uuid,
        ${input.authority_receipt_id}::uuid,${input.correlation_id}::uuid,${input.idempotency_key},${requestHash})
      ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
      RETURNING id AS job_id,realm_id,environment_namespace_id,consumer,mode,state,from_sequence,
        through_sequence,attempt_count,max_attempts,lease_owner,lease_until`.execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The projection recovery job could not be scheduled.");
    return row;
  }

  async claimProjectionRecovery(transaction: Transaction<Database>, schoolId: string, workerId: string, leaseSeconds: number): Promise<ProjectionRecoveryJob | null> {
    const scope = await this.scope(transaction, z.string().uuid().parse(schoolId));
    const worker = z.string().trim().min(3).max(160).parse(workerId);
    const lease = positiveLease.parse(leaseSeconds);
    return (await sql<ProjectionRecoveryJob>`WITH candidate AS (
      SELECT id FROM campus_model_projection_recovery_jobs
      WHERE realm_id=${scope.realm_id}::uuid AND environment_namespace_id=${scope.environment_namespace_id}
        AND state IN ('scheduled','retry_scheduled','leased','running') AND available_at<=CURRENT_TIMESTAMP
        AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) AND attempt_count<max_attempts
      ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE campus_model_projection_recovery_jobs job SET state='leased',lease_owner=${worker},
        lease_until=CURRENT_TIMESTAMP+(${lease}::text||' seconds')::interval,
        attempt_count=attempt_count+1,updated_at=now()
      FROM candidate WHERE job.id=candidate.id
      RETURNING job.id AS job_id,job.realm_id,job.environment_namespace_id,job.consumer,job.mode,job.state,
        job.from_sequence,job.through_sequence,job.attempt_count,job.max_attempts,job.lease_owner,job.lease_until`
      .execute(transaction)).rows[0] ?? null;
  }

  async heartbeatProjectionRecovery(transaction: Transaction<Database>, schoolId: string, jobId: string, workerId: string, leaseSeconds: number): Promise<ProjectionRecoveryJob> {
    const scope = await this.scope(transaction, z.string().uuid().parse(schoolId));
    const row = (await sql<ProjectionRecoveryJob>`UPDATE campus_model_projection_recovery_jobs SET state='running',
        lease_until=CURRENT_TIMESTAMP+(${positiveLease.parse(leaseSeconds)}::text||' seconds')::interval,updated_at=now()
      WHERE id=${z.string().uuid().parse(jobId)}::uuid AND realm_id=${scope.realm_id}::uuid
        AND environment_namespace_id=${scope.environment_namespace_id} AND lease_owner=${z.string().trim().min(3).max(160).parse(workerId)}
        AND state IN ('leased','running') AND lease_until>=CURRENT_TIMESTAMP
      RETURNING id AS job_id,realm_id,environment_namespace_id,consumer,mode,state,from_sequence,
        through_sequence,attempt_count,max_attempts,lease_owner,lease_until`.execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The projection recovery lease is unavailable or expired.");
    return row;
  }

  async quarantineProjectionEvent(transaction: Transaction<Database>, raw: ProjectionReplayQuarantineInput): Promise<ProjectionRecoveryJob> {
    const input = quarantineSchema.parse(raw);
    const scope = await this.scope(transaction, input.school_id);
    await sql`INSERT INTO campus_model_projection_replay_quarantine(
        job_id,realm_id,environment_namespace_id,event_id,delivery_sequence,error_code,schema_ref,
        safe_diagnostics,status,quarantined_at
      ) SELECT job.id,job.realm_id,job.environment_namespace_id,${input.event_id}::uuid,${input.delivery_sequence},
        ${input.error_code},${input.schema_ref},${JSON.stringify(input.safe_diagnostics)}::jsonb,'open',
        ${input.quarantined_at}::timestamptz FROM campus_model_projection_recovery_jobs job
      WHERE job.id=${input.job_id}::uuid AND job.realm_id=${scope.realm_id}::uuid
        AND job.environment_namespace_id=${scope.environment_namespace_id} AND job.lease_owner=${input.worker_id}
        AND job.state IN ('leased','running') AND job.lease_until>=CURRENT_TIMESTAMP
      ON CONFLICT(job_id,event_id) DO NOTHING`.execute(transaction);
    const row = (await sql<ProjectionRecoveryJob>`UPDATE campus_model_projection_recovery_jobs SET
        state='quarantined',lease_owner=NULL,lease_until=NULL,last_error_code=${input.error_code},updated_at=now()
      WHERE id=${input.job_id}::uuid AND realm_id=${scope.realm_id}::uuid
        AND environment_namespace_id=${scope.environment_namespace_id} AND lease_owner=${input.worker_id}
        AND state IN ('leased','running') AND lease_until>=CURRENT_TIMESTAMP
      RETURNING id AS job_id,realm_id,environment_namespace_id,consumer,mode,state,from_sequence,
        through_sequence,attempt_count,max_attempts,lease_owner,lease_until`.execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The replay event could not be quarantined under this lease.");
    return row;
  }

  async completeProjectionRecovery(transaction: Transaction<Database>, schoolId: string, jobId: string, workerId: string): Promise<ProjectionRecoveryJob> {
    const scope = await this.scope(transaction, z.string().uuid().parse(schoolId));
    const row = (await sql<ProjectionRecoveryJob>`UPDATE campus_model_projection_recovery_jobs job SET
        state='completed',lease_owner=NULL,lease_until=NULL,completed_at=now(),updated_at=now()
      FROM campus_model_environment_projection_checkpoints checkpoint
      WHERE job.id=${z.string().uuid().parse(jobId)}::uuid AND job.realm_id=${scope.realm_id}::uuid
        AND job.environment_namespace_id=${scope.environment_namespace_id} AND job.lease_owner=${z.string().trim().min(3).max(160).parse(workerId)}
        AND job.state IN ('leased','running') AND job.lease_until>=CURRENT_TIMESTAMP
        AND checkpoint.realm_id=job.realm_id AND checkpoint.environment_namespace_id=job.environment_namespace_id
        AND checkpoint.consumer=job.consumer
        AND (job.through_sequence IS NULL OR checkpoint.last_delivery_sequence>=job.through_sequence)
      RETURNING job.id AS job_id,job.realm_id,job.environment_namespace_id,job.consumer,job.mode,job.state,
        job.from_sequence,job.through_sequence,job.attempt_count,job.max_attempts,job.lease_owner,job.lease_until`
      .execute(transaction)).rows[0];
    if (!row) throw new ConflictException("Projection recovery cannot complete before its checkpoint reaches the requested boundary.");
    return row;
  }

  async failProjectionRecovery(transaction: Transaction<Database>, schoolId: string, jobId: string, workerId: string, errorCode: string): Promise<ProjectionRecoveryJob> {
    const scope = await this.scope(transaction, z.string().uuid().parse(schoolId));
    const row = (await sql<ProjectionRecoveryJob>`UPDATE campus_model_projection_recovery_jobs SET
        state=CASE WHEN attempt_count<max_attempts THEN 'retry_scheduled' ELSE 'failed' END,
        available_at=CASE WHEN attempt_count<max_attempts THEN CURRENT_TIMESTAMP+
          (retry_delays_seconds[attempt_count]::text||' seconds')::interval ELSE available_at END,
        lease_owner=NULL,lease_until=NULL,last_error_code=${z.string().trim().min(3).max(100).parse(errorCode)},updated_at=now()
      WHERE id=${z.string().uuid().parse(jobId)}::uuid AND realm_id=${scope.realm_id}::uuid
        AND environment_namespace_id=${scope.environment_namespace_id} AND lease_owner=${z.string().trim().min(3).max(160).parse(workerId)}
        AND state IN ('leased','running') AND lease_until>=CURRENT_TIMESTAMP
      RETURNING id AS job_id,realm_id,environment_namespace_id,consumer,mode,state,from_sequence,
        through_sequence,attempt_count,max_attempts,lease_owner,lease_until`.execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The projection recovery failure does not match an owned job.");
    return row;
  }

  async scheduleEnvironmentRetention(transaction: Transaction<Database>, raw: ScheduleEnvironmentRetentionInput): Promise<EnvironmentRetentionJob> {
    const input = z.object({
      school_id: z.string().uuid(), delete_after: z.string().datetime({ offset: true }),
      artifact_classes: z.array(identifier).min(1).max(50),
      retention_policy_ref: z.string().trim().min(3).max(200),
      max_attempts: z.number().int().min(1).max(20),
      retry_delays_seconds: z.array(z.number().int().min(0).max(86_400)).max(19),
      scheduled_by_agent_id: z.string().uuid(), authority_receipt_id: z.string().uuid(),
      correlation_id: z.string().uuid(), idempotency_key: z.string().trim().min(8).max(240),
    }).strict().superRefine((value, context) => {
      if (value.retry_delays_seconds.length !== value.max_attempts - 1) {
        context.addIssue({ code: "custom", path: ["retry_delays_seconds"], message: "Provide one configured delay before every retry." });
      }
    }).parse(raw);
    const environment = this.executionScope?.current();
    if (environment?.kind !== "simulation") throw new ConflictException("Transient cleanup can be scheduled only for Simulation.");
    const scope = await this.scope(transaction, input.school_id);
    await this.assertAllowedReceipt(transaction, scope.realm_id, scope.environment_namespace_id,
      input.authority_receipt_id, input.scheduled_by_agent_id, input.correlation_id, "model.environment.retention");
    const classes = [...new Set(input.artifact_classes)].sort();
    const when = input.delete_after;
    if (Date.parse(when) < Date.parse(environment.expires_at)) {
      throw new ConflictException("Retention cleanup cannot run before the Simulation environment expires.");
    }
    const requestHash = digest({ ...input, artifact_classes: classes });
    const existing = (await sql<{ id: string; request_hash: string }>`SELECT id,request_hash
      FROM campus_model_environment_retention_jobs WHERE realm_id=${scope.realm_id}::uuid
        AND environment_namespace_id=${scope.environment_namespace_id}`.execute(transaction)).rows[0];
    if (existing && existing.request_hash !== requestHash) {
      throw new ConflictException("This Simulation environment already has a different retained cleanup plan.");
    }
    const row = (await sql<EnvironmentRetentionJob>`INSERT INTO campus_model_environment_retention_jobs(
        school_id,realm_id,environment_namespace_id,state,delete_after,available_at,artifact_classes,
        retention_policy_ref,scheduled_by_agent_id,authority_receipt_id,correlation_id,idempotency_key,
        request_hash,max_attempts,retry_delays_seconds
      ) VALUES (${input.school_id}::uuid,${scope.realm_id}::uuid,${scope.environment_namespace_id},'scheduled',
        ${when}::timestamptz,${when}::timestamptz,${classes}::text[],${input.retention_policy_ref},
        ${input.scheduled_by_agent_id}::uuid,${input.authority_receipt_id}::uuid,
        ${input.correlation_id}::uuid,${input.idempotency_key},${requestHash},
        ${input.max_attempts},${input.retry_delays_seconds}::integer[])
      ON CONFLICT(realm_id,environment_namespace_id) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
      RETURNING id AS job_id,realm_id,environment_namespace_id,state,delete_after,artifact_classes,
        attempt_count,max_attempts,lease_owner,lease_until`.execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The environment retention job could not be scheduled.");
    return row;
  }

  async claimEnvironmentRetention(transaction: Transaction<Database>, workerId: string, leaseSeconds: number): Promise<EnvironmentRetentionJob | null> {
    const worker = z.string().trim().min(3).max(160).parse(workerId);
    const lease = positiveLease.parse(leaseSeconds);
    return (await sql<EnvironmentRetentionJob>`WITH candidate AS (
      SELECT id FROM campus_model_environment_retention_jobs
      WHERE state IN ('scheduled','leased','running') AND available_at<=CURRENT_TIMESTAMP
        AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) AND attempt_count<max_attempts
      ORDER BY delete_after,created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE campus_model_environment_retention_jobs job SET state='leased',lease_owner=${worker},
        lease_until=CURRENT_TIMESTAMP+(${lease}::text||' seconds')::interval,attempt_count=attempt_count+1
      FROM candidate WHERE job.id=candidate.id
      RETURNING job.id AS job_id,job.realm_id,job.environment_namespace_id,job.state,job.delete_after,
        job.artifact_classes,job.attempt_count,job.max_attempts,job.lease_owner,job.lease_until`
      .execute(transaction)).rows[0] ?? null;
  }

  async completeEnvironmentRetention(transaction: Transaction<Database>, jobId: string, workerId: string, deletedCounts: Record<string, number>): Promise<EnvironmentRetentionJob> {
    const counts = z.record(identifier, z.number().int().nonnegative()).parse(deletedCounts);
    const row = (await sql<EnvironmentRetentionJob>`WITH completed AS (
      UPDATE campus_model_environment_retention_jobs SET state='completed',lease_owner=NULL,lease_until=NULL,
        deleted_counts=${JSON.stringify(counts)}::jsonb,completed_at=now()
      WHERE id=${z.string().uuid().parse(jobId)}::uuid AND lease_owner=${z.string().trim().min(3).max(160).parse(workerId)}
        AND state IN ('leased','running') AND lease_until>=CURRENT_TIMESTAMP
        AND ${JSON.stringify(counts)}::jsonb ?& artifact_classes
      RETURNING *
    ), expired AS (
      UPDATE execution_environment_namespaces namespace SET status='expired'
      FROM completed WHERE namespace.namespace_id=completed.environment_namespace_id
        AND namespace.realm_id=completed.realm_id RETURNING namespace.namespace_id
    ) SELECT completed.id AS job_id,completed.realm_id,completed.environment_namespace_id,
        completed.state,completed.delete_after,completed.artifact_classes,completed.attempt_count,
        completed.max_attempts,completed.lease_owner,completed.lease_until FROM completed,expired`
      .execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The retention completion does not match an active unexpired lease.");
    return row;
  }

  async failEnvironmentRetention(transaction: Transaction<Database>, jobId: string, workerId: string, errorCode: string): Promise<EnvironmentRetentionJob> {
    const row = (await sql<EnvironmentRetentionJob>`UPDATE campus_model_environment_retention_jobs SET
        state=CASE WHEN attempt_count<max_attempts THEN 'scheduled' ELSE 'failed' END,
        available_at=CASE WHEN attempt_count<max_attempts THEN CURRENT_TIMESTAMP+
          (retry_delays_seconds[attempt_count]::text||' seconds')::interval ELSE available_at END,
        lease_owner=NULL,lease_until=NULL,last_error_code=${z.string().trim().min(3).max(100).parse(errorCode)}
      WHERE id=${z.string().uuid().parse(jobId)}::uuid
        AND lease_owner=${z.string().trim().min(3).max(160).parse(workerId)}
        AND state IN ('leased','running') AND lease_until>=CURRENT_TIMESTAMP
      RETURNING id AS job_id,realm_id,environment_namespace_id,state,delete_after,artifact_classes,
        attempt_count,max_attempts,lease_owner,lease_until`.execute(transaction)).rows[0];
    if (!row) throw new ConflictException("The retention failure does not match an owned cleanup job.");
    return row;
  }
}
