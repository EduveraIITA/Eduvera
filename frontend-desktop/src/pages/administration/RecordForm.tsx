import { useState, type FormEvent, type ReactNode } from "react";

export interface Field { name: string; label: string; type?: string; options?: Array<{ value: string; label: string }>; optional?: boolean; min?: number; max?: number; step?: string; value?: string }

export function RecordForm({ title, fields, onSave, children, submitLabel = "Save", onCancel }: {
  title: string; fields: Field[]; onSave: (data: Record<string, string>) => Promise<void>; children?: ReactNode; submitLabel?: string; onCancel?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setBusy(true); setError(""); setSuccess(false);
    try { await onSave(Object.fromEntries(new FormData(form).entries()) as Record<string, string>); form.reset(); setSuccess(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="card ops-panel"><h2>{title}</h2><form onSubmit={(event) => void submit(event)}>
    <fieldset disabled={busy} className="ops-fieldset"><div className="ops-fields">
      {fields.map((field) => <label key={field.name}>{field.label}
        {field.options ? <select className="input" name={field.name} required={!field.optional} defaultValue={field.value ?? ""}>
          <option value="">Select…</option>{field.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select> : <input className="input" name={field.name} type={field.type ?? "text"} required={!field.optional} defaultValue={field.value ?? ""} min={field.min} max={field.max} step={field.step} autoComplete={field.type === "password" ? "new-password" : undefined} />}
      </label>)}
    </div>{children}<div className="btnrow"><button className="btn primary" type="submit">{busy ? "Saving…" : submitLabel}</button>{onCancel ? <button className="btn" type="button" onClick={onCancel}>Cancel</button> : null}</div></fieldset>
    {error ? <p className="ops-error" role="alert">{error}</p> : null}{success ? <p role="status">Saved successfully.</p> : null}
  </form></section>;
}
