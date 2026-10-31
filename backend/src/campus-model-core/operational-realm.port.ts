import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { ModelAddress, OperationalRealmScope } from "./operational-realm.js";

export const OPERATIONAL_REALM_PORT = Symbol("OPERATIONAL_REALM_PORT");

export interface OperationalRealmPort {
  resolveScope(
    transaction: Transaction<Database>,
    legacySchoolId: string,
  ): Promise<OperationalRealmScope>;
  resolveEntityAddress(
    transaction: Transaction<Database>,
    legacySchoolId: string,
    reference: { domain: string; domain_id: string },
  ): Promise<ModelAddress | null>;
}
