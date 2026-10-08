import { ChevronRight } from "lucide-react";
import type { TimetableDay, TimetablePeriod } from "../../pages/student/student-timetable-data";
import "./family-schedule-agenda.css";

export function FamilyScheduleAgenda({ days, currentPeriodId, onOpen }: {
  days: TimetableDay[];
  currentPeriodId?: string;
  onOpen: (selection: { day: TimetableDay; period: TimetablePeriod }) => void;
}) {
  return <ol className="family-schedule-agenda" aria-label="Day periods">
    {days.flatMap(day => day.periods.map(period => <li key={`${day.key}:${period.id}`}>
      <button type="button" className={period.cancelled ? "is-cancelled" : undefined} onClick={() => onOpen({ day, period })}
        aria-label={`${period.cancelled ? "Cancelled: " : ""}${period.subject}, ${day.longLabel} ${period.period}, ${period.time}${period.endTime ? ` - ${period.endTime}` : ""}`}>
        <span className="family-schedule-agenda__time"><strong>{period.time}</strong>{period.endTime ? <small>{period.endTime}</small> : null}<small>{period.period}</small></span>
        <span className="family-schedule-agenda__lesson"><strong>{period.subject}</strong>{period.teacher ? <small>{period.teacher}</small> : null}{period.room ? <small>{period.room}</small> : null}
          {period.cancelled ? <em>Cancelled</em> : period.id === currentPeriodId ? <em>Now</em> : null}
          {!period.cancelled && period.materials?.length ? <small>Bring: {period.materials.join(", ")}</small> : null}
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </li>))}
  </ol>;
}
