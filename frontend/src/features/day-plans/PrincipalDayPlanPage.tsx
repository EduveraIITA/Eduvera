import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  History,
  Pencil,
  Printer,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { schoolDateToday } from "../../lib/schoolTime";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import {
  getDayPlan,
  getAdminSummary,
  getPlanOptions,
  startDayPlan,
  sharedDayPeriods,
  type DayPeriod,
  type PlanOptions,
} from "./api";
import { TimetableNavigator, timetableSummaryRange, readTimetableView } from "../timetable/TimetableNavigator";
import { DayPeriodList } from "./DayPeriodList";
import { PlanEditor } from "./PlanEditor";
import { CoverageResponse } from "./CoverageResponse";
import { ScheduleActions } from "./ScheduleActions";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import "./day-plans.css";
export default function PrincipalDayPlanPage() {
  const auth = useAuth(),
    [params, setParams] = useSearchParams();
  const [dirty, setDirty] = useState(false);
  const schools = auth.memberships.filter((m) => m.role === "admin");
  const requestedSchoolId = params.get("school");
  const requestedSchool = schools.find((membership) => membership.school_id === requestedSchoolId);
  const school = requestedSchool
    ?? schools.find((membership) => membership.school_id === auth.user?.active_school_id)
    ?? schools[0];
  const schoolId = school?.school_id ?? "";
  const inaccessibleSchoolTarget = Boolean(requestedSchoolId && !requestedSchool);
  const date = params.get("date") || schoolDateToday();
  const view = readTimetableView(params.get("view"));
  const requestedClassId = params.get("class");
  const requestedPlanId = params.get("plan");
  const requestedPeriodId = params.get("period");
  const notificationId = params.get("attention_notification_id");
  const notifiedDayPlanId = params.get("day_plan_id");
  const notifiedScheduleId = params.get("schedule_id");
  const notifiedDayPlanRevision = Number(params.get("day_plan_revision"));
  const notifiedScheduleRevision = Number(params.get("schedule_revision"));
  const query = useQuery({
    queryKey: ["school", "day-plans", "options", schoolId, date],
    queryFn: () => getPlanOptions(schoolId, date),
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[3] === schoolId ? previous : undefined,
    enabled: Boolean(schoolId) && !inaccessibleSchoolTarget,
  });
  const section = requestedClassId
    ? query.data?.classes.find((item) => item.id === requestedClassId)
    : query.data?.classes[0];
  const exactDayPlanNotification = Boolean(
    notifiedDayPlanId
    && !notifiedScheduleId
    && Number.isInteger(notifiedDayPlanRevision)
    && notifiedDayPlanRevision > 0
    && section?.plan_id === notifiedDayPlanId
    && section.published_version === notifiedDayPlanRevision,
  );
  const exactScheduleNotification = Boolean(
    notifiedScheduleId
    && !notifiedDayPlanId
    && Number.isInteger(notifiedScheduleRevision)
    && notifiedScheduleRevision > 0
    && section
    && query.data?.schedule_sources?.some((source) => source.id === notifiedScheduleId
      && source.revision === notifiedScheduleRevision
      && source.class_section_id === section.id
      && source.term_id === section.term_id),
  );
  const notificationSourceRequested = Boolean(notifiedDayPlanId || notifiedScheduleId);
  const notificationTargetUnavailable = query.isSuccess && !query.isPlaceholderData && Boolean(
    (notificationSourceRequested && !exactDayPlanNotification && !exactScheduleNotification)
    || (notificationId && !notificationSourceRequested),
  );
  const draftTargetUnavailable = query.isSuccess && !query.isPlaceholderData && Boolean(
    (requestedClassId && !section)
    || (requestedPlanId && (!section || section.plan_id !== requestedPlanId))
    || (requestedPeriodId && !requestedPlanId),
  );
  const attentionTargetLoaded = Boolean(notificationId)
    && !requestedPlanId && !requestedPeriodId
    && !inaccessibleSchoolTarget && !draftTargetUnavailable
    && query.isSuccess && !query.isPlaceholderData
    && (exactDayPlanNotification || exactScheduleNotification);
  const range = timetableSummaryRange(date, view);
  const summary = useQuery({
    queryKey: ["school", "day-plans", "admin-summary", schoolId, section?.id ?? "all", range.start, range.end],
    queryFn: () => getAdminSummary(schoolId, range.start, range.end, section?.id),
    enabled: Boolean(schoolId) && !inaccessibleSchoolTarget && (!requestedClassId || Boolean(section)),
  });
  const set = (values: Record<string, string>) => {
    if (
      dirty &&
      !window.confirm("Leave this draft without saving your latest edits?")
    )
      return;
    const next = new URLSearchParams(params);
    if (["school", "date", "class"].some((key) => key in values && values[key] !== (params.get(key) ?? ""))) {
      next.delete("plan");
    }
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };
  return (
    <OperationsShell
      portal="principal"
      active="timetable"
      title="Timetable"
      backTo={params.get("from") === "overview" ? `/principal?date=${date}` : "/principal/more"}
      subtitle="Timetable"
      schoolName={school?.school_name}
      contentHasHeading
    >
      <div className="day-workspace">
        {attentionTargetLoaded ? <AttentionOpenAcknowledgement /> : null}
        {inaccessibleSchoolTarget ? (
          <DayPlanTargetUnavailable message="This day-plan link belongs to a school you cannot currently access." />
        ) : <>
          <TimetableNavigator
          date={date}
          view={view}
          summary={summary.data}
          loading={summary.isPending}
          error={summary.isError ? summary.error.message : undefined}
          contextControl={
            <label className="timetable-context-select date-view-select">
              <span className="sr-only">Class</span>
              <select
                className="date-view-select__input"
                aria-label="Class"
                value={section?.id ?? ""}
                disabled={!query.data?.classes.length}
                onChange={(e) => set({ class: e.target.value })}
              >
                {query.data?.classes.length ? (<>
                  {!section ? <option value="" disabled>Select a class</option> : null}
                  {query.data.classes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </>
                ) : (
                  <option value="">No classes</option>
                )}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </label>
          }
          onDateChange={(nextDate) => set({ date: nextDate })}
          onViewChange={(nextView) => set({ view: nextView })}
          onNavigate={(nextDate, nextView) => set({ date: nextDate, view: nextView })}
          onRetry={() => void summary.refetch()}
          />
        {schools.length > 1 ? (
          <div className="day-filters is-date-only">
            <label>
              School
              <select
                value={schoolId}
                onChange={(e) => set({ school: e.target.value, class: "" })}
              >
                {schools.map((s) => (
                  <option key={s.school_id} value={s.school_id}>
                    {s.school_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {view === "year" ? null : query.isPending || query.isPlaceholderData ? (
          <DayLoading />
        ) : query.isError ? (
          <DayFailure
            message={query.error.message}
            retry={() => void query.refetch()}
          />
        ) : draftTargetUnavailable ? (
          <DayPlanTargetUnavailable message="This day-plan draft is no longer available for the linked class and date." />
        ) : notificationTargetUnavailable ? (
          <DayPlanTargetUnavailable title="Timetable update unavailable" message="This published timetable update no longer matches the linked source, revision, class and date." />
        ) : query.data ? (
          <>
            {query.data.classes.some((c) => c.unresolved > 0) ? (
              <div className="day-coverage-strip">
                <strong>Coverage needs attention</strong>
                {query.data.classes
                  .filter((c) => c.unresolved > 0)
                  .map((c) => (
                    <button
                      className="day-secondary"
                      key={c.id}
                      onClick={() => set({ class: c.id })}
                    >
                      {c.name} · {c.unresolved}
                      <ChevronRight size={15} />
                    </button>
                  ))}
              </div>
            ) : null}
            {section ? (
              <PlanWorkspace
                key={`${schoolId}:${date}:${section.id}:${requestedPlanId ?? "current"}`}
                schoolId={schoolId}
                date={date}
                section={section}
                options={query.data}
                onDirty={setDirty}
                focusPlanId={requestedPlanId ?? undefined}
                focusPeriodId={requestedPeriodId ?? undefined}
                focusPublishedSourceId={exactDayPlanNotification?notifiedDayPlanId??undefined:exactScheduleNotification?notifiedScheduleId??undefined:undefined}
              />
            ) : (
              <section className="day-panel day-empty">
                <CalendarDays />
                <h2>No academic term for this date</h2>
                <p>Select a date within a configured term.</p>
              </section>
            )}
          </>
        ) : null}
        </>}
      </div>
    </OperationsShell>
  );
}
function PlanWorkspace({
  schoolId,
  date,
  section,
  options,
  onDirty,
  focusPlanId,
  focusPeriodId,
  focusPublishedSourceId,
}: {
  schoolId: string;
  date: string;
  section: PlanOptions["classes"][number];
  options: PlanOptions;
  onDirty: (dirty: boolean) => void;
  focusPlanId?: string;
  focusPeriodId?: string;
  focusPublishedSourceId?: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(Boolean(focusPlanId));
  const [startedId, setStartedId] = useState("");
  const id = startedId || section.plan_id || "";
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [response, setResponse] = useState<DayPeriod | null>(null);
  const startKey = useRef<string | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const publishedFocusRef = useRef<HTMLElement>(null);
  const detail = useQuery({
    queryKey: ["school", "day-plans", "detail", schoolId, id],
    queryFn: () => getDayPlan(schoolId, id),
    enabled: !!id,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["school", "day-plans"] });
  };
  async function start() {
    if (busy) return;
    setBusy(true);
    setError("");
    startKey.current ??= crypto.randomUUID();
    try {
      const result = await startDayPlan({
        school_id: schoolId,
        class_section_id: section.id,
        date,
        idempotency_key: startKey.current,
      });
      startKey.current = null;
      setStartedId(result.id);
      setEditing(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the draft.");
    } finally {
      setBusy(false);
    }
  }
  const plan = detail.data;
  const live = sharedDayPeriods(plan, options.schedule, section.id);
  const focusMatchesPlan = Boolean(
    focusPlanId
    && plan?.id === focusPlanId
    && plan.school_id === schoolId
    && plan.class_section_id === section.id
    && plan.date === date,
  );
  const focusedDraftPeriod = focusPeriodId && focusMatchesPlan
    ? plan?.periods.find((period) => period.id === focusPeriodId)
    : undefined;
  const focusedPublishedPeriod = focusPeriodId && focusMatchesPlan
    ? live.find((period) => period.id === focusPeriodId)
    : undefined;
  const focusMatchesDraft = Boolean(
    focusPlanId
    && !focusPeriodId
    && focusMatchesPlan
    && plan?.draft_version,
  );
  const focusUnavailable = Boolean(
    focusPlanId
    && detail.isSuccess
    && (!focusMatchesPlan || (!focusPeriodId && !plan?.draft_version)),
  );
  const periodUnavailable = Boolean(
    focusPeriodId
    && detail.isSuccess
    && focusMatchesPlan
    && !focusedDraftPeriod
    && !focusedPublishedPeriod,
  );
  const exactAttentionTargetLoaded = Boolean(
    focusPlanId
    && detail.isSuccess
    && focusMatchesPlan
    && (focusPeriodId
      ? focusedDraftPeriod || focusedPublishedPeriod
      : plan?.draft_version),
  );
  useEffect(() => {
    if (!focusMatchesDraft || !editing) return;
    const frame = window.requestAnimationFrame(() => {
      focusRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      focusRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing, focusMatchesDraft]);
  useEffect(() => {
    if (!focusPublishedSourceId) return;
    const frame = window.requestAnimationFrame(() => {
      publishedFocusRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      publishedFocusRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusPublishedSourceId, plan?.published_version, live.length]);
  const isClosed = options.context.is_instructional === false;
  const canEdit = date >= options.context.today && (!isClosed || Boolean(id));
  if (isClosed && !id && !live.length) {
    return (
      <section className="day-panel day-closed-state" aria-labelledby="closed-day-heading">
        <span className="day-closed-state__icon"><CalendarDays size={22} /></span>
        <div>
          <h2 id="closed-day-heading">{options.context.label || "School closed"}</h2>
          <p>No regular classes are scheduled.</p>
        </div>
        <Link className="day-closed-state__link" to={`/principal/calendar?date=${date}`}>
          School calendar <ArrowRight size={15} />
        </Link>
      </section>
    );
  }
  const scheduleActions = (
    <ScheduleActions>
      {canEdit ? (
        <button
          className="day-secondary"
          disabled={busy || (Boolean(id) && detail.isPending) || detail.isError}
          onClick={() => plan?.draft_version ? setEditing(true) : void start()}
        >
          <Pencil size={19} aria-hidden="true" />
          {busy
            ? "Preparing…"
            : plan?.draft_version ? "Resume editing" : "Edit day schedule"}
        </button>
      ) : (
        <span className="day-status">Past schedule</span>
      )}
      {live.length || plan?.published_version ? (
        <button
          className="day-icon-button day-print"
          aria-label="Print published day plan"
          onClick={() => window.print()}
        >
          <Printer size={19} /> Print
        </button>
      ) : null}
    </ScheduleActions>
  );
  return (
    <>
      {exactAttentionTargetLoaded ? <AttentionOpenAcknowledgement /> : null}
      {error ? <DayFailure message={error} retry={() => void start()} /> : null}
      {id && detail.isPending ? (
        <DayLoading />
      ) : detail.isError ? (
        focusPlanId
          ? <DayPlanTargetUnavailable message="This day-plan draft could not be opened. It may have been removed or you may no longer have access." />
          : <DayFailure message={detail.error.message} retry={() => void detail.refetch()} />
      ) : focusUnavailable ? (
        <DayPlanTargetUnavailable
          title={focusPeriodId ? "Timetable period unavailable" : undefined}
          message={focusPeriodId
            ? "This dated timetable no longer matches the linked class and date."
            : "This day-plan draft is no longer awaiting publication."}
        />
      ) : periodUnavailable ? (
        <DayPlanTargetUnavailable
          title="Timetable period unavailable"
          message="This period is no longer part of the linked day plan. The current schedule is shown below."
        />
      ) : plan?.draft_version && editing ? (
        <div
          ref={focusMatchesDraft ? focusRef : undefined}
          id={`day-plan-draft-${plan.id}`}
          tabIndex={focusMatchesDraft ? -1 : undefined}
          className={focusMatchesDraft ? "day-attention-target" : undefined}
        >
          <PlanEditor
            key={`${plan.id}:${plan.draft_version}`}
            plan={plan}
            teachers={options.teachers}
            subjects={options.subjects}
            onSaved={refresh}
            onDirty={onDirty}
            focusedPeriodId={focusedDraftPeriod?.id}
          />
        </div>
      ) : null}
      <section
        ref={focusPublishedSourceId?publishedFocusRef:undefined}
        id={focusPublishedSourceId?`attention-timetable-source-${focusPublishedSourceId}`:undefined}
        tabIndex={focusPublishedSourceId?-1:undefined}
        className={`day-panel day-published${focusPublishedSourceId?" day-attention-target":""}`}
        aria-labelledby="published-heading"
      >
        <header className="day-heading">
          <div>
            <h2 id="published-heading">Day schedule</h2>
            <span className="day-schedule-meta">{live.filter((period) => !period.cancelled).length} periods{plan?.published_version ? " · Published changes" : ""}</span>
          </div>
          {canEdit || live.length || plan?.published_version ? scheduleActions : null}
        </header>
        {plan?.versions.find((v) => v.version === plan.published_version)
          ?.notice ? (
          <p className="day-notice">
            {
              plan.versions.find((v) => v.version === plan.published_version)
                ?.notice
            }
          </p>
        ) : null}
        {live.length ? (
          <DayPeriodList
            periods={live}
            focusedPeriodId={focusedDraftPeriod && editing ? undefined : focusedPublishedPeriod?.id}
          />
        ) : (
          <div className="day-empty-state" role="status">
            <CalendarDays size={20} />
            <span><strong>No periods scheduled</strong><small>This class has no timetable entries for the selected date.</small></span>
          </div>
        )}
        {plan?.published_periods
          .filter(
            (p) =>
              !p.cancelled &&
              ["pending", "declined", "accepted"].includes(p.coverage_status),
          )
          .map((p) => (
            <div key={p.id} className="day-assisted-row">
              <span>
                P{p.period_number} · {p.teacher_name}
                {p.response_note ? (
                  <small>
                    {p.response_note} · {p.response_source?.replace("_", " ")}
                  </small>
                ) : null}
              </span>
              <button className="day-secondary" onClick={() => setResponse(p)}>
                Record assisted response
              </button>
            </div>
          ))}
      </section>
      {plan?.versions.length ? (
        <details className="day-panel day-history">
          <summary>
            <History size={18} />
            Revision history <span>{plan.versions.length}</span>
          </summary>
          <ol>
            {plan.versions.map((v) => (
              <li key={v.version}>
                <div>
                  <strong>
                    Version {v.version} · {v.state}
                  </strong>
                  <span>
                    {v.author} ·{" "}
                    {new Date(v.published_at ?? v.created_at).toLocaleString(
                      "en-IN",
                    )}
                  </span>
                </div>
                <p>{v.reason || "Draft prepared from the current schedule."}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {response ? (
        <CoverageResponse
          key={response.id}
          schoolId={schoolId}
          period={
            plan?.published_periods.find((p) => p.id === response.id) ??
            response
          }
          assisted
          onSaved={refresh}
          onClose={() => setResponse(null)}
        />
      ) : null}
    </>
  );
}
function DayPlanTargetUnavailable({ message, title = "Day-plan request unavailable" }: { message: string; title?: string }) {
  return (
    <section className="day-panel day-target-unavailable" role="alert">
      <CalendarDays size={21} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        <Link to="/principal/timetable/day">Open current day plans</Link>
      </div>
    </section>
  );
}
export function DayLoading() {
  return (
    <div
      className="day-panel day-skeleton"
      role="status"
      aria-label="Loading day plan"
    >
      <span />
      <span />
      <span />
    </div>
  );
}
export function DayFailure({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div role="alert" className="day-error">
      <p>{message}</p>
      <button className="day-secondary" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
