import { LockKeyhole, RefreshCw, TriangleAlert } from "lucide-react";
import { ApiError } from "../../lib/api";

interface WorkspaceStateProps {
  readonly state: "loading" | "error" | "revoked" | "unavailable";
  readonly error?: unknown;
  readonly onRetry?: () => unknown;
}

function stateCopy(state: WorkspaceStateProps["state"], error: unknown) {
  if (state === "revoked") return {
    title: "Your workspace access changed",
    detail: "This workspace is no longer part of your current responsibilities. Refresh to use your latest access.",
  };
  if (state === "unavailable") return {
    title: "This simulation is unavailable",
    detail: "Return to Live or choose an available simulation before opening your workspace.",
  };
  if (error instanceof ApiError && error.status === 410) return {
    title: "This workspace is no longer active",
    detail: "Its context may have expired or changed. Refresh to open your current workspace.",
  };
  return {
    title: "We couldn’t load your workspace",
    detail: "Your campus records were not changed. Check the connection and try again.",
  };
}

export function WorkspaceState({ state, error, onRetry }: WorkspaceStateProps) {
  if (state === "loading") {
    return <section className="responsibility-workspace responsibility-workspace--state" aria-busy="true" aria-label="Loading your workspace">
      <div className="workspace-skeleton" role="status">
        <span className="workspace-skeleton__title" />
        <span className="workspace-skeleton__feature" />
        <span /><span /><span />
        <em>Loading your current work…</em>
      </div>
    </section>;
  }

  const copy = stateCopy(state, error);
  const Icon = state === "revoked" ? LockKeyhole : TriangleAlert;
  return <section className="responsibility-workspace responsibility-workspace--state">
    <section className="workspace-state-card" role="alert" aria-labelledby="workspace-state-title">
      <span className="workspace-state-card__icon" aria-hidden="true"><Icon size={24} /></span>
      <h2 id="workspace-state-title">{copy.title}</h2>
      <p>{copy.detail}</p>
      {onRetry ? <button type="button" onClick={() => void onRetry()}>
        <RefreshCw size={17} aria-hidden="true" /> Refresh workspace
      </button> : null}
    </section>
  </section>;
}
