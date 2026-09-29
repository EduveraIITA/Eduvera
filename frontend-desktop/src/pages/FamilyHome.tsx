import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, BellRing, BookOpen, CalendarDays, CalendarX2, CheckCircle2, ClipboardList, Clock, Headset, LayoutGrid, MailOpen, Stethoscope, Timer, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { familyApi, type Contact, type DiaryItem, type Leave, type Slot, type Student } from "../features/family";
import { useAuth } from "../lib/auth";
import { Empty, IconSq, Pill, SectionTitle, Skeleton, Stat, Status, fmtDate, fmtTime, hm, plain } from "../components/ui";

/* Families open on an answer, not a dashboard. The number is supporting detail. */

const hhmm = () => new Date().toTimeString().slice(0, 5);
function live(slots: Slot[]) {
  const now = hhmm();
  const sorted = [...slots].sort((a, b) => a.period_number - b.period_number);
  const current = sorted.find((s) => hm(s.starts_at) <= now && now < hm(s.ends_at));
  const next = sorted.find((s) => hm(s.starts_at) > now);
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const pct = current ? Math.round(((toMin(now) - toMin(current.starts_at)) / (toMin(current.ends_at) - toMin(current.starts_at))) * 100) : 0;
  const remaining = current ? toMin(current.ends_at) - toMin(now) : 0;
  return { current, next, pct, remaining, sorted };
}

export function ChildSwitcher({ current, siblings }: { current: Student; siblings: Student[] }) {
  const { child, setChild } = useAuth();
  const all = [current, ...siblings.filter((s) => s.id !== current.id)];
  if (all.length < 2) return null;
  return (
    <div className="tabs" role="group" aria-label="Child">
      {all.map((s) => {
        const on = (child ?? current.id) === s.id;
        return (
          <button key={s.id} onClick={() => setChild(s.id)} aria-pressed={on} className="tab lg">
            {on ? <BadgeCheck size={18} /> : <span className="av" style={{ width: 20, height: 20, fontSize: 10, background: "var(--soft-3)", color: "var(--ink-2)" }}>{s.user.display_name[0]}</span>}
            {s.user.display_name.split(" ")[0]}{on ? "" : ` (${s.current_enrollment.class_name})`}
          </button>
        );
      })}
    </div>
  );
}

/* Profile banner: who this is, whether they are in the building, and the switcher. */
export function StudentBanner({ student, presence, right }: { student: Student; presence: { direction: "in" | "out"; occurred_at: string } | null; right?: React.ReactNode }) {
  const e = student.current_enrollment;
  const present = presence?.direction === "in";
  return (
    <div className="banner">
      <div className="glow" />
      <div className="in">
        <div className="who">
          <div className="big-av">{student.user.display_name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}{student.avatar_url ? <img src={student.avatar_url} alt="" style={{ position: "absolute", inset: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}<span className={`live${present ? "" : " off"}`} /></div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <h1>{student.user.display_name}</h1>
              <Pill>Roll #{String(e.roll_number).padStart(2, "0")}</Pill>
              <Pill kind="soft">Grade {e.grade} • Section {e.section}{e.board ? ` • ${e.board}` : ""}</Pill>
            </div>
            <span className={`pulse${present ? "" : " off"}`}>
              <span className="d" />
              {present ? "In school" : presence ? "Left school" : "No gate event yet"}
              {presence ? <span className="n">• Gate swipe at {fmtTime(presence.occurred_at)}</span> : null}
            </span>
          </div>
        </div>
        {right}
      </div>
    </div>
  );
}

/* Academic pulse: the live period with a progress bar, then the four semester vitals. */
export function AcademicPulse({ slots, todayStatus, metrics, threshold, attendance }: {
  slots: Slot[]; todayStatus: string | null;
  metrics: { periods: number; homework: number; dues?: string; dismissal?: string };
  threshold?: number; attendance: number;
}) {
  const { current, next, pct, remaining } = live(slots);
  const spotlight = current ?? next ?? null;
  const below = threshold != null && attendance < threshold;
  // Threshold bands (from Stage): safe, within 10 points of the minimum, then well below.
  const attendanceColor = !below ? "var(--pos)" : threshold != null && attendance >= threshold - 10 ? "var(--cau-ink)" : "var(--attendance-orange)";
  return (
    <div className="panel">
      <SectionTitle icon={Timer} title="Academic pulse" aside={<>
        {todayStatus ? <Pill kind={todayStatus === "present" ? "high" : todayStatus === "absent" ? "cri" : "cau"}><CheckCircle2 size={14} />{plain(todayStatus)} today</Pill> : <Pill kind="soft">Not marked yet</Pill>}
        <span className="lbl" style={{ color: "var(--ink-2)" }}>Live classroom sync</span>
      </>} />

      {spotlight ? (
        <div className="tile" style={{ padding: 20, gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Pill kind={current ? "brand" : "high"}>{current ? "Live period" : "Up next"}</Pill>
              <span className="t-llg">Period {spotlight.period_number} • {hm(spotlight.starts_at)} – {hm(spotlight.ends_at)}</span>
            </div>
            {current ? <span className="t-lmd brand-c" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={18} />{remaining}m remaining</span> : <span className="t-lmd ink2">starts at {hm(spotlight.starts_at)}</span>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h4 className="t-hlg">{spotlight.subject?.name ?? spotlight.display_title}</h4>
              <p className="t-bmd ink2" style={{ display: "flex", gap: 6 }}><span>{spotlight.room || "Room TBA"}</span>{spotlight.teacher ? <><span>•</span><span>{spotlight.teacher.name}</span></> : null}</p>
            </div>
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}><BookOpen size={20} color="var(--muted)" /><span className="lbl" style={{ color: "var(--muted)" }}>{spotlight.subject?.code ?? spotlight.display_title}</span></div>
          </div>
          {current ? (
            <div className="col" style={{ gap: 4 }}>
              <div className="bar thick"><i className="hover" style={{ width: `${pct}%` }} /></div>
              <div style={{ display: "flex", justifyContent: "space-between" }} className="lbl"><span>Started {hm(current.starts_at)}</span><span>Ends {hm(current.ends_at)}</span></div>
            </div>
          ) : null}
          {current && next ? <div className="t-lmd ink2" style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}><span className="pill high" style={{ borderRadius: 4, textTransform: "uppercase" }}>Upcoming</span>Next: Period {next.period_number} • {next.subject?.name ?? next.display_title}{next.room ? ` (${next.room})` : ""} at {hm(next.starts_at)}</div> : null}
        </div>
      ) : (
        <div className="tile" style={{ padding: 20 }}><span className="t-llg">No more periods today</span><span className="t-bsm ink2">{slots.length ? `${slots.length} periods were scheduled.` : "Nothing was scheduled for today."}</span></div>
      )}

      <div>
        <div className="lbl" style={{ marginBottom: 8 }}>Semester metrics</div>
        <div className="grid4">
          <Stat tile label="Attendance" icon={BadgeCheck} value={<span style={{ color: attendanceColor }}>{attendance.toFixed(1)}%</span>} tone={below ? "cau" : "pos"} note={threshold != null ? (below ? `Below ${threshold}% minimum` : `Safe zone (>${threshold}% req)`) : "This term"} />
          <Stat tile label="Schedule" icon={CalendarDays} value={`${metrics.periods} periods`} note={metrics.dismissal ? `Dismissal: ${metrics.dismissal}` : "today"} />
          <Stat tile label="Homework" icon={ClipboardList} value={`${metrics.homework} task${metrics.homework === 1 ? "" : "s"}`} tone={metrics.homework ? "cri" : "pos"} note={metrics.homework ? "due soon" : "nothing due"} />
          <Stat tile label="Dues status" icon={Wallet} value={<span className={metrics.dues && /clear|paid/i.test(metrics.dues) ? "pos-c" : ""}>{metrics.dues ? plain(metrics.dues) : "—"}</span>} note="this term" />
        </div>
      </div>
    </div>
  );
}

export function DiaryPreview({ items, to }: { items: DiaryItem[]; to: string }) {
  return (
    <div className="card">
      <div className="card-h"><b><BookOpen size={18} />Diary</b><Link to={to} className="t-lmd">All entries</Link></div>
      {items.length === 0 ? <Empty>Nothing new in the diary.</Empty> : items.map((d) => (
        <div className="row" key={d.id}>
          <Status tone={d.item_type === "homework" ? "cau" : d.item_type === "announcement" ? "inf" : "neu"}>{d.item_type_label}</Status>
          <div className="rowtxt"><b>{d.title}</b><span>{d.subject?.name ? `${d.subject.name} · ` : ""}{d.author_name}{d.due_at ? ` · due ${fmtDate(d.due_at, { day: "numeric", month: "short" })}` : ""}</span></div>
          {d.requires_acknowledgement && !d.acknowledged ? <Status tone="cau">Needs acknowledgement</Status> : null}
        </div>
      ))}
    </div>
  );
}

/* Right column: shortcuts & desk. */
function Desk({ contacts, leaveTo, name }: { contacts: Contact[]; leaveTo: string; name: string }) {
  const homeroom = contacts[0];
  return (
    <div className="panel">
      <SectionTitle title="Shortcuts & desk" aside={<LayoutGrid size={20} color="var(--faint)" />} />
      <div className="col xs">
        {homeroom ? (
          <a className="tile hov row-tile" href={homeroom.phone ? `tel:${homeroom.phone}` : homeroom.email ? `mailto:${homeroom.email}` : undefined}>
            <IconSq icon={Headset} kind="hover-fill" size="lg" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h4 className="t-hsm">Contact {homeroom.label ?? homeroom.role ?? "homeroom teacher"}</h4>
              <p className="t-bsm ink2" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{homeroom.name}{homeroom.availability ? ` • ${homeroom.availability}` : homeroom.phone ? ` • ${homeroom.phone}` : ""}</p>
              <div className="t-lmd brand-c" style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: 11 }}>{homeroom.phone ? "Call the school desk" : "Send a message"}<ArrowRight size={14} /></div>
            </div>
          </a>
        ) : null}
        <Link className="tile hov row-tile" to={leaveTo}>
          <IconSq icon={CalendarX2} kind="high" size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4 className="t-hsm">Submit future leave</h4>
            <p className="t-bsm ink2">Medical, family, or personal leave for {name}</p>
            <div className="t-lmd brand-c" style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: 11 }}>Open application form<ArrowRight size={14} /></div>
          </div>
        </Link>
        {contacts.slice(1, 3).map((c, i) => (
          <div className="tile row-tile" key={c.id ?? i}>
            <IconSq icon={Headset} kind="sec" size="lg" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h4 className="t-hsm">{c.name}</h4>
              <p className="t-bsm ink2">{[c.label ?? c.role ?? c.designation, c.phone, c.availability].filter(Boolean).join(" • ")}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionRequired({ leave, unreadDiary, leaveTo }: { leave: Leave | null; unreadDiary: DiaryItem | null; leaveTo: string }) {
  const pending = (leave ? 1 : 0) + (unreadDiary ? 1 : 0);
  if (!pending) return null;
  return (
    <div className="col sm">
      <SectionTitle dot title="Action required" aside={<Pill kind="cri">{pending} pending</Pill>} />
      <div className="grid2 even" style={{ gap: 12 }}>
        {leave ? (
          <div className="card hov" style={{ padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <span className="t-lmd cri-c" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Stethoscope size={18} />{leave.category_label ?? plain(leave.category)} leave form</span>
                <span className="lbl">{leave.submitted_at ? fmtDate(leave.submitted_at, { day: "numeric", month: "short" }) : ""}</span>
              </div>
              <h3 className="t-hsm" style={{ marginBottom: 2 }}>{leave.reason || "Leave request"}</h3>
              <p className="t-bsm ink2">{leave.duration_days} day{leave.duration_days === 1 ? "" : "s"} ({fmtDate(leave.starts_on, { day: "numeric", month: "short" })}{leave.ends_on !== leave.starts_on ? ` – ${fmtDate(leave.ends_on, { day: "numeric", month: "short" })}` : ""}) • Requested by {leave.requested_by_name}</p>
            </div>
            <div className="btnrow" style={{ paddingTop: 4 }}>
              <Link className="btn pri" style={{ flex: 1, background: "var(--brand-hover)" }} to={`${leaveTo}?focus=${leave.id}`}>Review & sign</Link>
              <Link className="btn" to={`${leaveTo}?focus=${leave.id}`} style={{ color: "var(--muted)" }}>Decline</Link>
            </div>
          </div>
        ) : null}
        {unreadDiary ? (
          <div className="card hov" style={{ padding: 20, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <span className="t-lmd brand-c" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><MailOpen size={18} />1 unread diary note</span>
                <span className="lbl">{fmtDate(unreadDiary.date, { day: "numeric", month: "short" })}</span>
              </div>
              <h3 className="t-hsm" style={{ marginBottom: 2 }}>{unreadDiary.author_name}{unreadDiary.subject ? ` (${unreadDiary.subject.name})` : ""}</h3>
              <p className="t-bsm ink2" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>“{unreadDiary.body || unreadDiary.title}”</p>
            </div>
            <div style={{ paddingTop: 4 }}><Link className="btn block" style={{ color: "var(--brand-text)" }} to="/diary">Open class diary<ArrowRight size={16} /></Link></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ParentHome() {
  const { child } = useAuth();
  const q = useQuery({ queryKey: ["parent-home", child], queryFn: () => familyApi.parentHome(child ?? undefined) });
  if (q.isPending) return <><Skeleton h={112} /><div className="grid12"><div className="col-8"><Skeleton h={420} /></div><div className="col-4"><Skeleton h={300} /></div></div></>;
  if (q.isError || !q.data) return <Empty>Could not load your child's day. {String((q.error as Error)?.message ?? "")}</Empty>;
  const d = q.data;
  const name = d.student.user.display_name.split(" ")[0]!;
  const m = d.semester_metrics;
  const unreadDiary = d.diary_preview.find((x) => x.requires_acknowledgement && !x.acknowledged) ?? null;
  const notice = d.diary_preview.find((x) => x.item_type === "announcement") ?? null;
  const last = [...d.today_schedule].sort((a, b) => a.period_number - b.period_number).at(-1);

  return (
    <>
      <StudentBanner student={d.student} presence={d.campus_presence} right={<ChildSwitcher current={d.student} siblings={d.siblings} />} />

      <div className="grid12">
        <div className="col-8 col">
          <ActionRequired leave={d.action_required} unreadDiary={unreadDiary} leaveTo="/leave" />
          <AcademicPulse slots={d.today_schedule} todayStatus={d.campus_presence?.direction === "in" ? "present" : null}
            metrics={{ periods: m.periods_today, homework: m.homework_due, dues: m.dues_status, dismissal: hm(last?.ends_at) || undefined }}
            threshold={m.attendance_threshold} attendance={m.attendance_percentage} />
          <DiaryPreview items={d.diary_preview} to="/diary" />
        </div>
        <div className="col-4 col">
          <Desk contacts={d.contacts} leaveTo="/leave" name={name} />
          {notice ? (
            <div className="tile" style={{ background: "var(--soft-2)", flexDirection: "row", alignItems: "center", gap: 12, padding: 20 }}>
              <BellRing size={28} color="var(--brand-text)" />
              <div style={{ minWidth: 0 }}><div className="t-hsm">{notice.title}</div><div className="t-bsm ink2">{notice.body.length > 90 ? `${notice.body.slice(0, 90)}…` : notice.body}</div></div>
            </div>
          ) : null}
          {d.unread_notifications ? <Link className="tile hov row-tile" to="/notifications"><IconSq icon={BellRing} kind="tint" size="lg" /><div><div className="t-hsm">{d.unread_notifications} unread notification{d.unread_notifications === 1 ? "" : "s"}</div><div className="t-bsm ink2">Open the inbox</div></div></Link> : null}
        </div>
      </div>
    </>
  );
}

export function StudentHome() {
  const q = useQuery({ queryKey: ["student-home"], queryFn: familyApi.studentHome });
  if (q.isPending) return <><Skeleton h={112} /><div className="grid12"><div className="col-8"><Skeleton h={420} /></div><div className="col-4"><Skeleton h={300} /></div></div></>;
  if (q.isError || !q.data) return <Empty>Could not load your day. {String((q.error as Error)?.message ?? "")}</Empty>;
  const d = q.data;
  const threshold = Number(d.term.threshold);
  const homework = d.diary_preview.filter((x) => x.item_type === "homework").length;
  const last = [...d.today_schedule].sort((a, b) => a.period_number - b.period_number).at(-1);
  const unreadDiary = d.diary_preview.find((x) => x.requires_acknowledgement && !x.acknowledged) ?? null;

  return (
    <>
      <StudentBanner student={d.student} presence={d.campus_presence} right={
        <div className="tabs"><span className="tab" aria-selected="true"><CalendarDays size={16} />{fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" })}</span><span className="tab">{d.term.name} · {d.term.academic_year}</span></div>
      } />

      <div className="grid12">
        <div className="col-8 col">
          <ActionRequired leave={null} unreadDiary={unreadDiary} leaveTo="/leave" />
          <AcademicPulse slots={d.today_schedule} todayStatus={d.today_attendance?.status ?? null}
            metrics={{ periods: d.today_schedule.length, homework, dismissal: hm(last?.ends_at) || undefined }}
            threshold={threshold} attendance={d.attendance.percentage} />
          <DiaryPreview items={d.diary_preview} to="/diary" />
        </div>
        <div className="col-4 col">
          <div className="panel">
            <SectionTitle title="Shortcuts & desk" aside={<LayoutGrid size={20} color="var(--faint)" />} />
            <div className="col xs">
              <Link className="tile hov row-tile" to="/leave"><IconSq icon={CalendarX2} kind={d.active_leave_count ? "cau" : "high"} size="lg" /><div><div className="t-hsm">{d.active_leave_count ? `${d.active_leave_count} leave request${d.active_leave_count === 1 ? "" : "s"} in progress` : "Request leave"}</div><div className="t-bsm ink2">Your guardian authorises first, then the school decides.</div></div></Link>
              <Link className="tile hov row-tile" to="/attendance"><IconSq icon={BadgeCheck} kind="hover-fill" size="lg" /><div><div className="t-hsm">Attendance {d.attendance.percentage.toFixed(1)}%</div><div className="t-bsm ink2">{d.attendance.present} of {d.attendance.total} days this term · threshold {threshold}%</div></div></Link>
              <Link className="tile hov row-tile" to="/notifications"><IconSq icon={BellRing} kind={d.unread_notifications ? "tint" : "sec"} size="lg" /><div><div className="t-hsm">{d.unread_notifications ? `${d.unread_notifications} unread` : "Inbox clear"}</div><div className="t-bsm ink2">Notifications from the school</div></div></Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

