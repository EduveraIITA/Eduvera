import { TemporalInput } from "../../components/forms/TemporalInput";

export interface ChargeCorrectionDraft { kind: "amend" | "cancel"; amount: string; description: string; due: string }
export interface ReceiptCorrectionDraft { action: "reverse" | "replace"; amount: string; method: "cash" | "bank_transfer" | "cheque"; reference: string }

export function ChargeCorrectionFields({ value, onChange }: { value: ChargeCorrectionDraft; onChange: (value: ChargeCorrectionDraft) => void }) {
  return <>
    <label>Correction<select value={value.kind} onChange={event => onChange({ ...value, kind: event.target.value as ChargeCorrectionDraft["kind"] })}><option value="amend">Correct charge details</option><option value="cancel">Cancel charge</option></select></label>
    {value.kind === "amend" ? <>
      <p className="person-fee-caption">Leave unchanged fields blank.</p>
      <div className="person-fee-fields"><label>Correct amount (₹)<input inputMode="decimal" value={value.amount} onChange={event => onChange({ ...value, amount: event.target.value })} /></label><label>Due date<TemporalInput type="date" value={value.due} onChange={event => onChange({ ...value, due: event.target.value })} /></label></div>
      <label>Description<input maxLength={200} value={value.description} onChange={event => onChange({ ...value, description: event.target.value })} /></label>
    </> : <p>The selected charges will be cancelled. Recorded payments remain separate.</p>}
  </>;
}

export function ReceiptCorrectionFields({ value, onChange, canReverse, canReplace }: { value: ReceiptCorrectionDraft; onChange: (value: ReceiptCorrectionDraft) => void; canReverse: boolean; canReplace: boolean }) {
  return <>
    <label>Correction<select value={value.action} onChange={event => onChange({ ...value, action: event.target.value as ReceiptCorrectionDraft["action"] })}><option value="reverse" disabled={!canReverse}>Reverse receipt</option><option value="replace" disabled={!canReplace}>Reverse and replace</option></select></label>
    {value.action === "replace" ? <>
      <div className="person-fee-fields"><label>Verified amount (₹)<input required inputMode="decimal" value={value.amount} onChange={event => onChange({ ...value, amount: event.target.value })} /></label><label>Method<select value={value.method} onChange={event => onChange({ ...value, method: event.target.value as ReceiptCorrectionDraft["method"] })}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option></select></label></div>
      <label>Payment reference<input required maxLength={120} value={value.reference} onChange={event => onChange({ ...value, reference: event.target.value })} /></label>
    </> : null}
    <p className="person-fee-caption">This corrects a recorded receipt. It does not refund or transfer money.</p>
  </>;
}
