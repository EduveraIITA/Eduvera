import { useEffect, useRef, useState } from 'react';
import { effectivePeriodsForDate } from '../../../packages/contracts/src/academic-planner';
import type { ScheduleScreen, ScheduleVersion } from '../../../packages/contracts/src/wire/features/schedule-planning/api';
import { apiFetch } from '../lib/api';
import { academicScheduleRead } from '../lib/schedule-academic-policy';
import { academicLessonDraftBody, academicLessonEditBody } from '../lib/academic-planner-policy';
import type { NativePendingInput } from '../lib/native-pending-action';
import { useOperationContext } from '../lib/use-operation-context';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { ChoiceMenu, ControlButton, Facts } from '../ui/DomainControls';
import { Empty, Field, Notice, Section } from '../ui/components';
import { ScheduleTimeField, scheduleHref } from './ScheduleControls';

export function AcademicPlannerLesson({data,date,classId,periodId,href,disabled,busy,acknowledgedDraftId,acknowledgedSave,run}:{data:ScheduleScreen;date:string;classId:string;periodId:string;href:string;disabled:boolean;busy:boolean;acknowledgedDraftId:string|null;acknowledgedSave:{id:string;revision:number}|null;run(input:NativePendingInput):Promise<boolean>}) {
  const {onNavigate}=useCampusNavigation(href),[original]=useState(()=>effectivePeriodsForDate(data,date,classId).find(row=>row.id===periodId)),[editing,setEditing]=useState(false),[reviewed,setReviewed]=useState<ScheduleVersion|undefined>(()=>data.versions.find(row=>row.class_section_id===classId&&row.state==='draft'));
  const [subject,setSubject]=useState(original?.subject_id??''),[teacher,setTeacher]=useState(original?.teacher_user_id??''),[title,setTitle]=useState(original?.title??''),[room,setRoom]=useState(original?.room??''),[start,setStart]=useState(original?.starts_at.slice(0,5)??''),[end,setEnd]=useState(original?.ends_at.slice(0,5)??''),[preparing,setPreparing]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[completed,setCompleted]=useState(false),running=useRef(false);
  const current=effectivePeriodsForDate(data,date,classId).find(row=>row.id===periodId),currentDraft=data.versions.find(row=>row.class_section_id===classId&&row.state==='draft'),ownCreated=currentDraft?.id===acknowledgedDraftId;
  useEffect(()=>{if(ownCreated&&currentDraft&&!busy&&reviewed?.id!==currentDraft.id){setReviewed(structuredClone(currentDraft));setMessage('The exact recurring draft was prepared. Your proposed lesson changes remain below; review and save them to this draft.');}},[ownCreated,currentDraft?.id,busy,reviewed?.id]);
  useEffect(()=>{if(acknowledgedSave&&reviewed&&acknowledgedSave.id===reviewed.id&&acknowledgedSave.revision===reviewed.revision&&!busy){setCompleted(true);setEditing(false);}},[acknowledgedSave,reviewed,busy]);
  const sourceChanged=!!original&&(!current||JSON.stringify(current)!==JSON.stringify(original)),draftChanged=reviewed?.id!==currentDraft?.id||reviewed?.revision!==currentDraft?.revision,locked=disabled||preparing||sourceChanged&&!ownCreated||draftChanged;
  const capture=useOperationContext(JSON.stringify([href,data.school_id,data.selected_term_id,classId,date,periodId]));
  useScreenExitGuard({blocked:busy||preparing,dirty:editing&&!disabled,title:'Leave recurring lesson edit?',message:'Your unsaved lesson changes will be discarded. A prepared draft remains available in timetable planning.'});
  if(!original)return <><Empty title="This linked lesson is no longer in the current timetable for this class and date"/><ControlButton title="Review current class timetable" onPress={()=>onNavigate(scheduleHref(href,{period:''}))}/></>;
  if(completed)return <Section title="Recurring lesson saved"><Notice tone="success" message="Your exact lesson change was saved to the private class draft. Review publication separately; the published timetable and recorded attendance remain in place."/><ControlButton title="Review current class timetable" onPress={()=>onNavigate(scheduleHref(href,{period:''}))}/></Section>;
  const save=async()=>{if(locked||running.current)return;running.current=true;setPreparing(true);setError('');try{
    const check=capture(),fresh=await apiFetch<ScheduleScreen>(academicScheduleRead(data.selected_term_id??undefined));check();
    if(fresh.school_id!==data.school_id||fresh.selected_term_id!==data.selected_term_id||!fresh.classes.some(row=>row.id===classId))throw new Error('The exact institution, term or class changed. Your proposal is kept.');
    const term=fresh.terms.find(row=>row.id===fresh.selected_term_id),draft=fresh.versions.find(row=>row.class_section_id===classId&&row.state==='draft');
    if(!term)throw new Error('The selected academic term is unavailable.');
    if(!reviewed){
      const period=effectivePeriodsForDate(fresh,date,classId).find(row=>row.id===periodId);
      if(draft||!period||JSON.stringify(period)!==JSON.stringify(original))throw new Error('The recurring lesson or draft changed. Review the current saved source before preparing another draft.');
      await run({endpoint:'/api/v1/schedule-planning/drafts',body:academicLessonDraftBody(fresh,classId,date),source:{kind:'academic_schedule',sourceId:fresh.school_id,revision:0}});check();return;
    }
    if(!draft||draft.id!==reviewed.id||draft.revision!==reviewed.revision)throw new Error('This recurring draft changed. Your proposal is kept. Review its current saved revision.');
    const body=academicLessonEditBody(fresh,original,reviewed,{subject,teacher,title,room,start,end});
    const ok=await run({endpoint:`/api/v1/schedule-planning/${draft.id}/save`,body,source:{kind:'academic_schedule',sourceId:draft.id,revision:draft.revision}});check();
    if(ok){setCompleted(true);setEditing(false);}
  }catch(cause){setError(cause instanceof Error?cause.message:'The lesson could not be saved.');}finally{running.current=false;setPreparing(false);}};
  const teaching=original.slot_type==='class';
  return <Section title={editing?`Edit recurring ${teaching?'class':'period'}`:original.display_title}><ScreenBack title={editing?'Back to lesson details':'Back to class timetable'} priority={10} disabled={busy||preparing} onPress={()=>editing?setEditing(false):onNavigate(scheduleHref(href,{period:''}))}/>
    <Facts items={[{label:'Class and date',value:`${original.class_name} · ${date}`},{label:'Time',value:`${original.starts_at.slice(0,5)} – ${original.ends_at.slice(0,5)}`},{label:'Teacher',value:original.teacher_name??'Not assigned'},{label:'Room',value:original.room||'Not assigned'},{label:'Repeats',value:`Every ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][original.weekday-1]}`},{label:'Source',value:original.version_state==='draft'?'Private recurring draft':'Published recurring timetable'}]}/>
    {message?<Notice tone="success" message={message}/>:null}{sourceChanged&&!ownCreated?<Notice tone="warning" message="This dated lesson changed. Your unsaved proposal is kept; close this review and inspect the current timetable before editing."/>:null}
    {editing?<>
      {draftChanged?<><Notice tone="warning" message="The current recurring draft changed. Your proposed lesson fields remain."/><ControlButton title="Review current class draft and keep my proposal" disabled={disabled||preparing} onPress={()=>{setReviewed(currentDraft?structuredClone(currentDraft):undefined);setError('');}}/></>:null}
      {teaching?<ChoiceMenu label="Subject" value={subject} options={data.subjects.map(row=>({value:row.id,label:row.name}))} disabled={locked} onChange={setSubject}/>:<Field label="Period title" value={title} onChangeText={setTitle} maxLength={120} editable={!locked}/>}
      <ScheduleTimeField label="Starts" value={start} onChange={setStart} disabled={locked}/><ScheduleTimeField label="Ends" value={end} onChange={setEnd} disabled={locked}/>
      {teaching?<ChoiceMenu label="Teacher" value={teacher} options={[{value:'',label:'Choose current teacher'},...data.teachers.map(row=>({value:row.id,label:row.name}))]} disabled={locked} onChange={setTeacher}/>:null}<Field label="Room" value={room} onChangeText={setRoom} maxLength={80} editable={!locked}/>
      <Notice message={`Repeats every ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][original.weekday-1]}. Saved to the private class draft; a dated override and recorded attendance are preserved.`}/>{error?<Notice tone="danger" message={error}/>:null}
      <ControlButton title={reviewed?'Save recurring lesson changes':'Prepare recurring draft and retain my changes'} kind="primary" disabled={locked||teaching&&(!subject||!teacher)||!title.trim()||end<=start} busy={busy||preparing} onPress={()=>void save()}/><ControlButton title="Back to lesson details" disabled={busy||preparing} onPress={()=>setEditing(false)}/>
    </>:<><ControlButton title={`Edit recurring ${teaching?'class':'period'}`} disabled={disabled||sourceChanged&&!ownCreated} onPress={()=>{setEditing(true);setError('');}}/>{date>=data.school_date?<ControlButton title="Change only this date" disabled={busy} onPress={()=>onNavigate(`/areas/timetable/planning/day?${new URLSearchParams({date,class:classId,mode:'edit',return_to:`/areas/timetable/planning?${new URLSearchParams({source:'academic',date,class:classId,period:periodId})}`})}`)}/>:null}</>}
  </Section>;
}
