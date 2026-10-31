import { useSearchParams } from "react-router-dom";
import { ParentAttendanceRoute } from "../school/ParentLiveRoutes";
import { StudentAttendanceRoute, StudentEligibilityRoute } from "../school/StudentLiveRoutes";
import { MessagesWorkspaceRoute } from "../chat/MessagesWorkspaceRoute";
import { WorkspaceFamilyResultsRoute } from "../assessments/AssessmentRoutes";
import { FamilyFeesPage } from "../office/FamilyFeesPage";
import { WorkspaceDeparturePlanPage } from "../departure/ParentDeparturePage";
import { ResponsibilityAttendanceWorkspace } from "../attendance/ResponsibilityAttendanceWorkspace";
import { RelationshipSurfaceResolver } from "./RelationshipSurfaceResolver";

export function WorkspaceAttendanceRecordsRoute() {
  const [params] = useSearchParams();
  const view = params.get("view");
  return <RelationshipSurfaceResolver areaKey="attendance" surfacePrefix="records" title="Attendance" backTo="/areas/attendance">
    {({ relationship, studentId }) => <ResponsibilityAttendanceWorkspace selection={{
      kind: "records",
      relationship,
      studentId,
    }}>
      {() => relationship === "self"
        ? view === "eligibility"
          ? <StudentEligibilityRoute embedded />
          : <StudentAttendanceRoute embedded openCopilot={view === "copilot"} />
        : <ParentAttendanceRoute embedded />}
    </ResponsibilityAttendanceWorkspace>}
  </RelationshipSurfaceResolver>;
}

export function WorkspaceRelationshipMessagesRoute() {
  return <MessagesWorkspaceRoute />;
}

export function WorkspaceRelationshipResultsRoute({ areaKey }: { readonly areaKey: "assessments" | "reports" }) {
  return <RelationshipSurfaceResolver
    areaKey={areaKey}
    surfacePrefix={areaKey === "assessments" ? "results" : "progress"}
    title={areaKey === "assessments" ? "Results" : "Progress reports"}
    backTo={`/areas/${areaKey}`}
  >
    {() => <WorkspaceFamilyResultsRoute />}
  </RelationshipSurfaceResolver>;
}

export function WorkspaceRelationshipFeesRoute() {
  return <RelationshipSurfaceResolver areaKey="fees" surfacePrefix="account" title="Fees & receipts" backTo="/areas/fees">
    {({ relationship }) => <FamilyFeesPage relationship={relationship} />}
  </RelationshipSurfaceResolver>;
}

export function WorkspaceRelationshipDepartureRoute() {
  return <RelationshipSurfaceResolver areaKey="departure" surfacePrefix="plan" title="Departure plan" backTo="/areas/departure">
    {({ relationship }) => <WorkspaceDeparturePlanPage relationship={relationship} />}
  </RelationshipSurfaceResolver>;
}
