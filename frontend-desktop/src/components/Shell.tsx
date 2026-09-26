import { useQuery } from "@tanstack/react-query";
import { Bell, BookOpen, CalendarDays, ClipboardCheck, FileText, LayoutGrid, LogOut, Moon, Sun, Settings, Wallet, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { normaliseNotifications, staffApi } from "../features/staff";
import { useAuth, type Persona } from "../lib/auth";

interface NavItem { to: string; label: string; icon: typeof LayoutGrid; personas: Persona[] }

/* Navigation is derived from persona, not a fixed menu. */
const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutGrid, personas: ["principal", "teacher", "parent", "student"] },
  { to: "/attendance", label: "Attendance", icon: ClipboardCheck, personas: ["principal", "teacher", "parent", "student"] },
  { to: "/leave", label: "Leave requests", icon: FileText, personas: ["principal", "teacher", "parent", "student"] },
  { to: "/timetable", label: "Timetable", icon: CalendarDays, personas: ["principal", "parent", "student"] },
  { to: "/diary", label: "Diary", icon: BookOpen, personas: ["parent", "student"] },
  { to: "/notifications", label: "Notifications", icon: Bell, personas: ["principal", "teacher", "parent", "student"] },
  { to: "/administration", label: "Administration", icon: Settings, personas: ["principal", "teacher"] },
  { to: "/fees", label: "Fees", icon: Wallet, personas: ["principal", "teacher", "parent", "student"] },
  { to: "/security", label: "Account security", icon: Shield, personas: ["principal", "teacher", "parent", "student"] },
];
const PERSONA_LABEL: Record<Persona, string> = { principal: "Principal", teacher: "Teacher", parent: "Guardian", student: "Student" };
const AREA_LABEL: Record<Persona, string> = { principal: "Leadership", teacher: "Teaching", parent: "Family", student: "Learner" };

function useTheme() {
  const [theme, setTheme] = useState<string>(() => document.documentElement.getAttribute("data-theme") ?? "");
  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
  }, [theme]);
  const isDark = theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return { isDark, toggle: () => setTheme(isDark ? "light" : "dark") };
}

export function Shell() {
  const { user, persona, school, logout, demoMode, memberships, selectSchool, grants } = useAuth();
  const [schoolError, setSchoolError] = useState("");
  const schools = [...new Map(memberships.map((item) => [item.school_id, item])).values()];
  const { isDark, toggle } = useTheme();
  const location = useLocation();
  const unread = useQuery({
    queryKey: ["notifications"],
    queryFn: staffApi.notifications,
    select: (v) => normaliseNotifications(v).filter((n) => !n.read_at).length,
    staleTime: 30_000,
  });
  const items = NAV.filter((n) => persona && n.personas.includes(persona)).filter((n) => {
    if (persona !== "teacher") return true;
    const permission = n.to === "/administration" ? "sis.manage" : n.to === "/fees" ? "fees.manage" : null;
    return !permission || grants.some((grant) => grant.school_id === school?.school_id && grant.permission === permission);
  });
  const current = items.find((n) => (n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to)));

  return (
    <div className="app">
      <aside className="side">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="brand"><span className="dot" /><span className="name">{school?.school_name ?? "Eduera"}</span></div>
          {schools.length > 1 ? <label className="school-chip">Active school<select className="input" value={user?.active_school_id ?? ""} onChange={async (event) => { try { await selectSchool(event.target.value); } catch (err) { setSchoolError((err as Error).message); } }}><option value="" disabled>Select a school</option>{schools.map((item) => <option key={item.school_id} value={item.school_id}>{item.school_name}</option>)}</select>{schoolError ? <span role="alert">{schoolError}</span> : null}</label> : null}
          <div className="school-chip">
            <div className="lbl">{persona ? AREA_LABEL[persona] : ""} portal</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.display_name}</div>
          </div>
        </div>

        <nav className="grp" aria-label="Main">
          <div className="lbl" style={{ padding: "0 12px 8px" }}>Authorized tools</div>
          {items.map((n) => {
            const Icon = n.icon;
            const badge = n.to === "/notifications" && unread.data ? <span className="badge" style={{ color: "var(--cri)", background: "var(--cri-bg)" }}>{unread.data}</span> : null;
            return (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} className="nav-i">
                <Icon size={17} strokeWidth={2} /><span>{n.label}</span>{badge}
              </NavLink>
            );
          })}
        </nav>

        {persona === "teacher" ? (
          <div className="grp" style={{ marginTop: "auto" }}>
            <div className="lbl" style={{ padding: "0 12px 8px" }}>Not available to you</div>
            <div className="nav-i" style={{ opacity: .45 }} aria-disabled="true"><CalendarDays size={17} strokeWidth={2} /><span>Timetable</span></div>
          </div>
        ) : null}

        <div style={{ marginTop: persona === "teacher" ? 0 : "auto", padding: "14px 22px 0", borderTop: "1px solid var(--line-3)", display: "flex", alignItems: "center", gap: 10 }}>
          <div className="av" style={{ width: 38, height: 38, background: "var(--brand-hover)", color: "#fff", fontSize: 12 }}>{(user?.display_name ?? "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.display_name}</div>
            <div className="lbl" style={{ marginTop: 2 }}>{persona ? PERSONA_LABEL[persona] : ""}</div>
          </div>
          <button className="btn ghost sm" style={{ marginLeft: "auto", width: 36, minHeight: 36, padding: 0, borderRadius: 999 }} onClick={() => void logout()} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="lbl">{current?.label ?? "OmniSchool"}</div>
          {demoMode ? <span className="st neu">Demo data</span> : null}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="lbl" style={{ color: "var(--faint)" }}>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
            <button className="btn ghost sm" onClick={toggle} aria-label="Toggle theme" style={{ width: 42, minHeight: 42, padding: 0, borderRadius: 999 }}>{isDark ? <Sun size={17} /> : <Moon size={17} />}</button>
          </div>
        </div>
        <div className="body"><Outlet /></div>
      </div>
    </div>
  );
}
