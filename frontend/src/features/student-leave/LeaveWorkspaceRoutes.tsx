import { useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentLeaveRoute } from "../school/ParentLiveRoutes";
import { StudentLeaveNewRoute, StudentLeaveStatusRoute } from "../school/StudentLiveRoutes";
import { RelationshipSurfaceResolver } from "../workspace/RelationshipSurfaceResolver";

/**
 * Relationship leave is an Attendance-owned surface. The manifest decides who
 * may open it; the leave domain rechecks every read and command. Live and
 * Simulation intentionally share this route and are separated by the active
 * execution-environment boundary.
 */
export function WorkspaceRelationshipLeaveRoute() {
  const [params] = useSearchParams();
  const view = params.get("view");
  return <RelationshipSurfaceResolver areaKey="attendance" surfacePrefix="leave" title="Leave" backTo="/areas/attendance">
    {({ relationship, label, manifest }) => {
      const subject = relationship === "self" ? "My leave" : `${label} leave`;
      return <OperationsShell
        active="areas"
        title={subject}
        schoolName={manifest.context.institution_label ?? undefined}
        backTo="/areas/attendance"
      >
        {relationship === "self"
          ? view === "apply"
            ? <StudentLeaveNewRoute embedded />
            : <StudentLeaveStatusRoute embedded />
          : <ParentLeaveRoute embedded />}
      </OperationsShell>;
    }}
  </RelationshipSurfaceResolver>;
}
