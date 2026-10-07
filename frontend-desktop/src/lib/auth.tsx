import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";

export type UserRole = "student" | "parent" | "staff" | "admin";
export type MembershipRole = "student" | "guardian" | "staff" | "admin";

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  role: UserRole;
  avatar_url?: string | null;
  active_school_id?: string | null;
}
export interface Membership { id: string; school_id: string; school_name: string; role: MembershipRole }

/* Every account type can sign in here. Persona is derived from the school
   membership, never from a fixed menu. */
export type Persona = "principal" | "teacher" | "parent" | "student";

interface AuthState {
  status: "loading" | "anonymous" | "signed-in";
  user: SessionUser | null;
  memberships: Membership[];
  persona: Persona | null;
  school: Membership | null;
  demoMode: boolean;
  grants: Array<{ school_id: string; permission: string }>;
  child: string | null;                 // guardian's selected child (student id)
  setChild(id: string | null): void;
  login(identifier: string, password: string): Promise<void>;
  logout(): Promise<void>;
  selectSchool(id: string, destination?: "administration" | "security"): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

function personaFor(memberships: Membership[]): { persona: Persona | null; school: Membership | null } {
  const admin = memberships.find((m) => m.role === "admin");
  if (admin) return { persona: "principal", school: admin };
  const staff = memberships.find((m) => m.role === "staff");
  if (staff) return { persona: "teacher", school: staff };
  const guardian = memberships.find((m) => m.role === "guardian");
  if (guardian) return { persona: "parent", school: guardian };
  const student = memberships.find((m) => m.role === "student");
  if (student) return { persona: "student", school: student };
  return { persona: null, school: null };
}

interface MeResponse { user: SessionUser; memberships: Membership[]; demo_mode: boolean; permission_grants: Array<{ school_id: string; permission: string }> }
interface SessionResponse { user: SessionUser | null; csrf_token: string; demo_mode: boolean }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [grants, setGrants] = useState<MeResponse["permission_grants"]>([]);
  const [child, setChild] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const session = await api<SessionResponse>("/api/v1/auth/session/");
      setDemoMode(session.demo_mode);
      if (!session.user) { setUser(null); setMemberships([]); setStatus("anonymous"); return; }
      const me = await api<MeResponse>("/api/v1/auth/me/");
      setUser(me.user); setMemberships(me.memberships); setGrants(me.permission_grants ?? []); setStatus("signed-in");
    } catch {
      setUser(null); setMemberships([]); setStatus("anonymous");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const expired = () => { setUser(null); setMemberships([]); setStatus("anonymous"); };
    window.addEventListener("omnischool:session-expired", expired);
    return () => window.removeEventListener("omnischool:session-expired", expired);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    await api("/api/v1/auth/csrf/");
    await api("/api/v1/auth/login/", { method: "POST", body: JSON.stringify({ identifier, password }) });
    await load();
  }, [load]);

  const logout = useCallback(async () => {
    try { await api("/api/v1/auth/logout/", { method: "POST" }); } finally {
      setUser(null); setMemberships([]); setChild(null); setStatus("anonymous");
    }
  }, []);

  const value = useMemo<AuthState>(() => {
    const { persona, school } = personaFor(user?.active_school_id ? memberships.filter((m) => m.school_id === user.active_school_id) : memberships);
    const selectSchool = async (id: string, destination: "administration" | "security" = "security") => {
      await api("/api/v1/auth/active-school/", { method: "POST", body: JSON.stringify({ school_id: id }) });
      // A full navigation clears all student- and school-keyed caches together.
      window.location.assign(`${import.meta.env.BASE_URL}${destination}`);
    };
    return { status, user, memberships, persona, school, demoMode, grants, child, setChild, login, logout, selectSchool };
  }, [status, user, memberships, demoMode, grants, child, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
