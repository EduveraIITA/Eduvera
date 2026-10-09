import type { RecordReference } from './references.js';
import { schoolDate } from './references.js';

const normalized=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/** Ground optional lookup filters in the user's request. A small local model can
 * otherwise invent e.g. "Class 10" and turn a valid student into a missing record.
 * This only prepares a read/preview; it never infers an observation or executes.
 */
export function attendanceArguments(value:unknown,question:string,references:readonly RecordReference[],timezone:string,answeringReason=false):unknown {
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const input={...value as Record<string,unknown>};
  // Unambiguous imperative grammar: in "Mark Mark Sharma present", the first
  // Mark is the verb and the second is part of the name. Do not strip names blindly.
  const named=question.match(/^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:mark|record)\s+([\p{L}\p{N}'’ .-]+?)\s+(?:as\s+)?(?:present|absent|late|excused|half[ -]day)\b/iu)?.[1]?.trim().replace(/^(?:one\s+)?(?:student|learner)\s+/i,'');
  if(named&&!/\b(him|her|them|his|their|everyone|all|students?|learners?|attendance|class|me|my|not)\b/i.test(named))input.student=named;
  if(typeof input.student==='string'&&/^(him|her|them|his|their|he|she|that student|this student)$/i.test(input.student)){
    const students=[...new Map(references.filter(ref=>ref.kind==='student').map(ref=>[ref.id,ref])).values()];
    if(students.length===1)input.student=students[0]!.id;
  }
  if(typeof input.class_name==='string'&&!normalized(question).includes(normalized(input.class_name.replace(/^class\s*/i,''))))delete input.class_name;
  if(/\btoday\b/i.test(question)&&!/(?:not|except)\s+today/i.test(question))input.date=schoolDate(timezone);
  if(!('status' in input))return input;
  // A model-generated "user requested it" is not an explanation for correcting
  // an existing observation. Preserve the actual user-supplied explanation.
  const reason=question.match(/\b(?:correction\s+)?reason\s*:?\s+(.+)$/i)?.[1]??question.match(/\bbecause\s+(.+)$/i)?.[1];
  if(reason)input.reason=reason.trim();
  else if(answeringReason&&!/^(yes|no|ok|okay|sure|do it|please)[.! ]*$/i.test(question))input.reason=question.trim();
  else delete input.reason;
  const remarks=question.match(/\b(?:remarks?|note)\s*:\s*(.*)$/i)?.[1];
  if(remarks!==undefined)input.remarks=remarks.trim();
  else if(/\b(?:clear|remove|delete)\b.*\b(?:remarks?|note)\b/i.test(question))input.remarks='';
  else delete input.remarks;
  return input;
}
