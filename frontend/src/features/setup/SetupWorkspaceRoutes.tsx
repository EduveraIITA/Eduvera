import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Settings2,
  UsersRound,
} from "lucide-react";
import { lazy, type ComponentType, type ReactNode } from "react";
import { ProductIcon, type ProductIconName } from "../../components/ProductIcon";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import InvitationsPage from "../onboarding/InvitationsPage";
import { ProgressiveSetupWorkspacePage } from "../onboarding/ProgressiveSetupPage";
import AdministrationPage from "../office/AdministrationPage";
import OrganizationPage from "../organization/OrganizationPage";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { WorkspaceStaffSetupRoute } from "../staff-operations/StaffOperationsRoutes";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { WorkspaceState } from "../workspace/WorkspaceState";
import type { WorkspaceManifest, WorkspaceMoreItem } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import "./setup-workspace.css";

const WholeCampusSetupPage = lazy(() => import("../onboarding/WholeCampusSetupPage"));

type SetupItemKey = "capabilities" | "institution" | "people" | "responsibilities" | "invitations" | "organization";

function setupItem(manifest: WorkspaceManifest, key: SetupItemKey): WorkspaceMoreItem | null {
  return manifest.more.setup.find((item) => item.key === key) ?? null;
}

function SetupRouteState({ state, error, onRetry }: {
  readonly state: "loading" | "error" | "revoked" | "unavailable";
  readonly error?: unknown;
  readonly onRetry?: () => unknown;
}) {
  return <OperationsShell active="more" title="Campus setup" backTo="/more">
    <WorkspaceState state={state} error={error} onRetry={onRetry} />
  </OperationsShell>;
}

/**
 * Setup is contributed by current responsibilities, not by a hard-coded Admin
 * portal. The owning domain API still rechecks every read and command.
 */
export function SetupRouteBoundary({ itemKeys, children }: {
  readonly itemKeys?: readonly SetupItemKey[];
  readonly children: (manifest: WorkspaceManifest) => ReactNode;
}) {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();
  if (environment.mode === "simulation" && environment.unavailable === true) {
    return <SetupRouteState state="unavailable" />;
  }
  if (query.isPending) return <SetupRouteState state="loading" />;
  if (query.error) {
    return <SetupRouteState
      state={query.error instanceof ApiError && query.error.status === 403 ? "revoked" : "error"}
      error={query.error}
      onRetry={query.refetch}
    />;
  }
  if (!query.data || !manifestMatchesEnvironment(query.data, environment)) {
    return <SetupRouteState
      state="error"
      error={new Error("Campus setup did not match the active execution environment.")}
      onRetry={query.refetch}
    />;
  }
  const allowed = itemKeys
    ? itemKeys.some((key) => setupItem(query.data, key))
    : query.data.more.setup.length > 0;
  if (!allowed) {
    return <SetupRouteState state="revoked" onRetry={query.refetch} />;
  }
  return <>{children(query.data)}</>;
}

interface SetupJourneyRowProps {
  readonly item: WorkspaceMoreItem;
  readonly detail: string;
  readonly icon: ProductIconName;
  readonly action?: string;
}

function SetupJourneyRow({ item, detail, icon, action = "Open" }: SetupJourneyRowProps) {
  return <Link className="setup-workspace-row" to={item.href} aria-label={`${action} ${item.label}`}>
    <span className="setup-workspace-row__icon" aria-hidden="true"><ProductIcon name={icon} size={28} /></span>
    <span className="setup-workspace-row__copy"><strong>{item.label}</strong><small>{detail}</small></span>
    <ChevronRight size={18} aria-hidden="true" />
  </Link>;
}

export function SetupWorkspaceOverview({ manifest }: { readonly manifest: WorkspaceManifest }) {
  const capabilities = setupItem(manifest, "capabilities");
  const represented = new Set<string>(["capabilities", "institution", "people", "responsibilities", "invitations", "organization"]);
  const foundation = [
    setupItem(manifest, "institution") ? {
      item: setupItem(manifest, "institution")!, icon: "building" as const,
      detail: "Campuses, spaces, academic structure, operating rules and configuration history",
    } : null,
    setupItem(manifest, "responsibilities") ? {
      item: setupItem(manifest, "responsibilities")!, icon: "security" as const,
      detail: "Connect people to bounded work, scope, dates and fallback",
    } : null,
    setupItem(manifest, "people") ? {
      item: setupItem(manifest, "people")!, icon: "people" as const,
      detail: "People records, account access and invitations without duplicate directories",
    } : null,
    setupItem(manifest, "organization") ? {
      item: setupItem(manifest, "organization")!, icon: "organization" as const,
      detail: "Describe teams and reporting lines without granting authority",
    } : null,
    ...manifest.more.setup.filter((item) => !represented.has(item.key)).map((item) => ({
      item,
      icon: "settings" as const,
      detail: item.description ?? "Open this authorized campus configuration workspace",
    })),
  ].filter((value): value is NonNullable<typeof value> => value !== null);

  return <div className="setup-workspace">
    <header className="setup-workspace__intro">
      <span><Settings2 size={14} aria-hidden="true" />CAMPUS SETUP</span>
      <h2>Set up the next thing you need.</h2>
      <p>Start with one useful outcome. ThatCampus reuses the same people, places, schedules and responsibilities as your campus grows.</p>
    </header>

    {capabilities ? <div className="setup-workspace__rows">
      <SetupJourneyRow item={{ key: "whole-campus", label: "Build your whole campus", href: "/more/setup/whole-campus" }} icon="building" detail="Start with a layout and a few useful places. Add people, rooms and services as you need them." action="Open" />
    </div> : null}

    {capabilities ? <section className="setup-workspace__start" aria-labelledby="setup-next-outcome-title">
      <div>
        <span className="setup-workspace__step">1</span>
        <div><h3 id="setup-next-outcome-title">Choose what should work next</h3><p>See what is working now, the smallest useful next step and everything available later. Nothing is locked.</p></div>
      </div>
      <Link to={capabilities.href}>Review capabilities <ArrowRight size={18} aria-hidden="true" /></Link>
    </section> : null}

    {foundation.length ? <section className="setup-workspace__section" aria-labelledby="setup-connect-title">
      <header>
        <span className="setup-workspace__step">{capabilities ? "2" : "1"}</span>
        <div><h3 id="setup-connect-title">Connect only the essentials</h3><p>Add a person, place, group or rule when an operation actually needs it.</p></div>
      </header>
      <div className="setup-workspace__rows">
        {foundation.map(({ item, detail, icon }) => <SetupJourneyRow key={item.key} item={item} detail={detail} icon={icon} />)}
      </div>
    </section> : null}

    {!capabilities && !foundation.length ? <section className="setup-workspace__empty" role="status">
      <CheckCircle2 size={22} aria-hidden="true" />
      <div><h3>No setup work is assigned</h3><p>Your current responsibilities do not include campus configuration.</p></div>
    </section> : null}

    <p className="setup-workspace__note">Setup changes the same Live or Simulation campus shown everywhere else. It never creates a separate copy of people, classes or places.</p>
  </div>;
}

export function PeopleSetupWorkspace({ manifest }: { readonly manifest: WorkspaceManifest }) {
  const records = manifest.areas.find((area) => area.key === "people")?.surfaces.find((surface) => surface.key === "records");
  const responsibilities = setupItem(manifest, "responsibilities");
  const access = setupItem(manifest, "people");
  const invitations = setupItem(manifest, "invitations");
  const rows = [
    records ? { item: { ...records, key: "records" } as WorkspaceMoreItem, icon: "people" as const, detail: "Add and maintain campus people and their connected records" } : null,
    responsibilities ? { item: responsibilities, icon: "security" as const, detail: "Assign work, scope, dates, cover and fallback" } : null,
    access ? { item: { ...access, href: "/more/setup/people/access" }, icon: "security" as const, detail: "Manage institution membership separately from operational responsibility" } : null,
    invitations ? { item: invitations, icon: "invitations" as const, detail: "Give an existing campus person login access and review delivery history" } : null,
  ].filter((value): value is NonNullable<typeof value> => value !== null);
  return <div className="setup-workspace setup-workspace--people">
    <header className="setup-workspace__intro">
      <span><UsersRound size={14} aria-hidden="true" />PEOPLE SETUP</span>
      <h2>Connect people to the work they do.</h2>
      <p>Create a person once. Records, responsibilities and account access remain distinct, so the campus can start small without losing control as it grows.</p>
    </header>
    <section className="setup-workspace__section" aria-labelledby="people-setup-actions-title">
      <header><div><h3 id="people-setup-actions-title">People, responsibility and access</h3><p>Use only the part needed for the next real operation.</p></div></header>
      <div className="setup-workspace__rows">
        {rows.map(({ item, detail, icon }) => <SetupJourneyRow key={item.key} item={item} detail={detail} icon={icon} />)}
      </div>
    </section>
    <p className="setup-workspace__note">A title or reporting line never grants access. Every action still uses an effective responsibility or relationship in its exact scope.</p>
  </div>;
}

export function WorkspaceSetupOverviewRoute() {
  return <SetupRouteBoundary>{(manifest) => <OperationsShell active="more" title="Campus setup" backTo="/more">
    <SetupWorkspaceOverview manifest={manifest} />
  </OperationsShell>}</SetupRouteBoundary>;
}

export function WorkspacePeopleSetupRoute() {
  return <SetupRouteBoundary itemKeys={["people", "responsibilities", "invitations"]}>{(manifest) =>
    <OperationsShell active="more" title="People setup" backTo="/more/setup"><PeopleSetupWorkspace manifest={manifest} /></OperationsShell>}
  </SetupRouteBoundary>;
}

export function WorkspaceInstitutionSetupRoute() {
  return <SetupRouteBoundary itemKeys={["institution"]}>{() =>
    <AdministrationPage setupBackTo="/more/setup" accessBackTo="/more/setup/people" />}
  </SetupRouteBoundary>;
}

export function WorkspaceInvitationsSetupRoute() {
  return <SetupRouteBoundary itemKeys={["invitations"]}>{() => <InvitationsPage />}</SetupRouteBoundary>;
}

export function WorkspaceOrganizationSetupRoute() {
  return <SetupRouteBoundary itemKeys={["organization"]}>{() => <OrganizationPage />}</SetupRouteBoundary>;
}

export function WorkspaceResponsibilitiesSetupRoute() {
  return <SetupRouteBoundary itemKeys={["responsibilities"]}>{() => <WorkspaceStaffSetupRoute />}</SetupRouteBoundary>;
}

export function WorkspaceCapabilitiesSetupRoute() {
  return <SetupRouteBoundary itemKeys={["capabilities"]}>{() => <ProgressiveSetupWorkspacePage />}</SetupRouteBoundary>;
}

export function WorkspaceWholeCampusSetupRoute() {
  return <SetupRouteBoundary itemKeys={["capabilities"]}>{() => <WholeCampusSetupPage />}</SetupRouteBoundary>;
}

export interface CanonicalSetupRouteDefinition {
  readonly path: string;
  readonly Component: ComponentType;
}

/** App.tsx integration seam. Persona URLs must only redirect to these routes. */
export const canonicalSetupRouteDefinitions: readonly CanonicalSetupRouteDefinition[] = [
  { path: "/more/setup", Component: WorkspaceSetupOverviewRoute },
  { path: "/more/setup/institution", Component: WorkspaceInstitutionSetupRoute },
  { path: "/more/setup/institution/campus", Component: WorkspaceInstitutionSetupRoute },
  { path: "/more/setup/institution/academics", Component: WorkspaceInstitutionSetupRoute },
  { path: "/more/setup/institution/operating-rules", Component: WorkspaceInstitutionSetupRoute },
  { path: "/more/setup/institution/history", Component: WorkspaceInstitutionSetupRoute },
  { path: "/more/setup/institution/promotion", Component: WorkspaceInstitutionSetupRoute },
  { path: "/more/setup/people", Component: WorkspacePeopleSetupRoute },
  { path: "/more/setup/people/access", Component: WorkspaceInstitutionSetupRoute },
  { path: "/more/setup/people/invitations", Component: WorkspaceInvitationsSetupRoute },
  { path: "/more/setup/organization", Component: WorkspaceOrganizationSetupRoute },
  { path: "/more/setup/responsibilities", Component: WorkspaceResponsibilitiesSetupRoute },
  { path: "/more/setup/responsibilities/:staffProfileId", Component: WorkspaceResponsibilitiesSetupRoute },
  { path: "/more/setup/capabilities", Component: WorkspaceCapabilitiesSetupRoute },
  { path: "/more/setup/whole-campus", Component: WorkspaceWholeCampusSetupRoute },
] as const;
