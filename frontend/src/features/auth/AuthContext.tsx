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

export type AccountRole = Persona | "staff" | "admin";
export type MembershipRole = "student" | "guardian" | "staff" | "admin";
export type Portal = "parent" | "student" | "teacher" | "principal";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  role: AccountRole;
  avatar_url?: string | null;
  active_school_id?: string | null;
}

export interface SchoolMembership {
  id: string;
  school_id: string;
  school_name: string;
  role: MembershipRole;
  permissions?: string[];
  custom_role?: {id:string;name:string} | null;
}

interface SessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  csrf_token: string;
  demo_mode: boolean;
}

interface MeResponse {
  company_operator?:boolean;
  institution_setup_required?:boolean;
  school_permissions?: Array<{school_id:string;permissions:string[];custom_role:{id:string;name:string}|null}>;
  user: AuthUser;
  students: Array<{ id: string }>;
  memberships: SchoolMembership[];
  demo_mode: boolean;
}

interface AuthResponse {
  user: AuthUser;
  csrf_token: string;
  demo_mode: boolean;
  onboarding?: {
    status: "pending_school_membership";
    has_school_access: boolean;
    message: string;
  };
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: Persona;
}

interface AuthState {
  companyOperator?:boolean;
  setupRequired?:boolean;
  status: "loading" | "anonymous" | "authenticated";
  user: AuthUser | null;
  memberships: SchoolMembership[];
  demoMode: boolean;
  serviceError: string | null;
}

export interface AuthContextValue extends AuthState {
  portals: Portal[];
  hasPortal: (portal: Portal) => boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  enterDemo: (persona: DemoPersona) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const initialState: AuthState = {
  status: "loading",
  user: null,
  memberships: [],
  demoMode: false,
  serviceError: null,
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const LOGGED_OUT_KEY = "omnischool:explicitly-logged-out";
const LOGGED_OUT_DEMO_MODE_KEY = "omnischool:logged-out-demo-mode";

function getPortals(memberships: SchoolMembership[]): Portal[] {
  const portals = new Set<Portal>();
  for (const membership of memberships) {
    if (membership.role === "guardian") portals.add("parent");
    if (membership.role === "student") portals.add("student");
    if (membership.role === "staff") portals.add("teacher");
    if (membership.role === "admin") portals.add("principal");
  }
  return [...portals];
}

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(initialState);

  const loadProfile = useCallback(async (fallback?: AuthResponse) => {
    try {
      const profile = await apiFetch<MeResponse>("/api/v1/auth/me/");
      setState({
        status: "authenticated",
        user: profile.user,
        companyOperator:profile.company_operator===true,
        setupRequired:profile.institution_setup_required===true,
        memberships: (profile.user.active_school_id ? profile.memberships.filter((m) => m.school_id === profile.user.active_school_id) : profile.memberships).map(m=>({...m,...profile.school_permissions?.find(p=>p.school_id===m.school_id)})),
        demoMode: profile.demo_mode,
        serviceError: null,
      });
    } catch (error) {
      if (!fallback) throw error;
      setState({
        status: "authenticated",
        user: fallback.user,
        memberships: [],
        demoMode: fallback.demo_mode,
        serviceError: null,
      });
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
        serviceError: null,
      });
      return;
    }
    try {
      const session = await apiFetch<SessionResponse>("/api/v1/auth/session/");
      if (!session.authenticated || !session.user) {
        setState({
          status: "anonymous",
          user: null,
          memberships: [],
          demoMode: session.demo_mode,
          serviceError: null,
        });
        return;
      }
      await loadProfile({
        user: session.user,
        csrf_token: session.csrf_token,
        demo_mode: session.demo_mode,
      });
    } catch (error) {
      const isUnauthorized = error instanceof ApiError && error.status === 401;
      setState({
        status: "anonymous",
        user: null,
        memberships: [],
        demoMode: false,
        serviceError: isUnauthorized
          ? null
          : "We couldn't reach the school service. You can retry in a moment.",
      });
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
        serviceError: null,
      }));
    };
    window.addEventListener("omnischool:session-expired", handleSessionExpiry);
    return () => window.removeEventListener("omnischool:session-expired", handleSessionExpiry);
  }, [queryClient]);

  const login = useCallback(
    async (input: LoginInput) => {
      const response = await authMutation<AuthResponse>("/api/v1/auth/login/", input);
      window.localStorage.removeItem(LOGGED_OUT_KEY);
      window.localStorage.removeItem(LOGGED_OUT_DEMO_MODE_KEY);
      await loadProfile(response);
      await queryClient.invalidateQueries();
    },
    [loadProfile, queryClient],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const response = await authMutation<AuthResponse>("/api/v1/auth/register/", input);
      window.localStorage.removeItem(LOGGED_OUT_KEY);
      window.localStorage.removeItem(LOGGED_OUT_DEMO_MODE_KEY);
      setState({
        status: "authenticated",
        user: response.user,
        memberships: [],
        demoMode: response.demo_mode,
        serviceError: null,
      });
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

  const logout = useCallback(async () => {
    window.localStorage.setItem(LOGGED_OUT_KEY, "1");
    window.localStorage.setItem(LOGGED_OUT_DEMO_MODE_KEY, state.demoMode ? "1" : "0");
    queryClient.clear();
    setState((current) => ({
      status: "anonymous",
      user: null,
      memberships: [],
      demoMode: current.demoMode,
      serviceError: null,
    }));
    try {
      await apiFetch<void>("/api/v1/auth/logout/", { method: "POST" });
    } catch {
      // The explicit local logout remains authoritative while an unavailable
      // server session expires or is revoked by a later successful request.
    }
  }, [queryClient, state.demoMode]);

  const portals = useMemo(() => getPortals(state.memberships), [state.memberships]);
  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      portals,
      hasPortal: (portal) => portals.includes(portal),
      login,
      register,
      enterDemo,
      logout,
      refresh,
    }),
    [enterDemo, login, logout, portals, refresh, register, state],
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

export function authDestination(auth: Pick<AuthContextValue, "status" | "portals" | "memberships" | "companyOperator" | "setupRequired">) {
  if (auth.status !== "authenticated") return "/login";
  if (auth.companyOperator) return "/company";
  if (auth.portals.includes("parent")) return "/parent/home";
  if (auth.portals.includes("student")) return "/student";
  if (auth.portals.includes("teacher")) return auth.memberships.some(m=>m.role==='staff' && m.custom_role) ? "/teacher/more" : "/teacher";
  if (auth.portals.includes("principal")) return auth.setupRequired ? "/principal/administration" : "/principal";
  if (auth.memberships.length === 0) return "/onboarding/pending";
  return "/workspace";
}
