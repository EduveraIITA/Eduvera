import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpenText,
  Calculator,
  Clock3,
  Dumbbell,
  FlaskConical,
  Globe2,
  Languages,
  Laptop,
  MapPin,
  Music2,
  Palette,
} from "lucide-react";

import "./today-activities.css";

export type TodayActivityState = "complete" | "current" | "upcoming";

export interface TodayActivityPeriod {
  id: string;
  period: number;
  subject: string;
  startsAt: string;
  endsAt: string;
  teacher: string;
  room: string;
  state: TodayActivityState;
  progressPercent?: number;
  subjectIcon?: string | null;
  subjectColor?: string | null;
}

interface TodayActivitiesProps {
  periods: TodayActivityPeriod[];
  onOpenPeriod?: (period: TodayActivityPeriod) => void;
  onOpenTimetable: () => void;
  headingId?: string;
  emptyDetail?: string;
  headingAccessory?: ReactNode;
}

const iconMap: Record<string, ReactNode> = {
  "book-open": <BookOpenText size={24} />,
  calculator: <Calculator size={24} />,
  "flask-conical": <FlaskConical size={24} />,
  languages: <Languages size={24} />,
  palette: <Palette size={24} />,
  dumbbell: <Dumbbell size={24} />,
  laptop: <Laptop size={24} />,
  "globe-2": <Globe2 size={24} />,
  music: <Music2 size={24} />,
};

function inferredIcon(subject: string) {
  const value = subject.toLowerCase();
  if (/math|algebra|geometry|calculus/.test(value)) return "calculator";
  if (/science|physics|chemistry|biology|lab/.test(value)) return "flask-conical";
  if (/computer|computing|coding|technology|informatics/.test(value)) return "laptop";
  if (/hindi|english|french|sanskrit|language|literature/.test(value)) return "languages";
  if (/art|design|craft|drawing/.test(value)) return "palette";
  if (/physical|sport|games|yoga|fitness/.test(value)) return "dumbbell";
  if (/social|history|geography|civics|politic/.test(value)) return "globe-2";
  if (/music|choir/.test(value)) return "music";
  return "book-open";
}

function periodProgress(period: TodayActivityPeriod) {
  if (period.progressPercent !== undefined) {
    return Math.max(0, Math.min(100, period.progressPercent));
  }
  if (period.state === "complete") return 100;
  return 0;
}

function stateLabel(state: TodayActivityState) {
  if (state === "current") return "Happening now";
  if (state === "complete") return "Previous period";
  return "Next period";
}

export function TodayActivities({
  periods,
  onOpenPeriod,
  onOpenTimetable,
  headingId = "today-activities-heading",
  emptyDetail = "The timetable has no more activities for today.",
  headingAccessory,
}: TodayActivitiesProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const focusPeriod = useMemo(
    () => periods.find((period) => period.state === "current")
      ?? periods.find((period) => period.state === "upcoming")
      ?? periods.at(-1),
    [periods],
  );
  const visiblePeriods = useMemo(() => {
    if (!focusPeriod) return [];
    const focusIndex = periods.findIndex((period) => period.id === focusPeriod.id);
    return periods.filter((_, index) => Math.abs(index - focusIndex) <= 1);
  }, [focusPeriod, periods]);

  useLayoutEffect(() => {
    if (!focusPeriod) return;
    const alignFocusedPeriod = () => {
      const card = cardRefs.current[focusPeriod.id];
      const rail = railRef.current;
      if (!card || !rail) return;
      const left = card.offsetLeft - (rail.clientWidth / 2) + (card.clientWidth / 2);
      if (typeof rail.scrollTo === "function") rail.scrollTo({ left, behavior: "auto" });
      else rail.scrollLeft = left;
    };
    alignFocusedPeriod();
    const frame = window.requestAnimationFrame(alignFocusedPeriod);
    return () => window.cancelAnimationFrame(frame);
  }, [focusPeriod]);

  return (
    <section className="today-activities" aria-labelledby={headingId}>
      <header className="today-activities__heading">
        <h2 id={headingId}>Today's activities</h2>
        <div>{headingAccessory}<button type="button" onClick={onOpenTimetable}>Timetable <ArrowRight size={15} /></button></div>
      </header>

      {focusPeriod ? (
        <div className="today-activities__rail" ref={railRef} aria-label="Previous, current and next activities">
          {visiblePeriods.map((period) => {
            const progress = periodProgress(period);
            const resolvedIcon = period.subjectIcon || inferredIcon(period.subject);
            const style = {
              "--activity-color": period.subjectColor || "#1d4ed8",
              "--activity-progress": `${progress}%`,
            } as CSSProperties;
            return (
              <article
                key={period.id}
                ref={(element) => { cardRefs.current[period.id] = element; }}
                className={`today-activity-card is-${period.state}${period.id === focusPeriod.id ? " is-focus" : ""}${onOpenPeriod ? " is-actionable" : ""}`}
                style={style}
              >
                {onOpenPeriod ? (
                  <button
                    type="button"
                    className="today-activity-card__action"
                    onClick={() => onOpenPeriod(period)}
                    aria-label={`Open timetable. Period ${period.period}, ${period.subject}, ${period.startsAt} to ${period.endsAt}`}
                  />
                ) : null}
                <div className="today-activity-card__topline">
                  <span>{period.state === "current" ? <i className="today-activities__live" aria-hidden="true" /> : <Clock3 size={16} />}{stateLabel(period.state)}</span>
                  <b>Period {period.period}</b>
                </div>
                <div className="today-activity-card__subject">
                  <span className="today-activity-card__icon" data-subject-icon={resolvedIcon} aria-hidden="true">
                    {iconMap[resolvedIcon] ?? iconMap["book-open"]}
                  </span>
                  <span><h3>{period.subject}</h3><p>{period.teacher}</p></span>
                </div>
                <div
                  className="today-activity-card__progress"
                  role="progressbar"
                  aria-label={`${period.subject}: ${progress}% complete`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                ><span /></div>
                <footer><span><Clock3 size={14} />{period.endsAt ? `${period.startsAt} - ${period.endsAt}` : `Starts ${period.startsAt}`}</span><span><MapPin size={14} />{period.room}</span></footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="today-activities__empty">
          <BookOpenText size={22} />
          <span><strong>No activities today</strong><small>{emptyDetail}</small></span>
        </div>
      )}
    </section>
  );
}
