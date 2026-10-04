import { useQuery } from "@tanstack/react-query";
import { useAuth, type Portal } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { GovernanceAdminPage } from "./GovernanceAdminPage";
import { PolicyLibraryPage } from "./PolicyLibraryPage";
import { getGovernanceWorkspace, getPublishedPolicies } from "./api";

export function PrincipalGovernanceRoute() {
  const auth = useAuth();
  const membership = auth.memberships.find((item) => item.role === "admin");
  const schoolId = membership?.school_id ?? "";
  const query = useQuery({ queryKey: ["governance", "workspace", schoolId], queryFn: () => getGovernanceWorkspace(schoolId), enabled: Boolean(schoolId) });
  if (!schoolId) return <LiveRouteError error={new Error("Active institution administrator access is required.")} onRetry={auth.refresh} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.error) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return <GovernanceAdminPage schoolId={schoolId} schoolName={membership?.school_name} data={query.data} refresh={async () => { await query.refetch(); }} />;
}

function MemberPolicyRoute({ portal }: { portal: Exclude<Portal, "principal"> }) {
  const auth = useAuth();
  const role = portal === "parent" ? "guardian" : portal === "teacher" ? "staff" : "student";
  const membership = auth.memberships.find((item) => item.role === role);
  const schoolId = membership?.school_id ?? "";
  const query = useQuery({ queryKey: ["governance", "published", schoolId, auth.user?.id], queryFn: () => getPublishedPolicies(schoolId), enabled: Boolean(schoolId) });
  if (!schoolId) return <LiveRouteError error={new Error("Active institution access is required.")} onRetry={auth.refresh} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.error) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return <PolicyLibraryPage portal={portal} schoolId={schoolId} schoolName={membership?.school_name} data={query.data} refresh={async () => { await query.refetch(); }} />;
}

export function ParentPoliciesRoute() { return <MemberPolicyRoute portal="parent" />; }
export function StudentPoliciesRoute() { return <MemberPolicyRoute portal="student" />; }
export function TeacherPoliciesRoute() { return <MemberPolicyRoute portal="teacher" />; }
