import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { parseRupees, type Payment } from "./api";
import { ReceiptCorrectionFields, type ReceiptCorrectionDraft } from "./FeeCorrectionFields";
import { PaymentCorrectionReview } from "./FeeCorrectionReview";
import { applyPaymentCorrection, confirmPaymentCorrection, previewPaymentCorrection, type PaymentCorrectionRetained, type PaymentCorrectionPreviewInput, type PaymentCorrectionQuote } from "./feeCorrectionsApi";
import { useFeeCommand } from "./useFeeCommand";

export function FeePaymentCorrectionDialog({ schoolId, payment, onClose, onReload }: { schoolId: string; payment: Payment; onClose: () => void; onReload: () => Promise<unknown> }) {
  const environment = useExecutionEnvironment(), readOnly = environment.mode === "simulation" && (environment.unavailable || ["stopped", "completed"].includes(environment.runStatus ?? ""));
  const [correctionId] = useState(() => crypto.randomUUID()), [draft, setDraft] = useState<ReceiptCorrectionDraft>({ action: payment.can_reverse === true ? "reverse" : "replace", amount: (payment.amount_paise / 100).toFixed(2), method: ["cash", "bank_transfer", "cheque"].includes(payment.method) ? payment.method as ReceiptCorrectionDraft["method"] : "bank_transfer", reference: "" });
  const [reason, setReason] = useState(""), [attested, setAttested] = useState(false), [verified, setVerified] = useState(false);
  const [preview, setPreview] = useState<{ quote: PaymentCorrectionQuote; input: PaymentCorrectionPreviewInput } | null>(null), [reading, setReading] = useState(false), [error, setError] = useState("");
  const active = useRef(true), readingRef = useRef(false), ambiguous = useRef(false), retained = useRef<{ input: PaymentCorrectionRetained; quote: PaymentCorrectionQuote } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const writer = useFeeCommand(onReload, onClose, commandId => { if (!retained.current) throw new Error("Keep this screen to recover the receipt correction."); return confirmPaymentCorrection(schoolId, retained.current.input, retained.current.quote, commandId); });
  const disabled = writer.locked || writer.obsolete || reading || readOnly;
  const guard = useUnsavedChangesGuard(Boolean(reason) && !writer.recovery, "Discard this unsent receipt correction?");
  const close = () => { if (!writer.locked && !reading && guard()) onClose(); };
  const review = async () => {
    if (disabled || readingRef.current) return; readingRef.current = true; setReading(true); setError("");
    try { const input: PaymentCorrectionPreviewInput = draft.action === "reverse" ? { action: "reverse" } : { action: "replace", replacement: { amount_paise: parseRupees(draft.amount), method: draft.method, reference: draft.reference.trim() } };
      const quote = await previewPaymentCorrection(schoolId, payment.id, payment.invoice_id, input); if (active.current) { setPreview({ input, quote }); setAttested(false); setVerified(false); } }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The receipt correction could not be reviewed."); }
    finally { readingRef.current = false; if (active.current) setReading(false); }
  };
  const submit = () => {
    if (disabled || !preview || !attested || preview.input.action === "replace" && !verified) return;
    const common = { correction_id: correctionId, snapshot_hash: preview.quote.snapshot_hash, reason: reason.trim(), attested_recording_error: true as const };
    const input: PaymentCorrectionRetained = preview.input.action === "reverse" ? { ...common, action: "reverse" } : { ...common, ...preview.input, verified_funds: true };
    retained.current = { input, quote: preview.quote }; setError("");
    void writer.execute(async command_id => {
      try { return await applyPaymentCorrection(schoolId, { ...input, command_id }, preview.quote); }
      catch (cause) { if (!ambiguous.current && cause instanceof ApiError && cause.status === 400 && active.current) setPreview(null); if (!(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500 || cause.status < 400) ambiguous.current = true; throw cause; }
    });
  };
  return <PlannerDialog title={preview ? "Review receipt correction" : "Correct receipt"} busy={writer.locked || reading} onClose={close}>
    <form className="person-fee-form" onSubmit={event => { event.preventDefault(); if (preview) submit(); else void review(); }}><fieldset disabled={disabled}>{preview ? <>
      <PaymentCorrectionReview quote={preview.quote} input={preview.input} /><p>{reason}</p><label className="person-fee-check"><input type="checkbox" required checked={attested} onChange={event => setAttested(event.target.checked)} /><span>This corrects a recording error, not a refund or transfer.</span></label>
      {preview.input.action === "replace" ? <label className="person-fee-check"><input type="checkbox" required checked={verified} onChange={event => setVerified(event.target.checked)} /><span>I independently verified the replacement funds. Any cheque has cleared.</span></label> : null}
    </> : <><p className="person-fee-caption">{payment.reference}</p><ReceiptCorrectionFields value={draft} canReverse={payment.can_reverse === true} canReplace={payment.can_replace === true} onChange={value => { setDraft(value); setError(""); }} /><label>Reason<textarea required minLength={3} maxLength={1000} rows={3} value={reason} onChange={event => { setReason(event.target.value); setError(""); }} /></label></>}</fieldset>
      {error || writer.error ? <p role="alert" className="person-fee-error">{error || writer.error}</p> : null}
      {writer.obsolete ? <button className="is-secondary" type="button" onClick={() => { ambiguous.current = false; retained.current = null; setPreview(null); setAttested(false); setVerified(false); writer.clearObsolete(); }}>Review current receipt</button> : null}
      <footer><button className="is-secondary" type="button" disabled={writer.locked || reading} onClick={() => preview ? setPreview(null) : close()}>{preview ? "Back" : "Cancel"}</button>{writer.recovery ? <button type="button" disabled={writer.busy || writer.retrySafe && readOnly} onClick={() => void (writer.retrySafe ? writer.retry() : writer.check())}>{writer.busy ? "Checking…" : writer.retrySafe ? "Retry same action" : "Check result"}</button>
        : <button type="submit" disabled={disabled || reason.trim().length < 3 || (preview ? !attested || preview.input.action === "replace" && !verified : draft.action === "replace" && (!draft.amount || draft.reference.trim().length < 3))}>{reading ? "Reviewing…" : preview ? "Record correction" : "Review correction"}</button>}</footer>
    </form>
  </PlannerDialog>;
}
