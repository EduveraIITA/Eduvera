import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { schoolDateToday } from "../../lib/schoolTime";
import { FollowupInbox } from "../coordination/FollowupInbox";
import { getPrincipalHome } from "../operations/api";
import "./principal-home.css";

function selectedDate(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
  }
  return schoolDateToday();
}

export function PrincipalFollowupsPage() {
  const [params] = useSearchParams();
  const date = selectedDate(params.get("date"));
  return <OperationsShell portal="principal" active="home" title="Attendance follow-ups" backTo={`/principal?date=${date}`}>
    <div className="principal-home-detail"><FollowupInbox context="staff" showHeading={false} /></div>
  </OperationsShell>;
}

export function PrincipalAttendanceThresholdsPage() {
  const [params] = useSearchParams();
  const date = selectedDate(params.get("date"));
  const query = useQuery({ queryKey: ["principal-home", date], queryFn: () => getPrincipalHome(date) });
  const students = query.data?.exceptions ?? [];
  const label = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${date}T12:00:00+05:30`));
  return <OperationsShell portal="principal" active="home" title="Below attendance minimum" backTo={`/principal?date=${date}`}>
    <section className="principal-home-detail" aria-label="Students below the school attendance minimum">
      <p className="principal-home-detail__intro">Term attendance through {label}. Based on at least 5 recorded days; missing records are not absences.</p>
      {query.isPending ? <p role="status">Loading attendance…</p> : query.isError ? <div className="principal-home__notice" role="alert"><span>Attendance couldn’t load.</span><button type="button" onClick={() => void query.refetch()}>Retry</button></div> : <>
        <div className="principal-home__group"><ul className="principal-home__rows">{students.map(student => <li key={student.id}>
          <Link to={`/principal/attendance?class_section_id=${encodeURIComponent(student.class_section_id)}&date=${date}`} aria-label={`Review ${student.name}, ${student.percentage}% attendance`}>
            <span className="principal-home__row-copy"><strong>{student.name}</strong><small>{student.class_name} · {student.admission_number}</small><small>{student.recorded_days} recorded days</small></span>
            <span className="principal-home-detail__score"><strong>{student.percentage}%</strong><small>Minimum {student.threshold}%</small></span><ChevronRight size={16} aria-hidden="true" />
          </Link>
        </li>)}</ul>{!students.length ? <p className="principal-home__notice">No students below the minimum in these records.</p> : null}</div>
        {students.length === 20 ? <p className="principal-home__notice">Showing the 20 lowest attendance percentages.</p> : null}
      </>}
    </section>
  </OperationsShell>;
}
