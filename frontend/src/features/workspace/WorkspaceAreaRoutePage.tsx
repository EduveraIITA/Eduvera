import { ArrowRight, LockKeyhole } from "lucide-react";
import { ProductIcon, productIconForDestination } from "../../components/ProductIcon";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "./ResponsibilityWorkspace";
import { WorkspaceLink } from "./WorkspaceLink";
import { WorkspaceState } from "./WorkspaceState";
import { useWorkspaceManifest } from "./useWorkspaceManifest";
import type { WorkspaceAreaSurface } from "./types";
import "./workspace.css";

export function uniqueAreaSurfaces(surfaces: readonly WorkspaceAreaSurface[]) {
  return [...new Map(surfaces.map((surface) => [surface.href, surface])).values()];
}

/**
 * Resolves an Area from the server manifest. One contribution opens directly;
 * multiple contributions remain an explicit, responsibility-scoped choice.
 */
export function WorkspaceAreaRoutePage({ areaKey }: { readonly areaKey: string }) {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();
  const location = useLocation();
  const navigate = useNavigate();

  if (environment.mode === "simulation" && environment.unavailable === true) {
    return <OperationsShell active="areas" title="Areas"><WorkspaceState state="unavailable" /></OperationsShell>;
  }
  if (query.isPending) {
    return <OperationsShell active="areas" title="Areas"><WorkspaceState state="loading" /></OperationsShell>;
  }
  if (query.error) {
    const revoked = query.error instanceof ApiError && query.error.status === 403;
    return <OperationsShell active="areas" title="Areas"><WorkspaceState state={revoked ? "revoked" : "error"} error={query.error} onRetry={query.refetch} /></OperationsShell>;
  }
  if (!query.data || !manifestMatchesEnvironment(query.data, environment)) {
    return <OperationsShell active="areas" title="Areas"><WorkspaceState state="error" error={new Error("The Area did not match the active environment.")} onRetry={query.refetch} /></OperationsShell>;
  }

  const area = query.data.areas.find((entry) => entry.key === areaKey);
  if (!area) {
    return <OperationsShell active="areas" title="Areas">
      <section className="responsibility-workspace responsibility-workspace--state">
        <section className="workspace-state-card" role="status" aria-labelledby="workspace-area-changed-title">
          <span className="workspace-state-card__icon" aria-hidden="true"><LockKeyhole size={24} /></span>
          <h2 id="workspace-area-changed-title">This Area is not in your current work</h2>
          <p>Its responsibility may have ended or changed. Your other available Areas are unchanged.</p>
          <button type="button" onClick={() => navigate("/areas", { replace: true })}>View my Areas</button>
        </section>
      </section>
    </OperationsShell>;
  }

  const distinct = uniqueAreaSurfaces(area.surfaces);
  const currentHref = `${location.pathname}${location.search}`;
  const peopleDirectory = areaKey === "people" ? distinct.find(surface => surface.key === "participants") : undefined;
  if (peopleDirectory && peopleDirectory.href !== currentHref) {
    return <Navigate to={peopleDirectory.href} replace />;
  }
  if (distinct.length === 1 && distinct[0]!.href !== currentHref) {
    return <Navigate to={distinct[0]!.href} replace />;
  }

  return <OperationsShell active="areas" title={area.label} backTo="/areas">
    <section className="responsibility-workspace">
      <div className="responsibility-workspace__content workspace-view">
        {area.description ? <p className="workspace-view__intro">{area.description}</p> : null}
        <section className="workspace-section" aria-labelledby="workspace-area-options-title">
          <header><h2 id="workspace-area-options-title">Choose what you want to do</h2></header>
          <div className="workspace-directory" aria-label={`${area.label} workspaces`}>
            {distinct.map((surface) => <WorkspaceLink
              key={surface.key}
              className="workspace-directory-row workspace-directory-row--surface"
              href={surface.href}
              ariaLabel={`Open ${surface.label}`}
            >
              <span className="workspace-directory-row__icon"><ProductIcon name={productIconForDestination(surface.href, area.icon)} size={30} /></span>
              <span className="workspace-directory-row__body">
                <strong>{surface.label}</strong>
                {surface.description ? <small>{surface.description}</small> : null}
                {surface.scopes.length ? <small>{surface.scopes.map((scope) => scope.label).filter(Boolean).join(" · ")}</small> : null}
              </span>
              <ArrowRight className="workspace-directory-row__arrow" size={17} aria-hidden="true" />
            </WorkspaceLink>)}
          </div>
        </section>
      </div>
    </section>
  </OperationsShell>;
}
