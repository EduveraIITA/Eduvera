import type { ImportDetail, ImportReceipt, ImportRow, ImportValues, ImportGuardianChoice } from '../../../packages/contracts/src/wire/features/people/import-api';
import type { NativePendingAction, NativePendingInput, NativePendingScope } from './native-pending-action';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
// Wire columns owned by the enrollment importer. Do not load its browser API module.
const importColumns = ['admission_number','first_name','last_name','date_of_birth','class','roll_number','enrolled_on','guardian_key','guardian_first_name','guardian_last_name','guardian_phone','guardian_email','relationship'] as const;
const only = (value: Record<string,unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
export const peopleAcademicImportsRoot = '/api/v1/people/imports';
export const peopleAcademicImportPath = (school: string, id?: string) => `${peopleAcademicImportsRoot}${id ? `/${encodeURIComponent(id)}` : ''}?${new URLSearchParams({school_id:school})}`;
export const peopleAcademicImportColumns = [...importColumns];
export function peopleAcademicImportUpload(school: string, term: string, filename: string, csv: string): NativePendingInput {
  if (!uuid(school) || !uuid(term) || !filename.trim() || filename.length > 150 || /[\u0000-\u001f/\\]/.test(filename) || !csv.trim() || new TextEncoder().encode(csv).byteLength > 512*1024 || csv.includes('\0')) throw new Error('Choose a current term and a UTF-8 CSV of at most 512 KiB with a plain filename.');
  return {endpoint:peopleAcademicImportsRoot,body:{school_id:school,term_id:term,filename:filename.trim(),csv},serverKey:'idempotency_key',source:{kind:'student_import_upload',sourceId:school,revision:0}};
}
function importMeta(job: ImportDetail) {
  const review = job.review;
  if (!validPeopleAcademicImport(job,job.id) || job.state !== 'draft' || !review) throw new Error('Open the current server-reviewed import before changing enrollment.');
  return {validationToken:review.validation_token,rows:review.rows.filter(row => row.decision === 'include').map(row => ({row:row.row_number,admission:row.values.admission_number.trim().toUpperCase()})),personGuardians:new Set(review.rows.filter(row=>row.decision==='include' && row.guardian_choice.mode==='person').map(row=>row.guardian_choice.mode==='person'?row.guardian_choice.person_id:'')).size,summary:review.summary};
}
export function peopleAcademicImportCommit(school: string, job: ImportDetail): NativePendingInput {
  const meta=importMeta(job);
  if (!uuid(school) || !uuid(job.id) || !meta.rows.length || meta.summary.errors || meta.rows.length !== meta.summary.included) throw new Error('Correct or skip invalid rows, then review the exact included batch.');
  return {endpoint:`${peopleAcademicImportsRoot}/${job.id}/commit`,body:{school_id:school,expected_revision:job.revision,validation_token:meta.validationToken,verified:true},serverKey:null,replayPolicy:'same_request',source:{kind:'student_import_commit',sourceId:job.id,revision:job.revision,fingerprint:JSON.stringify(meta)}};
}
export function peopleAcademicImportCancel(school: string,job: ImportDetail): NativePendingInput {importMeta(job);return {endpoint:`${peopleAcademicImportsRoot}/${job.id}/cancel`,body:{school_id:school,expected_revision:job.revision},serverKey:null,replayPolicy:'same_request',source:{kind:'student_import_cancel',sourceId:job.id,revision:job.revision}};}
export function peopleAcademicImportRow(school: string,job: ImportDetail,row: ImportRow,values: ImportValues,decision: ImportRow['decision'],guardian: ImportGuardianChoice): NativePendingInput {
  importMeta(job);
  if (!job.review?.rows.some(value=>value.row_number===row.row_number) || !['include','skip'].includes(decision)) throw new Error('Choose one row from the exact current import.');
  if (decision==='include' && values.person_id && (!uuid(values.person_id) || !positive(Number(values.person_revision)) || guardian.mode==='new') || guardian.mode==='existing' && !uuid(guardian.id) || guardian.mode==='person' && (!values.person_id || !uuid(guardian.person_id) || !positive(guardian.expected_revision))) throw new Error('Review the exact learner and guardian identities before saving this row.');
  const normalized=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value?.trim()??''])) as ImportValues;
  // The importer gives optional CSV guardian references precedence. Bind those
  // columns to the explicit picker choice so an old CSV reference cannot win.
  delete normalized.guardian_person_id;delete normalized.guardian_person_revision;
  if(guardian.mode==='person'){normalized.guardian_person_id=guardian.person_id;normalized.guardian_person_revision=String(guardian.expected_revision);}
  if(Object.values(normalized).some(value=>typeof value!=='string'||value.length>500||value.includes('\0')))throw new Error('CSV row values must be text of at most 500 characters without null characters.');
  return {endpoint:`${peopleAcademicImportsRoot}/${job.id}/rows/${row.row_number}`,body:{school_id:school,expected_revision:job.revision,values:normalized,decision,guardian_choice:guardian},serverKey:null,replayPolicy:'inspect_only',source:{kind:'student_import_row',sourceId:job.id,revision:job.revision,fingerprint:String(row.row_number)}};
}
export function validPeopleAcademicImport(value: unknown,id: string): value is ImportDetail {
 const item=object(value);if(!item || item.id!==id || !uuid(id) || !positive(item.revision) || !['draft','committed','cancelled','expired'].includes(String(item.state)) || !Number.isSafeInteger(item.row_count) || Number(item.row_count)<1 || Number(item.row_count)>500 || typeof item.filename!=='string' || !Number.isFinite(Date.parse(String(item.expires_at))) || !Number.isFinite(Date.parse(String(item.created_at))))return false;
 if(item.state!=='draft'){
  if(item.review!==null)return false;
  if(item.state!=='committed')return item.receipt===null;
  const receipt=object(item.receipt),rows=receipt?.enrolled;
  return !!receipt&&receipt.import_id===id&&['students','guardians_created','guardians_reused','skipped','registers_reopened'].every(key=>nonnegative(receipt[key]))&&Number(receipt.students)+Number(receipt.skipped)===item.row_count&&Number(receipt.guardians_created)+Number(receipt.guardians_reused)<=Number(receipt.students)&&Array.isArray(rows)&&rows.length===receipt.students&&new Set(rows.map(value=>object(value)?.student_id)).size===rows.length&&new Set(rows.map(value=>object(value)?.row_number)).size===rows.length&&rows.every(value=>{const row=object(value);return row&&uuid(row.student_id)&&Number.isSafeInteger(row.row_number)&&Number(row.row_number)>=2&&Number(row.row_number)<=501&&typeof row.admission_number==='string'&&/^[A-Z0-9/-]{2,64}$/.test(row.admission_number);});
 }
 if(item.receipt!==null)return false;
 const review=object(item.review),summary=object(review?.summary),term=object(review?.term),rows=review?.rows,classes=review?.classes;
 if(!review||!summary||!term||!uuid(term.id)||typeof term.name!=='string'||!['today','starts_on','ends_on'].every(key=>typeof term[key]==='string')||typeof review.validation_token!=='string'||!/^[a-f0-9]{64}$/.test(review.validation_token)||!Array.isArray(rows)||rows.length!==item.row_count||!Array.isArray(classes)||!classes.every(value=>{const row=object(value);return row&&uuid(row.id)&&typeof row.label==='string'&&typeof row.room==='string';})||!['total','included','skipped','errors','warnings','new_guardians','existing_guardians','registers_reopened'].every(key=>nonnegative(summary[key]))||summary.total!==rows.length||Number(summary.included)+Number(summary.skipped)!==rows.length||new Set(rows.map(value=>object(value)?.row_number)).size!==rows.length)return false;
 return rows.every(value=>{const row=object(value),values=object(row?.values),guardian=object(row?.guardian_choice);return row&&Number.isSafeInteger(row.row_number)&&Number(row.row_number)>=2&&Number(row.row_number)<=501&&['include','skip'].includes(String(row.decision))&&!!values&&importColumns.every(key=>typeof values[key]==='string'&&String(values[key]).length<=500)&&!!guardian&&((guardian.mode==='new'||guardian.mode==='none')&&only(guardian,['mode'])||guardian.mode==='existing'&&uuid(guardian.id)&&only(guardian,['mode','id'])||guardian.mode==='person'&&uuid(guardian.person_id)&&positive(guardian.expected_revision)&&only(guardian,['mode','person_id','expected_revision']))&&Array.isArray(row.errors)&&row.errors.every(v=>typeof v==='string')&&Array.isArray(row.warnings)&&row.warnings.every(v=>typeof v==='string')&&typeof row.class_name==='string'&&typeof row.guardian_name==='string';});
}
function verifyReceipt(value: unknown,action: NativePendingAction): asserts value is ImportReceipt {
  const item=object(value),meta=object(JSON.parse(action.source?.fingerprint ?? 'null')),summary=object(meta?.summary),rows=meta?.rows;
  const extra=meta?.personGuardians;
  // Canonical guardian attachment may create or reuse a guardian profile. The
  // preview deliberately counts only new/existing choices, so retain its bound.
  if(!item || !summary || !nonnegative(extra) || !Array.isArray(rows) || item.import_id!==action.source?.sourceId || item.students!==rows.length || item.students!==summary.included || !nonnegative(item.guardians_created) || !nonnegative(item.guardians_reused) || !nonnegative(summary.new_guardians) || !nonnegative(summary.existing_guardians) || item.guardians_created<summary.new_guardians || item.guardians_created>summary.new_guardians+extra || item.guardians_reused<summary.existing_guardians || item.guardians_reused>summary.existing_guardians+extra || item.guardians_created+item.guardians_reused>summary.new_guardians+summary.existing_guardians+extra || item.skipped!==summary.skipped || item.registers_reopened!==summary.registers_reopened || !Array.isArray(item.enrolled) || item.enrolled.length!==rows.length || new Set(item.enrolled.map(value=>object(value)?.student_id)).size!==rows.length || new Set(item.enrolled.map(value=>object(value)?.row_number)).size!==rows.length)throw new Error('The import receipt did not match the original reviewed batch.');
  for(const expected of rows){const row=object(expected),saved=item.enrolled.map(object).find(value=>value?.row_number===row?.row);if(!row || !saved || !uuid(saved.student_id) || saved.admission_number!==row.admission)throw new Error('The import receipt did not identify every exact reviewed enrollment.');}
}
export function peopleAcademicImportRefreshPath(value: unknown,action: NativePendingAction) {
  const source=action.source,item=object(value);if(!source || !item)throw new Error('The import response could not be confirmed.');
  if(source.kind==='student_import_upload' && action.endpoint===peopleAcademicImportsRoot){if(!uuid(item.id))throw new Error('The uploaded draft did not return its exact source ID.');return peopleAcademicImportPath(action.scope.schoolId,item.id);}
  if(source.kind==='student_import_commit'){verifyReceipt(value,action);return peopleAcademicImportPath(action.scope.schoolId,source.sourceId);}
  if(source.kind==='student_import_cancel'){if(item.state!=='cancelled')throw new Error('Discarding this exact draft was not confirmed.');return peopleAcademicImportPath(action.scope.schoolId,source.sourceId);}
  if(source.kind==='student_import_row'){if(item.revision!==source.revision+1)throw new Error('The row response did not confirm the next exact import revision.');return peopleAcademicImportPath(action.scope.schoolId,source.sourceId);}
  throw new Error('This import action needs its owning result verifier.');
}
export function peopleAcademicImportAccepted(value: unknown,action: NativePendingAction): ImportDetail {
  const read=new URL(action.refreshPath,'https://thatcampus.invalid'),id=read.pathname.slice(peopleAcademicImportsRoot.length+1),source=action.source!,body=action.payload.kind==='json'?JSON.parse(action.payload.body):null;
  if(!uuid(id) || !validPeopleAcademicImport(value,id))throw new Error('The refreshed import did not match the accepted source.');
  if(source.kind==='student_import_upload' && (value.filename!==body.filename || value.review && value.review.term.id!==body.term_id))throw new Error('The saved upload did not match the original filename and term.');
  if(source.kind==='student_import_commit'){if(value.state!=='committed' || value.revision!==source.revision+1)throw new Error('The accepted batch is not confirmed in its owning source.');verifyReceipt(value.receipt,action);}
  if(source.kind==='student_import_cancel' && value.state!=='cancelled')throw new Error('This exact draft is not confirmed discarded.');
  if(source.kind==='student_import_row' && value.revision<source.revision+1)throw new Error('The source has not reached the accepted row revision.');
  if(source.kind==='student_import_row'&&value.revision===source.revision+1&&value.review){const row=value.review.rows.find(row=>String(row.row_number)===source.fingerprint);if(!row||row.decision!==body.decision||JSON.stringify(row.guardian_choice)!==JSON.stringify(body.guardian_choice)||!Object.entries(body.values).every(([key,entry])=>row.values[key as keyof ImportValues]===entry))throw new Error('The saved row did not match the exact reviewed correction.');}
  return value;
}
export function nativePeopleAcademicImportAllowed(record: NativePendingAction,scope: NativePendingScope) {
  try{
    if(record.domain!=='people' || record.method!=='POST' || record.payload.kind!=='json' || !record.source)return false;
    const body=object(JSON.parse(record.payload.body)),source=record.source,read=new URL(record.refreshPath,'https://thatcampus.invalid');
    if(!body || body.school_id!==scope.schoolId || read.origin!=='https://thatcampus.invalid' || read.searchParams.getAll('school_id').length!==1 || read.searchParams.get('school_id')!==scope.schoolId || [...read.searchParams.keys()].some(key=>key!=='school_id'))return false;
    if(record.endpoint===peopleAcademicImportsRoot)return source.kind==='student_import_upload' && source.sourceId===scope.schoolId && source.revision===0 && record.replayPolicy==='same_request' && body.idempotency_key===record.clientId && only(body,['school_id','term_id','filename','csv','idempotency_key']) && uuid(body.term_id) && typeof body.csv==='string' && body.csv.trim().length>0 && !body.csv.includes('\0') && new TextEncoder().encode(body.csv).byteLength<=512*1024 && typeof body.filename==='string' && body.filename.length>0 && body.filename.trim()===body.filename && body.filename.length<=150 && !/[\u0000-\u001f/\\]/.test(body.filename) && (record.phase==='accepted'?read.pathname.startsWith(peopleAcademicImportsRoot+'/')&&uuid(read.pathname.slice(peopleAcademicImportsRoot.length+1)):read.pathname===peopleAcademicImportsRoot);
    const match=/^\/api\/v1\/people\/imports\/([0-9a-f-]{36})\/(commit|cancel|rows\/([1-9]\d{0,2}))$/i.exec(record.endpoint);
    if(!match || !uuid(match[1]) || source.sourceId!==match[1] || !positive(source.revision) || body.expected_revision!==source.revision || read.pathname!==`${peopleAcademicImportsRoot}/${source.sourceId}`)return false;
    if(match[2]==='commit'){const meta=object(JSON.parse(source.fingerprint ?? 'null')),summary=object(meta?.summary),rows=meta?.rows;return !!meta && !!summary && source.kind==='student_import_commit' && record.replayPolicy==='same_request' && only(body,['school_id','expected_revision','validation_token','verified']) && body.verified===true && /^[a-f0-9]{64}$/.test(String(body.validation_token)) && meta.validationToken===body.validation_token && Array.isArray(rows) && rows.length>0 && rows.length<=500 && rows.every(value=>{const row=object(value);return row&&Number.isSafeInteger(row.row)&&Number(row.row)>=2&&Number(row.row)<=501&&typeof row.admission==='string'&&/^[A-Z0-9/-]{2,64}$/.test(row.admission);}) && new Set(rows.map(value=>object(value)?.row)).size===rows.length && nonnegative(meta.personGuardians) && meta.personGuardians<=rows.length && summary.included===rows.length && summary.errors===0 && ['total','included','skipped','errors','warnings','new_guardians','existing_guardians','registers_reopened'].every(key=>nonnegative(summary[key]));}
    if(match[2]==='cancel')return source.kind==='student_import_cancel' && record.replayPolicy==='same_request' && only(body,['school_id','expected_revision']);
    const values=object(body.values),guardian=object(body.guardian_choice);
    const guardianValid=!!guardian && ((guardian.mode==='new' || guardian.mode==='none') && only(guardian,['mode']) || guardian.mode==='existing' && only(guardian,['mode','id']) && uuid(guardian.id) || guardian.mode==='person' && only(guardian,['mode','person_id','expected_revision']) && uuid(guardian.person_id) && positive(guardian.expected_revision));
    return source.kind==='student_import_row' && source.fingerprint===match[3] && Number(match[3])>=2 && Number(match[3])<=501 && record.replayPolicy==='inspect_only' && only(body,['school_id','expected_revision','values','decision','guardian_choice']) && ['include','skip'].includes(String(body.decision)) && !!values && only(values,[...importColumns,'person_id','person_revision','guardian_person_id','guardian_person_revision']) && Object.values(values).every(value=>typeof value==='string' && value.length<=500 && value.trim()===value && !value.includes('\0')) && importColumns.every(key=>typeof values[key]==='string') && guardianValid && (guardian?.mode==='person'?values.guardian_person_id===guardian.person_id&&values.guardian_person_revision===String(guardian.expected_revision):!values.guardian_person_id&&!values.guardian_person_revision);
  }catch{return false;}
}
