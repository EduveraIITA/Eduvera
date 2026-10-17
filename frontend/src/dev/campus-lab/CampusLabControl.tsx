import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { setCampusLabEnabled } from "./api";
import { useOptionalCampusLabProjection } from "./CampusLabProjectionContext";

export default function CampusLabControl() {
  const projection = useOptionalCampusLabProjection();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = projection?.status?.control?.enabled ?? false;
  const unavailable = !projection || projection.isPending || projection.isError;

  async function update(next: boolean) {
    setIsSaving(true);
    setError(null);
    try {
      await setCampusLabEnabled(next);
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
      <small>{enabled ? "Actors follow the real Cambridge school day and current timetable." : "No simulated actor will perform an action."}</small>
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
    {error ? <p id="campus-lab-control-error" role="alert">{error}</p> : null}
  </div>;
}
