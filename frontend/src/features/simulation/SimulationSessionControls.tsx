import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, LoaderCircle, Pause, Play, RotateCcw, Settings2 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useOptionalApplicationExecutionEnvironment } from "./ApplicationExecutionEnvironment";
import { useOptionalExecutionEnvironment } from "./ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "./executionEnvironmentQueryKey";
import { isSimulationExecutionEnvironment, type SimulationExecutionEnvironment } from "./executionEnvironment";
import { getSimulationRun, pauseSimulationRun, resumeSimulationRun } from "./simulationApi";
import "./simulation-session-controls.css";

function statusLabel(status: string | undefined) {
  if (!status) return "Status unavailable";
  return status[0]!.toUpperCase() + status.slice(1);
}

function SelectedSimulationControls({ environment, schoolId }: { environment: SimulationExecutionEnvironment; schoolId: string }) {
  const applicationEnvironment = useOptionalApplicationExecutionEnvironment();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const queryKey = executionEnvironmentQueryKey(environment, ["simulation-session-run", schoolId, environment.runId]);
  const runQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => getSimulationRun(schoolId, environment.runId, signal),
    retry: false,
    refetchInterval: (query) => (query.state.data?.run.status ?? environment.runStatus) === "running" ? 2_000 : false,
  });
  const run = runQuery.data?.run;
  const status = run?.status ?? environment.runStatus;
  const speed = run?.speed ?? environment.speed;
  // Navigation can cancel the detail request while the selected environment is
  // already confirmed. Keep the essential lifecycle control available from the
  // server-confirmed session descriptor until the detail query reconnects.
  const canPause = run ? run.available_actions.includes("pause") : status === "running";
  const canResume = run ? run.available_actions.includes("resume") : status === "paused";
  const control = useMutation({
    mutationFn: (action: "pause" | "resume") => action === "pause"
      ? pauseSimulationRun(schoolId, environment.runId)
      : resumeSimulationRun(schoolId, environment.runId, { speed: run?.speed }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
  });
  const virtualNow = run?.clock.virtual_now ?? environment.virtualClock.now;
  const timeZone = run?.clock.time_zone ?? environment.virtualClock.timeZone;
  const formatter = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const switching = applicationEnvironment?.switchState === "switching";
  const working = control.isPending || switching;
  const returnToLive = async () => {
    if (!await applicationEnvironment?.returnToLive()) return;
    // A newly created scenario register has no Live counterpart. Keep the
    // attendance date, but leave its world-specific record selection behind.
    if (location.pathname === "/areas/attendance/registers") {
      const search = new URLSearchParams(location.search);
      if (search.has("register_id") || search.has("occurrence_id")) {
        search.delete("register_id"); search.delete("occurrence_id");
        await navigate({ pathname: location.pathname, search: search.toString() }, { replace: true });
      }
    }
  };

  return (
    <aside className="simulation-session-controls" aria-label="Selected simulation" aria-busy={runQuery.isPending || working}>
      <div className="simulation-session-controls__time">
        <Clock3 size={17} aria-hidden="true" />
        <span><small>Simulation time</small><strong>{formatter.format(new Date(virtualNow))}</strong></span>
      </div>
      <div className="simulation-session-controls__state">
        <span>{statusLabel(status)}</span>
        {speed !== undefined ? <strong>{speed}×</strong> : null}
      </div>
      <div className="simulation-session-controls__actions">
        {canPause ? <button type="button" title="Pause simulation" disabled={working} onClick={() => control.mutate("pause")}>
          <Pause size={15} aria-hidden="true" /> <span>Pause</span>
        </button> : null}
        {canResume ? <button type="button" title="Resume simulation" disabled={working} onClick={() => control.mutate("resume")}>
          <Play size={15} aria-hidden="true" /> <span>Resume</span>
        </button> : null}
        <Link to="/more/simulation" title="Manage simulation"><Settings2 size={15} aria-hidden="true" /><span>Manage</span></Link>
        {applicationEnvironment ? <button type="button" className="simulation-session-controls__return" disabled={working} onClick={() => void returnToLive()}>
          {switching ? <LoaderCircle className="simulation-session-controls__spinner" size={15} aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}
          <span>{switching ? "Returning…" : "Return to Live"}</span>
        </button> : null}
      </div>
      {control.isError ? <p role="alert">{control.error instanceof Error ? control.error.message : "The simulation control could not be updated."}</p> : null}
    </aside>
  );
}

export function SimulationSessionControls({ schoolId }: { schoolId?: string }) {
  const environment = useOptionalExecutionEnvironment();
  const location = useLocation();
  if (!environment || !isSimulationExecutionEnvironment(environment)) return null;
  // Running and terminal worlds already expose their full lifecycle controls
  // on the Simulation workspace. A scenario draft does not, so keep the compact
  // session bar there as a direct, low-friction way back to Live.
  if (location.pathname === "/more/simulation" && environment.runStatus !== "draft") return null;
  const institutionId = schoolId || environment.institutionId;
  if (!institutionId) return null;
  return <SelectedSimulationControls environment={environment} schoolId={institutionId} />;
}
