import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { AcceptedCampusModelChange } from "./contracts.js";

export const CAMPUS_MODEL_CORE_PORT = Symbol("CAMPUS_MODEL_CORE_PORT");

export interface CampusModelChangeReceipt {
  command_id: string;
  target_entity_id: string;
  actor_agent_id: string;
  relationship_ids: string[];
}
export interface CampusModelActivity {
  id: string;
  kind: "setup" | "attendance";
  action: string;
  subject_label: string | null;
  item_count: number;
  state: string;
  occurred_at: Date | string;
  actor_label: string;
}
export interface CampusModelCorePort {
  recordAcceptedChange(
    transaction: Transaction<Database>,
    input: AcceptedCampusModelChange,
  ): Promise<CampusModelChangeReceipt>;
  recentActivity(schoolId: string, limit?: number): Promise<CampusModelActivity[]>;
}
