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
  is_company_operator?: boolean;
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  role: AccountRole;
  avatar_url?: string | null;
}

export interface SchoolMembership {
  id: string;
  school_id: string;
  school_name: string;
  role: MembershipRole;
}

interface SessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  csrf_token: string;
  demo_mode: boolean;
}

interface MeResponse {
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

async function establishCsrfCookie() {
  await apiFetch<{ csrf_token: string }>("/api/v1/auth/csrf/");
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
        memberships: profile.memberships,
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
      await establishCsrfCookie();
      const response = await apiFetch<AuthResponse>("/api/v1/auth/login/", {
        method: "POST",
        body: JSON.stringify(input),
      });
      await loadProfile(response);
      await queryClient.invalidateQueries();
    },
    [loadProfile, queryClient],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      await establishCsrfCookie();
      const response = await apiFetch<AuthResponse>("/api/v1/auth/register/", {
        method: "POST",
        body: JSON.stringify(input),
      });
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
      await establishCsrfCookie();
      const response = await apiFetch<AuthResponse>("/api/v1/auth/demo-session/", {
        method: "POST",
        body: JSON.stringify({ role: persona }),
      });
      await loadProfile(response);
      queryClient.clear();
    },
    [loadProfile, queryClient],
  );

  const logout = useCallback(async () => {
    await apiFetch<void>("/api/v1/auth/logout/", { method: "POST" });
    queryClient.clear();
    setState((current) => ({
      status: "anonymous",
      user: null,
      memberships: [],
      demoMode: current.demoMode,
      serviceError: null,
    }));
  }, [queryClient]);

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

export function authDestination(auth: Pick<AuthContextValue, "status" | "portals" | "memberships"> & { user?: Pick<AuthUser, "is_company_operator"> | null }) {
  if (auth.status !== "authenticated") return "/login";
  if (auth.user?.is_company_operator) return "/company";
  if (auth.portals.includes("parent")) return "/parent/home";
  if (auth.portals.includes("student")) return "/student";
  if (auth.portals.includes("teacher")) return "/teacher";
  if (auth.portals.includes("principal")) return "/principal";
  if (auth.memberships.length === 0) return "/onboarding/pending";
  return "/workspace";
}
