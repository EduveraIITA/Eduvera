import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { AcademicReportWorkspacePage } from "./AcademicReportWorkspacePage";
import { getAcademicReportWorkspace } from "./api";

export function AcademicReportWorkspaceRoute({ portal }: { portal: "principal" | "teacher" }) {
  const auth = useAuth();
  const membership = auth.memberships.find((item) => item.role === (portal === "principal" ? "admin" : "staff"));
  const schoolId = membership?.school_id ?? "";
  const query = useQuery({ queryKey: ["academic-reports", schoolId], queryFn: () => getAcademicReportWorkspace(schoolId), enabled: Boolean(schoolId) });
  if (!schoolId) return <LiveRouteError error={new Error("Active institution access is required.")} onRetry={auth.refresh} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.error || !query.data) return <LiveRouteError error={query.error ?? new Error("Report cards are unavailable.")} onRetry={query.refetch} />;
  return <AcademicReportWorkspacePage portal={portal} schoolId={schoolId} schoolName={membership?.school_name} data={query.data} refresh={async () => { await query.refetch(); }} />;
}

export function PrincipalAcademicReportsRoute() { return <AcademicReportWorkspaceRoute portal="principal" />; }
export function TeacherAcademicReportsRoute() { return <AcademicReportWorkspaceRoute portal="teacher" />; }
