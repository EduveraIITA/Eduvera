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
export interface CampusModelCorePort {
  recordAcceptedChange(
    transaction: Transaction<Database>,
    input: AcceptedCampusModelChange,
  ): Promise<CampusModelChangeReceipt>;
}
