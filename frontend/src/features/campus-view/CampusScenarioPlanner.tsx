import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarClock, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { CampusScenarioResult } from "./CampusScenarioResult";
import { createCampusScenario, discardCampusScenario, getCampusScenario, getCampusScenarioTargets } from "./scenarioApi";
import type { CampusScenarioInterventionType, CampusScenarioSessionWindow, CampusScenarioTarget } from "./scenarioApi";

const horizons = [7, 14, 30] as const;

function localDate(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(new Date(instant));
}

function eligibleWindows(target: CampusScenarioTarget | undefined, timezone: string): CampusScenarioSessionWindow[] {
  if (!target) return [];
  if (target.date_windows?.length) return target.date_windows;
  if (target.session_windows?.length) return target.session_windows;
  if (!target.suggested_window) return [];
  return [{
    date: localDate(target.suggested_window.starts_at, timezone),
    ...target.suggested_window,
  }];
}

function hasEligibleWindow(target: CampusScenarioTarget, timezone: string) {
  return eligibleWindows(target, timezone).length > 0;
}

function windowForDate(windows: CampusScenarioSessionWindow[], date: string) {
  const matching = windows.filter((window) => window.date === date);
  if (!matching.length) return null;
  return {
    starts_at: matching.reduce((earliest, window) => Date.parse(window.starts_at) < Date.parse(earliest) ? window.starts_at : earliest, matching[0]!.starts_at),
    ends_at: matching.reduce((latest, window) => Date.parse(window.ends_at) > Date.parse(latest) ? window.ends_at : latest, matching[0]!.ends_at),
  };
}

export function CampusScenarioPlanner({ schoolId, campusId, timezone, teachers, spaces }: {
  schoolId: string;
  campusId?: string;
  timezone: string;
  teachers: CampusScenarioTarget[];
  spaces: CampusScenarioTarget[];
}) {
  const [type, setType] = useState<CampusScenarioInterventionType>(teachers.length ? "teacher_unavailable" : "space_unavailable");
  const [targetId, setTargetId] = useState(teachers[0]?.id ?? spaces[0]?.id ?? "");
  const [horizon, setHorizon] = useState<number>(30);
  const [unavailableDate, setUnavailableDate] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const targetCatalogue = useQuery({
    queryKey: ["campus-view", "scenario-targets", schoolId, campusId ?? "all", horizon],
    queryFn: ({ signal }) => getCampusScenarioTargets(schoolId, { campusId, horizonDays: horizon }, signal),
    enabled: Boolean(schoolId),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const fallbackTeachers = teachers.filter((target) => hasEligibleWindow(target, timezone));
  const fallbackSpaces = spaces.filter((target) => hasEligibleWindow(target, timezone));
  const availableTeachers = targetCatalogue.data?.teachers ?? fallbackTeachers;
  const availableSpaces = targetCatalogue.data?.spaces ?? fallbackSpaces;
  const resolvedType = type === "teacher_unavailable" && availableTeachers.length
    ? type
    : type === "space_unavailable" && availableSpaces.length
      ? type
      : availableTeachers.length ? "teacher_unavailable" : availableSpaces.length ? "space_unavailable" : type;
  const targets = resolvedType === "teacher_unavailable" ? availableTeachers : availableSpaces;
  const selectedTargetId = targets.some((target) => target.id === targetId) ? targetId : targets[0]?.id ?? "";
  const selectedTarget = targets.find((target) => target.id === selectedTargetId);
  const windows = eligibleWindows(selectedTarget, timezone);
  const dates = [...new Set(windows.map((window) => window.date))].sort();
  const preferredDate = unavailableDate || selectedTarget?.suggested_date || "";
  const selectedDate = dates.includes(preferredDate) ? preferredDate : dates[0] ?? "";
  const selectedWindow = windowForDate(windows, selectedDate);
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: timezone });

  const create = useMutation({
    mutationFn: () => {
      if (!selectedWindow) throw new Error("An eligible scheduled time window is required.");
      return createCampusScenario(schoolId, {
        campus_id: campusId,
        horizon_days: horizon,
        intervention: { type: resolvedType, target_id: selectedTargetId, ...selectedWindow },
      });
    },
    onSuccess: (response) => setRunId(response.run.id),
  });
  const run = useQuery({
    queryKey: ["campus-view", "scenario", schoolId, runId],
    queryFn: ({ signal }) => getCampusScenario(schoolId, runId!, signal),
    enabled: Boolean(runId),
    retry: false,
    refetchInterval: (query) => query.state.data?.run.status === "queued" || query.state.data?.run.status === "running" ? 1_500 : false,
  });
  const discard = useMutation({
    mutationFn: (id: string) => discardCampusScenario(schoolId, id),
    onSuccess: () => { setRunId(null); create.reset(); },
  });
  const result = run.data?.run ?? create.data?.run;
  const pending = create.isPending || result?.status === "queued" || result?.status === "running";
  const hasTargets = availableTeachers.length > 0 || availableSpaces.length > 0;
  const hasFallbackTargets = fallbackTeachers.length > 0 || fallbackSpaces.length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (selectedTargetId && selectedWindow) create.mutate();
  };
  const changeType = (next: CampusScenarioInterventionType) => {
    setType(next);
    const nextTargets = next === "teacher_unavailable" ? availableTeachers : availableSpaces;
    setTargetId(nextTargets[0]?.id ?? "");
    setUnavailableDate(nextTargets[0]?.suggested_date ?? "");
  };
  const changeHorizon = (days: number) => {
    setHorizon(days);
    setUnavailableDate("");
  };
  const changeTarget = (id: string) => {
    setTargetId(id);
    setUnavailableDate(targets.find((target) => target.id === id)?.suggested_date ?? "");
  };

  if (result) return <CampusScenarioResult run={result} timezone={timezone} isDiscarding={discard.isPending} onDiscard={() => discard.mutate(result.id)} />;

  return <div className="campus-scenario-planner">
    <section className="campus-scenario-intro" aria-labelledby="campus-scenario-title">
      <CalendarClock size={20} aria-hidden="true" />
      <div><span>Plan &amp; what-if</span><h3 id="campus-scenario-title">Test a future change</h3><p>Compare the current plan with one isolated alternative. Results are estimates from a snapshot—not decisions or live campus facts.</p></div>
    </section>
    <div className="campus-scenario-safety" role="note"><ShieldCheck size={17} aria-hidden="true" /><p><strong>No live changes or messages.</strong> The run cannot write to operations, contact people or call production connectors.</p></div>

    {targetCatalogue.isPending && !hasFallbackTargets ? <div className="campus-scenario-catalogue-state" aria-busy="true" aria-label="Loading planning options">
      <span className="campus-scenario-catalogue-state__spinner" aria-hidden="true" />
      <strong>Checking the published plan</strong>
      <p>Finding teachers, spaces and exact future session times for this campus.</p>
    </div> : targetCatalogue.isError && !hasFallbackTargets ? <div className="campus-scenario-catalogue-state is-error" role="alert">
      <AlertCircle size={22} aria-hidden="true" />
      <strong>Planning options couldn’t be loaded</strong>
      <p>No scenario can run until a scheduled target and time are verified. Check the connection and try again.</p>
      <button type="button" onClick={() => void targetCatalogue.refetch()}><RefreshCw size={15} aria-hidden="true" />Try again</button>
    </div> : targetCatalogue.isSuccess && !hasTargets ? <div className="campus-scenario-catalogue-state" role="status">
      <CalendarClock size={22} aria-hidden="true" />
      <strong>No future sessions available</strong>
      <p>This campus has no eligible teacher or space sessions in the next {horizon} days. Publish the timetable or choose another horizon, then refresh.</p>
      <div className="campus-scenario-empty-actions" aria-label="Planning options">
        {horizons.filter((days) => days !== horizon).map((days) => <button key={days} type="button" onClick={() => changeHorizon(days)}>Check {days} days</button>)}
        <button type="button" onClick={() => void targetCatalogue.refetch()}><RefreshCw size={15} aria-hidden="true" />Refresh</button>
      </div>
    </div> : <form className="campus-scenario-form" onSubmit={submit}>
      {targetCatalogue.isError ? <div className="campus-scenario-catalogue-note" role="status"><span>Using verified options from the current snapshot.</span><button type="button" onClick={() => void targetCatalogue.refetch()}><RefreshCw size={14} aria-hidden="true" />Retry catalogue</button></div> : targetCatalogue.isFetching ? <p className="campus-scenario-catalogue-note" role="status">Refreshing verified planning options…</p> : null}
      <fieldset>
        <legend>What changes?</legend>
        <div className="campus-scenario-choice">
          <button type="button" aria-pressed={resolvedType === "teacher_unavailable"} disabled={!availableTeachers.length} onClick={() => changeType("teacher_unavailable")}>Teacher unavailable</button>
          <button type="button" aria-pressed={resolvedType === "space_unavailable"} disabled={!availableSpaces.length} onClick={() => changeType("space_unavailable")}>Space unavailable</button>
        </div>
      </fieldset>

      <div className="campus-scenario-field"><label htmlFor="campus-scenario-target">{resolvedType === "teacher_unavailable" ? "Teacher" : "Campus space"}</label>
        <select id="campus-scenario-target" aria-describedby="campus-scenario-target-help" value={selectedTargetId} onChange={(event) => changeTarget(event.target.value)} disabled={!targets.length}>
          {!targets.length ? <option value="">No eligible targets in this snapshot</option> : targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
        </select>
        <small id="campus-scenario-target-help">Eligible teachers and spaces come from scheduled sessions in the next {horizon} days.</small>
      </div>

      <div className="campus-scenario-field"><label htmlFor="campus-scenario-date">Unavailable on</label>
        <select id="campus-scenario-date" aria-describedby="campus-scenario-date-help" value={selectedDate} onChange={(event) => setUnavailableDate(event.target.value)} disabled={!dates.length}>
          {!dates.length ? <option value="">No eligible scheduled time</option> : dates.map((date) => <option key={date} value={date}>{new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}</option>)}
        </select>
        <small id="campus-scenario-date-help">{selectedWindow ? `Uses the real scheduled window from ${time.format(new Date(selectedWindow.starts_at))} to ${time.format(new Date(selectedWindow.ends_at))} on this date.` : "No exact scheduled window is available. Refresh the planning catalogue before running this scenario."}</small></div>

      <fieldset>
        <legend>Planning horizon</legend>
        <div className="campus-scenario-choice is-horizon">{horizons.map((days) => <button key={days} type="button" aria-pressed={horizon === days} onClick={() => changeHorizon(days)}>Next {days}d</button>)}</div>
      </fieldset>

      <div className="campus-scenario-actions">
        {(create.isError || run.isError || discard.isError) ? <p className="campus-scenario-error" role="alert"><AlertCircle size={15} aria-hidden="true" />We couldn’t complete the isolated scenario. No live operation was changed.</p> : null}
        <button className="campus-scenario-run" type="submit" disabled={!selectedTargetId || !selectedWindow || pending}><Play size={17} aria-hidden="true" />{pending ? "Running scenario…" : "Run isolated scenario"}</button>
      </div>
    </form>}
  </div>;
}
