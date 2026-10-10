import { z } from 'zod';
import { createHash } from 'node:crypto';
import * as day from '../day-plans/contracts.js';
import * as schedule from '../schedule-planning/contracts.js';
import * as event from '../campus-events/contracts.js';
import * as operations from '../operations/schemas.js';
import { cycleInput, assessmentInput, resultsInput, actionInput } from '../assessments/assessments.service.js';
import { schemeInput, subjectPlanInput, revisionInput, generateInput, commentInput } from '../academic-reports/academic-reports.service.js';
import { profileInput, policyInput } from '../staff-operations/staff-operations.service.js';
import { feeRequestSchema, feeDecisionSchema } from '../operations/fee-review.service.js';
import { createSchema as followupInput } from '../coordination/coordination.service.js';
import type { ToolDefinition } from './providers.js';
import { BadRequestException } from '@nestjs/common';
import { studentAttendanceInput, studentAttendanceSearch } from '../attendance/student-attendance.js';
import { domainStarters, intentDomains, routingWords } from './tool-routing.js';
import { schoolDate } from './references.js';
import { recordRevision } from './revisions.js';
import { principalReportInput, principalReviewInput } from '../analytics/agent-report-contracts.js';
import { chartChoice } from './charts.js';
import { capabilityManifest, humanOnly, modelToolDescription, monitored, observed, reviewed, type CapabilityContract } from './capability-contract.js';

export type Portal = 'principal' | 'teacher' | 'parent' | 'student';
export interface AgentScope {
  userId:string; schoolId:string; portal:Portal; studentId:string|null; permissions:string[]; timezone:string;
  proFeaturesEnabled?:boolean;
  userDisplayName?:string;
  accountRole?:string;
  schoolName?:string;
  studentDisplayName?:string|null;
}
export interface ApiCommand { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; query?: Record<string, unknown>; body?: unknown }
export interface Capability {
  name: string; title: string; domain: string; description: string; portals: Portal[];
  permission?: string; kind: 'read' | 'write' | 'handoff'; schema: z.ZodObject;
  contract: CapabilityContract;
  toolSchema?: z.ZodObject;
  parseArguments?: (value: unknown) => Record<string, unknown>;
  modelProjection?: (value: any, input?: Record<string,unknown>) => unknown;
  prepare?: { read: string; input: (arguments_: any, scope: AgentScope) => Record<string,unknown>; bind: (arguments_: any, data: any) => Record<string,unknown> };
  bindInput?: (input: any, basis: unknown) => Record<string,unknown>;
  request?: (input: any, scope: AgentScope, commandId?: string) => ApiCommand;
  screen: (input: any, scope: AgentScope) => string;
  // IDs must come from an authorized read, not a name guessed by a model.
  fresh?: boolean;
}
const all: Portal[] = ['principal', 'teacher', 'parent', 'student'];
const staff: Portal[] = ['principal', 'teacher'];
const family: Portal[] = ['parent', 'student'];
const uuid = z.string().uuid();
const date = z.iso.date();
const empty = z.object({}).strict();
const dateInput = z.object({ date: date.optional() }).strict();
const idInput = z.object({ id: uuid }).strict();
const schoolPath = (s: AgentScope, path: string) => `/schools/${s.schoolId}/${path}`;
const familyQuery = (s: AgentScope) => s.studentId ? { student_id: s.studentId } : {};
export function screenPath(scope: AgentScope, page: string, query: Record<string, unknown> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...(scope.portal === 'parent' ? familyQuery(scope) : {}) })) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return `/${scope.portal}${page ? `/${page}` : ''}${params.size ? `?${params.toString()}` : ''}`;
}
const catalogue: Capability[] = [];
function read(name: string, title: string, domain: string, portals: Portal[], schema: z.ZodObject, path: string | ((i: any, s: AgentScope) => string), page: string | ((i: any, s: AgentScope) => string), query: (i: any, s: AgentScope) => Record<string, unknown> = i => i, permission?: string) {
  catalogue.push({ name, title, domain, description: title, portals, kind: 'read', schema, contract:observed(`Reads ${title.toLowerCase()} without changing school records.`), ...(permission ? { permission } : {}),
    request: (i, s) => ({ method: 'GET', path: typeof path === 'function' ? path(i, s) : path, query: query(i, s) }),
    screen: (i, s) => typeof page === 'function' ? page(i, s) : screenPath(s, page, i.date ? { date: i.date } : {}),
  });
}
function write(name: string, title: string, domain: string, portals: Portal[], bodySchema: z.ZodType, path: string | ((i: any, s: AgentScope) => string), page: string | ((i: any, s: AgentScope) => string), options: { method?: ApiCommand['method']; id?: boolean; scoped?: boolean; student?: boolean; permission?: string; contract?:CapabilityContract } = {}) {
  // Hide session scope and server-generated idempotency from model-written fields.
  const json = z.toJSONSchema(bodySchema, { io: 'input', unrepresentable: 'any' }) as any;
  const shape = bodySchema instanceof z.ZodObject ? bodySchema.shape : {};
  const publicShape = Object.fromEntries(Object.entries(shape).filter(([key]) => !['school_id', 'student_id', 'idempotency_key', 'client_id'].includes(key) || (key === 'student_id' && !options.student)));
  if (name==='save_repeating_timetable') publicShape.periods=z.array(z.object({...schedule.period.shape,id:uuid.optional()}).strict()).max(168);
  const body = z.object(publicShape).strict();
  const serverRevision=options.id && !!publicShape.expected_revision && name!=='report_comment';
  const toolShape={...publicShape};
  if(serverRevision)delete toolShape.expected_revision;
  const schema = z.object({ ...(options.id ? { id: uuid } : {}), body, basis_id: uuid }).strict();
  const toolSchema = z.object({ ...(options.id ? { record_id: uuid.describe('The target record id from an authorized read.') } : {}), ...toolShape }).strict();
  catalogue.push({ name, title, domain, portals, kind: 'write', schema, toolSchema, contract:options.contract??reviewed(`Changes school data by performing: ${title.toLowerCase()}.`),
    ...(serverRevision?{bindInput:(input:any,basis:unknown)=>({...input,body:{...input.body,expected_revision:recordRevision(basis,input.id)}})}:{}),
    parseArguments: value => {
      const parsed = toolSchema.parse(value);
      const { record_id, ...fields } = parsed;
      return { ...(options.id ? { id: record_id } : {}), body: fields };
    }, description: `${title}. Returns the app's result or a review of the requested change.`, ...(options.permission ? { permission: options.permission } : {}),
    request: (i, s, commandId) => {
      const data = { ...i.body, ...(options.scoped || json.properties?.school_id ? { school_id: s.schoolId } : {}), ...(options.student && json.properties?.student_id ? familyQuery(s) : {}),
        ...(json.properties?.idempotency_key ? { idempotency_key: commandId } : {}) };
      if (name==='save_repeating_timetable') data.periods=data.periods.map((period:any,index:number)=>{
        const digest=createHash('sha256').update(`${commandId??''}:${index}`).digest('hex');
        return {...period,id:period.id??`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`};
      });
      // Run the original domain contract, including refinements, before proposing.
      const validated = bodySchema.parse(data) as Record<string, unknown>;
      return { method: options.method ?? 'POST', path: typeof path === 'function' ? path(i, s) : path, body: { ...validated,
        ...(options.student ? familyQuery(s) : {}), ...(name === 'send_message' ? { client_id: commandId } : {}) } };
    }, screen: (i, s) => typeof page === 'function' ? page(i, s) : screenPath(s, page),
  });
}

// Authorized screen projections, not unrestricted database searches.
for (const portal of all) {
  read(`${portal}_overview`, `${portal === 'principal' ? 'School' : 'My'} overview for ${portal}`, 'overview', [portal], dateInput, `/screens/${portal}/home`, portal === 'parent' ? 'home' : '', (i, s) => ({ ...i, ...familyQuery(s) }), portal === 'teacher' ? 'timetable.view' : undefined);
}
read('my_attendance', 'Recorded attendance, minimum, and subject attendance', 'attendance', family, empty, (_, s) => `/screens/${s.portal}/attendance`, 'attendance', (_, s) => familyQuery(s));
read('subject_attendance', 'Attendance by subject', 'attendance', family, empty, '/students/attendance/subjects', 'attendance', (_, s) => familyQuery(s));
read('class_registers', 'Classes, class IDs and attendance submission status for a date', 'attendance', staff, dateInput, '/screens/teacher/home', (_,s)=>screenPath(s,s.portal==='principal'?'attendance':'classes'), i=>i, 'attendance.view');
read('attendance_register', 'Class attendance register, roster and current revision; find the class in class_registers first', 'attendance', staff, z.object({ date: date.optional(), class_section_id: uuid }).strict(), '/screens/teacher/attendance', 'attendance', i => i, 'attendance.view');
read('student_attendance', 'Find one student by name or admission number and check their attendance for a date. Omit date for today. Returns choices if ambiguous.', 'attendance', staff, studentAttendanceSearch, '/teacher/attendance/student', 'attendance', i=>i, 'attendance.view');
catalogue.find(cap=>cap.name==='student_attendance')!.title='Student attendance';
write('record_student_attendance', 'Record one student’s attendance', 'attendance', staff, studentAttendanceInput, '/teacher/attendance/student', 'attendance', { permission:'attendance.record' });
const singleAttendance = catalogue.find(cap=>cap.name==='record_student_attendance')!;
singleAttendance.toolSchema = studentAttendanceSearch.extend({
  status: studentAttendanceInput.shape.status,
  reason: studentAttendanceInput.shape.reason,
  remarks: studentAttendanceInput.shape.remarks,
});
singleAttendance.description = 'Record or correct attendance for one student. Resolve pronouns from the conversation into their name, admission number or known ID. Use YYYY-MM-DD for the requested school-local date; omit only for today. The app looks up the current record and class, preserves other students and opens a review. For a correction, copy the reason from the user’s words. Does not submit the class register.';
singleAttendance.parseArguments = value => singleAttendance.toolSchema!.parse(value);
singleAttendance.prepare = {
  read:'student_attendance',
  input:(args,scope)=>({ student:args.student, date:args.date??schoolDate(scope.timezone), ...(args.class_name?{class_name:args.class_name}:{}) }),
  bind:(args,data)=>{
    if (!data.selected || data.matches.length!==1 || data.has_more) throw new BadRequestException(data.matches?.length ? 'Multiple students match. Ask the user to choose a name and class before preparing attendance.' : 'No matching student is available in your classes on this date. Check the name, class and date.');
    const { student, register, availability }=data.selected;
    if (!availability.can_mark) throw new BadRequestException(availability.reason || 'Attendance is not open for this date.');
    if (register.state==='locked') throw new BadRequestException('This register is locked. An authorized principal must reopen it in Attendance before corrections.');
    const changed = student.status !== args.status || (args.remarks!==undefined && args.remarks!==student.remarks);
    if (!changed) throw new BadRequestException(`${student.name} is already marked ${args.status} for ${data.date}. Nothing needs changing.`);
    if (student.status && !args.reason) throw new BadRequestException(`${student.name} is already marked ${student.status}. Ask the user for a correction reason; do not invent one.`);
    return { body: { student_id:student.id, class_section_id:data.selected.class.id, date:data.date,
      expected_revision:register.revision, status:args.status,
      ...(args.reason?{reason:args.reason}:{}), ...(args.remarks!==undefined?{remarks:args.remarks}:{}) } };
  },
};
read('class_updates', 'Recent notes, comments and changes for assigned classes', 'attendance', staff, dateInput, '/screens/teacher/class-updates', 'classes', i => i, 'attendance.view');
read('register_history', 'Attendance register change history', 'attendance', staff, z.object({ id: uuid, date }).strict(), i => `/attendance-registers/${i.id}/history`, 'attendance', i => ({ date: i.date }), 'attendance.view');
write('record_attendance', 'Submit class attendance', 'attendance', staff, z.object({ class_section_id: uuid, date, expected_revision: z.number().int().min(0), reason: z.string().min(3).max(500).optional(), records: z.array(z.object({ student_id: uuid, status: z.enum(['present','absent','late','excused','half_day']), remarks: z.string().max(500).optional() }).strict()).min(1).max(100) }), '/teacher/attendance/bulk', 'attendance', { permission: 'attendance.record' });
catalogue.find(cap=>cap.name==='record_attendance')!.description='Prepare a whole-class attendance register only when the current user message explicitly supplies the class-wide observation and every status. Never reuse prior rejected requests or invent missing statuses. Creates a preview, not a completed action.';
read('my_timetable', 'Published timetable for a date', 'timetable', family, dateInput, (_, s) => `/screens/${s.portal}/timetable/day`, 'timetable', (i, s) => ({ ...i, ...familyQuery(s) }));
read('teacher_day_plan', 'My teaching schedule and cover assignments for a date', 'timetable', staff, z.object({date}).strict(), '/day-plans/teacher', 'timetable', (i, s) => ({ ...i, school_id: s.schoolId }), 'timetable.view');
read('day_plan_options', 'Classes, subjects, staff and day plans for a date', 'timetable', ['principal'], z.object({ date }).strict(), '/day-plans/options', 'timetable', (i,s) => ({ ...i, school_id: s.schoolId }));
read('day_plan_details', 'One day plan, periods and revision', 'timetable', staff, idInput, i => `/day-plans/${i.id}`, 'timetable', (_,s) => ({ school_id: s.schoolId }), 'timetable.view');
write('prepare_day_plan', 'Prepare a draft change for one class and date', 'timetable', ['principal'], day.startSchema, '/day-plans', 'timetable');
write('save_day_plan', 'Save day-plan draft periods', 'timetable', ['principal'], day.saveSchema, i => `/day-plans/${i.id}/save`, 'timetable', { id: true });
for (const action of ['publish', 'discard'] as const) write(`${action}_day_plan`, `${action === 'publish' ? 'Publish' : 'Discard'} day-plan draft`, 'timetable', ['principal'], day.actionSchema, i => `/day-plans/${i.id}/${action}`, 'timetable', { id: true });
write('respond_to_cover', 'Accept or decline my cover assignment', 'timetable', staff, day.responseSchema, i => `/day-plans/periods/${i.id}/respond`, 'timetable', { id: true, permission: 'dayplans.respond' });
read('schedule_settings', 'Academic years, terms and repeating timetables', 'timetable', ['principal'], z.object({ term_id: uuid.optional() }).strict(), '/schedule-planning', (_,s) => screenPath(s, 'timetable', { settings: 'true' }));
write('prepare_academic_year', 'Prepare academic-year terms', 'timetable', ['principal'], schedule.year, '/schedule-planning/years', 'timetable');
write('prepare_repeating_timetable', 'Prepare repeating timetable for a date range', 'timetable', ['principal'], schedule.start, '/schedule-planning/drafts', 'timetable');
write('save_repeating_timetable', 'Save repeating timetable draft', 'timetable', ['principal'], schedule.save, i => `/schedule-planning/${i.id}/save`, 'timetable', { id: true });
for (const action of ['publish','discard'] as const) write(`${action}_repeating_timetable`, `${action} repeating timetable draft`, 'timetable', ['principal'], schedule.action, i => `/schedule-planning/${i.id}/${action}`, 'timetable', { id: true });

read('diary', 'Homework, diary notes and acknowledgements', 'diary', family, z.object({ date_from: date.optional(), date_to: date.optional() }).strict(), '/diary', 'diary', (i,s) => ({ ...i, ...familyQuery(s) }));
write('complete_homework', 'Mark this homework complete', 'diary', family, empty, i => `/homework/${i.id}/complete`, 'diary', { id: true, student: true, contract:monitored('Changes only this homework completion flag and records a receipt.','reopen_homework') });
write('reopen_homework', 'Mark this homework not yet complete', 'diary', family, empty, i => `/homework/${i.id}/complete`, 'diary', { id: true, student: true, method: 'DELETE', contract:monitored('Changes only this homework completion flag and records a receipt.','complete_homework') });
write('acknowledge_diary', 'Acknowledge this diary item', 'diary', family, empty, i => `/diary/${i.id}/acknowledge`, 'diary', { id: true, student: true });
write('add_diary_note', 'Send a note about this diary item', 'diary', family, z.object({ body: z.string().trim().min(2).max(2000) }), i => `/diary/${i.id}/notes`, 'diary', { id: true, student: true });
read('leave_requests', 'Leave requests and current decisions', 'leave', family, z.object({ status: z.string().max(30).optional() }).strict(), '/leave-requests', 'leave', (i,s) => ({ ...i, ...familyQuery(s) }));
read('leave_details', 'Details and permitted actions on a leave request', 'leave', family, idInput, i => `/leave-requests/${i.id}`, 'leave', () => ({}));
write('request_leave', 'Submit a leave request', 'leave', family, z.object({ category: z.enum(['medical','family','travel','personal']), starts_on: date, ends_on: date, reason: z.string().min(5).max(2000) }), '/leave-requests', 'leave', { student: true });
write('withdraw_leave','Withdraw a leave request','leave',family,z.object({note:z.string().max(500).optional()}),i=>`/leave-requests/${i.id}/withdraw`,'leave',{id:true});

read('attendance_followups','Attendance follow-up conversations','followups',['principal','teacher','parent'],z.object({state:z.enum(['open','resolved']).optional()}).strict(),'/coordination/follow-ups',(_,s)=>screenPath(s,s.portal==='principal'?'followups':'attendance'),(i,s)=>({...i,context:s.portal==='parent'?'guardian':'staff',...familyQuery(s)}),'followups.manage');
read('followup_details','Read an attendance follow-up and its revision','followups',['principal','teacher','parent'],idInput,i=>`/coordination/follow-ups/${i.id}`,(_,s)=>screenPath(s,s.portal==='principal'?'followups':'attendance'),(_,s)=>({context:s.portal==='parent'?'guardian':'staff'}),'followups.manage');
write('create_followup','Ask a guardian about a recorded attendance concern','attendance',staff,followupInput,'/coordination/follow-ups',(_,s)=>screenPath(s,s.portal==='principal'?'followups':'attendance'),{permission:'followups.manage'});
write('reply_to_followup','Send a guardian reply to an attendance follow-up','followups',['parent'],z.object({context:z.literal('guardian').default('guardian'),kind:z.literal('guardian_reply').default('guardian_reply'),body:z.string().min(3).max(1000),channel:z.literal('app').default('app'),expected_revision:z.number().int().positive(),idempotency_key:uuid}),i=>`/coordination/follow-ups/${i.id}/entries`,'attendance',{id:true});

read('conversations', 'School messages and conversation IDs', 'messages', all, empty, '/chat/conversations', 'messages', () => ({}), 'messages.view');
read('message_recipients', 'Permitted recipients for a new school conversation', 'messages', all, empty, '/chat/recipients', 'messages', (_,s) => familyQuery(s), 'messages.view');
read('conversation_messages', 'Read messages in a permitted conversation', 'messages', all, idInput, i => `/chat/conversations/${i.id}/messages`, (i,s) => screenPath(s, 'messages', { conversation: i.id }), () => ({}), 'messages.view');
write('create_conversation', 'Start a school conversation with the selected recipient', 'messages', all, z.object({ recipient_id: uuid, title: z.string().max(180) }), '/chat/conversations', 'messages', { student: true, permission: 'messages.send' });
write('send_message', 'Send this exact message to the selected conversation', 'messages', all, z.object({ body: z.string().trim().min(1).max(4000), reply_to_id: uuid.optional() }), i => `/chat/conversations/${i.id}/messages`, (i,s) => screenPath(s, 'messages', { conversation: i.id }), { id: true, permission: 'messages.send' });
write('edit_message','Edit my own message in a conversation','messages',all,z.object({conversation_id:uuid,body:z.string().trim().min(1).max(4000)}),i=>`/chat/conversations/${i.body.conversation_id}/messages/${i.id}`,(i,s)=>screenPath(s,'messages',{conversation:i.body.conversation_id}),{id:true,method:'PATCH',permission:'messages.send'});
write('mark_conversation_read','Mark this conversation read','messages',all,empty,i=>`/chat/conversations/${i.id}/read`,(i,s)=>screenPath(s,'messages',{conversation:i.id}),{id:true,permission:'messages.view'});
write('create_message_group','Create a school message group with the specified members','messages',staff,z.object({title:z.string().trim().min(3).max(180),group_type:z.enum(['student_group','parent_group','activity','staff','child_support','announcement']),member_ids:z.array(uuid).min(1).max(200),school_id:uuid,student_id:uuid.optional()}),'/chat/groups','messages',{permission:'groups.create'});
read('notifications', 'My recent notifications; use next_cursor to read older items', 'notifications', all, z.object({limit:z.number().int().min(1).max(40).default(15),cursor:z.string().max(512).optional()}).strict(), '/notifications', 'notifications', i => i);
write('read_notification', 'Mark notification read', 'notifications', all, empty, i => `/notifications/${i.id}/read`, 'notifications', { id: true });

read('events', 'School events, activities and class tests', 'events', all, z.object({ status: z.enum(['draft','published','cancelled','completed']).optional() }).strict(), '/campus-events', 'events', (i,s) => ({ ...i, school_id: s.schoolId, ...familyQuery(s) }), 'events.view');
read('event_catalogue', 'Options for planning a school event', 'events', staff, empty, '/campus-events/catalog', 'events', (_,s) => ({ school_id: s.schoolId }), 'events.view');
read('event_details', 'Event details, sessions, participation and revision', 'events', all, idInput, i => `/campus-events/${i.id}`, (i,s) => screenPath(s, `events/${i.id}`), (_,s) => ({ school_id: s.schoolId, ...familyQuery(s) }), 'events.view');
write('create_event', 'Prepare a school event draft', 'events', staff, event.createEventSchema, '/campus-events', 'events', { permission: 'events.manage' });
write('save_event', 'Save event draft', 'events', staff, event.saveEventSchema, i => `/campus-events/${i.id}/save`, (i,s) => screenPath(s, `events/${i.id}`), { id: true, permission: 'events.manage' });
for (const action of ['publish','complete','discard'] as const) write(`${action}_event`, `${action} school event`, 'events', staff, event.eventActionSchema, i => `/campus-events/${i.id}/${action}`, (i,s) => screenPath(s, `events/${i.id}`), { id: true, permission: 'events.manage' });
write('cancel_event', 'Cancel school event with a reason', 'events', staff, event.cancelEventSchema, i => `/campus-events/${i.id}/cancel`, (i,s) => screenPath(s, `events/${i.id}`), { id: true, permission: 'events.manage' });
write('event_rsvp', 'Respond to event invitation', 'events', family, event.rsvpSchema, i => `/campus-events/${i.id}/rsvp`, (i,s) => screenPath(s, `events/${i.id}`), { id: true, student: true });

read('assessments', 'Assessment cycles, assessments and permitted references', 'assessments', staff, empty, (_,s) => schoolPath(s,'assessments/workspace'), 'assessments', () => ({}), 'assessments.view');
read('assessment_details', 'Assessment details, result register and revision', 'assessments', staff, idInput, (i,s) => schoolPath(s,`assessments/${i.id}`), (i,s) => screenPath(s,'assessments',{ assessment: i.id }), () => ({}), 'assessments.view');
read('my_results', 'Published subject marks and assessment results', 'assessments', family, empty, (_,s) => schoolPath(s,'assessments/family'), 'results', (_,s) => familyQuery(s));
write('create_assessment_cycle', 'Create assessment cycle', 'assessments', ['principal'], cycleInput, (_,s) => schoolPath(s,'assessments/cycles'), 'assessments');
write('create_assessment', 'Create assessment with examiner and moderator', 'assessments', ['principal'], assessmentInput, (_,s) => schoolPath(s,'assessments'), 'assessments');
write('save_marks', 'Save explicitly supplied marks and feedback', 'assessments', staff, resultsInput, (i,s) => schoolPath(s,`assessments/${i.id}/results`), (i,s) => screenPath(s,'assessments',{ assessment: i.id }), { id: true, permission: 'assessments.mark' });
for (const action of ['schedule','open-marking','submit','approve','return','publish','cancel'] as const) write(`${action.replace('-','_')}_assessment`, `${action} assessment register`, 'assessments', staff, actionInput, (i,s) => schoolPath(s,`assessments/${i.id}/actions/${action}`), (i,s) => screenPath(s,'assessments',{ assessment: i.id }), { id: true, permission: 'assessments.view' });
read('report_cards', 'Report-card schemes and releases', 'reports', staff, empty, (_,s) => schoolPath(s,'academic-reports/workspace'), 'report-cards', () => ({}), 'assessments.view');
read('my_report_cards', 'Published report cards', 'reports', family, empty, (_,s) => schoolPath(s,'academic-reports/family'), 'results', (_,s) => familyQuery(s));
read('report_scheme', 'Report-card scheme and subject components', 'reports', staff, idInput, (i,s) => schoolPath(s,`academic-reports/schemes/${i.id}`), 'report-cards', () => ({}), 'assessments.view');
read('report_release', 'Report-card release details and revision', 'reports', staff, idInput, (i,s) => schoolPath(s,`academic-reports/batches/${i.id}`), (i,s) => screenPath(s,'report-cards',{ batch: i.id }), () => ({}), 'assessments.view');
write('create_report_scheme', 'Create report-card scheme', 'reports', ['principal'], schemeInput, (_,s) => schoolPath(s,'academic-reports/schemes'), 'report-cards');
write('save_report_subjects', 'Save report-card subject weighting', 'reports', ['principal'], subjectPlanInput, (i,s) => schoolPath(s,`academic-reports/schemes/${i.id}/subjects`), 'report-cards', { id: true, method: 'PUT' });
write('activate_report_scheme', 'Activate report-card scheme', 'reports', ['principal'], revisionInput, (i,s) => schoolPath(s,`academic-reports/schemes/${i.id}/activate`), 'report-cards', { id: true });
write('generate_report_cards', 'Generate a report-card release', 'reports', ['principal'], generateInput, (i,s) => schoolPath(s,`academic-reports/schemes/${i.id}/generate`), 'report-cards', { id: true });
// Per-student remarks carry both IDs in the body; the gateway verifies both were read.
write('report_comment', 'Save a report-card remark', 'reports', staff, z.object({ ...commentInput.shape, student_id: uuid }), (i,s) => schoolPath(s,`academic-reports/batches/${i.id}/students/${i.body.student_id}/comments`), 'report-cards', { id: true, method: 'PUT', permission: 'reports.comment' });
for(const action of ['submit','approve','return','publish'] as const) write(`${action}_report_cards`,`${action} report-card release`,'reports',['principal'],revisionInput,(i,s)=>schoolPath(s,`academic-reports/batches/${i.id}/actions/${action}`),(i,s)=>screenPath(s,'report-cards',{batch:i.id}),{id:true});

read('insights', 'Attendance, results and school analytics with denominators', 'insights', all, z.object({ period:z.enum(['term','30','90']).optional(),class_id:uuid.optional() }).strict(), (_,s) => schoolPath(s,`analytics/${s.portal}`), (i,s)=>screenPath(s,'insights',i), (i,s) => ({ ...i, ...familyQuery(s) }), 'attendance.view');
read('principal_analytics','Attendance and results analysis','insights',['principal'],principalReportInput,(_,s)=>schoolPath(s,'analytics/principal/report'),'insights');
catalogue.find(cap=>cap.name==='principal_analytics')!.description='Analyze a student by name/admission number, class or whole institution: recorded attendance, subject percentages and published marks. Use the same period in separate calls to compare learner, class and school; never substitute school data for a learner. Ambiguous names return choices. Pagination never changes aggregate totals.';
read('principal_review','Principal operational review','insights',['principal'],principalReviewInput,(_,s)=>schoolPath(s,'principal-insights/review'),(i,s)=>screenPath(s,`insights/${({attendance:'review',learning:'learning-review',followups:'followups',coverage:'operations',fees:'finance'} as Record<string,string>)[i.topic]}`,{date:i.date,insight_days:i.days,class:i.class_section_id,insight_threshold:i.threshold}));
catalogue.find(cap=>cap.name==='principal_review')!.description='Principal decision review: attendance declines and recording gaps, published learning results, open follow-ups, next-week cover/deadline conflicts or aggregate fee ageing. Read-only evidence, not automatic decisions or communication.';
for(const name of ['insights','principal_analytics']) {
  const capability=catalogue.find(cap=>cap.name===name)!;
  capability.schema=capability.schema.extend({chart:chartChoice.optional().describe('Chart preset: attendance_comparison = BAR percentages by subject/class; attendance_breakdown = DONUT present/absent/late records (NOT subject bars); attendance_trend = LINE over time; results_comparison = BAR published subject/class averages; results_distribution = DONUT scored-result bands; none = no chart. Match the requested chart. Values come only from the API.')});
  const request=capability.request!;
  capability.request=(input,scope)=>{const query={...input};delete query.chart;return request(query,scope);};
}
read('school_insights', 'Principal attention and decision-support indicators', 'insights', ['principal'], empty, (_,s) => schoolPath(s,'principal-insights'), 'insights', () => ({}));
read('staff_workspace', 'Staff directory, responsibilities, leave and cover', 'staff', staff, empty, (_,s) => schoolPath(s,'staff/workspace'), (_,s) => screenPath(s,s.portal === 'teacher' ? 'responsibilities' : 'staff'), () => ({}));
write('create_staff_profile','Create a staff profile','staff',['principal'],profileInput,(_,s)=>schoolPath(s,'staff/profiles'),'staff');
write('create_staff_leave_policy','Create a staff leave policy','staff',['principal'],policyInput,(_,s)=>schoolPath(s,'staff/leave-policies'),'staff');
write('request_staff_leave','Apply for staff leave','staff',['teacher'],z.object({policy_id:uuid,starts_on:date,ends_on:date,portion:z.enum(['full_day','first_half','second_half']).default('full_day'),reason:z.string().min(8).max(1000),handover_note:z.string().max(1000).default('')}),(_,s)=>schoolPath(s,'staff/leave-requests'),'leave');
write('decide_staff_leave','Review staff leave','staff',['principal'],z.object({decision:z.enum(['approved','rejected']),note:z.string().max(1000),expected_revision:z.number().int().positive()}),(i,s)=>schoolPath(s,`staff/leave-requests/${i.id}/decision`),'staff',{id:true});
write('withdraw_staff_leave','Withdraw my staff leave request','staff',['teacher'],z.object({expected_revision:z.number().int().positive()}),(i,s)=>schoolPath(s,`staff/leave-requests/${i.id}/withdraw`),'leave',{id:true});
write('respond_to_responsibility','Accept or decline an assigned responsibility','staff',['teacher'],z.object({decision:z.enum(['accepted','declined']),note:z.string().max(500),expected_revision:z.number().int().positive()}),(i,s)=>schoolPath(s,`staff/responsibilities/${i.id}/response`),'responsibilities',{id:true});
write('assign_cover','Assign a replacement for an open coverage task','staff',['principal'],z.object({replacement_staff_profile_id:uuid,note:z.string().max(500),expected_revision:z.number().int().positive()}),(i,s)=>schoolPath(s,`staff/coverage-tasks/${i.id}/assign`),'staff',{id:true});
write('respond_to_coverage','Accept or decline a cover request','staff',['teacher'],z.object({decision:z.enum(['accepted','declined']),note:z.string().max(500),expected_revision:z.number().int().positive()}),(i,s)=>schoolPath(s,`staff/coverage-tasks/${i.id}/response`),'responsibilities',{id:true});
read('school_records', 'School terms, classes and subjects', 'records', staff, empty, (_,s) => schoolPath(s,'administration'), 'administration', () => ({}), 'sis.manage');
read('find_students', 'Find students by name or admission number; use next_cursor for more. Basic identity/class by default. Use profile details only if the user specifically asks for birth date or guardian contacts.', 'records', staff, z.object({search:z.string().max(80).default(''),cursor:uuid.optional(),details:z.enum(['basic','profile']).default('basic')}).strict(), '/people/students', 'students', (i,s)=>({search:i.search,cursor:i.cursor,school_id:s.schoolId}), 'sis.manage');
catalogue.find(cap=>cap.name==='find_students')!.modelProjection=(data,input)=>input?.details==='profile'?data:{
  ...data,results:data.results?.map((student:any)=>({id:student.id,name:student.name,first_name:student.first_name,last_name:student.last_name,admission_number:student.admission_number,class_name:student.class_name,roll_number:student.roll_number})),
};
read('enrollment_options', 'Class and term references for student enrollment', 'records', staff, empty, '/people/enrollment-options', 'students', (_,s)=>({school_id:s.schoolId}), 'sis.manage');
for (const [kind,schema] of [['terms',operations.termSchema],['classes',operations.classSchema],['subjects',operations.subjectSchema]] as const) {
  write(`create_${kind}`, `Create school ${kind}`, 'records', staff, schema, (_,s) => schoolPath(s,`catalog/${kind}`), 'administration', { permission: 'sis.manage' });
}
write('create_student','Create a student record and enrollment','records',staff,operations.studentSchema,(_,s)=>schoolPath(s,'students'),'students',{permission:'sis.manage'});
write('update_student','Update student name, admission number and birth date','records',staff,operations.studentUpdateSchema,(i,s)=>schoolPath(s,`students/${i.id}`),'students',{id:true,method:'PATCH',permission:'sis.manage'});
write('add_school_closure','Add a holiday or school closure','timetable',['principal'],z.object({term_id:uuid,starts_on:date,ends_on:date,kind:z.enum(['public_holiday','local_holiday','emergency_closure']),label:z.string().min(3).max(160),reason:z.string().min(3).max(500)}),'/principal/calendar/closures','calendar');
write('set_teaching_target','Set curriculum teaching-time target','timetable',['principal'],z.object({term_id:uuid,class_section_id:uuid,subject_id:uuid,target_minutes:z.number().int().min(30).max(120000),expected_revision:z.number().int().nonnegative(),reason:z.string().min(3).max(500)}),'/principal/timetable/targets','timetable');
read('fee_workspace', 'Invoices, payments and fee reviews', 'fees', all, empty, (_,s) => schoolPath(s,'fees/workspace'), 'fees', (_,s) => familyQuery(s), 'fees.manage');
read('student_fees', 'Read invoices, outstanding balances, payments and fee reviews for one student. Use the student ID from find_students or another authorized record.', 'fees', staff,
  z.object({student_id:uuid}).strict(), (_,s)=>schoolPath(s,'fees/workspace'), (i,s)=>screenPath(s,'fees',{student_id:i.student_id}), i=>({student_id:i.student_id}), 'fees.manage');
catalogue.find(cap=>cap.name==='student_fees')!.title='Student fees';
read('fee_students', 'Permitted students for school invoices', 'fees', staff, empty, (_,s) => schoolPath(s,'fees/students'), 'fees', () => ({}), 'fees.manage');
write('create_invoice', 'Create fee invoice', 'fees', staff, operations.invoiceSchema, (_,s) => schoolPath(s,'fees/invoices'), 'fees', { permission: 'fees.manage' });
write('record_payment', 'Record a payment already received; does not transfer money', 'fees', staff, operations.paymentSchema, (i,s) => schoolPath(s,`fees/invoices/${i.id}/payments`), 'fees', { id: true, permission: 'fees.manage' });
write('report_fee_payment','Report a payment already made for school verification; does not send money','fees',['parent'],feeRequestSchema.options[0],(i,s)=>schoolPath(s,`fees/invoices/${i.id}/reviews`),'fees',{id:true});
write('query_fee_charge','Ask the school about an invoice charge','fees',['parent'],feeRequestSchema.options[1],(i,s)=>schoolPath(s,`fees/invoices/${i.id}/reviews`),'fees',{id:true});
write('review_fee_submission','Respond to a fee query or verify an explicitly checked payment','fees',staff,feeDecisionSchema,(i,s)=>schoolPath(s,`fees/reviews/${i.id}/decision`),'fees',{id:true,permission:'fees.manage'});
read('published_policies', 'Published school policies', 'policies', all, empty, (_,s) => schoolPath(s,'governance/policies'), (_,s) => screenPath(s,s.portal === 'principal' ? 'governance' : 'policies'), () => ({}));
read('my_transport', 'My child journey, approved arrangement and ride state', 'transport', family, empty, (_,s) => `/departure/${s.portal === 'student' ? 'student' : 'family'}`, 'departure', (_,s) => familyQuery(s));
read('assigned_journeys', 'My assigned transport rides and duty status', 'transport', staff, empty, '/departure/collector', (_,s) => screenPath(s,s.portal === 'teacher' ? 'transport' : 'departure'), () => ({}), 'departure.collect');
read('transport_workspace', 'School routes, trips and departure requests', 'transport', ['principal'], empty, (_,s) => `/departure/schools/${s.schoolId}/workspace`, 'departure', () => ({}), 'departure.manage');
read('transport_trip','Planned journey, roster and duty revision','transport',['principal'],idInput,(i,s)=>`/departure/schools/${s.schoolId}/trips/${i.id}`,(i,s)=>screenPath(s,`departure/journeys/${i.id}`),()=>({}),'departure.manage');
write('plan_transport_trip','Plan a dated ride on an existing route; does not start the bus','transport',['principal'],z.object({route_id:uuid,service_date:date,direction:z.enum(['to_institution','from_institution']),scheduled_departure_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),assigned_collector_user_id:uuid,backup_collector_user_id:uuid.nullable().optional()}),(_,s)=>`/departure/schools/${s.schoolId}/trips`,'departure',{permission:'departure.manage'});
write('plan_transport_service','Schedule recurring rides on an existing route','transport',['principal'],z.object({route_id:uuid,label:z.string().min(2).max(120),direction:z.enum(['to_institution','from_institution']),weekdays:z.array(z.number().int().min(1).max(7)).min(1).max(7),departure_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),primary_collector_user_id:uuid,backup_collector_user_id:uuid.nullable().optional(),valid_from:date,valid_until:date.nullable().optional()}),(_,s)=>`/departure/schools/${s.schoolId}/service-patterns`,'departure',{permission:'departure.manage'});
write('generate_transport_trips','Prepare dated rides from an existing service schedule, up to six weeks','transport',['principal'],z.object({from_date:date,to_date:date,pattern_id:uuid}),(_,s)=>`/departure/schools/${s.schoolId}/trips/generate`,'departure',{permission:'departure.manage'});
write('request_transport_cover','Request a colleague to cover or exchange my planned ride','transport',['teacher'],z.object({requester_trip_id:uuid,request_type:z.enum(['cover','exchange']),target_user_id:uuid,target_trip_id:uuid.nullable().optional(),reason:z.string().min(3).max(500)}),'/departure/collector/duty-swaps','transport',{permission:'departure.collect'});
write('respond_transport_cover','Accept or decline a transport duty-change request','transport',['teacher'],z.object({decision:z.enum(['accepted','rejected']),expected_revision:z.number().int().positive(),note:z.string().max(500).default('')}),i=>`/departure/collector/duty-swaps/${i.id}/respond`,'transport',{id:true,permission:'departure.collect'});

// Intentional human-only boundaries: no model tool ever posts these commands.
for (const [name,title,domain,page,portals] of [
  ['transport_controls','Boarding, physical handover, location sharing and collection authority require the responsible person in Transport.','transport','departure',all],
  ['safeguarding','Safeguarding reports and decisions require the authorized human reviewer.','safety','safeguarding',staff],
  ['account_security','Passwords, identity, MFA and account access changes require the secure account screen.','security','',all],
  ['attendance_reconciliation','Unexplained offline or paper attendance discrepancies require human reconciliation.','attendance','attendance',['principal']],
  ['staff_changes','Staff role, leave and responsibility changes use the reviewed Staff workflow.','staff','staff',staff],
  ['student_enrollment','Enrollment, imports, guardians and authority changes use the reviewed student-record workflow.','records','students',staff],
  ['event_consent','Consent and collection authority require the authorized guardian in the event screen.','events','events',family],
  ['leave_authorization','Guardian leave authorization requires the authorized guardian in the leave-request screen.','leave','leave',family],
  ['policy_changes','Policy drafting, publication and authority rules use the reviewed Governance workflow.','policies','governance',['principal']],
  ['attachments_and_print','Upload documents or print records from the corresponding app screen; chat cannot attach or print files.','files','more',all],
] as const) {
  catalogue.push({ name, title, description: title, domain, portals: [...portals], schema: empty, kind:'handoff', contract:humanOnly(title), screen: (_,s) => name === 'account_security' ? '/account/security' : screenPath(s,name === 'transport_controls' && s.portal === 'teacher' ? 'transport' : name === 'staff_changes' && s.portal === 'teacher' ? 'responsibilities' : page) });
}

export const CAPABILITIES: readonly Capability[] = catalogue;
// The register picker needs class context, not a second copy of every weekly slot.
catalogue.find(cap=>cap.name==='class_registers')!.modelProjection=value=>({date:value.date,classes:value.classes});
/** Screen destinations are application-owned; the model never supplies a URL. */
export function verificationScreen(cap:Capability,input:any,scope:AgentScope,data?:any,basis?:any) {
  if(cap.name==='principal_analytics'||cap.name==='insights')return screenPath(scope,`insights/${input.topic==='results'||String(input.chart??'').startsWith('results_')?'results':'attendance'}`,{period:input.period??'term',...(input.group_by==='class'?{compare:'class'}:{}),...(data?.student?.id&&cap.name==='principal_analytics'?{student_id:data.student.id}:{}),...(data?.class_id||input.class_id?{class:data?.class_id??input.class_id}:{})});
  const record=data?.plan??basis?.plan??data??basis;
  if (cap.domain==='notifications') return screenPath(scope,scope.portal==='parent'?'home':'',{ notifications:'open' });
  if (cap.name==='find_students'&&data?.results?.length===1) return screenPath(scope,'students',{student:data.results[0].id});
  if (cap.name==='class_updates'&&scope.portal==='principal') return screenPath(scope,'attendance',input);
  if (cap.name==='student_attendance') {
    const selected=data?.selected??basis?.selected;
    return screenPath(scope,'attendance',{ class_section_id:selected?.class?.id,date:data?.date??input.date,student_id:selected?.student?.id });
  }
  if (cap.name==='attendance_register'||cap.name==='record_attendance'||cap.name==='record_student_attendance'||cap.name==='register_history') {
    const fields=input.body??input;
    return screenPath(scope,'attendance',{ class_section_id:fields.class_section_id??input.id,date:fields.date,student_id:fields.student_id });
  }
  if (cap.name==='schedule_settings'||cap.name.includes('repeating_timetable')||cap.name==='prepare_academic_year') return screenPath(scope,'timetable',{ settings:'home',term:input.body?.term_id??input.term_id });
  if (cap.name.includes('day_plan')&&scope.portal==='principal') return screenPath(scope,'timetable',{ date:input.body?.date??input.date??record?.date,class:input.body?.class_section_id??record?.class_section_id });
  if (cap.name==='create_conversation') return screenPath(scope,'messages',{ conversation:data?.id??data?.conversation?.id });
  if (cap.name==='create_assessment') return screenPath(scope,'assessments',{ assessment:data?.id??data?.assessment?.id });
  if (cap.name==='create_event') return screenPath(scope,data?.id?`events/${String(data.id)}`:'events');
  if (cap.name==='create_message_group') return screenPath(scope,'messages',{conversation:data?.id??data?.conversation?.id});
  if (cap.name==='plan_transport_trip'&&data?.id) return screenPath(scope,`departure/journeys/${String(data.id)}`);
  if (cap.name==='plan_transport_service'||cap.name==='generate_transport_trips') return screenPath(scope,'departure',{section:'roster'});
  if (cap.name==='create_staff_profile'&&data?.id) return screenPath(scope,`staff/${String(data.id)}`);
  if (cap.domain==='staff'&&scope.portal==='principal'&&/leave|cover/.test(cap.name)) return screenPath(scope,'staff',{section:'leave'});
  if (cap.name==='create_student'||cap.name==='update_student') return screenPath(scope,'students',{student:input.id??data?.id,student_key:input.body?.admission_number});
  if (cap.name==='create_invoice'||cap.name==='record_payment') return screenPath(scope,'fees',{invoice:cap.name==='record_payment'?input.id:data?.id});
  if (cap.name==='query_fee_charge'||cap.name==='report_fee_payment'||cap.name==='review_fee_submission') return screenPath(scope,'fees',{view:'reviews',invoice:cap.name==='review_fee_submission'?undefined:input.id});
  if (cap.domain==='leave') return screenPath(scope,'leave',{ leave_id:input.id??data?.id });
  if (['report_scheme','create_report_scheme','save_report_subjects','activate_report_scheme'].includes(cap.name)) return screenPath(scope,'report-cards',{ scheme:input.id??data?.id,view:'schemes' });
  if (cap.name==='generate_report_cards'||cap.name==='report_comment') return screenPath(scope,'report-cards',{ batch:cap.name==='report_comment'?input.id:data?.id,view:'releases' });
  return cap.screen(input,scope);
}
export function availableCapabilities(scope: AgentScope) {
  return CAPABILITIES.filter(cap => cap.portals.includes(scope.portal)
    && (scope.portal !== 'teacher' || !cap.permission || scope.permissions.includes(cap.permission))
    && (scope.proFeaturesEnabled !== false || isBasicAssistantCapability(cap.name)));
}
// Small, evidence-linked answers remain available without the Pro preview.
// Actions, analytics, charts, discovery of other records and workflows require Pro.
export function isBasicAssistantCapability(name: string) {
  return name === 'my_attendance' || name.endsWith('_overview');
}
export function capabilityTool(capability: Capability): ToolDefinition {
  return { name: capability.name, description: modelToolDescription(capability), parameters: z.toJSONSchema(capability.toolSchema ?? capability.schema, { io: 'input', unrepresentable: 'any' }) };
}
export { capabilityManifest };
export function findCapabilities(query: string, available: readonly Capability[], contextDomains: string[] = []) {
  const words = routingWords(query);
  const explicit = intentDomains(query);
  const domains = explicit.length ? explicit : contextDomains.slice(-1);
  const preferred = domains.flatMap(domain=>domainStarters[domain]??[]);
  const ranked = available.map(cap => {
    const tokens = new Set(routingWords(`${cap.name.replace(/_/g,' ')} ${cap.description}`));
    const preference = preferred.indexOf(cap.name);
    const score = (domains.includes(cap.domain)?30:0) + (preference>=0?40-preference:0)
      + words.reduce((sum,word)=>sum+(tokens.has(word)?2:0),0);
    return {cap,score};
  }).sort((a,b)=>b.score-a.score);
  return ranked.filter(item=>item.score>0).slice(0,12).map(item=>item.cap);
}
