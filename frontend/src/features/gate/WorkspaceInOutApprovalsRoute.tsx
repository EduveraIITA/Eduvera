import { Navigate, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { authDestination, useAuth } from "../auth/AuthContext";
import { GateApprovalInbox } from "./GateApprovalInbox";
import "./gate.css";

export function WorkspaceInOutApprovalsRoute() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const requestedSchool = params.get("school");
  const membership = auth.memberships.find((item) => item.school_id === requestedSchool && (item.role === "staff" || item.role === "admin"))
    ?? auth.memberships.find((item) => item.school_id === auth.user?.active_school_id && (item.role === "staff" || item.role === "admin"))
    ?? auth.memberships.find((item) => item.role === "staff" || item.role === "admin");
  if (!membership) return <Navigate to={authDestination(auth)} replace />;
  return <OperationsShell active="work" title="Visitor approval" subtitle="A request addressed to you" schoolName={membership.school_name} backTo="/work">
    <div className="operations-stack gate-workspace gate-workspace--approvals">
      <GateApprovalInbox hindi={false} focusVisitorId={params.get("visitor")} />
    </div>
  </OperationsShell>;
}
