import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";

export const OBSERVATION_SOURCE_REGISTRY_PORT = Symbol("OBSERVATION_SOURCE_REGISTRY_PORT");

export type ObservationSourceStatus = "active" | "suspended" | "revoked";
export type ObservationCapability = "observe:attendance.capture" | "observe:gate.movement";

export interface ObservationSource {
  id: string;
  kind: "device" | "integration";
  external_ref: string;
  label: string;
  status: ObservationSourceStatus;
  revision: number;
  capabilities: ObservationCapability[];
  scope_entity_id: string | null;
  scope_domain: string | null;
  scope_domain_id: string | null;
  scope_label: string | null;
  updated_at: Date | string;
}

export interface RegisterObservationSource {
  school_id: string;
  actor_user_id: string;
  kind: "device" | "integration";
  external_ref: string;
  label: string;
  capabilities: ObservationCapability[];
  scope: { domain: string; domain_id: string } | null;
  operating_rule_version_ref: string | null;
}

export interface ObservationSourceRegistryPort {
  listObservationSources(schoolId: string): Promise<ObservationSource[]>;
  registerObservationSource(transaction: Transaction<Database>, input: RegisterObservationSource): Promise<ObservationSource>;
  setObservationSourceStatus(transaction: Transaction<Database>, input: {
    school_id: string;
    actor_user_id: string;
    source_id: string;
    status: ObservationSourceStatus;
    expected_revision: number;
  }): Promise<ObservationSource>;
}
