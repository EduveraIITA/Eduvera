import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { ModelObservationContractRefs } from "./contracts.js";
import type { OperationalRealmScope } from "./operational-realm.js";

export const MODEL_CONTRACT_REGISTRY_PORT = Symbol("MODEL_CONTRACT_REGISTRY_PORT");

export interface ResolvedSemanticTypeDefinition {
  id: string;
  namespace: string;
  type_key: string;
  version: number;
}

export interface ResolvedObservationContracts {
  subject_type: ResolvedSemanticTypeDefinition;
  context_type: ResolvedSemanticTypeDefinition | null;
  observation_schema: {
    id: string;
    namespace: string;
    schema_key: string;
    version: number;
  };
  capability_manifest: {
    id: string;
    namespace: string;
    capability_key: string;
    version: number;
  };
}

/**
 * Realm-scoped contract resolution. Domain adapters submit portable catalogue
 * references; the core resolves only versions explicitly activated by the
 * OperationalRealm and returns the exact identities retained with evidence.
 */
export interface ModelContractRegistryPort {
  resolveObservationContracts(
    transaction: Transaction<Database>,
    scope: OperationalRealmScope,
    refs: ModelObservationContractRefs,
  ): Promise<ResolvedObservationContracts>;
}
