import { InfoSummary } from "../../components/InfoSummary";
import { useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import type { WorkspaceManifest } from "../workspace/types";
import { ActiveSimulationWorkspace } from "./ActiveSimulationWorkspace";
import { useExecutionEnvironment } from "./ExecutionEnvironmentContext";
import { isSimulationExecutionEnvironment } from "./executionEnvironment";
import { SimulationRunHistory } from "./SimulationRunHistory";
import { SimulationRunLaunch } from "./SimulationRunLaunch";
import { focusSimulationHeading } from "./simulationFocus";
import "./simulation-workspace.css";

function LiveSimulationWorkspace({ schoolId }: { schoolId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const panel = searchParams.get("panel") === "recent" ? "recent" : "start";
  const baselineFocused = panel === "start" && searchParams.get("step") === "baseline";
  const previousPanel = useRef(panel);
  const [managerLocked, setManagerLocked] = useState(false);

  useLayoutEffect(() => {
    if (previousPanel.current === panel) return;
    previousPanel.current = panel;
    focusSimulationHeading(document.getElementById(panel === "recent" ? "simulation-history-title" : "simulation-launch-title"));
  }, [panel]);

  const showPanel = (nextPanel: "start" | "recent") => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPanel === "start") next.delete("panel");
      else next.set("panel", "recent");
      next.delete("step");
      next.delete("compare");
      next.delete("page");
      next.delete("manage");
      next.delete("view");
      next.delete("select");
      return next;
    });
  };

  return (
    <div className="simulation-workspace">
      {!baselineFocused ? (
        <nav className="simulation-view-switcher simulation-view-switcher--workspace" aria-label="Simulation workspace">
          <button type="button" disabled={managerLocked} aria-pressed={panel === "start"} onClick={() => showPanel("start")}>
            New simulation
          </button>
          <button type="button" disabled={managerLocked} aria-pressed={panel === "recent"} aria-label="Saved simulations" onClick={() => showPanel("recent")}>
            Saved
          </button>
        </nav>
      ) : null}

      {panel === "start" ? (
        <>
          <SimulationRunLaunch schoolId={schoolId} />
          {!baselineFocused ? (
            <details className="simulation-isolation-details">
              <InfoSummary>How Simulation protects Live</InfoSummary>
              <p>Each run takes a fresh snapshot and creates run-local counterparts for its campus agents. It never contacts real people, devices or connectors, and it cannot write back to Live.</p>
            </details>
          ) : null}
        </>
      ) : <SimulationRunHistory schoolId={schoolId} onLockedChange={setManagerLocked} />}
    </div>
  );
}

export function SimulationWorkspacePage({ manifest }: { manifest: WorkspaceManifest }) {
  const environment = useExecutionEnvironment();
  const [searchParams] = useSearchParams();
  const schoolId = manifest.context.institution_id;
  const backTo = !isSimulationExecutionEnvironment(environment) && searchParams.get("step") === "baseline"
    ? "/more/simulation"
    : "/more";
  const contentHasHeading = isSimulationExecutionEnvironment(environment);

  return (
    <OperationsShell active="more" title="Simulation" backTo={backTo} contentHasHeading={contentHasHeading}>
      {isSimulationExecutionEnvironment(environment)
        ? <ActiveSimulationWorkspace schoolId={schoolId} />
        : <LiveSimulationWorkspace key={schoolId} schoolId={schoolId} />}
    </OperationsShell>
  );
}
