import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, ClipboardList, Clock, Timer, UserX, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { staffApi, type AttendanceStatus } from "../features/staff";
import { useAuth } from "../lib/auth";
import { Empty, IconSq, Initials, PageTitle, Pill, Skeleton, Stat, Status, Tabs, attendanceTone, fmtDate, hm, submissionTone, today, useToast } from "../components/ui";

/* ---------- class list ---------- */
interface ClassRow { id: string; name: string; room: string; detail: string; marked: number; total: number; attending: number; absent: number; status: "not_started" | "in_progress" | "submitted" }

export function AttendanceIndex() {
  const { persona } = useAuth();
  const [date, setDate] = useState(today());
  const [filter, setFilter] = useState<"all" | "open" | "submitted">("all");
  const teacher = useQuery({ queryKey: ["teacher-home", date], queryFn: () => staffApi.teacherHome(date), enabled: persona === "teacher" });
  const principal = useQuery({ queryKey: ["principal-home", date], queryFn: () => staffApi.principalHome(date), enabled: persona === "principal" });
  const q = persona === "principal" ? principal : teacher;
  // The two endpoints shape a class differently; flatten to one row.
  const classes: ClassRow[] = persona === "principal"
    ? (principal.data?.classes ?? []).map((c) => ({ id: c.id, name: c.name, room: c.room_number, detail: `${c.timetable_slots} period${c.timetable_slots === 1 ? "" : "s"} today${c.unassigned_slots ? ` · ${c.unassigned_slots} without a teacher` : ""}`, marked: c.marked_count, total: c.student_count, attending: c.attending_count, absent: c.absent_count, status: c.submission_status }))
    : (teacher.data?.classes ?? []).map((c) => ({ id: c.class_section_id, name: c.class_name, room: c.room_number, detail: `${hm(c.starts_at)}–${hm(c.ends_at)}${c.subjects?.length ? ` · ${c.subjects.join(", ")}` : ""}`, marked: c.marked_count, total: c.student_count, attending: c.attending_count, absent: c.absent_count, status: c.submission_status }));
  const shown = classes.filter((c) => filter === "all" || (filter === "open" ? c.status !== "submitted" : c.status === "submitted"));
  const schoolDay = persona === "principal" ? (principal.data?.classes ?? []).some((c) => c.timetable_slots > 0) : classes.length > 0;
  const open = schoolDay ? classes.filter((c) => c.status !== "submitted").length : 0;
  const marked = classes.reduce((n, c) => n + c.marked, 0);
  const attending = classes.reduce((n, c) => n + c.attending, 0);
  const absent = classes.reduce((n, c) => n + c.absent, 0);
  const weekend = [0, 6].includes(new Date(`${date}T00:00:00`).getDay());

  return (
    <>
      <PageTitle icon={ClipboardCheck} eyebrow={<>Attendance<span className="sep" />{fmtDate(date)}</>} title="Registers"
        sub={!schoolDay ? `No periods are timetabled for ${fmtDate(date, { weekday: "long" })}.` : classes.length ? `${classes.length} classes · ${open ? `${open} still open` : "all submitted"} · ${marked ? `${Math.round((attending / marked) * 100)}% attending of ${marked} marked` : "nothing marked yet"}.` : "Every class, every register."}
        actions={<>
          <Tabs value={filter} onChange={setFilter} items={[{ id: "all", label: "All" }, { id: "open", label: "Open", count: open }, { id: "submitted", label: "Submitted" }]} />
          <label className="field inline"><span className="lbl">Date</span><input className="input sm" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} /></label>
        </>} />
      {persona === "principal" && classes.length ? (
        <div className="grid4">
          <Stat label="Registers submitted" icon={ClipboardCheck} value={classes.length - open} unit={`/ ${classes.length}`} tone={open ? "cri" : "pos"} note={open ? `${open} still open` : "all classes in"} />
          <Stat label="Marked" icon={Users} value={marked} unit={`/ ${classes.reduce((n, c) => n + c.total, 0)}`} tone="inf" note="students with a mark today" />
          <Stat label="Attending" icon={CheckCircle2} value={marked ? `${Math.round((attending / marked) * 100)}%` : "—"} tone="pos" note={`${attending} present or late`} />
          <Stat label="Absent" icon={UserX} value={absent} tone={absent ? "cri" : "pos"} note={absent ? "across all classes" : "nobody missing"} />
        </div>
      ) : null}
      {q.isPending ? <Skeleton h={260} /> : shown.length === 0 ? <div className="card"><Empty>{classes.length ? "No registers match this filter." : weekend ? "No school on this date. Pick a weekday above." : "No classes on this date. Pick another day above."}</Empty></div> : (
        <div className="grid2 even" style={{ gap: 12 }}>
          {shown.map((c) => (
            <Link className="card hov" key={c.id} to={`/attendance/${c.id}?date=${date}`} style={{ padding: 20, display: "flex", gap: 16, alignItems: "flex-start", color: "inherit", textDecoration: "none" }}>
              <IconSq icon={ClipboardList} kind={!schoolDay ? "high" : c.status === "submitted" ? "pos" : c.status === "in_progress" ? "cau" : "cri"} size="lg" />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><span className="t-hsm">{c.name}</span>{!schoolDay ? <Status tone="neu">No school</Status> : <Status tone={submissionTone(c.status)}>{c.status === "submitted" ? "Submitted" : c.status === "in_progress" ? "In progress" : "Not started"}</Status>}</div>
                <span className="t-bsm ink2">Room {c.room} · {c.detail}</span>
                <div className="bar" style={{ marginTop: 2 }}><i className={c.status === "submitted" ? "pos" : c.marked ? "cau" : ""} style={{ width: `${c.total ? (c.marked / c.total) * 100 : 0}%` }} /></div>
                <div style={{ display: "flex", gap: 12 }} className="t-lmd ink2">
                  <span><b style={{ color: "var(--ink)" }}>{c.marked}</b> / {c.total} marked</span>
                  <span><b style={{ color: "var(--ink)" }}>{c.attending}</b> present</span>
                  <span style={{ color: c.absent ? "var(--cri)" : undefined }}><b>{c.absent}</b> absent</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- one register ---------- */
const MARKS: Array<{ code: AttendanceStatus; label: string; cls?: string }> = [
  { code: "present", label: "Present" },
  { code: "absent", label: "Absent", cls: "g" },
  { code: "late", label: "Late", cls: "w" },
  { code: "excused", label: "Excused" },
];

export function RegisterPage() {
  const { classId = "" } = useParams();
  const [params] = useSearchParams();
  const date = params.get("date") ?? today();
  const qc = useQueryClient();
  const toast = useToast();
  const { persona } = useAuth();

  const reg = useQuery({ queryKey: ["register", classId, date], queryFn: () => staffApi.teacherAttendance(classId, date), enabled: Boolean(classId) });
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!reg.data) return;
    const initial: Record<string, AttendanceStatus> = {};
    for (const s of reg.data.roster) if (s.status) initial[s.id] = s.status;
    setMarks(initial); setDirty(false);
  }, [reg.data]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0, half_day: 0, unmarked: 0 };
    for (const s of reg.data?.roster ?? []) { const m = marks[s.id]; if (m) c[m] += 1; else c.unmarked += 1; }
    return c;
  }, [marks, reg.data]);

  const submit = useMutation({
    mutationFn: () => staffApi.bulkAttendance({
      class_section_id: classId, date,
      records: Object.entries(marks).map(([student_id, status]) => ({ student_id, status })),
    }),
    onSuccess: (data) => {
      qc.setQueryData(["register", classId, date], data);
      void qc.invalidateQueries({ queryKey: ["teacher-home"] });
      void qc.invalidateQueries({ queryKey: ["principal-home"] });
      setDirty(false);
      toast(`${Object.keys(marks).length} records written in one request.`);
    },
    onError: (e: Error) => toast(e.message, true),
  });

  if (reg.isPending) return <><Skeleton h={60} w={420} /><Skeleton h={90} /><Skeleton h={420} /></>;
  if (reg.isError || !reg.data) return <Empty>Could not load this register. {String((reg.error as Error)?.message ?? "")}</Empty>;

  const d = reg.data;
  const all = d.roster.length;
  const allMarked = counts.unmarked === 0 && all > 0;
  const submittedAlready = d.roster.every((s) => s.status);
  const canEdit = persona === "teacher" || persona === "principal";
  const period = d.periods[0];

  function mark(id: string, code: AttendanceStatus) { setMarks((m) => ({ ...m, [id]: code })); setDirty(true); }
  function markAll(code: AttendanceStatus) { const m: Record<string, AttendanceStatus> = {}; for (const s of d.roster) m[s.id] = code; setMarks(m); setDirty(true); }

  return (
    <>
      <PageTitle
        icon={ClipboardCheck}
        eyebrow={<><Link to="/attendance">Attendance</Link><span className="sep" />{d.class.term}<span className="sep" />{fmtDate(d.date)}</>}
        title={d.class.name}
        sub={<>Room {d.class.room}{d.class.board ? ` · ${d.class.board}` : ""} · {all} on roll{period ? ` · ${period.display_title} ${hm(period.starts_at)}–${hm(period.ends_at)}` : ""}</>}
        actions={<>
          {submittedAlready && !dirty ? <Status tone="pos">Submitted</Status> : dirty ? <Status tone="cau">Unsaved changes</Status> : <Status tone="cri">Not submitted</Status>}
          <button className="btn outline" onClick={() => markAll("present")} disabled={!canEdit}>Mark all present</button>
          <button className="btn pri" disabled={!allMarked || !dirty || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? "Submitting…" : submittedAlready ? "Save changes" : "Submit register"}</button>
        </>}
      />

      <div className="grid12">
        <div className="col-8 grid4">
          <Stat label="Present" icon={CheckCircle2} value={counts.present} tone="pos" note={all ? `${Math.round(((counts.present + counts.late) / all) * 100)}% attending` : ""} />
          <Stat label="Absent" icon={UserX} value={counts.absent} tone={counts.absent ? "cri" : "pos"} note={counts.absent ? "follow up with families" : "nobody missing"} />
          <Stat label="Late" icon={Clock} value={counts.late} tone={counts.late ? "cau" : "pos"} note={counts.excused ? `${counts.excused} excused` : "0 excused"} />
          <Stat label="Unmarked" icon={Timer} value={counts.unmarked} tone={counts.unmarked ? "cau" : "pos"} note={counts.unmarked ? "still to mark" : "roster complete"} />
        </div>
        <div className="col-4 tile" style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 20, minHeight: "100%" }}>
          <IconSq icon={Users} kind="tint" size="lg" />
          <div className="t-bsm ink2">Submitting writes the whole register in one request. {persona === "principal" ? "You are viewing this as leadership; edits are logged against your name." : "Every mark you change is logged against your name."}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><b><ClipboardList size={18} />Roster</b>{period ? <Pill kind="tint">{period.display_title} · {period.room || d.class.room}</Pill> : null}</div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th className="num" style={{ width: 56 }}>Roll</th><th>Student</th><th>Admission</th><th>Mark</th><th>Last saved</th></tr></thead>
            <tbody>
              {d.roster.map((s) => {
                const m = marks[s.id];
                return (
                  <tr key={s.id} className={m ? undefined : "warn"}>
                    <td className="num ink2">{s.roll_number}</td>
                    <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Initials name={s.name} src={s.avatar_url} /><span className="t-llg">{s.name}</span></div></td>
                    <td className="mono ink2" style={{ fontSize: 12.5 }}>{s.admission_number}</td>
                    <td>
                      <div className="seg" role="group" aria-label={`Mark ${s.name}`}>
                        {MARKS.map((k) => (
                          <button key={k.code} className={k.cls} aria-pressed={m === k.code} onClick={() => mark(s.id, k.code)} disabled={!canEdit}>{k.label}</button>
                        ))}
                      </div>
                    </td>
                    <td>{s.status ? <Status tone={attendanceTone(s.status)}>{s.status[0]!.toUpperCase() + s.status.slice(1).replace("_", " ")}</Status> : <span className="faint t-bsm">Unmarked</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
