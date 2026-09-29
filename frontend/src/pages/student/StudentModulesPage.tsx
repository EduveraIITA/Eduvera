import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpenCheck,
  Bot,
  CalendarCheck2,
  CalendarRange,
  Clock3,
  Grid2X2,
  LockKeyhole,
  ReceiptIndianRupee,
  Sparkles,
} from "lucide-react";
import { StudentShell, type StudentNavKey } from "./StudentShell";
import "./student-modules.css";

type ModuleId = "launcher" | "fees" | "diary";

const modules = [
  { id: "attendance", name: "Attendance", description: "Live aggregate, subject quotas, and eligibility", icon: CalendarCheck2, status: "Live", path: "/student/attendance", tone: "blue" },
  { id: "copilot", name: "Attendance Copilot", description: "Ask policy and projection questions using your own data", icon: Bot, status: "Live", path: "/student/copilot", tone: "teal" },
  { id: "classes", name: "Classes & Leave", description: "Timetable, leave applications, and approval status", icon: BookOpenCheck, status: "Live", path: "/student/timetable", tone: "violet" },
  { id: "events", name: "Events & Activities", description: "Invitations, schedules, responses, consent, and preparation", icon: CalendarRange, status: "Live", path: "/student/events", tone: "teal" },
  { id: "fees", name: "Fees", description: "Invoices, receipts, and payment history", icon: ReceiptIndianRupee, status: "Planned", path: null, tone: "amber" },
  { id: "diary", name: "Student Diary", description: "Homework, teacher notes, and announcements", icon: Clock3, status: "Live", path: "/student/diary", tone: "rose" },
] as const;

export function StudentModulesPage({ focus = "launcher" }: { focus?: ModuleId }) {
  const navigate = useNavigate();
  const selected = focus === "launcher" ? null : modules.find((item) => item.id === focus);
  const activeNav: StudentNavKey = focus === "fees" ? "fees" : focus === "diary" ? "diary" : "launcher";

  return (
    <StudentShell activeNav={activeNav} section="School OS">
      <div className="student-page-stack module-page">
        <section className="module-hero">
          <span className="module-hero__eyebrow"><Sparkles size={14} /> Your school workspace</span>
          <h1>{selected ? `${selected.name} is on the roadmap` : "Everything for school, in one place"}</h1>
          <p>{selected ? `${selected.description}. This module will appear here when your school enables it.` : "Open today's connected tools and see what's coming next as Edura grows into your complete School OS."}</p>
          {selected ? <button type="button" onClick={() => navigate("/student/apps")}><Grid2X2 size={17} /> View all modules</button> : null}
        </section>

        <section className="module-catalog" aria-labelledby="module-catalog-title">
          <header><div><span>Student workspace</span><h2 id="module-catalog-title">Modules</h2></div><b>{modules.filter((item) => item.status === "Live").length} live</b></header>
          <div className="module-grid">
            {modules.map((item) => {
              const Icon = item.icon;
              const live = item.path !== null;
              return (
                <article className={`module-tile module-tile--${item.tone}`} key={item.id}>
                  <div className="module-tile__top">
                    <span className="module-tile__icon"><Icon size={21} /></span>
                    <span className={live ? "module-status is-live" : "module-status"}>{live ? <span /> : <LockKeyhole size={11} />}{item.status}</span>
                  </div>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                  {live ? (
                    <button type="button" onClick={() => navigate(item.path)} aria-label={`Open ${item.name}`}>
                      Open module <ArrowRight size={15} />
                    </button>
                  ) : (
                    <span className="module-tile__planned">Available in a future school release</span>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </StudentShell>
  );
}
