import { examScheduleActionAllowed } from './assessment-schedule-amendments';
import type { AssessmentDetail, AssessmentWorkspace } from '../../../packages/contracts/src/assessments';
import type { NativePendingAction, NativePendingScope } from './native-pending-action';

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value;
const sameInstant = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
export const physicalAssessmentKind = (kind: string) => ['exam','practical','viva'].includes(kind);
const assessmentKinds = ['exam','class_test','practical','viva','project','assignment','quiz','other'] as const;
export const assessmentKindOptions = assessmentKinds.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1).replaceAll('_',' ') }));
const validInvigilators = (value: unknown): value is string[] => Array.isArray(value) && value.length >= 1 && value.length <= 20 && value.every(uuid) && new Set(value).size === value.length;
export const assessmentAuthoringRoot = (school: string) => `/api/v1/schools/${encodeURIComponent(school)}/assessments`;
/** Older installed clients retain the class-only response by default. */
export const assessmentWorkspacePath = (school: string) => `${assessmentAuthoringRoot(school)}/workspace/?academic_context=offering_v1`;
export type AssessmentAuthoringMode = 'assessment' | 'cycle' | 'arrangements';
export type AssessmentPlanDraft = { cycle: string; classId: string; subject: string; offering?: string; kind: string; title: string; maximum: string; policy: string; weight: string; scheduled: string; duration: string; venue: string; instructions: string; evidence: string; examiner: string; moderator: string; space: string; invigilators: string[] };
export type AssessmentCycleDraft = { term: string; name: string; code: string; label: string; start: string; end: string };
export type AssessmentArrangementsDraft = Pick<AssessmentPlanDraft,'scheduled'|'duration'|'space'|'invigilators'>;
export function assessmentAuthoringChoices(workspace: AssessmentWorkspace, cycleId: string, classId: string) {
  const references = workspace.references;
  const cycle = workspace.cycles.find(value => value.id === cycleId);
  const classes = references?.classes.filter(value => value.academic_year === cycle?.academic_year) ?? [];
  const subjects = references?.subjects.filter(value => workspace.mode === 'admin' || ('class_section_ids' in value && Array.isArray(value.class_section_ids) && value.class_section_ids.includes(classId))) ?? [];
  const offerings = references?.offerings?.filter(value => value.academic_context?.term_id === cycle?.term_id) ?? [];
  return { cycle, classes, subjects, offerings, staff: references?.staff ?? [], spaces: references?.spaces ?? [], policies: references?.grading_policies?.filter(value => value.status === 'active') ?? [] };
}
function decimal(value: string, maximum: number, label: string) { if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()) || Number(value) <= 0 || Number(value) > maximum) throw new Error(`Enter ${label} above zero and at most ${maximum}, using up to two decimal places.`); return Number(value); }
function timing(input: AssessmentArrangementsDraft, references: NonNullable<AssessmentWorkspace['references']>, now: string) {
  if (!Number.isFinite(Date.parse(input.scheduled)) || Date.parse(input.scheduled) <= Date.parse(now) || !/^\d+$/.test(input.duration) || Number(input.duration) < 1 || Number(input.duration) > 1440 || !references.spaces?.some(value => value.id === input.space)) throw new Error('Choose a future examination time, a duration from 1 to 1440 minutes and a current bookable space.');
  if (!input.invigilators.length || input.invigilators.length > 20 || new Set(input.invigilators).size !== input.invigilators.length || input.invigilators.some(id => !references.staff.some(value => value.id === id))) throw new Error('Choose between 1 and 20 distinct current invigilators.');
  return { scheduled_at: new Date(input.scheduled).toISOString(), duration_minutes: Number(input.duration), space_id: input.space, invigilator_user_ids: [...input.invigilators] };
}
export function assessmentPlanPayload(workspace: AssessmentWorkspace, input: AssessmentPlanDraft, actorId: string, now: string, timeZone: string) {
  const references = workspace.references, options = assessmentAuthoringChoices(workspace,input.cycle,input.classId);
  if (!references || workspace.mode === 'staff' && (!workspace.can_plan_class_test || workspace.planner_user_id !== actorId)) throw new Error('Your current assessment planning responsibility is unavailable.');
  const offering = input.offering ? options.offerings.find(value => value.id === input.offering) : undefined;
  if (!options.cycle || (input.offering ? !offering?.academic_context || offering.academic_context.subject_id !== input.subject : !options.classes.some(value => value.id === input.classId) || !options.subjects.some(value => value.id === input.subject))) throw new Error('Choose the exact current cycle and course, or class and subject.');
  if (input.offering && input.classId) throw new Error('Choose either a course or a class and subject.');
  if (!assessmentKindOptions.some(value => value.value === input.kind) || workspace.mode === 'staff' && (input.kind !== 'class_test' || input.examiner !== actorId)) throw new Error('A teacher-planned class test must keep the assigned teacher as examiner.');
  const physical = physicalAssessmentKind(input.kind);
  if (offering && !physical && (input.space || input.invigilators.length)) throw new Error('Choose a physical assessment type to assign a room and invigilators.');
  if (input.title.trim().length < 2 || input.title.length > 160 || input.instructions.length > 2000 || input.venue.length > 160 || !['none','optional','required'].includes(input.evidence)) throw new Error('Review the assessment title, instructions and evidence choice.');
  if (input.examiner === input.moderator || !references.staff.some(value => value.id === input.moderator) || workspace.mode === 'admin' && !references.staff.some(value => value.id === input.examiner)) throw new Error('Choose different current people as examiner and independent moderator.');
  if (input.policy && !options.policies.some(value => value.id === input.policy)) throw new Error('The selected active grading policy is no longer available.');
  if (!Number.isFinite(Date.parse(input.scheduled))) throw new Error('Choose the assessment date and time.');
  if (workspace.mode === 'staff' || input.offering) {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(input.scheduled));
    const part = (kind: string) => parts.find(value => value.type === kind)?.value;
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    if (date < options.cycle.starts_on || date > options.cycle.ends_on) throw new Error('Choose an assessment date inside the selected cycle in campus time.');
    if (offering?.academic_context && (date < offering.academic_context.starts_on || date > offering.academic_context.ends_on)) throw new Error('Choose a date inside the configured course term in campus time.');
  }
  const arrangements = physical ? timing(input,references,now) : null;
  if (!/^\d+$/.test(input.duration) || Number(input.duration) < 1 || Number(input.duration) > 1440) throw new Error('Choose an assessment duration from 1 to 1440 minutes.');
  return { cycle_id: input.cycle, class_section_id: input.offering ? null : input.classId, subject_id: input.subject, ...(input.offering ? { context_kind: 'learning_offering', offering_id: input.offering } : {}), title: input.title.trim(), assessment_kind: input.kind, maximum_marks: decimal(input.maximum,100000,'maximum marks'), grading_policy_id: input.policy || null, weight_percent: input.weight ? decimal(input.weight,100,'the weight percentage') : null, scheduled_at: new Date(input.scheduled).toISOString(), duration_minutes: Number(input.duration), venue: physical ? options.spaces.find(value => value.id === input.space)!.name : input.venue.trim(), space_id: arrangements?.space_id ?? null, invigilator_user_ids: arrangements?.invigilator_user_ids ?? [], instructions: input.instructions.trim(), evidence_requirement: input.evidence, examiner_user_id: input.examiner, moderator_user_id: input.moderator };
}
export function assessmentCyclePayload(workspace: AssessmentWorkspace, input: AssessmentCycleDraft) {
  if (workspace.mode !== 'admin') throw new Error('Your current assessment workspace cannot create cycles.');
  const term = workspace.references.terms.find(value => value.id === input.term);
  if (!term || !day(input.start) || !day(input.end) || input.end < input.start || input.start < term.starts_on || input.end > term.ends_on) throw new Error('Keep the cycle dates inside the selected current term.');
  if (input.name.trim().length < 2 || input.name.length > 120 || input.code.trim().length < 2 || input.code.length > 32 || input.label.trim().length < 2 || input.label.length > 80) throw new Error('Review the cycle name, short code and result label.');
  return { term_id: input.term, name: input.name.trim(), code: input.code.trim().toUpperCase(), starts_on: input.start, ends_on: input.end, result_label: input.label.trim() };
}
export function assessmentArrangementsPayload(workspace: AssessmentWorkspace, detail: AssessmentDetail, input: AssessmentArrangementsDraft, now: string) {
  if (workspace.mode !== 'admin' || detail.viewer_role !== 'admin' || detail.assessment.status !== 'draft' || detail.exam_operation?.sitting.state !== 'planning') throw new Error('Only the current administrator may change arrangements before scheduling.');
  return { expected_assessment_revision: detail.assessment.revision, expected_sitting_revision: detail.exam_operation.sitting.revision, ...timing(input,workspace.references,now) };
}

/** These three mounted legacy handlers do not consume command IDs. A lost
 * response stays inspect-only; successful responses identify the owning read. */
export function assessmentAuthoringRefreshPath(value: unknown, action: NativePendingAction) {
  const receipt = object(value), source = action.source, body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null;
  const root = assessmentAuthoringRoot(action.scope.schoolId);
  if (source?.kind === 'assessment_creation' && body?.context_kind === 'learning_offering') {
    if (!receipt || action.replayPolicy !== 'same_request' || body.idempotency_key !== action.clientId || receipt.command_id !== action.clientId || receipt.action !== 'assessment.create' || !uuid(receipt.id) || receipt.school_id !== action.scope.schoolId || receipt.revision !== 1 || receipt.class_section_id !== null || ['context_kind','offering_id','cycle_id','subject_id','title','assessment_kind','grading_policy_id','duration_minutes','instructions','evidence_requirement','examiner_user_id','moderator_user_id','venue'].some(key => receipt[key] !== body[key]) || Number(receipt.maximum_marks) !== body.maximum_marks || (receipt.weight_percent == null ? null : Number(receipt.weight_percent)) !== body.weight_percent || !sameInstant(receipt.scheduled_at, body.scheduled_at)) throw new Error('The course assessment receipt did not confirm the exact reviewed command.');
    if (physicalAssessmentKind(String(body.assessment_kind))) {
      const sitting = object(receipt.sitting);
      if (!sitting || !uuid(sitting.id) || sitting.assessment_id !== receipt.id || sitting.school_id !== action.scope.schoolId || sitting.space_id !== body.space_id || sitting.revision !== 1 || !sameInstant(sitting.starts_at, body.scheduled_at)) throw new Error('The course examination receipt did not confirm the reviewed room and start time.');
    }
    return `${root}/${receipt.id}/`;
  }
  if (!receipt || !source || !body || action.replayPolicy !== 'inspect_only') throw new Error('The assessment authoring result could not be confirmed.');
  if (source.kind === 'assessment_cycle' && action.endpoint === `${root}/cycles/`) {
    if (!uuid(receipt.id) || receipt.school_id !== action.scope.schoolId || receipt.revision !== 1 || ['term_id','name','code','starts_on','ends_on','result_label'].some(key => receipt[key] !== body[key])) throw new Error('The created cycle did not match this institution and reviewed term.');
    return `${root}/workspace/?cycle_id=${receipt.id}`;
  }
  if (source.kind === 'assessment_creation' && [root,root+'/'].includes(action.endpoint)) {
    if (!uuid(receipt.id) || receipt.school_id !== action.scope.schoolId || receipt.revision !== 1 || receipt.status !== 'draft' || ['cycle_id','class_section_id','subject_id','title','assessment_kind','grading_policy_id','duration_minutes','instructions','evidence_requirement'].some(key => receipt[key] !== body[key]) || Number(receipt.maximum_marks) !== body.maximum_marks || !sameInstant(receipt.scheduled_at,body.scheduled_at)) throw new Error('The new assessment did not match the reviewed class, subject and instructions.');
    if (physicalAssessmentKind(String(body.assessment_kind))) { const sitting = object(receipt.sitting); if (!sitting || !uuid(sitting.id) || sitting.assessment_id !== receipt.id || sitting.school_id !== action.scope.schoolId || sitting.space_id !== body.space_id || sitting.revision !== 1) throw new Error('The created examination sitting did not match the reviewed space.'); }
    return `${root}/${receipt.id}/`;
  }
  if (source.kind === 'assessment_arrangements' && action.endpoint === `${root}/${encodeURIComponent(source.sourceId)}/sitting/arrangements/`) {
    const assessment = object(receipt.assessment), sitting = object(receipt.sitting);
    if (!assessment || !sitting || !uuid(source.fingerprint) || sitting.id !== source.fingerprint || assessment.id !== source.sourceId || assessment.school_id !== action.scope.schoolId || sitting.school_id !== action.scope.schoolId || sitting.assessment_id !== source.sourceId || assessment.revision !== source.revision + 1 || body.expected_assessment_revision !== source.revision || sitting.revision !== Number(body.expected_sitting_revision)+1 || sitting.space_id !== body.space_id || !sameInstant(sitting.starts_at,body.scheduled_at) || assessment.duration_minutes !== body.duration_minutes) throw new Error('The arrangements result did not match the exact assessment and sitting revisions.');
    return `${root}/${encodeURIComponent(source.sourceId)}/`;
  }
  throw new Error('This assessment action needs its owning result verifier.');
}

export function assessmentAuthoringAccepted(value: unknown, action: NativePendingAction): { kind: 'assessment' | 'cycle'; id: string; title: string } {
  const source = action.source, body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null, latest = object(value), root = assessmentAuthoringRoot(action.scope.schoolId), read = new URL(action.refreshPath,'https://thatcampus.invalid');
  if (!source || !body || !latest) throw new Error('The current assessment source could not be confirmed.');
  if (source.kind === 'assessment_cycle') {
    const id = read.searchParams.get('cycle_id'), cycle = Array.isArray(latest.cycles) ? latest.cycles.map(object).find(value => value?.id === id) : null;
    if (read.pathname !== `${root}/workspace/` || !uuid(id) || latest.mode !== 'admin' || !cycle || ['term_id','name','code','starts_on','ends_on','result_label'].some(key => cycle[key] !== body[key])) throw new Error('The accepted cycle did not match the current authoritative workspace.');
    return { kind: 'cycle', id, title: String(cycle.name) };
  }
  const item = object(latest.assessment), id = read.pathname.slice(root.length+1).replace(/\/$/,'');
  if (!uuid(id) || read.pathname !== `${root}/${id}/` || item?.id !== id || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1 || !Array.isArray(latest.results) || !Array.isArray(latest.publications) || !['admin','examiner'].includes(String(latest.viewer_role))) throw new Error('The current assessment did not match the accepted source and authority.');
  if (source.kind === 'assessment_creation') {
    if (['cycle_id','class_section_id','subject_id','title','assessment_kind','examiner_user_id','moderator_user_id', ...(body.context_kind === 'learning_offering' ? ['context_kind','offering_id'] : [])].some(key => item[key] !== body[key]) || Number(item.maximum_marks) !== body.maximum_marks) throw new Error('The accepted assessment differs from the original reviewed plan.');
    if (body.context_kind === 'learning_offering' && physicalAssessmentKind(String(body.assessment_kind))) {
      const operation = object(latest.exam_operation), sitting = object(operation?.sitting);
      const offered = Array.isArray(operation?.invigilators) ? operation.invigilators.map(object).filter(value => value && value.status !== 'revoked').map(value => value!.user_id) : [];
      if (!sitting || !uuid(sitting.id) || !Number.isSafeInteger(sitting.revision) || Number(sitting.revision) < 1 || (item.revision === 1 && sitting.revision === 1 && (sitting.space_id !== body.space_id || !sameInstant(sitting.starts_at, body.scheduled_at) || !validInvigilators(body.invigilator_user_ids) || offered.length !== body.invigilator_user_ids.length || body.invigilator_user_ids.some(id => !offered.includes(id))))) throw new Error('The saved course examination did not confirm the reviewed sitting and invigilators.');
    }
  } else if (source.kind === 'assessment_arrangements') {
    const operation = object(latest.exam_operation), sitting = object(operation?.sitting), invigilators = Array.isArray(operation?.invigilators) ? operation.invigilators.map(object).filter(value => value && value.status !== 'revoked').map(value => value!.user_id) : [];
    if (id !== source.sourceId || Number(item.revision) < source.revision+1 || !sitting || sitting.id !== source.fingerprint || Number(sitting.revision) < Number(body.expected_sitting_revision)+1) throw new Error('The current arrangements do not confirm the acknowledged assessment and sitting.');
    if (item.revision === source.revision+1 && (sitting.space_id !== body.space_id || !sameInstant(sitting.starts_at,body.scheduled_at) || !Array.isArray(body.invigilator_user_ids) || invigilators.length !== body.invigilator_user_ids.length || body.invigilator_user_ids.some(id => !invigilators.includes(id)))) throw new Error('The current arrangements do not confirm the accepted time, space and invigilator set.');
  } else throw new Error('This assessment source needs its owning read verifier.');
  return { kind: 'assessment', id, title: String(item.title) };
}

export function assessmentAuthoringActionAllowed(record: NativePendingAction, scope: NativePendingScope): boolean {
  if(examScheduleActionAllowed(record,scope))return true;
  try {
    if (record.source?.kind === 'assessment_creation' && record.payload.kind === 'json') {
      const body = object(JSON.parse(record.payload.body));
      if (body?.context_kind === 'learning_offering') {
        const root = assessmentAuthoringRoot(scope.schoolId), read = new URL(record.refreshPath,'https://thatcampus.invalid');
        const validArrangements = physicalAssessmentKind(String(body.assessment_kind))
          ? uuid(body.space_id) && validInvigilators(body.invigilator_user_ids) && typeof body.scheduled_at === 'string' && Number.isFinite(Date.parse(body.scheduled_at)) && Number.isInteger(body.duration_minutes) && Number(body.duration_minutes) >= 1 && Number(body.duration_minutes) <= 1440
          : body.space_id === null && Array.isArray(body.invigilator_user_ids) && body.invigilator_user_ids.length === 0;
        return record.domain === 'assessments' && record.method === 'POST' && record.endpoint === root + '/' && record.replayPolicy === 'same_request' && body.idempotency_key === record.clientId && record.source.sourceId === scope.schoolId && record.source.revision === 0 && body.class_section_id === null && ['offering_id','cycle_id','subject_id','examiner_user_id','moderator_user_id'].every(key => uuid(body[key])) && assessmentKindOptions.some(value => value.value === body.assessment_kind) && validArrangements && Object.keys(body).every(key => ['context_kind','offering_id','idempotency_key','cycle_id','class_section_id','subject_id','title','assessment_kind','maximum_marks','grading_policy_id','weight_percent','scheduled_at','duration_minutes','venue','instructions','evidence_requirement','examiner_user_id','moderator_user_id','space_id','invigilator_user_ids'].includes(key)) && read.origin === 'https://thatcampus.invalid' && !read.search && (record.phase !== 'accepted' && read.pathname === root + '/workspace/' || read.pathname.startsWith(root + '/') && uuid(read.pathname.slice(root.length + 1, -1)) && read.pathname.endsWith('/'));
      }
    }
    if (record.domain !== 'assessments' || record.method !== 'POST' || record.payload.kind !== 'json' || record.replayPolicy !== 'inspect_only' || !record.source) return false;
    const root = assessmentAuthoringRoot(scope.schoolId), source = record.source, body = object(JSON.parse(record.payload.body)), read = new URL(record.refreshPath,'https://thatcampus.invalid');
    if (!body || read.origin !== 'https://thatcampus.invalid' || ['school_id','command_id','idempotency_key','client_id'].some(key => key in body)) return false;
    if (record.endpoint === `${root}/cycles/`) return source.kind === 'assessment_cycle' && source.sourceId === scope.schoolId && source.revision === 0 && Object.keys(body).every(key => ['term_id','name','code','starts_on','ends_on','result_label'].includes(key)) && uuid(body.term_id) && read.pathname === `${root}/workspace/` && [...read.searchParams.keys()].every(key => key === 'cycle_id') && read.searchParams.getAll('cycle_id').length <= 1 && (record.phase === 'accepted' ? uuid(read.searchParams.get('cycle_id')) : !read.search || uuid(read.searchParams.get('cycle_id')));
    if (record.endpoint === `${root}/`) return source.kind === 'assessment_creation' && source.sourceId === scope.schoolId && source.revision === 0 && Object.keys(body).every(key => ['cycle_id','class_section_id','subject_id','title','assessment_kind','maximum_marks','grading_policy_id','weight_percent','scheduled_at','duration_minutes','venue','instructions','evidence_requirement','examiner_user_id','moderator_user_id','space_id','invigilator_user_ids'].includes(key)) && ['cycle_id','class_section_id','subject_id','examiner_user_id','moderator_user_id'].every(key => uuid(body[key])) && !read.search && (record.phase !== 'accepted' && read.pathname === `${root}/workspace/` || read.pathname.startsWith(root+'/') && uuid(read.pathname.slice(root.length+1).replace(/\/$/,'')) && read.pathname.endsWith('/'));
    const match = new RegExp(`^${root}/([0-9a-f-]{36})/sitting/arrangements/$`,'i').exec(record.endpoint);
    return !!match && uuid(match[1]) && source.kind === 'assessment_arrangements' && source.sourceId === match[1] && uuid(source.fingerprint) && Number.isSafeInteger(source.revision) && source.revision > 0 && body.expected_assessment_revision === source.revision && Number.isSafeInteger(body.expected_sitting_revision) && Number(body.expected_sitting_revision) > 0 && uuid(body.space_id) && Array.isArray(body.invigilator_user_ids) && body.invigilator_user_ids.length >= 1 && body.invigilator_user_ids.length <= 20 && new Set(body.invigilator_user_ids).size === body.invigilator_user_ids.length && body.invigilator_user_ids.every(uuid) && Object.keys(body).every(key => ['expected_assessment_revision','expected_sitting_revision','scheduled_at','duration_minutes','space_id','invigilator_user_ids'].includes(key)) && read.pathname === `${root}/${match[1]}/` && !read.search;
  } catch { return false; }
}
