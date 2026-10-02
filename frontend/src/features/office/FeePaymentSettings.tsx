import { useState, type FormEvent } from "react";
import { saveFeePaymentSettings, type FeePaymentSettings as Settings } from "./api";
export function FeePaymentSettings({ schoolId, settings, onSaved }: { schoolId: string; settings?: Settings; onSaved: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSaved(false); const values = new FormData(event.currentTarget);
    try { await saveFeePaymentSettings(schoolId, { payee_name: values.get("payee_name"), upi_id: values.get("upi_id"), instructions: values.get("instructions"), expected_revision: settings?.revision ?? 0 }); await onSaved(); setSaved(true); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <details className="office-panel"><summary>School payment instructions</summary><form className="office-form" onSubmit={event => void submit(event)} key={settings?.revision ?? 0}>
    <p className="office-hint">Publish only the school’s verified payment details. Families see these instructions when paying. This does not enable a payment gateway.</p>
    <label className="office-field">School payee name<input name="payee_name" defaultValue={settings?.payee_name ?? ""} maxLength={120} /></label>
    <label className="office-field">School UPI ID (optional)<input name="upi_id" defaultValue={settings?.upi_id ?? ""} maxLength={160} placeholder="school@bank" /></label>
    <label className="office-field">Bank / counter payment instructions<textarea name="instructions" defaultValue={settings?.instructions ?? ""} maxLength={2000} rows={4} /></label>
    <label className="office-check"><input type="checkbox" required /> I verified these payment details with the school.</label>
    {error ? <p className="office-alert" role="alert">{error}</p> : null}{saved ? <p role="status">Payment instructions saved.</p> : null}
    <button className="office-primary" disabled={busy}>{busy ? "Saving…" : "Save payment instructions"}</button>
  </form></details>;
}
