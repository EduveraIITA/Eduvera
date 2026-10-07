import type { ReactNode } from "react";
import { monthLabel, type MonthCell } from "./monthGrid";
import "./calendar.css";
import { DateNavigation, DateViewSelect } from '../../components/date-navigation/DateNavigation';
import { schoolDateToday } from '../../lib/schoolTime';

export type MarkTone = "present" | "late" | "absent" | "excused" | "leave" | "school" | "event" | "test" | "holiday";
export type CalendarMode = "month" | "day";

export interface CalendarViewProps {
  year: number; month0: number;
  onToday: () => void;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  selected: string;
  onSelect: (iso: string) => void;
  /** Dots under a day, keyed by ISO date. At most three are drawn. */
  marks: Record<string, MarkTone[]>;
  /** Non-school dates are muted, without changing selection styling. */
  isSchoolDay: (cell: MonthCell) => boolean;
  legend: Array<{ tone: MarkTone; label: string }>;
  subtitle?: string;
  detail: ReactNode;
}

const longDate = (iso: string) => new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${iso}T00:00:00`));

/* The month grid. Data and the detail panel come from the caller so the same
   grid serves a guardian, a student, a teacher and the principal. */
export function CalendarView({ year, month0, onToday, mode, onModeChange, selected, onSelect, marks, isSchoolDay, legend, subtitle, detail }: CalendarViewProps) {
  const today = schoolDateToday();
  return (
    <div className="cal-page">
      <section className="cal-card" aria-label={`${monthLabel(year, month0)} calendar`}>
        <div className="cal-toolbar">
          <span>{subtitle ?? "School dates"}</span>
          <DateViewSelect value={mode} onChange={onModeChange} label="Calendar view" options={['day', 'month']} />
        </div>
        <div className="cal-date-navigation">
          <DateNavigation date={selected} view={mode} today={today} onDateChange={onSelect} onViewChange={onModeChange} onToday={onToday} getDayInfo={iso => {
            const value = new Date(`${iso}T00:00:00`);
            const school = isSchoolDay({ iso, day: value.getDate(), weekday: value.getDay() || 7, inMonth: value.getMonth() === month0 && value.getFullYear() === year, isToday: iso === today });
            const dots = [...new Set(marks[iso] ?? [])].slice(0, 3);
            return { muted: !school, label: [!school ? 'no school' : '', ...dots.map(tone => legend.find(item => item.tone === tone)?.label ?? tone)].filter(Boolean).join(', '),
              indicator: dots.length ? <span className="cal-dots">{dots.map(tone => <i key={tone} className={`cal-dot cal-dot--${tone}`} />)}</span> : undefined };
          }} />
        </div>
        {legend.length ? <details className="cal-key"><summary>Calendar key</summary><div className="cal-legend">{legend.map((l) => <span key={l.tone}><i className={`cal-dot cal-dot--${l.tone}`} />{l.label}</span>)}</div></details> : null}
      </section>
      <section className="cal-card" aria-live="polite" aria-label={`Schedule for ${longDate(selected)}`}>{detail}</section>
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
