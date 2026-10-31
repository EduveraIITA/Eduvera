import type { ReactNode } from "react";
import { CalendarDays, List } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import type { MonthCell } from "./monthGrid";
import "./calendar.css";
import "./calendar-agenda.css";
import { DateNavigation } from '../../components/date-navigation/DateNavigation';
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
  /** The selected institution's virtual/local date, when supplied by a workspace. */
  today?: string;
}

const longDate = (iso: string) => new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${iso}T00:00:00`));

/* The selected-day agenda leads. The existing month grid remains an explicit
   date choice; callers retain all domain data, authority and URL state. */
export function CalendarView({ year, month0, onToday, mode, onModeChange, selected, onSelect, marks, isSchoolDay, legend, subtitle, detail, today = schoolDateToday() }: CalendarViewProps) {
  return (
    <div className="cal-page cal-page--agenda">
      {subtitle ? <p className="cal-context-label">{subtitle}</p> : null}
      <section className="cal-card cal-picker" aria-label="Choose calendar date" data-expanded={mode === "month"}>
          <DateNavigation compact date={selected} view={mode} today={today} onDateChange={onSelect} onViewChange={onModeChange} onToday={onToday} getDayInfo={iso => {
            const value = new Date(`${iso}T00:00:00`);
            const school = isSchoolDay({ iso, day: value.getDate(), weekday: value.getDay() || 7, inMonth: value.getMonth() === month0 && value.getFullYear() === year, isToday: iso === today });
            const dots = [...new Set(marks[iso] ?? [])].slice(0, 3);
            return { muted: !school, label: [!school ? 'no school' : '', ...dots.map(tone => legend.find(item => item.tone === tone)?.label ?? tone)].filter(Boolean).join(', '),
              indicator: dots.length ? <span className="cal-dots">{dots.map(tone => <i key={tone} className={`cal-dot cal-dot--${tone}`} />)}</span> : undefined };
          }} />
        <button className="cal-picker-toggle" type="button" aria-label={mode === "month" ? "Show agenda" : "Show month grid"} title={mode === "month" ? "Show agenda" : "Show month grid"} aria-expanded={mode === "month"} onClick={() => onModeChange(mode === "month" ? "day" : "month")}>
          {mode === "month" ? <List size={20} aria-hidden="true" /> : <CalendarDays size={20} aria-hidden="true" />}
        </button>
        {legend.length && mode === "month" ? <details className="cal-key"><InfoSummary>Calendar key</InfoSummary><div className="cal-legend">{legend.map((l) => <span key={l.tone}><i className={`cal-dot cal-dot--${l.tone}`} />{l.label}</span>)}</div></details> : null}
      </section>
      <section className="cal-card cal-agenda" aria-live="polite" aria-label={`Schedule for ${longDate(selected)}`}>{detail}</section>
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
