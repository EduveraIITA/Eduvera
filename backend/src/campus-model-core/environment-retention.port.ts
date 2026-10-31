import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";

export const ENVIRONMENT_RETENTION_PORT = Symbol("ENVIRONMENT_RETENTION_PORT");

export interface EnvironmentRetentionJob {
  job_id: string;
  realm_id: string;
  environment_namespace_id: string;
  state: "scheduled" | "leased" | "running" | "completed" | "failed" | "cancelled";
  delete_after: string | Date;
  artifact_classes: string[];
  attempt_count: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_until: string | Date | null;
}

export interface ScheduleEnvironmentRetentionInput {
  school_id: string;
  delete_after: string;
  artifact_classes: string[];
  retention_policy_ref: string;
  max_attempts: number;
  retry_delays_seconds: number[];
  scheduled_by_agent_id: string;
  authority_receipt_id: string;
  correlation_id: string;
  idempotency_key: string;
}

export interface EnvironmentRetentionPort {
  scheduleEnvironmentRetention(transaction: Transaction<Database>, input: ScheduleEnvironmentRetentionInput): Promise<EnvironmentRetentionJob>;
  claimEnvironmentRetention(transaction: Transaction<Database>, workerId: string, leaseSeconds: number): Promise<EnvironmentRetentionJob | null>;
  completeEnvironmentRetention(transaction: Transaction<Database>, jobId: string, workerId: string, deletedCounts: Record<string, number>): Promise<EnvironmentRetentionJob>;
  failEnvironmentRetention(transaction: Transaction<Database>, jobId: string, workerId: string, errorCode: string): Promise<EnvironmentRetentionJob>;
}
