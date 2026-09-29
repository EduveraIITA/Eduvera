import { useState } from "react";
import { type Administration, save } from "../../features/administration";
import { RecordForm } from "./RecordForm";

export function Imports({ school, data, refresh }: { school: string; data: Administration; refresh: () => Promise<void> }) {
  const [csv, setCsv] = useState(""); const [preview, setPreview] = useState<{ count: number } | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [rollover, setRollover] = useState<{ source_term_id: string; target_term_id: string; mappings: Array<{ from_class_id: string; to_class_id: string }>; count: number } | null>(null);
  async function importCsv(confirm: boolean) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await save<{ count: number }>(school, "student-import", { csv, confirm });
      if (confirm) { setPreview(null); setMessage(`${result.count} students imported.`); await refresh(); }
      else setPreview(result);
    } catch (err) { setPreview(null); setError((err as Error).message); } finally { setBusy(false); }
  }
  return <div className="ops-stack"><section className="card ops-panel"><h2>Import students</h2><p>Up to 200 students per import. All rows are validated before anything is saved.</p>
    <p className="ops-code">email,first_name,last_name,admission_number,class_section_id,term_id,roll_number,date_of_birth</p>
    <label>Upload CSV<input className="input" type="file" accept=".csv,text/csv" disabled={busy} onChange={async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      if (file.size > 250_000) { setError("CSV must be smaller than 250 KB."); return; }
      setCsv(await file.text()); setPreview(null); setError("");
    }} /></label>
    <label>CSV contents<textarea className="input ops-csv" value={csv} disabled={busy} onChange={(event) => { setCsv(event.target.value); setPreview(null); setMessage(""); }} /></label>
    <div className="btnrow"><button className="btn" disabled={busy || !csv} onClick={() => void importCsv(false)}>Validate import</button>{preview ? <button className="btn primary" disabled={busy} onClick={() => void importCsv(true)}>Confirm {preview.count} students</button> : null}</div>
    {error ? <p className="ops-error" role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    <details><summary>Class and term IDs for your CSV</summary>{data.classes.map((item) => <p key={item.id}>{item.grade} {item.section} ({item.academic_year}): <code>{item.id}</code></p>)}{data.terms.map((item) => <p key={item.id}>{item.name} ({item.academic_year}): <code>{item.id}</code></p>)}</details>
  </section>
    <RecordForm title="Preview class promotion" submitLabel="Preview promotion" fields={[
      { name: "source_term_id", label: "Source term", options: data.terms.map((item) => ({ value: item.id, label: `${item.name} · ${item.academic_year}` })) },
      { name: "target_term_id", label: "Target term", options: data.terms.map((item) => ({ value: item.id, label: `${item.name} · ${item.academic_year}` })) },
      { name: "from_class_id", label: "From class", options: data.classes.map((item) => ({ value: item.id, label: `${item.grade} ${item.section} · ${item.academic_year}` })) },
      { name: "to_class_id", label: "To class", options: data.classes.map((item) => ({ value: item.id, label: `${item.grade} ${item.section} · ${item.academic_year}` })) },
    ]} onSave={async (values) => {
      setRollover(null);
      const body = { source_term_id: values.source_term_id!, target_term_id: values.target_term_id!, mappings: [{ from_class_id: values.from_class_id!, to_class_id: values.to_class_id! }] };
      const result = await save<{ count: number }>(school, "rollover", body); setRollover({ ...body, count: result.count });
    }}><p className="muted">Adds new-term enrollments and preserves history. Overlapping rolls and existing target enrollments block the whole operation.</p></RecordForm>
    {rollover ? <RecordForm key={JSON.stringify(rollover)} title={`Confirm promotion of ${rollover.count} students`} fields={[]} submitLabel="Confirm promotion" onSave={async () => { await save(school, "rollover", { ...rollover, confirm: true }); setRollover(null); await refresh(); }} onCancel={() => setRollover(null)}>
      <p>{data.classes.find((item) => item.id === rollover.mappings[0]?.from_class_id)?.grade} → {data.classes.find((item) => item.id === rollover.mappings[0]?.to_class_id)?.grade}; target: {data.terms.find((item) => item.id === rollover.target_term_id)?.name}</p>
      <label className="ops-check"><input type="checkbox" required />I have reviewed the target class and term.</label>
    </RecordForm> : null}
  </div>;
}
