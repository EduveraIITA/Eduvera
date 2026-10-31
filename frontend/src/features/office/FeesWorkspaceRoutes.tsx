import { ChevronRight } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import { Navigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { RelationshipSurfaceResolver } from "../workspace/RelationshipSurfaceResolver";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import type { WorkspaceArea, WorkspaceAreaSurface } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { WorkspaceLink } from "../workspace/WorkspaceLink";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { WorkspaceSurfaceOnly } from "../workspace/WorkspaceSurfaceOnly";
import { FinanceResponsibilityWorkspace } from "./FeeLedgerPage";
import { RelationshipFeeAccountWorkspace } from "./FamilyFeesPage";
import { PersonFeesLedger } from "./PersonFeesLedger";
import { PersonFeeAccountWorkspace } from "./PersonFeesAccount";
import "../workspace/workspace.css";
import "./fees-workspace.css";

export interface FeeWorkspaceContext {
  readonly key: string;
  readonly kind: "responsibility" | "self" | "dependent" | "person";
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly surface: WorkspaceAreaSurface;
}

function relationshipKind(surface: WorkspaceAreaSurface) {
  const match = surface.key.match(/^account:(self|dependent|person):/);
  return match?.[1] === "self" || match?.[1] === "dependent" || match?.[1] === "person" ? match[1] : null;
}

/** Translate server-authored surfaces into human work contexts, never roles. */
export function feeWorkspaceContexts(area: WorkspaceArea | undefined): FeeWorkspaceContext[] {
  if (!area) return [];
  return area.surfaces.flatMap((surface): FeeWorkspaceContext[] => {
    if (surface.key === "ledger") return [{
      key: surface.key,
      kind: "responsibility",
      title: "Collect & reconcile",
      detail: surface.description ?? "Post invoices, record receipts and resolve payment reviews.",
      href: surface.href,
      surface,
    }];
    const kind = relationshipKind(surface);
    if (!kind) return [];
    return [{
      key: surface.key,
      kind,
      title: kind === "self" ? "My fee account" : surface.label,
      detail: surface.description ?? (kind === "self"
        ? "View my invoices, receipts and payment history."
        : "View this learner's invoices, receipts and payment history."),
      href: surface.href,
      surface,
    }];
  }).sort((left, right) => {
    const order = { responsibility: 0, self: 1, person: 1, dependent: 2 } as const;
    return order[left.kind] - order[right.kind] || left.title.localeCompare(right.title);
  });
}

/**
 * Canonical Fees entry. A single current responsibility opens immediately;
 * people with more than one relationship choose the exact context, not a
 * Parent/Student/Principal version of the product.
 */
export function WorkspaceFeesRoute() {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();

  if (environment.mode === "simulation" && environment.unavailable === true) {
    return <OperationsShell active="areas" title="Fees & receipts"><WorkspaceState state="unavailable" /></OperationsShell>;
  }
  if (query.isPending) {
    return <OperationsShell active="areas" title="Fees & receipts"><WorkspaceState state="loading" /></OperationsShell>;
  }
  if (query.error) {
    const revoked = query.error instanceof ApiError && query.error.status === 403;
    return <OperationsShell active="areas" title="Fees & receipts"><WorkspaceState state={revoked ? "revoked" : "error"} error={query.error} onRetry={query.refetch} /></OperationsShell>;
  }
  if (!query.data || !manifestMatchesEnvironment(query.data, environment)) {
    return <OperationsShell active="areas" title="Fees & receipts"><WorkspaceState state="error" error={new Error("The fee workspace did not match the active environment.")} onRetry={query.refetch} /></OperationsShell>;
  }

  const area = query.data.areas.find((entry) => entry.key === "fees");
  const contexts = feeWorkspaceContexts(area);
  if (!area || contexts.length === 0) {
    return <OperationsShell active="areas" title="Fees & receipts" backTo="/areas"><WorkspaceState state="revoked" onRetry={query.refetch} /></OperationsShell>;
  }
  if (contexts.length === 1) return <Navigate replace to={contexts[0]!.href} />;

  const responsibility = contexts.filter((context) => context.kind === "responsibility");
  const accounts = contexts.filter((context) => context.kind !== "responsibility");
  return <OperationsShell active="areas" title="Fees & receipts" backTo="/areas">
    <main className="responsibility-workspace fee-workspace-entry">
      <div className="responsibility-workspace__content workspace-view">
        {responsibility.length ? <FeeContextSection title="Institution work" contexts={responsibility} /> : null}
        {accounts.length ? <FeeContextSection title="Accounts I can view" contexts={accounts} /> : null}
      </div>
    </main>
  </OperationsShell>;
}

function FeeContextSection({ title, contexts }: { readonly title: string; readonly contexts: readonly FeeWorkspaceContext[] }) {
  return <section className="workspace-section" aria-labelledby={`fee-context-${title.replaceAll(" ", "-").toLowerCase()}`}>
    <header><h2 id={`fee-context-${title.replaceAll(" ", "-").toLowerCase()}`}>{title}</h2></header>
    <div className="workspace-directory" aria-label={title}>
      {contexts.map((context) => {
        return <WorkspaceLink key={context.key} className="workspace-directory-row fee-context-row" href={context.href} ariaLabel={`Open ${context.title}`}>
          <span className="fee-context-row__icon" aria-hidden="true"><ProductIcon name={context.kind === "responsibility" ? "finance" : context.kind === "self" ? "fees" : "people"} size={28} /></span>
          <span className="workspace-directory-row__body"><strong>{context.title}</strong><small>{context.detail}</small></span>
          <ChevronRight className="workspace-directory-row__arrow" size={17} aria-hidden="true" />
        </WorkspaceLink>;
      })}
    </div>
  </section>;
}

export function WorkspaceFeeLedgerRoute() {
  const [params] = useSearchParams();
  return <WorkspaceSurfaceOnly areaKey="fees" surfaceKey="ledger">
    {params.has("student_id") || params.has("mode") || params.has("order") || params.get("view") === "review" && !params.has("person_id") ? <FinanceResponsibilityWorkspace /> : <PersonFeesLedger />}
  </WorkspaceSurfaceOnly>;
}

export function WorkspaceFeeAccountRoute() {
  const [params] = useSearchParams();
  if (params.get("scope") === "person") {
    const personId = params.get("person_id") ?? "";
    return <WorkspaceSurfaceOnly areaKey="fees" surfaceKey={`account:person:${personId}`}><PersonFeeAccountWorkspace personId={personId} /></WorkspaceSurfaceOnly>;
  }
  return <RelationshipSurfaceResolver areaKey="fees" surfacePrefix="account" title="Fees & receipts" backTo="/areas/fees">
    {({ relationship, studentId }) => <RelationshipFeeAccountWorkspace relationship={relationship} studentId={studentId} />}
  </RelationshipSurfaceResolver>;
}
