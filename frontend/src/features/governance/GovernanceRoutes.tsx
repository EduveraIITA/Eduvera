import { useQuery } from "@tanstack/react-query";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { GovernanceAdminPage } from "./GovernanceAdminPage";
import { PolicyLibraryPage } from "./PolicyLibraryPage";
import { getGovernanceWorkspace, getPublishedPolicies } from "./api";

function activeInstitution(auth: ReturnType<typeof useAuth>) {
  const membership = auth.memberships.find((item) => item.school_id === auth.user?.active_school_id)
    ?? auth.memberships[0];
  return {
    schoolId: auth.user?.active_school_id ?? membership?.school_id ?? "",
    schoolName: membership?.school_name,
  };
}

function GovernanceManagementRoute() {
  const auth = useAuth();
  const { schoolId, schoolName } = activeInstitution(auth);
  const query = useQuery({ queryKey: ["governance", "workspace", schoolId], queryFn: () => getGovernanceWorkspace(schoolId), enabled: Boolean(schoolId) });
  const state = !schoolId
    ? <LiveRouteError error={new Error("Current governance authority is required.")} onRetry={auth.refresh} />
    : query.isPending
      ? <ScreenLoading />
      : query.error
        ? <LiveRouteError error={query.error} onRetry={query.refetch} />
        : null;
  if (state) return <OperationsShell active="more" title="Policies & governance" backTo="/more">{state}</OperationsShell>;
  if (!query.data) return null;
  return <GovernanceAdminPage schoolId={schoolId} schoolName={schoolName} data={query.data} refresh={async () => { await query.refetch(); }} />;
}

function MemberPolicyRoute() {
  const auth = useAuth();
  const { schoolId, schoolName } = activeInstitution(auth);
  const query = useQuery({ queryKey: ["governance", "published", schoolId, auth.user?.id], queryFn: () => getPublishedPolicies(schoolId), enabled: Boolean(schoolId) });
  const state = !schoolId
    ? <LiveRouteError error={new Error("Active institution access is required.")} onRetry={auth.refresh} />
    : query.isPending
      ? <ScreenLoading />
      : query.error
        ? <LiveRouteError error={query.error} onRetry={query.refetch} />
        : null;
  if (state) return <OperationsShell active="more" title="Policies & acknowledgements" backTo="/more">{state}</OperationsShell>;
  if (!query.data) return null;
  return <PolicyLibraryPage schoolId={schoolId} schoolName={schoolName} data={query.data} refresh={async () => { await query.refetch(); }} />;
}

/** Canonical responsibility-composed route. Eligibility is decided by the published-policy API. */
export function WorkspacePoliciesRoute() { return <MemberPolicyRoute />; }

/** Canonical management route; the owning API still rechecks institution authority. */
export function WorkspaceGovernanceRoute() { return <GovernanceManagementRoute />; }
