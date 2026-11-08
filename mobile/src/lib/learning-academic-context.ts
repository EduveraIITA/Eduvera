import type { LearningOfferingAcademicContext, LearningOfferingAcademicInput, LearningOfferingAcademicReferences } from '../../../packages/contracts/src/wire/features/learning/offeringApi';

export type CourseContextDraft = { term: string; subject: string; code: string; credits: string; programme: string };
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function courseContextDraft(source?: LearningOfferingAcademicContext | null): CourseContextDraft {
  return { term: source?.term_id ?? '', subject: source?.subject_id ?? '', code: source?.course_code ?? '', credits: source ? String(source.credits) : '', programme: source?.programme_key ?? '' };
}

/** The optional course binding reuses current catalogue identities. Membership
 * dates remain with the offering's enrollment owner. */
export function courseContextInput(draft: CourseContextDraft, references: LearningOfferingAcademicReferences | undefined): LearningOfferingAcademicInput {
  if (!references || references.terms.filter(item => item.id === draft.term).length !== 1 || references.subjects.filter(item => item.id === draft.subject).length !== 1) throw new Error('Choose a current term and subject for this course.');
  const courseCode = draft.code.trim().toUpperCase(), programme = draft.programme.trim().toUpperCase();
  if (courseCode.length < 2 || courseCode.length > 80) throw new Error('Use a course code from 2 to 80 characters.');
  if (!/^\d+(?:\.\d{1,4})?$/.test(draft.credits.trim()) || !Number.isFinite(Number(draft.credits)) || Number(draft.credits) <= 0 || Number(draft.credits) > 1000) throw new Error('Enter course credits above zero and at most 1000, using up to four decimal places.');
  if (programme && (programme.length < 2 || programme.length > 80)) throw new Error('Use a programme key from 2 to 80 characters, or leave it empty.');
  return { term_id: draft.term, subject_id: draft.subject, course_code: courseCode, credits: Number(draft.credits), programme_key: programme || null };
}

/** Mutation acceptance is checked against the retained input, not whatever is
 * subsequently visible in the current course catalogue. */
export function courseContextMatches(actual: unknown, expected: unknown): boolean {
  const a = object(actual), e = object(expected);
  return !!a && !!e && ['term_id', 'subject_id', 'course_code', 'credits', 'programme_key'].every(key => a[key] === e[key]) && typeof a.credits === 'number' && Number.isFinite(a.credits) && a.credits > 0;
}
