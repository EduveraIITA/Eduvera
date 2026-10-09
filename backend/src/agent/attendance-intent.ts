import type { RecordReference } from './references.js';
import { schoolDate } from './references.js';

const normalized=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const statusPattern='present|presence|absent|late|excused|half[ -]?day';
const normalizeStatus=(value:string)=>value.toLowerCase().replace(/[ -]/g,'_')==='presence'?'present':value.toLowerCase().replace(/[ -]/g,'_');

export function explicitAttendanceStatus(question:string):string|undefined {
  for(const message of question.split('\n').reverse()) {
    const command=message.match(new RegExp(`\\b(?:mark|record)\\s+[\\p{L}\\p{N}'’ .-]+?\\s+(?:as\\s+)?(${statusPattern})\\b`,'iu'))
      ?? message.match(new RegExp(`\\b(?:change|update|correct|set)\\s+(?:the\\s+)?[\\p{L}\\p{N}'’ .-]+?\\s+(?:attendance|attendence|attendent|status)\\s+(?:to|as)\\s+(${statusPattern})\\b`,'iu'))
      ?? message.match(new RegExp(`\\b(?:change|update|correct|set)\\s+(?:the\\s+)?(?:attendance|attendence|attendent|status)\\s+(?:of|for)\\s+[\\p{L}\\p{N}'’ .-]+?\\s+(?:to|as)\\s+(${statusPattern})\\b`,'iu'));
    const value=command?.[1]??message.match(new RegExp(`\\b(${statusPattern})\\b`,'iu'))?.[1];
    if(value)return normalizeStatus(value);
  }
  return undefined;
}

export function explicitAttendanceStudent(question:string):string|undefined {
  for(const message of question.split('\n').reverse()) {
    const direct=message.match(new RegExp(`^(?:please\\s+)?(?:(?:can|could|would) you\\s+)?(?:please\\s+)?(?:mark|record)\\s+([\\p{L}\\p{N}'’ .-]+?)\\s+(?:as\\s+)?(?:${statusPattern})\\b`,'iu'))?.[1]
      ?? message.match(new RegExp(`\\b(?:change|update|correct|set)\\s+(?:the\\s+)?([\\p{L}\\p{N}'’ .-]+?)\\s+(?:attendance|attendence|attendent|status)\\s+(?:to|as)\\s+(?:${statusPattern})\\b`,'iu'))?.[1]
      ?? message.match(new RegExp(`\\b(?:change|update|correct|set)\\s+(?:the\\s+)?(?:attendance|attendence|attendent|status)\\s+(?:of|for)\\s+([\\p{L}\\p{N}'’ .-]+?)\\s+(?:to|as)\\s+(?:${statusPattern})\\b`,'iu'))?.[1];
    const name=direct?.trim()
      .replace(/^(?:the\s+)?(?:one\s+)?(?:student|learner)\s+/i,'')
      .replace(/\s+from\s+class\s+[\p{L}\p{N} -]+$/iu,'')
      .replace(/^the\s+/i,'')
      // Natural action wording commonly uses “Aarav Sharma's attendance”.
      // Possession is grammar, not part of the learner's lookup identity.
      .replace(/(?:['’]s|s['’])$/iu,'');
    if(name&&!/^(?:him|her|them|his|their|he|she|they|that student|this student|everyone|all)$/i.test(name))return name;
  }
  return undefined;
}

export function isBulkAttendanceRequest(question:string) {
  return /\b(?:all|every|whole|entire|full)\s+(?:the\s+)?(?:class|roster|students?|learners?)\b/i.test(question);
}

export function allowsAttendanceWrite(capability:string,question:string,answeringReason=false) {
  if(capability==='record_attendance')return isBulkAttendanceRequest(question);
  if(capability!=='record_student_attendance')return true;
  return !isBulkAttendanceRequest(question)&&(answeringReason||Boolean(explicitAttendanceStatus(question)&&(/\b(?:mark|record|change|update|correct|set)\b/i.test(question)||/\b(?:he|she|they|him|her|them|his|their|student|learner)\b/i.test(question))));
}

export function attendanceActionGroundingError(capability:string,input:Record<string,unknown>,question:string,basis:unknown,answeringReason=false):string|undefined {
  if(capability==='record_attendance'&&!isBulkAttendanceRequest(question))return 'A whole-class register can only be prepared when the current message explicitly says all, every, whole, entire or full class/roster. Restate the exact class-wide observation.';
  if(capability!=='record_student_attendance')return undefined;
  if(!allowsAttendanceWrite(capability,question,answeringReason))return 'The user-authored conversation must identify the student and attendance status before this change can be prepared.';
  const body=(input.body??{}) as Record<string,unknown>;
  const requestedStatus=explicitAttendanceStatus(question);
  if(requestedStatus&&body.status!==requestedStatus)return `The proposed attendance status does not match the current request (${requestedStatus}).`;
  const requestedStudent=explicitAttendanceStudent(question);
  const selected=(basis as {selected?:{student?:{name?:string;admission_number?:string}}}|undefined)?.selected?.student;
  if(requestedStudent&&selected) {
    const requested=normalized(requestedStudent);
    const labels=[selected.name,selected.admission_number].filter((item):item is string=>typeof item==='string').map(normalized);
    if(!labels.some(label=>label.includes(requested)||requested.includes(label)))return 'The proposed student does not match the student named in the current request.';
  }
  return undefined;
}
/** Ground optional lookup filters in the user's request. A small local model can
 * otherwise invent e.g. "Class 10" and turn a valid student into a missing record.
 * This only prepares a read/preview; it never infers an observation or executes.
 */
export function attendanceArguments(value:unknown,question:string,references:readonly RecordReference[],timezone:string,answeringReason=false):unknown {
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const input={...value as Record<string,unknown>};
  // Current-turn names and statuses override model arguments. Conversation
  // history can resolve a pronoun, but can never replace an explicit new target.
  const named=explicitAttendanceStudent(question);
  if(named)input.student=named;
  if(typeof input.student==='string'&&/^(him|her|them|his|their|he|she|that student|this student)$/i.test(input.student)){
    const students=[...new Map(references.filter(ref=>ref.kind==='student').map(ref=>[ref.id,ref])).values()];
    if(students.length===1)input.student=students[0]!.id;
  }
  if(typeof input.class_name==='string'&&!normalized(question).includes(normalized(input.class_name.replace(/^class\s*/i,''))))delete input.class_name;
  if(/\btoday\b/i.test(question)&&!/(?:not|except)\s+today/i.test(question))input.date=schoolDate(timezone);
  if(!('status' in input))return input;
  const status=explicitAttendanceStatus(question);
  if(status)input.status=status;
  // A model-generated "user requested it" is not an explanation for correcting
  // an existing observation. Preserve the actual user-supplied explanation.
  const reason=question.match(/\b(?:correction\s+)?reason\s*:?\s+(.+)$/i)?.[1]
    ??question.match(/\bbecause\s+(.+)$/i)?.[1]
    ??question.match(/\b((?:accidentally|accidently|mistakenly)\b[^.!?]*)/i)?.[1]
    ??question.match(/\b([^.!?]*\bby mistake)\b/i)?.[1];
  if(reason)input.reason=reason.trim();
  else if(answeringReason&&!/^(yes|no|ok|okay|sure|do it|please)[.! ]*$/i.test(question))input.reason=question.trim();
  else delete input.reason;
  const remarks=question.match(/\b(?:remarks?|note)\s*:\s*(.*)$/i)?.[1];
  if(remarks!==undefined)input.remarks=remarks.trim();
  else if(/\b(?:clear|remove|delete)\b.*\b(?:remarks?|note)\b/i.test(question))input.remarks='';
  else delete input.remarks;
  return input;
}
