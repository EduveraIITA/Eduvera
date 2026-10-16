import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { CampusModelObservation, CampusModelObservationTransition } from "./contracts.js";

export const OBSERVATION_INGRESS_PORT = Symbol("OBSERVATION_INGRESS_PORT");

export interface ObservationIngressPort {
  recordObservations(
    transaction: Transaction<Database>,
    observations: CampusModelObservation[],
  ): Promise<string[]>;
  transitionObservations(
    transaction: Transaction<Database>,
    input: CampusModelObservationTransition,
  ): Promise<number>;
}
