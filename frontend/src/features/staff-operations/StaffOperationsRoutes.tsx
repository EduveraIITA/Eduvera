import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getStaffWorkspace } from "./api";
import { AuthorizedStaffLeaveDecisionPage, StaffOperationsPage } from "./StaffOperationsPage";

function StaffOperationsRoute({ portal, teacherView }: { portal: "principal" | "teacher"; teacherView?: "leave" | "responsibilities" }) {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const { staffProfileId } = useParams<{ staffProfileId: string }>();
  const role = portal === "principal" ? "admin" : "staff";
  const membership = auth.memberships.find((item) => item.role === role);
  const schoolId = membership?.school_id ?? "";
  const focusedRequestId = searchParams.get("request") ?? undefined;
  const query = useQuery({ queryKey: ["staff-operations", schoolId, focusedRequestId ?? "list"], queryFn: () => getStaffWorkspace(schoolId, focusedRequestId), enabled: Boolean(schoolId) });
  if (!schoolId) return <LiveRouteError error={new Error("Active school access is required.")} onRetry={() => auth.refresh()} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.error) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return <StaffOperationsPage portal={portal} actorId={auth.user?.id ?? ""} teacherView={teacherView} staffProfileId={portal === "principal" ? staffProfileId : undefined} schoolId={schoolId} schoolName={membership?.school_name} data={query.data} refresh={async () => { await Promise.all([query.refetch(),auth.refresh()]); }} />;
}

export function PrincipalStaffRoute() { return <StaffOperationsRoute portal="principal" />; }
export function TeacherLeaveRoute() { return <StaffOperationsRoute portal="teacher" />; }
export function TeacherResponsibilitiesRoute() { return <StaffOperationsRoute portal="teacher" teacherView="responsibilities" />; }

export function AuthorizedStaffLeaveDecisionRoute() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get("request") ?? "";
  const requestedSchoolId = searchParams.get("school");
  const requestedContext = searchParams.get("context");
  const preferredRole = requestedContext === "principal" ? "admin" : requestedContext === "teacher" ? "staff" : null;
  const eligibleMemberships = requestedSchoolId
    ? auth.memberships.filter((item) => item.school_id === requestedSchoolId)
    : auth.memberships;
  const membership = (preferredRole ? eligibleMemberships.find((item) => item.role === preferredRole) : undefined)
    ?? eligibleMemberships.find((item) => item.role === "staff")
    ?? eligibleMemberships.find((item) => item.role === "admin");
  const portal = membership?.role === "admin" ? "principal" : "teacher";
  const validRequestId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId);
  const schoolId = membership?.school_id ?? "";
  const query = useQuery({
    queryKey: ["staff-operations", schoolId, requestId || "missing", "authorized-leave-decision"],
    queryFn: () => getStaffWorkspace(schoolId, requestId),
    enabled: Boolean(schoolId && validRequestId),
  });
  if (!membership) return <LiveRouteError error={new Error("Active school staff access is required.")} onRetry={() => auth.refresh()} />;
  if (!validRequestId) return <LiveRouteError error={new Error("This leave request link is incomplete.")} onRetry={() => auth.refresh()} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.error) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return <AuthorizedStaffLeaveDecisionPage
    portal={portal}
    schoolId={schoolId}
    schoolName={membership.school_name}
    actorId={auth.user?.id ?? ""}
    requestId={requestId}
    data={query.data}
    refresh={async () => { await Promise.all([query.refetch(), auth.refresh()]); }}
  />;
}
