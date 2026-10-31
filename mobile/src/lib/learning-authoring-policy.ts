import type { AssignmentItem, AssignmentList } from '../../../packages/contracts/src/wire/features/learning/assignmentApi';
import type { NativePendingAction } from './native-pending-action';
import type { ClassPracticeList } from '../../../packages/contracts/src/wire/features/notices/classPracticeApi';

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Verify the owning mutation receipt before changing an unknown command into
 * accepted-read recovery. A successful HTTP response alone is insufficient. */
export function learningAuthoringRefreshPath(value: unknown, action: NativePendingAction): string {
  const receipt = object(value), source = action.source, body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null;
  if (!receipt || !source || !body) throw new Error('The learning receipt could not be matched to the retained command.');
  const read = new URL(action.refreshPath, 'https://thatcampus.invalid');
  if (source.kind === 'assignment') {
    const root = '/api/v1/learning/assignments/', publish = `${root}${encodeURIComponent(source.sourceId)}/publish/`;
    if (![root,publish].includes(action.endpoint) || read.pathname !== `${root}${encodeURIComponent(source.sourceId)}/` || receipt.id !== source.sourceId || receipt.revision !== source.revision + 1 || body.expected_revision !== source.revision || action.endpoint === root && body.assignment_id !== source.sourceId || action.endpoint === publish && (!Number.isSafeInteger(receipt.audience_count) || Number(receipt.audience_count) < 1)) throw new Error('The assignment receipt did not match the exact source and expected revision.');
  } else if (source.kind === 'practice') {
    const root = '/api/v1/learning/practice/';
    if (read.pathname !== `${root}${encodeURIComponent(source.sourceId)}/` || (action.endpoint === root ? receipt.id !== source.sourceId || body.practice_id !== source.sourceId || receipt.revision !== 1 || source.revision !== 0 || read.searchParams.get('class_section_id') !== body.class_section_id : action.endpoint !== `${root}${encodeURIComponent(source.sourceId)}/notes/` || receipt.id !== body.note_id || read.searchParams.get('student_id') !== body.student_id)) throw new Error('The practice receipt did not match the exact publication or private note.');
  } else if (source.kind === 'session') {
    const path = new URL(action.endpoint, 'https://thatcampus.invalid');
    if (path.pathname !== `/api/v1/learning/sessions/${encodeURIComponent(source.sourceId)}/work` || read.pathname !== `/api/v1/learning/sessions/${encodeURIComponent(source.sourceId)}` || read.searchParams.get('date') !== path.searchParams.get('date') || receipt.id !== source.sourceId || receipt.date !== path.searchParams.get('date') || receipt.link_id !== action.clientId || receipt.work_kind !== body.work_kind || receipt.work_id !== body.work_id || receipt.revision !== source.revision + 1 || body.expected_revision !== source.revision || body.source_fingerprint !== source.fingerprint) throw new Error('The teaching-work receipt did not match the reviewed session and work.');
  } else throw new Error('This learning source needs its owning receipt verifier.');
  return action.refreshPath;
}
export function learningAuthoringObsolete(error: unknown, action: NativePendingAction): boolean {
  const source = action.source, outer = object(error), fields = object(object(object(outer?.details)?.error)?.fields);
  if (!source || outer?.status !== 409 || !['assignment', 'offering', 'session'].includes(source.kind)) return false;
  if (source.kind === 'session') {
    const proof = object(fields?.lesson_obsolete);
    if (!proof || proof.confirmation !== 'permanently_inapplicable' || proof.handler !== 'learning.sessions' || proof.command_id !== action.clientId || proof.source_id !== source.sourceId || proof.expected_revision !== source.revision) return false;
    if (proof.code === 'learning.session_source_changed') return proof.receipt_state === 'conflicted' && proof.reviewed_source_fingerprint === source.fingerprint && typeof proof.current_source_fingerprint === 'string' && proof.current_source_fingerprint !== source.fingerprint;
    return proof.code === 'learning.session_revision_obsolete' && proof.receipt_state === 'absent' && Number.isSafeInteger(proof.current_revision) && Number(proof.current_revision) > source.revision;
  }
  const proof = object(fields?.[source.kind === 'offering' ? 'offering_obsolete' : 'assignment_obsolete']);
  if (!proof || proof.confirmation !== 'permanently_inapplicable' || proof.receipt_state !== 'absent' || proof.handler !== `learning.${source.kind === 'offering' ? 'offerings' : 'assignments'}` || proof.command_id !== action.clientId || proof.source_id !== source.sourceId || proof.expected_revision !== source.revision || !Number.isSafeInteger(proof.current_revision) || Number(proof.current_revision) < source.revision) return false;
  if (proof.code === (source.kind === 'offering' ? 'learning.offering_revision_obsolete' : 'assignment_revision_obsolete')) return Number(proof.current_revision) > source.revision;
  if (source.kind === 'assignment') return proof.code === 'assignment_state_obsolete' && ['instructions_published', 'attempt_reviewed'].includes(String(proof.reason));
  if (proof.code !== 'learning.offering_selection_obsolete' || action.payload.kind !== 'json' || !Number.isSafeInteger(proof.current_person_revision) || !Number.isSafeInteger(proof.selected_revision) || Number(proof.current_person_revision) <= Number(proof.selected_revision)) return false;
  try {
    const body = JSON.parse(action.payload.body), selected = [...(Array.isArray(body.participants) ? body.participants : []), ...(object(body.instructor) ? [body.instructor] : [])];
    return selected.some(value => value.id === proof.person_id && value.expected_revision === proof.selected_revision);
  } catch { return false; }
}

export function learningReviewerOptions(list: AssignmentList, subject: string) {
  return [...new Map((list.reviewers ?? []).filter(person => !person.subject_id || person.subject_id === subject).map(person => [person.id, { value: person.id, label: person.name }])).values()];
}
export function learningAssignmentPayload(list: AssignmentList, item: Pick<AssignmentItem, 'id' | 'revision' | 'title' | 'instructions' | 'reviewer_id' | 'term_id' | 'subject_id' | 'due_at' | 'cutoff_at' | 'submission_mode' | 'max_attempts'>): Record<string, unknown> {
  if (!list.can_create || !item.title.trim() || !item.instructions.trim() || item.title.length > 180 || item.instructions.length > 8000 || !learningReviewerOptions(list, item.subject_id ?? '').some(option => option.value === item.reviewer_id)) throw new Error('Choose current instructions and an eligible reviewer.');
  if (item.max_attempts !== null && (!Number.isSafeInteger(item.max_attempts) || item.max_attempts < 1 || item.max_attempts > 100)) throw new Error('Use an attempt limit from 1 to 100, or leave it open.');
  if (!['text', 'files', 'either'].includes(item.submission_mode)) throw new Error('Choose a supported submission mode.');
  for (const instant of [item.due_at, item.cutoff_at]) if (instant !== null && !Number.isFinite(Date.parse(instant))) throw new Error('Choose a valid due date and cutoff.');
  if (item.cutoff_at && item.due_at && Date.parse(item.cutoff_at) < Date.parse(item.due_at)) throw new Error('The submission cutoff cannot be before the due date.');
  const context = list.context === 'offering' && list.offering ? { context_kind: 'learning_offering', offering_id: list.offering.id } : list.context === 'class' && list.class_section && list.terms?.some(term => term.id === item.term_id) && (item.subject_id ? list.subjects?.some(subject => subject.id === item.subject_id) : list.can_general === true) ? { class_section_id: list.class_section.id, term_id: item.term_id, subject_id: item.subject_id } : null;
  if (!context) throw new Error('The current learning context or subject is unavailable.');
  return { assignment_id: item.id, expected_revision: item.revision, ...context, reviewer_id: item.reviewer_id, title: item.title.trim(), instructions: item.instructions.trim(), due_at: item.due_at, cutoff_at: item.cutoff_at, submission_mode: item.submission_mode, max_attempts: item.max_attempts, policy_version: 1, resubmission_mode: 'on_request' };
}

export function learningPracticePayload(list: ClassPracticeList, input: { practiceId: string; term: string; subject: string; date: string; title: string; body: string; due: string }) {
  const realDate = /^\d{4}-\d{2}-\d{2}$/.test(input.date) && Number.isFinite(Date.parse(input.date + 'T12:00:00Z')) && new Date(input.date + 'T12:00:00Z').toISOString().slice(0,10) === input.date;
  if (!list.can_publish || !input.practiceId || !list.terms.some(term => term.id === input.term) || (input.subject ? !list.subjects.some(subject => subject.id === input.subject) : !list.can_publish_general) || !realDate || !input.title.trim() || input.title.length > 180 || !input.body.trim() || input.body.length > 4000 || input.due && !Number.isFinite(Date.parse(input.due))) throw new Error('Review the current class, term, subject and practice instructions before publishing.');
  return { practice_id: input.practiceId, class_section_id: list.class_section.id, term_id: input.term, subject_id: input.subject || null, date: input.date, title: input.title.trim(), body: input.body.trim(), due_at: input.due || null };
}
