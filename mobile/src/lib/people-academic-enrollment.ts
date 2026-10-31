import type { EnrollmentOption } from './people-lifecycle';
import { isPeopleDate } from './people-policy';
import type { NativePendingAction } from './native-pending-action';

export type StudentIntakeGuardian={mode:'existing';id:string}|{mode:'new';first_name:string;last_name:string;phone:string;email:string}|null;
export interface StudentIntakeInput {school_id:string;first_name:string;last_name:string;admission_number:string;date_of_birth:string|null;class_section_id:string;term_id:string;roll_number:number;enrolled_on:string;guardian:StudentIntakeGuardian;relationship:'mother'|'father'|'guardian';can_authorize_leave:boolean}
export interface StudentIntakeReview {id:string;expires_at:string;input:StudentIntakeInput;class_name:string;term_name:string;guardian:{id:string;name:string;phone:string}|null;warnings:string[]}
export interface RetainedStudentIntake {version:1;scopeKey:string;fingerprint:string;review:StudentIntakeReview}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object=(value:unknown):Record<string,unknown>|null=>!!value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const only=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).every(key=>keys.includes(key));

export function studentIntakeInput(values:{schoolId:string;first:string;last:string;admission:string;birth:string;date:string;roll:string;option:EnrollmentOption;guardian:StudentIntakeGuardian;relationship:StudentIntakeInput['relationship'];leave:boolean}):StudentIntakeInput{
 const {option}=values,first=values.first.trim(),last=values.last.trim(),admission=values.admission.trim().toUpperCase(),roll=Number(values.roll);
 if(!uuid(values.schoolId)||!uuid(option.class_section_id)||!uuid(option.term_id)||!first||first.length>150||last.length>150||!/^[A-Z0-9/-]{2,64}$/.test(admission)||!Number.isSafeInteger(roll)||roll<1||roll>32767||!isPeopleDate(values.date)||values.date<option.starts_on||values.date>option.ends_on||values.birth&&(!isPeopleDate(values.birth)||values.birth<'1900-01-01'||values.birth>=values.date||values.birth>option.today)||!['mother','father','guardian'].includes(values.relationship)||!values.guardian&&values.leave)throw new Error('Review the learner’s name, admission number, dates, class, roll and guardian permission.');
 let guardian=values.guardian;
 if(guardian?.mode==='new'){guardian={mode:'new',first_name:guardian.first_name.trim(),last_name:guardian.last_name.trim(),phone:guardian.phone.trim(),email:guardian.email.trim()};if(!guardian.first_name||guardian.first_name.length>150||guardian.last_name.length>150||!/^\+?[0-9 ()-]{7,25}$/.test(guardian.phone)||guardian.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardian.email))throw new Error('Enter the guardian’s name, contact phone and a valid optional email.');}
 if(guardian?.mode==='existing'&&!uuid(guardian.id))throw new Error('Choose the exact existing guardian from the current campus search.');
 return {school_id:values.schoolId,first_name:first,last_name:last,admission_number:admission,date_of_birth:values.birth||null,class_section_id:option.class_section_id,term_id:option.term_id,roll_number:roll,enrolled_on:values.date,guardian,relationship:values.relationship,can_authorize_leave:values.leave};
}

export function validStudentIntakeReview(value:unknown,schoolId:string,expected?:StudentIntakeInput):value is StudentIntakeReview{
 const review=object(value),input=object(review?.input),guardian=object(input?.guardian),summary=object(review?.guardian);
 if(!review||!input||!uuid(review.id)||!Number.isFinite(Date.parse(String(review.expires_at)))||input.school_id!==schoolId||!only(input,['school_id','first_name','last_name','admission_number','date_of_birth','class_section_id','term_id','roll_number','enrolled_on','guardian','relationship','can_authorize_leave'])||typeof input.first_name!=='string'||!input.first_name.trim()||input.first_name.length>150||typeof input.last_name!=='string'||input.last_name.length>150||typeof input.admission_number!=='string'||!/^[A-Z0-9/-]{2,64}$/.test(input.admission_number)||!uuid(input.class_section_id)||!uuid(input.term_id)||!Number.isSafeInteger(input.roll_number)||Number(input.roll_number)<1||Number(input.roll_number)>32767||!isPeopleDate(String(input.enrolled_on))||input.date_of_birth!==null&&!isPeopleDate(String(input.date_of_birth))||!['mother','father','guardian'].includes(String(input.relationship))||typeof input.can_authorize_leave!=='boolean'||typeof review.class_name!=='string'||typeof review.term_name!=='string'||!Array.isArray(review.warnings)||!review.warnings.every(w=>typeof w==='string'))return false;
 if(input.guardian===null){if(review.guardian!==null||input.can_authorize_leave)return false;}
 else if(!guardian||!summary||typeof summary.name!=='string'||typeof summary.phone!=='string')return false;
 else if(guardian.mode==='existing'){if(!only(guardian,['mode','id'])||!uuid(guardian.id)||summary.id!==guardian.id)return false;}
 else if(guardian.mode==='new'){if(!only(guardian,['mode','first_name','last_name','phone','email'])||typeof guardian.first_name!=='string'||!guardian.first_name.trim()||guardian.first_name.length>150||typeof guardian.last_name!=='string'||guardian.last_name.length>150||typeof guardian.phone!=='string'||!/^\+?[0-9 ()-]{7,25}$/.test(guardian.phone)||typeof guardian.email!=='string'||guardian.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardian.email)||summary.id!==''||summary.name!==`${guardian.first_name} ${guardian.last_name}`.trim()||summary.phone!==guardian.phone)return false;}
 else return false;
 return !expected||Object.entries(expected).every(([key,entry])=>JSON.stringify(input[key])===JSON.stringify(entry));
}
export function validRetainedStudentIntake(value:unknown,scopeKey:string,schoolId:string):value is RetainedStudentIntake{const record=object(value);return !!record&&record.version===1&&record.scopeKey===scopeKey&&typeof record.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(record.fingerprint)&&validStudentIntakeReview(record.review,schoolId);}

export function studentIntakeRefreshPath(value:unknown,action:NativePendingAction,retained:RetainedStudentIntake|null){
 const result=object(value);
 if(!retained||action.source?.kind!=='enrollment_review'||action.source.sourceId!==retained.review.id||action.source.fingerprint!==retained.fingerprint||!result||!uuid(result.student_id)||!uuid(result.person_id))throw new Error('The receipt did not match the exact retained enrollment review.');
 return `/api/v1/schools/${action.scope.schoolId}/people/participants/${result.person_id}?${new URLSearchParams({student_id:result.student_id,intake_review:retained.review.id})}`;
}
export function studentIntakeAcceptedPerson(value:unknown,action:NativePendingAction,retained:RetainedStudentIntake|null){
 const url=new URL(action.refreshPath,'https://thatcampus.invalid'),personId=url.pathname.split('/').at(-1),studentId=url.searchParams.get('student_id'),person=object(value);
 if(!retained||action.source?.kind!=='enrollment_review'||action.source.sourceId!==retained.review.id||action.source.fingerprint!==retained.fingerprint||url.searchParams.getAll('student_id').length!==1||url.searchParams.getAll('intake_review').length!==1||url.searchParams.get('intake_review')!==retained.review.id||!uuid(personId)||!uuid(studentId)||url.pathname!==`/api/v1/schools/${action.scope.schoolId}/people/participants/${personId}`||!person||person.id!==personId||!Number.isSafeInteger(person.revision)||Number(person.revision)<1||!Array.isArray(person.source_profiles)||!person.source_profiles.some(source=>{const profile=object(source);return profile?.kind==='learning'&&profile.id===studentId;})||person.revision===1&&(person.first_name!==retained.review.input.first_name||person.last_name!==retained.review.input.last_name))throw new Error('The exact enrolled learner and canonical person could not be confirmed.');
 return {studentId,personId};
}
export function studentIntakeEnrollmentMatches(value:unknown,retained:RetainedStudentIntake){
 const lifecycle=object(value),input=retained.review.input,history=lifecycle?.history;
 return Array.isArray(history)&&history.some(value=>{const row=object(value);return row&&uuid(row.id)&&row.class_section_id===input.class_section_id&&row.term_id===input.term_id&&row.roll_number===input.roll_number&&row.enrolled_on===input.enrolled_on;});
}
