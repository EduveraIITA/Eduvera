import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, CalendarX2, ClipboardCheck, ClipboardList, LayoutGrid, Timer, UserX } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { staffApi } from "../features/staff";
import { Empty, IconSq, PageTitle, Pill, SectionTitle, Skeleton, Stat, Status, fmtDate, submissionTone, today } from "../components/ui";

/* Leadership opens on exceptions, not on a generic dashboard:
   what is missing, who is below threshold, what needs a decision. */
export function PrincipalHome() {
  const [date, setDate] = useState(today());
  const home = useQuery({ queryKey: ["principal-home", date], queryFn: () => staffApi.principalHome(date) });
  const leaves = useQuery({ queryKey: ["leaves", "authorized"], queryFn: () => staffApi.leaves("authorized") });

  if (home.isPending) return <><Skeleton h={60} w={520} /><div className="grid4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={118} />)}</div><Skeleton h={360} /></>;
  if (home.isError || !home.data) return <Empty>Could not load the school summary. {String((home.error as Error)?.message ?? "")}</Empty>;

  const d = home.data;
  const s = d.summary;
  // A date with no timetabled periods is not a school day; registers are not "missing" then.
  const schoolDay = d.classes.some((c) => c.timetable_slots > 0);
  const missing = schoolDay ? d.classes.filter((c) => c.submission_status !== "submitted") : [];
  const pendingLeaves = leaves.data?.results ?? [];
  const attention = missing.length + pendingLeaves.length;
  const isToday = date === today();
  const weekday = fmtDate(d.date, { weekday: "long" });

  return (
    <>
      <PageTitle
        icon={LayoutGrid}
        eyebrow={<>Leadership<span className="sep" />{fmtDate(d.date)}<span className="sep" />{s.students} students on roll</>}
        title={attention ? `${attention} thing${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} your attention${isToday ? " today" : ""}` : schoolDay ? `Nothing is waiting on you${isToday ? " today" : ""}` : `No school on ${weekday}`}
        sub={<>{schoolDay ? `${d.principal.name} · registers, leave decisions and attendance exceptions across ${s.classes_total} classes.` : `${d.principal.name} · no periods are timetabled for ${weekday}; leave decisions and attendance exceptions still apply.`}</>}
        actions={<label className="field inline"><span className="lbl">Date</span><input className="input sm" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} /></label>}
      />

      <div className="grid4">
        <Stat label={isToday ? "Attendance today" : "Attendance"} icon={BadgeCheck} value={s.marked ? `${s.attendance_percentage.toFixed(1)}%` : "—"} tone={!s.marked ? undefined : s.attendance_percentage < 90 ? "cau" : "pos"} note={s.marked ? <>{s.attending} of {s.marked} marked present</> : schoolDay ? "nothing marked yet" : "no school"} />
        <Stat label="Registers submitted" icon={ClipboardCheck} value={s.classes_submitted} unit={`/ ${s.classes_total}`} tone={!schoolDay ? undefined : missing.length ? "cri" : "pos"} note={!schoolDay ? "not a school day" : missing.length ? <>{missing.length} still open</> : "All classes in"} />
        <Stat label="Absent" icon={UserX} value={s.absent} tone={s.absent ? "cri" : "pos"} note={<>{s.late} arrived late</>} />
        <Stat label="Below threshold" icon={AlertTriangle} value={d.exceptions.length} tone={d.exceptions.length ? "cau" : "pos"} note="students this term" />
      </div>

      <div className="grid12">
        <div className="col-8 col">
          <div className="card">
            <div className="card-h"><b><ClipboardList size={18} />Registers</b><Link to="/attendance" className="t-lmd">{d.classes.length} classes</Link></div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Class</th><th>Room</th><th className="num">Roll</th><th className="num">Present</th><th className="num">Absent</th><th className="num">Attendance</th><th>Register</th><th></th></tr></thead>
                <tbody>
                  {d.classes.map((c) => (
                    <tr key={c.id}>
                      <td className="t-llg">{c.name}</td>
                      <td className="ink2">{c.room_number}</td>
                      <td className="num">{c.student_count}</td>
                      <td className="num">{c.attending_count}</td>
                      <td className="num" style={{ color: c.absent_count ? "var(--cri)" : undefined }}>{c.absent_count}</td>
                      <td className="num">{c.marked_count ? `${c.attendance_percentage.toFixed(1)}%` : <span className="faint">—</span>}</td>
                      <td>{c.timetable_slots === 0 ? <Status tone="neu">No periods</Status> : <Status tone={submissionTone(c.submission_status)}>{c.submission_status === "submitted" ? "Submitted" : c.submission_status === "in_progress" ? "In progress" : "Not started"}</Status>}</td>
                      <td><Link className="btn sm" to={`/attendance/${c.id}?date=${date}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-4 col">
          <div className="panel tight">
            <SectionTitle small dot={pendingLeaves.length > 0} title="Leave awaiting decision" aside={<Link to="/leave" className="t-lmd">All requests</Link>} />
            {leaves.isPending ? <Skeleton h={64} />
              : pendingLeaves.length === 0 ? <Empty>Nothing waiting on you.</Empty>
              : <div className="col xs">{pendingLeaves.slice(0, 5).map((l) => (
                <Link className="tile md hov row-tile" key={l.id} to={`/leave?focus=${l.id}`} style={{ alignItems: "center" }}>
                  <IconSq icon={CalendarX2} kind="cau" />
                  <div className="rowtxt">
                    <b>{l.student?.display_name ?? l.student?.name ?? l.student_name ?? "Student"} · {l.category_label ?? l.category}</b>
                    <span>{l.class_name ?? l.student?.class_name ? `${l.class_name ?? l.student?.class_name} · ` : ""}{fmtDate(l.starts_on, { day: "numeric", month: "short" })} · {l.duration_days} day{l.duration_days === 1 ? "" : "s"} · authorised by {l.guardian_authorized_by_name ?? "guardian"}</span>
                  </div>
                  <Pill kind="tint">Review</Pill>
                </Link>
              ))}</div>}
          </div>

          <div className="panel tight">
            <SectionTitle small icon={Timer} title="Below attendance threshold" aside={<Pill kind={d.exceptions.length ? "cri" : "pos"}>{d.exceptions.length}</Pill>} />
            {d.exceptions.length === 0 ? <Empty>No student is below the threshold this term.</Empty>
              : <div className="col xs">{d.exceptions.slice(0, 6).map((x) => (
                <div className="tile md row-tile" key={x.id} style={{ alignItems: "center" }}>
                  <Status tone={x.percentage < x.threshold - 10 ? "cri" : "cau"}>{x.percentage.toFixed(1)}%</Status>
                  <div className="rowtxt"><b>{x.name}</b><span>{x.class_name} · <span className="mono">{x.admission_number}</span> · threshold {x.threshold}% · {x.recorded_days} days</span></div>
                </div>
              ))}</div>}
          </div>
        </div>
      </div>
    </>
  );
}
