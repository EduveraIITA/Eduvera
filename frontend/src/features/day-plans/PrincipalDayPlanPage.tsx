import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  History,
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
import { TimetableNavigator, timetableSummaryRange, type TimetableView } from "../timetable/TimetableNavigator";
import { DayPeriodList } from "./DayPeriodList";
import { PlanEditor } from "./PlanEditor";
import { CoverageResponse } from "./CoverageResponse";
import "./day-plans.css";
export default function PrincipalDayPlanPage() {
  const auth = useAuth(),
    [params, setParams] = useSearchParams();
  const [dirty, setDirty] = useState(false);
  const schools = auth.memberships.filter((m) => m.role === "admin");
  const schoolId = params.get("school") || schools[0]?.school_id || "";
  const date = params.get("date") || schoolDateToday();
  const requestedView = params.get("view");
  const view: TimetableView = ["day", "week", "month", "year"].includes(requestedView ?? "")
    ? requestedView as TimetableView
    : "day";
  const query = useQuery({
    queryKey: ["school", "day-plans", "options", schoolId, date],
    queryFn: () => getPlanOptions(schoolId, date),
    enabled: !!schoolId,
  });
  const section =
    query.data?.classes.find((c) => c.id === params.get("class")) ??
    query.data?.classes[0];
  const range = timetableSummaryRange(date, view);
  const summary = useQuery({
    queryKey: ["school", "day-plans", "admin-summary", schoolId, section?.id ?? "all", range.start, range.end],
    queryFn: () => getAdminSummary(schoolId, range.start, range.end, section?.id),
    enabled: !!schoolId,
  });
  const set = (values: Record<string, string>) => {
    if (
      dirty &&
      !window.confirm("Leave this draft without saving your latest edits?")
    )
      return;
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) next.set(key, value);
    setParams(next);
  };
  return (
    <OperationsShell
      portal="principal"
      active="timetable"
      title="Daily school plan"
      backTo="/principal/more"
      subtitle="Timetable"
      schoolName={schools.find((s) => s.school_id === schoolId)?.school_name}
      contentHasHeading
    >
      <div className="day-workspace">
        <div className="day-page-actions">
          <Link className="day-secondary" to="/principal/timetable/weekly">
            Manage timetable <ArrowRight size={16} />
          </Link>
        </div>
        <TimetableNavigator
          date={date}
          view={view}
          summary={summary.data}
          loading={summary.isPending}
          error={summary.isError ? summary.error.message : undefined}
          contextControl={
            <label className="timetable-context-select">
              <span className="sr-only">Class</span>
              <select
                aria-label="Class"
                value={section?.id ?? ""}
                disabled={!query.data?.classes.length}
                onChange={(e) => set({ class: e.target.value })}
              >
                {query.data?.classes.length ? (
                  query.data.classes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))
                ) : (
                  <option value="">No classes</option>
                )}
              </select>
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
        {query.isPending ? (
          <DayLoading />
        ) : query.isError ? (
          <DayFailure
            message={query.error.message}
            retry={() => void query.refetch()}
          />
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
                key={`${schoolId}:${date}:${section.id}`}
                schoolId={schoolId}
                date={date}
                section={section}
                options={query.data}
                onDirty={setDirty}
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
}: {
  schoolId: string;
  date: string;
  section: PlanOptions["classes"][number];
  options: PlanOptions;
  onDirty: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [startedId, setStartedId] = useState("");
  const id = startedId || section.plan_id || "";
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [response, setResponse] = useState<DayPeriod | null>(null);
  const startKey = useRef<string | null>(null);
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
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the draft.");
    } finally {
      setBusy(false);
    }
  }
  const plan = detail.data;
  const live = sharedDayPeriods(plan, options.schedule, section.id);
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
    <div className="day-actions day-schedule-actions">
      {plan?.draft_version ? null : canEdit ? (
        <button
          className="day-primary"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy
            ? "Preparing…"
            : plan?.published_version
              ? "Create revision"
              : "Prepare changes"}
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
          <Printer size={19} />
        </button>
      ) : null}
    </div>
  );
  return (
    <>
      {error ? <DayFailure message={error} retry={() => void start()} /> : null}
      {id && detail.isPending ? (
        <DayLoading />
      ) : detail.isError ? (
        <DayFailure
          message={detail.error.message}
          retry={() => void detail.refetch()}
        />
      ) : plan?.draft_version ? (
        <PlanEditor
          key={`${plan.id}:${plan.draft_version}`}
          plan={plan}
          teachers={options.teachers}
          subjects={options.subjects}
          onSaved={refresh}
          onDirty={onDirty}
        />
      ) : null}
      <section
        className="day-panel day-published"
        aria-labelledby="published-heading"
      >
        <header className="day-heading">
          <div>
            <span className="day-eyebrow">{section.name}</span>
            <h2 id="published-heading">Published timetable</h2>
          </div>
          {scheduleActions}
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
          <DayPeriodList periods={live} />
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
