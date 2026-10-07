import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { CurriculumTargetSheet, SchoolCalendarSheet } from '../../pages/operations/TimetableBuilderSheets';
import { TimetableCoverage } from '../../pages/operations/TimetableCoverage';
import { createSchoolClosure, deleteSchoolClosure, saveCurriculumTarget } from '../operations/api';
import { getScheduleSettings, scheduleCommand } from './api';
import { YearForm } from './YearForm';
import { TimetableDraft } from './TimetableDraft';
import '../../pages/operations/timetable-builder.css';
import './schedule-settings.css';

export function ScheduleSettingsRoute() {
  const [params,setParams]=useSearchParams();
  const client=useQueryClient();
  const [calendar,setCalendar]=useState(false);
  const [subject,setSubject]=useState<string|null>(null);
  const termId=params.get('term')??undefined;
  const section=params.get('settings')??'home';
  const query=useQuery({queryKey:['principal-timetable','settings',termId],queryFn:()=>getScheduleSettings(termId)});
  const data=query.data;
  const selectedClass=data?.classes.find(c=>c.id===params.get('class'))??data?.classes[0];
  const term=data?.terms.find(t=>t.id===data.selected_term_id);
  const targetSubject=data?.subjects.find(s=>s.id===subject);
  const targetCoverage=data?.coverage.find(c=>c.class_section_id===selectedClass?.id&&c.subject_id===subject);
  const context=new URLSearchParams(params);context.delete('settings');
  const home=`/principal/timetable/weekly?${context}`;
  const returnParams=new URLSearchParams(params);returnParams.delete('settings');returnParams.delete('term');
  const dailyParams=new URLSearchParams(returnParams);
  dailyParams.delete('mode');dailyParams.set('view','day');
  if(selectedClass)dailyParams.set('class',selectedClass.id);
  if(!dailyParams.has('date')&&data)dailyParams.set('date',term&&data.school_date<term.starts_on?term.starts_on:data.school_date);
  const go=(view:string)=>{const p=new URLSearchParams(params);p.set('settings',view);setParams(p);window.scrollTo({top:0});};
  const refresh=async()=>{await client.invalidateQueries({queryKey:['principal-timetable']});await query.refetch();};
  const title=section==='year'?'Prepare academic year':section==='pattern'?'Class timetable':section==='coverage'?'Coverage targets':'Schedule settings';
  return <OperationsShell portal="principal" active="timetable" title={title} backTo={section==='home'?`/principal/timetable?${returnParams}`:home}>
    {query.isPending?<div className="timetable-builder__loading" role="status" aria-label="Loading schedule settings"><span/><span/><span/></div>:query.error?<section className="timetable-builder__empty-page"><p role="alert">{query.error.message}</p><button onClick={()=>void query.refetch()}>Try again</button></section>:data?<div className="schedule-settings">
      {section==='year'?<YearForm data={data} onSave={async body=>{const result=await scheduleCommand('years',data.school_id,body);await refresh();const p=new URLSearchParams(params);p.set('term',result.term_id!);p.delete('class');p.delete('settings');setParams(p);}}/>:<>
        <div className="schedule-settings__group">
          <label className="schedule-settings__select">Term<select value={term?.id??''} onChange={e=>{const p=new URLSearchParams(params);p.set('term',e.target.value);p.delete('class');setParams(p);}}>{data.terms.map(t=><option key={t.id} value={t.id}>{t.name} · {t.academic_year}</option>)}</select></label>
          {term?<p className="schedule-settings__hint">{term.starts_on} – {term.ends_on}</p>:<p className="schedule-settings__hint">Prepare an academic year to begin.</p>}
        </div>
        {section==='home'?<>
          <div className="schedule-settings__group">
            <button className="schedule-settings__row" onClick={()=>go('year')}><span><strong>Prepare next year</strong><small>Dates, terms and reusable class structure</small></span><Plus size={20}/></button>
            {term?<button className="schedule-settings__row" onClick={()=>setCalendar(true)}><span><strong>Working days & holidays</strong><small>{data.calendar_exceptions.filter(c=>!c.is_instructional).length} closure dates</small></span><ChevronRight size={20}/></button>:null}
            {term?<button className="schedule-settings__row" onClick={()=>go('coverage')}><span><strong>Teaching time targets</strong><small>Review projected subject hours</small></span><ChevronRight size={20}/></button>:null}
          </div>
          <h2>Class timetables</h2>
          <div className="schedule-settings__group">{data.classes.map(c=>{const draft=data.versions.find(v=>v.class_section_id===c.id&&v.state==='draft');const scheduled=data.versions.filter(v=>v.class_section_id===c.id&&v.state==='published'&&!v.baseline&&v.ends_on>=data.school_date);return <button key={c.id} className="schedule-settings__row" onClick={()=>{const p=new URLSearchParams(params);p.set('class',c.id);p.set('settings','pattern');setParams(p);window.scrollTo({top:0});}}><span><strong>{c.name}</strong><small>{draft?'Draft in progress':scheduled.length?`${scheduled.length} published arrangement${scheduled.length===1?'':'s'}`:data.slots.some(s=>s.class_section_id===c.id)?'Existing repeating timetable':'Not prepared'}</small></span><ChevronRight size={20}/></button>;})}{!data.classes.length?<p className="schedule-settings__hint">No classes in this year. Reuse classes when preparing a year, or add them in school records.</p>:null}</div>
        </>:section==='coverage'?<><label className="schedule-settings__select">Class<select value={selectedClass?.id??''} onChange={e=>{const p=new URLSearchParams(params);p.set('class',e.target.value);setParams(p);setSubject(null);}}>{data.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><TimetableCoverage rows={data.coverage.filter(c=>c.class_section_id===selectedClass?.id)} subjects={data.subjects} onSelect={setSubject}/></>:selectedClass&&term?<TimetableDraft key={`${term.id}:${selectedClass.id}`} data={data} selectedClass={selectedClass} refresh={refresh}/>:<p>No class selected.</p>}
        <Link className="schedule-settings__daily" to={`/principal/timetable?${dailyParams}`}>View day schedule <ChevronRight size={17}/></Link>
      </>}
      {calendar&&term?<SchoolCalendarSheet term={term} schoolDate={data.school_date} exceptions={data.calendar_exceptions} onClose={()=>setCalendar(false)} onCreate={async input=>{await createSchoolClosure(input);await refresh();}} onDelete={async(date,revision,reason)=>{await deleteSchoolClosure(date,revision,reason);await refresh();}}/>:null}
      {term&&selectedClass&&targetSubject&&targetCoverage?<CurriculumTargetSheet term={term} selectedClass={selectedClass} subject={targetSubject} coverage={targetCoverage} onClose={()=>setSubject(null)} onSave={async input=>{await saveCurriculumTarget(input);await refresh();setSubject(null);}}/>:null}
    </div>:null}
  </OperationsShell>;
}
