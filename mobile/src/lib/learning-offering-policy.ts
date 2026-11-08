import type { OfferingPerson } from '../../../packages/contracts/src/wire/features/learning/offeringApi';
import type { NativePendingAction } from './native-pending-action';
import { courseContextMatches } from './learning-academic-context';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** A mutation response identifies the exact retained source before a read can finish acceptance. */
export function learningOfferingRefreshPath(value: unknown, action: NativePendingAction) {
  const receipt = object(value), source = action.source, body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null;
  const root = '/api/v1/learning/offerings/', revision = receipt?.revision;
  if (!source || source.kind !== 'offering' || !uuid(source.sourceId) || !receipt || receipt.id !== source.sourceId || !Number.isSafeInteger(revision) || Number(revision) < 1 || !body) throw new Error('The group receipt did not identify this retained action.');
  const groupPath = `${root}${source.sourceId}/`;
  if (action.endpoint === root || action.endpoint === groupPath + 'enrollments/') {
    const selected = Array.isArray(body.participants) ? body.participants : [], enrollments = Array.isArray(receipt.enrollments) ? receipt.enrollments : [];
    if (!selected.length || selected.length !== enrollments.length || selected.some(selectedPerson => !enrollments.some(saved => { const person = object(selectedPerson), row = object(saved); return person && row && row.person_id === person.id && uuid(row.id) && Number.isSafeInteger(row.revision) && Number(row.revision) > 0; }))) throw new Error('The receipt did not confirm the exact reviewed learners.');
    if (action.endpoint === root && (!uuid(receipt.teaching_assignment_id) || Number(revision) !== 1 || body.offering_id !== source.sourceId || source.revision !== 0)) throw new Error('The new group receipt did not match its original creation.');
    if (action.endpoint === root && body.academic_context && !courseContextMatches(receipt.academic_context, body.academic_context)) throw new Error('The receipt did not confirm the reviewed course details.');
    if (action.endpoint !== root && Number(revision) !== source.revision + 1) throw new Error('The saved group revision did not match this enrollment action.');
  } else if (action.endpoint === groupPath + 'academic-context/') {
    if (body.command_id !== action.clientId || body.expected_revision !== source.revision || Number(revision) !== source.revision + 1 || receipt.action !== 'academic.configure' || !courseContextMatches(receipt.academic_context, body.academic_context)) throw new Error('The course configuration receipt did not match the retained review.');
  } else if (action.endpoint === groupPath + 'instructors/') {
    if (!uuid(receipt.teaching_assignment_id) || Number(revision) !== source.revision + 1) throw new Error('The instructor appointment receipt did not match this action.');
  } else {
    const end = /^(enrollments|instructors)\/([0-9a-f-]{36})\/end\/$/i.exec(action.endpoint.slice(groupPath.length));
    if (!action.endpoint.startsWith(groupPath) || !end || receipt.record_id !== end[2] || receipt.record_revision !== source.revision + 1 || !learningOfferingDay(String(receipt.ends_on ?? ''))) throw new Error('The ended responsibility receipt did not match this action.');
  }
  return groupPath;
}

export function learningOfferingDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}
export function learningOfferingPeople(people: readonly OfferingPerson[], excluded: readonly string[] = []) {
  if (!people.length || people.length > 100) throw new Error('Choose between 1 and 100 people.');
  if (new Set(people.map(person => person.id)).size !== people.length) throw new Error('Choose each person once.');
  return people.map(person => {
    if (!person.id || !person.name.trim() || !Number.isSafeInteger(person.revision) || person.revision < 1) throw new Error('Review the current person before continuing.');
    if (excluded.includes(person.id)) throw new Error('The instructor and learners must be different people.');
    return { id: person.id, expected_revision: person.revision };
  });
}
export function learningOfferingStart(value: string, today: string) {
  if (!learningOfferingDay(value) || !learningOfferingDay(today) || value > today) throw new Error('Choose a valid start date on or before the campus date.');
  return value;
}
export function learningOfferingCreation(id: string, name: string, people: readonly OfferingPerson[], instructor: OfferingPerson | null, startsOn: string, today: string) {
  if (!name.trim() || name.trim().length > 150) throw new Error('Use a group name from 1 to 150 characters.');
  if (!instructor) throw new Error('Choose an instructor with current app access.');
  const selected = learningOfferingPeople([instructor])[0]!;
  return { offering_id: id, name: name.trim(), participants: learningOfferingPeople(people, [instructor.id]), instructor: selected, starts_on: learningOfferingStart(startsOn, today) };
}
