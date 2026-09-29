import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, CheckCircle2, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { schoolDateToday } from "../../lib/schoolTime";
import { getEventConsentAuthorities, grantEventConsentAuthority, revokeEventConsentAuthority } from "./api";
import type { ConsentAuthorityRecord } from "./types";

export function ConsentAuthorityDialog({ schoolId, studentId, studentName, onClose, onChanged }: { schoolId: string; studentId: string; studentName: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["campus-event-consent-authorities", studentId], queryFn: () => getEventConsentAuthorities(schoolId, studentId) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [validFrom, setValidFrom] = useState(schoolDateToday());
  const [validUntil, setValidUntil] = useState("");
  const [provenance, setProvenance] = useState("");
  const [verified, setVerified] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const selected = query.data?.items.find((item) => item.relationship_id === selectedId) ?? query.data?.items[0];

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ["campus-event-consent-authorities", studentId] });
    await onChanged();
    await query.refetch();
  };
  const grant = async (authority: ConsentAuthorityRecord) => {
    if (!verified || provenance.trim().length < 3) return;
    setBusy(true); setMessage("");
    try {
      await grantEventConsentAuthority(schoolId, authority.relationship_id, { expected_revision: authority.revision ?? 0, valid_from: validFrom, valid_until: validUntil || null, provenance: provenance.trim() });
      await reload();
      setMessageTone("success");
      setMessage("Event-consent authority recorded with its review evidence.");
      setVerified(false); setProvenance("");
    } catch (error) { setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Authority could not be recorded."); }
    finally { setBusy(false); }
  };
  const revoke = async (authority: ConsentAuthorityRecord) => {
    if (!authority.revision || revokeReason.trim().length < 3) return;
    setBusy(true); setMessage("");
    try {
      await revokeEventConsentAuthority(schoolId, authority.relationship_id, authority.revision, revokeReason.trim());
      await reload();
      setMessageTone("success");
      setMessage("Event-consent authority revoked. Existing event decisions remain auditable.");
      setRevokeReason("");
    } catch (error) { setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Authority could not be revoked."); }
    finally { setBusy(false); }
  };

  return (
    <div className="campus-event-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="campus-authority-dialog" role="dialog" aria-modal="true" aria-labelledby="authority-heading" onClick={(event) => event.stopPropagation()}>
        <header><span><ShieldCheck size={20} /></span><div><small>Purpose-specific safeguard</small><h2 id="authority-heading">Event consent authority</h2><p>Review who may legally record event consent for {studentName}.</p></div><button type="button" onClick={onClose} aria-label="Close authority review"><X size={19} /></button></header>
        {query.isPending ? <div className="campus-authority-loading" role="status">Loading guardian relationships...</div> : query.isError ? <p className="campus-event-form-error" role="alert">{query.error.message}</p> : query.data.items.length === 0 ? <p className="campus-event-inline-empty">No active guardian relationship is linked to this student.</p> : (
          <div className="campus-authority-layout">
            <div className="campus-authority-list" role="listbox" aria-label="Guardian relationships">
              {query.data.items.map((item) => <button key={item.relationship_id} type="button" role="option" aria-selected={selected?.relationship_id === item.relationship_id} className={selected?.relationship_id === item.relationship_id ? "is-selected" : ""} onClick={() => setSelectedId(item.relationship_id)}><span>{item.guardian_name}</span><small>{item.effective ? <><CheckCircle2 size={12} />Active for event consent</> : item.status === "revoked" ? "Revoked" : item.id ? "Expired" : "Not granted"}</small></button>)}
            </div>
            {selected ? <div className="campus-authority-review">
              <div className="campus-authority-current"><CalendarCheck2 size={18} /><div><strong>{selected.effective ? "Authority is effective" : "Review required"}</strong><p>{selected.effective ? `${selected.valid_from} to ${selected.valid_until || "no fixed end date"}` : "Primary guardian and leave authority do not automatically grant event-consent authority."}</p>{selected.provenance ? <small>Evidence: {selected.provenance}</small> : null}</div></div>
              {!selected.effective ? <div className="campus-authority-form"><label>Effective from<input type="date" min={schoolDateToday()} value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label><label>Effective until <small>(optional)</small><input type="date" min={validFrom} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label><label className="is-wide">Verification evidence<textarea rows={3} value={provenance} onChange={(event) => setProvenance(event.target.value)} placeholder="Policy record, signed authorization, and reviewer reference" /></label><label className="campus-authority-verify"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} /><span>I verified this authority against the school-approved source.</span></label><button className="campus-event-primary" type="button" disabled={busy || !verified || provenance.trim().length < 3} onClick={() => void grant(selected)}>Grant event-consent authority</button></div> : <div className="campus-authority-revoke"><label>Revocation reason<textarea rows={2} value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} placeholder="Reason for ending this authority" /></label><button className="campus-event-danger" type="button" disabled={busy || revokeReason.trim().length < 3} onClick={() => void revoke(selected)}>Revoke authority</button></div>}
            </div> : null}
          </div>
        )}
        {message ? <p className={`campus-event-action-message${messageTone === "error" ? " is-error" : ""}`} role={messageTone === "error" ? "alert" : "status"}>{message}</p> : null}
      </section>
    </div>
  );
}
