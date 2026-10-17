import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";

export const PROJECTION_CHECKPOINT_PORT = Symbol("PROJECTION_CHECKPOINT_PORT");

export interface EnvironmentProjectionCheckpoint {
  realm_id: string;
  environment_namespace_id: string;
  consumer: string;
  last_delivery_sequence: number;
  last_event_id: string | null;
  state: "active" | "rebuilding" | "failed" | "paused";
  updated_at: string | Date;
}

export interface ProjectionCheckpointPort {
  readCheckpoint(transaction: Transaction<Database>, schoolId: string, consumer: string): Promise<EnvironmentProjectionCheckpoint>;
  advanceCheckpoint(
    transaction: Transaction<Database>,
    schoolId: string,
    consumer: string,
    deliverySequence: number,
    eventId: string | null,
  ): Promise<EnvironmentProjectionCheckpoint>;
}
