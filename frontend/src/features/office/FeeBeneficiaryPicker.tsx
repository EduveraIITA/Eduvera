import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { feeReadDenied } from "./personFeesApi";
import { getFeeChargeAudience, type FeeAudienceGroup, type FeeAudiencePerson, type FeeAudienceSelection } from "./feeBatchApi";

const groupLabels = { participation: "Group", class: "Class", organization: "Organization", learning: "Learning group" } as const;
export function FeeBeneficiaryPicker({ schoolId, selection, disabled, onChange, onAddPeople, onClose }: {
  schoolId: string; selection: FeeAudienceSelection; disabled: boolean; onChange: (next: FeeAudienceSelection) => void; onAddPeople: () => void; onClose: () => void;
}) {
  const auth = useAuth(), environment = useExecutionEnvironment(), [kind, setKind] = useState<"people" | "groups">("people");
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["finance-arrangements", "charge-audience", auth.user?.id, schoolId, kind, search, page]),
    queryFn: () => getFeeChargeAudience(schoolId, kind, search, page), retry: false });
  const count = selection.person_ids.length + selection.groups.length;
  return <PlannerDialog title="Choose people or groups" busy={disabled} onClose={() => { if (!disabled) onClose(); }}><div className="person-fee-form fee-beneficiary-picker">
    <div className="fee-beneficiary-tabs" role="group" aria-label="Choose audience view"><button type="button" aria-pressed={kind === "people"} disabled={disabled} onClick={() => { setKind("people"); setSearch(""); setPage(1); }}>People</button><button type="button" aria-pressed={kind === "groups"} disabled={disabled} onClick={() => { setKind("groups"); setSearch(""); setPage(1); }}>Groups</button></div>
    <div className="person-fee-label"><span className="person-fee-caption" aria-live="polite">{selection.person_ids.length} {selection.person_ids.length === 1 ? "person" : "people"} · {selection.groups.length} {selection.groups.length === 1 ? "group" : "groups"} selected</span>{query.data?.can_add_people && !feeReadDenied(query.error) ? <button type="button" className="is-secondary" disabled={disabled || Boolean(query.error)} onClick={onAddPeople}><Plus size={18} aria-hidden="true" />Add people</button> : null}</div>
    <label>Find {kind}<input type="search" value={search} disabled={disabled} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    {query.isPending ? <p role="status">Loading {kind}…</p> : query.error || !query.data ? <p role="alert">{query.error instanceof Error ? query.error.message : "These choices are unavailable."} <button type="button" className="is-secondary" onClick={() => void query.refetch()}>Try again</button></p> : <>
      <fieldset disabled={disabled} className="fee-beneficiary-options"><legend className="sr-only">{kind === "people" ? "People to charge" : "Groups to charge"}</legend>{query.data.results.map(item => {
        const group = kind === "groups" ? item as FeeAudienceGroup : null, person = kind === "people" ? item as FeeAudiencePerson : null;
        const name = group?.name ?? person!.label, selected = group ? selection.groups.some(value => value.id === group.id && value.kind === group.kind) : selection.person_ids.includes(item.id);
        const sameName = person && query.data.results.filter(value => "label" in value && value.label.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()).length > 1;
        const full = group ? selection.groups.length >= 20 : selection.person_ids.length >= 500;
        return <label className={`fee-beneficiary-option${selected ? " is-selected" : ""}`} key={group ? `${group.kind}:${group.id}` : item.id}>
          <input type="checkbox" checked={selected} disabled={full && !selected} onChange={() => onChange(group ? { ...selection, groups: selected ? selection.groups.filter(value => !(value.id === group.id && value.kind === group.kind)) : [...selection.groups, { kind: group.kind, id: group.id }] }
            : { ...selection, person_ids: selected ? selection.person_ids.filter(id => id !== item.id) : [...selection.person_ids, item.id] })} />
          <span className="fee-beneficiary-avatar" aria-hidden="true">{group ? <ProductIcon name="groups" size={26} /> : name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><span><strong>{name}</strong><small title={person?.id}>{group ? `${groupLabels[group.kind]} · ${group.member_count} ${group.member_count === 1 ? "member" : "members"}` : sameName ? `Person · ${item.id.slice(0, 8)}` : "Campus person"}</small></span>
        </label>;
      })}</fieldset>
      {!query.data.results.length ? <p className="person-fee-caption">No matching {kind}.</p> : null}
      {query.data.total > query.data.page_size ? <nav className="fee-beneficiary-pages" aria-label={`${kind} pages`}><button type="button" className="is-secondary" disabled={disabled || page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.ceil(query.data.total / query.data.page_size)}</span><button type="button" className="is-secondary" disabled={disabled || page * query.data.page_size >= query.data.total} onClick={() => setPage(page + 1)}>Next</button></nav> : null}
    </>}
    <footer><button type="button" className="is-secondary" disabled={disabled} onClick={onClose}>Back</button><button type="button" disabled={disabled || !count || Boolean(query.error)} onClick={onClose}>Use selection</button></footer>
  </div></PlannerDialog>;
}
