import { CalendarDays, ChevronLeft, ChevronRight, List } from "lucide-react";
import type { ReactNode } from "react";
import { monthCells, monthLabel, shiftDate, type MonthCell } from "./monthGrid";
import "./calendar.css";

export type MarkTone = "present" | "late" | "absent" | "excused" | "leave" | "school" | "event" | "test" | "holiday";
export type CalendarMode = "month" | "day";

export interface CalendarViewProps {
  year: number; month0: number;
  onMonthChange: (delta: number) => void;
  onToday: () => void;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  selected: string;
  onSelect: (iso: string) => void;
  /** Dots under a day, keyed by ISO date. At most three are drawn. */
  marks: Record<string, MarkTone[]>;
  /** School days get the filled cell; everything else is drawn as "off". */
  isSchoolDay: (cell: MonthCell) => boolean;
  legend: Array<{ tone: MarkTone; label: string }>;
  subtitle?: string;
  detail: ReactNode;
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const longDate = (iso: string) => new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${iso}T00:00:00`));

/* The month grid. Data and the detail panel come from the caller so the same
   grid serves a guardian, a student, a teacher and the principal. */
export function CalendarView({ year, month0, onMonthChange, onToday, mode, onModeChange, selected, onSelect, marks, isSchoolDay, legend, subtitle, detail }: CalendarViewProps) {
  const cells = monthCells(year, month0);
  const selectedCell = cells.find((cell) => cell.iso === selected) ?? { iso: selected, day: Number(selected.slice(8, 10)), weekday: 1, inMonth: true, isToday: false };
  const dayStrip = Array.from({ length: 7 }, (_, index) => {
    const iso = shiftDate(selected, index - 3);
    const date = new Date(`${iso}T00:00:00`);
    return { iso, day: date.getDate(), weekday: date.getDay() || 7, inMonth: true, isToday: false } satisfies MonthCell;
  });
  return (
    <div className="cal-page">
      <section className="cal-card" aria-label={`${monthLabel(year, month0)} calendar`}>
        <div className="cal-head">
          <div><h2>{monthLabel(year, month0)}</h2>{subtitle ? <small>{subtitle}</small> : null}</div>
          <div className="cal-nav">
            <button type="button" aria-label={mode === "day" ? "Previous day" : "Previous month"} onClick={() => onMonthChange(-1)}><ChevronLeft size={18} /></button>
            <button type="button" className="cal-today" onClick={onToday}>Today</button>
            <button type="button" aria-label={mode === "day" ? "Next day" : "Next month"} onClick={() => onMonthChange(1)}><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="cal-mode" role="group" aria-label="Calendar view">
          <button type="button" className={mode === "month" ? "is-active" : ""} aria-pressed={mode === "month"} onClick={() => onModeChange("month")}><CalendarDays size={16} />Month</button>
          <button type="button" className={mode === "day" ? "is-active" : ""} aria-pressed={mode === "day"} onClick={() => onModeChange("day")}><List size={16} />Day</button>
        </div>
        {mode === "month" ? <>
          <div className="cal-weekdays" aria-hidden="true">{WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="cal-grid" role="grid">
            {cells.map((cell) => {
            const school = isSchoolDay(cell);
            const dots = [...new Set(marks[cell.iso] ?? [])].slice(0, 3);
            const cls = ["cal-day", !cell.inMonth ? "cal-day--outside" : "", !school ? "cal-day--off" : "", cell.isToday ? "cal-day--today" : "", selected === cell.iso ? "is-selected" : ""].filter(Boolean).join(" ");
            return (
              <button key={cell.iso} type="button" className={cls} aria-label={`${longDate(cell.iso)}${cell.isToday ? ", today" : ""}${!school ? ", no school" : ""}${dots.length ? `, ${dots.length} indicators` : ""}`} aria-pressed={selected === cell.iso} onClick={() => onSelect(cell.iso)}>
                <span>{cell.day}</span>
                <span className="cal-dots">{dots.map((tone, i) => <i key={i} className={`cal-dot cal-dot--${tone}`} />)}</span>
              </button>
            );
            })}
          </div>
        </> : <div className="cal-day-strip" role="list" aria-label="Seven day selector">
          {dayStrip.map((cell) => <button key={cell.iso} type="button" className={cell.iso === selected ? "is-selected" : ""} aria-pressed={cell.iso === selected} onClick={() => onSelect(cell.iso)}>
            <small>{new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(new Date(`${cell.iso}T00:00:00`))}</small>
            <strong>{cell.day}</strong>
            <span className="cal-dots">{[...new Set(marks[cell.iso] ?? [])].slice(0, 2).map((tone, index) => <i key={index} className={`cal-dot cal-dot--${tone}`} />)}</span>
          </button>)}
        </div>}
        {legend.length ? <div className="cal-legend">{legend.map((l) => <span key={l.tone}><i className={`cal-dot cal-dot--${l.tone}`} />{l.label}</span>)}</div> : null}
      </section>
      <section className="cal-card" aria-live="polite" aria-label={`Schedule for ${longDate(selectedCell.iso)}`}>{detail}</section>
    </div>
  );
}

/* Small building blocks for the detail panel. */
export function DetailHead({ iso, sub, pill }: { iso: string; sub?: ReactNode; pill?: ReactNode }) {
  return <div className="cal-detail__head"><div><h3>{longDate(iso)}</h3>{sub ? <small>{sub}</small> : null}</div>{pill}</div>;
}
export function Pill({ tone, children }: { tone: MarkTone | "brand" | "neutral"; children: ReactNode }) {
  return <span className={`cal-pill${tone === "neutral" ? "" : ` cal-pill--${tone}`}`}>{children}</span>;
}
