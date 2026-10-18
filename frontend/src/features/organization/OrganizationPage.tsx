import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { getOrganization } from "./api";
import { OrganizationEditor } from "./OrganizationEditor";
import "./organization.css";

export default function OrganizationPage() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const schools = auth.memberships.filter((membership) => membership.role === "admin");
  const [chosenSchoolId, setChosenSchoolId] = useState("");
  const school = schools.find(
    (membership) => membership.school_id === (chosenSchoolId || params.get("school")),
  ) ?? schools.find((membership) => membership.school_id === auth.user?.active_school_id)
    ?? schools[0];
  const schoolId = school?.school_id ?? "";
  const [dirty, setDirty] = useState(false);
  const confirmDiscard = useUnsavedChangesGuard(
    dirty,
    "Discard unsaved organization changes?",
  );
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: ["organization", schoolId],
    queryFn: () => getOrganization(schoolId),
    enabled: Boolean(schoolId),
    refetchOnWindowFocus: false,
  });
  return <OperationsShell
    portal="principal"
    active="more"
    title="Organization"
    schoolName={school?.school_name}
    backTo="/principal/more"
    beforeBack={confirmDiscard}
  >
    <div className="organization-workspace">
      {schools.length > 1 ? <label className="organization-school-picker">Institution<select value={schoolId} onChange={(event) => {
        if (!confirmDiscard()) return;
        setDirty(false);
        setChosenSchoolId(event.target.value);
      }}>{schools.map((membership) => <option key={membership.school_id} value={membership.school_id}>{membership.school_name}</option>)}</select></label> : null}
      {!schoolId ? <p className="organization-error" role="alert">An active institution administrator membership is required.</p>
        : query.isPending ? <ScreenLoading />
        : query.isError && !query.data ? <LiveRouteError error={query.error} onRetry={query.refetch} />
        : query.data ? <>
          <OrganizationEditor
            key={`${schoolId}:${generation}`}
            schoolId={schoolId}
            data={query.data}
            onDirty={setDirty}
            onReload={async () => {
              const result = await query.refetch();
              if (result.error) throw result.error;
              setDirty(false);
              setGeneration((value) => value + 1);
            }}
          />
          {query.isError ? <p className="organization-error" role="alert">Could not check for recent changes. Your draft is preserved.</p> : null}
        </> : null}
    </div>
  </OperationsShell>;
}
