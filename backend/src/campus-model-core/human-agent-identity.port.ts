import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type {
  HumanAgentAccountEndpointLink,
  HumanAgentAccountEndpointClose,
  HumanAgentAccountEndpointReplace,
  HumanAgentAccountResolution,
  HumanAgentPersonResolution,
} from "./contracts.js";

export const HUMAN_AGENT_IDENTITY_PORT = Symbol("HUMAN_AGENT_IDENTITY_PORT");

export interface ActingHumanAgentIdentity {
  acting: true;
  agent_id: string;
  school_id: string;
  person_id: string;
  label: string;
  endpoint_id: string;
  user_id: string;
  effective_from: Date | string;
  effective_until: Date | string | null;
}

export type NonActingHumanAgentReason =
  | "person_not_found"
  | "agent_not_registered"
  | "account_not_linked"
  | "endpoint_inactive"
  | "account_inactive"
  | "membership_inactive"
  | "profile_unlinked";

export interface NonActingHumanAgentIdentity {
  acting: false;
  school_id: string;
  person_id: string | null;
  user_id: string | null;
  agent_id: string | null;
  reason: NonActingHumanAgentReason;
}

export type HumanAgentIdentityResolution = ActingHumanAgentIdentity | NonActingHumanAgentIdentity;

export interface PersonAccountState {
  person_id: string;
  has_account: boolean;
  account_state: 'active' | 'inactive' | 'not_linked';
  is_you: boolean;
}

export interface HumanAgentEndpointLinkReceipt extends ActingHumanAgentIdentity {
  replayed: boolean;
}

export interface HumanAgentEndpointCloseReceipt {
  endpoint_id: string;
  agent_id: string;
  person_id: string;
  user_id: string;
  status: "active" | "suspended" | "revoked";
  effective_until: Date | string;
  revision: number;
  transition_id: string;
  disposition: "ended" | "revoked";
  replayed: boolean;
}

export interface HumanAgentEndpointReplaceReceipt {
  closed: HumanAgentEndpointCloseReceipt;
  linked: HumanAgentEndpointLinkReceipt;
  replayed: boolean;
}

export interface HumanAgentIdentityPort {
  /** Current account/person projection in the supplied transaction, world and
   * effective instant. Retains every eligible endpoint; unlike person choices,
   * this does not collapse accounts. The caller still owns domain permission,
   * search, pagination and audience policy. An omitted selector means this one
   * institution; an explicit person selector is bounded to 1,000 IDs. */
  listCurrentAccountEndpoints(transaction: Transaction<Database>, input: {
    school_id: string; at: string; person_ids?: string[];
  }): Promise<Array<{ person_id: string; user_id: string }>>;
  /** Bounded identity presentation for an already-authorized People/account workflow; never grants access. */
  listPersonAccountStates(transaction: Transaction<Database>, input: {
    school_id: string; person_ids: string[]; at: string; viewer_user_id?: string;
  }): Promise<PersonAccountState[]>;
  /** Minimal current account/person choices for an already-authorized domain workflow. */
  listActingPeople(transaction: Transaction<Database>, input: { school_id: string; at: string }): Promise<Array<{ person_id: string; user_id: string; label: string }>>;
  /** account_not_linked means no retained account-endpoint history for this
   * institution/account. Inactive, ended, revoked or conflicting retained
   * endpoints return a different non-acting reason and must not be recreated. */
  resolveAccountEndpoint(
    transaction: Transaction<Database>,
    input: HumanAgentAccountResolution,
  ): Promise<HumanAgentIdentityResolution>;
  resolvePersonAgent(
    transaction: Transaction<Database>,
    input: HumanAgentPersonResolution,
  ): Promise<HumanAgentIdentityResolution>;
  linkAccountEndpoint(
    transaction: Transaction<Database>,
    input: HumanAgentAccountEndpointLink,
  ): Promise<HumanAgentEndpointLinkReceipt>;
  closeAccountEndpoint(
    transaction: Transaction<Database>,
    input: HumanAgentAccountEndpointClose,
  ): Promise<HumanAgentEndpointCloseReceipt>;
  replaceAccountEndpoint(
    transaction: Transaction<Database>,
    input: HumanAgentAccountEndpointReplace,
  ): Promise<HumanAgentEndpointReplaceReceipt>;
}
