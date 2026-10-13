import { useEffect,useRef,useState } from 'react';
import { cleanPeriod, scheduleCommand, type ScheduleScreen } from './api';
import { PatternEditor } from './PatternEditor';
import type { PrincipalTimetableResponse } from '../operations/api';

import { TemporalInput } from "../../components/forms/TemporalInput";
export function TimetableDraft({data,selectedClass,refresh,focusVersionId,focusPeriodId,focusDay}:{data:ScheduleScreen;selectedClass:PrincipalTimetableResponse['classes'][number];refresh:()=>Promise<void>;focusVersionId?:string;focusPeriodId?:string;focusDay?:string|null}) {
  const term=data.terms.find(t=>t.id===data.selected_term_id)!;
  const tomorrow=new Date(`${data.school_date}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const minDate=[tomorrow.toISOString().slice(0,10),term.starts_on].sort().at(-1)!;
  const versions=data.versions.filter(v=>v.class_section_id===selectedClass.id);
  const draft=versions.find(v=>v.state==='draft');
  const focusedVersion=versions.find(v=>v.id===focusVersionId);
  const focusedVersionPeriod=data.versions.flatMap(version=>version.periods.map(period=>({period,version}))).find(item=>item.period.id===focusPeriodId);
  const focusedSlot=data.slots.find(slot=>slot.id===focusPeriodId);
  const focusedPeriod=focusedVersionPeriod?.period??focusedSlot;
  const focusedPeriodClassId=focusedVersionPeriod?.version.class_section_id??focusedSlot?.class_section_id;
  const requestedDay=Number(focusDay);
  const focusedPeriodMatches=Boolean(focusedPeriod
    && focusedPeriodClassId===selectedClass.id
    && (!Number.isInteger(requestedDay)||requestedDay<1||requestedDay>7||focusedPeriod.weekday===requestedDay));
  const focusedDraftPeriod=focusedPeriodMatches?draft?.periods.find(period=>period.id===focusPeriodId):undefined;
  const focusRef=useRef<HTMLElement>(null);
  const attentionPeriodRef=useRef<HTMLElement>(null);
  const [from,setFrom]=useState(draft?.starts_on??minDate);
  const [to,setTo]=useState(draft?.ends_on??term.ends_on);
  const [mode,setMode]=useState(draft&&draft.ends_on!==term.ends_on?'range':'ongoing');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [review,setReview]=useState(false);
  const [source,setSource]=useState('');
  const run=async(path:string,body:Record<string,unknown>,success:string)=>{setBusy(true);setError('');setMessage('');try{await scheduleCommand(path,data.school_id,body);await refresh();setMessage(success);setReview(false);}catch(cause){setError(cause instanceof Error?cause.message:'The timetable could not be updated.');}finally{setBusy(false);}};
  const datesDirty=draft&&(from!==draft.starts_on||to!==draft.ends_on);
  const missing=draft?.periods.filter(p=>p.slot_type==='class'&&!p.teacher_user_id).length??0;
  useEffect(()=>{if(!focusedVersion)return;const frame=window.requestAnimationFrame(()=>{focusRef.current?.scrollIntoView?.({behavior:'smooth',block:'center'});focusRef.current?.focus({preventScroll:true});});return()=>window.cancelAnimationFrame(frame);},[focusedVersion]);
  useEffect(()=>{if(!focusPeriodId||focusedDraftPeriod||!focusedPeriodMatches)return;const frame=window.requestAnimationFrame(()=>{attentionPeriodRef.current?.scrollIntoView?.({behavior:'smooth',block:'center'});attentionPeriodRef.current?.focus({preventScroll:true});});return()=>window.cancelAnimationFrame(frame);},[focusPeriodId,focusedDraftPeriod,focusedPeriodMatches]);
  return <>
    <h2>{selectedClass.name}</h2>
    {focusPeriodId&&!focusedPeriodMatches?<section className="schedule-settings__attention-state" role="alert"><strong>Timetable period unavailable</strong><p>This period is no longer part of the linked class and day. Open the current timetable below.</p></section>:null}
    {focusPeriodId&&focusedPeriodMatches&&!focusedDraftPeriod&&focusedPeriod?<section ref={attentionPeriodRef} id={`attention-schedule-period-${focusPeriodId}`} tabIndex={-1} className="schedule-settings__attention-period is-attention-target"><span>P{focusedPeriod.period_number}</span><div><strong>{'display_title' in focusedPeriod?focusedPeriod.display_title:focusedPeriod.title}</strong><small>{focusedPeriod.starts_at.slice(0,5)}–{focusedPeriod.ends_at.slice(0,5)} · {focusedPeriod.teacher_user_id?data.teachers.find(teacher=>teacher.id===focusedPeriod.teacher_user_id)?.name??'Assigned teacher':'Teacher assignment needed'}</small></div></section>:null}
    <section className="schedule-settings__group">
      <form className="schedule-settings__form" onSubmit={e=>{e.preventDefault();void run(draft?`${draft.id}/save`:'drafts',draft?{expected_revision:draft.revision,starts_on:from,ends_on:to,periods:draft.periods.map(cleanPeriod)}:{term_id:term.id,class_section_id:selectedClass.id,starts_on:from,ends_on:to,...(source?{source_id:source}:{})},draft?'Dates saved.':'Draft prepared. The published timetable is unchanged.');}}>
        <h3>{draft?'Draft timetable':'Prepare timetable'}</h3>
        {!draft&&data.versions.some(v=>v.state==='published'&&!v.baseline&&v.class_section_id!==selectedClass.id)?<label>Start with<select value={source} onChange={e=>setSource(e.target.value)}><option value="">This class’s current pattern</option>{data.versions.filter(v=>v.state==='published'&&!v.baseline&&v.class_section_id!==selectedClass.id).map(v=><option key={v.id} value={v.id}>{data.classes.find(c=>c.id===v.class_section_id)?.name} · {v.starts_on}</option>)}</select></label>:null}
        <label>Applies<select value={mode} onChange={e=>{setMode(e.target.value);if(e.target.value==='ongoing')setTo(term.ends_on);}}><option value="ongoing">From a date onward</option><option value="range">For a date range</option></select></label>
        <div className="schedule-settings__dates"><label>Starts<TemporalInput type="date" min={minDate} max={term.ends_on} required value={from} onChange={e=>setFrom(e.target.value)}/></label>{mode==='range'?<label>Ends<TemporalInput type="date" min={from} max={term.ends_on} required value={to} onChange={e=>setTo(e.target.value)}/></label>:null}</div>
        <p>{mode==='range'?'The previous repeating timetable resumes after this range.':`Repeats until ${term.ends_on}. Earlier dates stay unchanged.`}</p>
        {!draft||datesDirty?<button type="submit" disabled={busy||minDate>term.ends_on}>{busy?'Saving…':draft?'Save dates':'Prepare draft'}</button>:null}
        {!draft?<p>Starts with the existing pattern. Nothing becomes live until you publish.</p>:null}
      </form>
    </section>
    {error?<p className="schedule-settings__error" role="alert">{error}</p>:null}{message?<p role="status">{message}</p>:null}
    {draft?<>
      <PatternEditor data={data} draft={draft} focusPeriodId={focusedDraftPeriod?.id} focusDay={focusDay} onSave={async periods=>{await scheduleCommand(`${draft.id}/save`,data.school_id,{expected_revision:draft.revision,starts_on:draft.starts_on,ends_on:draft.ends_on,periods});await refresh();setReview(false);}}/>
      <section ref={focusedVersion?.id===draft.id?focusRef:undefined} id={`schedule-draft-actions-${draft.id}`} tabIndex={focusedVersion?.id===draft.id?-1:undefined} className={`schedule-settings__group schedule-settings__publish${focusedVersion?.id===draft.id?' is-attention-target':''}`}>
        {review?<><h3>Publish this timetable?</h3><p>{selectedClass.name} · {draft.starts_on} – {draft.ends_on}</p><p>{draft.periods.length} weekly periods. Affected staff and families will be notified. Existing daily changes stay in place.</p>{missing?<p role="alert">Assign teachers to {missing} teaching periods first.</p>:null}<button disabled={busy||!!missing||!!datesDirty} onClick={()=>void run(`${draft.id}/publish`,{expected_revision:draft.revision},'Timetable published.')}>{busy?'Checking…':'Confirm and publish'}</button><button className="is-secondary" disabled={busy} onClick={()=>setReview(false)}>Keep editing</button></>:<button disabled={busy||!!datesDirty||!draft.periods.length} onClick={()=>setReview(true)}>Review & publish</button>}
        <button className="schedule-settings__text-button" disabled={busy} onClick={()=>{if(window.confirm('Discard this draft? The published timetable will stay unchanged.'))void run(`${draft.id}/discard`,{expected_revision:draft.revision},'Draft discarded.');}}>Discard draft</button>
      </section>
    </>:null}
    {versions.some(v=>v.state==='published'&&!v.baseline)?<section className="schedule-settings__group"><h3 className="schedule-settings__hint">Published arrangements</h3>{versions.filter(v=>v.state==='published'&&!v.baseline).map(v=>{const focused=focusedVersion?.id===v.id;return <div key={v.id} ref={focused?node=>{focusRef.current=node;}:undefined} tabIndex={focused?-1:undefined} className={`schedule-settings__row${focused?' is-attention-target':''}`}><span><strong>{v.starts_on} – {v.ends_on}</strong><small>{v.starts_on>data.school_date?'Scheduled':v.ends_on<data.school_date?'Past arrangement':'Published'} · {v.periods.length} weekly periods</small></span></div>;})}</section>:null}
  </>;
}
