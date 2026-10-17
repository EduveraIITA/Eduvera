import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";

export const EXECUTION_PROVISIONING_PORT = Symbol("EXECUTION_PROVISIONING_PORT");

export interface BeginSnapshotProvisionInput {
  school_id: string;
  source_snapshot_ref: string;
  requested_modules: string[];
  source_recorded_at: string;
  expires_at: string;
  requested_by_agent_id: string;
  authority_receipt_id: string;
  correlation_id: string;
  idempotency_key: string;
}

export interface SnapshotProvisionReceipt {
  provision_id: string;
  state: "collecting" | "blocked" | "ready" | "restoring" | "restored" | "expired" | "failed";
  expected_adapter_count: number;
  contributed_adapter_count: number;
  missing_modules: string[];
  coverage_hash: string;
  manifest_hash: string | null;
  replayed: boolean;
}

export interface SnapshotContributionInput {
  school_id: string;
  provision_id: string;
  adapter_definition_id: string;
  adapter_version: number;
  module_id: string;
  artifact_ref: string;
  artifact_hash: string;
  restore_schema_version: number;
  record_count: number;
  source_revision_watermark: string;
  privacy_transform_ref: string;
  capture_schema_version: number;
  captured_at: string;
  metadata: Record<string, unknown>;
}

export interface BeginSnapshotRestoreInput {
  school_id: string;
  provision_id: string;
  execution_snapshot_id: string;
  started_at: string;
}

export interface SnapshotRestoreContributionInput {
  school_id: string;
  restore_id: string;
  adapter_definition_id: string;
  adapter_version: number;
  artifact_hash: string;
  restore_schema_version: number;
  restored_record_count: number;
  restored_at: string;
  receipt: Record<string, unknown>;
}

export interface SnapshotRestoreReceipt {
  restore_id: string;
  state: "restoring" | "ready" | "failed" | "expired";
  expected_adapter_count: number;
  restored_adapter_count: number;
  manifest_hash: string;
  replayed: boolean;
}

export interface ExecutionProvisioningPort {
  beginSnapshotProvision(transaction: Transaction<Database>, input: BeginSnapshotProvisionInput): Promise<SnapshotProvisionReceipt>;
  recordSnapshotContribution(transaction: Transaction<Database>, input: SnapshotContributionInput): Promise<SnapshotProvisionReceipt>;
  sealSnapshotProvision(transaction: Transaction<Database>, schoolId: string, provisionId: string): Promise<SnapshotProvisionReceipt>;
  beginSnapshotRestore(transaction: Transaction<Database>, input: BeginSnapshotRestoreInput): Promise<SnapshotRestoreReceipt>;
  recordSnapshotRestoreContribution(transaction: Transaction<Database>, input: SnapshotRestoreContributionInput): Promise<SnapshotRestoreReceipt>;
  completeSnapshotRestore(transaction: Transaction<Database>, schoolId: string, restoreId: string): Promise<SnapshotRestoreReceipt>;
}
