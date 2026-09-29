import { useQuery } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, ClipboardCheck, Clock, Home, Timer, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { staffApi } from "../features/staff";
import { Empty, IconSq, PageTitle, Pill, SectionTitle, Skeleton, Stat, Status, fmtDate, hm, submissionTone, today } from "../components/ui";

const hhmm = () => new Date().toTimeString().slice(0, 5);

/* Teaching opens on the day: what is next, and what is still outstanding from you.
   No school-wide percentages — that is not this person's job. */
export function TeacherHome() {
  const [date, setDate] = useState(today());
  const home = useQuery({ queryKey: ["teacher-home", date], queryFn: () => staffApi.teacherHome(date) });

  if (home.isPending) return <><Skeleton h={60} w={420} /><Skeleton h={160} /><Skeleton h={320} /></>;
  if (home.isError || !home.data) return <Empty>Could not load your day. {String((home.error as Error)?.message ?? "")}</Empty>;

  const d = home.data;
  const open = d.classes.filter((c) => c.submission_status !== "submitted");
  const next = open[0];
  const weekday = new Date(`${date}T00:00:00`).getDay() || 7;
  const todaySlots = d.weekly_timetable.filter((s) => s.weekday === weekday).sort((a, b) => a.period_number - b.period_number);
  const now = hhmm();
  const isToday = date === today();
  const current = isToday ? todaySlots.find((s) => hm(s.starts_at) <= now && now < hm(s.ends_at)) : undefined;
  const upcoming = isToday ? todaySlots.find((s) => hm(s.starts_at) > now) : undefined;
  const students = d.classes.reduce((n, c) => n + c.student_count, 0);

  return (
    <>
      <PageTitle
        icon={Home}
        eyebrow={<>Teaching<span className="sep" />{fmtDate(d.date)}<span className="sep" />{d.teacher.name}</>}
        title={isToday ? "Your day" : "Your classes"}
        sub={<>{d.classes.length} class{d.classes.length === 1 ? "" : "es"} · {students} students · {todaySlots.length} period{todaySlots.length === 1 ? "" : "s"} on the timetable.</>}
        actions={<label className="field inline"><span className="lbl">Date</span><input className="input sm" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} /></label>}
      />

      {d.classes.length === 0 ? (
        <div className="banner"><div className="glow" /><div className="in"><div><Pill kind="soft">No classes on this date</Pill><h1 style={{ marginTop: 8 }}>Nothing scheduled</h1><p className="t-bmd ink2">You have {d.weekly_timetable.length} periods across the week. Pick another date to open a register.</p></div></div></div>
      ) : next ? (
        <div className="banner cau"><div className="glow" /><div className="in">
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <IconSq icon={ClipboardCheck} kind="cau" size="xl" />
            <div>
              <Status tone="cau">Register not submitted</Status>
              <h1 style={{ marginTop: 8 }}>{next.class_name} · {open.length} of {d.classes.length} register{d.classes.length === 1 ? "" : "s"} still open</h1>
              <p className="t-bmd ink2">{hm(next.starts_at)}–{hm(next.ends_at)} in room {next.room_number} · {next.marked_count} of {next.student_count} marked so far.</p>
            </div>
          </div>
          <div className="btnrow"><Link className="btn pri" to={`/attendance/${next.class_section_id}?date=${date}`}>Mark register</Link><Link className="btn outline" to="/attendance">All classes</Link></div>
        </div></div>
      ) : (
        <div className="banner pos"><div className="in">
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <IconSq icon={CheckCircle2} kind="pos" size="xl" />
            <div><Status tone="pos">Nothing outstanding</Status><h1 style={{ marginTop: 8 }}>You are caught up</h1><p className="t-bmd ink2">Every register for this date is submitted. Changes from here are recorded as amendments.</p></div>
          </div>
        </div></div>
      )}

      <div className="grid12">
        <div className="col-8 panel">
          <SectionTitle icon={Timer} title="Today's timetable" aside={current ? <span className="pulse brand"><span className="d" />Period {current.period_number} is live</span> : <span className="lbl">{todaySlots.length} periods</span>} />
          {current || upcoming ? (
            <div className="tile" style={{ padding: 20, gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Pill kind={current ? "brand" : "high"}>{current ? "Live period" : "Up next"}</Pill>
                <span className="t-llg">Period {(current ?? upcoming)!.period_number} • {hm((current ?? upcoming)!.starts_at)} – {hm((current ?? upcoming)!.ends_at)}</span>
                {current ? <span className="t-lmd brand-c" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={16} />until {hm(current.ends_at)}</span> : null}
              </div>
              <h4 className="t-hlg">{(current ?? upcoming)!.class_name} · {(current ?? upcoming)!.subject_name}</h4>
              <p className="t-bmd ink2">Room {(current ?? upcoming)!.room}</p>
            </div>
          ) : null}
          {todaySlots.length === 0 ? <Empty>No periods scheduled today.</Empty> : (
            <div className="col xs">{todaySlots.map((s) => {
              const cls = d.classes.find((c) => c.class_section_id === s.class_section_id);
              return (
                <div className="tile md row-tile" key={s.id} style={{ alignItems: "center", background: current?.id === s.id ? "var(--brand-tint)" : undefined }}>
                  <div style={{ width: 56 }}><div className="t-llg">{hm(s.starts_at)}</div><div className="lbl" style={{ color: "var(--muted)" }}>P{s.period_number}</div></div>
                  <div className="rowtxt"><b>{s.class_name}</b><span>{s.subject_name} · room {s.room}</span></div>
                  {cls ? <Status tone={submissionTone(cls.submission_status)}>{cls.submission_status === "submitted" ? "Marked" : cls.submission_status === "in_progress" ? "Partial" : "Not marked"}</Status> : null}
                </div>
              );
            })}</div>
          )}
        </div>

        <div className="col-4 col">
          <div className="panel tight">
            <SectionTitle small icon={Users} title="Your classes" />
            <div className="col xs">
              {d.classes.map((c) => (
                <Link className="tile md hov row-tile" key={c.class_section_id} to={`/attendance/${c.class_section_id}?date=${date}`} style={{ alignItems: "center" }}>
                  <IconSq icon={BookOpen} kind={c.submission_status === "submitted" ? "pos" : c.submission_status === "in_progress" ? "cau" : "cri"} />
                  <div className="rowtxt"><b>{c.class_name}</b><span>{c.student_count} students · {c.attending_count} present · {c.absent_count} absent{c.subjects?.length ? ` · ${c.subjects.join(", ")}` : ""}</span></div>
                  <Status tone={submissionTone(c.submission_status)}>{c.submission_status === "submitted" ? "Submitted" : c.submission_status === "in_progress" ? "In progress" : "Open"}</Status>
                </Link>
              ))}
            </div>
          </div>
          <div className="grid2 even" style={{ gap: 12 }}>
            <Stat tile label="Registers" icon={ClipboardCheck} value={d.classes.length - open.length} unit={`/ ${d.classes.length}`} tone={open.length ? "cri" : "pos"} note={open.length ? `${open.length} open` : "all submitted"} />
            <Stat tile label="Students" icon={Users} value={students} note="across your classes" />
          </div>
        </div>
      </div>
    </>
  );
}
