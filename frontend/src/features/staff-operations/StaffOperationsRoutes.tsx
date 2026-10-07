import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getStaffWorkspace } from "./api";
import { StaffOperationsPage } from "./StaffOperationsPage";

function StaffOperationsRoute({ portal, teacherView }: { portal: "principal" | "teacher"; teacherView?: "leave" | "responsibilities" }) {
  const auth = useAuth();
  const { staffProfileId } = useParams<{ staffProfileId: string }>();
  const role = portal === "principal" ? "admin" : "staff";
  const membership = auth.memberships.find((item) => item.role === role);
  const schoolId = membership?.school_id ?? "";
  const query = useQuery({ queryKey: ["staff-operations", schoolId], queryFn: () => getStaffWorkspace(schoolId), enabled: Boolean(schoolId) });
  if (!schoolId) return <LiveRouteError error={new Error("Active school access is required.")} onRetry={() => auth.refresh()} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.error) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  return <StaffOperationsPage portal={portal} teacherView={teacherView} staffProfileId={portal === "principal" ? staffProfileId : undefined} schoolId={schoolId} schoolName={membership?.school_name} data={query.data} refresh={async () => { await Promise.all([query.refetch(),auth.refresh()]); }} />;
}

export function PrincipalStaffRoute() { return <StaffOperationsRoute portal="principal" />; }
export function TeacherLeaveRoute() { return <StaffOperationsRoute portal="teacher" />; }
export function TeacherResponsibilitiesRoute() { return <StaffOperationsRoute portal="teacher" teacherView="responsibilities" />; }
