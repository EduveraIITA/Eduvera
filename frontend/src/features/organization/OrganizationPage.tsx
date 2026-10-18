import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getOrganization } from "./api";
import { OrganizationEditor } from "./OrganizationEditor";
import "./organization.css";

export default function OrganizationPage() {
  const auth = useAuth(), [params] = useSearchParams();
  const schools = auth.memberships.filter(member => member.role === "admin");
  const [chosen, setChosen] = useState("");
  const school = schools.find(member => member.school_id === (chosen || params.get("school"))) ?? schools[0];
  const schoolId = school?.school_id ?? "";
  const [dirty, setDirty] = useState(false), [generation, setGeneration] = useState(0);
  const query = useQuery({ queryKey: ["organization", schoolId], queryFn: () => getOrganization(schoolId), enabled: Boolean(schoolId), refetchOnWindowFocus: false });
  const mayLeave = () => !dirty || window.confirm("Discard unsaved organization changes?");
  return <OperationsShell portal="principal" active="more" title="Organization" schoolName={school?.school_name} backTo="/principal/more" beforeBack={mayLeave}>
    <div className="org-workspace">
      {schools.length > 1 && <label className="org-school">Institution<select value={schoolId} onChange={event => { if (mayLeave()) { setDirty(false); setChosen(event.target.value); } }}>{schools.map(item => <option key={item.school_id} value={item.school_id}>{item.school_name}</option>)}</select></label>}
      {!schoolId ? <p role="alert">An active institution administrator membership is required.</p> : query.isPending ? <ScreenLoading/> : query.isError && !query.data ? <LiveRouteError error={query.error} onRetry={query.refetch}/> : query.data ? <><OrganizationEditor key={`${schoolId}:${generation}`} schoolId={schoolId} data={query.data} onDirty={setDirty} onReload={async () => { const result = await query.refetch(); if (result.error) throw result.error; setDirty(false); setGeneration(value => value + 1); }}/>{query.isError && <p role="alert">Could not check for recent changes. Your draft is preserved.</p>}</> : null}
    </div>
  </OperationsShell>;
}
