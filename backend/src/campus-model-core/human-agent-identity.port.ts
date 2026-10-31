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
  /** Bounded identity presentation for an already-authorized People/account workflow; never grants access. */
  listPersonAccountStates(transaction: Transaction<Database>, input: {
    school_id: string; person_ids: string[]; at: string; viewer_user_id?: string;
  }): Promise<PersonAccountState[]>;
  /** Minimal current account/person choices for an already-authorized domain workflow. */
  listActingPeople(transaction: Transaction<Database>, input: { school_id: string; at: string }): Promise<Array<{ person_id: string; user_id: string; label: string }>>;
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
