import { useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { SlotEditorSheet } from '../../pages/operations/TimetableBuilderSheets';
import type { NewTimetableSlot } from '../operations/api';
import { cleanPeriod, type SchedulePeriod, type ScheduleScreen, type ScheduleVersion } from './api';
import { SchoolTimings } from './SchoolTimings';
const DAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export function PatternEditor({data,draft,onSave}:{data:ScheduleScreen;draft:ScheduleVersion;onSave:(periods:SchedulePeriod[])=>Promise<void>}) {
  const [day,setDay]=useState(1);
  const [edit,setEdit]=useState<SchedulePeriod|'new'|null>(null);
  const [copy,setCopy]=useState(false);
  const [targets,setTargets]=useState<number[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const selected=data.classes.find(c=>c.id===draft.class_section_id)!;
  const rows=draft.periods.filter(p=>p.weekday===day);
  const nextStart=rows.at(-1)?.ends_at.slice(0,5)??'08:00';
  const [hour=8,minute=0]=nextStart.split(':').map(Number);
  const nextEndMinutes=Math.min(1439,hour*60+minute+45);
  const nextEnd=`${String(Math.floor(nextEndMinutes/60)).padStart(2,'0')}:${String(nextEndMinutes%60).padStart(2,'0')}`;
  const save=async (periods:SchedulePeriod[])=>{await onSave(periods.map(cleanPeriod));setEdit(null);};
  const initial:NewTimetableSlot=edit && edit!=='new'?{...cleanPeriod(edit),class_section_id:selected.id,term_id:draft.term_id,teacher_designation:'Teacher'}:{class_section_id:selected.id,term_id:draft.term_id,weekday:day,period_number:Math.max(0,...rows.map(p=>p.period_number))+1,starts_at:nextStart,ends_at:nextEnd,slot_type:'class',subject_id:null,teacher_user_id:null,title:'',room:selected.room_number,teacher_designation:'Teacher'};
  return <section className="schedule-settings__pattern">
    {!draft.periods.length?<SchoolTimings room={selected.room_number} onSave={save}/>:null}
    <nav className="timetable-builder__days" aria-label="Repeating week">{DAYS.map((d,i)=><button type="button" key={d} aria-pressed={day===i+1} onClick={()=>{setDay(i+1);setCopy(false);setTargets([]);}}>{d}</button>)}</nav>
    <div className="schedule-settings__actions"><h2>{DAYS[day-1]} periods</h2><button type="button" onClick={()=>setEdit('new')}><Plus size={16}/>Add</button></div>
    {rows.length?<ol className="timetable-builder__periods">{rows.map(p=><li key={p.id}><button type="button" onClick={()=>setEdit(p)}><span className="timetable-builder__period-number">{p.period_number}</span><span><strong>{p.title}</strong><small>{p.starts_at.slice(0,5)}–{p.ends_at.slice(0,5)}{p.slot_type==='class'?` · ${data.teachers.find(t=>t.id===p.teacher_user_id)?.name??'Assign teacher'}`:''}</small></span><ChevronRight size={18}/></button></li>)}</ol>:<p className="schedule-settings__hint">No periods. Add a lesson or copy another day.</p>}
    {rows.length?<button type="button" className="schedule-settings__text-button" onClick={()=>setCopy(!copy)}>Copy this day</button>:null}
    {copy?<div className="schedule-settings__copy"><p>Replace periods on:</p><div>{DAYS.map((d,i)=>i+1===day?null:<label key={d}><input type="checkbox" checked={targets.includes(i+1)} onChange={e=>setTargets(e.target.checked?[...targets,i+1]:targets.filter(t=>t!==i+1))}/>{d}</label>)}</div><button type="button" disabled={busy||!targets.length} onClick={async()=>{setBusy(true);setError('');try{await save([...draft.periods.filter(p=>!targets.includes(p.weekday)),...targets.flatMap(weekday=>rows.map(p=>({...cleanPeriod(p),id:crypto.randomUUID(),weekday})))]);setCopy(false);}catch(cause){setError(cause instanceof Error?cause.message:'Could not copy day.');}finally{setBusy(false);}}}>Copy to selected days</button>{error?<p role="alert">{error}</p>:null}</div>:null}
    <details className="schedule-settings__allocations"><summary>Teaching allocation</summary>{data.subjects.filter(s=>draft.periods.some(p=>p.subject_id===s.id)).map(s=><div key={s.id}><span>{s.name}</span><strong>{draft.periods.filter(p=>p.subject_id===s.id).length} lessons/week</strong></div>)}{!draft.periods.some(p=>p.subject_id)?<p>Add subjects to see the weekly allocation.</p>:null}</details>
    {edit?<SlotEditorSheet data={data} selectedClass={selected} initial={initial} editingId={edit==='new'?null:edit.id} onClose={()=>setEdit(null)} onSave={async slot=>{
      const p:SchedulePeriod={id:edit==='new'?crypto.randomUUID():edit.id,weekday:day,period_number:slot.period_number,starts_at:slot.starts_at,ends_at:slot.ends_at,subject_id:slot.subject_id,teacher_user_id:slot.teacher_user_id,title:data.subjects.find(s=>s.id===slot.subject_id)?.name??slot.title,slot_type:slot.slot_type,room:slot.room};
      await save([...draft.periods.filter(row=>row.id!==p.id),p].sort((a,b)=>a.weekday-b.weekday||a.period_number-b.period_number));
    }} onDelete={edit==='new'?undefined:()=>save(draft.periods.filter(p=>p.id!==edit.id))}/>:null}
  </section>;
}
