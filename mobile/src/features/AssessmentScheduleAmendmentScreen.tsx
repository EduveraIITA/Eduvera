import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { AssessmentDetail, AssessmentWorkspace } from '../../../packages/contracts/src/assessments';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, getApiOrigin } from '../lib/api';
import { useApi } from '../lib/query';
import { useNativePendingAction } from '../lib/native-pending-action';
import { useOperationContext } from '../lib/use-operation-context';
import { formatCampusDateTime } from '../lib/browser-temporal';
import { assertExamScheduleAccepted, definitiveExamScheduleRefusal, examScheduleAmendmentInput, examScheduleConfirmationInput,
  examScheduleDraftChanged, examSchedulePreviewPayload, examScheduleRefreshPath, mayAmendExamSchedule, readExamSchedulePreview, type ExamScheduleDraft, type ExamSchedulePreview } from '../lib/assessment-schedule-amendments';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, Facts } from '../ui/DomainControls';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { TemporalField } from '../ui/TemporalField';
import { useTheme } from '../ui/theme';

type Props={href:string;schoolId:string;assessmentId:string;confirm?:boolean};
const message=(error:unknown)=>error instanceof Error?error.message:'The revised examination schedule could not be confirmed.';
function owner(href:string){const url=new URL(href,'https://thatcampus.invalid');url.searchParams.delete('edit');return url.pathname+url.search;}
export function AssessmentScheduleAmendmentScreen(props:Props){
  const {schoolId,user,environment,scopeKey}=useSession(),base=`/api/v1/schools/${encodeURIComponent(props.schoolId)}/assessments/`;
  const detail=useApi<AssessmentDetail>(`${base}${props.assessmentId}/`),workspace=useApi<AssessmentWorkspace>(`${base}workspace/`);
  if(!user||schoolId!==props.schoolId||environment.unavailable)return <Page title="Examination schedule"><Empty title="This campus world is unavailable"/></Page>;
  if(detail.isPending||workspace.isPending)return <Page title="Examination schedule"><Loading/></Page>;
  if(!detail.data||!workspace.data||!detail.data.exam_operation||detail.data.assessment.id!==props.assessmentId||detail.error||workspace.error)
    return <Page title="Examination schedule"><ScreenBack fallbackHref={owner(props.href)} title="Assessment"/><Empty title="Current examination access could not load"
      message={detail.error?.message??workspace.error?.message} onRetry={()=>{void detail.refetch();void workspace.refetch();}}/></Page>;
  return <ScheduleForm key={`${scopeKey}:${props.assessmentId}:${props.confirm?'confirm':'amend'}`} {...props} detail={detail.data} workspace={workspace.data}
    refresh={async()=>{const result=await detail.refetch({throwOnError:true});if(!result.data)throw new Error('The saved examination is unavailable.');return result.data;}}/>;
}
function ScheduleForm({href,schoolId,detail,workspace,confirm,refresh}:Props&{detail:AssessmentDetail;workspace:AssessmentWorkspace;refresh:()=>Promise<AssessmentDetail>}){
  const {user,environment,scopeKey}=useSession(),{colors}=useTheme(),navigation=useCampusNavigation(href),cache=useQueryClient();
  const [source,setSource]=useState(detail),[draft,setDraft]=useState<ExamScheduleDraft>({scheduled:detail.exam_operation!.sitting.starts_at,
    duration:String(detail.assessment.duration_minutes??''),space:detail.exam_operation!.space.id,
    invigilators:detail.exam_operation!.invigilators.filter(row=>row.status!=='revoked').map(row=>row.user_id),reason:''});
  const [review,setReview]=useState<{preview:ExamSchedulePreview;payload:ReturnType<typeof examSchedulePreviewPayload>}|null>(null),
    [reading,setReading]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const captureOperation=useOperationContext(JSON.stringify([href,schoolId,source.assessment.id,source.assessment.revision,source.exam_operation?.sitting.revision]));
  const base=`/api/v1/schools/${encodeURIComponent(schoolId)}/assessments/${source.assessment.id}/`;
  const writer=useNativePendingAction<AssessmentDetail>({scope:{actorId:user!.id,schoolId,mode:environment.mode,namespaceId:environment.namespace_id??null,origin:getApiOrigin()},
    domain:'assessments',ownerHref:href,refreshPath:base,captureOperation,resolveRefreshPath:examScheduleRefreshPath,obsolete:definitiveExamScheduleRefusal,
    accepted:async(value,assertCurrent,action)=>{assertExamScheduleAccepted(value,action);await cache.invalidateQueries({queryKey:['campus',scopeKey],refetchType:'none'});assertCurrent();setSaved(true);}});
  const now=environment.virtual_clock?.now??new Date().toISOString(),op=source.exam_operation!,stale=detail.assessment.revision!==source.assessment.revision||detail.exam_operation?.sitting.revision!==op.sitting.revision;
  const locked=writer.locked||reading||stale||environment.unavailable||workspace.mode!=='admin'||!mayAmendExamSchedule(source,now);
  useScreenExitGuard({blocked:writer.busy||reading,dirty:!confirm&&!writer.action&&!saved&&(!!review||examScheduleDraftChanged(source,draft)),title:'Leave this schedule revision?',message:'Your unsent changes will be lost. An exact submitted command stays recoverable.'});
  useEffect(()=>{if(saved&&!writer.action&&!writer.busy)navigation.complete(owner(href));},[saved,writer.action,writer.busy,href]);
  const change=(patch:Partial<ExamScheduleDraft>)=>{setDraft(value=>({...value,...patch}));setReview(null);};
  async function loadCurrent(){if(writer.busy||writer.action||reading)return;setReading(true);setError('');try{const active=captureOperation();const value=await refresh();active();setSource(value);setReview(null);writer.reviewed();}catch(cause){setError(message(cause));}finally{setReading(false);}}
  async function preview(){if(locked)return;setReading(true);setError('');try{const payload=examSchedulePreviewPayload(source,workspace,draft,now),assertCurrent=captureOperation();
    const result=await apiFetch<ExamSchedulePreview>(base+'sitting/schedule-amendments/preview/',{method:'POST',body:JSON.stringify(payload)});assertCurrent();setReview({preview:readExamSchedulePreview(result,source,payload),payload});
  }catch(cause){setError(message(cause));}finally{setReading(false);}}
  const timeZone = op.time_zone ?? workspace.time_zone ?? 'UTC';
  const when = (value: string) => formatCampusDateTime(value, timeZone);
  return <Page title={confirm?'Confirm revised schedule':'Change examination schedule'} subtitle={source.assessment.title}>
    <ScreenBack fallbackHref={owner(href)} title="Assessment" disabled={writer.busy||reading}/>
    {error||writer.error?<Notice tone="danger" message={error||writer.error}/>:null}
    {stale?<Notice tone="warning" message="This examination changed elsewhere. Your unsent choices remain; review the saved arrangements before continuing."/>:null}
    {stale||writer.obsolete?<Button title="Review saved arrangements" disabled={writer.busy||!!writer.action||reading} onPress={()=>void loadCurrent()}/>:null}
    {writer.action?<Section title="Retained schedule command"><Notice tone="warning" message="The exact reviewed command is retained. Recovery checks its own receipt; it does not repeat a different schedule change."/>
      {writer.resumeHref?<Button title="Return to original action" onPress={()=>navigation.onNavigate(writer.resumeHref!)}/>:<Button title={writer.action.phase==='accepted'?'Refresh saved schedule':'Recover original schedule command'} busy={writer.busy} onPress={()=>void writer.recover()}/>}</Section>:null}
    {!mayAmendExamSchedule(source,now)?<Notice tone="warning" message="Only a future examination with no started sitting, candidate observations or incidents can be revised."/>:null}
    <Section title={confirm?'Revised arrangements':'Current arrangements'}><Facts items={[{label:'When',value:`${when(op.sitting.starts_at)} – ${when(op.sitting.ends_at)}`},
      {label:'Place',value:op.space.name},{label:'Candidates',value:`${op.candidates.length} · Frozen roster retained`},
      {label:'Readiness',value:op.schedule_state==='awaiting_confirmation' ? op.readiness?.can_schedule ? 'Ready for officer confirmation' : 'Waiting for invigilation and schedule checks' : op.sitting.state.replaceAll('_',' ')}]}/></Section>
    {confirm?<Section title="Readiness check">{op.readiness?.blockers.map((item,index)=><Notice key={`${item.code}:${index}`} tone="warning" message={item.message}/>)}
      <Notice message="Confirmation rechecks current staff acceptances and all schedule conflicts. The frozen candidate roster and earlier schedule history stay unchanged."/>
      <Button title="Confirm revised schedule" disabled={locked||!op.readiness?.can_schedule} busy={writer.busy}
        onPress={()=>{setError('');try{void writer.run(examScheduleConfirmationInput(source,schoolId));}catch(cause){setError(message(cause));}}}/></Section>
      :review?<Section title="Review the schedule revision"><Facts items={[{label:'New time',value:`${when(review.preview.proposed.scheduled_at)} – ${when(review.preview.proposed.ends_at)}`},
        {label:'New place',value:review.preview.proposed.space_name},{label:'Candidates retained',value:review.preview.candidate_count},
        {label:'Duties needing confirmation',value:review.preview.reissued_invigilator_user_ids.length},{label:'Duties removed',value:review.preview.removed_invigilator_user_ids.length},
        {label:'Reason',value:review.preview.reason}]}/>{review.preview.blockers.map((item,index)=><Notice key={`${item.code}:${index}`} tone="warning" message={item.message}/>)}
        <Notice tone="warning" message={review.preview.confirmation_message}/><Button title="Publish revised arrangements" busy={writer.busy} disabled={locked||!review.preview.can_publish}
          onPress={()=>{setError('');try{void writer.run(examScheduleAmendmentInput(source,schoolId,review.payload,review.preview));}catch(cause){setError(message(cause));}}}/>
        <ControlButton title="Keep editing" disabled={writer.locked} onPress={()=>setReview(null)}/></Section>
      :<Section title="Revised arrangements"><TemporalField label={`New date and time · ${timeZone}`} mode="datetime" timeZone={timeZone} value={draft.scheduled} onChange={scheduled=>change({scheduled})} disabled={locked} minimumDate={new Date(now)}/>
        <Field label="Duration in minutes" value={draft.duration} onChangeText={duration=>change({duration})} keyboardType="number-pad" maxLength={4} editable={!locked}/>
        <ChoiceMenu label="Room or hall" value={draft.space} options={(workspace.references?.spaces??[]).map(row=>({value:row.id,label:`${row.name} · ${row.capacity??'Unknown'} seats`}))} onChange={space=>change({space})} disabled={locked}/>
        <Disclosure title={`Invigilators · ${draft.invigilators.length}`}><Notice message="Changing the time or room asks each affected invigilator to confirm again."/>
          {(workspace.references?.staff??[]).map(person=><View key={person.id} style={{flexDirection:'row',alignItems:'center',gap:12}}><Switch accessibilityLabel={`Invigilator: ${person.first_name} ${person.last_name}`} disabled={locked} value={draft.invigilators.includes(person.id)}
            onValueChange={selected=>change({invigilators:selected?[...draft.invigilators,person.id]:draft.invigilators.filter(id=>id!==person.id)})}/><Text style={{flex:1,color:colors.ink,fontSize:16}}>{person.first_name} {person.last_name}</Text></View>)}</Disclosure>
        <Field label="Reason for changing the published schedule" value={draft.reason} onChangeText={reason=>change({reason})} maxLength={1000} multiline editable={!locked}/>
        <Button title="Review schedule impact" disabled={locked} busy={reading} onPress={()=>void preview()}/></Section>}
    {op.schedule_history?.length?<Disclosure title="Schedule history">{op.schedule_history.map(row=><Row key={row.revision} title={`${row.action==='amended'?'Revised':'Confirmed'} · ${when(row.recorded_at)}`} detail={row.reason}/>)}</Disclosure>:null}
  </Page>;
}
