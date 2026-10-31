import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../../lib/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getStaffWorkspace } from "./api";
import {
  AuthorizedStaffLeaveDecisionPage,
  StaffOperationsWorkspacePage,
  type StaffWorkspaceSurface,
} from "./StaffOperationsPage";

// Retained data may survive a temporary failed refresh, not an explicit access
// refusal. In-flow actions receive the rejected refetch and keep their recovery.
function blocksRetainedWorkspace(error: unknown) {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

function StaffOperationsRoute({ surface }: { readonly surface: StaffWorkspaceSurface }) {
  const auth = useAuth();
  const environment = useExecutionEnvironment();
  const unavailable = environment.mode === "simulation" && environment.unavailable === true;
  const [searchParams] = useSearchParams();
  const { staffProfileId } = useParams<{ staffProfileId: string }>();
  const activeSchoolId = auth.user?.active_school_id;
  const staffMemberships = auth.memberships.filter((item) => item.role === "staff" || item.role === "admin");
  const membership = staffMemberships.find((item) => item.school_id === activeSchoolId)
    ?? staffMemberships[0];
  const schoolId = membership?.school_id ?? "";
  const focusedRequestId = searchParams.get("request") ?? undefined;
  const query = useQuery({
    queryKey: unavailable ? ["staff-operations-unavailable", environment.namespaceId, environment.runId, schoolId, auth.user?.id]
      : executionEnvironmentQueryKey(environment, ["staff-operations", schoolId, "actor", auth.user?.id, surface, focusedRequestId ?? "list"]),
    queryFn: () => getStaffWorkspace(schoolId, focusedRequestId),
    enabled: Boolean(schoolId) && !unavailable,
  });
  if (unavailable) return <LiveRouteError error={new Error("This simulation is unavailable. Recover it before opening staff work.")} onRetry={auth.refresh} />;
  if (!schoolId) return <LiveRouteError error={new Error("Active school access is required.")} onRetry={() => auth.refresh()} />;
  if (query.isPending) return <ScreenLoading />;
  if (!query.data || query.error && blocksRetainedWorkspace(query.error)) return <LiveRouteError error={query.error ?? new Error("Staff work is unavailable.")} onRetry={query.refetch} />;
  return <StaffOperationsWorkspacePage
    surface={surface}
    actorId={auth.user?.id ?? ""}
    staffProfileId={surface === "setup" ? staffProfileId : undefined}
    schoolId={schoolId}
    schoolName={membership?.school_name}
    data={query.data}
    refresh={async () => { await query.refetch({ throwOnError: true }); await auth.refresh(); }}
  />;
}

export function WorkspaceStaffSetupRoute() { return <StaffOperationsRoute surface="setup" />; }
export function WorkspaceResponsibilitiesRoute() { return <StaffOperationsRoute surface="responsibilities" />; }
export function WorkspaceCoverageRoute() { return <StaffOperationsRoute surface="coverage" />; }
export function WorkspaceStaffLeaveRoute() { return <StaffOperationsRoute surface="leave" />; }

/** Bookmark-only aliases while App.tsx moves old URLs to tested redirects. */
export function PrincipalStaffRoute() { return <WorkspaceStaffSetupRoute />; }
export function TeacherLeaveRoute() { return <WorkspaceStaffLeaveRoute />; }
export function TeacherResponsibilitiesRoute() {
  const location = useLocation();
  return location.pathname.endsWith("/coverage")
    ? <WorkspaceCoverageRoute />
    : <WorkspaceResponsibilitiesRoute />;
}

export function AuthorizedStaffLeaveDecisionRoute() {
  const auth = useAuth();
  const environment = useExecutionEnvironment();
  const unavailable = environment.mode === "simulation" && environment.unavailable === true;
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get("request") ?? "";
  const requestedSchoolId = searchParams.get("school");
  const eligibleMemberships = requestedSchoolId
    ? auth.memberships.filter((item) => item.school_id === requestedSchoolId)
    : auth.memberships;
  const staffMemberships = eligibleMemberships.filter((item) => item.role === "staff" || item.role === "admin");
  const activeSchoolId = auth.user?.active_school_id;
  const membership = staffMemberships.find((item) => item.school_id === activeSchoolId)
    ?? staffMemberships[0];
  const validRequestId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId);
  const schoolId = membership?.school_id ?? "";
  const query = useQuery({
    queryKey: unavailable ? ["staff-operations-unavailable", environment.namespaceId, environment.runId, schoolId, auth.user?.id]
      : executionEnvironmentQueryKey(environment, ["staff-operations", schoolId, "actor", auth.user?.id, requestId || "missing", "authorized-leave-decision"]),
    queryFn: () => getStaffWorkspace(schoolId, requestId),
    enabled: Boolean(schoolId && validRequestId) && !unavailable,
  });
  if (unavailable) return <LiveRouteError error={new Error("This simulation is unavailable. Recover it before opening staff work.")} onRetry={auth.refresh} />;
  if (!membership) return <LiveRouteError error={new Error("Active school staff access is required.")} onRetry={() => auth.refresh()} />;
  if (!validRequestId) return <LiveRouteError error={new Error("This leave request link is incomplete.")} onRetry={() => auth.refresh()} />;
  if (query.isPending) return <ScreenLoading />;
  if (!query.data || query.error && blocksRetainedWorkspace(query.error)) return <LiveRouteError error={query.error ?? new Error("Staff work is unavailable.")} onRetry={query.refetch} />;
  return <AuthorizedStaffLeaveDecisionPage
    schoolId={schoolId}
    schoolName={membership.school_name}
    actorId={auth.user?.id ?? ""}
    requestId={requestId}
    data={query.data}
    refresh={async () => { await query.refetch({ throwOnError: true }); await auth.refresh(); }}
  />;
}
