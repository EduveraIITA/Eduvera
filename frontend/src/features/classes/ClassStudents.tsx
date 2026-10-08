import { LayoutGrid, List, Search } from "lucide-react";
import { useState } from "react";
import type { TeacherRosterStudent } from "../operations/api";

const statusNames = { present: "Present", absent: "Absent", late: "Late", half_day: "Half day", excused: "Excused" };
export function ClassStudents({ roster }: { roster: TeacherRosterStudent[] }) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "gallery">(() => {
    try { return localStorage.getItem("teacher-students-view") === "gallery" ? "gallery" : "list"; } catch { return "list"; }
  });
  const changeView = (next: "list" | "gallery") => {
    setView(next);
    try { localStorage.setItem("teacher-students-view", next); } catch { /* Storage may be disabled; the toggle still works. */ }
  };
  const students = [...roster].sort((a, b) => a.roll_number - b.roll_number).filter(s => `${s.name} ${s.roll_number} ${s.admission_number}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section aria-label="Students" className="classes-students">
    <label className="classes-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Find a student</span><input type="search" placeholder="Name, roll or admission number" value={search} onChange={e => setSearch(e.target.value)} /></label>
    <div className="classes-student-toolbar"><p className="classes-caption" aria-live="polite">{search ? `${students.length} of ${roster.length}` : roster.length} students</p>
      <div className="classes-view-toggle" role="group" aria-label="Student view">
        <button type="button" aria-label="List view" title="List view" aria-pressed={view === "list"} onClick={() => changeView("list")}><List size={20} aria-hidden="true" /></button>
        <button type="button" aria-label="Gallery view" title="Gallery view" aria-pressed={view === "gallery"} onClick={() => changeView("gallery")}><LayoutGrid size={20} aria-hidden="true" /></button>
      </div>
    </div>
    {students.length ? <ul className={view === "gallery" ? "classes-gallery" : "classes-list"} aria-label="Class roster">{students.map(s => <li className={`classes-student classes-student--${s.status ?? "unmarked"}`} key={s.id}>
      <span className="classes-portrait"><span className="classes-avatar">{s.avatar_url ? <img src={s.avatar_url} alt="" loading="lazy" /> : s.name.split(/\s+/).map(p => p[0]).join("").slice(0, 2)}</span>{view === "gallery" ? <b className="classes-roll" aria-label={`Roll ${s.roll_number}`}>{s.roll_number}</b> : null}</span>
      <span className="classes-student__name"><strong>{s.name}</strong>{view === "list" ? <small>Roll {s.roll_number} · {s.admission_number}</small> : null}</span>
      <span className={`classes-mark classes-mark--${s.status ?? "unmarked"}`}>{s.status ? statusNames[s.status] : "Not marked"}</span>
    </li>)}</ul> : <p className="classes-empty">{roster.length ? "No students match your search." : "No students enrolled for this date."}</p>}
  </section>;
}
