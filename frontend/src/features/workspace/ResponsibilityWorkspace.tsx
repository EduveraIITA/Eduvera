import { ProductIcon } from "../../components/ProductIcon";
import { useState } from "react";
import { ApiError } from "../../lib/api";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import type { WorkspaceManifest, WorkspaceView } from "./types";
import { useWorkspaceManifest } from "./useWorkspaceManifest";
import { WorkspaceState } from "./WorkspaceState";
import {
  WorkspaceAreasView,
  WorkspaceMoreView,
  WorkspaceTodayView,
  WorkspaceWorkView,
} from "./WorkspaceViews";
import "./workspace.css";

const destinations = [
  { id: "today", label: "Today" },
  { id: "work", label: "Work" },
  { id: "areas", label: "Areas" },
  { id: "more", label: "More" },
] as const;

export function manifestMatchesEnvironment(manifest: WorkspaceManifest, environment: ExecutionEnvironment) {
  if (manifest.context.environment.kind !== environment.mode) return false;
  if (environment.mode === "live") return true;
  if (environment.unavailable === true) return false;
  return manifest.context.environment.namespace_id === environment.namespaceId;
}

export function WorkspaceNavigation({
  active,
  manifest,
  onChange,
}: {
  readonly active: WorkspaceView;
  readonly manifest: WorkspaceManifest;
  readonly onChange: (view: WorkspaceView) => void;
}) {
  const badges: Partial<Record<WorkspaceView, number>> = {
    work: manifest.work.counts?.needs_me ?? manifest.work.items.filter(item => item.direction !== "waiting").length,
    areas: manifest.areas.reduce((total, area) => total + (area.attention_count ?? 0), 0),
  };
  return <nav className="workspace-navigation" aria-label="Workspace">
    {destinations.map(({ id, label }) => {
      const badge = badges[id];
      return <button
        key={id}
        type="button"
        className={active === id ? "is-active" : undefined}
        aria-current={active === id ? "page" : undefined}
        onClick={() => onChange(id)}
      >
        <span className="workspace-navigation__icon">
          <ProductIcon name={id} size={26} />
          {badge ? <small aria-label={`${badge} items need attention`}>{badge > 99 ? "99+" : badge}</small> : null}
        </span>
        <span>{label}</span>
      </button>;
    })}
  </nav>;
}

export interface WorkspaceExperienceProps {
  readonly manifest: WorkspaceManifest;
  readonly initialView?: WorkspaceView;
  readonly activeView?: WorkspaceView;
  readonly onViewChange?: (view: WorkspaceView) => void;
  /** Existing app shells can render the same exported navigation separately. */
  readonly showNavigation?: boolean;
  /** The shared app shell already owns the single page heading. */
  readonly showPageHeading?: boolean;
}

/** Pure presentation seam for stories, route composition and focused tests. */
export function WorkspaceExperience({
  manifest,
  initialView = "today",
  activeView,
  onViewChange,
  showNavigation = true,
  showPageHeading = true,
}: WorkspaceExperienceProps) {
  const [localView, setLocalView] = useState<WorkspaceView>(initialView);
  const currentView = activeView ?? localView;
  const changeView = (view: WorkspaceView) => {
    if (activeView === undefined) setLocalView(view);
    onViewChange?.(view);
  };

  return <section
    className="responsibility-workspace"
    data-execution-mode={manifest.context.environment.kind}
    data-workspace-revision={manifest.revision}
  >
    {manifest.context.scope_label ? <p className="workspace-scope-label">{manifest.context.scope_label}</p> : null}
    <div className="responsibility-workspace__content" aria-live="polite">
      {currentView === "today" ? <WorkspaceTodayView manifest={manifest} showPageHeading={showPageHeading} /> : null}
      {currentView === "work" ? <WorkspaceWorkView manifest={manifest} showPageHeading={showPageHeading} /> : null}
      {currentView === "areas" ? <WorkspaceAreasView manifest={manifest} showPageHeading={showPageHeading} /> : null}
      {currentView === "more" ? <WorkspaceMoreView manifest={manifest} showPageHeading={showPageHeading} /> : null}
    </div>
    {showNavigation ? <WorkspaceNavigation active={currentView} manifest={manifest} onChange={changeView} /> : null}
  </section>;
}

export interface ResponsibilityWorkspaceProps {
  readonly activeView?: WorkspaceView;
  readonly onViewChange?: (view: WorkspaceView) => void;
  readonly showNavigation?: boolean;
  readonly showPageHeading?: boolean;
}

/** Data-owning route component. It contains no role or portal assumptions. */
export function ResponsibilityWorkspace({
  activeView,
  onViewChange,
  showNavigation = true,
  showPageHeading = true,
}: ResponsibilityWorkspaceProps = {}) {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();

  if (environment.mode === "simulation" && environment.unavailable === true) {
    return <WorkspaceState state="unavailable" />;
  }
  if (query.isPending) return <WorkspaceState state="loading" />;
  if (query.error) {
    const revoked = query.error instanceof ApiError && query.error.status === 403;
    return <WorkspaceState state={revoked ? "revoked" : "error"} error={query.error} onRetry={query.refetch} />;
  }
  if (!query.data || !manifestMatchesEnvironment(query.data, environment)) {
    return <WorkspaceState
      state="error"
      error={new Error("The workspace context did not match the active environment.")}
      onRetry={query.refetch}
    />;
  }
  return <WorkspaceExperience
    key={`${query.data.context.actor_user_id ?? "session"}:${query.data.context.institution_id}:${query.data.context.environment.namespace_id ?? environment.mode}`}
    manifest={query.data}
    activeView={activeView}
    onViewChange={onViewChange}
    showNavigation={showNavigation}
    showPageHeading={showPageHeading}
  />;
}
