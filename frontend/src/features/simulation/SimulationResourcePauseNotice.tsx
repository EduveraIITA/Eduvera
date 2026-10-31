import { CircleAlert } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import type { SimulationRunView } from "./simulationApi";

function pauseExplanation(reason: string) {
  const normalized = reason.toLowerCase();
  if (/snapshot|compatib|schema|version/u.test(normalized)) {
    return "This retained snapshot needs a compatible Simulation runtime before virtual time can continue.";
  }
  if (/storage|quota|limit|reservation|capacity|resource/u.test(normalized)) {
    return "This run reached an institution Simulation capacity limit. Review the institution's Simulation limits before continuing.";
  }
  if (/lease|worker|runtime|checkpoint/u.test(normalized)) {
    return "The Simulation runtime paused at a safe checkpoint and needs administrator review before virtual time can continue.";
  }
  return "The Simulation service detected a run-specific condition and paused virtual time at a safe checkpoint.";
}

function pausedAtLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pause time unavailable";
  return `Paused ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
}

export function SimulationResourcePauseNotice({
  canResume,
  compact = false,
  resources,
}: {
  canResume: boolean;
  compact?: boolean;
  resources: SimulationRunView["resources"];
}) {
  if (!resources.paused_at || !resources.pause_reason) return null;
  return (
    <aside
      className={`simulation-resource-pause${compact ? " simulation-resource-pause--compact" : ""}`}
      role={compact ? "note" : "status"}
      aria-label="Simulation advancement paused"
    >
      <CircleAlert size={compact ? 17 : 20} aria-hidden="true" />
      <div>
        <strong>Simulation advancement paused</strong>
        <p>{pauseExplanation(resources.pause_reason)} The isolated world was retained; no active world was deleted.</p>
        <p>{canResume
          ? "Resolve the reported condition, then choose Resume."
          : "Review the condition with an institution administrator before this run advances."}</p>
        <details>
          <InfoSummary>Pause details</InfoSummary>
          <div>
            <time dateTime={resources.paused_at}>{pausedAtLabel(resources.paused_at)}</time>
            <code>{resources.pause_reason}</code>
          </div>
        </details>
      </div>
    </aside>
  );
}
