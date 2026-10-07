import { Award, Bus, CalendarDays, ClipboardCheck, FileText, Handshake, MessageCircle, MoreHorizontal, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import type { SchoolMembership } from "./AuthContext";
import { hasStaffPermission } from "./staffAccess";
import "./scoped-staff-home.css";

const capabilityLinks = [
  { permission: "departure.collect", label: "Transport journey", detail: "Assigned trip, riders and handovers", path: "/teacher/transport", icon: Bus },
  { permission: "attendance.view", label: "Registers", detail: "Assigned attendance registers", path: "/teacher/attendance", icon: ClipboardCheck },
  { permission: "timetable.view", label: "Timetable", detail: "Published teaching schedule", path: "/teacher/timetable", icon: CalendarDays },
  { permission: "messages.view", label: "Messages", detail: "Permitted school conversations", path: "/teacher/messages", icon: MessageCircle },
  { permission: "events.view", label: "Events", detail: "Assigned activities and sessions", path: "/teacher/events", icon: CalendarDays },
  { permission: "safeguarding.review", label: "Safeguarding", detail: "Assigned welfare concerns", path: "/teacher/safeguarding", icon: ShieldAlert },
  { permission: "assessments.view", label: "Assessments", detail: "Assigned assessments and marking", path: "/teacher/assessments", icon: Award },
  { permission: "reports.comment", label: "Report remarks", detail: "Assigned report-card remarks", path: "/teacher/report-cards", icon: FileText },
] as const;

export function ScopedStaffHomePage({ member }: { member: SchoolMembership }) {
  const links = capabilityLinks.filter((item) => hasStaffPermission(member, item.permission));
  return (
    <OperationsShell portal="teacher" active="home" title="Today" schoolName={member.school_name}>
      <div className="scoped-staff-home">
        <section className="scoped-staff-home__role" aria-labelledby="scoped-work-title">
          <span>Your workspace</span>
          <h2 id="scoped-work-title">Today’s assigned work</h2>
          <p>Only tools activated by your current assignments are shown.</p>
        </section>

        <section className="operations-panel scoped-staff-home__tools" aria-labelledby="scoped-tools-title">
          <header><h2 id="scoped-tools-title">Available today</h2></header>
          <div className="scoped-staff-home__links">
            {links.map(({ label, detail, path, icon: Icon }) => (
              <Link key={path} to={path}>
                <span><Icon size={20} aria-hidden="true" /></span>
                <div><strong>{label}</strong><small>{detail}</small></div>
              </Link>
            ))}
            <Link to="/teacher/responsibilities">
              <span><Handshake size={20} aria-hidden="true" /></span>
              <div><strong>My work</strong><small>Assignments and pending responses</small></div>
            </Link>
          </div>
        </section>

        <Link className="scoped-staff-home__more" to="/teacher/more">
          <MoreHorizontal size={18} aria-hidden="true" />More tools
        </Link>
      </div>
    </OperationsShell>
  );
}
