import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { PrincipalInsightsPage, type PrincipalInsightTopic } from "../principal-insights/PrincipalInsightsPage";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { WorkspaceState } from "../workspace/WorkspaceState";
import type { WorkspaceArea, WorkspaceAreaSurface, WorkspaceManifest } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import AnalyticsPage, { type AnalyticsTopic } from "./AnalyticsPage";
import type { AnalyticsAudience } from "./api";
import { canonicalInsightsPath, type InsightWorkspaceScope } from "./InsightNavigation";
import "./analytics.css";

export type InsightsWorkspaceTopic = AnalyticsTopic | PrincipalInsightTopic;
type InsightsWorkspaceKind = InsightWorkspaceScope;

export interface InsightsWorkspaceAccess {
  readonly manifest: WorkspaceManifest;
  readonly area: WorkspaceArea;
  readonly surface: WorkspaceAreaSurface;
  readonly kind: InsightsWorkspaceKind;
  readonly audience: AnalyticsAudience;
  readonly studentId?: string;
  readonly contextLabel: string;
}

const principalTopics = new Set<InsightsWorkspaceTopic>([
  "review", "recording", "followups", "learning-review", "operations", "finance",
]);

const topicTitles: Partial<Record<InsightsWorkspaceTopic, string>> = {
  attendance: "Attendance trends",
  results: "Result analysis",
  progress: "Assessment progress",
  institution: "Institution snapshot",
  registers: "Register submission",
  review: "Attendance review",
  recording: "Missing records",
  followups: "Family follow-ups",
  "learning-review": "Learning review",
  operations: "Coverage & deadlines",
  finance: "Fee balances",
};

function relationshipSurface(surface: WorkspaceAreaSurface) {
  const match = surface.key.match(/^overview:(self|dependent):(.+)$/);
  return match ? { kind: match[1] as "self" | "dependent", studentId: match[2]! } : null;
}

function accessForSurface(manifest: WorkspaceManifest, area: WorkspaceArea, surface: WorkspaceAreaSurface): InsightsWorkspaceAccess | null {
  if (surface.key === "institution") return {
    manifest, area, surface, kind: "institution", audience: "principal", contextLabel: "Institution insights",
  };
  if (surface.key === "assigned") return {
    manifest, area, surface, kind: "assigned", audience: "teacher", contextLabel: "My work insights",
  };
  const relationship = relationshipSurface(surface);
  if (!relationship) return null;
  const scope = surface.scopes.find((entry) => entry.kind === relationship.kind && entry.id === relationship.studentId);
  return {
    manifest,
    area,
    surface,
    kind: relationship.kind,
    audience: relationship.kind === "self" ? "student" : "parent",
    studentId: relationship.studentId,
    contextLabel: relationship.kind === "self" ? "My insights" : `${scope?.label ?? "Learner"} insights`,
  };
}

/** Resolve a scope only from the server-composed Insights contribution. */
export function resolveInsightsWorkspaceAccess(manifest: WorkspaceManifest, search: URLSearchParams): InsightsWorkspaceAccess | null {
  const area = manifest.areas.find((entry) => entry.key === "insights");
  if (!area) return null;
  const requested = search.get("scope");
  const studentId = search.get("student_id")?.trim() || null;

  if (requested === "institution" || requested === "assigned") {
    if (studentId) return null;
    const surface = area.surfaces.find((entry) => entry.key === requested);
    return surface ? accessForSurface(manifest, area, surface) : null;
  }
  if (requested === "self" || requested === "dependent") {
    const candidates = area.surfaces.flatMap((surface) => {
      const relationship = relationshipSurface(surface);
      return relationship?.kind === requested ? [{ surface, relationship }] : [];
    });
    const selected = studentId
      ? candidates.find((candidate) => candidate.relationship.studentId === studentId)
      : candidates.length ? candidates[0] : null;
    return selected ? accessForSurface(manifest, area, selected.surface) : null;
  }
  if (search.has("scope") || search.has("student_id")) return null;

  // Institution and assigned contributions retain established staff capability
  // defaults. Relationship-only accounts begin with self, then their first exact
  // dependent; the selector exposes every other contributed context.
  for (const key of ["institution", "assigned"] as const) {
    const surface = area.surfaces.find((entry) => entry.key === key);
    if (surface) return accessForSurface(manifest, area, surface);
  }
  const relationship = area.surfaces.find((surface) => relationshipSurface(surface)?.kind === "self")
    ?? area.surfaces.find((surface) => Boolean(relationshipSurface(surface)));
  return relationship ? accessForSurface(manifest, area, relationship) : null;
}

function stateRoute(state: "loading" | "error" | "revoked" | "unavailable", error?: unknown, retry?: () => unknown) {
  return <OperationsShell active="areas" title="Insights" backTo="/areas">
    <WorkspaceState state={state} error={error} onRetry={retry} />
  </OperationsShell>;
}

function InsightsWorkspaceBoundary({ children }: { readonly children: (access: InsightsWorkspaceAccess) => ReactNode }) {
  const environment = useExecutionEnvironment();
  const manifest = useWorkspaceManifest();
  const [search] = useSearchParams();
  if (environment.mode === "simulation" && environment.unavailable === true) return stateRoute("unavailable");
  if (manifest.isPending) return stateRoute("loading");
  if (manifest.error) {
    const revoked = manifest.error instanceof ApiError && manifest.error.status === 403;
    return stateRoute(revoked ? "revoked" : "error", manifest.error, manifest.refetch);
  }
  if (!manifest.data || !manifestMatchesEnvironment(manifest.data, environment)) {
    return stateRoute("error", new Error("The Insights workspace did not match the active environment."), manifest.refetch);
  }
  const access = resolveInsightsWorkspaceAccess(manifest.data, search);
  if (!access) return stateRoute("revoked", undefined, manifest.refetch);
  return children(access);
}

function optionForSurface(surface: WorkspaceAreaSurface) {
  if (surface.key === "institution") return { key: surface.key, label: "Institution insights", href: surface.href };
  if (surface.key === "assigned") return { key: surface.key, label: "My work insights", href: surface.href };
  const relationship = relationshipSurface(surface);
  if (!relationship) return null;
  const scope = surface.scopes.find((entry) => entry.kind === relationship.kind && entry.id === relationship.studentId);
  return {
    key: surface.key,
    label: relationship.kind === "self" ? "My insights" : `${scope?.label ?? "Learner"} insights`,
    href: surface.href,
  };
}

const preservedFilterKeys = [
  "period", "class", "class_id", "compare", "date", "insight_days", "insight_threshold", "followup", "via",
] as const;

export function insightContextDestination(href: string, current: URLSearchParams, topic?: InsightsWorkspaceTopic) {
  const target = new URL(href, "https://thatcampus.invalid");
  for (const key of preservedFilterKeys) {
    const value = current.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return canonicalInsightsPath(topic, target.searchParams.toString());
}

function InsightsContextBar({ access, topic }: { readonly access: InsightsWorkspaceAccess; readonly topic?: InsightsWorkspaceTopic }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const options = access.area.surfaces.flatMap((surface) => {
    const option = optionForSurface(surface);
    return option ? [option] : [];
  });
  if (options.length < 2) return access.kind === "dependent"
    ? <p className="insights-workspace-person">{access.contextLabel}</p>
    : null;
  return <section className="insights-workspace-context" aria-label="Insights scope">
    <label>
      <span>View</span>
      <span className="insights-workspace-context__select">
        <select aria-label="Choose insights scope" value={access.surface.key} onChange={(event) => {
          const option = options.find((candidate) => candidate.key === event.target.value);
          if (option) {
            const nextTopic = topic && principalTopics.has(topic) && option.key !== "institution"
              ? undefined
              : topic;
            void navigate(insightContextDestination(option.href, search, nextTopic));
          }
        }}>
          {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
        <ChevronDown size={15} aria-hidden="true" />
      </span>
    </label>
  </section>;
}

function InsightsBody({ access, topic }: { readonly access: InsightsWorkspaceAccess; readonly topic?: InsightsWorkspaceTopic }) {
  if (topic && principalTopics.has(topic)) {
    if (access.kind !== "institution") return <WorkspaceState state="revoked" />;
    return <PrincipalInsightsPage topic={topic as PrincipalInsightTopic} presentation="workspace" />;
  }
  return <AnalyticsPage portal={access.audience} topic={topic as AnalyticsTopic | undefined} presentation="workspace" />;
}

export function WorkspaceInsightsRoute({ topic }: { readonly topic?: InsightsWorkspaceTopic }) {
  const [search] = useSearchParams();
  const location = useLocation();
  return <InsightsWorkspaceBoundary>{(access) => {
    if (access.studentId && (search.get("scope") !== access.kind || search.get("student_id") !== access.studentId)) {
      const exactScope = new URLSearchParams(search);
      exactScope.set("scope", access.kind);
      exactScope.set("student_id", access.studentId);
      return <Navigate replace to={{ pathname: location.pathname, search: `?${exactScope}`, hash: location.hash }} state={location.state as unknown} />;
    }
    return <OperationsShell
      active="areas"
      title={topic ? topicTitles[topic] ?? "Insights" : "Insights"}
      backTo={topic ? canonicalInsightsPath("", search.toString()) : "/areas"}
    >
      <div className="insights-workspace">
        <InsightsContextBar access={access} topic={topic} />
        <div className="insights-workspace__content"><InsightsBody access={access} topic={topic} /></div>
      </div>
    </OperationsShell>;
  }}</InsightsWorkspaceBoundary>;
}
