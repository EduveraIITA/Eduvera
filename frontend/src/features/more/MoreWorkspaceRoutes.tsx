import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { AccountProfilePage } from "../auth/AccountProfilePage";
import { AccountSecurityPage } from "../auth/AccountSecurityPages";
import { AgentChannelConnections } from "../auth/AgentChannelConnections";
import { CalendarConnections } from "../auth/CalendarConnections";
import type { ProfileConnectionAudience } from "../auth/profileConnectionScope";
import { safeAccountReturnTarget } from "../auth/accountReturnTarget";
import CampusScenePage from "../campus-scenes/CampusScenePage";
import {
  WorkspaceGovernanceRoute as GovernanceRoute,
  WorkspacePoliciesRoute as PoliciesRoute,
} from "../governance/GovernanceRoutes";
import OrganizationVerificationPage from "../onboarding/OrganizationVerificationPage";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { SimulationWorkspacePage } from "../simulation/SimulationWorkspacePage";
import { TeachingFeedbackWorkspace } from "../teacher-feedback/TeachingFeedbackWorkspace";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { WorkspaceState } from "../workspace/WorkspaceState";
import type { WorkspaceManifest, WorkspaceMoreItem } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import "../auth/account-security.css";
import "../auth/account-profile.css";
import "./more-workspace-routes.css";

export function workspaceMoreItems(manifest: WorkspaceManifest): readonly WorkspaceMoreItem[] {
  if (manifest.more.groups?.length) return manifest.more.groups.flatMap((group) => group.items);
  return [...manifest.more.setup, ...(manifest.more.other ?? [])];
}

export function workspaceMoreItem(manifest: WorkspaceManifest, key: string): WorkspaceMoreItem | null {
  return workspaceMoreItems(manifest).find((item) => item.key === key) ?? null;
}

function MoreRouteState({ title, state, error, onRetry }: {
  title: string;
  state: "loading" | "error" | "revoked" | "unavailable";
  error?: unknown;
  onRetry?: () => unknown;
}) {
  return <OperationsShell active="more" title={title} backTo="/more">
    <WorkspaceState state={state} error={error} onRetry={onRetry} />
  </OperationsShell>;
}

/**
 * Every canonical More route fails closed against the server-composed manifest.
 * Domain APIs remain the final authority and recheck access on every read/write.
 */
export function MoreRouteBoundary({ itemKey, title, children }: {
  itemKey: string;
  title: string;
  children: (manifest: WorkspaceManifest) => ReactNode;
}) {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();
  if (environment.mode === "simulation" && environment.unavailable === true) {
    return <MoreRouteState title={title} state="unavailable" />;
  }
  if (query.isPending) return <MoreRouteState title={title} state="loading" />;
  if (query.error) {
    return <MoreRouteState
      title={title}
      state={query.error instanceof ApiError && query.error.status === 403 ? "revoked" : "error"}
      error={query.error}
      onRetry={query.refetch}
    />;
  }
  if (!query.data || !manifestMatchesEnvironment(query.data, environment)) {
    return <MoreRouteState
      title={title}
      state="error"
      error={new Error("The tool did not match the active execution environment.")}
      onRetry={query.refetch}
    />;
  }
  if (!workspaceMoreItem(query.data, itemKey)) {
    return <MoreRouteState title={title} state="revoked" onRetry={query.refetch} />;
  }
  return <>{children(query.data)}</>;
}

export interface WorkspaceConnectionContext {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  /** Compatibility vocabulary for the existing connector APIs only. */
  readonly audience: ProfileConnectionAudience;
  readonly studentId?: string;
}

/**
 * Connector scopes are derived from exact manifest relationships and current
 * work contributions. The labels intentionally describe scope, never portals
 * or job-title personas.
 */
export function workspaceConnectionContexts(manifest: WorkspaceManifest): WorkspaceConnectionContext[] {
  const contexts: WorkspaceConnectionContext[] = [];
  const items = workspaceMoreItems(manifest);
  if (items.some((item) => item.key === "governance")) {
    contexts.push({ key: "institution", label: "Institution operations", detail: "Institution-wide work visible to you", audience: "principal" });
  }
  if (items.some((item) => item.key === "responsibilities")) {
    contexts.push({ key: "assigned-work", label: "My assigned work", detail: "Schedules and updates from active responsibilities", audience: "teacher" });
  }
  const scopes = manifest.areas.flatMap((area) => [
    ...area.scopes,
    ...area.surfaces.flatMap((surface) => surface.scopes),
  ]);
  for (const scope of scopes) {
    if (scope.kind !== "self" && scope.kind !== "dependent") continue;
    const studentId = scope.id ?? undefined;
    const key = `${scope.kind}:${studentId ?? "self"}`;
    if (contexts.some((context) => context.key === key)) continue;
    contexts.push(scope.kind === "dependent"
      ? {
          key,
          label: scope.label ?? "Linked learner",
          detail: "Learning schedule and updates available through this relationship",
          audience: "parent",
          ...(studentId ? { studentId } : {}),
        }
      : {
          key,
          label: "My learning",
          detail: "My timetable, assessments and campus dates",
          audience: "student",
          ...(studentId ? { studentId } : {}),
        });
  }
  return contexts;
}

function WorkspaceConnectionsContent({ manifest }: { manifest: WorkspaceManifest }) {
  const contexts = useMemo(() => workspaceConnectionContexts(manifest), [manifest]);
  const [requested, setRequested] = useState("");
  const selected = contexts.find((context) => context.key === requested) ?? contexts[0];
  if (!selected) return <section className="more-workspace-empty" role="status">
    <h2>No connection scope is available</h2>
    <p>Connections appear when an institution relationship or an active responsibility gives you a calendar or messaging context.</p>
  </section>;
  return <div className="more-workspace-connections">
    {contexts.length > 1 ? <section className="more-workspace-scope" aria-labelledby="connection-scope-title">
      <div><h2 id="connection-scope-title">Connect for</h2><p>Choose which authorized schedule and updates this device should receive.</p></div>
      <div role="radiogroup" aria-label="Connection scope">
        {contexts.map((context) => <button
          key={context.key}
          type="button"
          role="radio"
          aria-checked={selected.key === context.key}
          onClick={() => setRequested(context.key)}
        ><strong>{context.label}</strong><small>{context.detail}</small></button>)}
      </div>
    </section> : <p className="more-workspace-context"><strong>{selected.label}</strong><span>{selected.detail}</span></p>}
    <CalendarConnections audience={selected.audience} studentId={selected.studentId} />
    <AgentChannelConnections audience={selected.audience} studentId={selected.studentId} />
  </div>;
}

export function WorkspaceAccountRoute() {
  const location = useLocation();
  const backTo = safeAccountReturnTarget(new URLSearchParams(location.search).get("from")) ?? "/more";
  return <MoreRouteBoundary itemKey="account" title="Profile & appearance">{() =>
    <OperationsShell active="more" title="Profile & appearance" backTo={backTo}>
      <AccountProfilePage presentation="workspace" includeConnections={false} securityHref="/more/account/security" />
    </OperationsShell>}
  </MoreRouteBoundary>;
}

export function WorkspaceAccountSecurityRoute() {
  return <MoreRouteBoundary itemKey="security" title="Account security">{() =>
    <OperationsShell active="more" title="Account security" backTo="/more/account">
      <AccountSecurityPage presentation="workspace" />
    </OperationsShell>}
  </MoreRouteBoundary>;
}

export function WorkspaceConnectionsRoute() {
  return <MoreRouteBoundary itemKey="connections" title="Connected apps">{(manifest) =>
    <OperationsShell active="more" title="Connected apps" backTo="/more">
      <WorkspaceConnectionsContent manifest={manifest} />
    </OperationsShell>}
  </MoreRouteBoundary>;
}

export function WorkspacePoliciesRoute() {
  return <MoreRouteBoundary itemKey="policies" title="Policies & acknowledgements">{() => <PoliciesRoute />}</MoreRouteBoundary>;
}

export function WorkspaceFeedbackRoute() {
  return <MoreRouteBoundary itemKey="feedback" title="Teaching feedback">{(manifest) =>
    <OperationsShell active="more" title="Teaching feedback" backTo="/more">
      <TeachingFeedbackWorkspace manifest={manifest} item={workspaceMoreItem(manifest, "feedback")!} />
    </OperationsShell>}
  </MoreRouteBoundary>;
}

export function WorkspaceGovernanceRoute() {
  return <MoreRouteBoundary itemKey="governance" title="Policies & governance">{() => <GovernanceRoute />}</MoreRouteBoundary>;
}

export function WorkspaceVerificationRoute() {
  return <MoreRouteBoundary itemKey="verification" title="Organization verification">{() =>
    <OrganizationVerificationPage presentation="workspace" />}
  </MoreRouteBoundary>;
}

export function WorkspaceVirtualCampusRoute() {
  return <MoreRouteBoundary itemKey="virtual-campus" title="Virtual campus">{() =>
    <CampusScenePage backTo="/more" />}
  </MoreRouteBoundary>;
}

export function WorkspaceSimulationRoute() {
  return <MoreRouteBoundary itemKey="simulation" title="Simulation">{(manifest) =>
    <SimulationWorkspacePage manifest={manifest} />}
  </MoreRouteBoundary>;
}

export interface CanonicalMoreRouteDefinition {
  readonly path: string;
  readonly itemKey: string;
  readonly Component: ComponentType;
}

/** Integration seam for App.tsx; legacy persona URLs should only redirect here. */
export const canonicalMoreRouteDefinitions: readonly CanonicalMoreRouteDefinition[] = [
  { path: "/more/account", itemKey: "account", Component: WorkspaceAccountRoute },
  { path: "/more/account/security", itemKey: "security", Component: WorkspaceAccountSecurityRoute },
  { path: "/more/connections", itemKey: "connections", Component: WorkspaceConnectionsRoute },
  { path: "/more/policies", itemKey: "policies", Component: WorkspacePoliciesRoute },
  { path: "/more/feedback", itemKey: "feedback", Component: WorkspaceFeedbackRoute },
  { path: "/more/governance", itemKey: "governance", Component: WorkspaceGovernanceRoute },
  { path: "/more/verification", itemKey: "verification", Component: WorkspaceVerificationRoute },
  { path: "/more/virtual-campus", itemKey: "virtual-campus", Component: WorkspaceVirtualCampusRoute },
  { path: "/more/simulation", itemKey: "simulation", Component: WorkspaceSimulationRoute },
] as const;

export interface LegacyMoreRedirectDefinition {
  readonly from: string;
  readonly to: string;
}

/**
 * Bookmark-only aliases for router integration. `LegacyRouteRedirect` preserves
 * search parameters and hash anchors; none of these paths should mount a second
 * product screen once the canonical routes are installed.
 */
export const legacyMoreRedirectDefinitions: readonly LegacyMoreRedirectDefinition[] = [
  { from: "/account/profile", to: "/more/account" },
  { from: "/parent/teacher-feedback", to: "/more/feedback" },
  { from: "/student/teacher-feedback", to: "/more/feedback" },
  { from: "/principal/teacher-feedback", to: "/more/feedback" },
  { from: "/parent/policies", to: "/more/policies" },
  { from: "/student/policies", to: "/more/policies" },
  { from: "/teacher/policies", to: "/more/policies" },
  { from: "/principal/governance", to: "/more/governance" },
  { from: "/principal/verification", to: "/more/verification" },
  { from: "/principal/campus", to: "/more/virtual-campus" },
  { from: "/more/campus-view", to: "/more/virtual-campus" },
  { from: "/more/responsibilities", to: "/areas/responsibilities/mine" },
  { from: "/teacher/responsibilities", to: "/areas/responsibilities/mine" },
] as const;
