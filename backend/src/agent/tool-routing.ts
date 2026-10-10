// Intent vocabulary routes to small, coherent tool sets. Whole tokens avoid
// accidental matches such as "his" -> "history" or "mark present" -> marks.
const topics: Record<string,string[]> = {
  attendance: ['attendance','attendence','present','presence','absent','absence','late','register','registers','half_day'],
  assessments: ['assessment','assessments','marks','grades','score','scores','results','exam','exams'],
  records: ['student','students','learner','learners','admission','enrollment','enrolment'],
  timetable: ['timetable','schedule','lesson','lessons','period','periods','calendar'],
  messages: ['message','messages','conversation','conversations','chat','send','reply','text'],
  notifications: ['notification','notifications','alert','alerts'],
  diary: ['homework','assignment','assignments','diary'],
  fees: ['fee','fees','invoice','invoices','payment','payments','paid','dues'],
  reports: ['report','reports','reportcard','reportcards'],
  transport: ['transport','bus','ride','rides','journey','journeys','pickup','dropoff'],
  leave: ['leave','leave_request'], staff: ['staff','teacher','teachers','cover','responsibility'],
  events: ['event','events','activity','activities','rsvp','excursion'],
  insights: ['insights','analytics','trend','trends','average','averages','compare','comparison','decline','declines','ageing','deadlines','coverage','performance'],
  overview: ['overview','summary','dashboard'],
};
const stop = new Set('the and for can what how today please show with record check read get first current this that now need want only all you about his her their him them it mark date'.split(' '));
export const routingWords = (value: string) => value.toLowerCase().replace(/report cards?/g,'reportcard').split(/[^a-z_]+/).filter(word => word.length>2 && !stop.has(word));
function topicDomains(query: string): string[] {
  const words = routingWords(query);
  return Object.entries(topics).filter(([,terms]) => words.some(word => terms.includes(word))).map(([domain]) => domain);
}
export function intentDomains(query: string): string[] {
  const result = topicDomains(query);
  // A person-only lookup such as "Check about Aarav Sharma" needs a search tool.
  if (!result.length && /\b(check|about|find|who|lookup|look up)\b/i.test(query)) result.push('records');
  return result;
}

/** Retrieval hint only, never action authority. The model interprets the full
 * conversation. Any domain-less follow-up retains the latest user topic, without
 * a list of magic continuation phrases or forcing a guessed write operation. */
export function conversationRoutingQuery(question:string,previousUserQuestions:readonly string[]):string {
  if(topicDomains(question).length)return question;
  const prior=[...previousUserQuestions].reverse().find(item=>intentDomains(item).length>0);
  return prior?`${prior}\n${question}`:question;
}
export const domainStarters: Record<string,string[]> = {
  insights:['principal_analytics','principal_review','insights','school_insights','find_students'],
  attendance: ['student_attendance','record_student_attendance','my_attendance','subject_attendance','class_registers','attendance_register','record_attendance'],
  records: ['find_students','student_attendance','enrollment_options','school_records'],
  assessments: ['assessments','my_results','assessment_details','save_marks'],
  messages: ['conversations','conversation_messages','message_recipients','send_message','create_conversation'],
  notifications: ['notifications','read_notification'],
  fees: ['student_fees','fee_workspace','fee_students','record_payment','report_fee_payment'],
  timetable: ['my_timetable','teacher_day_plan','day_plan_options','day_plan_details'],
};
