import { applicationNow } from "../../features/simulation/applicationTime";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarDays, Check, CheckCircle2, ChevronRight, LockKeyhole } from "lucide-react";
import type { TeacherHomeResponse } from "../../features/operations/api";
import { OperationsShell } from "./OperationsShell";
import { FollowupInbox } from "../../features/coordination/FollowupInbox";
import { HomeActionDeck } from "../../features/home-actions/HomeActionDeck";
import type { HomeAction } from "../../features/home-actions/types";
import "./attendance-workspace.css";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { OperatingDayNowNext } from "../../features/operating-day/OperatingDayNowNext";
function time(value: string | null) {
  if (!value) return "No lesson";
  const [hour = "0", minute = "00"] = value.split(":");
  const numeric = Number(hour);
  return `${numeric % 12 || 12}:${minute} ${numeric >= 12 ? "PM" : "AM"}`;
}

function TeacherPrimaryAction({ action }: { action: HomeAction }) {
  const content = (
    <>
      <span>
        <small>{action.status_label}</small>
        <strong>{action.title}</strong>
      </span>
      <span className="teacher-home__primary-action-cta">
        {action.action_label}
        <ArrowRight size={16} aria-hidden="true" />
      </span>
    </>
  );

  return action.href.startsWith("#") ? (
    <a className="teacher-home__primary-action" href={action.href}>{content}</a>
  ) : (
    <Link className="teacher-home__primary-action" to={action.href}>{content}</Link>
  );
}

export function TeacherHomePage({
  data,
  date,
  onDateChange,
}: {
  data: TeacherHomeResponse;
  date: string;
  onDateChange: (date: string) => void;
}) {
  const [searchParams] = useSearchParams();
  const dueClasses = data.classes.filter((item) =>
    item.can_mark !== false || item.submission_status === "submitted" || item.submission_status === "locked"
  );
  const submitted = dueClasses.filter(
    (item) =>
      item.submission_authorized !== false && (
        item.submission_status === "submitted" ||
        item.submission_status === "locked"
      ),
  ).length;
  const selectedDateLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00+05:30`));
  const registerProgress = dueClasses.length ? Math.round((submitted * 100) / dueClasses.length) : 100;
  const remainingRegisters = Math.max(dueClasses.length - submitted, 0);
  const registerStatus = !dueClasses.length
    ? "No registers due"
    : remainingRegisters === 0
      ? "Attendance complete"
      : `${remainingRegisters} ${remainingRegisters === 1 ? "register" : "registers"} remaining`;
  const homeActions = data.home_actions ?? [];
  const [primaryAction, ...remainingActions] = homeActions;
  return (
    <OperationsShell
      portal="teacher"
      active="home"
      title="Today"
    >
      <div className="operations-stack teacher-home">
        <section className="teacher-home__day" aria-labelledby="teacher-home-day-heading">
          <header>
            <div>
              <span>{date === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(applicationNow()) ? "Today" : "Selected day"}</span>
              <h2 id="teacher-home-day-heading">{selectedDateLabel}</h2>
            </div>
            <label>
              <span className="sr-only">Choose date</span>
              <CalendarDays size={18} aria-hidden="true" />
            <TemporalInput
              type="date"
              aria-label="Choose date"
              value={date}
              onChange={(event) => onDateChange(event.target.value)}
            />
            </label>
          </header>
          <div className="teacher-home__day-summary">
            <div>
              <strong>{data.classes.length ? `${data.classes.length} ${data.classes.length === 1 ? "class" : "classes"}` : "No classes"}</strong>
              <span>{registerStatus}</span>
            </div>
            {dueClasses.length ? <b>{registerProgress}%</b> : <CheckCircle2 size={25} aria-label="Day clear" />}
          </div>
          {dueClasses.length ? <div className="teacher-home__progress" aria-label={`${registerProgress}% of attendance registers complete`}><i style={{ width: `${registerProgress}%` }} /></div> : null}
          {primaryAction ? (
            <TeacherPrimaryAction action={primaryAction} />
          ) : (
            <div className="teacher-home__caught-up" role="status">
              <CheckCircle2 size={20} aria-hidden="true" />
              <span>
                <strong>You’re all caught up</strong>
                <small>No action needs your attention right now.</small>
              </span>
            </div>
          )}
        </section>
        <OperatingDayNowNext day={data.operating_day} />
        <HomeActionDeck actions={remainingActions.slice(0, 3)} title="Later" variant="quiet" />
        {data.classes.length ? <section className="operations-panel teacher-home__classes">
          <header>
            <h2>Today’s classes</h2>
            <Link className="operations-action-link" to="/teacher/timetable">Timetable <ChevronRight size={16} /></Link>
          </header>
          <div className="teacher-class-list">
            {data.classes.length ? (
              data.classes.map((item) => (
                <article key={item.class_section_id}>
                  <span className="teacher-class-list__time">
                    <strong>{time(item.starts_at)}</strong>
                    <small>{time(item.ends_at)}</small>
                  </span>
                  <span className="teacher-class-list__identity">
                    <strong>{item.class_name}</strong>
                    <small>
                      {item.subjects?.join(" - ") || "Published timetable"} -{" "}
                      {item.room_number || "Room pending"}
                    </small>
                  </span>
                  <span className={`submission-chip is-${item.submission_authorized === false || item.can_mark === false ? "upcoming" : item.submission_status}`}>
                    {item.submission_authorized !== false && item.submission_status === "submitted" ? (
                      <Check size={13} />
                    ) : item.submission_authorized !== false && item.submission_status === "locked" ? (
                      <LockKeyhole size={13} />
                    ) : null}
                    {item.submission_authorized === false ? "assignment mismatch" : item.can_mark === false ? "upcoming" : item.submission_status.replace("_", " ")}
                  </span>
                  <span className="teacher-class-list__counts">
                    <strong>
                      {item.marked_count}/{item.student_count}
                    </strong>
                    <small>marked</small>
                  </span>
                  {item.can_mark === false && !["submitted", "locked"].includes(item.submission_status) ? (
                    <span className="teacher-class-list__inactive">Opens on this date</span>
                  ) : (
                    <Link
                      className="operations-action-link"
                      to={`/teacher/attendance?class_section_id=${encodeURIComponent(item.class_section_id)}&date=${date}`}
                    >
                      {item.submission_authorized === false
                        ? "Resolve attendance"
                        : item.submission_status === "submitted" || item.submission_status === "locked"
                        ? "Review"
                        : "Take attendance"}
                      <ChevronRight size={17} />
                    </Link>
                  )}
                </article>
              ))
            ) : (
              <div className="operations-empty">
                <CalendarDays size={24} />
                <div>
                  <strong>No attendance due</strong>
                  <p>No scheduled lesson or accepted cover requires a class register for this date.</p>
                </div>
              </div>
            )}
          </div>
        </section> : null}
        <FollowupInbox context="staff" initialFollowupId={searchParams.get("followup") ?? undefined} hideWithoutOpenFollowups />
      </div>
    </OperationsShell>
  );
}

export function TeacherTimetablePage({ data }: { data: TeacherHomeResponse }) {
  const days = useMemo(() => {
    const grouped = new Map<string, TeacherHomeResponse["weekly_timetable"]>();
    for (const slot of data.weekly_timetable)
      grouped.set(slot.weekday_label, [
        ...(grouped.get(slot.weekday_label) ?? []),
        slot,
      ]);
    return [...grouped.entries()];
  }, [data.weekly_timetable]);
  return (
    <OperationsShell
      portal="teacher"
      active="timetable"
      title="My weekly timetable"
      subtitle={`${data.teacher.name} - Published schedule`}
    >
      <div className="operations-stack">
        <p className="workspace-context">{data.weekly_timetable.length} periods this week</p>
        <section className="teacher-week-grid">
          {days.map(([day, slots]) => (
            <article className="operations-panel" key={day}>
              <header>
                <div>
                  <span>Teaching day</span>
                  <h2>{day}</h2>
                </div>
                <b>{slots.length} periods</b>
              </header>
              <div>
                {slots.map((slot) => (
                  <section key={slot.id}>
                    <span>
                      <small>P{slot.period_number}</small>
                      <strong>{time(slot.starts_at)}</strong>
                    </span>
                    <i />
                    <span>
                      <strong>{slot.subject_name}</strong>
                      <small>
                        {slot.class_name} - {slot.room || "Room pending"}
                      </small>
                    </span>
                  </section>
                ))}
              </div>
            </article>
          ))}
        </section>
      </div>
    </OperationsShell>
  );
}
