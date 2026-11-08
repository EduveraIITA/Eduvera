import type { AssessmentDetail, AssessmentWorkspace, ExamReadinessBlocker } from '../../../packages/contracts/src/assessments';
import type { NativePendingAction, NativePendingInput, NativePendingScope } from './native-pending-action';
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const root=(school:string,assessment:string)=>`/api/v1/schools/${encodeURIComponent(school)}/assessments/${assessment}/`;
export interface ExamScheduleDraft {scheduled:string;duration:string;space:string;invigilators:string[];reason:string}
export interface ExamSchedulePreview {
  previous:{scheduled_at:string;ends_at:string;space_id:string;invigilator_user_ids:string[]};
  proposed:{scheduled_at:string;ends_at:string;space_id:string;space_name:string;duration_minutes:number;invigilator_user_ids:string[]};
  candidate_count:number;reissued_invigilator_user_ids:string[];removed_invigilator_user_ids:string[];
  blockers:ExamReadinessBlocker[];confirmation_message:string;reason:string;can_publish:boolean;preview_hash:string;
}
export function examScheduleDraftChanged(detail:AssessmentDetail,draft:ExamScheduleDraft){
  const op=detail.exam_operation;
  return !op||draft.reason.length>0||draft.scheduled!==op.sitting.starts_at||draft.space!==op.space.id
    ||draft.duration!==String(detail.assessment.duration_minutes)
    ||JSON.stringify([...draft.invigilators].sort())!==JSON.stringify(op.invigilators.filter(row=>row.status!=='revoked').map(row=>row.user_id).sort());
}
export function mayAmendExamSchedule(detail:AssessmentDetail,now:string){return detail.viewer_role==='admin'&&detail.assessment.status==='scheduled'
  &&!!detail.exam_operation&&['ready','planning'].includes(detail.exam_operation.sitting.state)
  &&Date.parse(detail.exam_operation.sitting.starts_at)>Date.parse(now)&&detail.exam_operation.candidates.every(row=>row.attendance_status==='unrecorded')
  &&!detail.exam_operation.incidents.length;}
export function examSchedulePreviewPayload(detail:AssessmentDetail,workspace:AssessmentWorkspace,draft:ExamScheduleDraft,now:string){
  if(workspace.mode!=='admin'||!mayAmendExamSchedule(detail,now))throw new Error('Only a future, never-started examination can have its schedule revised.');
  if(!Number.isFinite(Date.parse(draft.scheduled))||Date.parse(draft.scheduled)<=Date.parse(now)||!/^\d+$/.test(draft.duration)
    ||Number(draft.duration)<1||Number(draft.duration)>1440||!workspace.references.spaces?.some(row=>row.id===draft.space))
    throw new Error('Choose a future time, a duration from 1 to 1440 minutes and a current examination room.');
  if(!draft.invigilators.length||draft.invigilators.length>20||new Set(draft.invigilators).size!==draft.invigilators.length
    ||draft.invigilators.some(id=>!workspace.references.staff.some(row=>row.id===id)))throw new Error('Choose current distinct invigilators.');
  if(draft.reason.trim().length<3||draft.reason.trim().length>1000)throw new Error('Explain why the published examination arrangements need to change.');
  return {expected_assessment_revision:detail.assessment.revision,expected_sitting_revision:detail.exam_operation!.sitting.revision,
    scheduled_at:new Date(draft.scheduled).toISOString(),duration_minutes:Number(draft.duration),space_id:draft.space,
    invigilator_user_ids:[...draft.invigilators].sort(),reason:draft.reason.trim()};
}
export function readExamSchedulePreview(value:unknown,detail:AssessmentDetail,payload:ReturnType<typeof examSchedulePreviewPayload>):ExamSchedulePreview{
  const row=object(value),previous=object(row?.previous),proposed=object(row?.proposed),op=detail.exam_operation;
  const same=(a:unknown,b:unknown)=>typeof a==='string'&&typeof b==='string'&&Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
  const ids=(v:unknown)=>Array.isArray(v)&&v.every(uuid)&&new Set(v).size===v.length;
  const selected=[...payload.invigilator_user_ids].sort(),old=op?.invigilators.filter(row=>row.status!=='revoked').map(row=>row.user_id).sort();
  if(!row||!previous||!proposed||!op||!same(previous.scheduled_at,op.sitting.starts_at)||!same(previous.ends_at,op.sitting.ends_at)||previous.space_id!==op.space.id
    ||!ids(previous.invigilator_user_ids)||JSON.stringify([...(previous.invigilator_user_ids as string[])].sort())!==JSON.stringify(old)
    ||!same(proposed.scheduled_at,payload.scheduled_at)||proposed.duration_minutes!==payload.duration_minutes||proposed.space_id!==payload.space_id
    ||!same(proposed.ends_at,new Date(Date.parse(payload.scheduled_at)+payload.duration_minutes*60000).toISOString())
    ||typeof proposed.space_name!=='string'||!proposed.space_name.trim()||!ids(proposed.invigilator_user_ids)
    ||JSON.stringify([...(proposed.invigilator_user_ids as string[])].sort())!==JSON.stringify(selected)
    ||row.candidate_count!==op.candidates.length||typeof row.can_publish!=='boolean'||typeof row.preview_hash!=='string'||!/^[a-f0-9]{64}$/.test(row.preview_hash)
    ||row.reason!==payload.reason||typeof row.confirmation_message!=='string'||!ids(row.reissued_invigilator_user_ids)||!ids(row.removed_invigilator_user_ids)
    ||(row.reissued_invigilator_user_ids as string[]).some(id=>!selected.includes(id))
    ||JSON.stringify([...(row.removed_invigilator_user_ids as string[])].sort())!==JSON.stringify(old!.filter(id=>!selected.includes(id)))
    ||!Array.isArray(row.blockers)||row.blockers.some(item=>{const blocker=object(item);return !blocker||typeof blocker.code!=='string'||typeof blocker.message!=='string';})
    ||row.can_publish!==(row.blockers.length===0))throw new Error('The schedule impact did not match this exact examination review. Refresh and review again.');
  return value as ExamSchedulePreview;
}
export function examScheduleAmendmentInput(detail:AssessmentDetail,schoolId:string,payload:ReturnType<typeof examSchedulePreviewPayload>,preview:ExamSchedulePreview):NativePendingInput{
  if(!preview.can_publish||!/^[a-f0-9]{64}$/.test(preview.preview_hash))throw new Error('Resolve the schedule conflicts before publishing.');
  return {endpoint:root(schoolId,detail.assessment.id)+'sitting/schedule-amendments/',body:{...payload,preview_hash:preview.preview_hash},serverKey:'command_id',
    source:{kind:'exam_schedule_revision',sourceId:detail.assessment.id,revision:detail.assessment.revision,fingerprint:detail.exam_operation!.sitting.id}};
}
export function examScheduleConfirmationInput(detail:AssessmentDetail,schoolId:string):NativePendingInput{
  if(detail.viewer_role!=='admin'||detail.assessment.status!=='scheduled'||detail.exam_operation?.schedule_state!=='awaiting_confirmation'
    ||!detail.exam_operation.readiness?.can_schedule)throw new Error('The revised schedule needs current invigilator acceptances and a clear readiness check.');
  return {endpoint:root(schoolId,detail.assessment.id)+'sitting/schedule-amendments/confirm/',serverKey:'command_id',
    body:{expected_assessment_revision:detail.assessment.revision,expected_sitting_revision:detail.exam_operation.sitting.revision,
      reason:'Confirmed the revised examination schedule after current readiness and invigilation checks.'},
    source:{kind:'exam_schedule_confirmation',sourceId:detail.assessment.id,revision:detail.assessment.revision,fingerprint:detail.exam_operation.sitting.id}};
}
export function examScheduleActionAllowed(action:NativePendingAction,scope:NativePendingScope){
  try{
    const source=action.source,body=action.payload.kind==='json'?object(JSON.parse(action.payload.body)):null;
    if(action.domain!=='assessments'||action.method!=='POST'||action.replayPolicy!=='same_request'||!source||!body
      ||!['exam_schedule_revision','exam_schedule_confirmation'].includes(source.kind)||!uuid(source.sourceId)||!uuid(source.fingerprint)
      ||!positive(source.revision)||body.command_id!==action.clientId||body.expected_assessment_revision!==source.revision
      ||!positive(body.expected_sitting_revision)||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>1000)return false;
    const base=root(scope.schoolId,source.sourceId),confirm=source.kind==='exam_schedule_confirmation';
    if(action.refreshPath!==base||action.endpoint!==base+'sitting/schedule-amendments/'+(confirm?'confirm/':''))return false;
    const keys=['command_id','expected_assessment_revision','expected_sitting_revision','reason'];
    if(confirm)return Object.keys(body).every(key=>keys.includes(key));
    return Object.keys(body).every(key=>[...keys,'scheduled_at','duration_minutes','space_id','invigilator_user_ids','preview_hash'].includes(key))
      &&typeof body.scheduled_at==='string'&&Number.isFinite(Date.parse(body.scheduled_at))&&positive(body.duration_minutes)&&Number(body.duration_minutes)<=1440
      &&uuid(body.space_id)&&Array.isArray(body.invigilator_user_ids)&&body.invigilator_user_ids.length>0&&body.invigilator_user_ids.length<=20
      &&new Set(body.invigilator_user_ids).size===body.invigilator_user_ids.length&&body.invigilator_user_ids.every(uuid)
      &&typeof body.preview_hash==='string'&&/^[a-f0-9]{64}$/.test(body.preview_hash);
  }catch{return false;}
}
export function examScheduleRefreshPath(value:unknown,action:NativePendingAction){
  const receipt=object(value),source=action.source,body=action.payload.kind==='json'?object(JSON.parse(action.payload.body)):null;
  if(!source||!body||!examScheduleActionAllowed(action,action.scope)||!receipt)throw new Error('The exact examination command could not be verified.');
  const assessment=object(receipt.assessment),sitting=object(receipt.sitting),confirm=source.kind==='exam_schedule_confirmation';
  if(!assessment||!sitting)throw new Error('The examination receipt omitted its source identities.');
  if(receipt.command_id!==action.clientId||assessment.id!==source.sourceId||assessment.school_id!==action.scope.schoolId
    ||assessment.status!=='scheduled'||assessment.revision!==source.revision+1||sitting?.id!==source.fingerprint
    ||sitting.school_id!==action.scope.schoolId||sitting.assessment_id!==source.sourceId||sitting.revision!==Number(body.expected_sitting_revision)+1
    ||sitting.state!==(confirm?'ready':'planning')||receipt.schedule_state!==(confirm?'ready':'awaiting_confirmation'))throw new Error('The schedule receipt did not match the exact reviewed command.');
  if(!confirm&&(sitting.space_id!==body.space_id||Date.parse(String(sitting.starts_at))!==Date.parse(String(body.scheduled_at))
    ||assessment.duration_minutes!==body.duration_minutes))throw new Error('The revised schedule did not match the reviewed time and room.');
  return root(action.scope.schoolId,source.sourceId);
}
export function assertExamScheduleAccepted(value:AssessmentDetail,action:NativePendingAction){
  const source=action.source,body=action.payload.kind==='json'?object(JSON.parse(action.payload.body)):null;
  if(!value.exam_operation)throw new Error('The current examination operation is unavailable.');
  if(!source||!body||value.viewer_role!=='admin'||value.assessment.id!==source.sourceId||value.assessment.revision<source.revision+1
    ||value.exam_operation?.sitting.id!==source.fingerprint||value.exam_operation.sitting.revision<Number(body.expected_sitting_revision)+1
    ||!value.exam_operation.schedule_history?.some(row=>row.command_key===action.clientId))throw new Error('The current examination history does not contain this accepted schedule command.');
}
export function definitiveExamScheduleRefusal(error:unknown,action:NativePendingAction){
  const outer=object(error),details=object(outer?.details),response=object(details?.error),fields=object(response?.fields),source=action.source;
  if(!source||action.payload.kind!=='json'||!examScheduleActionAllowed(action,action.scope))return false;
  const body=JSON.parse(action.payload.body) as Record<string,unknown>;
  return outer?.status===409&&response?.code==='exam_schedule_command_refused'&&fields?.command_id===action.clientId
    &&fields.school_id===action.scope.schoolId&&fields.actor_user_id===action.scope.actorId&&fields.assessment_id===source.sourceId
    &&fields.sitting_id===source.fingerprint&&fields.action===(source.kind==='exam_schedule_revision'?'amend':'confirm')
    &&fields.expected_assessment_revision===body.expected_assessment_revision&&fields.expected_sitting_revision===body.expected_sitting_revision;
}
