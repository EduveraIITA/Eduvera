import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";

export interface InvigilationInvitationSetup {
  school_id: string;
  policy: {
    state: "unconfigured" | "enabled" | "disabled";
    revision: number;
    enabled: boolean;
    recipient_person_ids: string[];
    response_due_minutes: number | null;
    expires_after_minutes: number | null;
    approved_at: string | null;
    approved_by: { id: string; name: string } | null;
    approval_note: string | null;
  };
  eligible_recipients: Array<{ person_id: string; user_id: string; name: string; designation: string | null }>;
  readiness: { can_create_invitations: boolean; missing_recipient_count: number };
  capabilities: { can_approve: boolean };
}

const PAGE_SIZE = 10;

function InvitationPolicyEditor({ setup, url, readOnly, onDirtyChange, onSaved }: {
  setup: InvigilationInvitationSetup;
  url: string;
  readOnly: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (next: InvigilationInvitationSetup) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(setup.policy.enabled);
  const [selected, setSelected] = useState(setup.policy.recipient_person_ids);
  const [due, setDue] = useState(setup.policy.response_due_minutes ?? 1440);
  const [expiry, setExpiry] = useState(setup.policy.expires_after_minutes ?? 4320);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const filtered = setup.eligible_recipients.filter(person => `${person.name} ${person.designation ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const unavailable = selected.filter(id => !setup.eligible_recipients.some(person => person.person_id === id));
  const changed = () => { key.current = crypto.randomUUID(); onDirtyChange(true); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || busy) return;
    setBusy(true); setError("");
    try {
      const next = await apiFetch<InvigilationInvitationSetup>(url, {
        method: "POST",
        body: JSON.stringify({ expected_revision: setup.policy.revision, enabled, recipient_person_ids: selected,
          response_due_minutes: due, expires_after_minutes: expiry, approval_note: note.trim(), idempotency_key: key.current }),
      });
      await onSaved(next);
      onDirtyChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invitation policy was not confirmed. Your edits are still here.");
    } finally { setBusy(false); }
  }
  return <form className="office-form" onSubmit={event => void submit(event)}>
    <fieldset disabled={busy || readOnly} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <label className="office-check"><input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); changed(); }} />Enable invigilation invitations for selected staff</label>
      <p className="office-hint">This permits an invitation to the exact duty you offer. Staff must still accept or decline. It does not grant attendance-recording authority or automatically accept a duty.</p>
      <label className="office-field">Find eligible staff<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search name or designation" /></label>
      <p className="office-hint" aria-live="polite">{selected.length} selected · Only active staff with a linked account can respond.</p>
      {visible.map(person => <label className="office-check" key={person.person_id}><input type="checkbox" checked={selected.includes(person.person_id)} onChange={event => {
        setSelected(current => event.target.checked ? [...current, person.person_id] : current.filter(id => id !== person.person_id)); changed();
      }} /><span>{person.name}{person.designation ? <small> · {person.designation}</small> : null}</span></label>)}
      {!visible.length ? <p className="office-hint">{search ? "No eligible staff match this search." : "Add active staff and link their accounts in People before enabling invitations."}</p> : null}
      {pages > 1 ? <nav className="office-actions" aria-label="Eligible staff pages"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous staff</button><span>Page {currentPage} of {pages} · {filtered.length} staff</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next staff</button></nav> : null}
      {unavailable.length ? <div role="alert"><p>{unavailable.length} previously selected staff are no longer eligible. Remove them before enabling invitations.</p><button type="button" onClick={() => { setSelected(current => current.filter(id => !unavailable.includes(id))); changed(); }}>Remove unavailable staff from policy</button></div> : null}
      <div className="office-form-grid">
        <label className="office-field">Response due after invitation (minutes)<input type="number" required min="1" max="10080" value={due} onChange={event => { setDue(Number(event.target.value)); changed(); }} /></label>
        <label className="office-field">Invitation expires after (minutes)<input type="number" required min={Math.max(1, due)} max="43200" value={expiry} onChange={event => { setExpiry(Number(event.target.value)); changed(); }} /></label>
      </div>
      <p className="office-hint">These are response deadlines, not automatic reminders or escalation.</p>
      <label className="office-field">Approval reason<textarea required minLength={5} maxLength={1000} value={note} onChange={event => { setNote(event.target.value); changed(); }} placeholder="Explain this institution’s invitation policy" /></label>
      <button className="office-primary" disabled={note.trim().length < 5 || enabled && (!selected.length || unavailable.length > 0) || expiry < due}>{busy ? "Saving…" : enabled ? "Approve and enable invitations" : "Approve disabled policy"}</button>
    </fieldset>
    {error ? <p role="alert" className="office-hint">{error}</p> : null}
  </form>;
}

export function InvigilationInvitationRules({ schoolId, onDirtyChange }: { schoolId: string; onDirtyChange: (dirty: boolean) => void }) {
  const environment = useOptionalExecutionEnvironment() ?? { mode: "live" as const };
  const client = useQueryClient();
  const url = `/api/v1/schools/${encodeURIComponent(schoolId)}/assessments/invigilation-invitations/`;
  const queryKey = executionEnvironmentQueryKey(environment, ["operating-rules", schoolId, "invigilation-invitations"]);
  const query = useQuery({ queryKey, queryFn: () => apiFetch<InvigilationInvitationSetup>(url), retry: false });
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState("");
  const readOnly = environment.mode === "simulation" && (environment.unavailable === true || environment.runStatus === "completed" || environment.runStatus === "stopped");
  const setup = query.data;
  return <section aria-label="Invigilation invitations">
    <h3>Invigilation invitations</h3>
    {query.isPending ? <p role="status">Loading invitation policy…</p> : query.isError || !setup ? <div role="alert"><p>The invitation policy could not be loaded.</p><button type="button" onClick={() => void query.refetch()}>Retry invitation policy</button></div> : <>
      <p className="office-hint">{setup.policy.state === "unconfigured" ? "Not set up. An administrator must explicitly approve eligible recipients before physical-exam invitations can be sent." : setup.policy.enabled ? `Enabled · ${setup.policy.recipient_person_ids.length} selected staff · Revision ${setup.policy.revision}` : `Disabled · Revision ${setup.policy.revision}`}</p>
      {setup.policy.approved_by ? <p className="office-hint">Approved by {setup.policy.approved_by.name}{setup.policy.approved_at ? ` · ${new Date(setup.policy.approved_at).toLocaleString()}` : ""}</p> : null}
      {setup.readiness.missing_recipient_count > 0 ? <p role="alert">Some selected staff are no longer eligible. Review the policy before creating invitations.</p> : null}
      {readOnly ? <p className="office-hint">This ended simulation is read-only.</p> : null}
      {setup.capabilities.can_approve ? <button type="button" className="office-secondary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Hide invitation policy" : setup.policy.state === "unconfigured" ? "Set up invitations" : "Review invitation policy"}</button> : null}
      {expanded && setup.capabilities.can_approve ? <InvitationPolicyEditor key={setup.policy.revision} setup={setup} url={url} readOnly={readOnly} onDirtyChange={onDirtyChange} onSaved={async next => {
        client.setQueryData(queryKey, next); setMessage(next.policy.enabled ? "Invigilation invitations enabled. Each duty still needs an explicit offer and response." : "Invigilation invitations disabled.");
        await client.invalidateQueries();
      }} /> : null}
      {message ? <p role="status" className="office-hint">{message}</p> : null}
    </>}
  </section>;
}
