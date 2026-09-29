import { useQuery } from "@tanstack/react-query";
import { Bell, BookOpen, Building2, CalendarDays, CalendarX2, CheckCircle2, ChevronRight, ChevronsUpDown, ClipboardCheck, GraduationCap, Headset, Home, LogOut, Moon, Settings, Shield, Sun, User, Wallet } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { familyApi } from "../features/family";
import { normaliseNotifications, staffApi } from "../features/staff";
import { useAuth, type Persona } from "../lib/auth";
import { Initials, Pill } from "./ui";

/* `permission` gates the item for teachers only; leadership and families are not permission-scoped. */
interface NavItem { to: string; label: string; icon: typeof Home; personas: Persona[]; desk?: boolean; permission?: string }

/* Navigation is derived from persona, not a fixed menu. "School desk" is the
   secondary group in the design; primary items are the daily screens. */
const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: Home, personas: ["principal", "teacher", "parent", "student"] },
  { to: "/attendance", label: "Attendance", icon: ClipboardCheck, personas: ["principal", "teacher", "parent", "student"] },
  { to: "/leave", label: "Leave", icon: CalendarX2, personas: ["principal", "teacher", "parent", "student"] },
  { to: "/diary", label: "Diary", icon: BookOpen, personas: ["parent", "student"] },
  { to: "/timetable", label: "Timetable", icon: CalendarDays, personas: ["principal", "parent", "student"] },
  { to: "/notifications", label: "Notifications", icon: Bell, personas: ["principal", "teacher", "parent", "student"], desk: true },
  { to: "/administration", label: "Administration", icon: Settings, personas: ["principal", "teacher"], desk: true, permission: "sis.manage" },
  { to: "/fees", label: "Fees", icon: Wallet, personas: ["principal", "teacher", "parent", "student"], desk: true, permission: "fees.manage" },
  { to: "/security", label: "Account security", icon: Shield, personas: ["principal", "teacher", "parent", "student"], desk: true },
];
const PERSONA_LABEL: Record<Persona, string> = { principal: "Principal", teacher: "Teacher", parent: "Parent", student: "Student" };
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

/* Close a popover on outside click / Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

/* Academic session for the header pill: from the term when a screen has loaded it,
   otherwise the April–March year the school calendar most commonly follows. */
function fallbackSession(): string {
  const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}–${y + 1}`;
}

/* Sidebar context block: the child for a guardian, the learner for a student,
   the school for staff. Only the guardian's is a real switcher. */
function ContextSwitcher({ persona }: { persona: Persona }) {
  const { user, school, child, setChild } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const home = useQuery({ queryKey: ["parent-home", child], queryFn: () => familyApi.parentHome(child ?? undefined), enabled: persona === "parent", staleTime: 60_000 });
  const me = useQuery({ queryKey: ["student-home"], queryFn: familyApi.studentHome, enabled: persona === "student", staleTime: 60_000 });

  if (persona === "parent") {
    const current = home.data?.student;
    const all = current ? [current, ...home.data!.siblings.filter((s) => s.id !== current.id)] : [];
    return (
      <div className="ctx-wrap" ref={ref}>
        <button className="ctx" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox" disabled={all.length < 2}>
          <span className="l">
            <Initials name={current?.user.display_name ?? user?.display_name ?? "?"} src={current?.avatar_url} />
            <span className="who"><b>{current?.user.display_name ?? "Loading…"}</b><span>{current?.current_enrollment.class_name ?? "Child"}</span></span>
          </span>
          {all.length > 1 ? <ChevronsUpDown size={18} /> : null}
        </button>
        {open ? (
          <div className="ctx-menu" role="listbox">
            {all.map((s) => (
              <button key={s.id} role="option" aria-current={(child ?? current?.id) === s.id} onClick={() => { setChild(s.id); setOpen(false); }}>
                <Initials name={s.user.display_name} src={s.avatar_url} size={26} />
                <span style={{ flexGrow: 1 }}>{s.user.display_name}</span>
                <span className="lbl">{s.current_enrollment.class_name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (persona === "student") {
    const s = me.data?.student;
    return (
      <div className="ctx-wrap">
        <button className="ctx" disabled>
          <span className="l"><Initials name={s?.user.display_name ?? user?.display_name ?? "?"} src={s?.avatar_url} /><span className="who"><b>{user?.display_name}</b><span>{s ? `${s.current_enrollment.class_name} · roll ${s.current_enrollment.roll_number}` : "Student"}</span></span></span>
        </button>
      </div>
    );
  }
  return (
    <div className="ctx-wrap">
      <button className="ctx" disabled>
        <span className="l"><span className="av"><GraduationCap size={16} /></span><span className="who"><b>{school?.school_name ?? "School"}</b><span>{PERSONA_LABEL[persona]}</span></span></span>
      </button>
    </div>
  );
}

function HelpButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="side-foot" ref={ref} style={{ position: "relative" }}>
      {open ? <div className="help-pop">{children}</div> : null}
      <button className="help-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="l"><Headset size={20} /><span>School help</span></span><ChevronRight size={16} />
      </button>
    </div>
  );
}

export function Shell() {
  const { user, persona, school, logout, demoMode, child, memberships, selectSchool, grants } = useAuth();
  const [schoolError, setSchoolError] = useState("");
  const schools = [...new Map(memberships.map((m) => [m.school_id, m])).values()];
  const { isDark, toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const menuRef = useDismiss(menu, () => setMenu(false));
  const unread = useQuery({
    queryKey: ["notifications"],
    queryFn: staffApi.notifications,
    select: (v) => normaliseNotifications(v).filter((n) => !n.read_at).length,
    staleTime: 30_000,
  });
  // Session label: reuse whichever family screen is already cached; staff fall back to the calendar.
  const parentHome = useQuery({ queryKey: ["parent-home", child], queryFn: () => familyApi.parentHome(child ?? undefined), enabled: persona === "parent", staleTime: 60_000 });
  const studentHome = useQuery({ queryKey: ["student-home"], queryFn: familyApi.studentHome, enabled: persona === "student", staleTime: 60_000 });
  const session = parentHome.data?.student.current_enrollment.term.academic_year ?? studentHome.data?.term.academic_year ?? fallbackSession();

  const p = persona ?? "student";
  const items = NAV.filter((n) => n.personas.includes(p)).filter((n) => p !== "teacher" || !n.permission || grants.some((g) => g.school_id === school?.school_id && g.permission === n.permission));
  const primary = items.filter((n) => !n.desk);
  const desk = items.filter((n) => n.desk);
  const initials = (user?.display_name ?? "?").split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase();

  const link = (n: NavItem) => {
    const Icon = n.icon;
    const badge = n.to === "/notifications" && unread.data ? <span className="badge">{unread.data}</span> : null;
    return <NavLink key={n.to} to={n.to} end={n.to === "/"} className="nav-i"><Icon size={20} strokeWidth={2} /><span>{n.label}</span>{badge}</NavLink>;
  };

  return (
    <div className="app">
      <aside className="side">
        <div className="side-brand">
          <span className="tile"><GraduationCap size={20} strokeWidth={2} /></span>
          <div className="txt"><span className="name" title={school?.school_name}>{school?.school_name ?? "Eduera"}</span><span className="sub">{AREA_LABEL[p]} portal</span></div>
        </div>

        {schools.length > 1 ? (
          <div className="ctx-wrap">
            <label className="ctx" style={{ cursor: "default" }}>
              <span className="l"><span className="av"><Building2 size={16} /></span>
                <span className="who"><b>Active school</b>
                  <select className="input sm" aria-label="Active school" value={user?.active_school_id ?? ""} style={{ marginTop: 4, padding: "4px 8px", fontSize: 12 }}
                    onChange={async (e) => { setSchoolError(""); try { await selectSchool(e.target.value); } catch (err) { setSchoolError((err as Error).message); } }}>
                    <option value="" disabled>Select a school</option>
                    {schools.map((m) => <option key={m.school_id} value={m.school_id}>{m.school_name}</option>)}
                  </select>
                  {schoolError ? <span role="alert" className="cri-c" style={{ textTransform: "none", letterSpacing: 0 }}>{schoolError}</span> : null}
                </span>
              </span>
            </label>
          </div>
        ) : null}
        <ContextSwitcher persona={p} />

        <nav aria-label="Main">
          {primary.map(link)}
          <div className="side-sec">School desk</div>
          {desk.map(link)}
          {p === "teacher" ? <span className="nav-i" aria-disabled="true" title="Only leadership and families can open the timetable"><CalendarDays size={20} strokeWidth={2} /><span>Timetable</span></span> : null}
        </nav>

        <HelpButton>
          <b>Front office</b>
          <span>Attendance, leave and timetable questions go to the school office. Decisions about leave are made by leadership and recorded against a name.</span>
          {demoMode ? <span>This is demo data. Password for every demo account: <span className="mono">OmniDemo@2026</span></span> : null}
        </HelpButton>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="left">
            <span className="lbl" style={{ letterSpacing: ".08em" }}>Academic session</span>
            <Pill>{session}</Pill>
            {demoMode ? <Pill kind="soft">Demo data</Pill> : null}
          </div>
          <div className="right" ref={menuRef}>
            <Link to="/notifications" className="icon-btn" aria-label={unread.data ? `${unread.data} unread notifications` : "Notifications"}>
              <Bell size={22} strokeWidth={2} />{unread.data ? <span className="dot" /> : null}
            </Link>
            <button className="user-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
              <span className="av"><User size={18} strokeWidth={2} /></span>
              <span className="who"><b>{user?.display_name}</b><span>{PERSONA_LABEL[p]}</span></span>
            </button>
            {menu ? (
              <div className="user-menu" role="menu">
                <div className="hd" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="av" style={{ background: "var(--brand)", color: "var(--brand-on)" }}>{initials}</span>
                  <div style={{ minWidth: 0 }}><div className="t-llg" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.display_name}</div><div className="lbl">{user?.username}</div></div>
                </div>
                <button role="menuitem" onClick={() => { toggle(); }}>{isDark ? <Sun size={16} /> : <Moon size={16} />}{isDark ? "Light theme" : "Dark theme"}</button>
                <button role="menuitem" onClick={() => { setMenu(false); void logout(); }}><LogOut size={16} />Sign out</button>
                <div style={{ padding: "8px 10px 4px", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--faint)" }}><CheckCircle2 size={12} />Signed in via school membership</div>
              </div>
            ) : null}
          </div>
        </header>
        <main className="body"><Outlet /></main>
      </div>
    </div>
  );
}
