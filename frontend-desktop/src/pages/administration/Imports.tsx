import { ArrowRight, CheckCircle2, FileSpreadsheet, Info, Repeat, Upload } from "lucide-react";
import { useState } from "react";
import { Pill, SectionTitle, useToast } from "../../components/ui";
import { type Administration, save } from "../../features/administration";
import { RecordForm } from "./RecordForm";

const HEADER = "email,first_name,last_name,admission_number,class_section_id,term_id,roll_number,date_of_birth";

/* Import & promotion: both are two-step — validate, then confirm — so nothing
   half-applies. Class and term IDs are shown because the CSV needs them. */
export function Imports({ school, data, refresh }: { school: string; data: Administration; refresh: () => Promise<void> }) {
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{ count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rollover, setRollover] = useState<{ source_term_id: string; target_term_id: string; mappings: Array<{ from_class_id: string; to_class_id: string }>; count: number } | null>(null);
  const termLabel = (id: string) => { const t = data.terms.find((x) => x.id === id); return t ? `${t.name} · ${t.academic_year}` : id; };
  const classLabel = (id: string) => { const c = data.classes.find((x) => x.id === id); return c ? `Class ${c.grade}${c.section} · ${c.academic_year}` : id; };
  const termOptions = data.terms.map((item) => ({ value: item.id, label: termLabel(item.id) }));
  const classOptions = data.classes.map((item) => ({ value: item.id, label: classLabel(item.id) }));

  async function importCsv(confirm: boolean) {
    setBusy(true); setError("");
    try {
      const result = await save<{ count: number }>(school, "student-import", { csv, confirm });
      if (confirm) { setPreview(null); setCsv(""); toast(`${result.count} students imported.`); await refresh(); }
      else setPreview(result);
    } catch (err) { setPreview(null); setError((err as Error).message); } finally { setBusy(false); }
  }
  async function copyHeader() { try { await navigator.clipboard.writeText(HEADER); toast("Header row copied."); } catch { toast("Copy failed.", true); } }
  const lines = csv.trim() ? Math.max(0, csv.trim().split(/\r?\n/).length - 1) : 0;

  return (
    <div className="col">
      <div className="grid12">
        <div className="col-7 panel tight">
          <SectionTitle small icon={Upload} title="Import students" aside={lines > 0 ? <Pill kind="soft">{lines} row{lines === 1 ? "" : "s"}</Pill> : null} />
          <p className="t-bsm ink2">Up to 200 students per file. Every row is validated before anything is saved; one bad row rejects the whole file.</p>
          <div className="col xs">
            <span className="lbl">Required header</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><div className="code-box" style={{ flex: 1 }}>{HEADER}</div><button className="btn sm" onClick={() => void copyHeader()}>Copy</button></div>
          </div>
          <div className="form-grid">
            <label className="field"><span className="lbl">Upload CSV</span><input className="input" type="file" accept=".csv,text/csv" disabled={busy} onChange={async (event) => {
              const file = event.target.files?.[0]; if (!file) return;
              if (file.size > 250_000) { setError("CSV must be smaller than 250 KB."); return; }
              setCsv(await file.text()); setPreview(null); setError("");
            }} /></label>
          </div>
          <label className="field"><span className="lbl">Or paste the rows</span><textarea className="input mono-area" value={csv} disabled={busy} placeholder={`${HEADER}\naarav@example.com,Aarav,Sharma,CIS-2026-0101,<class id>,<term id>,17,2013-04-02`} onChange={(event) => { setCsv(event.target.value); setPreview(null); }} /></label>
          {preview ? <div className="callout pos"><CheckCircle2 size={18} color="var(--pos)" style={{ flexShrink: 0, marginTop: 1 }} /><span className="t-bsm">All rows valid: <b>{preview.count} students</b> will be created and enrolled. Confirm to apply.</span></div> : null}
          {error ? <div className="callout cri"><Info size={18} color="var(--cri)" style={{ flexShrink: 0, marginTop: 1 }} /><span className="t-bsm" role="alert">{error}</span></div> : null}
          <div className="btnrow">
            <button className="btn" disabled={busy || !csv.trim()} onClick={() => void importCsv(false)}>{busy && !preview ? "Validating…" : "Validate"}</button>
            {preview ? <button className="btn pri" disabled={busy} onClick={() => void importCsv(true)}>Import {preview.count} students<ArrowRight size={16} /></button> : null}
          </div>
        </div>
        <div className="col-5 card">
          <div className="card-h"><b><FileSpreadsheet size={18} />IDs for your CSV</b></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Record</th><th>ID</th></tr></thead>
            <tbody>
              {data.terms.map((t) => <tr key={t.id}><td><div className="rowtxt"><b>{t.name}</b><span>Term · {t.academic_year}</span></div></td><td className="mono" style={{ fontSize: 11.5 }}>{t.id}</td></tr>)}
              {data.classes.map((c) => <tr key={c.id}><td><div className="rowtxt"><b>Class {c.grade}{c.section}</b><span>Class · {c.academic_year}</span></div></td><td className="mono" style={{ fontSize: 11.5 }}>{c.id}</td></tr>)}
            </tbody>
          </table></div>
        </div>
      </div>

      <div className="grid12">
        <div className="col-7">
          <RecordForm icon={Repeat} title="Promote a class to the next term" submitLabel="Preview promotion" fields={[
            { name: "source_term_id", label: "From term", options: termOptions }, { name: "target_term_id", label: "To term", options: termOptions },
            { name: "from_class_id", label: "From class", options: classOptions }, { name: "to_class_id", label: "To class", options: classOptions },
          ]} onSave={async (values) => {
            setRollover(null);
            const body = { source_term_id: values.source_term_id!, target_term_id: values.target_term_id!, mappings: [{ from_class_id: values.from_class_id!, to_class_id: values.to_class_id! }] };
            const result = await save<{ count: number }>(school, "rollover", body);
            setRollover({ ...body, count: result.count });
          }}>
            <p className="t-bsm ink2">Adds enrolments in the target term and keeps history. Overlapping roll numbers or existing target enrolments block the whole operation.</p>
          </RecordForm>
        </div>
        <div className="col-5">
          {rollover ? (
            <RecordForm key={JSON.stringify(rollover)} icon={CheckCircle2} title={`Confirm: ${rollover.count} students`} fields={[]} submitLabel="Confirm promotion" onCancel={() => setRollover(null)}
              onSave={async () => { await save(school, "rollover", { ...rollover, confirm: true }); setRollover(null); await refresh(); }}>
              <dl className="kv">
                <dt>Class</dt><dd>{classLabel(rollover.mappings[0]!.from_class_id)} → {classLabel(rollover.mappings[0]!.to_class_id)}</dd>
                <dt>Term</dt><dd>{termLabel(rollover.source_term_id)} → {termLabel(rollover.target_term_id)}</dd>
              </dl>
              <label className="check"><input type="checkbox" required /><span>I have reviewed the target class and term.</span></label>
            </RecordForm>
          ) : (
            <div className="panel tight"><SectionTitle small icon={Info} title="How promotion works" /><p className="t-bsm ink2">Preview first: it counts the students who would move and checks for clashes without changing anything. The confirmation appears here.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
