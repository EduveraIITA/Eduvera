import type { ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { PortalPageTitleProps } from "../navigation/PortalPageTitle";
import { ProductIcon } from "../../components/ProductIcon";
import { InfoSummary } from "../../components/InfoSummary";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { WorkspaceLink } from "../workspace/WorkspaceLink";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { portalReturnTarget } from "../navigation/portalReturnState";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import type { WorkspaceArea, WorkspaceAreaSurface, WorkspaceScope } from "../workspace/types";
import "./responsibility-attendance-workspace.css";

export type AttendanceSurfaceKind = "registers" | "coordination" | "thresholds" | "records" | "follow-ups";

export interface AttendanceSurfaceSelection {
  readonly kind: AttendanceSurfaceKind;
  /** Required for relationship-scoped records; omitted for operational work. */
  readonly relationship?: "self" | "dependent";
  /** Stable learner identity, never a display-name lookup. */
  readonly studentId?: string;
}

export interface AttendanceWorkspaceContext {
  readonly institutionId: string;
  readonly area: WorkspaceArea;
  readonly surface: WorkspaceAreaSurface;
  readonly selection: AttendanceSurfaceSelection;
}

interface ResponsibilityAttendanceWorkspaceProps {
  readonly selection: AttendanceSurfaceSelection;
  readonly children: ReactNode | ((context: AttendanceWorkspaceContext) => ReactNode);
  readonly beforeBack?: PortalPageTitleProps["beforeBack"];
}

function relationshipSurfaceKey(selection: AttendanceSurfaceSelection) {
  if (!selection.relationship || !selection.studentId) return null;
  if (selection.kind !== "records" && selection.kind !== "follow-ups") return null;
  return `${selection.kind}:${selection.relationship}:${selection.studentId}`;
}

export function attendanceSurfaceKey(selection: AttendanceSurfaceSelection) {
  if (selection.kind !== "records" && selection.kind !== "follow-ups") return selection.kind;
  return relationshipSurfaceKey(selection);
}

export function findAttendanceSurface(
  area: WorkspaceArea | undefined,
  selection: AttendanceSurfaceSelection,
) {
  const key = attendanceSurfaceKey(selection);
  if (!key) return undefined;
  return area?.surfaces.find((surface) => surface.key === key);
}

function distinctSurfaces(surfaces: readonly WorkspaceAreaSurface[]) {
  return [...new Map(surfaces.map((surface) => [surface.key, surface])).values()];
}

function scopeLabels(scopes: readonly WorkspaceScope[]) {
  return [...new Set(scopes.map((scope) => scope.label?.trim()).filter((label): label is string => Boolean(label)))];
}

function SurfaceIcon({ surface }: { readonly surface: WorkspaceAreaSurface }) {
  return <ProductIcon name={surface.key.startsWith("records:") ? "people" : surface.key === "thresholds" ? "insights" : "attendance"} size={24} />;
}

/**
 * Canonical Attendance boundary. Eligibility comes only from the server manifest;
 * the owning Attendance APIs still authorize every read and command rendered below.
 *
 * This component deliberately accepts domain content rather than importing a
 * Teacher, Principal, Student or Parent page. The same person may legitimately own
 * several surfaces at once, and a job-title or membership must never choose one.
 */
export function ResponsibilityAttendanceWorkspace({
  selection,
  children,
  beforeBack,
}: ResponsibilityAttendanceWorkspaceProps) {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const academicRegister = Boolean(params.get("class_section_id") || params.get("session_id"));
  const selectedRegister = (selection.kind === "registers" || selection.kind === "coordination")
    && (academicRegister || Boolean(params.get("register_id") || params.get("occurrence_id")));
  const explicitReturnTo = portalReturnTarget(location.state, `${location.pathname}${location.search}${location.hash}`);
  const returnToRegisters = () => {
    const next = new URLSearchParams(params);
    const selectors = academicRegister
      ? ["class_section_id", "session_id", "student_id"]
      : ["register_id", "occurrence_id"];
    selectors.forEach(key => next.delete(key));
    void navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true, state: location.state as unknown });
  };

  if (environment.mode === "simulation" && environment.unavailable === true) {
    return <OperationsShell active="areas" title="Attendance"><WorkspaceState state="unavailable" /></OperationsShell>;
  }
  if (query.isPending) {
    return <OperationsShell active="areas" title="Attendance"><WorkspaceState state="loading" /></OperationsShell>;
  }
  if (query.error) {
    const revoked = query.error instanceof ApiError && query.error.status === 403;
    return <OperationsShell active="areas" title="Attendance">
      <WorkspaceState state={revoked ? "revoked" : "error"} error={query.error} onRetry={query.refetch} />
    </OperationsShell>;
  }

  const manifest = query.data;
  const area = manifest?.areas.find((entry) => entry.key === "attendance");
  const surface = findAttendanceSurface(area, selection);
  if (!manifest || !manifestMatchesEnvironment(manifest, environment) || !area || !surface) {
    return <OperationsShell active="areas" title="Attendance">
      <WorkspaceState state="revoked" onRetry={query.refetch} />
    </OperationsShell>;
  }

  const surfaces = distinctSurfaces(area.surfaces);
  const labels = scopeLabels(surface.scopes);
  const relationship = Boolean(selection.relationship);
  const content = typeof children === "function" ? children({ area, surface, selection, institutionId: manifest.context.institution_id }) : children;

  return <OperationsShell active="areas" title="Attendance" backTo="/areas" onBack={selectedRegister && !explicitReturnTo ? returnToRegisters : undefined} beforeBack={beforeBack}>
    <div className="responsibility-attendance">
      {!selectedRegister ? <header className={`responsibility-attendance__context${relationship ? "" : " sr-only"}`}>
        <h2>{surface.label}</h2>
        {relationship && surface.description ? <p>{surface.description}</p> : null}
        {relationship && labels.length ? <p className="responsibility-attendance__scope" aria-label="Current attendance scope"><strong>{labels.join(" · ")}</strong></p> : null}
      </header> : null}

      {!selectedRegister && surfaces.length > 1 ? <nav className="responsibility-attendance__surfaces" aria-label="Attendance work">
        {surfaces.map((candidate) => {
          const active = candidate.key === surface.key;
          return <WorkspaceLink
            key={candidate.key}
            className={`responsibility-attendance__surface${active ? " is-active" : ""}`}
            href={candidate.href}
            ariaLabel={`${active ? "Current: " : "Open "}${candidate.label}`}
            ariaCurrent={active ? "page" : undefined}
          >
            <SurfaceIcon surface={candidate} />
            <strong>{candidate.label}</strong>
          </WorkspaceLink>;
        })}
      </nav> : null}

      <div className="responsibility-attendance__content">{content}</div>

      {!selectedRegister && !relationship ? <details className="responsibility-attendance__details">
        <InfoSummary>Access details</InfoSummary>
        {surface.description ? <p>{surface.description}</p> : null}
        {labels.length ? <p className="responsibility-attendance__scope" aria-label="Current attendance scope"><span>Current scope</span><strong>{labels.join(" · ")}</strong></p> : null}
      </details> : null}
    </div>
  </OperationsShell>;
}
