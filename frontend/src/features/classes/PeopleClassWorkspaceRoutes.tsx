import { WorkspaceSurfaceOnly } from "../workspace/WorkspaceSurfaceOnly";
import { AssignedClassPage } from "./TeacherClassPage";
import { AssignedClassesPage } from "./TeacherClassesPage";

/**
 * Neutral People-area entry points. The server-composed classes surface proves
 * current navigation eligibility; class and register APIs still recheck exact
 * date-scoped responsibility and authority for every read or action.
 */
export function WorkspaceAssignedClassesRoute() {
  return <WorkspaceSurfaceOnly areaKey="people" surfaceKey="classes">
    <AssignedClassesPage />
  </WorkspaceSurfaceOnly>;
}

export function WorkspaceAssignedClassRoute() {
  return <WorkspaceSurfaceOnly areaKey="people" surfaceKey="classes">
    <AssignedClassPage />
  </WorkspaceSurfaceOnly>;
}
