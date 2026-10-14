import { useMemo, useSyncExternalStore } from "react";
import FullCalendar, { type DateClickInfo, type DateSelectInfo, type EventClickInfo, type EventDisplayInfo, type EventDropInfo, type EventInput, type EventResizeDoneInfo } from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import monarchThemePlugin from "@fullcalendar/react/themes/monarch";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/monarch/theme.css";
import "@fullcalendar/react/themes/monarch/palettes/blue.css";
import type { CampusEventDto } from "../campus-events/types";
import type { PlannerPeriod } from "./PrincipalPlannerRoute";

const INDIA_TIME_ZONE = "Asia/Kolkata";

export interface TimelineSlot { date: string; startsAt: string; endsAt: string; }
export interface TimelineMove extends TimelineSlot { periodId: string; }
interface TimeRange { start: number; end: number; }
const mobileQuery = "(max-width: 760px)";
const subscribeMobile = (callback: () => void) => {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};

export function minutesFromTime(value: string) {
  const [hours = 0, minutes = 0] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(value: number) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, value));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function timelineBounds(ranges: TimeRange[], currentMinutes?: number) {
  const earliest = ranges.length ? Math.min(...ranges.map((range) => range.start)) : 8 * 60;
  const latest = ranges.length ? Math.max(...ranges.map((range) => range.end)) : 16 * 60;
  const start = Math.max(0, Math.floor((earliest - 30) / 60) * 60);
  const currentEnd = currentMinutes === undefined ? 16 * 60 : Math.ceil((currentMinutes + 45) / 60) * 60;
  const end = Math.min(24 * 60, Math.max(16 * 60, currentEnd, Math.ceil(latest / 60) * 60));
  return { start, end };
}

function localParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: INDIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}`, minutes: Number(part("hour")) * 60 + Number(part("minute")) };
}

function plusMinutes(time: string, minutes: number) { return timeFromMinutes(minutesFromTime(time) + minutes); }

function periodEvents(periods: PlannerPeriod[], date: string, grouped: boolean): EventInput[] {
  if (!grouped) return periods.map((period) => ({
    id: `period:${period.id}:${date}`, title: period.display_title,
    start: `${date}T${period.starts_at.slice(0, 5)}`, end: `${date}T${period.ends_at.slice(0, 5)}`,
    editable: period.version_state === "draft", durationEditable: period.version_state === "draft", startEditable: period.version_state === "draft",
    color: period.slot_type === "class" ? "#eaf1ff" : "#f1f4f6", contrastColor: "#15345b",
    extendedProps: { kind: period.slot_type, meta: period.slot_type === "class" ? `${period.teacher_name ?? "Teacher needed"}${period.room ? ` · ${period.room}` : ""}` : "", periodId: period.id, date, isDraft: period.version_state === "draft" },
  }));
  const groups = periods.reduce((result, period) => {
    const key = `${period.starts_at}:${period.ends_at}:${period.period_number}`;
    result.set(key, [...(result.get(key) ?? []), period]); return result;
  }, new Map<string, PlannerPeriod[]>());
  return [...groups.entries()].map(([key, items]) => {
    const first = items[0]!; const subjects = new Set(items.filter((period) => period.slot_type === "class").map((period) => period.display_title));
    const isBreak = items.every((period) => period.slot_type !== "class");
    return { id: `group:${date}:${key}`, title: isBreak ? first.display_title : `Period ${first.period_number}`, start: `${date}T${first.starts_at.slice(0, 5)}`, end: `${date}T${first.ends_at.slice(0, 5)}`, editable: false,
      color: isBreak ? "#f1f4f6" : "#eaf1ff", contrastColor: "#15345b",
      extendedProps: { kind: isBreak ? "break" : "class", meta: `${items.length} ${items.length === 1 ? "class" : "classes"}${isBreak ? "" : ` · ${subjects.size} subjects`}`, groupDate: date, groupStart: first.starts_at } };
  });
}

function eventContent(info: EventDisplayInfo) {
  const meta = String(info.event.extendedProps.meta ?? "");
  return <div className="school-calendar-event__content"><strong>{info.event.title}</strong>{info.timeText && !info.isShort ? <time>{info.timeText}</time> : null}{meta && !info.isShort ? <small>{meta}</small> : null}</div>;
}

export function PlannerTimeline({ dates, selected, periodsForDate, events, closures, grouped, onSelectDate, onPlan, onOpen, onMove, onLesson, onGroup }: {
  dates: string[]; selected: string; periodsForDate: (date: string) => PlannerPeriod[]; events: CampusEventDto[];
  closures: Array<{ date: string; label: string; is_instructional: boolean }>; grouped: boolean;
  onSelectDate: (date: string) => void; onPlan: (slot: TimelineSlot) => void; onOpen: (href: string) => void; onMove: (move: TimelineMove) => Promise<boolean>;
  onLesson: (period: PlannerPeriod, date: string) => void; onGroup: (date: string, startsAt: string) => void;
}) {
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia(mobileQuery).matches, () => false);
  const visibleDates = useMemo(() => mobile && dates.length > 1 ? [selected] : dates, [mobile, dates, selected]);
  const today = localParts(new Date()).date;
  const visiblePeriods = useMemo(() => visibleDates.flatMap((date) => periodsForDate(date).map((period) => ({ period, date }))), [visibleDates, periodsForDate]);
  const calendarEvents = useMemo(() => {
    const items = dates.flatMap((date) => periodEvents(visiblePeriods.filter((item) => item.date === date).map((item) => item.period), date, grouped));
    for (const event of events) if (event.status !== "cancelled") items.push({ id: `event:${event.id}`, title: event.title, start: event.starts_at, end: event.ends_at, editable: false, color: "#e4f5f1", contrastColor: "#165d54", extendedProps: { kind: "event", meta: event.venue || "", href: `/principal/events/${event.id}` } });
    for (const closure of closures.filter((item) => !item.is_instructional && dates.includes(item.date))) items.push({ id: `closure:${closure.date}`, title: closure.label, start: closure.date, allDay: true, display: "background", classNames: ["school-calendar-event--closure"], extendedProps: { kind: "closure" } });
    return items;
  }, [closures, dates, events, grouped, visiblePeriods]);
  const ranges = visiblePeriods.map(({ period }) => ({ start: minutesFromTime(period.starts_at), end: minutesFromTime(period.ends_at) }));
  for (const event of events) {
    if (event.status === "cancelled") continue;
    const start = localParts(new Date(event.starts_at)), end = localParts(new Date(event.ends_at));
    if (visibleDates.includes(start.date)) ranges.push({ start: start.minutes, end: start.date === end.date ? end.minutes : 1440 });
    else if (visibleDates.includes(end.date)) ranges.push({ start: 0, end: end.minutes });
  }
  const currentMinutes = visibleDates.includes(today) ? localParts(new Date()).minutes : undefined;
  const bounds = timelineBounds(ranges, currentMinutes);
  const toSlot = (start: Date, end: Date): TimelineSlot => { const first = localParts(start); const last = localParts(end); return { date: first.date, startsAt: first.time, endsAt: first.date === last.date ? last.time : "23:59" }; };
  const finishMove = async (info: EventDropInfo | EventResizeDoneInfo) => {
    const periodId = String(info.event.extendedProps.periodId ?? "");
    if (!periodId || !info.event.start || !info.event.end) return info.revert();
    const slot = toSlot(info.event.start, info.event.end);
    if (!await onMove({ periodId, date: slot.date, startsAt: slot.startsAt, endsAt: slot.endsAt })) info.revert();
  };
  const click = (info: EventClickInfo) => {
    info.jsEvent.preventDefault();
    const { periodId, date, groupDate, groupStart, href } = info.event.extendedProps;
    if (periodId) { const period = visiblePeriods.find((item) => item.period.id === periodId && item.date === date)?.period; if (period) onLesson(period, String(date)); }
    else if (groupDate) onGroup(String(groupDate), String(groupStart));
    else if (href) onOpen(String(href));
  };
  const select = (info: DateSelectInfo) => { if (!info.allDay) onPlan(toSlot(info.start, info.end)); };
  const dateClick = (info: DateClickInfo) => { if (info.allDay) return onSelectDate(localParts(info.date).date); const start = localParts(info.date); onPlan({ date: start.date, startsAt: start.time, endsAt: plusMinutes(start.time, 30) }); };
  const initialView = visibleDates.length === 1 ? "timeGridDay" : "timeGridWeek";
  return <div className={`school-calendar${visibleDates.length === 1 ? " school-calendar--day" : " school-calendar--week"}`}>
    {mobile && dates.length > 1 ? <nav className="planner-week-strip" aria-label="Days this week">{dates.map((date) => <button type="button" key={date} aria-pressed={date === selected} className={date === today ? "is-today" : ""} onClick={() => onSelectDate(date)}><span>{new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(new Date(`${date}T12:00:00`))}</span><strong>{Number(date.slice(-2))}</strong></button>)}</nav> : null}
    {closures.filter((closure) => !closure.is_instructional && visibleDates.includes(closure.date)).map((closure) => <div className="planner-closure" key={closure.date}>{closure.label}<small>No scheduled classes</small></div>)}
    <div className="school-calendar__scroll"><div className="school-calendar__canvas">
      <FullCalendar key={`${initialView}:${visibleDates[0]}`} plugins={[timeGridPlugin, interactionPlugin, monarchThemePlugin]} initialView={initialView} initialDate={selected}
        timeZone={INDIA_TIME_ZONE} headerToolbar={false} firstDay={1} weekends allDaySlot={false} height="auto" dayHeaders={!mobile || dates.length === 1}
        className="school-calendar-engine" viewClass="school-calendar-view"
        blockEventClass={(info) => `school-calendar-block school-calendar-block--${info.event.extendedProps.kind ?? "class"}`}
        blockEventInnerClass="school-calendar-block__inner" eventClass="school-calendar-hit"
        dayHeaderClass="school-calendar-day" dayHeaderInnerClass="school-calendar-day__inner"
        dayHeaderContent={(info) => <><span>{info.weekdayText}</span><strong className={info.isToday ? "is-today" : ""}>{info.dayNumberText}</strong></>}
        slotLaneClass={(info) => info.isMinor ? "school-calendar-lane is-half-hour" : "school-calendar-lane"}
        views={{ timeGrid: { slotHeaderClass: "school-calendar-time", slotHeaderInnerClass: "school-calendar-time__inner", slotHeaderDividerClass: "school-calendar-time-divider" } }}
        nowIndicatorLineClass="school-calendar-now" nowIndicatorDotClass="school-calendar-now-dot"
        slotMinTime={`${timeFromMinutes(bounds.start)}:00`} slotMaxTime={bounds.end === 1440 ? "24:00:00" : `${timeFromMinutes(bounds.end)}:00`}
        scrollTime={`${timeFromMinutes(Math.max(bounds.start, Math.min(bounds.end - 60, currentMinutes === undefined ? bounds.start : currentMinutes - 60)))}:00`}
        slotDuration="00:30:00" slotMinHeight={34} eventShortHeight={42} snapDuration="00:15:00"
        eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }} dayHeaderFormat={{ weekday: "short", day: "numeric" }}
        nowIndicator selectable selectMirror selectOverlap={false} editable eventOverlap={false} longPressDelay={450} selectLongPressDelay={450} eventLongPressDelay={500}
        events={calendarEvents} eventContent={eventContent} select={select} dateClick={dateClick} eventClick={click}
        eventDrop={(info) => { void finishMove(info); }} eventResize={(info) => { void finishMove(info); }} navLinks navLinkDayClick={(date) => onSelectDate(localParts(date).date)} />
    </div></div>
  </div>;
}
