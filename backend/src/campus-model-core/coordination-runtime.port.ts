import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type {
  AcceptedCoordinationEvent,
  CoordinationRecipientAgentRef,
  OperationalMessageOutcome,
  OperationalMessageState,
  RecipientOperationalMessageResponse,
} from "./contracts.js";

export const COORDINATION_RUNTIME_PORT = Symbol("COORDINATION_RUNTIME_PORT");

export interface MatchedCoordinationPublishReceipt {
  status: "matched";
  event_id: string;
  behaviour_version_id: string;
  subscription_id: string;
  reaction_ids: string[];
  message_ids: string[];
  deliveries: Array<{
    reaction_id: string;
    message_id: string;
    recipient: CoordinationRecipientAgentRef;
  }>;
  replayed: boolean;
}

export type CoordinationExceptionCode =
  | "configuration_missing"
  | "configuration_invalid"
  | "selector_invalid"
  | "recipient_unresolved"
  | "recipient_unauthorized";

export interface UnmatchedCoordinationPublishReceipt {
  status: "unmatched";
  event_id: string;
  exception_id: string;
  exception_code: CoordinationExceptionCode;
  reaction_ids: [];
  message_ids: [];
  replayed: boolean;
}

export type CoordinationPublishReceipt = MatchedCoordinationPublishReceipt | UnmatchedCoordinationPublishReceipt;

export interface OperationalMessageOutcomeReceipt {
  message_id: string;
  reaction_id: string;
  state: OperationalMessageState;
  outcome_id: string;
  replayed: boolean;
}

export interface CoordinationRuntimePort {
  publishAcceptedEvent(
    transaction: Transaction<Database>,
    input: AcceptedCoordinationEvent,
  ): Promise<CoordinationPublishReceipt>;
  recordMessageOutcome(
    transaction: Transaction<Database>,
    input: OperationalMessageOutcome,
  ): Promise<OperationalMessageOutcomeReceipt>;
  recordRecipientResponse(
    transaction: Transaction<Database>,
    input: RecipientOperationalMessageResponse,
  ): Promise<OperationalMessageOutcomeReceipt>;
}
