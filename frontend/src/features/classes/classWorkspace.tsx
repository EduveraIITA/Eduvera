import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { schoolDateToday } from "../../lib/schoolTime";
import { getTeacherHome, type TeacherClassSummary } from "../operations/api";

export function useClasses() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(Date.parse(requested)) && new Date(requested).toISOString().slice(0, 10) === requested ? requested : schoolDateToday();
  const home = useQuery({ queryKey: ["teacher-home", date], queryFn: () => getTeacherHome(date) });
  const setDate = (value: string) => { const next = new URLSearchParams(params); next.set("date", value); setParams(next); };
  return { date, setDate, home, params, setParams };
}

export function classStatus(cls: TeacherClassSummary) {
  if (cls.submission_authorized === false) return "Attendance needs review";
  if (cls.submission_status === "locked") return "Attendance locked";
  if (cls.submission_status === "submitted") return "Attendance submitted";
  if (cls.instructional === false || cls.student_count === 0 || cls.periods_today === 0) return "No attendance due";
  if (cls.date_open === false) return "Upcoming";
  if (cls.can_mark === false) return "Attendance · view only";
  return cls.marked_count > 0 || cls.submission_status === "in_progress" ? `${cls.marked_count}/${cls.student_count} marked` : "Attendance not started";
}

export function ClassLoadState({ loading = false, label, retry }: { loading?: boolean; label: string; retry?: () => void }) {
  return <div className="classes-load" role={loading ? "status" : "alert"} aria-busy={loading || undefined}>
    <p>{label}</p>{loading ? <div className="classes-skeleton" aria-hidden="true"><span /><span /><span /></div> : retry ? <button type="button" onClick={retry}>Try again</button> : null}
  </div>;
}
