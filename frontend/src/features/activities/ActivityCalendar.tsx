import FullCalendar, { type DateClickInfo, type DateSelectInfo } from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import monarchThemePlugin from "@fullcalendar/react/themes/monarch";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/monarch/theme.css";
import "@fullcalendar/react/themes/monarch/palettes/blue.css";
import { applicationNow } from "../simulation/applicationTime";
import { activityCalendarScrollTime, purposeLabels } from "./activityExperience";
import type { ActivityOccurrence } from "./api";
import { activityCalendarColumnWidth } from './activityCalendarLayout';

function selectedTime(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (kind: string) => parts.find((item) => item.type === kind)?.value ?? "00";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}
export interface ActivityTimeSelection { date: string; start: string; end: string; endDayOffset?: 0 | 1 }
export function ActivityCalendar({ date, timezone, occurrences, canManage, onSelect, onCreate }: { date: string; timezone: string; occurrences: ActivityOccurrence[]; canManage: boolean; onSelect: (occurrence: ActivityOccurrence) => void; onCreate: (slot: ActivityTimeSelection) => void }) {
  const scrollTime = activityCalendarScrollTime(date, 'day', timezone, occurrences);
  const columnWidth = activityCalendarColumnWidth(occurrences);
  const calendarWidth = 64 + columnWidth;
  const create = (first: Date, last?: Date) => {
    if (!canManage) return;
    const start = selectedTime(first, timezone);
    const end = selectedTime(last ?? new Date(first.getTime() + 60 * 60_000), timezone);
    onCreate({ date: start.date, start: start.time, end: end.time, endDayOffset: start.date === end.date ? 0 : 1 });
  };
  const select = (info: DateSelectInfo) => { if (!info.allDay) create(info.start, info.end); };
  const click = (info: DateClickInfo) => { if (!info.allDay) create(info.date); };
  return <div className="activity-calendar school-calendar school-calendar--day"><div className="school-calendar__scroll" role="region" aria-label="Day timetable, scroll horizontally for parallel activities" tabIndex={0}><div className="school-calendar__canvas" style={{ minWidth: calendarWidth }}>
    <FullCalendar key={`${date}:${timezone}`} plugins={[timeGridPlugin, interactionPlugin, monarchThemePlugin]} initialView="timeGridDay" initialDate={date} timeZone={timezone} now={applicationNow().toISOString()} firstDay={1} weekends height="clamp(480px, 72dvh, 760px)" headerToolbar={false} dayHeaders={false} allDaySlot={false} nowIndicator selectable={canManage} selectMirror selectOverlap editable={false} eventOverlap slotEventOverlap={false} slotMinTime="00:00:00" slotMaxTime="24:00:00" scrollTime={scrollTime} slotDuration="00:30:00" slotMinHeight={28} eventShortHeight={42} longPressDelay={450}
      className="school-calendar-engine" viewClass="school-calendar-view" blockEventClass={() => "school-calendar-block activity-calendar-block"} blockEventInnerClass="school-calendar-block__inner" eventClass="school-calendar-hit"
      slotLaneClass={(info) => info.isMinor ? "school-calendar-lane is-half-hour" : "school-calendar-lane"} views={{ timeGrid: { slotHeaderClass: "school-calendar-time", slotHeaderInnerClass: "school-calendar-time__inner", slotHeaderDividerClass: "school-calendar-time-divider" } }} nowIndicatorLineClass="school-calendar-now" nowIndicatorDotClass="school-calendar-now-dot"
      events={occurrences.filter((item) => item.state !== "cancelled").map((item) => ({ id: item.id, title: item.title, start: item.starts_at, end: item.ends_at, color: "var(--thatcampus-brand-soft)", contrastColor: "var(--thatcampus-ink)", extendedProps: { occurrenceId: item.id } }))}
      eventContent={(info) => { const item = occurrences.find((occurrence) => occurrence.id === info.event.id); return <div className="school-calendar-event__content"><strong>{info.event.title}</strong>{item && !info.isShort ? <small>{purposeLabels[item.purpose]}{item.space_label ? ` · ${item.space_label}` : ""}</small> : null}{info.timeText && !info.isShort ? <time>{info.timeText}</time> : null}</div>; }}
      eventClick={(info) => { info.jsEvent.preventDefault(); const item = occurrences.find((occurrence) => occurrence.id === info.event.id); if (item) onSelect(item); }} select={select} dateClick={click}
    />
  </div></div></div>;
}
