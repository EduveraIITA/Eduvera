import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { PeopleBulkAddDialog } from "../people/PeopleBulkAddDialog";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { parseRupees, rupees } from "./api";
import { FeeBeneficiaryPicker } from "./FeeBeneficiaryPicker";
import { confirmFeeChargeBatch, issueFeeChargeBatch, previewFeeChargeAudience, type FeeAudiencePreview, type FeeAudienceSelection, type FeeBatchIssue, type FeeBatchResult } from "./feeBatchApi";
import { useFeeCommand } from "./useFeeCommand";

type ReviewedBatch = { issue: Omit<FeeBatchIssue, "command_id">; preview: FeeAudiencePreview };
export function FeeChargeDialog({ schoolId, today, onClose, onReload, onIssued, onBatchIssued }: {
  schoolId: string; today: string; onClose: () => void; onReload: () => Promise<unknown>; onIssued: (personId: string, invoiceId: string) => void; onBatchIssued?: (batchId: string) => void;
}) {
  const [batchId] = useState(() => crypto.randomUUID()), [selection, setSelection] = useState<FeeAudienceSelection>({ person_ids: [], groups: [] });
  const [picker, setPicker] = useState(false), [adding, setAdding] = useState(false), [reading, setReading] = useState(false);
  const [reference, setReference] = useState(""), [description, setDescription] = useState(""), [amount, setAmount] = useState(""), [due, setDue] = useState(today);
  const [preview, setPreview] = useState<FeeAudiencePreview | null>(null), [rosterPage, setRosterPage] = useState(1), [error, setError] = useState(""), [hideWriterError, setHideWriterError] = useState(false);
  const active = useRef(true), readingRef = useRef(false), ambiguous = useRef(false), retained = useRef<ReviewedBatch | null>(null), result = useRef<FeeBatchResult | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const writer = useFeeCommand(onReload, () => {
    const saved = result.current; if (!saved) return;
    if (saved.person_count === 1) onIssued(saved.invoices[0]!.person_id, saved.invoices[0]!.invoice_id);
    else if (onBatchIssued) onBatchIssued(saved.batch_id); else onClose();
  }, async commandId => {
    if (!retained.current) throw new Error("The reviewed charges are unavailable. Keep this screen to recover the result.");
    const confirmation = await confirmFeeChargeBatch(schoolId, retained.current.issue, retained.current.preview, commandId);
    if (confirmation.state === "accepted" && confirmation.result) result.current = confirmation.result;
    return confirmation;
  });
  const count = selection.person_ids.length + selection.groups.length, disabled = writer.locked || writer.obsolete || reading;
  const guard = useUnsavedChangesGuard(Boolean(count || reference || description || amount) && !writer.recovery, "Discard these unsent charges?");
  const close = () => { if (!writer.locked && !reading && guard()) onClose(); };
  const changed = () => { setPreview(null); setError(""); setHideWriterError(true); };
  const choose = (next: FeeAudienceSelection) => { if (disabled) return; setSelection(next); changed(); };
  const reviewAudience = async () => {
    if (disabled || readingRef.current || !count) return;
    readingRef.current = true; setReading(true); setError("");
    try { parseRupees(amount); const snapshot = await previewFeeChargeAudience(schoolId, selection); if (active.current) { setPreview(snapshot); setRosterPage(1); setHideWriterError(true); } }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The selected people could not be reviewed."); }
    finally { readingRef.current = false; if (active.current) setReading(false); }
  };
  const issue = async () => {
    if (!preview || disabled) return;
    try {
      const reviewed: ReviewedBatch = { issue: { batch_id: batchId, selection: { person_ids: [...selection.person_ids], groups: selection.groups.map(group => ({ ...group })) },
        snapshot_hash: preview.snapshot_hash, reference: reference.trim(), description: description.trim(), amount_paise: parseRupees(amount), due_on: due }, preview };
      retained.current = reviewed; setHideWriterError(false);
      await writer.execute(async command_id => {
        try { const accepted = await issueFeeChargeBatch(schoolId, { ...reviewed.issue, command_id }, reviewed.preview); result.current = accepted; return accepted; }
        catch (cause) {
          const code = cause instanceof ApiError && cause.details && typeof cause.details === "object" && "error" in cause.details
            && cause.details.error && typeof cause.details.error === "object" && "code" in cause.details.error ? cause.details.error.code : null;
          if (!ambiguous.current && cause instanceof ApiError && cause.status === 400 && code === "finance.charge_audience_changed" && active.current) setPreview(null);
          if (!(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500 || cause.status < 400) ambiguous.current = true;
          throw cause;
        }
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review the charges before recording them."); }
  };
  return <PlannerDialog title={preview ? "Review charges" : "Record charge"} busy={writer.locked || reading} onClose={close}>
    <form className="person-fee-form" onSubmit={event => { event.preventDefault(); void (preview ? issue() : reviewAudience()); }}>
      <fieldset disabled={disabled}>
        {preview ? <section className="person-fee-review"><h3>{description}</h3><strong className="person-fee-large">{rupees(parseRupees(amount) * preview.person_count)}</strong><p>{preview.person_count} {preview.person_count === 1 ? "person" : "people"} · {rupees(parseRupees(amount))} each · Due {due}</p>
          {preview.groups.length ? <p className="person-fee-caption">{preview.groups.map(group => group.name).join(" · ")}</p> : null}
          {preview.duplicate_count > 0 ? <p className="person-fee-caption">Overlapping selections are counted once.</p> : null}
          <details className="fee-charge-roster"><summary>People & references · {preview.person_count}</summary><ul>{preview.people.slice((rosterPage - 1) * 10, rosterPage * 10).map((person, index) => <li key={person.person_id}><strong>{person.name}</strong><small>{reference.trim()}/{String((rosterPage - 1) * 10 + index + 1).padStart(3, "0")}</small></li>)}</ul>
            {preview.person_count > 10 ? <nav className="fee-beneficiary-pages" aria-label="Reviewed people pages"><button type="button" className="is-secondary" disabled={rosterPage === 1 || disabled} onClick={() => setRosterPage(rosterPage - 1)}>Previous</button><span>Page {rosterPage} of {Math.ceil(preview.person_count / 10)}</span><button type="button" className="is-secondary" disabled={rosterPage * 10 >= preview.person_count || disabled} onClick={() => setRosterPage(rosterPage + 1)}>Next</button></nav> : null}
          </details><p className="person-fee-caption">One charge per person, not a payment. Corrections keep the original record.</p>
        </section> : <>
          <section><h3>Who is this for?</h3><button type="button" className="is-secondary fee-charge-selection" onClick={() => setPicker(true)}>{count ? `${selection.person_ids.length} ${selection.person_ids.length === 1 ? "person" : "people"} · ${selection.groups.length} ${selection.groups.length === 1 ? "group" : "groups"}` : "Choose people or groups"}</button></section>
          <label>What is the charge for?<input required maxLength={200} value={description} onChange={event => { setDescription(event.target.value); changed(); }} placeholder="e.g. Robotics workshop" /></label>
          <div className="person-fee-fields"><label>Amount per person (₹)<input required inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); changed(); }} /></label><label>Due date<TemporalInput type="date" required value={due} onChange={event => { setDue(event.target.value); changed(); }} /></label></div>
          <label>Reference<input required maxLength={74} value={reference} onChange={event => { setReference(event.target.value); changed(); }} placeholder="e.g. RV-2026-WORKSHOP" /></label>
        </>}
      </fieldset>
      {error || !hideWriterError && writer.error ? <p role="alert" className="person-fee-error">{error || writer.error}</p> : null}
      {writer.obsolete ? <button type="button" className="is-secondary" onClick={() => { ambiguous.current = false; retained.current = null; result.current = null; writer.clearObsolete(); setPreview(null); }}>Review current people</button> : null}
      <footer><button className="is-secondary" type="button" disabled={writer.locked || reading} onClick={() => preview ? setPreview(null) : close()}>{preview ? "Back" : "Cancel"}</button>{writer.recovery
        ? <button type="button" disabled={writer.busy} onClick={() => void (writer.retrySafe ? writer.retry() : writer.check())}>{writer.busy ? "Checking…" : writer.retrySafe ? "Retry same action" : "Check result"}</button>
        : <button type="submit" disabled={disabled || !count || !description.trim() || !reference.trim() || !amount || !due}>{reading ? "Reviewing…" : writer.busy ? "Recording…" : preview ? `Record ${preview.person_count === 1 ? "charge" : `${preview.person_count} charges`}` : "Review charge"}</button>}</footer>
    </form>
    {picker ? <FeeBeneficiaryPicker schoolId={schoolId} selection={selection} disabled={disabled} onChange={choose} onClose={() => setPicker(false)} onAddPeople={() => setAdding(true)} /> : null}
    {adding ? <PeopleBulkAddDialog schoolId={schoolId} onClose={() => setAdding(false)} onDone={people => { if (!active.current || disabled) return; const ids = [...new Set([...selection.person_ids, ...people.map(person => person.id)])]; setAdding(false); if (ids.length > 500) { setError("Choose up to 500 people. All added people remain in the campus directory."); return; } choose({ ...selection, person_ids: ids }); setPicker(false); }} /> : null}
  </PlannerDialog>;
}
