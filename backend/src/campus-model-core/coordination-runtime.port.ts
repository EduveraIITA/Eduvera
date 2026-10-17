import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type {
  AcceptedCoordinationEvent,
  CampusModelEntitySnapshot,
  CoordinationRecipientAgentRef,
  CoordinationRecipientSelectorConfig,
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
  route_snapshot?: {
    message_kind: "request" | "task" | "offer" | "update";
    message_schema_version: number;
    response_due_at: string | null;
    expires_at: string | null;
  };
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

export interface CoordinationTraceQuery {
  school_id: string;
  source_domain: string;
  source_record_id: string;
  event_type: string;
  source_revision: number;
}

export interface CoordinationTraceReceipt {
  event_id: string;
  correlation_id: string;
  message_id: string;
}

export interface SourceEventLookup {
  school_id: string;
  source_outbox_event_id: string;
}

export interface OperationalMessageWorkQuery {
  workflow: string;
  states: readonly ("queued" | "delivered" | "acknowledged")[];
  limit: number;
  claim?: boolean;
}

export interface OperationalMessageWorkItem {
  message_id: string;
  school_id: string;
  state: "queued" | "delivered" | "acknowledged";
  payload: Record<string, unknown>;
}

export interface CoordinationRouteResolutionInput {
  school_id: string;
  source_domain: string;
  event_type: string;
  selector_key: string;
  occurred_at: string;
}

export interface MatchedCoordinationRouteResolution {
  status: "matched";
  behaviour_version_id: string;
  behaviour_key: string;
  behaviour_version: number;
  behaviour_configuration: unknown;
  configuration_schema_version: number;
  subscription_id: string;
  subscription_key: string;
  reaction_kind: string;
  message_kind: "request" | "task" | "offer" | "update";
  message_schema_version: number;
  selector: CoordinationRecipientSelectorConfig;
  response_due_after_seconds: number | null;
  expires_after_seconds: number | null;
  max_attempts: number;
  retry_after_seconds: number | null;
  priority: number;
}

export interface UnmatchedCoordinationRouteResolution {
  status: "unmatched";
  exception_code: "configuration_missing" | "configuration_invalid";
  explanation: string;
  matching_behaviour_version_ids: string[];
}

export type CoordinationRouteResolution =
  | MatchedCoordinationRouteResolution
  | UnmatchedCoordinationRouteResolution;

export interface CoordinationCandidateAuthorizationInput {
  school_id: string;
  behaviour_version_id: string;
  subscription_id: string;
  occurred_at: string;
  recipients: CoordinationRecipientAgentRef[];
  scope: CampusModelEntitySnapshot | null;
}

export interface CoordinationCandidateAuthorizationReceipt {
  authorised: CoordinationRecipientAgentRef[];
  unresolved: CoordinationRecipientAgentRef[];
  unauthorized: CoordinationRecipientAgentRef[];
}

export interface CoordinationRuntimePort {
  findExactTrace(
    transaction: Transaction<Database>,
    input: CoordinationTraceQuery,
  ): Promise<CoordinationTraceReceipt | null>;
  hasAcceptedSourceEvent(
    transaction: Transaction<Database>,
    input: SourceEventLookup,
  ): Promise<boolean>;
  listOperationalMessageWork(
    transaction: Transaction<Database>,
    input: OperationalMessageWorkQuery,
  ): Promise<OperationalMessageWorkItem[]>;
  resolveEventRoute(
    transaction: Transaction<Database>,
    input: CoordinationRouteResolutionInput,
  ): Promise<CoordinationRouteResolution>;
  authorizeCandidateRecipients(
    transaction: Transaction<Database>,
    input: CoordinationCandidateAuthorizationInput,
  ): Promise<CoordinationCandidateAuthorizationReceipt>;
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
