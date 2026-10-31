import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { invoicePersonLabel, parseRupees, type Invoice } from "./api";
import { ChargeCorrectionFields, type ChargeCorrectionDraft } from "./FeeCorrectionFields";
import { FeeCorrectionRecipients } from "./FeeCorrectionRecipients";
import { ChargeCorrectionReview } from "./FeeCorrectionReview";
import { applyChargeCorrection, confirmChargeCorrection, previewChargeCorrection, type ChargeCorrectionApply, type ChargeCorrectionChange, type ChargeCorrectionQuote } from "./feeCorrectionsApi";
import type { PersonFeeInvoice } from "./personFeesApi";
import { useFeeCommand } from "./useFeeCommand";

export function FeeChargeCorrectionDialog({ schoolId, invoices, batchId, onClose, onReload }: {
  schoolId: string; invoices: Array<Invoice | PersonFeeInvoice>; batchId?: string; onClose: () => void; onReload: () => Promise<unknown>;
}) {
  const environment = useExecutionEnvironment(), readOnly = environment.mode === "simulation" && (environment.unavailable || ["stopped", "completed"].includes(environment.runStatus ?? ""));
  const [initialSelection] = useState(() => invoices.length === 1 && invoices[0]!.can_correct === true ? [invoices[0]!.id] : []);
  const [correctionId] = useState(() => crypto.randomUUID()), [selected, setSelected] = useState(initialSelection);
  const [draft, setDraft] = useState<ChargeCorrectionDraft>({ kind: "amend", amount: "", description: "", due: "" }), [reason, setReason] = useState(""), [attested, setAttested] = useState(false);
  const [quote, setQuote] = useState<ChargeCorrectionQuote | null>(null), [reading, setReading] = useState(false), [error, setError] = useState("");
  const active = useRef(true), readingRef = useRef(false), ambiguous = useRef(false), retained = useRef<Omit<ChargeCorrectionApply, "command_id"> | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const writer = useFeeCommand(onReload, onClose, commandId => { if (!retained.current) throw new Error("Keep this screen to recover the correction."); return confirmChargeCorrection(schoolId, retained.current, commandId); });
  const disabled = writer.locked || writer.obsolete || reading || readOnly;
  const selectionChanged = selected.length !== initialSelection.length || initialSelection.some(id => !selected.includes(id));
  const guard = useUnsavedChangesGuard(Boolean(selectionChanged || reason || draft.kind !== "amend" || draft.amount || draft.description || draft.due) && !writer.recovery, "Discard this unsent correction?");
  const close = () => { if (!writer.locked && !reading && guard()) onClose(); };
  const change = (): ChargeCorrectionChange => draft.kind === "cancel" ? { kind: "cancel" } : { kind: "amend", ...(draft.amount.trim() ? { amount_paise: parseRupees(draft.amount) } : {}), ...(draft.description.trim() ? { description: draft.description.trim() } : {}), ...(draft.due ? { due_on: draft.due } : {}) };
  const review = async () => {
    if (disabled || readingRef.current) return; readingRef.current = true; setReading(true); setError("");
    try { const input = { selection: { invoice_ids: [...selected].sort(), ...(batchId ? { batch_id: batchId } : {}) }, change: change() }; const next = await previewChargeCorrection(schoolId, input); if (active.current) { setQuote(next); setAttested(false); } }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The correction could not be reviewed."); }
    finally { readingRef.current = false; if (active.current) setReading(false); }
  };
  const submit = () => {
    if (disabled || !quote || !attested) return;
    const input: Omit<ChargeCorrectionApply, "command_id"> = { correction_id: correctionId, selection: { invoice_ids: [...selected].sort(), ...(batchId ? { batch_id: batchId } : {}) }, change: change(), snapshot_hash: quote.snapshot_hash, reason: reason.trim(), attested_recording_error: true };
    retained.current = input; setError("");
    void writer.execute(async command_id => {
      try { return await applyChargeCorrection(schoolId, { ...input, command_id }); }
      catch (cause) { if (!ambiguous.current && cause instanceof ApiError && cause.status === 400 && active.current) setQuote(null); if (!(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500 || cause.status < 400) ambiguous.current = true; throw cause; }
    });
  };
  return <PlannerDialog title={quote ? "Review correction" : invoices.length === 1 ? "Correct charge" : "Correct charges"} busy={writer.locked || reading} onClose={close}>
    <form className="person-fee-form" onSubmit={event => { event.preventDefault(); if (quote) submit(); else void review(); }}>
      <fieldset disabled={disabled}>{quote ? <><ChargeCorrectionReview quote={quote} /><p>{reason}</p><label className="person-fee-check"><input type="checkbox" required checked={attested} onChange={event => setAttested(event.target.checked)} /><span>This corrects a recording error, not a concession or waiver.</span></label></> : <>
        {invoices.length === 1 ? <p className="person-fee-caption">{invoicePersonLabel(invoices[0]!)} · {invoices[0]!.reference}</p> : <FeeCorrectionRecipients invoices={invoices} selected={selected} onChange={setSelected} />}
        <ChargeCorrectionFields value={draft} onChange={setDraft} /><label>Reason<textarea required minLength={3} maxLength={1000} rows={3} value={reason} onChange={event => { setReason(event.target.value); setError(""); }} /></label>
      </>}</fieldset>
      {error || writer.error ? <p role="alert" className="person-fee-error">{error || writer.error}</p> : null}
      {writer.obsolete ? <button className="is-secondary" type="button" onClick={() => { ambiguous.current = false; retained.current = null; setQuote(null); setAttested(false); writer.clearObsolete(); }}>Review current charges</button> : null}
      <footer><button type="button" className="is-secondary" disabled={writer.locked || reading} onClick={() => quote ? setQuote(null) : close()}>{quote ? "Back" : "Cancel"}</button>{writer.recovery ? <button type="button" disabled={writer.busy || writer.retrySafe && readOnly} onClick={() => void (writer.retrySafe ? writer.retry() : writer.check())}>{writer.busy ? "Checking…" : writer.retrySafe ? "Retry same action" : "Check result"}</button>
        : <button type="submit" disabled={disabled || !selected.length || reason.trim().length < 3 || (quote ? !attested : draft.kind === "amend" && !draft.amount.trim() && !draft.description.trim() && !draft.due)}>{reading ? "Reviewing…" : quote ? "Record correction" : "Review correction"}</button>}</footer>
    </form>
  </PlannerDialog>;
}
