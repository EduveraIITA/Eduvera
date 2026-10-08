import { useState } from 'react';
import type { ScheduleScreen } from './api';
export function YearForm({data,onSave}:{data:ScheduleScreen;onSave:(body:Record<string,unknown>)=>Promise<void>}) {
  const [name,setName]=useState('');
  const [source,setSource]=useState('');
  const [terms,setTerms]=useState([{name:'Term 1',starts_on:'',ends_on:''}]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  return <form className="schedule-settings__form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onSave({academic_year:name,...(source?{source_year:source}:{}),terms});}catch(cause){setError(cause instanceof Error?cause.message:'Could not prepare the year.');}finally{setBusy(false);}}}>
    <label>Academic year<input required maxLength={9} placeholder="2027–28" value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Reuse class structure<select value={source} onChange={e=>setSource(e.target.value)}><option value="">Start fresh</option>{[...new Set(data.terms.map(t=>t.academic_year))].map(y=><option key={y}>{y}</option>)}</select></label>
    <p>Reuses classes and timetable drafts for review. Students and holiday dates are not copied; nothing is published.</p>
    {terms.map((t,i)=><fieldset key={i}><legend>Term {i+1}</legend><label>Name<input required maxLength={100} value={t.name} onChange={e=>setTerms(terms.map((v,n)=>n===i?{...v,name:e.target.value}:v))}/></label><div className="schedule-settings__dates">{(['starts_on','ends_on'] as const).map(key=><label key={key}>{key==='starts_on'?'Starts':'Ends'}<input required type="date" min={data.school_date} value={t[key]} onChange={e=>setTerms(terms.map((v,n)=>n===i?{...v,[key]:e.target.value}:v))}/></label>)}</div>{i>0?<button type="button" className="is-secondary" onClick={()=>setTerms(terms.filter((_,n)=>n!==i))}>Remove term</button>:null}</fieldset>)}
    {terms.length<6?<button type="button" className="is-secondary" onClick={()=>setTerms([...terms,{name:`Term ${terms.length+1}`,starts_on:'',ends_on:''}])}>Add term</button>:null}
    {error?<p role="alert">{error}</p>:null}<button disabled={busy} type="submit">{busy?'Preparing…':'Prepare year'}</button>
  </form>;
}
