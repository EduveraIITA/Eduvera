/** Audit text must originate in user messages, not model/tool output.
 * The model interprets the conversation into a structured call. The API resolves
 * identity, validates the state and presents an immutable review. Never silently
 * rewrite a learner, date or status using natural-language regexes.
 */
const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim().replace(/[.!?]+$/,'');

export function attendanceArguments(value:unknown,userMessages:readonly string[]):unknown {
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const input={...value as Record<string,unknown>};
  if(!('status' in input))return input;
  for(const field of ['reason','remarks']) {
    if(typeof input[field]!=='string')continue;
    const proposed=normalize(input[field]);
    // Blank notes are not evidence of a request to erase an existing note.
    if(!proposed||!userMessages.some(message=>normalize(message).includes(proposed)))delete input[field];
  }
  return input;
}
