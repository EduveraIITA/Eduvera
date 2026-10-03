import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpenCheck,
  Bot,
  CalendarCheck2,
  CalendarRange,
  Clock3,
  Grid2X2,
  ReceiptIndianRupee,
} from "lucide-react";
import { StudentShell, type StudentNavKey } from "./StudentShell";
import "./student-modules.css";

type ModuleId = "launcher" | "fees" | "diary";

const modules = [
  { id: "calendar", name: "Calendar", description: "Your month: school days, leave and each day's periods", icon: CalendarRange, path: "/student/calendar", tone: "blue" },
  { id: "attendance", name: "Attendance", description: "Live aggregate, subject quotas, and eligibility", icon: CalendarCheck2, path: "/student/attendance", tone: "blue" },
  { id: "copilot", name: "Attendance Copilot", description: "Ask policy and projection questions using your own data", icon: Bot, path: "/student/copilot", tone: "teal" },
  { id: "classes", name: "Classes & Leave", description: "Timetable, leave applications, and approval status", icon: BookOpenCheck, path: "/student/timetable", tone: "violet" },
  { id: "events", name: "Events & Activities", description: "Invitations, schedules, responses, consent, and preparation", icon: CalendarRange, path: "/student/events", tone: "teal" },
  { id: "fees", name: "Fees", description: "Invoices, receipts, and payment history", icon: ReceiptIndianRupee, path: "/student/fees", tone: "amber" },
  { id: "diary", name: "Student Diary", description: "Homework, teacher notes, and announcements", icon: Clock3, path: "/student/diary", tone: "rose" },
] as const;

export function StudentModulesPage({ focus = "launcher" }: { focus?: ModuleId }) {
  const navigate = useNavigate();
  const selected = focus === "launcher" ? null : modules.find((item) => item.id === focus);
  const activeNav: StudentNavKey = focus === "fees" ? "fees" : focus === "diary" ? "diary" : "launcher";

  return (
    <StudentShell activeNav={activeNav} pageTitle={selected ? selected.name : "More"}>
      <div className="student-page-stack module-page">
        {selected ? <section className="module-hero">
          {selected ? <p>{selected.description}. Your school has not enabled this module yet.</p> : null}
          {selected ? <button type="button" onClick={() => navigate("/student/apps")}><Grid2X2 size={17} /> View all modules</button> : null}
        </section> : null}

        <section className="module-catalog" aria-labelledby="module-catalog-title">
          <header><div><h2 id="module-catalog-title">Services</h2></div><b>{modules.length} available</b></header>
          <div className="module-grid">
            {modules.map((item) => {
              const Icon = item.icon;
              return (
                <article className={`module-tile module-tile--${item.tone}`} key={item.id}>
                  <div className="module-tile__top">
                    <span className="module-tile__icon"><Icon size={21} /></span>
                  </div>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                  <button type="button" onClick={() => navigate(item.path)} aria-label={`Open ${item.name}`}>
                    Open <ArrowRight size={15} />
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </StudentShell>
  );
}
