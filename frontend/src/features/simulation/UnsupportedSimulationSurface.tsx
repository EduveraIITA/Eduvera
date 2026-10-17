import { ShieldAlert } from "lucide-react";
import { useId } from "react";
import { useSimulationExecutionEnvironment } from "./ExecutionEnvironmentContext";
import "./unsupported-simulation-surface.css";

export interface UnsupportedSimulationSurfaceProps {
  readonly surfaceName: string;
  readonly onReturnToLive?: () => void;
  readonly returnLabel?: string;
}

/**
 * A fail-closed route state for domains that do not yet have a scenario projection.
 * It intentionally renders no live fallback data while the simulation is selected.
 */
export function UnsupportedSimulationSurface({
  surfaceName,
  onReturnToLive,
  returnLabel = "Return to live campus",
}: UnsupportedSimulationSurfaceProps) {
  useSimulationExecutionEnvironment();
  const titleId = useId();

  return (
    <section
      className="unsupported-simulation-surface"
      role="alert"
      aria-labelledby={titleId}
    >
      <span className="unsupported-simulation-surface__icon" aria-hidden="true">
        <ShieldAlert size={24} strokeWidth={1.8} />
      </span>
      <p className="unsupported-simulation-surface__eyebrow">
        Isolated simulation
      </p>
      <h2 id={titleId}>{surfaceName} is not available in this simulation</h2>
      <p>
        This area has not been connected to the isolated run. Live campus data stays
        hidden here so simulated and real records cannot be mixed.
      </p>
      <small>
        No live record, message or external service has been changed.
      </small>
      {onReturnToLive ? (
        <button type="button" onClick={onReturnToLive}>
          {returnLabel}
        </button>
      ) : null}
    </section>
  );
}
