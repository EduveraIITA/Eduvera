import { BookOpenCheck } from "lucide-react";
import type { PrincipalTimetableResponse } from "../../features/operations/api";

const hours = (minutes: number) => `${Math.round(minutes / 6) / 10}h`;

export function TimetableCoverage({ rows, subjects, onSelect }: {
  rows: PrincipalTimetableResponse["coverage"];
  subjects: PrincipalTimetableResponse["subjects"];
  onSelect: (id: string) => void;
}) {
  return <section className="timetable-builder__coverage" aria-label="Subject coverage">
    <header><p>Expected teaching time for each subject.</p></header>
    {rows.length ? <ul>{rows.map((row) => {
      const subject = subjects.find((item) => item.id === row.subject_id);
      if (!subject) return null;
      const gap = row.target_minutes === null ? null : row.target_minutes - row.projected_minutes;
      return <li key={row.subject_id}><button type="button" onClick={() => onSelect(row.subject_id)}>
        <span className="timetable-builder__coverage-copy"><strong>{subject.name}</strong><small>{hours(row.projected_minutes)} projected{row.target_minutes !== null ? ` of ${hours(row.target_minutes)}` : ` · ${row.weekly_periods} per week`}</small></span>
        <span className={`timetable-builder__coverage-status ${gap === null ? "is-unset" : gap > 0 ? "is-gap" : "is-ready"}`}>{gap === null ? "Set target" : gap > 0 ? `${hours(gap)} short` : "On target"}</span>
      </button></li>;
    })}</ul> : <div className="timetable-builder__empty-day"><BookOpenCheck size={24} /><h2>No subjects available</h2><p>Add subjects in school records before setting targets.</p></div>}
  </section>;
}
