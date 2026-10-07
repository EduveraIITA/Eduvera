import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, CheckCircle2, DoorOpen, Download, LayoutGrid, Palette, Timer, UserRound, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { staffApi, type PrincipalTimetable } from "../features/staff";
import { DayList, Legend, TimetableGrid, WeekStrip, livePeriod, periodsFrom, subjectColor, todayWeekday, type TTCell, type TTDay } from "../components/Timetable";
import { Empty, IconSq, PageTitle, Pill, SectionTitle, Skeleton, Stat, Status, Tabs, hm } from "../components/ui";

type Lens = "class" | "teacher" | "room";
type Slot = PrincipalTimetable["slots"][number];

/* Principal timetable: the whole school, seen by class, by teacher or by room.
   Clashes are surfaced first; free periods are drawn, not implied. */
export function TimetablePage() {
  const tt = useQuery({ queryKey: ["principal-timetable"], queryFn: staffApi.principalTimetable });
  const [lens, setLens] = useState<Lens>("class");
  const [pick, setPick] = useState<Record<Lens, string>>({ class: "", teacher: "", room: "" });
  const [mode, setMode] = useState<"week" | "day">("week");
  const [day, setDay] = useState(todayWeekday());
  const [spot, setSpot] = useState<string | null>(null);

  const model = useMemo(() => {
    if (!tt.data) return null;
    const d = tt.data;
    const subj = new Map(d.subjects.map((s) => [s.id, s]));
    const rooms = [...new Set(d.slots.map((s) => s.room).filter(Boolean))].sort();
    const options: Record<Lens, Array<{ id: string; label: string }>> = {
      class: d.classes.map((c) => ({ id: c.id, label: `${c.name} · room ${c.room_number}` })),
      teacher: d.teachers.map((t) => ({ id: t.id, label: t.name })),
      room: rooms.map((r) => ({ id: r, label: r })),
    };
    const sel = pick[lens] || options[lens][0]?.id || "";
    const mine = d.slots.filter((s) => lens === "class" ? s.class_section_id === sel : lens === "teacher" ? s.teacher_user_id === sel : s.room === sel);
    const periods = periodsFrom(d.slots);
    const dayLabels = new Map<number, string>();
    for (const s of d.slots) dayLabels.set(s.weekday, s.weekday_label);
    const days: TTDay[] = [...dayLabels.entries()].sort((a, b) => a[0] - b[0]).map(([weekday, label]) => ({ weekday, label }));
    const clashIds = new Set<string>();
    for (const c of d.conflicts) { clashIds.add(c.first_slot_id); clashIds.add(c.second_slot_id); }
    const byKey = new Map<string, Slot>();
    for (const s of mine) byKey.set(`${s.weekday}-${s.period_number}`, s);
    // Breaks come from any class when looking at a teacher or room.
    const breaks = new Map<string, Slot>();
    for (const s of d.slots) if (s.slot_type === "break") breaks.set(`${s.weekday}-${s.period_number}`, s);

    const cell = (weekday: number, period: number): TTCell | null => {
      const s = byKey.get(`${weekday}-${period}`);
      if (!s) { const b = breaks.get(`${weekday}-${period}`); if (b) return { key: b.id, kind: "break", title: b.display_title }; return lens === "class" ? null : { key: `${weekday}-${period}`, kind: "free", title: "Free" }; }
      if (s.slot_type === "break") return { key: s.id, kind: "break", title: s.display_title };
      const sub = s.subject_id ? subj.get(s.subject_id) : undefined;
      const title = lens === "class" ? (sub?.name ?? s.display_title) : s.class_name;
      const parts = lens === "class" ? [s.teacher_name ?? (s.slot_type === "class" ? "Unassigned" : ""), s.room] : lens === "teacher" ? [sub?.name ?? s.display_title, s.room] : [sub?.name ?? s.display_title, s.teacher_name ?? "Unassigned"];
      return { key: s.id, kind: s.slot_type, title, sub: parts.filter(Boolean).join(" · "), color: sub?.color ?? subjectColor(s.display_title), subjectId: lens === "class" ? s.subject_id : s.class_section_id, clash: clashIds.has(s.id), unassigned: s.slot_type === "class" && !s.teacher_user_id };
    };

    // Legend: subjects for a class; classes for a teacher or room.
    const counts = new Map<string, number>();
    for (const s of mine) if (s.slot_type === "class") { const k = lens === "class" ? (s.subject_id ?? s.display_title) : s.class_section_id; counts.set(k, (counts.get(k) ?? 0) + 1); }
    const legend = [...counts.entries()].map(([id, count]) => {
      if (lens === "class") { const s = subj.get(id); return { id, name: s?.name ?? id, color: s?.color ?? subjectColor(id), count, sub: (() => { const t = mine.find((x) => x.subject_id === id)?.teacher_name; return t ?? "No teacher assigned"; })() }; }
      const cls = d.classes.find((c) => c.id === id); const first = mine.find((x) => x.class_section_id === id);
      return { id, name: cls?.name ?? first?.class_name ?? id, color: first?.subject_id ? (subj.get(first.subject_id)?.color ?? subjectColor(id)) : subjectColor(id), count, sub: lens === "teacher" ? `${[...new Set(mine.filter((x) => x.class_section_id === id).map((x) => x.subject_id && subj.get(x.subject_id)?.name).filter(Boolean))].join(", ")}` : `room ${cls?.room_number ?? ""}` };
    }).sort((a, b) => b.count - a.count);

    const teaching = mine.filter((s) => s.slot_type === "class").length;
    const capacity = days.length * periods.filter((p) => !breaks.has(`${days[0]?.weekday}-${p.number}`)).length;
    const unassigned = mine.filter((s) => s.slot_type === "class" && !s.teacher_user_id).length;
    const clashes = mine.filter((s) => clashIds.has(s.id)).length;
    const live = livePeriod(periods);
    const liveSlot = live != null ? byKey.get(`${todayWeekday()}-${live}`) : undefined;
    return { d, options, sel, periods, days, cell, legend, teaching, capacity, unassigned, clashes, live, liveSlot, subj, clashIds };
  }, [tt.data, lens, pick]);

  if (tt.isPending) return <><Skeleton h={60} w={420} /><Skeleton h={118} /><Skeleton h={480} /></>;
  if (tt.isError || !tt.data || !model) return <Empty>Could not load the timetable.</Empty>;

  const { d, options, sel, periods, days, cell, legend } = model;
  const selLabel = options[lens].find((o) => o.id === sel)?.label ?? "";
  const todayW = todayWeekday();
  const shownDay = days.find((x) => x.weekday === day) ?? days[0];
  const lensIcon = lens === "class" ? Users : lens === "teacher" ? UserRound : DoorOpen;

  return (
    <>
      <PageTitle
        icon={CalendarDays}
        eyebrow={<>Timetable<span className="sep" />{d.classes.length} classes<span className="sep" />{d.teachers.length} teachers<span className="sep" />{d.subjects.length} subjects</>}
        title="School timetable"
        sub={model.liveSlot ? <>Live now · P{model.live} · {model.liveSlot.class_name}{model.liveSlot.subject_id ? ` · ${model.subj.get(model.liveSlot.subject_id)?.name}` : ""}{model.liveSlot.room ? ` · ${model.liveSlot.room}` : ""}</> : days.some((x) => x.weekday === todayW) ? "No period is running right now." : "No classes today."}
        actions={<>
          <Tabs value={lens} onChange={(l) => { setLens(l); setSpot(null); }} items={[{ id: "class", label: "By class" }, { id: "teacher", label: "By teacher" }, { id: "room", label: "By room" }]} />
          <select className="input sm" aria-label={`Choose ${lens}`} value={sel} onChange={(e) => { setPick((p) => ({ ...p, [lens]: e.target.value })); setSpot(null); }} style={{ width: 230 }}>
            {options[lens].map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <Tabs value={mode} onChange={setMode} items={[{ id: "week", label: "Week" }, { id: "day", label: "Day" }]} />
          <button className="btn outline no-print" onClick={() => window.print()}><Download size={18} />Print</button>
        </>}
      />

      <div className="grid4">
        <Stat label={lens === "class" ? "Teaching periods" : lens === "teacher" ? "Teaching load" : "Room in use"} icon={Timer} value={model.teaching} unit={`/ ${model.capacity} a week`} tone="inf" note={`${Math.max(0, model.capacity - model.teaching)} free`} />
        <Stat label={lens === "class" ? "Subjects" : "Classes"} icon={lensIcon} iconKind="sec" value={legend.length} note={lens === "class" ? "on this class's timetable" : lens === "teacher" ? "taught by this teacher" : "using this room"} />
        <Stat label="Clashes" icon={AlertTriangle} value={model.clashes} tone={model.clashes ? "cri" : "pos"} note={model.clashes ? "in this view" : d.conflicts.length ? `${d.conflicts.length} elsewhere in school` : "none school-wide"} />
        <Stat label="Unassigned" icon={CheckCircle2} value={model.unassigned} tone={model.unassigned ? "cau" : "pos"} note={model.unassigned ? "slots without a teacher" : "every slot staffed"} />
      </div>

      {d.conflicts.length ? (
        <div className="panel tight" style={{ boxShadow: "var(--shadow), 0 0 0 1px rgba(186, 26, 26, .35)" }}>
          <SectionTitle small icon={AlertTriangle} title="Clashes to resolve" aside={<Pill kind="cri">{d.conflicts.length}</Pill>} />
          <div className="col xs">
            {d.conflicts.map((c, i) => {
              const a = d.slots.find((s) => s.id === c.first_slot_id); const b = d.slots.find((s) => s.id === c.second_slot_id);
              return (
                <div className="tile md row-tile" key={i} style={{ alignItems: "center" }}>
                  <IconSq icon={AlertTriangle} kind="cri" />
                  <div className="rowtxt"><b>{a?.class_name} and {b?.class_name}</b><span>{a?.weekday_label} {hm(c.starts_at)}–{hm(c.ends_at)} · {c.type === "teacher" ? (a?.teacher_name ?? "same teacher") : (a?.room ?? "same room")} is double-booked</span></div>
                  <Status tone="cri">{c.type === "teacher" ? "Teacher" : "Room"}</Status>
                  {c.type === "teacher" && a?.teacher_user_id ? <button className="btn sm" onClick={() => { setLens("teacher"); setPick((p) => ({ ...p, teacher: a.teacher_user_id! })); setSpot(null); }}>See {a.teacher_name}'s week</button>
                    : a?.room ? <button className="btn sm" onClick={() => { setLens("room"); setPick((p) => ({ ...p, room: a.room })); setSpot(null); }}>See {a.room}</button> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid12">
        <div className="col-9 col sm">
          {mode === "week" ? (
            <TimetableGrid days={days} periods={periods} cell={cell} highlight={spot}
              header={<div className="card-h"><b><LayoutGrid size={20} />{selLabel}</b><div className="btnrow">{spot ? <button className="btn sm" onClick={() => setSpot(null)}>Show all</button> : null}{days.some((x) => x.weekday === todayW) ? <span className="pulse brand"><span className="d" />{days.find((x) => x.weekday === todayW)?.label} is live</span> : null}</div></div>} />
          ) : (
            <div className="panel">
              <div className="sec-h"><h2 className="ttl"><Timer size={24} />{shownDay?.label}{shownDay?.weekday === todayW ? " · today" : ""}</h2><WeekStrip days={days} value={shownDay?.weekday ?? day} onChange={setDay} /></div>
              {shownDay ? <DayList day={shownDay} periods={periods} cell={cell} /> : <Empty>No days on the timetable.</Empty>}
            </div>
          )}
        </div>
        <div className="col-3 col sm">
          <div className="panel tight">
            <SectionTitle small icon={Palette} title={lens === "class" ? "Subjects this week" : "Classes this week"} aside={spot ? <button className="btn link" style={{ fontSize: 12 }} onClick={() => setSpot(null)}>Clear</button> : null} />
            {legend.length ? <Legend items={legend} value={spot} onChange={setSpot} /> : <Empty>Nothing scheduled.</Empty>}
            <p className="t-bsm faint">Click one to spotlight it on the grid.</p>
          </div>
        </div>
      </div>
    </>
  );
}
