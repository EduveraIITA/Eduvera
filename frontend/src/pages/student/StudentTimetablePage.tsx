import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BellRing,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  MapPin,
  X,
} from "lucide-react";

import { schoolClock } from "../../lib/schoolTime";
import {DayPlanNotice,type PublishedDayNotice} from '../../features/day-plans/DayPlanNotice';
import { TimetableNavigator, type TimetableSummary, type TimetableView } from "../../features/timetable/TimetableNavigator";
import { FamilyScheduleAgenda } from "../../features/timetable/FamilyScheduleAgenda";
import { TimetableRehearsalStrip } from "../../features/planner/TimetableRehearsalStrip";
import { timetableRehearsalInstant, type TimetableRehearsalIndicator } from "../../features/planner/rehearsal";
import { StudentShell, type StudentRouteMap } from "./StudentShell";
import { ParentShell } from "../parent/ParentShell";
import type { ParentChildSummary, ParentPageAction } from "../parent/parentTypes";
import { type SchoolDayKey, type TimetableDay, type TimetablePeriod } from "./student-timetable-data";
import "./student-pages.css";

const bellAlertStorageKey = "omnischool.timetable.bell-alerts";

const weekdayKeys: SchoolDayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function timeMinutes(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (match[3]?.toUpperCase() === "PM" && hours !== 12) hours += 12;
  if (match[3]?.toUpperCase() === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function storedBellPreference(defaultValue: boolean) {
  if (typeof window === "undefined") return defaultValue;
  const stored = window.localStorage.getItem(bellAlertStorageKey);
  return stored === null ? defaultValue : stored === "true";
}

function periodRange(period: TimetablePeriod) {
  return period.endTime ? `${period.time} - ${period.endTime}` : period.time;
}

function dateLabelForStudent(value?: string) {
  if (!value) return "Selected school day";
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export interface StudentTimetablePageProps {
  scheduleLoading?: boolean;
  dayPlan?:PublishedDayNotice|null;selectedDate?:string;onDateChange?:(date:string)=>void;
  view?: TimetableView;
  onViewChange?: (view: TimetableView) => void;
  onNavigate?: (date: string, view: TimetableView) => void;
  summary?: TimetableSummary;
  summaryLoading?: boolean;
  summaryError?: string;
  onSummaryRetry?: () => void;
  days: TimetableDay[];
  audience?: "student" | "parent";
  child?: ParentChildSummary;
  onSelectChild?: (childId: string) => ParentPageAction;
  className: string;
  studentName: string;
  termLabel: string;
  routes?: Partial<StudentRouteMap>;
  onDownload?: () => void | Promise<void>;
  onBellAlertsChange?: (enabled: boolean) => void;
  attentionStatus?: ReactNode;
  focusPublishedSource?: boolean;
  rehearsal?: TimetableRehearsalIndicator | null;
}

function TimetableShell({
  audience,
  child,
  onSelectChild,
  routes,
  className,
  children,
}: {
  audience: "student" | "parent";
  child?: ParentChildSummary;
  onSelectChild?: (childId: string) => ParentPageAction;
  routes?: Partial<StudentRouteMap>;
  className?: string;
  children: ReactNode;
}) {
  if (audience === "parent") {
    return <ParentShell active="timetable" pageLabel="Timetable" child={child} onSelectChild={onSelectChild}>{children}</ParentShell>;
  }
  return <StudentShell activeNav="classes" variant="platform" routes={routes} className={className}>{children}</StudentShell>;
}

export function StudentTimetablePage({
  scheduleLoading = false,
  dayPlan,selectedDate,onDateChange,
  view = "day",
  onViewChange,
  onNavigate,
  summary,
  summaryLoading,
  summaryError,
  onSummaryRetry,
  days,
  audience = "student",
  child,
  onSelectChild,
  className,
  studentName,
  termLabel,
  routes,
  onBellAlertsChange,
  attentionStatus,
  focusPublishedSource = false,
  rehearsal,
}: StudentTimetablePageProps) {
  const [bellAlerts, setBellAlerts] = useState(() => storedBellPreference(false));
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [selectedPeriod, setSelectedPeriod] = useState<{ day: TimetableDay; period: TimetablePeriod } | null>(null);
  const publishedSourceRef = useRef<HTMLElement>(null);
  const currentSchoolClock = schoolClock(timetableRehearsalInstant(rehearsal, now));
  const todayKey = weekdayKeys[currentSchoolClock.weekday];
  const nowMinutes = currentSchoolClock.minutes;
  const today = days.find((day) => day.key === todayKey&&(!day.isoDate||day.isoDate===currentSchoolClock.date));
  const currentPeriod = today?.periods.find((period) => {
    const starts = timeMinutes(period.time);
    const ends = timeMinutes(period.endTime);
    return !period.cancelled&&starts !== undefined && ends !== undefined && starts <= nowMinutes && nowMinutes < ends;
  });
  const nextPeriod = today?.periods.find((period) => {
    const starts = timeMinutes(period.time);
    return !period.cancelled&&starts !== undefined && starts > nowMinutes;
  });
  const bellPeriod = currentPeriod ?? nextPeriod;
  const bellTarget = currentPeriod ? timeMinutes(currentPeriod.endTime) : timeMinutes(nextPeriod?.time);
  const bellMinutes = bellTarget === undefined ? undefined : Math.max(0, bellTarget - nowMinutes);
  const todayKit = useMemo(() => {
    const source = selectedDate?days.find(d=>d.isoDate===selectedDate):today;
    const items = source?.periods
      .filter(p=>!p.cancelled)
      .flatMap(p=>p.materials ?? [])
      .filter((item): item is string => Boolean(item))
      .filter((item, index, all) => all.indexOf(item) === index)
      ?? [];
    return { day: source, items };
  }, [days, today,selectedDate]);
  const selectedKey = selectedDate
    ? weekdayKeys[new Date(`${selectedDate}T00:00:00Z`).getUTCDay()]
    : undefined;
  const displayDays = days.filter((day) => day.isoDate === selectedDate || (!day.isoDate && day.key === selectedKey));
  const navigator = selectedDate && onDateChange && onViewChange ? (
    <TimetableNavigator
      date={selectedDate}
      view={view}
      summary={summary}
      loading={summaryLoading}
      error={summaryError}
      contextLabel={audience === "parent" ? `${studentName}'s schedule` : "My class schedule"}
      onDateChange={onDateChange}
      onViewChange={onViewChange}
      onNavigate={onNavigate}
      onRetry={onSummaryRetry}
    />
  ) : null;

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!focusPublishedSource) return;
    const frame = window.requestAnimationFrame(() => {
      publishedSourceRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      publishedSourceRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusPublishedSource, selectedDate]);

  function toggleBellAlerts() {
    const enabled = !bellAlerts;
    setBellAlerts(enabled);
    window.localStorage.setItem(bellAlertStorageKey, String(enabled));
    onBellAlertsChange?.(enabled);
    setToast(enabled
      ? onBellAlertsChange
        ? `Bell alerts enabled for ${className}.`
        : "Bell reminder preference saved on this device. Push alerts are not active yet."
      : "Bell reminder preference paused.");
  }

  if (view === "year" || scheduleLoading) {
    return <TimetableShell audience={audience} child={child} onSelectChild={onSelectChild} routes={routes} className={className}>
      <div className="student-page-stack timetable-page">
        {rehearsal ? <TimetableRehearsalStrip rehearsal={rehearsal} /> : null}
        {navigator}
        {attentionStatus}
        {view !== "year" ? <div className="day-panel day-skeleton" role="status" aria-label="Loading selected day"><span /><span /></div> : null}
      </div>
    </TimetableShell>;
  }

  if (!days.length) {
    return (
      <TimetableShell audience={audience} child={child} onSelectChild={onSelectChild} routes={routes} className={className}>
        <div className="student-page-stack timetable-page">
          {rehearsal ? <TimetableRehearsalStrip rehearsal={rehearsal} /> : null}
          {navigator}
          {attentionStatus}
          <DayPlanNotice plan={dayPlan}/>
          <section ref={focusPublishedSource ? publishedSourceRef : undefined} tabIndex={focusPublishedSource ? -1 : undefined} className={`student-card student-empty-state timetable-empty-state${focusPublishedSource ? " is-attention-target" : ""}`}>
            <BookOpen size={24} />
            <div><strong>No timetable published</strong><p>No periods are scheduled for the selected date.</p></div>
          </section>
        </div>
      </TimetableShell>
    );
  }

  return (
    <TimetableShell audience={audience} child={child} onSelectChild={onSelectChild} routes={routes} className={className}>
      <div className="student-page-stack timetable-page">
        {rehearsal ? <TimetableRehearsalStrip rehearsal={rehearsal} /> : null}
        {navigator}
        {attentionStatus}
        <section className="timetable-intro">
          <header>
            <p className="workspace-context">{className} · {termLabel}</p>
            <button className={bellAlerts ? "square-soft-button is-active" : "square-soft-button"} type="button" aria-pressed={bellAlerts} aria-label="Save bell reminder preference" onClick={toggleBellAlerts}><Clock3 size={23} /></button>
          </header>
          {bellPeriod && (!selectedDate || selectedDate === currentSchoolClock.date) ? (
            <div className="next-bell-banner" aria-label={rehearsal ? "Simulated school day bell status" : "Today bell status"}>
              <span><BellRing size={19} /></span>
              <span><small>{rehearsal ? "Rehearsal · " : ""}{currentPeriod ? "Current period ends" : "Next bell"} <i /> <b>{bellMinutes ?? "-"} mins</b></small><strong>{bellPeriod.period} - {bellPeriod.subject}</strong></span>
              <ChevronRight size={19} />
            </div>
          ) : null}
        </section>

        <DayPlanNotice plan={dayPlan}/>

        {displayDays.length === 0 ? (
          <section ref={focusPublishedSource ? publishedSourceRef : undefined} tabIndex={focusPublishedSource ? -1 : undefined} className={`student-card student-empty-state timetable-empty-state${focusPublishedSource ? " is-attention-target" : ""}`}>
            <BookOpen size={24} />
            <div><strong>No periods scheduled</strong><p>This school day has no published classes.</p></div>
          </section>
        ) : <section
          ref={focusPublishedSource ? publishedSourceRef : undefined}
          className={`student-card timetable-week-chart${focusPublishedSource ? " is-attention-target" : ""}`}
          tabIndex={focusPublishedSource ? -1 : undefined}
          aria-labelledby="week-chart-heading"
        >
          <header>
            <div><h2 id="week-chart-heading">Period schedule</h2><p>{dateLabelForStudent(selectedDate)}</p></div>
            <strong>{displayDays.reduce((total, day) => total + day.periods.filter(p=>!p.cancelled).length, 0)} periods</strong>
          </header>
          <FamilyScheduleAgenda days={displayDays} currentPeriodId={currentPeriod?.id} currentLabel={rehearsal ? "Rehearsal now" : "Now"} onOpen={setSelectedPeriod} />
        </section>}

        {todayKit.items.length ? (
          <section className="student-card timetable-kit-card" aria-labelledby="timetable-kit-heading">
            <header><div><h2 id="timetable-kit-heading">{todayKit.day?.isoDate===currentSchoolClock.date?"Today's kit":"Materials to bring"}</h2><p>{todayKit.day?.longLabel ?? "Today"} · requested by your school.</p></div><strong>{todayKit.items.length}</strong></header>
            <div>{todayKit.items.map((item) => <span key={item}><Check size={13} />{item}</span>)}</div>
          </section>
        ) : null}
      </div>
      {selectedPeriod ? (
        <div className="student-sheet-backdrop" role="presentation" onClick={() => setSelectedPeriod(null)}>
          <section className="student-sheet timetable-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="period-detail-heading" onClick={(event) => event.stopPropagation()}>
            <div className="student-sheet__handle" />
            <header>
              <span className={`period-detail-icon tone-${selectedPeriod.period.tone}`}><BookOpen size={20} /></span>
              <div><p>{selectedPeriod.day.longLabel} - {selectedPeriod.period.period}</p><h2 id="period-detail-heading">{selectedPeriod.period.subject}</h2></div>
              <button className="student-icon-button" type="button" onClick={() => setSelectedPeriod(null)} aria-label="Close period details"><X size={18} /></button>
            </header>
            <div className="period-detail-grid">
              <span><Clock3 size={15} /><strong>{periodRange(selectedPeriod.period)}</strong><small>Time</small></span>
              <span><MapPin size={15} /><strong>{selectedPeriod.period.room ?? "Room pending"}</strong><small>Room</small></span>
            </div>
            <div className="period-detail-copy">
              <span><strong>{selectedPeriod.period.teacher ?? "Faculty assignment pending"}</strong><small>Teacher</small></span>
              {selectedPeriod.period.detail ? <p>{selectedPeriod.period.detail}</p> : null}
              {selectedPeriod.period.flag ? <em>{selectedPeriod.period.flag}</em> : null}
              {!selectedPeriod.period.cancelled&&selectedPeriod.period.materials?.length?<p>Bring: {selectedPeriod.period.materials.join(' · ')}</p>:null}
            </div>
          </section>
        </div>
      ) : null}
      {toast && <div className="student-toast" role="status"><Check size={18} />{toast}</div>}
    </TimetableShell>
  );
}
