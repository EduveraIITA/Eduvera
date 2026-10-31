import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, apiFetch, type DemoPersona, type Persona } from "../../lib/api";
import {
  LIVE_EXECUTION_ENVIRONMENT,
  ExecutionEnvironmentInvariantError,
  executionEnvironmentFromWire,
  type ExecutionEnvironment,
  type ExecutionEnvironmentWireDescriptor,
} from "../simulation/executionEnvironment";

export type AccountRole = Persona | "staff" | "admin" | "member";
export type MembershipRole = "student" | "guardian" | "staff" | "admin" | "member";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  role: AccountRole;
  avatar_url?: string | null;
  email_verified?: boolean;
  active_school_id?: string | null;
}

export interface SchoolMembership {
  access_scope?: "campus" | "assigned_work";
  id: string;
  school_id: string;
  school_name: string;
  role: MembershipRole;
  permissions?: string[];
  custom_role?: {id:string;name:string} | null;
  work_profiles?: Array<{id:string;name:string;is_primary:boolean}>;
}

interface SessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  csrf_token: string;
  demo_mode: boolean;
  demo_profile_switcher?: boolean;
  public_demo?: boolean;
  execution_environment?: ExecutionEnvironmentWireDescriptor;
}

interface MeResponse {
  company_operator?:boolean;
  institution_setup_required?:boolean;
  school_permissions?: Array<{school_id:string;permissions:string[];custom_role:{id:string;name:string}|null;work_profiles?:Array<{id:string;name:string;is_primary:boolean}>}>;
  user: AuthUser;
  students: Array<{ id: string }>;
  memberships: SchoolMembership[];
  demo_mode: boolean;
  public_demo?: boolean;
  execution_environment?: ExecutionEnvironmentWireDescriptor;
  onboarding?: OnboardingSummary;
}

type ProgressiveOnboardingGoal = "attendance" | "gate" | "timetable" | "assignments" | "fees" | "examinations" | "performance" | "staff" | "messages";

interface OnboardingSummary {
  status: "workspace_required" | "purpose_required" | "ready";
  guidance?: "whole_campus" | null;
  guidance_resume?: {
    kind: "whole_campus";
    path: "/more/setup/whole-campus";
    actor_user_id: string;
    school_id: string;
    requires_recheck: true;
  } | null;
  has_school_access?: boolean;
  message?: string;
  selected_goal_count?: number;
  resume?: {
    step: "purpose" | "first_use" | "operating";
    goal: ProgressiveOnboardingGoal | null;
    path: string;
    continuation?: {
      kind: "activity_plan" | "learning_assignment";
      actor_user_id: string;
      school_id: string;
      source_id: string;
      source_revision: number;
      requires_recheck: true;
    };
  } | null;
}

interface AuthResponse {
  user: AuthUser;
  csrf_token: string;
  demo_mode: boolean;
  demo_profile_switcher?: boolean;
  public_demo?: boolean;
  execution_environment?: ExecutionEnvironmentWireDescriptor;
  onboarding?: OnboardingSummary;
  verification?: { delivery: string; development_token?: string; expires_at?: string };
}

interface MfaChallengeResponse {
  mfa_required: true;
  challenge_token: string;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
}

interface AuthState {
  companyOperator?:boolean;
  setupRequired?:boolean;
  onboarding?: OnboardingSummary;
  status: "loading" | "anonymous" | "authenticated";
  user: AuthUser | null;
  memberships: SchoolMembership[];
  demoMode: boolean;
  publicDemo: boolean;
  serviceError: string | null;
  executionEnvironment: ExecutionEnvironment;
}

export interface AuthContextValue extends AuthState {
  login: (input: LoginInput) => Promise<{ challengeToken: string | null; demoProfileSwitcher?: boolean }>;
  googleLogin: (credential: string) => Promise<{ challengeToken: string | null }>;
  completeMfa: (challengeToken: string, code: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  enterDemo: (persona: DemoPersona) => Promise<void>;
  enterPublicDemo: (persona: "student" | "parent" | "staff" | "admin") => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<ExecutionEnvironment | null>;
}

const initialState: AuthState = {
  status: "loading",
  user: null,
  memberships: [],
  demoMode: false,
  publicDemo: false,
  serviceError: null,
  executionEnvironment: LIVE_EXECUTION_ENVIRONMENT,
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const LOGGED_OUT_KEY = "omnischool:explicitly-logged-out";
const LOGGED_OUT_DEMO_MODE_KEY = "omnischool:logged-out-demo-mode";

function retryableCsrfFailure(error: unknown) {
  return !(error instanceof ApiError) || error.status === 408 || error.status === 429 || error.status >= 500;
}

async function establishCsrfCookie() {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await apiFetch<{ csrf_token: string }>("/api/v1/auth/csrf/");
      return;
    } catch (error) {
      lastError = error;
      if (!retryableCsrfFailure(error) || attempt === 2) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function authMutation<T>(path: string, body: unknown): Promise<T> {
  await establishCsrfCookie();
  try {
    return await apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 403 || !error.message.toLowerCase().includes("csrf")) throw error;
    await establishCsrfCookie();
    return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
  }
}

function confirmedEnvironment(
  descriptor?: ExecutionEnvironmentWireDescriptor,
  fallback?: ExecutionEnvironmentWireDescriptor,
) {
  if (descriptor) return executionEnvironmentFromWire(descriptor);
  if (fallback) return executionEnvironmentFromWire(fallback);
  return LIVE_EXECUTION_ENVIRONMENT;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(initialState);

  const loadProfile = useCallback(async (fallback?: AuthResponse) => {
    try {
      const profile = await apiFetch<MeResponse>("/api/v1/auth/me/");
      const executionEnvironment = confirmedEnvironment(
        profile.execution_environment,
        fallback?.execution_environment,
      );
      setState({
        status: "authenticated",
        user: profile.user,
        companyOperator:profile.company_operator===true,
        setupRequired:profile.institution_setup_required===true,
        onboarding: profile.onboarding ?? fallback?.onboarding,
        memberships: (profile.user.active_school_id ? profile.memberships.filter((m) => m.school_id === profile.user.active_school_id) : profile.memberships).map(m=>({...profile.school_permissions?.find(p=>p.school_id===m.school_id),...m})),
        demoMode: profile.demo_mode,
        publicDemo: profile.public_demo ?? fallback?.public_demo ?? false,
        serviceError: null,
        executionEnvironment,
      });
      return executionEnvironment;
    } catch (error) {
      if (error instanceof ExecutionEnvironmentInvariantError) throw error;
      if (!fallback) throw error;
      const executionEnvironment = confirmedEnvironment(fallback.execution_environment);
      setState({
        status: "authenticated",
        user: fallback.user,
        onboarding: fallback.onboarding,
        memberships: [],
        demoMode: fallback.demo_mode,
        publicDemo: fallback.public_demo ?? false,
        serviceError: null,
        executionEnvironment,
      });
      return executionEnvironment;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (window.localStorage.getItem(LOGGED_OUT_KEY) === "1") {
      const retainedDemoMode = window.localStorage.getItem(LOGGED_OUT_DEMO_MODE_KEY);
      setState({
        status: "anonymous",
        user: null,
        memberships: [],
        // Development sessions created before the retained flag was introduced
        // should not lose the local test personas after their first logout.
        demoMode: retainedDemoMode === null ? import.meta.env.DEV : retainedDemoMode === "1",
        publicDemo: false,
        serviceError: null,
        executionEnvironment: LIVE_EXECUTION_ENVIRONMENT,
      });
      return LIVE_EXECUTION_ENVIRONMENT;
    }
    try {
      const session = await apiFetch<SessionResponse>("/api/v1/auth/session/");
      if (!session.authenticated || !session.user) {
        setState({
          status: "anonymous",
          user: null,
          memberships: [],
          demoMode: session.demo_mode,
          publicDemo: false,
          serviceError: null,
          executionEnvironment: LIVE_EXECUTION_ENVIRONMENT,
        });
        return LIVE_EXECUTION_ENVIRONMENT;
      }
      return await loadProfile({
        user: session.user,
        csrf_token: session.csrf_token,
        demo_mode: session.demo_mode,
        public_demo: session.public_demo,
        execution_environment: session.execution_environment,
      });
    } catch (error) {
      const isUnauthorized = error instanceof ApiError && error.status === 401;
      setState({
        status: "anonymous",
        user: null,
        memberships: [],
        demoMode: false,
        publicDemo: false,
        serviceError: isUnauthorized
          ? null
          : "We couldn't reach the school service. You can retry in a moment.",
        executionEnvironment: LIVE_EXECUTION_ENVIRONMENT,
      });
      return isUnauthorized ? LIVE_EXECUTION_ENVIRONMENT : null;
    }
  }, [loadProfile]);

  useEffect(() => {
    const bootstrap = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(bootstrap);
  }, [refresh]);

  useEffect(() => {
    const handleSessionExpiry = () => {
      queryClient.clear();
      setState((current) => ({
        status: "anonymous",
        user: null,
        memberships: [],
        demoMode: current.demoMode,
        publicDemo: false,
        serviceError: null,
        executionEnvironment: LIVE_EXECUTION_ENVIRONMENT,
      }));
    };
    window.addEventListener("omnischool:session-expired", handleSessionExpiry);
    return () => window.removeEventListener("omnischool:session-expired", handleSessionExpiry);
  }, [queryClient]);

  useEffect(()=>{
    if(state.status!=="authenticated")return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const update=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{void refresh();void queryClient.invalidateQueries();},150);};
    window.addEventListener("omnischool:access-updated",update);
    return()=>{if(timer)clearTimeout(timer);window.removeEventListener("omnischool:access-updated",update);};
  },[state.status,refresh,queryClient]);

  const login = useCallback(
    async (input: LoginInput) => {
      const response = await authMutation<AuthResponse | MfaChallengeResponse>("/api/v1/auth/login/", input);
      if ("mfa_required" in response) return { challengeToken: response.challenge_token };
      window.localStorage.removeItem(LOGGED_OUT_KEY);
      window.localStorage.removeItem(LOGGED_OUT_DEMO_MODE_KEY);
      await loadProfile(response);
      await queryClient.invalidateQueries();
      return { challengeToken: null, demoProfileSwitcher: response.demo_profile_switcher === true };
    },
    [loadProfile, queryClient],
  );

  const googleLogin = useCallback(async (credential: string) => {
    const response = await authMutation<AuthResponse | MfaChallengeResponse>("/api/v1/auth/google/", { credential });
    if ("mfa_required" in response) return { challengeToken: response.challenge_token };
    window.localStorage.removeItem(LOGGED_OUT_KEY);
    window.localStorage.removeItem(LOGGED_OUT_DEMO_MODE_KEY);
    await loadProfile(response);
    queryClient.clear();
    return { challengeToken: null };
  }, [loadProfile, queryClient]);

  const completeMfa = useCallback(async (challengeToken: string, code: string) => {
    const response = await authMutation<AuthResponse>("/api/v1/auth/mfa/login/", { challenge_token: challengeToken, code });
    window.localStorage.removeItem(LOGGED_OUT_KEY);
    window.localStorage.removeItem(LOGGED_OUT_DEMO_MODE_KEY);
    await loadProfile(response);
    await queryClient.invalidateQueries();
  }, [loadProfile, queryClient]);

  const register = useCallback(
    async (input: RegisterInput) => {
      const response = await authMutation<AuthResponse>("/api/v1/auth/register/", input);
      window.localStorage.removeItem(LOGGED_OUT_KEY);
      window.localStorage.removeItem(LOGGED_OUT_DEMO_MODE_KEY);
      setState({
        status: "authenticated",
        user: response.user,
        onboarding: response.onboarding,
        memberships: [],
        demoMode: response.demo_mode,
        publicDemo: response.public_demo ?? false,
        serviceError: null,
        executionEnvironment: confirmedEnvironment(response.execution_environment),
      });
      if (response.verification?.development_token) {
        window.sessionStorage.setItem("omnischool:development-verification-token", response.verification.development_token);
      }
      queryClient.clear();
    },
    [queryClient],
  );

  const enterDemo = useCallback(
    async (persona: DemoPersona) => {
      const response = await authMutation<AuthResponse>("/api/v1/auth/demo-session/", { role: persona });
      window.localStorage.removeItem(LOGGED_OUT_KEY);
      window.localStorage.removeItem(LOGGED_OUT_DEMO_MODE_KEY);
      await loadProfile(response);
      queryClient.clear();
    },
    [loadProfile, queryClient],
  );

  const enterPublicDemo = useCallback(
    async (persona: "student" | "parent" | "staff" | "admin") => {
      const response = await authMutation<AuthResponse>("/api/v1/auth/public-demo-session/", { role: persona });
      window.localStorage.removeItem(LOGGED_OUT_KEY);
      window.localStorage.removeItem(LOGGED_OUT_DEMO_MODE_KEY);
      await loadProfile(response);
      queryClient.clear();
    },
    [loadProfile, queryClient],
  );

  const logout = useCallback(async () => {
    window.localStorage.setItem(LOGGED_OUT_KEY, "1");
    window.localStorage.setItem(LOGGED_OUT_DEMO_MODE_KEY, state.demoMode ? "1" : "0");
    queryClient.clear();
    setState((current) => ({
      status: "anonymous",
      user: null,
      memberships: [],
      demoMode: current.demoMode,
      publicDemo: false,
      serviceError: null,
      executionEnvironment: LIVE_EXECUTION_ENVIRONMENT,
    }));
    try {
      await apiFetch<void>("/api/v1/auth/logout/", { method: "POST" });
    } catch {
      // The explicit local logout remains authoritative while an unavailable
      // server session expires or is revoked by a later successful request.
    }
  }, [queryClient, state.demoMode]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      googleLogin,
      completeMfa,
      register,
      enterDemo,
      enterPublicDemo,
      logout,
      refresh,
    }),
    [googleLogin, completeMfa, enterDemo, enterPublicDemo, login, logout, refresh, register, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}

export function useOptionalAuth() {
  return useContext(AuthContext);
}

export { authDestination } from "../../../../packages/contracts/src/auth-entry";
