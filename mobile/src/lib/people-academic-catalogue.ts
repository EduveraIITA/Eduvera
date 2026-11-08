import type { Administration, CatalogKind, ClassSection, Subject, Term } from '../../../packages/contracts/src/institution';
import type { NativePendingAction, NativePendingScope } from './native-pending-action';
import { nativeCalendarValidDate } from './native-calendar';

export type AcademicCatalogueKind = CatalogKind;
export type AcademicCatalogueRow = (Term | ClassSection | Subject) & { school_id: string };
export type AcademicCatalogue = Omit<Administration, 'terms' | 'classes' | 'subjects'> & Record<AcademicCatalogueKind, AcademicCatalogueRow[]>;
export type AcademicCatalogueValues = Record<string, string | number | boolean>;
export const academicCatalogueKinds: AcademicCatalogueKind[] = ['terms', 'classes', 'subjects'];
export const academicSubjectIcons = ['book-open', 'calculator', 'flask-conical', 'languages', 'palette', 'dumbbell', 'laptop', 'globe-2'] as const;
export const academicCatalogueUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function academicCatalogueRead(schoolId: string) { return `/api/v1/schools/${encodeURIComponent(schoolId)}/administration/`; }
export function academicCatalogueEndpoint(schoolId: string, kind: AcademicCatalogueKind, id?: string) { return `/api/v1/schools/${encodeURIComponent(schoolId)}/catalog/${kind}/${id ? `${id}/` : ''}`; }
export function academicCatalogueName(kind: AcademicCatalogueKind, row: AcademicCatalogueRow | AcademicCatalogueValues) { return kind === 'classes' ? `Class ${'grade' in row ? row.grade : ''}${'section' in row ? row.section : ''}` : String('name' in row ? row.name : ''); }
export function academicCatalogueUsage(kind: AcademicCatalogueKind, row?: AcademicCatalogueRow) {
  const fields = kind === 'terms' ? [['enrollment_count', 'enrollments'], ['timetable_count', 'periods'], ['register_count', 'registers']] : kind === 'classes' ? [['enrollment_count', 'enrollments'], ['timetable_count', 'periods'], ['assignment_count', 'staff assignments']] : [['timetable_count', 'periods'], ['attendance_count', 'attendance records'], ['diary_count', 'diary items'], ['day_plan_count', 'day plans']];
  const details = fields.map(([key, label]) => ({ label, count: Number((row as unknown as Record<string, unknown> | undefined)?.[key] ?? 0) }));
  return { total: details.reduce((total, item) => total + item.count, 0), details };
}
export function academicCatalogueFields(kind: AcademicCatalogueKind, row?: AcademicCatalogueRow): AcademicCatalogueValues {
  if (kind === 'terms') { const term = row as Term | undefined; return { name: term?.name ?? '', academic_year: term?.academic_year ?? '', starts_on: term?.starts_on ?? '', ends_on: term?.ends_on ?? '', attendance_threshold: term?.attendance_threshold ?? '85', is_active: term?.is_active ?? true }; }
  if (kind === 'classes') { const cls = row as ClassSection | undefined; return { academic_year: cls?.academic_year ?? '', grade: cls?.grade ?? '', section: cls?.section ?? '', board: cls?.board ?? '', room_number: cls?.room_number ?? '' }; }
  const subject = row as Subject | undefined;
  return { code: subject?.code ?? '', name: subject?.name ?? '', short_name: subject?.short_name ?? '', color: subject?.color ?? '#1D4ED8', icon: subject?.icon ?? 'book-open' };
}
export function academicCatalogueInput(kind: AcademicCatalogueKind, values: AcademicCatalogueValues, row?: AcademicCatalogueRow, confirmed = false, reason = '') {
  const text = (key: string, max: number, required = true) => { const value = String(values[key] ?? '').trim(); if (value.length > max || required && !value) throw new Error(`Review ${key.replaceAll('_', ' ')}.`); return value; };
  let result: AcademicCatalogueValues;
  if (kind === 'terms' || kind === 'classes') {
    const academic_year = text('academic_year', 9);
    if (!/^\d{4}-\d{2}(?:\d{2})?$/.test(academic_year)) throw new Error('Use an academic year such as 2026-27.');
    if (row && academic_year !== (row as Term | ClassSection).academic_year) throw new Error('Create a new record to change its academic year.');
    if (kind === 'terms') {
      const starts_on = text('starts_on', 10), ends_on = text('ends_on', 10), attendance_threshold = Number(text('attendance_threshold', 10));
      if (!nativeCalendarValidDate(starts_on) || !nativeCalendarValidDate(ends_on) || ends_on < starts_on) throw new Error('Choose a valid term date range.');
      if (!Number.isFinite(attendance_threshold) || attendance_threshold < 0 || attendance_threshold > 100) throw new Error('Attendance minimum must be between 0 and 100.');
      result = { academic_year, name: text('name', 100), starts_on, ends_on, attendance_threshold, is_active: values.is_active === true };
    } else result = { academic_year, grade: text('grade', 16), section: text('section', 16), board: text('board', 100, false), room_number: text('room_number', 32, false) };
  } else {
    const color = text('color', 7).toUpperCase(), icon = text('icon', 30);
    if (!/^#[0-9A-F]{6}$/.test(color) || !academicSubjectIcons.includes(icon as typeof academicSubjectIcons[number])) throw new Error('Choose a subject icon and six-digit color.');
    result = { code: text('code', 16).toUpperCase(), name: text('name', 100), short_name: text('short_name', 40), color, icon };
  }
  if (row) {
    const current = academicCatalogueFields(kind, row), changed = Object.entries(result).some(([key, value]) => key === 'attendance_threshold' ? Number(current[key]) !== value : current[key] !== value);
    if (!changed) throw new Error('Change at least one detail before saving.');
    if (!revision(row.revision)) throw new Error('Refresh this record before editing it.');
    const linked = academicCatalogueUsage(kind, row).total, change_reason = reason.trim();
    if (change_reason.length > 240 || linked && (!confirmed || change_reason.length < 8)) throw new Error('Review the linked records, confirm the impact and give a reason of at least eight characters.');
    return { ...result, expected_revision: row.revision, confirmed: linked ? confirmed : true, change_reason };
  }
  return result;
}
export function academicCatalogueMatches(value: unknown, schoolId: string): value is AcademicCatalogue {
  const data = value as AcademicCatalogue | null;
  return !!data && data.school?.id === schoolId && academicCatalogueKinds.every(kind => Array.isArray(data[kind]) && data[kind].every(row => academicCatalogueUuid(row.id) && row.school_id === schoolId && revision(row.revision) && academicCatalogueUsage(kind, row).details.every(item => Number.isSafeInteger(item.count) && item.count >= 0)));
}
function mutation(action: NativePendingAction) {
  const root = `/api/v1/schools/${encodeURIComponent(action.scope.schoolId)}/catalog/`, match = /^(terms|classes|subjects)\/(?:([0-9a-f-]{36})\/)?$/i.exec(action.endpoint.slice(root.length));
  if (!action.endpoint.startsWith(root) || !match || action.payload.kind !== 'json') throw new Error('The retained academic catalogue action is invalid.');
  return { kind: match[1] as AcademicCatalogueKind, id: match[2], body: JSON.parse(action.payload.body) as AcademicCatalogueValues };
}
function fieldsMatch(row: Record<string, unknown>, body: AcademicCatalogueValues, kind: AcademicCatalogueKind) {
  return Object.keys(academicCatalogueFields(kind)).every(key => key === 'attendance_threshold' ? Number(row[key]) === Number(body[key]) : row[key] === body[key]);
}
/** The accepted marker retains the owning receipt identity across a failed follow-up read. */
export function academicCatalogueRefreshPath(value: unknown, action: NativePendingAction) {
  const row = object(value), { kind, id, body } = mutation(action), expected = id ? Number(body.expected_revision) + 1 : 1;
  if (!row || !academicCatalogueUuid(row.id) || row.school_id !== action.scope.schoolId || id && row.id !== id || row.revision !== expected || !fieldsMatch(row, body, kind)) throw new Error('The catalogue receipt did not match this exact reviewed change.');
  if (action.replayPolicy === 'same_request') {
    if (row.id !== body.catalog_id) throw new Error('The catalogue receipt belongs to another exact record.');
    return academicCatalogueConfirmationPath(action.scope.schoolId, kind, String(body.catalog_id), action.clientId);
  }
  return academicCatalogueRead(action.scope.schoolId) + '?' + new URLSearchParams({ catalog_kind: kind, catalog_id: row.id, catalog_revision: String(expected) });
}
export function acceptedAcademicCatalogue(value: unknown, action: NativePendingAction) {
  if (action.replayPolicy === 'same_request') {
    const receipt = object(value), { kind, id, body } = mutation(action), row = object(receipt?.result);
    const expected = id ? Number(body.expected_revision) + 1 : 1;
    if (!receipt || receipt.handler !== 'academic.catalogue' || receipt.state !== 'accepted' || receipt.school_id !== action.scope.schoolId
      || receipt.kind !== kind || receipt.source_id !== body.catalog_id || receipt.command_id !== action.clientId
      || receipt.expected_revision !== action.source?.revision || !row || row.id !== body.catalog_id || row.school_id !== action.scope.schoolId
      || row.revision !== expected || !fieldsMatch(row, body, kind)) throw new Error('The exact saved catalogue command could not be confirmed.');
    return { data: null, row: row as unknown as AcademicCatalogueRow, kind };
  }
  if (!academicCatalogueMatches(value, action.scope.schoolId)) throw new Error('The saved catalogue belongs to another campus or is incomplete.');
  const read = new URL(action.refreshPath, 'https://thatcampus.invalid'), { kind, body } = mutation(action), id = read.searchParams.get('catalog_id'), expected = Number(read.searchParams.get('catalog_revision'));
  const row = value[kind].find(item => item.id === id);
  if (read.searchParams.get('catalog_kind') !== kind || !row || row.revision !== expected || !fieldsMatch(row as unknown as Record<string, unknown>, body, kind)) throw new Error('The exact saved academic record could not be confirmed. Keep this retained action and refresh again.');
  return { data: value, row, kind };
}
export function nativePeopleAcademicCatalogueAllowed(record: NativePendingAction, scope: NativePendingScope): boolean {
  try {
    if (record.replayPolicy === 'same_request') return identifiedCatalogueAllowed(record, scope);
    if (record.domain !== 'people' || record.replayPolicy !== 'inspect_only' || record.payload.kind !== 'json' || !record.source) return false;
    const { kind, id, body } = mutation(record), root = academicCatalogueRead(scope.schoolId), read = new URL(record.refreshPath, 'https://thatcampus.invalid');
    if (record.endpoint !== academicCatalogueEndpoint(scope.schoolId, kind, id) || read.pathname !== root || 'school_id' in body || ['command_id', 'idempotency_key', 'client_id'].some(key => key in body) || record.source.kind !== `academic_catalog_${kind}`) return false;
    const fields = Object.keys(academicCatalogueFields(kind)), allowed = [...fields, ...(id ? ['expected_revision', 'confirmed', 'change_reason'] : [])];
    if (Object.keys(body).some(key => !allowed.includes(key)) || !fields.every(key => key in body) || kind === 'terms' && typeof body.attendance_threshold !== 'number') return false;
    const normalized = academicCatalogueInput(kind, body);
    if (!fieldsMatch(body, normalized, kind) || id && (typeof body.confirmed !== 'boolean' || typeof body.change_reason !== 'string' || body.change_reason.length > 240)) return false;
    if (id ? !academicCatalogueUuid(id) || record.method !== 'PATCH' || record.source.sourceId !== id || !revision(record.source.revision) || body.expected_revision !== record.source.revision : record.method !== 'POST' || record.source.sourceId !== scope.schoolId || record.source.revision !== 0 || 'expected_revision' in body) return false;
    if (record.phase !== 'accepted') return !read.search;
    const keys = [...read.searchParams.keys()];
    return keys.length === 3 && new Set(keys).size === 3 && keys.every(key => ['catalog_kind', 'catalog_id', 'catalog_revision'].includes(key)) && read.searchParams.get('catalog_kind') === kind && academicCatalogueUuid(read.searchParams.get('catalog_id')) && (!id || read.searchParams.get('catalog_id') === id) && read.searchParams.get('catalog_revision') === String(id ? record.source.revision + 1 : 1);
  } catch { return false; }
}


export function academicCatalogueConfirmationPath(schoolId: string, kind: AcademicCatalogueKind, id: string, commandId: string) {
  return `${academicCatalogueEndpoint(schoolId, kind, id)}commands/${encodeURIComponent(commandId)}/`;
}
function identifiedCatalogueAllowed(record: NativePendingAction, scope: NativePendingScope): boolean {
  if (record.domain !== 'people' || record.payload.kind !== 'json' || !record.source) return false;
  const { kind, id, body } = mutation(record), fields = Object.keys(academicCatalogueFields(kind));
  const allowed = [...fields, 'command_id', 'catalog_id', ...(id ? ['expected_revision', 'confirmed', 'change_reason'] : [])];
  if (record.endpoint !== academicCatalogueEndpoint(scope.schoolId, kind, id) || body.command_id !== record.clientId
    || !academicCatalogueUuid(body.catalog_id) || record.source.kind !== `academic_catalog_${kind}` || record.source.sourceId !== body.catalog_id
    || Object.keys(body).some(key => !allowed.includes(key)) || !fields.every(key => key in body)
    || kind === 'terms' && typeof body.attendance_threshold !== 'number' || !fieldsMatch(body, academicCatalogueInput(kind, body), kind)) return false;
  if (id ? record.method !== 'PATCH' || id !== body.catalog_id || !revision(record.source.revision) || body.expected_revision !== record.source.revision
    || typeof body.confirmed !== 'boolean' || typeof body.change_reason !== 'string' || body.change_reason.length > 240
    : record.method !== 'POST' || record.source.revision !== 0) return false;
  return record.refreshPath === (record.phase === 'accepted'
    ? academicCatalogueConfirmationPath(scope.schoolId, kind, body.catalog_id, record.clientId)
    : academicCatalogueRead(scope.schoolId));
}
/** Only the owning, actor/world-bound command proof can retire an uncertain stale edit. */
export function academicCatalogueCommandObsolete(error: unknown, action: NativePendingAction): boolean {
  try {
    if (action.replayPolicy !== 'same_request' || !identifiedCatalogueAllowed(action, action.scope)) return false;
    const response = object(error), fields = object(object(object(response?.details)?.error)?.fields), proof = object(fields?.catalogue_obsolete);
    return response?.status === 409 && proof?.handler === 'academic.catalogue' && proof.confirmation === 'permanently_inapplicable'
      && proof.receipt_state === 'absent' && proof.source_id === action.source?.sourceId && proof.command_id === action.clientId
      && typeof proof.expected_revision === 'number' && proof.expected_revision === action.source?.revision && revision(proof.current_revision) && proof.current_revision > proof.expected_revision;
  } catch { return false; }
}
