import type { LucideIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { SectionTitle, useToast } from "../../components/ui";

export interface Field {
  name: string; label: string; type?: string; options?: Array<{ value: string; label: string }>;
  optional?: boolean; min?: number; max?: number; step?: string; value?: string; hint?: string; wide?: boolean; placeholder?: string;
}

/* One panel = one record. Fields lay out on the form grid; anything passed as
   children (checkboxes, notes) sits between the fields and the actions. Errors
   stay inline where the person is looking; success is a toast and a reset form. */
export function RecordForm({ title, icon, fields, onSave, children, submitLabel = "Save", onCancel, aside, danger }: {
  title: string; icon?: LucideIcon; fields: Field[]; onSave: (data: Record<string, string>) => Promise<void>;
  children?: ReactNode; submitLabel?: string; onCancel?: () => void; aside?: ReactNode; danger?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError("");
    try {
      await onSave(Object.fromEntries(new FormData(form).entries()) as Record<string, string>);
      form.reset();
      toast(`${title}: saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally { setBusy(false); }
  }
  return (
    <section className="panel tight">
      <SectionTitle small icon={icon} title={title} aside={aside} />
      <form onSubmit={(event) => void submit(event)} className="col sm">
        <fieldset disabled={busy} className="plain">
          {fields.length ? (
            <div className="form-grid">
              {fields.map((field) => (
                <label key={field.name} className={`field${field.wide ? " wide" : ""}`}>
                  <span className="lbl">{field.label}{field.optional ? <span className="faint" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}> · optional</span> : null}</span>
                  {field.options ? (
                    <select className="input" name={field.name} required={!field.optional} defaultValue={field.value ?? ""}>
                      <option value="">Select…</option>
                      {field.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                    </select>
                  ) : (
                    <input className="input" name={field.name} type={field.type ?? "text"} required={!field.optional} defaultValue={field.value ?? ""}
                      min={field.min} max={field.max} step={field.step} placeholder={field.placeholder} autoComplete={field.type === "password" ? "new-password" : field.type === "email" ? "email" : "off"} />
                  )}
                  {field.hint ? <span className="t-bsm faint">{field.hint}</span> : null}
                </label>
              ))}
            </div>
          ) : null}
          {children}
          <div className="btnrow" style={{ paddingTop: 4 }}>
            <button className={`btn ${danger ? "danger" : "pri"}`} type="submit">{busy ? "Saving…" : submitLabel}</button>
            {onCancel ? <button className="btn" type="button" onClick={onCancel}>Cancel</button> : null}
            {error ? <span className="t-bsm cri-c" role="alert" style={{ flex: "1 1 240px" }}>{error}</span> : null}
          </div>
        </fieldset>
      </form>
    </section>
  );
}
