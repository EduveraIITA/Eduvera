import type { NativePendingAction } from './native-pending-action';

export const eventTypes = ['annual_function', 'excursion', 'sports', 'workshop', 'competition', 'assembly', 'ptm', 'club', 'other'] as const;
export type EventType = typeof eventTypes[number] | 'class_test';
export type EventSessionType = 'general' | 'rehearsal' | 'departure' | 'activity' | 'return';
export type EventAttendanceMode = 'none' | 'check_in' | 'check_in_out';
export type EventStaffRole = 'organizer' | 'duty_staff' | 'attendance_taker';
export interface EventAudience { mode: 'school' | 'class_sections' | 'students'; class_section_ids: string[]; student_ids: string[] }
export interface EventSessionInput { id?: string; title: string; session_type: EventSessionType; venue: string; space_id: string | null; use_event_space: boolean; starts_at: string; ends_at: string; attendance_mode: EventAttendanceMode; participant_student_ids: string[] }
export interface EventInput { event_type: EventType; subject_id: string | null; title: string; description: string; venue: string; space_id: string | null; starts_at: string; ends_at: string; audience: EventAudience; participation_requirement: 'optional' | 'mandatory'; requires_rsvp: boolean; requires_guardian_consent: boolean; payment_required: boolean; payment_amount_paise: number | null; payment_due_on: string | null; sessions: EventSessionInput[]; checklist: Array<{ id?: string; label: string; required: boolean }>; staff: Array<{ user_id: string; role: EventStaffRole }> }
export interface EventCatalog { class_sections: Array<{ id: string; name: string }>; students: Array<{ id: string; name: string; class_section_id: string; admission_number: string }>; staff: Array<{ user_id: string; name: string }>; subjects: Array<{ id: string; name: string; class_section_ids: string[] }>; places?: Array<{ id: string; name: string; campus_id: string; campus_name: string }> }
export interface EventParticipant { student_id: string; student_name: string; participation_requirement: string; rsvp_status: string; rsvp_revision: number; consent_status: string; consent_revision: number; consent_readiness: string; payment_status: string; fee_invoice_id: string | null; checklist_completed_item_ids: string[] }
export interface NativeEvent extends Omit<EventInput, 'sessions' | 'staff'> { id: string; school_id: string; status: 'draft' | 'published' | 'cancelled' | 'completed'; revision: number; cancellation_reason: string | null; cancellation_internal_reason: string | null; sessions: Array<EventSessionInput & { id: string; state: 'open' | 'locked'; revision: number; counts: { recorded: number; not_recorded: number } }>; viewer_participants: EventParticipant[]; permissions: { can_edit: boolean; can_publish: boolean; can_cancel: boolean; can_complete: boolean; can_rsvp: boolean; can_consent: boolean; can_take_attendance: boolean; can_manage_policy: boolean; can_manage_audience: boolean; can_manage_staff: boolean; can_view_finance_details: boolean }; staff: Array<{ user_id: string; name: string; role: EventStaffRole }> }
export interface EventFinanceItem { student_id: string; student_name: string; participation_state: string; withdrawal_id: string | null; withdrawn_at: string | null; can_withdraw: boolean; finance_state: string; currency: 'INR'; invoice_id: string | null; invoice_amount_paise: number; credited_paise: number; paid_paise: number; refunded_paise: number; collectible_balance_paise: number; refund_due_paise: number; refunds: Array<{ id: string; amount_paise: number; method: 'cash' | 'bank_transfer' | 'cheque'; reference: string; reason: string; recorded_at: string }> }
export interface EventFinance { event: { id: string; title: string; status: string }; items: EventFinanceItem[]; counts: { reconciliation_required: number; withdrawn: number }; permissions: { can_view_finance_details: boolean; can_record_refund: boolean } }
export const eventUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const revision = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
const text = (value: string, maximum: number, minimum = 0) => typeof value === 'string' && value.trim().length >= minimum && value.trim().length <= maximum && !value.includes('\0');
const unique = (values: string[], maximum: number) => values.length <= maximum && values.every(eventUuid) && new Set(values).size === values.length;
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const sorted = (values: string[]) => [...values].sort();

export interface NativeEventRoute { kind: 'manage' | 'assigned' | 'calendar'; base: string; studentId: string | null; eventId: string | null; sessionId: string | null; editor: boolean }
export function resolveNativeEventRoute(href: string, surfaces: readonly { key: string; scopes?: readonly { kind: string; id?: string | null }[] }[]): NativeEventRoute | null {
  const [path, search = ''] = href.split('?'), q = new URLSearchParams(search), parts = path!.split('/').filter(Boolean), kind = parts[2];
  if (parts[0] !== 'areas' || parts[1] !== 'events' || !['manage', 'assigned', 'calendar'].includes(kind ?? '') || [...new Set(q.keys())].some(key => ['scope', 'student_id', 'event_id', 'session_id'].includes(key) && q.getAll(key).length !== 1)) return null;
  const studentId = q.get('student_id'), relationship = q.get('scope');
  if (kind === 'calendar') {
    const surface = surfaces.find(surface => surface.key === `calendar:${relationship}:${studentId}`);
    if (!studentId || !eventUuid(studentId) || !['self', 'dependent'].includes(relationship ?? '') || !surface?.scopes?.some(scope => scope.kind === relationship && scope.id === studentId)) return null;
  } else if (studentId || relationship || !surfaces.some(surface => surface.key === kind)) return null;
  const isNew = parts[3] === 'new', editor = isNew || parts[4] === 'edit', pathId = isNew ? null : parts[3], eventId = pathId ?? q.get('event_id'), sessionId = parts[4] === 'sessions' ? parts[5] ?? null : q.get('session_id');
  if (eventId && !eventUuid(eventId) || sessionId && (!eventId || !eventUuid(sessionId)) || pathId && q.has('event_id') && q.get('event_id') !== pathId || parts[4] === 'sessions' && q.has('session_id') && q.get('session_id') !== sessionId) return null;
  if (isNew ? kind !== 'manage' || parts.length !== 4 || q.has('event_id') || q.has('session_id') : editor ? kind === 'calendar' || parts.length !== 5 || !eventId : parts.length > 4 && !(parts.length === 7 && parts[4] === 'sessions' && parts[6] === 'attendance' && sessionId)) return null;
  if (kind === 'calendar' && (editor || sessionId)) return null;
  return { kind: kind as NativeEventRoute['kind'], base: `/areas/events/${kind}`, studentId: kind === 'calendar' ? studentId : null, eventId: eventId ?? null, sessionId, editor };
}
export function eventDetailRead(schoolId: string, eventId: string, studentId?: string | null) { return `/api/v1/campus-events/${encodeURIComponent(eventId)}?${new URLSearchParams({ school_id: schoolId, ...(studentId ? { student_id: studentId } : {}) })}`; }
export function eventFinanceRead(schoolId: string, eventId: string, studentId?: string | null) { return `/api/v1/campus-events/${encodeURIComponent(eventId)}/finance?${new URLSearchParams({ school_id: schoolId, ...(studentId ? { student_id: studentId } : {}) })}`; }
export function assertNativeEvent(value: unknown, schoolId: string, eventId?: string): asserts value is NativeEvent {
  const event = value as NativeEvent | null;
  const permissions = ['can_edit', 'can_publish', 'can_cancel', 'can_complete', 'can_rsvp', 'can_consent', 'can_take_attendance', 'can_manage_policy', 'can_manage_audience', 'can_manage_staff', 'can_view_finance_details'] as const;
  if (!event || event.school_id !== schoolId || !eventUuid(event.id) || eventId && event.id !== eventId || !revision(event.revision) || !['draft', 'published', 'cancelled', 'completed'].includes(event.status) || !event.permissions || permissions.some(key => typeof event.permissions[key] !== 'boolean') || !event.audience || !['school', 'class_sections', 'students'].includes(event.audience.mode) || !Array.isArray(event.audience.class_section_ids) || !Array.isArray(event.audience.student_ids) || !unique(event.audience.class_section_ids, 100) || !unique(event.audience.student_ids, 500) || !Array.isArray(event.sessions) || !unique(event.sessions.map(item => item.id), 32) || event.sessions.some(item => !revision(item.revision) || !['open', 'locked'].includes(item.state) || !['none', 'check_in', 'check_in_out'].includes(item.attendance_mode) || !Array.isArray(item.participant_student_ids) || !unique(item.participant_student_ids, 500) || !item.counts || !Number.isSafeInteger(item.counts.recorded) || item.counts.recorded < 0) || !Array.isArray(event.checklist) || !unique(event.checklist.map(item => item.id!), 40) || !Array.isArray(event.staff) || !unique(event.staff.map(item => item.user_id), 100) || !Array.isArray(event.viewer_participants) || !unique(event.viewer_participants.map(item => item.student_id), Number.MAX_SAFE_INTEGER) || event.viewer_participants.some(item => !Number.isSafeInteger(item.rsvp_revision) || item.rsvp_revision < 0 || !Number.isSafeInteger(item.consent_revision) || item.consent_revision < 0 || !Array.isArray(item.checklist_completed_item_ids) || !unique(item.checklist_completed_item_ids, 40))) throw new Error('The service did not confirm this exact campus event and its source records.');
}
export function assertEventFinance(value: unknown, eventId: string, studentId?: string | null): asserts value is EventFinance {
  const finance = value as EventFinance | null;
  if (!finance || finance.event?.id !== eventId || !Array.isArray(finance.items) || !finance.permissions || typeof finance.permissions.can_record_refund !== 'boolean' || typeof finance.permissions.can_view_finance_details !== 'boolean' || new Set(finance.items.map(item => item.student_id)).size !== finance.items.length || finance.items.some(item => !eventUuid(item.student_id) || item.currency !== 'INR' || !Array.isArray(item.refunds) || typeof item.can_withdraw !== 'boolean' || !['invoice_amount_paise', 'credited_paise', 'paid_paise', 'refunded_paise', 'collectible_balance_paise', 'refund_due_paise'].every(key => Number.isSafeInteger(item[key as keyof EventFinanceItem]) && (item[key as keyof EventFinanceItem] as number) >= 0)) || studentId && (finance.items.length !== 1 || finance.items[0]?.student_id !== studentId)) throw new Error('The service did not confirm this exact event finance record and learner.');
}
export function eventActionRefreshPath(value: unknown, action: NativePendingAction) { if (action.endpoint !== '/api/v1/campus-events') return action.refreshPath; assertNativeEvent(value, action.scope.schoolId); return eventDetailRead(action.scope.schoolId, value.id); }
export function assertEventRead(value: unknown, action: NativePendingAction) {
  const url = new URL(action.refreshPath, 'https://thatcampus.invalid'), parts = url.pathname.split('/').filter(Boolean), eventId = parts[3];
  if (url.searchParams.getAll('school_id').length !== 1 || url.searchParams.get('school_id') !== action.scope.schoolId || !eventUuid(eventId)) throw new Error('The retained event read did not match this campus.');
  if (parts[4] === 'finance') assertEventFinance(value, eventId, url.searchParams.get('student_id'));
  else if (parts[4] === 'sessions') { const register = value as { event?: { id?: string }; session?: { id?: string; revision?: number } }; if (register?.event?.id !== eventId || register.session?.id !== parts[5] || !revision(register.session.revision)) throw new Error('The saved register belongs to another event or session.'); }
  else { assertNativeEvent(value, action.scope.schoolId, eventId); const studentId = url.searchParams.get('student_id'); if (studentId && (value.viewer_participants.length !== 1 || value.viewer_participants[0]?.student_id !== studentId)) throw new Error('The saved event did not confirm this exact learner.'); }
}
export function eventInputFromSource(event: NativeEvent): EventInput {
  return { event_type: event.event_type, subject_id: event.subject_id, title: event.title, description: event.description, venue: event.venue, space_id: event.space_id ?? null, starts_at: event.starts_at, ends_at: event.ends_at, audience: { mode: event.audience.mode, class_section_ids: [...event.audience.class_section_ids], student_ids: [...event.audience.student_ids] }, participation_requirement: event.participation_requirement, requires_rsvp: event.requires_rsvp, requires_guardian_consent: event.requires_guardian_consent, payment_required: event.payment_required, payment_amount_paise: event.payment_amount_paise, payment_due_on: event.payment_due_on, sessions: event.sessions.map(session => ({ id: session.id, title: session.title, session_type: session.session_type, venue: session.venue, space_id: session.space_id ?? null, use_event_space: session.use_event_space ?? false, starts_at: session.starts_at, ends_at: session.ends_at, attendance_mode: session.attendance_mode, participant_student_ids: [...session.participant_student_ids] })), checklist: event.checklist.map(item => ({ ...item })), staff: event.staff.map(({ user_id, role }) => ({ user_id, role })) };
}
export function newEventInput(now: string | number): EventInput {
  const instant = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(instant)) throw new Error('Confirm the selected campus clock before planning an event.');
  const start = new Date(instant + 7 * 86400000).toISOString(), end = new Date(instant + 7 * 86400000 + 3 * 3600000).toISOString();
  return { event_type: 'other', subject_id: null, title: '', description: '', venue: '', space_id: null, starts_at: start, ends_at: end, audience: { mode: 'school', class_section_ids: [], student_ids: [] }, participation_requirement: 'optional', requires_rsvp: true, requires_guardian_consent: false, payment_required: false, payment_amount_paise: null, payment_due_on: null, sessions: [{ title: 'Main programme', session_type: 'general', venue: '', space_id: null, use_event_space: true, starts_at: start, ends_at: end, attendance_mode: 'none', participant_student_ids: [] }], checklist: [], staff: [] };
}
export function eventAudienceStudents(input: EventInput, catalog: EventCatalog) { return catalog.students.filter(student => input.audience.mode === 'school' || input.audience.mode === 'class_sections' && input.audience.class_section_ids.includes(student.class_section_id) || input.audience.mode === 'students' && input.audience.student_ids.includes(student.id)); }
export function eventMoneyInput(value: string) {
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter an INR amount with at most two decimal places.');
  const [whole, fraction = ''] = value.trim().split('.'), paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise < 1 || paise > 100000000) throw new Error('Enter an amount between ₹0.01 and ₹10,00,000.');
  return paise;
}
export function validateEventInput(input: EventInput, catalog: EventCatalog, source?: NativeEvent): EventInput {
  if (source && (source.status !== 'draft' || !source.permissions.can_edit)) throw new Error('Current authority to edit this draft could not be confirmed.');
  if (!eventTypes.includes(input.event_type as typeof eventTypes[number]) || input.subject_id !== null) throw new Error('Class tests belong in Assessments. Open the owning assessment plan.');
  if (!text(input.title, 160, 1) || !text(input.description, 4000) || !text(input.venue, 240)) throw new Error('Confirm the event name, description and venue.');
  const start = Date.parse(input.starts_at), end = Date.parse(input.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('The event must end after it starts.');
  const audience = input.audience;
  if (!unique(audience.class_section_ids, 100) || !unique(audience.student_ids, 500) || !['school', 'class_sections', 'students'].includes(audience.mode) || audience.mode === 'school' && (audience.class_section_ids.length || audience.student_ids.length) || audience.mode === 'class_sections' && (!audience.class_section_ids.length || audience.student_ids.length) || audience.mode === 'students' && (!audience.student_ids.length || audience.class_section_ids.length)) throw new Error('Choose one explicit event audience.');
  const known = (id: string, values: string[], previous: string[] = []) => values.includes(id) || previous.includes(id);
  if (audience.class_section_ids.some(id => !known(id, catalog.class_sections.map(item => item.id), source?.audience.class_section_ids)) || audience.student_ids.some(id => !known(id, catalog.students.map(item => item.id), source?.audience.student_ids))) throw new Error('Choose current audience records from this campus.');
  if (!['optional', 'mandatory'].includes(input.participation_requirement) || input.participation_requirement === 'optional' && !input.requires_rsvp) throw new Error('Optional participation requires RSVP.');
  if (input.payment_required ? !Number.isSafeInteger(input.payment_amount_paise) || input.payment_amount_paise! < 1 || input.payment_amount_paise! > 100000000 || !input.payment_due_on || !day(input.payment_due_on) : input.payment_amount_paise !== null || input.payment_due_on !== null) throw new Error('Paid participation needs a valid amount and due date. Free events must omit both.');
  if (!input.sessions.length || input.sessions.length > 32 || input.checklist.length > 40 || input.staff.length > 100) throw new Error('Use 1–32 sessions, at most 40 checklist items and 100 staff duties.');
  const eligible = new Set(eventAudienceStudents(input, catalog).map(item => item.id)), unchangedAudience = !!source && equal([audience.mode, sorted(audience.class_section_ids), sorted(audience.student_ids)], [source.audience.mode, sorted(source.audience.class_section_ids), sorted(source.audience.student_ids)]);
  const sessionIds: string[] = [], checklistIds: string[] = [];
  const placeIds = (catalog.places ?? []).map(item => item.id);
  if (input.space_id && !known(input.space_id, placeIds, source?.space_id ? [source.space_id] : [])) throw new Error('Choose a mapped place from this campus.');
  for (const session of input.sessions) {
    if (session.id) sessionIds.push(session.id);
    const old = source?.sessions.find(item => item.id === session.id), from = Date.parse(session.starts_at), until = Date.parse(session.ends_at);
    if (!text(session.title, 160, 1) || !text(session.venue, 240) || !['general', 'rehearsal', 'departure', 'activity', 'return'].includes(session.session_type) || !['none', 'check_in', 'check_in_out'].includes(session.attendance_mode) || !Number.isFinite(from) || !Number.isFinite(until) || until <= from || from < start || until > end) throw new Error('Every named session must fit inside the event window with its end after its start.');
    if (session.use_event_space && session.space_id || session.space_id && !known(session.space_id, placeIds, old?.space_id ? [old.space_id] : [])) throw new Error('Choose the event place or one current session place.');
    if (!unique(session.participant_student_ids, 500) || session.participant_student_ids.some(id => !eligible.has(id) && !(unchangedAudience && old?.participant_student_ids.includes(id) && !catalog.students.some(student => student.id === id)))) throw new Error('Session participants must belong to the selected event audience.');
    if (session.id && !source?.sessions.some(item => item.id === session.id)) throw new Error('A saved session belongs to a different event.');
  }
  for (const item of input.checklist) { if (item.id) checklistIds.push(item.id); if (!text(item.label, 180, 1) || item.id && !source?.checklist.some(old => old.id === item.id)) throw new Error('Confirm each preparation item and its original event.'); }
  if (!unique(sessionIds, 32) || !unique(checklistIds, 40) || !unique(input.staff.map(item => item.user_id), 100) || input.staff.some(item => !['organizer', 'duty_staff', 'attendance_taker'].includes(item.role) || !known(item.user_id, catalog.staff.map(person => person.user_id), source?.staff.map(person => person.user_id)))) throw new Error('Use distinct event sessions, checklist items and one explicit duty per staff member.');
  if (source) {
    const previous = eventInputFromSource(source), permissions = source.permissions;
    const policy = (value: EventInput) => [value.event_type, value.subject_id, value.participation_requirement, value.requires_rsvp, value.requires_guardian_consent, value.payment_required, value.payment_amount_paise, value.payment_due_on];
    const scope = (value: EventInput) => [value.audience.mode, sorted(value.audience.class_section_ids), sorted(value.audience.student_ids), value.sessions.map(session => [session.id ?? '', sorted(session.participant_student_ids)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))];
    const duties = (value: EventInput) => value.staff.map(item => `${item.user_id}:${item.role}`).sort();
    if (!permissions.can_manage_policy && !equal(policy(input), policy(previous))) throw new Error('Current authority does not permit participation, consent or payment policy changes.');
    if (!permissions.can_manage_audience && !equal(scope(input), scope(previous))) throw new Error('Current authority does not permit changes to the event or session audience.');
    if (!permissions.can_manage_staff && !equal(duties(input), duties(previous))) throw new Error('Current authority does not permit changes to event duties.');
  }
  return { ...input, title: input.title.trim(), description: input.description.trim(), venue: input.venue.trim(), starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), sessions: input.sessions.map(session => ({ ...session, title: session.title.trim(), venue: session.venue.trim(), starts_at: new Date(session.starts_at).toISOString(), ends_at: new Date(session.ends_at).toISOString() })), checklist: input.checklist.map(item => ({ ...(item.id ? { id: item.id } : {}), label: item.label.trim(), required: item.required })) };
}
export function eventCancellationInput(source: NativeEvent, internal: string, notice: string) {
  if (!source.permissions.can_cancel || source.status !== 'published' || !text(internal, 500, 3) || !text(notice, 500, 3)) throw new Error('Confirm current cancellation authority, an internal reason and an audience notice of 3–500 characters each.');
  return { expected_revision: source.revision, internal_reason: internal.trim(), audience_notice: notice.trim() };
}
export function eventFinanceFingerprint(event: NativeEvent, item: EventFinanceItem) { return JSON.stringify([event.id, event.revision, event.status, item]); }
export function eventRefundInput(item: EventFinanceItem, values: { amount: string; method: string; reference: string; reason: string; issued: boolean }, permission: boolean) {
  const amount = eventMoneyInput(values.amount);
  if (!permission || !values.issued || !['cash', 'bank_transfer', 'cheque'].includes(values.method) || !text(values.reference, 120, 1) || !text(values.reason, 500, 3) || amount > item.refund_due_paise) throw new Error('Confirm permission, the refund already issued, its reference and reason, and an amount within the current refund due.');
  return { amount_paise: amount, method: values.method as 'cash' | 'bank_transfer' | 'cheque', reference: values.reference.trim(), reason: values.reason.trim() };
}
export function eventWithdrawalInput(item: EventFinanceItem, reason: string) { if (!item.can_withdraw || !text(reason, 500, 3)) throw new Error('This learner’s current paid place must permit withdrawal. Record a 3–500 character reason.'); return { reason: reason.trim() }; }
export interface EventObservation { status: string; note: string; observed_at: string | null; readiness_contradiction_note: string }
export function changeEventObservation(row: { attendance_status: string; note: string; checked_in_at: string | null; checked_out_at: string | null; readiness_contradiction_note: string | null }, previous: EventObservation | undefined, patch: Partial<EventObservation>): EventObservation {
  const saved = previous ?? { status: row.attendance_status, note: row.note, observed_at: row.attendance_status === 'checked_out' ? row.checked_out_at : row.checked_in_at, readiness_contradiction_note: row.readiness_contradiction_note ?? '' };
  const draft = { ...saved, ...patch };
  if (!['present', 'late', 'checked_out'].includes(draft.status)) { draft.observed_at = null; draft.readiness_contradiction_note = ''; }
  else if (patch.status && patch.status !== saved.status && patch.status === 'checked_out') draft.observed_at = row.checked_out_at;
  else if (patch.status && patch.status !== saved.status && saved.status === 'checked_out') draft.observed_at = row.checked_in_at;
  return draft;
}
export function eventObservationRecords(edits: Record<string, EventObservation>, rows: readonly { student_id: string; readiness_blockers: string[] }[]) {
  if (!Object.keys(edits).length || Object.keys(edits).length > 500) throw new Error('Choose 1–500 actual event observations.');
  return Object.entries(edits).map(([student_id, draft]) => {
    const row = rows.find(item => item.student_id === student_id), physical = ['present', 'late', 'checked_out'].includes(draft.status);
    if (!row || !eventUuid(student_id) || !['not_recorded', 'present', 'late', 'excused', 'no_show', 'checked_out'].includes(draft.status) || !text(draft.note, 500) || physical && (!draft.observed_at || !Number.isFinite(Date.parse(draft.observed_at))) || physical && row.readiness_blockers.length > 0 && !text(draft.readiness_contradiction_note, 500, 3) || physical && !text(draft.readiness_contradiction_note, 500)) throw new Error('Confirm each exact participant, observation time and any required readiness exception.');
    return { student_id, status: draft.status, note: draft.note.trim(), observed_at: physical ? new Date(draft.observed_at!).toISOString() : null, readiness_contradiction_note: physical ? draft.readiness_contradiction_note.trim() || null : null };
  });
}
