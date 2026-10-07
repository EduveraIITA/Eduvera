import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CalendarDays, CalendarX2, CheckCircle2, ClipboardList, Download, FileText, Info, LayoutGrid, Megaphone, Palette, PlusCircle, ShieldCheck, StickyNote, Timer } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { familyApi, type Leave, type Slot } from "../features/family";
import { useAuth } from "../lib/auth";
import { DayList, Legend, TimetableGrid, WeekStrip, livePeriod, periodsFrom, subjectColor, todayWeekday, type TTCell, type TTDay } from "../components/Timetable";
import { Bar, Empty, IconSq, PageTitle, Pill, SectionTitle, Skeleton, Status, Tabs, fmtDate, hm, leaveTone, plain, today, useToast } from "../components/ui";

/* ---------- timetable (both personas) ---------- */
export function FamilyTimetablePage() {
  const { persona, child } = useAuth();
  const [mode, setMode] = useState<"week" | "day">("week");
  const [day, setDay] = useState(todayWeekday());
  const [spot, setSpot] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["family-timetable", persona, child],
    queryFn: async () => {
      if (persona === "student") { const w = await familyApi.studentWeek(); return { title: w.class_name, student: w.student, slots: w.days.flatMap((d) => d.periods.map((p) => ({ ...p, weekday: d.weekday, weekday_label: d.weekday_label }))) }; }
      const [home, tt] = await Promise.all([familyApi.parentHome(child ?? undefined), familyApi.timetable(child ?? undefined)]);
      return { title: home.student.current_enrollment.class_name, student: home.student, slots: tt.results };
    },
  });
  const model = useMemo(() => {
    if (!q.data) return null;
    const slots = q.data.slots;
    const periods = periodsFrom(slots);
    const labels = new Map<number, string>();
    for (const s of slots) labels.set(s.weekday, s.weekday_label);
    const days: TTDay[] = [...labels.entries()].sort((a, b) => a[0] - b[0]).map(([weekday, label]) => ({ weekday, label }));
    const byKey = new Map(slots.map((s) => [`${s.weekday}-${s.period_number}`, s]));
    const isBreak = (s: Slot) => s.slot_type === "break" || (!s.subject && /break|lunch|recess|assembly/i.test(s.display_title));
    const cell = (weekday: number, period: number): TTCell | null => {
      const s = byKey.get(`${weekday}-${period}`);
      if (!s) return null;
      if (isBreak(s)) return { key: s.id, kind: "break", title: s.display_title };
      const name = s.subject?.name ?? s.display_title;
      return { key: s.id, kind: "class", title: name, sub: [s.teacher?.name, s.room].filter(Boolean).join(" · "), color: s.subject?.color ?? subjectColor(s.subject?.code ?? name), subjectId: s.subject?.id ?? name };
    };
    const counts = new Map<string, { name: string; teacher?: string; count: number; code: string; color?: string | null }>();
    for (const s of slots) if (!isBreak(s)) { const id = s.subject?.id ?? s.display_title; const e = counts.get(id) ?? { name: s.subject?.name ?? s.display_title, teacher: s.teacher?.name, count: 0, code: s.subject?.code ?? s.display_title, color: s.subject?.color }; e.count += 1; counts.set(id, e); }
    const legend = [...counts.entries()].map(([id, e]) => ({ id, name: e.name, color: e.color ?? subjectColor(e.code), count: e.count, sub: e.teacher })).sort((a, b) => b.count - a.count);
    const live = livePeriod(periods); const liveSlot = live != null ? byKey.get(`${todayWeekday()}-${live}`) : undefined;
    const todaySlots = slots.filter((s) => s.weekday === todayWeekday() && !isBreak(s)).sort((a, b) => a.period_number - b.period_number);
    return { periods, days, cell, legend, live, liveSlot, todaySlots, teaching: slots.filter((s) => !isBreak(s)).length };
  }, [q.data]);
  if (q.isPending) return <><Skeleton h={60} /><Skeleton h={480} /></>;
  if (q.isError || !q.data || !model) return <Empty>Could not load the timetable.</Empty>;
  const { periods, days, cell, legend } = model;
  const todayW = todayWeekday();
  const shownDay = days.find((x) => x.weekday === day) ?? days[0];
  const term = q.data.student.current_enrollment.term;
  const first = q.data.student.user.display_name.split(" ")[0];

  return (
    <>
      <PageTitle
        icon={CalendarDays}
        eyebrow={<>{term.name} · {term.academic_year}<span className="sep" />{days.length} teaching days<span className="sep" />{model.teaching} periods a week</>}
        title={`${q.data.title} timetable`}
        sub={model.liveSlot ? <>Live now · P{model.live} · {model.liveSlot.subject?.name ?? model.liveSlot.display_title}{model.liveSlot.room ? ` in ${model.liveSlot.room}` : ""}{model.liveSlot.teacher ? ` with ${model.liveSlot.teacher.name}` : ""}</> : model.todaySlots.length ? <>{persona === "student" ? "You have" : `${first} has`} {model.todaySlots.length} periods today · first at {hm(model.todaySlots[0]!.starts_at)}, last ends {hm(model.todaySlots.at(-1)!.ends_at)}</> : "No classes today."}
        actions={<>
          <Tabs value={mode} onChange={setMode} items={[{ id: "week", label: "Week" }, { id: "day", label: "Day" }]} />
          <button className="btn outline no-print" onClick={() => window.print()}><Download size={18} />Print</button>
        </>}
      />

      <div className="grid12">
        <div className="col-9 col sm">
          {mode === "week" ? (
            <TimetableGrid days={days} periods={periods} cell={cell} highlight={spot}
              header={<div className="card-h"><b><LayoutGrid size={20} />Weekly grid</b><div className="btnrow">{spot ? <button className="btn sm" onClick={() => setSpot(null)}>Show all</button> : null}{days.some((x) => x.weekday === todayW) ? <span className="pulse brand"><span className="d" />{days.find((x) => x.weekday === todayW)?.label} is live</span> : null}</div></div>} />
          ) : (
            <div className="panel">
              <div className="sec-h"><h2 className="ttl"><Timer size={24} />{shownDay?.label}{shownDay?.weekday === todayW ? " · today" : ""}</h2><WeekStrip days={days} value={shownDay?.weekday ?? day} onChange={setDay} /></div>
              {shownDay ? <DayList day={shownDay} periods={periods} cell={cell} /> : <Empty>No days on the timetable.</Empty>}
            </div>
          )}
        </div>
        <div className="col-3 col sm">
          <div className="panel tight">
            <SectionTitle small icon={Palette} title="Subjects this week" aside={spot ? <button className="btn link" style={{ fontSize: 12 }} onClick={() => setSpot(null)}>Clear</button> : null} />
            <Legend items={legend} value={spot} onChange={setSpot} />
            <p className="t-bsm faint">Click one to spotlight it on the grid.</p>
          </div>
          {mode === "day" && shownDay ? (
            <div className="panel tight">
              <SectionTitle small icon={ClipboardList} title="Bag for the day" />
              <div className="col xs">
                {[...new Map(q.data.slots.filter((s) => s.weekday === shownDay.weekday && s.subject).map((p) => [p.subject!.id, p])).values()].map((p) => (
                  <label className="check tile md" key={p.id} style={{ flexDirection: "row" }}><input type="checkbox" /><span className="t-llg">{p.subject!.name}</span><span className="t-bsm ink2" style={{ marginLeft: "auto" }}>{p.room}</span></label>
                ))}
              </div>
              <p className="t-bsm faint">Ticks are just for this visit; nothing is saved.</p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ---------- diary (both personas) ---------- */
export function FamilyDiaryPage() {
  const { persona, child } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<"all" | "homework" | "announcement" | "note">("all");
  const to = today();
  const from = useMemo(() => { const d = new Date(`${to}T00:00:00`); d.setDate(d.getDate() - 14); return d.toISOString().slice(0, 10); }, [to]);
  const q = useQuery({ queryKey: ["family-diary", persona, child, from, to], queryFn: () => familyApi.diary(from, to, persona === "parent" ? child ?? undefined : undefined) });
  const home = useQuery({ queryKey: ["parent-home", child], queryFn: () => familyApi.parentHome(child ?? undefined), enabled: persona === "parent" });
  const me = useQuery({ queryKey: ["student-home"], queryFn: familyApi.studentHome, enabled: persona === "student" });
  const studentId = persona === "parent" ? (home.data?.student.id ?? child ?? "") : (me.data?.student.id ?? "");
  const ack = useMutation({
    mutationFn: (id: string) => familyApi.acknowledge(id, studentId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["family-diary"] }); void qc.invalidateQueries({ queryKey: ["parent-home"] }); toast("Acknowledged."); },
    onError: (e: Error) => toast(e.message, true),
  });
  if (q.isPending) return <><Skeleton h={60} /><Skeleton h={300} /></>;
  const items = q.data?.results ?? [];
  const shown = items.filter((d) => filter === "all" || (filter === "note" ? d.item_type === "note" || d.item_type === "schedule" : d.item_type === filter));
  const pending = items.filter((d) => d.requires_acknowledgement && !d.acknowledged);
  const icon = (t: string) => t === "homework" ? ClipboardList : t === "announcement" ? Megaphone : StickyNote;
  const kind = (t: string) => t === "homework" ? "cau" : t === "announcement" ? "tint" : "high";

  return (
    <>
      <PageTitle icon={BookOpen} eyebrow={<>Diary<span className="sep" />{fmtDate(from, { day: "numeric", month: "short" })} – {fmtDate(to, { day: "numeric", month: "short" })}</>} title="Teacher daily notes"
        sub={pending.length ? `${pending.length} note${pending.length === 1 ? "" : "s"} still need${pending.length === 1 ? "s" : ""} your acknowledgement.` : `${items.length} entries in the last two weeks.`}
        actions={<Tabs value={filter} onChange={setFilter} items={[{ id: "all", label: "All" }, { id: "homework", label: "Homework" }, { id: "announcement", label: "Notices" }, { id: "note", label: "Notes" }]} />} />

      <div className="grid12">
        <div className="col-8 col sm">
          {shown.length === 0 ? <div className="card"><Empty>Nothing in the diary for this filter.</Empty></div> : shown.map((d) => {
            const I = icon(d.item_type);
            return (
              <div className={`card${d.requires_acknowledgement && !d.acknowledged ? " ring" : ""}`} key={d.id} style={{ padding: 20, display: "flex", gap: 16, alignItems: "flex-start" }}>
                <IconSq icon={I} kind={kind(d.item_type) as "cau" | "tint" | "high"} size="lg" />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className="t-hsm">{d.title}</span>
                      <Pill kind={d.item_type === "homework" ? "cau" : d.item_type === "announcement" ? "tint" : "soft"}>{d.item_type_label}</Pill>
                    </div>
                    <span className="lbl" style={{ flexShrink: 0 }}>{fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" })}</span>
                  </div>
                  <span className="t-bsm ink2">{d.subject ? `${d.subject.name} · ` : ""}{d.author_name}{d.due_at ? ` · due ${fmtDate(d.due_at, { weekday: "short", day: "numeric", month: "short" })}` : ""}</span>
                  {d.body ? <p className="t-bmd ink2" style={{ whiteSpace: "pre-wrap", maxWidth: "70ch" }}>{d.body}</p> : null}
                  {d.notes?.length ? <div className="quote">{d.notes[0]!.author_name}: {d.notes[0]!.body}</div> : null}
                  {d.requires_acknowledgement ? (
                    <div className="btnrow" style={{ paddingTop: 4 }}>
                      {d.acknowledged ? <Status tone="pos">Acknowledged</Status> : <><button className="btn sm pri" disabled={ack.isPending || !studentId} onClick={() => ack.mutate(d.id)}><CheckCircle2 size={16} />Acknowledge</button><span className="t-bsm faint">The school is waiting for this.</span></>}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className="col-4 col sm">
          <div className="panel tight">
            <SectionTitle small icon={ShieldCheck} title="Daily sign-off" />
            <div className={`callout${pending.length ? " cau" : " pos"}`}>
              <ShieldCheck size={20} color={pending.length ? "var(--cau-ink)" : "var(--pos)"} style={{ flexShrink: 0, marginTop: 2 }} />
              <div><div className="t-lmd">{pending.length ? `${pending.length} pending` : "All caught up"}</div><p className="t-bsm ink2" style={{ marginTop: 2 }}>{pending.length ? "Acknowledging tells the teacher the note was seen at home." : "Every note that needed a reply has one."}</p></div>
            </div>
            {pending.slice(0, 4).map((d) => <button key={d.id} className="tile md hov" style={{ flexDirection: "row", alignItems: "center", gap: 10 }} disabled={ack.isPending || !studentId} onClick={() => ack.mutate(d.id)}><CheckCircle2 size={18} color="var(--brand-text)" /><span className="t-llg" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span><span className="lbl">Ack</span></button>)}
          </div>
          <div className="panel tight">
            <SectionTitle small icon={Info} title="How the diary works" />
            <p className="t-bsm ink2">Teachers post homework, notices and notes here. Homework carries a due date; notices may ask for an acknowledgement. Nothing you tick here is graded.</p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- leave (parent authorises; student applies and tracks) ---------- */
function Dossier({ l, actions, focus }: { l: Leave; actions?: ReactNode; focus?: boolean }) {
  return (
    <div className={`card${focus ? " ring" : ""}`} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <IconSq icon={FileText} kind="tint" size="lg" />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><h3 className="t-hlg">{l.category_label ?? plain(l.category)} leave</h3><Status tone={leaveTone(l.status)}>{l.status_label ?? plain(l.status)}</Status></div>
            <p className="t-bsm ink2" style={{ marginTop: 2 }}>{fmtDate(l.starts_on, { weekday: "short", day: "numeric", month: "short" })}{l.ends_on !== l.starts_on ? ` – ${fmtDate(l.ends_on, { weekday: "short", day: "numeric", month: "short" })}` : ""} · {l.duration_days} day{l.duration_days === 1 ? "" : "s"} · requested by {l.requested_by_name}</p>
          </div>
        </div>
        <span className="lbl">REQ-{l.id.slice(0, 8).toUpperCase()}</span>
      </div>
      <div className="grid3">
        <div className="tile md"><span className="lbl">Duration</span><span className="t-hsm" style={{ fontWeight: 700 }}>{l.duration_days} day{l.duration_days === 1 ? "" : "s"}</span></div>
        <div className="tile md"><span className="lbl">Guardian sign-off</span><span className="t-hsm" style={{ fontWeight: 700 }}>{l.guardian_authorized_by_name ?? "Pending"}</span></div>
        <div className="tile md"><span className="lbl">School decision</span><span className="t-hsm" style={{ fontWeight: 700 }}>{l.decided_by_name ? `${l.decided_by_name}` : "Pending"}</span></div>
      </div>
      {l.reason ? <div className="quote">“{l.reason}”</div> : null}
      {l.documents.length ? (
        <div className="col xs">
          <span className="lbl">Attachments</span>
          {l.documents.map((d) => <a key={d.id} className="tile md hov row-tile" href={d.file_url} target="_blank" rel="noreferrer" style={{ alignItems: "center" }}><IconSq icon={FileText} kind="sec" /><span className="t-llg" style={{ flex: 1 }}>Document · {(d.size_bytes / 1024).toFixed(0)} KB</span><span className="t-bsm ink2">{fmtDate(d.created_at, { day: "numeric", month: "short" })}</span></a>)}
        </div>
      ) : null}
      {actions}
      {l.audit_log?.length ? (
        <details className="t-bsm ink2"><summary style={{ cursor: "pointer", fontWeight: 600 }}>History · {l.audit_log.length}</summary>
          <div className="col" style={{ gap: 4, marginTop: 8 }}>{l.audit_log.map((a) => <div key={a.id}>{fmtDate(a.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {a.actor_name}{a.to_status ? ` · ${plain(a.to_status)}` : ""}{a.note ? ` — ${a.note}` : ""}</div>)}</div>
        </details>
      ) : null}
    </div>
  );
}

function LedgerEntry({ l }: { l: Leave }) {
  return (
    <div className="row" style={{ padding: "12px 0", alignItems: "flex-start" }}>
      <IconSq icon={CalendarX2} kind={l.status === "approved" ? "pos" : l.status === "rejected" ? "cri" : "high"} />
      <div className="rowtxt"><b>{l.category_label ?? plain(l.category)}</b><span>{fmtDate(l.starts_on, { day: "numeric", month: "short" })}{l.ends_on !== l.starts_on ? ` – ${fmtDate(l.ends_on, { day: "numeric", month: "short" })}` : ""} · {l.duration_days} day{l.duration_days === 1 ? "" : "s"}</span></div>
      <Status tone={leaveTone(l.status)}>{l.status_label ?? plain(l.status)}</Status>
    </div>
  );
}

function LeaveForm({ studentName, onSubmit, busy, cta }: { studentName: string; onSubmit: (f: { category: string; starts_on: string; ends_on: string; reason: string }) => void; busy: boolean; cta: string }) {
  const [form, setForm] = useState({ category: "medical", starts_on: today(), ends_on: today(), reason: "" });
  function submit(e: FormEvent) { e.preventDefault(); onSubmit(form); }
  return (
    <form onSubmit={submit} className="card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionTitle small icon={PlusCircle} title={`New leave for ${studentName}`} />
      <div className="grid3">
        <label className="field"><span className="lbl">Category</span>
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{["medical", "family", "travel", "personal"].map((c) => <option key={c} value={c}>{plain(c)}</option>)}</select></label>
        <label className="field"><span className="lbl">From</span><input className="input" type="date" required value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value, ends_on: form.ends_on < e.target.value ? e.target.value : form.ends_on })} /></label>
        <label className="field"><span className="lbl">To</span><input className="input" type="date" required min={form.starts_on} value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} /></label>
      </div>
      <label className="field"><span className="lbl">Reason</span><textarea className="input" required minLength={10} rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="What the school needs to know" /></label>
      <div className="btnrow"><button className="btn pri" type="submit" disabled={busy}>{busy ? "Submitting…" : cta}</button></div>
    </form>
  );
}

export function ParentLeavePage() {
  const { child } = useAuth();
  const qc = useQueryClient(); const toast = useToast();
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Record<string, boolean>>({});
  const q = useQuery({ queryKey: ["parent-leaves", child], queryFn: () => familyApi.leaves(child ?? undefined) });
  const home = useQuery({ queryKey: ["parent-home", child], queryFn: () => familyApi.parentHome(child ?? undefined) });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "authorize" | "clarify" | "decline" }) => familyApi.leaveAction(id, action, note[id]?.trim() || undefined),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ["parent-leaves"] }); void qc.invalidateQueries({ queryKey: ["parent-home"] }); setParams((p) => { p.delete("focus"); return p; }); toast(v.action === "authorize" ? "Authorised — the school will now review it." : v.action === "decline" ? "Declined." : "Clarification requested."); },
    onError: (e: Error) => toast(e.message, true),
  });
  const create = useMutation({
    mutationFn: (f: { category: string; starts_on: string; ends_on: string; reason: string }) => familyApi.createLeave({ ...f, student_id: home.data?.student.id ?? child ?? undefined }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["parent-leaves"] }); setOpen(false); toast("Submitted — the school will review it."); },
    onError: (e: Error) => toast(e.message, true),
  });
  if (q.isPending) return <><Skeleton h={60} /><Skeleton h={260} /></>;
  const rows = q.data?.results ?? [];
  const pending = rows.filter((l) => l.status === "pending_guardian");
  const rest = rows.filter((l) => l.status !== "pending_guardian");
  const name = home.data?.student.user.display_name.split(" ")[0] ?? "your child";
  const list = tab === "pending" ? pending : rest;

  return (
    <>
      <div className="head">
        <Tabs value={tab} onChange={setTab} items={[{ id: "pending", label: "Pending sign-off", count: pending.length }, { id: "history", label: "Active & history" }]} />
        <button className="btn pri" onClick={() => setOpen((o) => !o)}><PlusCircle size={18} />{open ? "Close form" : `Apply for ${name}`}</button>
      </div>

      {open && home.data ? <LeaveForm studentName={name} busy={create.isPending} cta="Submit request" onSubmit={(f) => create.mutate(f)} /> : null}

      {pending.length ? (
        <div className="card lg" style={{ background: "var(--soft-3)", padding: 20, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <IconSq icon={ShieldCheck} kind="tint" size="lg" />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span className="t-hsm">Guardian sign-off pending</span><span className="pulse cri" style={{ background: "var(--cri-bg)" }}><span className="d" />Action needed</span></div>
              <p className="t-bsm ink2">{pending.length === 1 ? `${pending[0]!.requested_by_name} has marked this request for your authorisation.` : `${pending.length} requests are waiting for your authorisation.`}</p>
            </div>
          </div>
          <span className="t-bsm ink2" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Signed in as guardian<CheckCircle2 size={18} color="var(--pos)" /></span>
        </div>
      ) : null}

      <div className="grid12">
        <div className="col-8 col sm">
          {list.length === 0 ? <div className="card"><Empty>{tab === "pending" ? "Nothing is waiting for your signature." : "No other leave requests."}</Empty></div> : list.map((l) => (
            <Dossier key={l.id} l={l} focus={focus === l.id} actions={l.status === "pending_guardian" ? (
              <div className="col sm" style={{ paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                <span className="lbl">Digital authorisation</span>
                <label className="field"><span className="lbl">Parent remark</span><input className="input" placeholder="Optional — required if you ask for clarification" value={note[l.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [l.id]: e.target.value }))} /></label>
                <label className="check"><input type="checkbox" checked={confirm[l.id] ?? false} onChange={(e) => setConfirm((c) => ({ ...c, [l.id]: e.target.checked }))} /><span>I confirm the dates and reason above are correct and authorise the school to record this leave against {name}.</span></label>
                <div className="btnrow">
                  <button className="btn pri" style={{ flex: "1 1 200px", padding: "12px 24px" }} disabled={act.isPending || !confirm[l.id]} onClick={() => act.mutate({ id: l.id, action: "authorize" })}><ShieldCheck size={18} />Authorise & sign</button>
                  <button className="btn outline" style={{ padding: "12px 20px" }} disabled={act.isPending || !(note[l.id]?.trim())} onClick={() => act.mutate({ id: l.id, action: "clarify" })}>Ask for clarification</button>
                  <button className="btn danger" style={{ padding: "12px 20px" }} disabled={act.isPending} onClick={() => act.mutate({ id: l.id, action: "decline" })}>Decline</button>
                </div>
              </div>
            ) : undefined} />
          ))}
        </div>
        <div className="col-4 col sm">
          <div className="panel tight">
            <SectionTitle small icon={CalendarX2} title="This year's excusals" aside={<span className="lbl">{rest.length}</span>} />
            {rest.length === 0 ? <Empty>No past requests.</Empty> : <div>{rest.slice(0, 5).map((l) => <LedgerEntry key={l.id} l={l} />)}</div>}
            {home.data ? <div className="col" style={{ gap: 4, paddingTop: 12, borderTop: "1px solid var(--line)" }}><div style={{ display: "flex", justifyContent: "space-between" }} className="lbl"><span>Attendance</span><span className="brand-c">{home.data.attendance.percentage.toFixed(1)}%</span></div><Bar pct={home.data.attendance.percentage} /></div> : null}
          </div>
          <div className="panel tight">
            <SectionTitle small icon={Info} title="Guidelines" />
            <details className="t-bsm ink2" open><summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink)" }}>Who signs what</summary><p style={{ marginTop: 6 }}>A request raised by a student needs a guardian's authorisation before the school reviews it. Requests you raise yourself are authorised immediately.</p></details>
            <details className="t-bsm ink2"><summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink)" }}>Medical leave</summary><p style={{ marginTop: 6 }}>Attach the clinic note when you have one; leave of three days or more usually needs it before approval.</p></details>
            <details className="t-bsm ink2"><summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink)" }}>Decisions</summary><p style={{ marginTop: 6 }}>Leadership approves or rejects and the decision is recorded against their name. You are notified either way.</p></details>
          </div>
        </div>
      </div>
    </>
  );
}

export function StudentLeavePage() {
  const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ["student-leave"], queryFn: familyApi.studentLeaveStatus });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"active" | "history">("active");
  const create = useMutation({
    mutationFn: (f: { category: string; starts_on: string; ends_on: string; reason: string }) => familyApi.createLeave(f),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["student-leave"] }); void qc.invalidateQueries({ queryKey: ["student-home"] }); setOpen(false); toast("Submitted — your guardian will be asked to authorise it."); },
    onError: (e: Error) => toast(e.message, true),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => familyApi.leaveAction(id, "withdraw"),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["student-leave"] }); toast("Withdrawn."); },
    onError: (e: Error) => toast(e.message, true),
  });
  if (q.isPending) return <><Skeleton h={60} /><Skeleton h={260} /></>;
  const d = q.data;
  const list = tab === "active" ? d?.active ?? [] : d?.history ?? [];
  return (
    <>
      <div className="head">
        <Tabs value={tab} onChange={setTab} items={[{ id: "active", label: "In progress", count: d?.active.length }, { id: "history", label: "History" }]} />
        <button className="btn pri" onClick={() => setOpen((o) => !o)}><PlusCircle size={18} />{open ? "Close form" : "Request leave"}</button>
      </div>
      {open ? <LeaveForm studentName="you" busy={create.isPending} cta="Send to my guardian" onSubmit={(f) => create.mutate(f)} /> : null}
      <div className="grid12">
        <div className="col-8 col sm">
          {list.length === 0 ? <div className="card"><Empty>{tab === "active" ? "No leave in progress." : "No past requests."}</Empty></div> : list.map((l) => (
            <Dossier key={l.id} l={l} actions={l.status === "pending_guardian" ? <div className="btnrow" style={{ paddingTop: 12, borderTop: "1px solid var(--line)" }}><Status tone="cau">Waiting for your guardian</Status><button className="btn sm danger" disabled={withdraw.isPending} onClick={() => withdraw.mutate(l.id)}>Withdraw</button></div> : undefined} />
          ))}
        </div>
        <div className="col-4 col sm">
          <div className="panel tight">
            <SectionTitle small icon={Info} title="How it works" />
            <div className="col xs">
              {[["1", "You request", "Pick the dates and say why."], ["2", "Guardian authorises", "Your guardian signs off from their portal."], ["3", "School decides", "Leadership approves or rejects and you are told."]].map(([n, t, b]) => (
                <div className="tile md row-tile" key={n} style={{ alignItems: "center" }}><span className="av" style={{ background: "var(--brand)", color: "var(--brand-on)" }}>{n}</span><div className="rowtxt"><b>{t}</b><span>{b}</span></div></div>
              ))}
            </div>
          </div>
          <Link className="tile hov row-tile" to="/attendance"><IconSq icon={CheckCircle2} kind="pos" size="lg" /><div className="rowtxt"><b>See your attendance</b><span>Leave that is approved counts as excused.</span></div></Link>
        </div>
      </div>
    </>
  );
}
