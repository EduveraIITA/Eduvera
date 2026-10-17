import type { FastifyRequest } from "fastify";
import type { ExecutionEnvironment } from "../campus-model-core/execution-environment.contracts.js";
import type { ExecutionEnvironmentView } from "../auth/session-execution-environment.js";

export type UserRole = "student" | "parent" | "staff" | "admin";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url?: string;
  role: UserRole;
  is_active: boolean;
  email_verified_at?: Date | null;
  active_school_id?: string | null;
}

export type AuthenticatedRequest = FastifyRequest & {
  authUser: AuthUser;
  sessionHash: string;
  csrfToken: string;
  requestId: string;
  internalAgentDelegation?: true;
  hostedCampusSimulator?: true;
  publicDemo?: boolean;
  executionEnvironment: ExecutionEnvironment | null;
  executionEnvironmentView: ExecutionEnvironmentView;
};

export type RequestWithContext = FastifyRequest & {
  authUser?: AuthUser;
  sessionHash?: string;
  csrfToken?: string;
  requestId: string;
  internalAgentDelegation?: true;
  hostedCampusSimulator?: true;
  publicDemo?: boolean;
  executionEnvironment?: ExecutionEnvironment | null;
  executionEnvironmentView?: ExecutionEnvironmentView;
};
