import { Activity, LoaderCircle, Radio, RotateCcw, X } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useOptionalAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "./ExecutionEnvironmentContext";
import { useOptionalApplicationExecutionEnvironment } from "./ApplicationExecutionEnvironment";
import { isSimulationExecutionEnvironment } from "./executionEnvironment";
import "./environment-marker.css";

export function EnvironmentMarker() {
  const auth = useOptionalAuth();
  const location = useLocation();
  const environment = useExecutionEnvironment();
  const applicationEnvironment = useOptionalApplicationExecutionEnvironment();
  const formatter = useMemo(() => isSimulationExecutionEnvironment(environment)
    ? new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: environment.virtualClock.timeZone,
    })
    : null, [environment]);

  const operationalRoute = [
    "/company",
    "/gate",
    "/parent",
    "/principal",
    "/student",
    "/teacher",
    "/work",
    "/workspace",
  ].some((prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`));

  if (auth?.status !== "authenticated" || !operationalRoute) return null;

  const switchError = applicationEnvironment?.switchError ? <div className="environment-marker-error" role="alert">
    <span>{applicationEnvironment.switchError}</span>
    <button type="button" onClick={applicationEnvironment.dismissSwitchError} aria-label="Dismiss environment message"><X size={14} aria-hidden="true" /></button>
  </div> : null;

  if (environment.mode === "live") return <div className="environment-marker-stack">
    <aside className="environment-marker is-live" aria-label="Live campus environment" aria-busy={applicationEnvironment?.switchState === "switching"}>
      {applicationEnvironment?.switchState === "switching" ? <LoaderCircle className="environment-marker__spinner" size={13} aria-hidden="true" /> : <Radio size={13} aria-hidden="true" />}
      <strong>Live</strong>
    </aside>
    {switchError}
  </div>;

  if (environment.unavailable === true) return <div className="environment-marker-stack">
    <aside className="environment-marker is-simulation is-expired" aria-label="Unavailable simulation environment">
      <Activity size={13} aria-hidden="true" />
      <span><strong>Simulation unavailable</strong></span>
      {applicationEnvironment ? <button
        type="button"
        className="environment-marker__return"
        aria-label="Return to Live"
        onClick={() => void applicationEnvironment.returnToLive()}
        disabled={applicationEnvironment.switchState === "switching"}
      >
        {applicationEnvironment.switchState === "switching" ? <LoaderCircle className="environment-marker__spinner" size={14} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
        <span>{applicationEnvironment.switchState === "switching" ? "Returning…" : "Return to Live"}</span>
      </button> : null}
    </aside>
    {switchError}
  </div>;

  const switching = applicationEnvironment?.switchState === "switching";
  const expired = applicationEnvironment?.expired === true;
  return <div className="environment-marker-stack">
    <aside className={`environment-marker is-simulation${expired ? " is-expired" : ""}`} aria-label={expired ? "Expired simulation environment" : "Simulation environment"} aria-busy={switching}>
      <Activity size={13} aria-hidden="true" />
      <span><strong>{expired ? "Simulation expired" : "Simulation"}</strong><small>{formatter!.format(new Date(environment.virtualClock.now))}</small></span>
      {applicationEnvironment ? <button
        type="button"
        className="environment-marker__return"
        aria-label="Return to Live"
        onClick={() => void applicationEnvironment.returnToLive()}
        disabled={switching}
      >
        {switching ? <LoaderCircle className="environment-marker__spinner" size={14} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
        <span>{switching ? "Returning…" : "Return to Live"}</span>
      </button> : null}
    </aside>
    {switchError}
  </div>;
}
