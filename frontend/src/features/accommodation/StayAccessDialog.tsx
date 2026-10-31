import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { ResourceIssueDialog } from "../resources/ResourceIssueDialog";
import { ResourceReturnDialog } from "../resources/ResourceReturnDialog";
import { getResourceLoan, getResourceOptions, getResources, type ResourceLoan } from "../resources/resourceApi";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { getStay, linkStayAccess, type StayRecord } from "./accommodationApi";
import { AccommodationPages, AccommodationReadError, AccommodationWriteFeedback } from "./AccommodationPrimitives";
import { useAccommodationCommand } from "./useAccommodationCommand";
import "../resources/resources.css";

export function StayAccessDialog({ schoolId, actorId, stay, timezone, refresh, onClose }: { schoolId: string; actorId: string; stay: StayRecord; timezone: string; refresh: () => Promise<unknown>; onClose: () => void }) {
  const environment = useExecutionEnvironment(), [current, setCurrent] = useState(stay), [issuing, setIssuing] = useState(false), [issuedId, setIssuedId] = useState<string | null>(null), [selected, setSelected] = useState<ResourceLoan | null>(null);
  const [search, setSearch] = useState(stay.resident.label), [draft, setDraft] = useState(stay.resident.label), [page, setPage] = useState(1), [reviewing, setReviewing] = useState(false), [error, setError] = useState(""), [knownReference, setKnownReference] = useState("");
  const root = executionEnvironmentQueryKey(environment, ["resources", schoolId, actorId]);
  const options = useQuery({ queryKey: [...root, "accommodation-issue-options", stay.id], queryFn: () => getResourceOptions(schoolId) });
  const loans = useQuery({ queryKey: [...root, "accommodation-loans", stay.id, search, page], queryFn: () => getResources(schoolId, { view: "loans", state: "all", search, page }), enabled: !issuing && !issuedId });
  const write = useAccommodationCommand({ schoolId, sourceId: stay.id, onAccepted: async () => { await refresh(); onClose(); } });
  const canLeave = useUnsavedChangesGuard(Boolean(issuedId) && !write.busy && !write.recovery, "The access item was issued, but its stay link is unfinished. Keep its existing loan; do not issue it again. Leave this link?");
  const close = () => { if (!write.busy && !write.recovery && canLeave()) onClose(); };
  const review = async () => { setReviewing(true); setError(""); try { const next = await getStay(schoolId, stay.id); if (next.recovery_only) throw new Error("Private stay access has changed. Return to the workspace."); setCurrent(next); write.reviewed(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Stay could not refresh."); } finally { setReviewing(false); } };
  const knownId = accessLoanReference(knownReference), required = current.access_mode === "tracked_required";
  const link = () => { const loan_id = issuedId ?? selected?.id ?? knownId; if (loan_id) { const body = { loan_id, return_required: required, expected_revision: current.revision }; void write.execute(command_id => linkStayAccess(schoolId, stay.id, { ...body, command_id }), { id: stay.id, revision: current.revision }); } };
  if (issuing) return <ResourceIssueDialog schoolId={schoolId} actorId={actorId} timezone={timezone} continuation={{ label: `Temporary access · ${stay.room.label}`, borrower: { id: stay.resident.id, name: stay.resident.label, revision: 0 }, dueAt: stay.planned_ends_at, purpose: `Temporary accommodation access: ${stay.room.label}` }} refresh={() => Promise.resolve(undefined)} onClose={() => setIssuing(false)} onSaved={id => { setIssuedId(id); setIssuing(false); }} />;
  const candidates = loans.data?.loans.filter(loan => loan.borrower.id === stay.resident.id && !current.access_loans.some(linked => linked.loan_id === loan.id)) ?? [];
  return <PlannerDialog title="Temporary access items" subtitle={stay.resident.label} busy={write.busy || Boolean(write.recovery) || reviewing} onClose={close}><div className="accommodation-form">
    {issuedId ? <section className="accommodation-summary" role="status"><strong>Item issued. Stay link not yet saved.</strong><p className="accommodation-caption">Use this existing loan. Do not issue another item to retry the link.</p><details><summary>Loan reference</summary><p>{issuedId}</p></details></section> : <>
      {current.access_mode === "tracked_required" && options.data?.can_manage && !options.error ? <button type="button" disabled={write.locked} onClick={() => setIssuing(true)}>Issue item through Resources</button> : current.access_mode === "existing_access" ? <p className="accommodation-caption">Existing access is retained. Link its existing custody record; do not issue another item.</p> : options.isPending ? <p className="accommodation-caption" role="status">Checking custody access…</p> : <p className="accommodation-caption">A Resources custodian must record actual issue. Accommodation responsibility does not grant custody access.</p>}
      <label>Find an existing loan<input type="search" maxLength={80} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); setSearch(draft.trim()); setPage(1); } }} /></label><button type="button" className="is-secondary" onClick={() => { setSearch(draft.trim()); setPage(1); }}>Find loan</button>
      {loans.isPending ? <p role="status">Loading your authorized loans…</p> : loans.error ? <AccommodationReadError error={loans.error} onRetry={() => void loans.refetch()} /> : <><ul className="accommodation-choice-list">{candidates.map(loan => <li key={loan.id}><button type="button" className="accommodation-choice is-secondary" aria-pressed={selected?.id === loan.id} disabled={write.locked} onClick={() => setSelected(loan)}><span><strong>{loan.title}</strong><small>{loan.asset_tag} · {loan.outstanding_count} outstanding</small><small>{loan.custodian.label}</small></span></button></li>)}</ul>{!candidates.length ? <p className="accommodation-caption">No matching authorized loans for this resident on this page.</p> : null}<AccommodationPages page={page} hasMore={Boolean(loans.data && page * loans.data.pagination.page_size < loans.data.pagination.total)} label="Access loan pages" onChange={setPage} /></>}
    </>}
    {!issuedId ? <details><summary>Have a loan reference?</summary><label>Resources loan link or ID<input value={knownReference} disabled={write.locked || reviewing} maxLength={1000} onChange={event => { setKnownReference(event.target.value); setSelected(null); }} placeholder="Paste the custodian’s exact loan link" /></label><p className="accommodation-caption">Ask the current custodian for the exact reference. Only this resident’s matching loan can be linked; unrelated borrowing stays private.</p>{knownReference && !knownId ? <p className="accommodation-error">Use a valid Resources loan link or full loan ID.</p> : null}</details> : null}
    {selected || issuedId || knownId ? <p className="accommodation-caption">{required ? "This temporary item must be returned before the stay is closed." : "Existing access is retained; this link does not require its return for this temporary stay."}</p> : null}
    {error ? <p className="accommodation-error" role="alert">{error}</p> : null}<AccommodationWriteFeedback write={write} onReview={() => void review()} />
    <footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery) || reviewing} onClick={close}>Back</button><button type="button" disabled={write.locked || reviewing || !current.allowed_actions.link_access || (!issuedId && !selected && !knownId)} onClick={link}>{write.busy ? "Linking…" : "Link existing loan"}</button></footer>
  </div></PlannerDialog>;
}

export function StayAccessReturnDialog({ schoolId, actorId, loanId, refresh, onClose }: { schoolId: string; actorId: string; loanId: string; refresh: () => Promise<unknown>; onClose: () => void }) {
  const environment = useExecutionEnvironment(), loan = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["resources", schoolId, actorId, "loan", loanId]), queryFn: () => getResourceLoan(schoolId, loanId) });
  if (loan.isPending) return <PlannerDialog title="Record access-item return" onClose={onClose}><div className="accommodation-form"><p role="status">Checking the owning custody record…</p></div></PlannerDialog>;
  if (!loan.data || loan.error || !loan.data.can_record_return) return <PlannerDialog title="Record access-item return" onClose={onClose}><div className="accommodation-form"><AccommodationReadError error={loan.error ?? new Error("Only the current Resources custodian can record this return.")} onRetry={() => void loan.refetch()} /><footer><button type="button" className="is-secondary" onClick={onClose}>Back</button></footer></div></PlannerDialog>;
  return <ResourceReturnDialog schoolId={schoolId} loan={loan.data} refresh={refresh} onClose={onClose} onSaved={onClose} />;
}

export function accessLoanReference(value: string): string | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, raw = value.trim();
  if (uuid.test(raw)) return raw;
  try { const url = new URL(raw, window.location.origin), id = url.searchParams.get("loan_id"); return url.origin === window.location.origin && url.pathname === "/areas/resources" && id && uuid.test(id) ? id : null; } catch { return null; }
}
