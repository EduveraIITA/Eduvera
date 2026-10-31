import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";

export const EXECUTION_SNAPSHOT_PORT = Symbol("EXECUTION_SNAPSHOT_PORT");

export type ExecutionSnapshotItemKind =
  | "operating_rule"
  | "behaviour"
  | "domain_configuration"
  | "semantic_contract"
  | "protocol_contract"
  | "capability_manifest"
  | "terminology";

export interface ExecutionSnapshotItemInput {
  item_kind: ExecutionSnapshotItemKind;
  item_key: string;
  version_ref: string;
  content_hash: string;
  effective_from: string;
  effective_until: string | null;
  source_ref: string;
  metadata: Record<string, unknown>;
}

export interface ExecutionActorBindingInput {
  source_agent_id: string;
  binding_key: string;
  actor_mode: "live_agent" | "simulation_counterpart" | "delegate";
  behaviour_policy_version_ref: string | null;
  authority_snapshot_ref: string | null;
  effective_from: string;
  effective_until: string | null;
}

export interface ExecutionAuthorityGrantInput {
  source_authority_id: string;
  agent_id: string;
  capability: string;
  scope_entity_id: string | null;
  effective_from: string;
  effective_until: string | null;
  operating_rule_version_ref: string | null;
  constraints: Record<string, unknown>;
  content_hash: string;
}

export interface SealExecutionSnapshotInput {
  school_id: string;
  snapshot_kind: "live_activation" | "simulation_fork" | "rehearsal";
  source_snapshot_ref: string;
  core_contract_version: string;
  source_recorded_at: string;
  sealed_at: string;
  sealed_by_authority: string;
  metadata: Record<string, unknown>;
  items: ExecutionSnapshotItemInput[];
  actors: ExecutionActorBindingInput[];
  authority_grants: ExecutionAuthorityGrantInput[];
}

export interface ExecutionSnapshotReceipt {
  snapshot_id: string;
  realm_id: string;
  environment_namespace_id: string;
  configuration_hash: string;
  item_count: number;
  actor_count: number;
  authority_grant_count: number;
  replayed: boolean;
}

export interface ExecutionSnapshotPort {
  sealExecutionSnapshot(
    transaction: Transaction<Database>,
    input: SealExecutionSnapshotInput,
  ): Promise<ExecutionSnapshotReceipt>;
}
