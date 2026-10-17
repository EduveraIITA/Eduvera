import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { setCampusLabEnabled } from "./api";
import { useOptionalCampusLabProjection } from "./CampusLabProjectionContext";

const durationOptions = [
  { mode: "realtime" as const, label: "Real time", detail: "Live clock" },
  { mode: "1m" as const, label: "1 min", detail: "Quick test" },
  { mode: "15m" as const, label: "15 min", detail: "Review" },
  { mode: "60m" as const, label: "1 hour", detail: "Observe" },
];

export default function CampusLabControl() {
  const projection = useOptionalCampusLabProjection();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = projection?.status?.control?.enabled ?? false;
  const clockMode = projection?.status?.control?.clock_mode ?? "60m";
  const unavailable = !projection || projection.isPending || projection.isError;

  async function update(next: boolean, nextClockMode = clockMode) {
    setIsSaving(true);
    setError(null);
    try {
      await setCampusLabEnabled(next, nextClockMode);
      await projection?.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Cambridge simulation could not be updated.");
    } finally {
      setIsSaving(false);
    }
  }

  return <div className="experimental-settings__lab-control">
    <div aria-live="polite">
      <strong>{enabled ? "Simulation active" : "Simulation stopped"}</strong>
      <small>{enabled ? clockMode === "realtime"
        ? "Actors follow the live Cambridge campus clock and effective timetable."
        : "Actors rotate through 30 calendar days using each date's effective timetable."
        : "No simulated actor will perform an action."}</small>
    </div>
    <button
      type="button"
      className={enabled ? "is-stop" : "is-start"}
      disabled={unavailable || isSaving}
      onClick={() => void update(!enabled)}
      aria-describedby={error ? "campus-lab-control-error" : undefined}
    >
      {enabled ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
      {isSaving ? "Updating…" : enabled ? "Stop simulation" : "Activate simulation"}
    </button>
    <fieldset className="experimental-settings__lab-speed" disabled={unavailable || isSaving}>
      <legend>Simulation clock</legend>
      <div role="radiogroup" aria-label="Simulation duration">
        {durationOptions.map((option) => <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={clockMode === option.mode}
          className={clockMode === option.mode ? "is-selected" : ""}
          onClick={() => void update(enabled, option.mode)}
        >
          <strong>{option.label}</strong>
          <small>{option.detail}</small>
        </button>)}
      </div>
      <small>Accelerated modes advance through a rolling 30-day timetable window, then rotate. Changing mode restarts the rehearsal, never the published timetable.</small>
    </fieldset>
    {error ? <p id="campus-lab-control-error" role="alert">{error}</p> : null}
  </div>;
}
