import { Bell, ChevronRight, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DateNavigation } from "../../components/date-navigation/DateNavigation";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ClassLoadState, classStatus, useClasses } from "./classWorkspace";
import { useAuth } from "../auth/AuthContext";
import { currentStaffMembership, hasStaffPermission } from "../auth/staffAccess";
import { getTeacherDay } from "../day-plans/api";
import { clockLabel } from "../calendar/monthGrid";
import { activityLabel, useClassUpdates } from "./classUpdates";
import "./classes.css";

export default function TeacherClassesPage() {
  const { date, setDate, home } = useClasses();
  const classes = home.data?.classes ?? [];
  const auth = useAuth();
  const member = currentStaffMembership(auth.memberships);
  const day = useQuery({ queryKey: ["school", "day-plans", "teacher", member?.school_id, date], queryFn: () => getTeacherDay(member!.school_id, date), enabled: Boolean(member?.school_id) && hasStaffPermission(member, "timetable.view") && classes.length > 0 });
  const updates = useClassUpdates(date, classes.length > 0);
  return <OperationsShell portal="teacher" active="more" title="My classes">
    <div className="classes-workspace">
      <DateNavigation date={date} view="day" compact onDateChange={setDate} />
      {home.isPending ? <ClassLoadState loading label="Loading your classes" />
        : home.error ? <ClassLoadState label="Could not load your classes." retry={() => void home.refetch()} />
        : !classes.length ? <p className="classes-empty">No classes assigned for this date.</p>
        : <>
          <p className="classes-caption">{classes.length} {classes.length === 1 ? "class" : "classes"} · {classes.reduce((n, c) => n + Number(c.student_count), 0)} students</p>
          {updates.error ? <p className="classes-caption" role="status">Class updates are temporarily unavailable.</p> : null}
          {updates.data?.results.length ? <p className="classes-caption">Activity from the last two weeks</p> : null}
          <ul className="classes-list" aria-label="Your classes">
            {classes.map(cls => {
              const periods = day.data?.periods.filter(p => p.class_section_id === cls.class_section_id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
              const activity = updates.data?.results.filter(item => item.class_section_id === cls.class_section_id) ?? [];
              const label = activityLabel(activity);
              return <li key={cls.class_section_id}>
              <Link className="classes-row" to={`/teacher/classes/${encodeURIComponent(cls.class_section_id)}?date=${date}`}>
                <span className="classes-monogram" aria-hidden="true">{cls.grade}{cls.section}</span>
                <span className="classes-row__content"><strong>{cls.class_name}</strong>
                  <span>{[cls.subjects?.filter(Boolean).join(", "), `${cls.student_count} students`].filter(Boolean).join(" · ")}</span>
                  <span className="classes-row__times"><Clock size={14} aria-hidden="true" />{day.error ? "Lesson times unavailable" : periods ? periods.length ? periods.map(p => `P${p.period_number} ${clockLabel(p.starts_at)}–${clockLabel(p.ends_at)}${p.cancelled ? " (cancelled)" : ""}`).join(" · ") : "No lessons on this date" : cls.starts_at ? `From ${clockLabel(cls.starts_at)}` : "No lesson time available"}</span>
                  {cls.room_number ? <span>Room {cls.room_number}</span> : null}
                  <span className="classes-row__status">{cls.assignment_kind === "substitute" ? "Cover · " : ""}{classStatus(cls)}</span>
                </span>
                <ChevronRight size={20} aria-hidden="true" />
              </Link>
              {label ? <Link className="classes-activity-link" to={`/teacher/classes/${encodeURIComponent(cls.class_section_id)}?date=${date}&section=notes`}><Bell size={15} aria-hidden="true" /><span>{label}{(activity[0]?.total ?? 0) > activity.length ? " · more updates" : ""}</span><ChevronRight size={16} aria-hidden="true" /></Link> : null}
            </li>; })}
          </ul>
        </>}
    </div>
  </OperationsShell>;
}
