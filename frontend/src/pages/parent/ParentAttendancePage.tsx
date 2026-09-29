import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  Bus,
  CheckCircle2,
  ClipboardCheck,
  Flame,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  PlusCircle,
  Radio,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { fallbackAttendanceData } from "./parentDemoData";
import { ParentShell } from "./ParentShell";
import { schoolDateToday } from "../../lib/schoolTime";
import { AttendanceRankingDialog } from "../../features/school/AttendanceRankingDialog";
import type { ParentAttendanceData, ParentPageAction } from "./parentTypes";
import "./parent-pages.css";

export interface ParentAttendancePageProps {
  data?: ParentAttendanceData;
  onSelectChild?: (childId: string) => ParentPageAction;
  onSelectDate?: (dateId: string) => ParentPageAction;
  onRequestLeave?: () => ParentPageAction;
  onMessageTeacher?: () => ParentPageAction;
}

type MessageState = "idle" | "sending" | "sent" | "error";

export function ParentAttendancePage({
  data = fallbackAttendanceData,
  onSelectChild,
  onSelectDate,
  onRequestLeave,
  onMessageTeacher,
}: ParentAttendancePageProps) {
  const hasAttendance = data.stats.totalDays > data.stats.excusedCount;
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(
    data.month.days.find((day) => day.id === schoolDateToday())?.id ??
      [...data.month.days].reverse().find((day) => !["future", "weekend"].includes(day.status))?.id ??
      data.month.days[0]?.id ?? "",
  );
  const [messageState, setMessageState] = useState<MessageState>("idle");
  const [rankingOpen, setRankingOpen] = useState(false);
  const selectedDay = data.month.days.find((day) => day.id === selectedDate);
  const firstDay = data.month.days[0]?.id;
  const leadingBlankDays = firstDay
    ? (new Date(`${firstDay}T00:00:00`).getDay() + 6) % 7
    : 0;

  const selectDate = async (dateId: string) => {
    setSelectedDate(dateId);
    await onSelectDate?.(dateId);
  };

  const requestLeave = async () => {
    if (onRequestLeave) {
      await onRequestLeave();
      return;
    }
    await navigate("/parent/leave?tab=apply");
  };

  const messageTeacher = async () => {
    if (!onMessageTeacher) return;
    setMessageState("sending");
    try {
      await onMessageTeacher();
      setMessageState("sent");
      window.setTimeout(() => setMessageState("idle"), 3200);
    } catch {
      setMessageState("error");
    }
  };

  return (
    <ParentShell active="attendance" pageLabel="Attendance" child={data.child} onSelectChild={onSelectChild}>
      <div className="parent-stack attendance-page">
        <div className="attendance-context-row">
          <span><span className="presence-dot" />Campus Presence</span>
          <strong>{data.termLabel}</strong>
        </div>

        <section className="aggregate-card" aria-labelledby="aggregate-heading">
          <div className="aggregate-card__top">
            <div>
              <button type="button" id="aggregate-heading" className="attendance-ranking-trigger" onClick={() => setRankingOpen(true)}>Overall Aggregate <span aria-hidden="true">↗</span></button>
              <button type="button" className="aggregate-card__score aggregate-card__score--open" aria-label="View all class attendance from the attendance score" onClick={() => setRankingOpen(true)}>
                <strong>{hasAttendance ? `${data.aggregatePercent.toFixed(1)}%` : "—"}</strong>
                {!hasAttendance ? <span>Not recorded</span> : data.trendPercent === undefined ? <span>Live term</span> : (
                  <span>
                    {data.trendPercent < 0 ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                    {data.trendPercent > 0 ? "+" : ""}{data.trendPercent.toFixed(1)}%
                  </span>
                )}
              </button>
            </div>
            <span className="aggregate-card__seal"><BadgeCheck size={27} /></span>
          </div>
          <div className="aggregate-card__cushion">
            <ShieldCheck size={18} />
            {!hasAttendance ? <span>Attendance will appear after the school publishes a register.</span> : data.aggregatePercent < data.minimumPercent
              ? <span><strong>Below school minimum.</strong> Current threshold: {data.minimumPercent}%.</span>
              : <span><strong>Safe Zone: +{data.safeCushionDays} Days</strong> cushion buffer before the {data.minimumPercent}% school minimum.</span>}
          </div>
        </section>
        {rankingOpen && <AttendanceRankingDialog ranking={data.ranking} className={`${data.child.grade} - Section ${data.child.section}`} currentLabel="Your child" onClose={() => setRankingOpen(false)} />}

        <section className="attendance-stat-grid" aria-label="Attendance summary">
          <article className="attendance-stat-card">
            <div className="attendance-stat-card__title"><span>Attended</span><ClipboardCheck size={18} /></div>
            <strong>{data.stats.attended}<small>/{data.stats.totalDays} d</small></strong>
            <p className="green-text">{hasAttendance ? `${data.stats.dailyRatePercent.toFixed(1)}% Rate` : "Not recorded"}</p>
          </article>
          <article className="attendance-stat-card">
            <div className="attendance-stat-card__title"><span>Active Streak</span><Flame className="flame-icon" size={19} /></div>
            <strong>{data.stats.activeStreakDays} <small>Days</small></strong>
            <p className="blue-text">{data.stats.streakDetail}</p>
          </article>
          <article className="attendance-stat-card">
            <div className="attendance-stat-card__title"><span>Excused</span><CheckCircle2 size={18} /></div>
            <strong>{data.stats.excusedCount} <small>Approved</small></strong>
            <p>{data.stats.excusedDetail}</p>
          </article>
          <article className="attendance-stat-card">
            <div className="attendance-stat-card__title"><span>Unexcused</span><MoreHorizontal size={18} /></div>
            <strong>{data.stats.pendingCount} <small>Days</small></strong>
            <p className="red-text">{data.stats.pendingDetail}</p>
          </article>
        </section>

        <section aria-labelledby="presence-pulse-heading">
          <h2 className="parent-section-title" id="presence-pulse-heading">Today's Presence Pulse</h2>
          <div className="surface-card presence-event-list">
            <article>
              <span className="presence-event-icon"><Radio size={19} /></span>
              <div><strong>Gate Check-in</strong><time>{data.today.checkInTime}</time><small>{data.today.checkInLocation} - {data.today.checkInSource}</small></div>
              <span className={data.today.checkInVerified ? "mini-status mini-status--verified" : "mini-status"}>
                {data.today.checkInVerified ? <span className="presence-dot" /> : null}
                {data.today.checkInVerified ? "Verified" : "No event"}
              </span>
            </article>
            <article>
              <span className="presence-event-icon presence-event-icon--muted"><Bus size={18} /></span>
              <div><strong>Expected Dismissal</strong><time>{data.today.dismissalTime}</time><small>{data.today.dismissalDetail}</small></div>
              <span className="mini-status">Scheduled</span>
            </article>
          </div>
        </section>

        <section aria-labelledby="monthly-ledger-heading">
          <div className="attendance-section-heading">
            <h2 id="monthly-ledger-heading">Attendance calendar</h2>
            <span>{data.month.label}</span>
          </div>
          <div className="surface-card calendar-card">
            <div className="calendar-summary">
              <span><i className="legend-dot legend-dot--present" />{data.month.summary.present} Present</span>
              <span><i className="legend-dot legend-dot--excused" />{data.month.summary.excused} Excused</span>
              <span><i className="legend-dot legend-dot--absent" />{data.month.summary.unexcused} Unexcused</span>
            </div>
            <div className="calendar-weekdays" aria-hidden="true">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
            </div>
            <div className="calendar-grid" role="grid" aria-label={data.month.label}>
              {Array.from({ length: leadingBlankDays }, (_, index) => <span className="calendar-day-placeholder" aria-hidden="true" key={`blank-${index}`} />)}
              {data.month.days.map((day) => (
                <button
                  key={day.id}
                  className={`calendar-day calendar-day--${day.status}${selectedDate === day.id ? " is-selected" : ""}`}
                  type="button"
                  aria-label={day.ariaLabel}
                  aria-pressed={selectedDate === day.id}
                  onClick={() => void selectDate(day.id)}
                >
                  <span>{day.day}</span>
                  {day.status === "present" ? <i /> : null}
                </button>
              ))}
            </div>
            <div className="calendar-legend">
              <span>Legend:</span>
              <span><i className="legend-dot legend-dot--present" />Present</span>
              <span><i className="legend-dot legend-dot--excused" />Excused</span>
              <span><i className="legend-dot legend-dot--weekend" />Weekend</span>
            </div>
            {selectedDay ? (
              <div className={`calendar-selected-detail calendar-selected-detail--${selectedDay.status}`} role="status">
                <strong>{selectedDay.ariaLabel.split(",")[0]}</strong>
                <span>{selectedDay.status === "present" ? "Present in the attendance register" : selectedDay.status === "excused" ? "Excused absence" : selectedDay.status === "unexcused" ? "Unexcused absence in the register" : selectedDay.status === "weekend" ? "School weekend" : selectedDay.status === "not_recorded" ? "No attendance record was published" : "Attendance has not been recorded yet"}</span>
              </div>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="subject-attendance-heading">
          <div className="attendance-section-heading">
            <h2 id="subject-attendance-heading">Subject Attendance</h2>
            <span className="threshold-label">Threshold: {data.minimumPercent}%</span>
          </div>
          <div className="surface-card subject-attendance-card">
            {data.subjects.map((subject) => (
              <article key={subject.id}>
                <div className="subject-attendance-card__labels">
                  <span>{subject.name}<small className={`subject-badge subject-badge--${subject.tone}`}>{subject.status}</small></span>
                  <strong>{subject.percent}%</strong>
                </div>
                <div className={`subject-progress subject-progress--${subject.tone}`} aria-label={`${subject.name}: ${subject.percent}%`}>
                  <span style={{ width: `${subject.percent}%` }} />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="attendance-actions" aria-label="Attendance actions">
          <button className="button button--primary" type="button" onClick={() => void requestLeave()}>
            <PlusCircle size={18} />Request Leave / Medical Slip
          </button>
          <button className="button button--white" type="button" disabled={!onMessageTeacher || messageState === "sending" || messageState === "sent"} onClick={() => void messageTeacher()}>
            {messageState === "sending" ? <LoaderCircle className="spin" size={18} /> : messageState === "sent" ? <CheckCircle2 size={18} /> : <MessageSquareText size={18} />}
            {messageState === "sending" ? "Opening contact..." : messageState === "sent" ? "Contact opened" : onMessageTeacher ? "Message Homeroom Advisor" : "Teacher contact unavailable"}
          </button>
          {messageState === "error" ? <p className="form-error" role="alert">Messaging is unavailable. Please try again.</p> : null}
        </section>
      </div>
    </ParentShell>
  );
}
