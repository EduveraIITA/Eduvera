import { CalendarClock, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import "./day-plan-notice.css";
export interface PublishedDayNotice {
  id: string;
  date: string;
  version: number;
  notice: string;
  published_at: string;
  cancelled_periods: number;
}
export function DayPlanNotice({
  plan,
  href,
}: {
  plan?: PublishedDayNotice | null;
  href?: string;
}) {
  if (!plan) return null;
  return (
    <section className="published-day-notice" aria-label="Published day update">
      <span className="published-day-notice__icon">
        <CalendarClock size={21} />
      </span>
      <div>
        <header>
          <strong>Updated school day</strong>
          <small>Version {plan.version}</small>
        </header>
        <p>{plan.notice || "Your school has published a revised schedule."}</p>
        {plan.cancelled_periods > 0 ? (
          <small>
            {plan.cancelled_periods}{" "}
            {plan.cancelled_periods === 1
              ? "period cancelled"
              : "periods cancelled"}
          </small>
        ) : null}
        {href ? (
          <Link to={href}>
            View timetable <ArrowRight size={14} />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
