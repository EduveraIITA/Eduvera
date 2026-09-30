import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {DayPlanNotice,type PublishedDayNotice} from '../../features/day-plans/DayPlanNotice';
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpenText,
  Bot,
  CalendarCheck2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  MapPin,
  PackageCheck,
  Sparkles,
  X,
} from "lucide-react";

import { schoolClock } from "../../lib/schoolTime";
import { StudentShell } from "./StudentShell";
import { StudentIdentityCard } from "./StudentIdentityCard";
import type { HomeAction } from "../../features/home-actions/types";
import { HomeActionDeck, HomeActionSpotlight } from "../../features/home-actions/HomeActionDeck";
import "./student-pages.css";

export interface StudentHomePeriod {
  materials?:string[];
  id: string;
  period: number;
  subject: string;
  startsAt: string;
  endsAt: string;
  teacher: string;
  room: string;
  state: "complete" | "current" | "upcoming";
}

export interface StudentHomeDiaryItem {
  id: string;
  title: string;
  detail: string;
  label: string;
}

export interface StudentHomeData {
  dayPlan?:PublishedDayNotice|null;
  studentName: string;
  avatarUrl?: string;
  className: string;
  rollNumber: string;
  studentId: string;
  termLabel: string;
  dateLabel: string;
  presence: {
    label: string;
    detail: string;
    verified: boolean;
  };
  attendancePercent: number;
  attendanceThreshold: number;
  periodsToday: number;
  activeLeaveCount: number;
  unreadNotifications: number;
  schedule: StudentHomePeriod[];
  diary: StudentHomeDiaryItem[];
  homeActions: HomeAction[];
}

interface StudentHomeKitItem {
  id: string;
  label: string;
  detail: string;
}

function greeting() {
  const hour = Math.floor(schoolClock().minutes / 60);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function compactSubject(subject: string) {
  return subject
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\b(General|Theory|Literature|Practicum|Science)\b/gi, "")
    .trim() || subject;
}

function kitForPeriod(period: StudentHomePeriod): string | null {
  const subject = period.subject.toLowerCase();
  if (/lunch|recess|break|free|dismissal/.test(subject)) return null;
  if (/assembly|yoga/.test(subject)) return "House uniform";
  if (/lab|physics|chemistry|biology|computer/.test(subject)) return "Lab manual";
  if (/club/.test(subject)) return "Club kit";
  if (/games|physical|pe|sport|house/.test(subject)) return "Sports kit";
  if (/social|history|geography|civics|polity/.test(subject)) return "SST notebook";
  if (/art|craft/.test(subject)) return "Art kit";
  if (/music|choir/.test(subject)) return "Music folder";
  if (/quiz/.test(subject)) return "Quiz prep";
  if (/math/.test(subject)) return "Math notebook";
  if (/english|debate|library/.test(subject)) return "Reader";
  if (/hindi|sanskrit|french|language/.test(subject)) return "Language notebook";
  return `${compactSubject(period.subject)} notebook`;
}

function todaysKit(schedule: StudentHomePeriod[]): StudentHomeKitItem[] {
  const seen = new Map<string, StudentHomeKitItem>();
  for (const period of schedule) {
    const labels=period.materials??[kitForPeriod(period)];
    for(const label of labels){if(!label||seen.has(label))continue;seen.set(label,{id:`material-${label.toLowerCase()}`,label,detail:`For ${period.subject}`});}
  }
  if (!seen.has("School ID")) {
    seen.set("School ID", { id: "school-id", label: "School ID", detail: "Keep it ready for entry" });
  }
  if (!seen.has("Water bottle")) {
    seen.set("Water bottle", { id: "water-bottle", label: "Water bottle", detail: "Refill before first period" });
  }
  return Array.from(seen.values()).slice(0, 6);
}

function readKitState(storageKey: string): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

export function StudentHomePage({ data }: { data: StudentHomeData }) {
  const navigate = useNavigate();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [kitOpen, setKitOpen] = useState(false);
  const periodRailRef = useRef<HTMLDivElement | null>(null);
  const periodCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const scheduleListRef = useRef<HTMLDivElement | null>(null);
  const scheduleRowRefs = useRef<Record<string, HTMLElement | null>>({});
  const kitStorageKey = `omnischool.student.today-kit.${data.studentId}.${data.dateLabel}`;
  const [checkedKit, setCheckedKit] = useState(() => readKitState(kitStorageKey));
  const currentPeriod = useMemo(
    () => data.schedule.find((period) => period.state === "current"),
    [data.schedule],
  );
  const focusPeriod = useMemo(
    () => currentPeriod ?? data.schedule.find((period) => period.state === "upcoming") ?? data.schedule.at(-1),
    [currentPeriod, data.schedule],
  );
  const periodRail = useMemo(() => {
    if (!focusPeriod) return [];
    const focusIndex = data.schedule.findIndex((period) => period.id === focusPeriod.id);
    return data.schedule.filter((_, index) => Math.abs(index - focusIndex) <= 1);
  }, [data.schedule, focusPeriod]);
  const attendanceSafe = data.attendancePercent >= data.attendanceThreshold;
  const attendanceScoreTone = attendanceSafe
    ? "is-green"
    : data.attendancePercent >= data.attendanceThreshold - 10
      ? "is-yellow"
      : "is-orange";
  const kitItems = useMemo(() => todaysKit(data.schedule), [data.schedule]);
  const packedCount = kitItems.filter((item) => checkedKit[item.id]).length;
  const [primaryAction, ...remainingActions] = data.homeActions;
  useEffect(() => {
    window.localStorage.setItem(kitStorageKey, JSON.stringify(checkedKit));
  }, [checkedKit, kitStorageKey]);

  useLayoutEffect(() => {
    if (!focusPeriod) return;
    const alignFocusedPeriod = () => {
      const card = periodCardRefs.current[focusPeriod.id];
      const rail = periodRailRef.current;
      if (card && rail) {
        const left = card.offsetLeft - (rail.clientWidth / 2) + (card.clientWidth / 2);
        if (typeof rail.scrollTo === "function") rail.scrollTo({ left, behavior: "auto" });
        else rail.scrollLeft = left;
      }
      const row = scheduleRowRefs.current[focusPeriod.id];
      const list = scheduleListRef.current;
      if (row && list) {
        const top = row.offsetTop - (list.clientHeight / 2) + (row.clientHeight / 2);
        if (typeof list.scrollTo === "function") list.scrollTo({ top, behavior: "auto" });
        else list.scrollTop = top;
      }
    };
    alignFocusedPeriod();
    const frame = window.requestAnimationFrame(alignFocusedPeriod);
    return () => window.cancelAnimationFrame(frame);
  }, [focusPeriod, scheduleOpen]);

  useEffect(() => {
    if (!scheduleOpen && !kitOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScheduleOpen(false);
      if (event.key === "Escape") setKitOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [kitOpen, scheduleOpen]);

  return (
    <StudentShell activeNav="home" section="Home" className={data.className} notificationCount={data.unreadNotifications}>
      <div className="student-page-stack student-home-page">
        <div className="student-home-anchor">
          <StudentIdentityCard identity={data} eyebrow={greeting()} />
          {primaryAction ? <HomeActionSpotlight action={primaryAction} /> : null}
        </div>
        <DayPlanNotice plan={data.dayPlan} href="/student/timetable"/>
        <HomeActionDeck actions={remainingActions.slice(0, 3)} title="Later" variant="quiet" />

        <section className={`student-home-presence ${data.presence.verified ? "is-verified" : ""}`} aria-label="Today's attendance status">
          <span className="student-home-presence__icon"><CheckCircle2 size={22} /></span>
          <span><small>Today's presence</small><strong>{data.presence.label}</strong><em>{data.presence.detail}</em></span>
          <button type="button" onClick={() => navigate("/student/attendance")}>Details <ChevronRight size={16} /></button>
        </section>

        {focusPeriod ? (
          <section className="student-home-period-focus" aria-labelledby="student-home-class-heading">
            <header>
              <div><h2 id="student-home-class-heading">Today's flow</h2></div>
              <button type="button" onClick={() => navigate("/student/timetable")}>Timetable <ArrowRight size={15} /></button>
            </header>
            <div className="student-home-period-rail" ref={periodRailRef} aria-label="Previous current and next periods">
              {periodRail.map((period) => (
                <article
                  key={period.id}
                  ref={(element) => { periodCardRefs.current[period.id] = element; }}
                  className={`student-card student-home-class is-${period.state} ${period.id === focusPeriod.id ? "is-focus" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setScheduleOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setScheduleOpen(true);
                    }
                  }}
                  aria-label={`Open full schedule. Period ${period.period}, ${period.subject}, ${period.startsAt} to ${period.endsAt}`}
                >
                  <header>
                    <span>{period.state === "current" ? <i className="breathing-indicator" aria-hidden="true" /> : <Clock3 size={16} />}{period.state === "current" ? "Happening now" : period.state === "complete" ? "Previous period" : "Next period"}</span>
                    <b>Period {period.period}</b>
                  </header>
                  <div>
                    <span className="student-home-class__icon"><BookOpenText size={24} /></span>
                    <span><h3>{period.subject}</h3><p>{period.teacher}</p></span>
                  </div>
                  <footer><span><Clock3 size={14} />{period.startsAt} - {period.endsAt}</span><span><MapPin size={14} />{period.room}</span></footer>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="student-card student-home-no-class">
            <CalendarClock size={23} /><span><strong>No more classes today</strong><small>Open the timetable to plan the next school day.</small></span>
            <button type="button" onClick={() => navigate("/student/timetable")}>View timetable</button>
          </section>
        )}

        <section className="student-home-overview" aria-labelledby="student-home-overview-heading">
          <header><div><h2 id="student-home-overview-heading">Your day at a glance</h2></div><b>Live</b></header>
          <div>
            <button type="button" onClick={() => navigate("/student/attendance")}>
              <span className="tone-blue"><ClipboardCheck size={19} /></span><small>Attendance</small><strong className={attendanceScoreTone}>{data.attendancePercent.toFixed(1)}%</strong><em className={attendanceSafe ? "is-safe" : "is-warning"}>{attendanceSafe ? "Safe zone" : "Needs attention"}</em>
            </button>
            <button type="button" onClick={() => navigate("/student/timetable")}>
              <span className="tone-violet"><CalendarClock size={19} /></span><small>Classes today</small><strong>{data.periodsToday}</strong><em>Published periods</em>
            </button>
            <button type="button" onClick={() => navigate("/student/leave")}>
              <span className="tone-teal"><CalendarCheck2 size={19} /></span><small>Active leave</small><strong>{data.activeLeaveCount}</strong><em>{data.activeLeaveCount ? "Track approval" : "No requests"}</em>
            </button>
            <button type="button" onClick={() => setKitOpen(true)}>
              <span className="tone-amber"><Sparkles size={19} /></span><small>Today checklist</small><strong>{packedCount}/{kitItems.length}</strong><em>{packedCount === kitItems.length ? "Ready for school" : "Tap to pack"}</em>
            </button>
          </div>
        </section>

        <section className="student-home-actions" aria-labelledby="student-home-actions-heading">
          <header><h2 id="student-home-actions-heading">Quick actions</h2></header>
          <div>
            <button type="button" onClick={() => navigate("/student/leave/new")}><FileText size={19} /><span><strong>Apply leave</strong><small>Start a request</small></span><ChevronRight size={17} /></button>
            <button type="button" onClick={() => navigate("/student/copilot")}><Bot size={19} /><span><strong>Ask Copilot</strong><small>Attendance guidance</small></span><ChevronRight size={17} /></button>
          </div>
        </section>

        {data.diary.length ? <section className="student-card student-home-diary" aria-labelledby="student-home-diary-heading">
          <header><div><span>Class desk</span><h2 id="student-home-diary-heading">Today's diary</h2></div><span>{data.diary.length} items</span></header>
          {data.diary.map((item) => (
            <article key={item.id}><span><BookOpenText size={18} /></span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.label}</small></div></article>
          ))}
        </section> : null}

        {scheduleOpen ? (
          <div className="student-sheet-backdrop" onClick={() => setScheduleOpen(false)}>
            <section
              className="student-sheet student-home-schedule-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="student-home-schedule-sheet-heading"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="student-sheet__handle" />
              <header>
                <div>
                  <span>Today</span>
                  <h2 id="student-home-schedule-sheet-heading">Class schedule</h2>
                  <p>Full class flow for {data.dateLabel}.</p>
                </div>
                <button className="student-icon-button" type="button" onClick={() => setScheduleOpen(false)} aria-label="Close class schedule">
                  <X size={19} />
                </button>
              </header>
              {data.schedule.length ? (
                <div className="student-home-schedule__list" ref={scheduleListRef}>
                  {data.schedule.map((period) => (
                    <article
                      key={period.id}
                      ref={(element) => { scheduleRowRefs.current[period.id] = element; }}
                      className={`is-${period.state} ${period.id === focusPeriod?.id ? "is-focus" : ""}`}
                    >
                      <span><small>P{period.period}</small><strong>{period.startsAt}</strong></span>
                      <i />
                      <span><strong>{period.subject}</strong><small>{period.room} - {period.teacher}</small></span>
                      {period.state === "current" ? <b>Now</b> : period.state === "complete" ? <CheckCircle2 size={16} /> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="student-home-empty"><CalendarClock size={20} /><span><strong>No periods published</strong><small>Your school has not published today's schedule.</small></span></div>
              )}
              <button className="student-home-schedule-sheet__timetable" type="button" onClick={() => navigate("/student/timetable")}>
                Open weekly timetable <ArrowRight size={15} />
              </button>
            </section>
          </div>
        ) : null}
        {kitOpen ? (
          <div className="student-sheet-backdrop" onClick={() => setKitOpen(false)}>
            <section
              className="student-sheet student-home-checklist-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="student-home-checklist-heading"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="student-sheet__handle" />
              <header>
                <div>
                  <span>Today</span>
                  <h2 id="student-home-checklist-heading">Today checklist</h2>
                  <p>{packedCount}/{kitItems.length} packed for {data.dateLabel}.</p>
                </div>
                <button className="student-icon-button" type="button" onClick={() => setKitOpen(false)} aria-label="Close today checklist">
                  <X size={19} />
                </button>
              </header>
              <div className="student-home-kit__list">
                {kitItems.map((item) => {
                  const checked = Boolean(checkedKit[item.id]);
                  return (
                    <button
                      key={item.id}
                      className={checked ? "is-checked" : ""}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => setCheckedKit((current) => ({ ...current, [item.id]: !current[item.id] }))}
                    >
                      <span>{checked ? <Check size={16} /> : <PackageCheck size={16} />}</span>
                      <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </StudentShell>
  );
}
