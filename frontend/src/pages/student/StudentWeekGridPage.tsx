import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BellRing,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FlaskConical,
  Grid3X3,
  RefreshCw,
  Shirt,
  Sparkles,
} from "lucide-react";

import { downloadTextPdf } from "../../lib/simplePdf";
import { schoolDateToday } from "../../lib/schoolTime";
import { StudentShell, type StudentRouteMap } from "./StudentShell";
import { weekGridRows, type SchoolDayKey, type WeekGridRow } from "./student-timetable-data";
import "./student-pages.css";

const bellAlertStorageKey = "omnischool.timetable.bell-alerts";

function storedBellPreference() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(bellAlertStorageKey) === "true";
}

type GridFilter = "all" | "core" | "humanities" | "lab" | "activity";
const weekdayKeys: Array<SchoolDayKey | undefined> = [undefined, "mon", "tue", "wed", "thu", "fri", "sat"];

export interface StudentWeekGridPageProps {
  rows?: WeekGridRow[];
  weekOffset?: number;
  selectedDate?: string;
  className?: string;
  routes?: Partial<StudentRouteMap>;
  onOpenDayView?: () => void;
  onWeekChange?: (weekOffset: number) => void;
  onSyncCalendar?: () => void | Promise<void>;
  onDownload?: () => void | Promise<void>;
  onBellAlertsChange?: (enabled: boolean) => void;
}

const filterLabels: Array<[GridFilter, string]> = [
  ["all", "All Subjects"],
  ["core", "Core (Math, Sci, Eng)"],
  ["humanities", "Humanities"],
  ["lab", "Labs & IT"],
  ["activity", "Sports & Activity"],
];

function weekLabel(selectedDate?: string, offset = 0) {
  const start = new Date(`${selectedDate ?? schoolDateToday()}T00:00:00`);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 5);
  const date = (value: Date) => value.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  return `${date(start)} - ${date(end)} ${end.getFullYear()}`;
}

function currentDayForWeek(selectedDate?: string, offset = 0) {
  const start = new Date(`${selectedDate ?? schoolDateToday()}T00:00:00`);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const today = new Date(`${schoolDateToday()}T00:00:00`);
  today.setHours(0, 0, 0, 0);
  return today >= start && today <= end ? weekdayKeys[today.getDay()] : undefined;
}

function scheduleSummary(rows: WeekGridRow[], group: GridFilter) {
  return rows.flatMap((row) => {
    const subjects = row.cells.filter((cell) => cell.group === group).map((cell) => cell.label);
    return subjects.length > 0 ? [`${row.label}: ${subjects.join(", ")}`] : [];
  });
}

function cellColumnKey(cell: WeekGridRow["cells"][number], index: number) {
  return cell.period ?? `position-${index}`;
}

export function StudentWeekGridPage({
  rows = weekGridRows,
  weekOffset: controlledWeekOffset,
  selectedDate,
  className,
  routes,
  onOpenDayView,
  onWeekChange,
  onSyncCalendar,
  onDownload,
  onBellAlertsChange,
}: StudentWeekGridPageProps) {
  const navigate = useNavigate();
  const [localWeekOffset, setLocalWeekOffset] = useState(0);
  const weekOffset = controlledWeekOffset ?? localWeekOffset;
  const [filter, setFilter] = useState<GridFilter>("all");
  const [alertsEnabled, setAlertsEnabled] = useState(storedBellPreference);
  const [toast, setToast] = useState("");
  const currentWeekLabel = useMemo(
    () => weekLabel(selectedDate, controlledWeekOffset === undefined ? weekOffset : 0),
    [controlledWeekOffset, selectedDate, weekOffset],
  );
  const effectiveOffset = controlledWeekOffset === undefined ? weekOffset : 0;
  const currentDay = useMemo(
    () => currentDayForWeek(selectedDate, effectiveOffset),
    [effectiveOffset, selectedDate],
  );
  const columns = useMemo(() => {
    const unique = new Map<string, { key: string; period: string; sort: number }>();
    rows.forEach((row) => row.cells.forEach((cell, index) => {
      const key = cellColumnKey(cell, index);
      if (unique.has(key)) return;
      const periodNumber = cell.period?.match(/\d+/)?.[0];
      unique.set(key, { key, period: cell.period ?? `P${index + 1}`, sort: periodNumber ? Number(periodNumber) : index + 100 });
    }));
    return [...unique.values()]
      .sort((a, b) => a.sort - b.sort)
      .map((column) => {
        const times = new Set(rows.flatMap((row) => row.cells.flatMap((cell, index) =>
          cellColumnKey(cell, index) === column.key && cell.time ? [cell.time] : [],
        )));
        return { ...column, time: times.size === 1 ? [...times][0] : undefined };
      });
  }, [rows]);
  const labSchedule = useMemo(() => scheduleSummary(rows, "lab"), [rows]);
  const activitySchedule = useMemo(() => scheduleSummary(rows, "activity"), [rows]);
  const periodCount = rows.reduce(
    (total, row) => total + row.cells.filter((cell) => cell.label !== "☕").length,
    0,
  );

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function moveWeek(amount: number) {
    const next = weekOffset + amount;
    if (controlledWeekOffset === undefined) setLocalWeekOffset(next);
    onWeekChange?.(next);
  }

  async function syncCalendar() {
    if (!onSyncCalendar) return;
    await onSyncCalendar();
    setToast("Calendar synced with the latest school timetable.");
  }

  async function download() {
    await onDownload?.();
    if (!onDownload) {
      downloadTextPdf(
        `${(className ?? "student").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-timetable.pdf`,
        `Edura OS - ${className ?? "Student"} - ${currentWeekLabel}`,
        rows.map((row) => `${row.label}: ${row.cells.map((cell) => cell.label).join(" | ")}`),
      );
    }
    setToast("Weekly PDF timetable download started.");
  }

  function toggleAlerts() {
    const enabled = !alertsEnabled;
    setAlertsEnabled(enabled);
    window.localStorage.setItem(bellAlertStorageKey, String(enabled));
    onBellAlertsChange?.(enabled);
    setToast(enabled
      ? onBellAlertsChange
        ? "Bell alerts enabled."
        : "Bell reminder preference saved on this device. Push alerts are not active yet."
      : "Bell reminder preference paused.");
  }

  return (
    <StudentShell activeNav="classes" variant="edura" routes={routes} className={className}>
      <div className="student-page-stack week-grid-page">
        <section className="week-grid-title">
          <header><p className="workspace-context">{className} · {currentWeekLabel}</p><button className="square-soft-button" type="button" aria-label={onSyncCalendar ? "Sync calendar" : "Calendar sync unavailable"} disabled={!onSyncCalendar} onClick={syncCalendar}><RefreshCw size={20} /></button></header>
          <div className="segmented-control" role="tablist" aria-label="Timetable view">
            <button type="button" role="tab" aria-selected="false" onClick={onOpenDayView ?? (() => navigate("/student/timetable"))}>Day View</button>
            <button className="is-active" type="button" role="tab" aria-selected="true">Week Grid</button>
          </div>
        </section>

        <section className="student-card week-navigation" aria-label="Choose school week">
          <div><button type="button" aria-label="Previous week" onClick={() => moveWeek(-1)}><ChevronLeft size={18} /></button><strong><CalendarDays size={16} />{currentWeekLabel}</strong><button type="button" aria-label="Next week" onClick={() => moveWeek(1)}><ChevronRight size={18} /></button></div>
          <p><span>{rows.length} Days</span><i /> <span>{periodCount} Periods</span>{rows.some((row) => row.day === "sat") ? <><i /> <span className="highlight">Sat schedule</span></> : null}</p>
        </section>

        {rows.length > 0 ? <><div className="horizontal-pills week-filter-pills" role="tablist" aria-label="Filter timetable subjects">
          {filterLabels.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}><i className={`filter-dot filter-dot--${value}`} />{label}</button>)}
        </div>

        <div className="schedule-by-day-heading"><h2>Schedule By Day</h2><span><i />Published timetable</span></div>

        <section className="student-card weekly-matrix" aria-labelledby="weekly-matrix-heading">
          <header><span className="section-heading__icon"><Grid3X3 size={18} /></span><span><h2 id="weekly-matrix-heading">Weekly Period Matrix</h2><p>{periodCount} periods - Swipe horizontally</p></span><b><Sparkles size={14} />Scroll</b></header>
          <div className="weekly-matrix__scroller" tabIndex={0} aria-label="Horizontally scrollable weekly timetable">
            <table>
              <thead><tr><th>Day</th>{columns.map(({ key, period, time }) => <th key={key}>{period}{time && <small>{time.replace(/\s(?:AM|PM)$/, "")}</small>}</th>)}</tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.day} className={row.day === currentDay ? "is-today" : ""}>
                    <th>{row.label}{row.day === currentDay && <i />}</th>
                    {columns.map((column) => {
                      const cell = row.cells.find((candidate, index) => cellColumnKey(candidate, index) === column.key);
                      return <td key={`${row.day}-${column.key}`} className={cell && filter !== "all" && cell.group !== filter ? "is-muted" : ""}>{cell ? <span className={`tone-${cell.tone}`}>{cell.label}</span> : null}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="student-card weekly-kit" aria-labelledby="weekly-kit-heading">
          <header><span className="section-heading__icon"><Shirt size={18} /></span><span><h2 id="weekly-kit-heading">Published Schedule Notes</h2><p>Derived from the current school timetable</p></span><b>Live data</b></header>
          <div className="weekly-kit__items">
            {activitySchedule.length > 0 && <article><span><Shirt size={18} /></span><div><header><strong>Activity periods</strong><b>Published</b></header><p>{activitySchedule.join(" - ")}</p></div></article>}
            {labSchedule.length > 0 && <article><span><FlaskConical size={18} /></span><div><header><strong>Lab periods</strong><b>Published</b></header><p>{labSchedule.join(" - ")}</p></div></article>}
            {activitySchedule.length === 0 && labSchedule.length === 0 && <article><span><Grid3X3 size={18} /></span><div><header><strong>No additional schedule notes</strong><b>Current</b></header><p>Only the published class periods are shown for this week.</p></div></article>}
          </div>
          <div className="weekly-kit__actions"><button type="button" onClick={download}><Download size={17} />Download PDF</button><button className={alertsEnabled ? "is-active" : ""} type="button" aria-pressed={alertsEnabled} aria-label="Save bell reminder preference" onClick={toggleAlerts}><BellRing size={17} />{alertsEnabled ? "Reminder Saved" : "Bell Reminder"}</button></div>
        </section>
        </> : <section className="student-card student-empty-state"><CalendarDays size={23} /><div><strong>No timetable published</strong><p>The school has not added periods for this week.</p></div></section>}
      </div>
      {toast && <div className="student-toast" role="status"><Check size={18} />{toast}</div>}
    </StudentShell>
  );
}
