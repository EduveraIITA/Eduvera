import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { CurriculumTargetSheet, SchoolCalendarSheet } from '../../pages/operations/TimetableBuilderSheets';
import { TimetableCoverage } from '../../pages/operations/TimetableCoverage';
import { createSchoolClosure, deleteSchoolClosure, saveCurriculumTarget } from '../operations/api';
import { getScheduleSettings, scheduleCommand } from './api';
import { YearForm } from './YearForm';
import { TimetableDraft } from './TimetableDraft';
import { isoWeekday, shiftDate } from '../calendar/monthGrid';
import '../../pages/operations/timetable-builder.css';
import './schedule-settings.css';

export function ScheduleSettingsRoute() {
  const [params,setParams]=useSearchParams();
  const client=useQueryClient();
  const [calendar,setCalendar]=useState(false);
  const [subject,setSubject]=useState<string|null>(null);
  const termId=params.get('term')??undefined;
  const versionId=params.get('version')??undefined;
  const periodId=params.get('period')??undefined;
  const section=params.get('settings')??(periodId?'pattern':'home');
  const query=useQuery({queryKey:['principal-timetable','settings',termId],queryFn:()=>getScheduleSettings(termId)});
  const data=query.data;
  const requestedVersion=data?.versions.find(version=>version.id===versionId);
  const selectedClass=data?.classes.find(c=>c.id===(requestedVersion?.class_section_id??params.get('class')))??data?.classes[0];
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
  if(data&&section==='pattern') {
    const calendarParams=new URLSearchParams(params);
    calendarParams.delete('settings');calendarParams.delete('day');calendarParams.delete('version');
    calendarParams.set('view','week');
    if(selectedClass)calendarParams.set('class',selectedClass.id);
    if(!calendarParams.has('date'))calendarParams.set('date',data.school_date);
    const linkedPeriod=periodId?data.versions.flatMap(version=>version.periods).find(period=>period.id===periodId)??data.slots.find(period=>period.id===periodId):undefined;
    if(linkedPeriod){const date=calendarParams.get('date')!;calendarParams.set('date',shiftDate(date,linkedPeriod.weekday-isoWeekday(date)));}
    if(versionId&&!periodId)calendarParams.set('review',versionId);
    return <Navigate replace to={`/principal/timetable?${calendarParams}`}/>;
  }
  return <OperationsShell portal="principal" active="timetable" title={title} backTo={section==='home'?`/principal/timetable?${returnParams}`:home}>
    {query.isPending?<div className="timetable-builder__loading" role="status" aria-label="Loading schedule settings"><span/><span/><span/></div>:query.error?<section className="timetable-builder__empty-page"><p role="alert">{query.error.message}</p><button onClick={()=>void query.refetch()}>Try again</button></section>:data?<div className="schedule-settings">
      {section==='year'?<YearForm data={data} onSave={async body=>{const result=await scheduleCommand('years',data.school_id,body);await refresh();const p=new URLSearchParams(params);p.set('term',result.term_id!);p.delete('class');p.delete('settings');setParams(p,{replace:true});}}/>:<>
        <div className="schedule-settings__group">
          <label className="schedule-settings__select">Term<select value={term?.id??''} onChange={e=>{const p=new URLSearchParams(params);p.set('term',e.target.value);p.delete('class');setParams(p,{replace:true});}}>{data.terms.map(t=><option key={t.id} value={t.id}>{t.name} · {t.academic_year}</option>)}</select></label>
          {term?<p className="schedule-settings__hint">{term.starts_on} – {term.ends_on}</p>:<p className="schedule-settings__hint">Prepare an academic year to begin.</p>}
        </div>
        {section==='home'?<>
          <div className="schedule-settings__group">
            <button className="schedule-settings__row" onClick={()=>go('year')}><span><strong>Prepare next year</strong><small>Dates, terms and reusable class structure</small></span><Plus size={20}/></button>
            {term?<button className="schedule-settings__row" onClick={()=>setCalendar(true)}><span><strong>Working days & holidays</strong><small>{data.calendar_exceptions.filter(c=>!c.is_instructional).length} closure dates</small></span><ChevronRight size={20}/></button>:null}
            {term?<button className="schedule-settings__row" onClick={()=>go('coverage')}><span><strong>Teaching time targets</strong><small>Review projected subject hours</small></span><ChevronRight size={20}/></button>:null}
          </div>
        </>:section==='coverage'?<><label className="schedule-settings__select">Class<select value={selectedClass?.id??''} onChange={e=>{const p=new URLSearchParams(params);p.set('class',e.target.value);p.delete('version');p.delete('period');setParams(p,{replace:true});setSubject(null);}}>{data.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><TimetableCoverage rows={data.coverage.filter(c=>c.class_section_id===selectedClass?.id)} subjects={data.subjects} onSelect={setSubject}/></>:versionId&&!requestedVersion?<section className="timetable-builder__empty-page"><p role="alert">This timetable draft is no longer available.</p><Link to={home}>Open current schedules</Link></section>:selectedClass&&term?<TimetableDraft key={`${term.id}:${selectedClass.id}`} data={data} selectedClass={selectedClass} refresh={refresh} focusVersionId={versionId} focusPeriodId={periodId} focusDay={params.get('day')}/>:<section className="timetable-builder__empty-page"><p role={periodId?'alert':undefined}>{periodId?'This linked class or timetable period is no longer available.':'No class selected.'}</p>{periodId?<Link to={home}>Open current schedules</Link>:null}</section>}
        <Link className="schedule-settings__daily" to={`/principal/timetable?${dailyParams}`}>View day schedule <ChevronRight size={17}/></Link>
      </>}
      {calendar&&term?<SchoolCalendarSheet term={term} schoolDate={data.school_date} exceptions={data.calendar_exceptions} onClose={()=>setCalendar(false)} onCreate={async input=>{await createSchoolClosure(input);await refresh();}} onDelete={async(date,revision,reason)=>{await deleteSchoolClosure(date,revision,reason);await refresh();}}/>:null}
      {term&&selectedClass&&targetSubject&&targetCoverage?<CurriculumTargetSheet term={term} selectedClass={selectedClass} subject={targetSubject} coverage={targetCoverage} onClose={()=>setSubject(null)} onSave={async input=>{await saveCurriculumTarget(input);await refresh();setSubject(null);}}/>:null}
    </div>:null}
  </OperationsShell>;
}
