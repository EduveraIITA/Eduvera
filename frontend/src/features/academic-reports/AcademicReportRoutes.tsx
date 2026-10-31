import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { AcademicReportWorkspacePage } from "./AcademicReportWorkspacePage";
import { getAcademicReportWorkspace } from "./api";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";

/**
 * Canonical reports contribution. The active institution and the authoritative
 * domain response decide what is available; a caller never chooses a persona.
 */
export function WorkspaceAcademicReportsRoute() {
  const auth = useAuth();
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const unavailable = environment.mode === "simulation" && environment.unavailable === true;
  const schoolId = auth.user?.active_school_id ?? auth.memberships[0]?.school_id ?? "";
  const membership = auth.memberships.find((item) => item.school_id === schoolId);
  const query = useQuery({ queryKey: unavailable ? ["academic-reports-unavailable", schoolId, auth.user?.id] : executionEnvironmentQueryKey(environment, ["academic-reports", schoolId, "actor", auth.user?.id]), queryFn: () => getAcademicReportWorkspace(schoolId), enabled: Boolean(schoolId) && !unavailable });
  if (unavailable) return <LiveRouteError error={new Error("This simulation is unavailable. Recover it before opening reports.")} onRetry={auth.refresh} />;
  if (!schoolId) return <LiveRouteError error={new Error("Active institution access is required.")} onRetry={auth.refresh} />;
  if (query.isPending) return <ScreenLoading />;
  if (!query.data || query.error instanceof ApiError && [401, 403, 404, 410].includes(query.error.status)) return <LiveRouteError error={query.error ?? new Error("Report cards are unavailable.")} onRetry={query.refetch} />;
  return <AcademicReportWorkspacePage schoolId={schoolId} schoolName={membership?.school_name} data={query.data} workspaceRecovery={query.error ? { pending: query.isFetching, retry: () => { void query.refetch(); } } : undefined} refresh={async () => { await query.refetch({ throwOnError: true }); }} />;
}

// Transitional source exports for callers outside the router. They intentionally
// resolve the same canonical contribution and do not select a portal.
export function PrincipalAcademicReportsRoute() { return <WorkspaceAcademicReportsRoute />; }
export function TeacherAcademicReportsRoute() { return <WorkspaceAcademicReportsRoute />; }
