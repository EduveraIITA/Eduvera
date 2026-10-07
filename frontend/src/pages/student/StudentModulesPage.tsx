import { MoreContent } from "../../features/more/MorePage";
import { StudentShell } from "./StudentShell";

export function StudentModulesPage() {
  return <StudentShell activeNav="launcher" pageTitle="More"><MoreContent portal="student" /></StudentShell>;
}
