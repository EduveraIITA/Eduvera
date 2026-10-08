import { useState, type FormEvent } from 'react';
import { createCampaign, type Workspace } from './api';
export function CreateFeedback({school,data,onCreated,onCancel}:{school:string;data:Workspace;onCreated:()=>Promise<void>;onCancel:()=>void}) {
  const [parameters,setParameters]=useState(data.default_parameters.slice(0,5));
  const [custom,setCustom]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [audience,setAudience]=useState('students');
  const choices=[...new Set([...data.default_parameters,...parameters])];
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;setError('');const form=new FormData(event.currentTarget);const field=(key:string)=>{const value=form.get(key);return typeof value==='string'?value:'';};
    if(!parameters.length){setError('Choose at least one parameter.');return;}setBusy(true);
    try {await createCampaign(school,{title:field('title'),teacher_user_id:field('teacher'),class_section_id:field('class'),audience,
      parameters,closes_at:new Date(field('deadline')).toISOString()});await onCreated();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}
  }
  return <form className="teacher-feedback__card teacher-feedback__form" onSubmit={event=>void submit(event)}>
    <h2>Ask for quick feedback</h2><p>Choose the teacher, class and the things you want to understand.</p>
    <label>Title<input name="title" required minLength={3} maxLength={120} defaultValue="A quick check-in on teaching"/></label>
    <div className="teacher-feedback__grid"><label>Teacher<select name="teacher" required defaultValue=""><option value="" disabled>Select teacher</option>{data.teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Class<select name="class" required defaultValue=""><option value="" disabled>Select class</option>{data.classes.map(c=><option key={c.id} value={c.id}>{c.grade}{c.section} · {c.academic_year}</option>)}</select></label></div>
    <div className="teacher-feedback__grid"><label>Ask<select value={audience} onChange={e=>setAudience(e.target.value)}><option value="students">Students</option><option value="parents">Parents / guardians</option></select></label>
      <label>Closes on<input name="deadline" type="datetime-local" required/></label></div>
    {audience==='parents'?<p>For parents, choose observable topics such as communication and feedback on work. They can select Not sure for classroom topics.</p>:null}
    <fieldset><legend>Parameters · choose up to 10</legend><div className="teacher-feedback__checks">{choices.map(p=><label key={p}><input type="checkbox" checked={parameters.includes(p)} disabled={!parameters.includes(p)&&parameters.length>=10} onChange={e=>setParameters(old=>e.target.checked?[...old,p]:old.filter(item=>item!==p))}/>{p}</label>)}</div></fieldset>
    <div className="teacher-feedback__custom"><label>Custom parameter<input value={custom} onChange={e=>setCustom(e.target.value)} maxLength={80} placeholder="e.g. Practical examples"/></label><button type="button" disabled={custom.trim().length<3||parameters.length>=10||choices.some(p=>p.toLowerCase()===custom.trim().toLowerCase())} onClick={()=>{setParameters([...parameters,custom.trim()]);setCustom('');}}>Add</button></div>
    <p>Responses are confidential. Names are not shown in results. Ratings appear after closing, with at least 5 responses per parameter. Parameters cannot change after publishing.</p>
    {error?<p role="alert">{error}</p>:null}<div className="teacher-feedback__actions"><button className="teacher-feedback__primary" disabled={busy}>{busy?'Publishing…':'Publish feedback request'}</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
