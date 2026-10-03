import { MapPin, Pencil, UserRound, PackageCheck } from "lucide-react";
import { timeLabel, type DayPeriod } from "./api";
const statuses = {
  pending: "Awaiting teacher",
  declined: "Coverage needed",
  accepted: "Teacher confirmed",
  unassigned: "Teacher needed",
  not_required: "Scheduled",
};
export function DayPeriodList({
  periods,
  onEdit,
  showCoverage = true,
}: {
  periods: DayPeriod[];
  onEdit?: (period: DayPeriod) => void;
  showCoverage?: boolean;
}) {
  return (
    <ol className="day-period-list">
      {periods.map((p) => (
        <li
          key={p.period_number}
          className={p.cancelled ? "day-period is-cancelled" : "day-period"}
        >
          <div className="day-period-number">
            <span>P{p.period_number}</span>
            <time dateTime={p.starts_at}>{timeLabel(p.starts_at)}</time>
            <small>
              <span aria-hidden="true">–</span>
              <time dateTime={p.ends_at}>{timeLabel(p.ends_at)}</time>
            </small>
          </div>
          <div className="day-period-content">
            <header>
              <h3>{p.title}</h3>
              {p.cancelled ? (
                <span className="day-status is-cancelled">Cancelled</span>
              ) : showCoverage ? (
                <span className={`day-status is-${p.coverage_status}`}>
                  {statuses[p.coverage_status]}
                </span>
              ) : null}
            </header>
            <div className="day-period-meta">
              {p.slot_type !== "break" ? (
                <span>
                  <UserRound size={14} />
                  {p.teacher_name || "Teacher not assigned"}
                </span>
              ) : null}
              {p.room ? (
                <span>
                  <MapPin size={14} />
                  {p.room}
                </span>
              ) : null}
            </div>
            {!p.cancelled && p.materials.length ? (
              <p className="day-materials">
                <PackageCheck size={15} />
                {p.materials.join(" · ")}
              </p>
            ) : null}
          </div>
          {onEdit ? (
            <button
              className="day-icon-button"
              type="button"
              aria-label={`Edit period ${p.period_number}: ${p.title}`}
              onClick={() => onEdit(p)}
            >
              <Pencil size={17} />
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
