import { useQuery } from "@tanstack/react-query";
import { ArrowUp, BadgeCheck, BarChart3, Bus, CalendarDays, CheckCircle2, DoorOpen, Flame, FolderCheck, MessageSquare, PlusCircle, Radio, ShieldCheck, Timer } from "lucide-react";
import { Link } from "react-router-dom";
import { familyApi, type AttendanceRecord, type AttendanceSummary, type Student, type SubjectAttendance } from "../features/family";
import { useAuth } from "../lib/auth";
import { Bar, Empty, IconSq, PageTitle, Pill, SectionTitle, Skeleton, Stat, Status, attendanceTone, fmtDate, fmtTime, hm, pctTone, plain } from "../components/ui";
import { ChildSwitcher } from "./FamilyHome";

function streak(records: AttendanceRecord[]): number {
  const sorted = [...records].sort((a, b) => (a.date < b.date ? 1 : -1));
  let n = 0;
  for (const r of sorted) { if (r.status === "present" || r.status === "late") n += 1; else break; }
  return n;
}

/* Bento: the aggregate master card on the left, four granular metrics on the right. */
function Bento({ s, threshold, records }: { s: AttendanceSummary; threshold: number; records?: AttendanceRecord[] }) {
  const pct = s.percentage;
  const safe = pct >= threshold;
  const cushion = Math.max(0, Math.floor((s.present + s.late) - (threshold / 100) * s.total));
  const goal = Math.min(100, Math.max(threshold + 10, Math.ceil(pct / 5) * 5));
  const run = records ? streak(records) : null;
  return (
    <div className="grid12">
      <div className="col-4 panel" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <span className="lbl" style={{ letterSpacing: ".08em" }}>Overall aggregate</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <span className="t-dl">{pct.toFixed(1)}%</span>
              <Pill kind={safe ? "pos" : "cri"}><ArrowUp size={14} style={safe ? undefined : { transform: "rotate(180deg)" }} />{safe ? `+${(pct - threshold).toFixed(1)}%` : `${(pct - threshold).toFixed(1)}%`}</Pill>
            </div>
          </div>
          <IconSq icon={BadgeCheck} kind="tint" size="xl" />
        </div>
        <div className={`callout${safe ? "" : " cau"}`} style={safe ? { background: "var(--sunk)" } : undefined}>
          <ShieldCheck size={20} color={safe ? "var(--pos)" : "var(--cau-ink)"} style={{ flexShrink: 0, marginTop: 2 }} />
          <div><div className="t-lmd">{safe ? "Safe zone" : "Below minimum"}</div><p className="t-bsm ink2" style={{ marginTop: 2 }}>{safe ? `${cushion} day${cushion === 1 ? "" : "s"} of cushion before the ${threshold}% minimum threshold.` : `Needs ${Math.ceil(((threshold / 100) * s.total) - (s.present + s.late))} more attended days to reach ${threshold}%.`}</p></div>
        </div>
        <div className="col" style={{ gap: 4, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }} className="lbl"><span>Min: {threshold}%</span><span className="brand-c">Current: {pct.toFixed(1)}%</span><span>Goal: {goal}%</span></div>
          <div className="bar thick"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
        </div>
      </div>
      <div className="col-8 grid2 even" style={{ gap: 12 }}>
        <Stat label="Attended" icon={CheckCircle2} value={<>{s.present + s.late} / {s.total}</>} unit="d" tone="inf" note={`${pct.toFixed(1)}% rate`} />
        <Stat label="Active streak" icon={Flame} iconKind="sec" value={run ?? s.present} unit="days" tone="pos" note={run != null ? (run >= 10 ? "Strong run this term" : "Consecutive days present") : "Present this term"} />
        <Stat label="Excused" icon={FolderCheck} iconKind="high" value={s.excused} unit="approved" note="Medical & sanctioned leave" />
        <Stat label="Late arrivals" icon={Timer} value={s.late} unit="days" tone={s.late ? "cri" : "pos"} note={s.late ? "Marked after the bell" : "Always on time"} />
      </div>
    </div>
  );
}

function PresenceStrip({ gate, dismissal, date }: { gate: { direction: "in" | "out"; occurred_at: string } | null; dismissal?: string | null; date?: string }) {
  return (
    <div className="panel" style={{ gap: 12 }}>
      <SectionTitle small icon={Radio} title="Today's presence pulse" aside={<span className="lbl">{fmtDate(date ?? new Date().toISOString())}</span>} />
      <div className="grid2 even" style={{ gap: 20 }}>
        <div className="tile row-tile" style={{ padding: 20, justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <IconSq icon={DoorOpen} kind="fill" size="lg" />
            <div><div className="lbl">Gate check-in</div><div className="t-hlg" style={{ fontWeight: 700, marginTop: 2 }}>{gate?.direction === "in" ? fmtTime(gate.occurred_at) : "—"}</div><div className="t-bsm ink2" style={{ marginTop: 2 }}>{gate?.direction === "in" ? "Main gate • RFID scanned" : gate ? `Left at ${fmtTime(gate.occurred_at)}` : "No gate event yet today"}</div></div>
          </div>
          {gate?.direction === "in" ? <Pill kind="pos"><CheckCircle2 size={14} />Verified</Pill> : <Pill kind="high">Pending</Pill>}
        </div>
        <div className="tile row-tile" style={{ padding: 20, justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <IconSq icon={Bus} kind="sec" size="lg" />
            <div><div className="lbl">Expected dismissal</div><div className="t-hlg" style={{ fontWeight: 700, marginTop: 2 }}>{dismissal ? fmtTime(dismissal) : "—"}</div><div className="t-bsm ink2" style={{ marginTop: 2 }}>{dismissal ? "After the last period" : "Not published for today"}</div></div>
          </div>
          <Pill kind="high">Scheduled</Pill>
        </div>
      </div>
    </div>
  );
}

/* Monthly ledger: one dot per recorded day. */
function Ledger({ records }: { records: AttendanceRecord[] }) {
  const byDate = new Map(records.map((r) => [r.date, r]));
  const latest = [...records].sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.date ?? new Date().toISOString().slice(0, 10);
  const first = new Date(`${latest.slice(0, 7)}-01T00:00:00`);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // Monday first
  const cells: Array<{ date: string; day: number } | null> = Array(offset).fill(null);
  for (let d = 1; d <= days; d++) cells.push({ date: `${latest.slice(0, 7)}-${String(d).padStart(2, "0")}`, day: d });
  const tod = new Date().toISOString().slice(0, 10);
  const dot = (t: string) => t === "present" ? "var(--pos)" : t === "late" || t === "half_day" ? "var(--cau)" : t === "absent" ? "var(--cri)" : "var(--brand)";
  return (
    <div className="panel">
      <SectionTitle icon={CalendarDays} title={`Ledger · ${first.toLocaleString(undefined, { month: "long", year: "numeric" })}`} aside={
        <div style={{ display: "flex", gap: 12 }} className="lbl">
          {[["Present", "var(--pos)"], ["Late", "var(--cau)"], ["Absent", "var(--cri)"], ["Excused", "var(--brand)"]].map(([l, c]) => <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: c }} />{l}</span>)}
        </div>} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="lbl" style={{ textAlign: "center", padding: "4px 0" }}>{d}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div key={`e${i}`} />;
          const r = byDate.get(c.date); const isToday = c.date === tod; const weekend = (offset + c.day - 1) % 7 >= 5;
          return (
            <div key={c.date} title={r ? `${c.date} · ${plain(r.status)}${r.check_in_at ? ` · in ${fmtTime(r.check_in_at)}` : ""}` : c.date}
              style={{ aspectRatio: "1.6", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: isToday ? "var(--brand)" : r ? "var(--sunk)" : "transparent", color: isToday ? "var(--brand-on)" : weekend ? "var(--ghost)" : "var(--ink)", fontSize: 13, fontWeight: 600 }}>
              {c.day}
              {r ? <span style={{ width: 6, height: 6, borderRadius: 999, background: isToday ? "var(--brand-on)" : dot(r.status) }} /> : <span style={{ height: 6 }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubjectBreakdown({ subjects, threshold }: { subjects: SubjectAttendance[]; threshold: number }) {
  return (
    <div className="panel">
      <div className="sec-h">
        <div><h3 className="t-hlg">Subject breakdown</h3><span className="lbl" style={{ color: "var(--ink-2)" }}>Course-level threshold monitors</span></div>
        <IconSq icon={BarChart3} kind="high" />
      </div>
      {subjects.length === 0 ? <Empty>No subject-level attendance yet.</Empty> : (
        <div className="col xs">
          {[...subjects].sort((a, b) => Number(b.percentage) - Number(a.percentage)).map((s) => {
            const pct = Number(s.percentage); const tone = pctTone(pct, threshold);
            const word = pct >= 100 ? "Optimal" : tone === "pos" ? "Safe" : tone === "inf" ? "Good" : tone === "cau" ? "Near min" : "Below";
            return (
              <div className="tile md" key={s.id} style={{ gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span className="t-llg" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: s.subject.color }} />{s.subject.name}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Pill kind={tone === "pos" ? "pos" : tone === "inf" ? "tint" : tone === "cau" ? "cau" : "cri"}>{word}</Pill><span className="t-hsm" style={{ fontWeight: 700 }}>{pct.toFixed(0)}%</span></span>
                </div>
                <Bar pct={pct} tone={tone === "inf" ? undefined : tone} />
                <span className="t-bsm ink2">{s.teacher?.name ?? "Teacher TBA"} · {s.classes_attended} of {s.classes_held} periods{s.next_class ? ` · next ${s.next_class.weekday_label} ${hm(s.next_class.starts_at)}` : ""}</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="t-bsm faint">Threshold is {threshold}% per subject and overall, as set by the school.</p>
    </div>
  );
}

function AttendanceHeader({ student, term, todayStatus, leaveTo }: { student: Student; term: { name: string; academic_year: string }; todayStatus?: string | null; leaveTo: string }) {
  return (
    <PageTitle
      eyebrow={<><span className={`pulse${todayStatus === "present" ? "" : " off"}`}><span className="d" />Campus live presence</span><span className="sep" />{term.name}<span className="sep" />{term.academic_year}</>}
      title={<span className="t-bmd ink2" style={{ display: "block" }}>Real-time gate telemetry and academic ledger for <b style={{ color: "var(--ink)" }}>{student.user.display_name}</b>{todayStatus ? <> · today <Status tone={attendanceTone(todayStatus)}>{plain(todayStatus)}</Status></> : null}</span>}
      actions={<>
        <Link className="btn outline" to="/diary"><MessageSquare size={18} color="var(--brand-text)" />Class diary</Link>
        <Link className="btn pri" to={leaveTo}><PlusCircle size={18} />Request leave / medical slip</Link>
      </>}
    />
  );
}

export function ParentAttendancePage() {
  const { child } = useAuth();
  const q = useQuery({ queryKey: ["parent-attendance", child], queryFn: () => familyApi.parentAttendance(child ?? undefined) });
  const subjects = useQuery({ queryKey: ["subject-attendance", child], queryFn: () => familyApi.subjectAttendance(child ?? undefined) });
  if (q.isPending) return <><Skeleton h={60} /><Skeleton h={260} /><Skeleton h={300} /></>;
  if (q.isError || !q.data) return <Empty>Could not load attendance.</Empty>;
  const d = q.data;
  const threshold = Number(d.term.threshold);
  return (
    <>
      <AttendanceHeader student={d.student} term={d.term} todayStatus={d.today?.status} leaveTo="/leave" />
      <ChildSwitcher current={d.student} siblings={[]} />
      <Bento s={d.summary} threshold={threshold} records={d.calendar} />
      <PresenceStrip gate={d.latest_gate_event} dismissal={d.expected_dismissal_at} date={d.today?.date} />
      <div className="grid12">
        <div className="col-7"><Ledger records={d.calendar} /></div>
        <div className="col-5"><SubjectBreakdown subjects={subjects.data?.results ?? []} threshold={threshold} /></div>
      </div>
    </>
  );
}

export function StudentAttendancePage() {
  const q = useQuery({ queryKey: ["student-attendance"], queryFn: familyApi.studentAttendance });
  const home = useQuery({ queryKey: ["student-home"], queryFn: familyApi.studentHome });
  if (q.isPending) return <><Skeleton h={60} /><Skeleton h={260} /><Skeleton h={300} /></>;
  if (q.isError || !q.data) return <Empty>Could not load attendance.</Empty>;
  const d = q.data;
  const threshold = Number(d.term.threshold);
  const r = d.ranking;
  const last = home.data ? [...home.data.today_schedule].sort((a, b) => a.period_number - b.period_number).at(-1) : undefined;
  return (
    <>
      <AttendanceHeader student={d.student} term={d.term} todayStatus={home.data?.today_attendance?.status} leaveTo="/leave" />
      <Bento s={d.summary} threshold={threshold} />
      <PresenceStrip gate={home.data?.campus_presence ?? null} dismissal={last ? `${home.data?.date}T${hm(last.ends_at)}:00` : null} date={home.data?.date} />
      <div className="grid12">
        <div className="col-7"><SubjectBreakdown subjects={d.subjects} threshold={threshold} /></div>
        <div className="col-5">
          {r?.published ? (
            <div className="panel">
              <SectionTitle icon={Flame} title="Class standing" aside={<span className="lbl">as of {fmtDate(r.as_of, { day: "numeric", month: "short" })}</span>} />
              <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                <span className="t-dl">{r.current_rank ?? "—"}</span>
                <span className="t-bmd ink2">of {r.cohort_size}{r.current_streak ? ` · ${r.current_streak}-day streak` : ""}</span>
              </div>
              <div className="col xs">
                {r.leaders.slice(0, 5).map((l) => (
                  <div className="tile md" key={l.rank} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <span className="av" style={{ background: l.rank === 1 ? "var(--brand)" : undefined, color: l.rank === 1 ? "var(--brand-on)" : undefined }}>{l.rank}</span>
                    <div className="rowtxt"><b>{l.name}</b><span>{l.attended} of {l.held} periods</span></div>
                    <span className="t-hsm" style={{ fontWeight: 700 }}>{l.percentage.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              <p className="t-bsm faint">{r.methodology}</p>
            </div>
          ) : (
            <div className="panel"><SectionTitle icon={Flame} title="Class standing" /><Empty>Rankings are not published for this term.</Empty></div>
          )}
        </div>
      </div>
    </>
  );
}
