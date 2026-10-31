import type { ReactNode } from "react";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "./ResponsibilityWorkspace";
import { WorkspaceState } from "./WorkspaceState";
import { useWorkspaceManifest } from "./useWorkspaceManifest";

/**
 * Navigation eligibility boundary for a domain surface. Authoritative domain
 * APIs still recheck every command; this component never grants authority.
 */
export function WorkspaceSurfaceOnly({
  areaKey,
  surfaceKey,
  children,
}: {
  readonly areaKey: string;
  readonly surfaceKey: string;
  readonly children: ReactNode;
}) {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();
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
  const area = query.data?.areas.find((entry) => entry.key === areaKey);
  const surface = area?.surfaces.find((entry) => entry.key === surfaceKey);
  if (!query.data || !manifestMatchesEnvironment(query.data, environment) || !surface) {
    return <OperationsShell active="areas" title={area?.label ?? "Areas"}>
      <WorkspaceState state="revoked" onRetry={query.refetch} />
    </OperationsShell>;
  }
  return children;
}
