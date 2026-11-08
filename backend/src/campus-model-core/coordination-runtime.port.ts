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
  /** Narrow a retained multi-recipient delivery without weakening its exact source lineage. */
  message_id?: string;
}

/** Owning-domain closure of obsolete work, not a recipient response or sender action.
 * First effect requires a freshly authorized command prepared in this same owning
 * transaction; accepted commands may only replay an exact retained effect. The
 * Core verifies current actor/authority, exact previous source event and next
 * accepted typed event in the selected execution world. */
export interface DomainMessageSupersessionInput {
  school_id: string;
  command_id: string;
  message_id: string;
  previous_event_id: string;
  /** Explicit older open work for this exact source, not a substitute for the
   * freshly checked current command revision. Omission retains adjacent-only semantics. */
  previous_source_revision?: number;
  /** Optional native subject identity when exact source work is a child record (for example an assignment attempt).
   * It must equal the existing previous/command/resulting subject; omission retains source-record identity. */
  subject_record_id?: string;
  resulting_event_id: string;
  required_capability: string;
  occurred_at: string;
  idempotency_key: string;
}

export interface CoordinationTraceReceipt {
  event_id: string;
  correlation_id: string;
  message_id: string;
  /** Current exact-source protocol state; not authorization or native source state. */
  message_state?: OperationalMessageState;
  /** Protocol response eligibility at the selected execution clock, never domain authorization.
   * A response due date is informative; only a terminal state or expiry closes delivery. */
  message_open?: boolean;
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
  supersedeDomainMessage(
    transaction: Transaction<Database>,
    input: DomainMessageSupersessionInput,
  ): Promise<OperationalMessageOutcomeReceipt>;
}
