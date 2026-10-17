import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";

export const PROJECTION_RECOVERY_PORT = Symbol("PROJECTION_RECOVERY_PORT");

export interface ScheduleProjectionRecoveryInput {
  school_id: string;
  consumer: string;
  mode: "rebuild" | "replay" | "verify";
  from_sequence: number;
  through_sequence: number | null;
  max_attempts: number;
  retry_policy_ref: string;
  retry_delays_seconds: number[];
  available_at: string;
  requested_by_agent_id: string;
  authority_receipt_id: string;
  correlation_id: string;
  idempotency_key: string;
}

export interface ProjectionRecoveryJob {
  job_id: string;
  realm_id: string;
  environment_namespace_id: string;
  consumer: string;
  mode: "rebuild" | "replay" | "verify";
  state: "scheduled" | "leased" | "running" | "retry_scheduled" | "completed" | "failed" | "cancelled" | "quarantined";
  from_sequence: number;
  through_sequence: number | null;
  attempt_count: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_until: string | Date | null;
}

export interface ProjectionReplayQuarantineInput {
  school_id: string;
  job_id: string;
  worker_id: string;
  event_id: string;
  delivery_sequence: number;
  error_code: string;
  schema_ref: string | null;
  safe_diagnostics: Record<string, unknown>;
  quarantined_at: string;
}

export interface ProjectionRecoveryPort {
  scheduleProjectionRecovery(transaction: Transaction<Database>, input: ScheduleProjectionRecoveryInput): Promise<ProjectionRecoveryJob>;
  claimProjectionRecovery(transaction: Transaction<Database>, schoolId: string, workerId: string, leaseSeconds: number): Promise<ProjectionRecoveryJob | null>;
  heartbeatProjectionRecovery(transaction: Transaction<Database>, schoolId: string, jobId: string, workerId: string, leaseSeconds: number): Promise<ProjectionRecoveryJob>;
  quarantineProjectionEvent(transaction: Transaction<Database>, input: ProjectionReplayQuarantineInput): Promise<ProjectionRecoveryJob>;
  completeProjectionRecovery(transaction: Transaction<Database>, schoolId: string, jobId: string, workerId: string): Promise<ProjectionRecoveryJob>;
  failProjectionRecovery(transaction: Transaction<Database>, schoolId: string, jobId: string, workerId: string, errorCode: string): Promise<ProjectionRecoveryJob>;
}
