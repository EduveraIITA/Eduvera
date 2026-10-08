import {useState,type FormEvent} from "react";
import {Download,Upload} from "lucide-react";
import type {EnrollmentOption} from "./api";
import {importTemplateUrl,stageImport} from "./import-api";
export function ImportUpload({schoolId,options,onUploaded,onCancel}:{schoolId:string;options:EnrollmentOption[];onUploaded:(id:string)=>void;onCancel?:()=>void}){
  const terms=[...new Map(options.map(o=>[o.term_id,o])).values()];
  const [term,setTerm]=useState(terms[0]?.term_id??"");const [csv,setCsv]=useState("");const [filename,setFilename]=useState("student-enrollment.csv");
  const [key,setKey]=useState(()=>crypto.randomUUID());const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function filePicked(file:File|undefined){if(!file)return;setError("");if(file.size>512*1024){setError("Choose a CSV file of 512 KB or smaller.");return;}if(!/\.csv$/i.test(file.name)){setError("Save your spreadsheet as a UTF-8 CSV file first.");return;}
    try{setCsv(await file.text());setFilename(file.name);setKey(crypto.randomUUID());}catch{setError("The file could not be read. Choose it again.");}}
  async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");try{const result=await stageImport({school_id:schoolId,term_id:term,filename,csv,idempotency_key:key});onUploaded(result.id);}catch(e){setError(e instanceof Error?e.message:"The file could not be uploaded.");}finally{setBusy(false);}}
  return <section className="people-panel"><header className="import-toolbar"><p className="people-muted">Upload, review, then confirm enrollment.</p><a className="people-secondary" href={importTemplateUrl(schoolId)} download><Download size={17}/>CSV template</a></header>
    <div className="import-guidance"><h3>Before you upload</h3><ul><li>Use one row per student and their primary guardian. Up to 500 students per file.</li><li>Use dates as YYYY-MM-DD and class labels such as 7A.</li><li>Give siblings the same <strong>guardian_key</strong> only when they share the same verified guardian. Names and phone numbers never merge people automatically.</li><li>No login accounts, leave-signing permissions or attendance marks are created.</li></ul></div>
    <form className="people-form" onSubmit={e=>void submit(e)}>
      <label>Academic term<select required value={term} disabled={busy} onChange={e=>{setTerm(e.target.value);setKey(crypto.randomUUID());}}>{terms.map(t=><option key={t.term_id} value={t.term_id}>{t.term_name} · {t.starts_on} to {t.ends_on}</option>)}</select></label>
      <p className="people-muted">Available classes: {options.filter(o=>o.term_id===term).map(o=>o.class_name.replace(/^Class /,"")).join(", ")||"None"}</p>
      <label className="import-file"><span><Upload size={20}/>Choose a CSV file</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>void filePicked(e.target.files?.[0])}/><small>UTF-8 CSV · maximum 512 KB</small></label>
      <details><summary className="import-paste-summary">Or paste CSV data</summary><label>CSV data<textarea rows={7} spellCheck={false} value={csv} disabled={busy} maxLength={512*1024} onChange={e=>{setCsv(e.target.value);setFilename("pasted-enrollment.csv");setKey(crypto.randomUUID());}}/></label></details>
      {csv?<p role="status" className="people-muted">Ready to check: {filename}</p>:null}
      {error?<p role="alert" className="people-error">{error}</p>:null}
      <footer className="import-actions"><span className="people-muted">Nothing is enrolled at this step. Drafts expire after 24 hours.</span>{onCancel?<button type="button" className="people-secondary" disabled={busy} onClick={onCancel}>Cancel</button>:null}<button className="people-primary" disabled={busy||!csv.trim()||!term}>{busy?"Checking file…":"Upload & review"}</button></footer>
    </form>
  </section>;
}
