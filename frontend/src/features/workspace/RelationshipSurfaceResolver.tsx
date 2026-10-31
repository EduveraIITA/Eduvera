import { ChevronRight, UserRound, UsersRound } from "lucide-react";
import { Link, Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "./ResponsibilityWorkspace";
import { WorkspaceState } from "./WorkspaceState";
import { useWorkspaceManifest } from "./useWorkspaceManifest";
import type { WorkspaceArea, WorkspaceAreaSurface, WorkspaceManifest } from "./types";
import "./relationship-surface.css";

export type RelationshipKind = "self" | "dependent";

export interface RelationshipSurfaceOption {
  readonly key: string;
  readonly relationship: RelationshipKind;
  readonly studentId: string;
  readonly label: string;
  readonly description?: string | null;
  readonly surface: WorkspaceAreaSurface;
}

export interface ResolvedRelationshipSurface extends RelationshipSurfaceOption {
  readonly area: WorkspaceArea;
  readonly manifest: WorkspaceManifest;
}

export type RelationshipSelection<T extends Pick<RelationshipSurfaceOption, "relationship" | "studentId">> =
  | { readonly state: "selected"; readonly option: T; readonly canonicalize: boolean }
  | { readonly state: "choose"; readonly options: readonly T[] }
  | { readonly state: "invalid" };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relationshipLabel(surface: WorkspaceAreaSurface, relationship: RelationshipKind, studentId: string) {
  return surface.scopes.find((scope) => scope.kind === relationship && scope.id === studentId)?.label
    ?? surface.scopes.find((scope) => scope.kind === relationship)?.label
    ?? surface.label;
}

/**
 * Relationship identity is taken from a manifest surface key, then presented
 * with its server-authored scope label. A display name is never used as an ID.
 */
export function relationshipSurfaceOptions(area: WorkspaceArea | undefined, surfacePrefix: string) {
  if (!area) return [];
  const pattern = new RegExp(`^${escapeRegExp(surfacePrefix)}:(self|dependent):(.+)$`);
  return area.surfaces.flatMap((surface): RelationshipSurfaceOption[] => {
    const match = surface.key.match(pattern);
    if (!match?.[1] || !match[2]) return [];
    const relationship = match[1] as RelationshipKind;
    const studentId = match[2];
    return [{
      key: surface.key,
      relationship,
      studentId,
      label: relationshipLabel(surface, relationship, studentId),
      description: surface.description,
      surface,
    }];
  });
}

/**
 * Missing context is recoverable only from current, authorized manifest
 * choices. An explicit but unknown scope/learner remains invalid and fails
 * closed instead of silently opening another learner.
 */
export function resolveRelationshipSelection<
  T extends Pick<RelationshipSurfaceOption, "relationship" | "studentId">,
>(options: readonly T[], params: URLSearchParams): RelationshipSelection<T> {
  const hasScope = params.has("scope");
  const hasStudentId = params.has("student_id");
  const scope = params.get("scope");
  const studentId = params.get("student_id");
  const validScope = scope === "self" || scope === "dependent" ? scope : null;

  if ((hasScope && !validScope) || (hasStudentId && !studentId)) return { state: "invalid" };

  if (validScope && studentId) {
    const selected = options.find((option) => option.relationship === validScope && option.studentId === studentId);
    return selected ? { state: "selected", option: selected, canonicalize: false } : { state: "invalid" };
  }

  const candidates = options.filter((option) => (
    (!validScope || option.relationship === validScope)
    && (!studentId || option.studentId === studentId)
  ));
  if (candidates.length === 1) return { state: "selected", option: candidates[0]!, canonicalize: true };
  if (candidates.length > 1) return { state: "choose", options: candidates };
  return { state: "invalid" };
}

export function relationshipTarget(
  location: Pick<Location, "pathname" | "search" | "hash">,
  option: Pick<RelationshipSurfaceOption, "relationship" | "studentId">,
) {
  const next = new URLSearchParams(location.search);
  next.set("scope", option.relationship);
  next.set("student_id", option.studentId);
  return { pathname: location.pathname, search: next.toString(), hash: location.hash };
}

export function RelationshipSubjectPicker({
  title,
  options,
}: {
  readonly title: string;
  readonly options: readonly RelationshipSurfaceOption[];
}) {
  const location = useLocation();
  return <section className="relationship-picker" aria-labelledby="relationship-picker-title">
    <header>
      <span>{options.every((option) => option.relationship === "dependent") ? "Learner context" : "Your context"}</span>
      <h2 id="relationship-picker-title">{title}</h2>
      <p>Choose whose records you want to use. Your other filters and the current Live or Simulation environment will stay in place.</p>
    </header>
    <div className="relationship-picker__list">
      {options.map((option) => {
        const Icon = option.relationship === "self" ? UserRound : UsersRound;
        return <Link replace key={option.key} to={relationshipTarget(location, option)}>
          <span className="relationship-picker__icon" aria-hidden="true"><Icon size={20} /></span>
          <span className="relationship-picker__copy">
            <strong>{option.relationship === "self" ? "My record" : option.label}</strong>
            <small>{option.relationship === "self" ? option.label : option.description ?? "Linked learner"}</small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>;
      })}
    </div>
    <p className="relationship-picker__note">Only relationships currently available to your account are shown.</p>
  </section>;
}

/**
 * Shared navigation boundary for learner/family domain screens. The manifest
 * makes a missing bookmark context recoverable; the owning domain API remains
 * authoritative for every read and action rendered by the child.
 */
export function RelationshipSurfaceResolver({
  areaKey,
  surfacePrefix,
  title,
  backTo = "/areas",
  children,
}: {
  readonly areaKey: string;
  readonly surfacePrefix: string;
  readonly title: string;
  readonly backTo?: string;
  readonly children: (selection: ResolvedRelationshipSurface) => ReactNode;
}) {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();
  const location = useLocation();

  if (environment.mode === "simulation" && environment.unavailable === true) {
    return <OperationsShell active="areas" title={title}><WorkspaceState state="unavailable" /></OperationsShell>;
  }
  if (query.isPending) {
    return <OperationsShell active="areas" title={title}><WorkspaceState state="loading" /></OperationsShell>;
  }
  if (query.error) {
    const state = query.error instanceof ApiError && query.error.status === 403 ? "revoked" : "error";
    return <OperationsShell active="areas" title={title} backTo={backTo}>
      <WorkspaceState state={state} error={query.error} onRetry={query.refetch} />
    </OperationsShell>;
  }

  const manifest = query.data;
  const area = manifest?.areas.find((entry) => entry.key === areaKey);
  const options = relationshipSurfaceOptions(area, surfacePrefix);
  const resolution = resolveRelationshipSelection(options, new URLSearchParams(location.search));
  if (!manifest || !manifestMatchesEnvironment(manifest, environment) || !area || resolution.state === "invalid") {
    return <OperationsShell active="areas" title={area?.label ?? title} backTo={backTo}>
      <WorkspaceState state="revoked" onRetry={query.refetch} />
    </OperationsShell>;
  }
  if (resolution.state === "choose") {
    return <OperationsShell active="areas" title={title} backTo={backTo}>
      <RelationshipSubjectPicker title={`Choose a learner for ${title.toLocaleLowerCase()}`} options={resolution.options} />
    </OperationsShell>;
  }
  if (resolution.canonicalize) {
    return <Navigate replace to={relationshipTarget(location, resolution.option)} />;
  }
  return children({ ...resolution.option, area, manifest });
}
