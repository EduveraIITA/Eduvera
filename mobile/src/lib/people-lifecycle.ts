import { isPeopleDate, peopleReason } from './people-policy';

export interface EnrollmentOption { class_section_id: string; term_id: string; class_name: string; term_name: string; starts_on: string; ends_on: string; today: string; next_roll: number }
export interface EnrollmentHistory { id: string; class_section_id: string; term_id: string; class_name: string; term_name: string; roll_number: number; enrolled_on: string; inactive_from: string | null; exit_kind: string | null; exit_reason: string | null; revision: number }
export interface EnrollmentLifecycle { today: string; current: EnrollmentHistory | null; history: EnrollmentHistory[] }
export interface EnrollmentInput { school_id: string; person: { id: string; expected_revision: number }; admission_number: string; date_of_birth: string | null; class_section_id: string; term_id: string; roll_number: number; enrolled_on: string; guardian: null; can_authorize_leave: false }
export interface EnrollmentReview { id: string; expires_at: string; input: EnrollmentInput & { first_name?: string; last_name?: string }; class_name: string; term_name: string; guardian: unknown; warnings: string[] }
export type EnrollmentAction = 'move_class' | 'withdraw' | 'transfer_out';
export type EnrollmentChangeInput = { school_id: string; expected_enrollment_id: string; expected_revision: number; effective_on: string; reason: string; action: EnrollmentAction; target_class_section_id?: string; target_term_id?: string; roll_number?: number };
export interface EnrollmentChangeReview { id: string; expires_at: string; input: EnrollmentChangeInput & { student_id: string }; current: EnrollmentHistory; target: { class_name: string; term_name: string } | null; impact: { attendance_registers: number; submitted_registers: number; assessments: number; transport_assignments: number; departure_plans: number } }
export interface AuthoritySnapshot { revision: number; enabled: boolean; valid_from: string | null; valid_until: string | null; source: string }
export interface GuardianAuthority extends AuthoritySnapshot { id: string; student_id: string; guardian_id: string; student_name: string; guardian_name: string; effective: boolean; today: string; history: Array<{ id: string; previous: AuthoritySnapshot; result: AuthoritySnapshot; reason: string; recorded_at: string; actor_name: string }> }
export interface AuthorityInput { school_id: string; expected_revision: number; enabled: boolean; valid_from: string | null; valid_until: string | null; reason: string; verified: true }
export interface WorkProfile { id: string; person_id: string; staff_code: string; staff_kind: 'teaching' | 'non_teaching'; designation: string; department: string; employment_type: 'unspecified' | 'full_time' | 'part_time' | 'contract'; joined_on: string | null; revision: number; status: string }
export interface WorkOnboardingItem { id: string; staff_profile_id: string; item_key: string; label: string; required: boolean; completed_at: string | null; note: string }
export type PeopleReviewKind = 'enrollment_review' | 'enrollment_change_review';
export type PeopleReviewValue = EnrollmentReview | EnrollmentChangeReview;
export interface RetainedPeopleReview<T extends PeopleReviewValue = PeopleReviewValue> { version: 1; scopeKey: string; kind: PeopleReviewKind; personId: string; fingerprint: string; review: T }
export interface PeopleReviewCommitScope { actorId: string; schoolId: string; environment: { mode: 'live' | 'simulation'; namespace_id?: string | null; institution_id?: string | null; run_id?: string; unavailable?: boolean } }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
export function peopleReviewExpired(expiresAt: string, now: number) {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || !Number.isFinite(now)) throw new Error('The enrollment review clock could not be confirmed. The review was kept; nothing was committed.');
  return now >= expiry;
}
/** Only for starting a new command. Retained unknown commits recover by their exact review ID. */
export async function checkNewPeopleReviewExpiry(expiresAt: string, scope: PeopleReviewCommitScope, options: { assertCurrent(): void; readSession(): Promise<unknown>; wallNow?(): number }) {
  options.assertCurrent();
  if (!uuid(scope.actorId) || !uuid(scope.schoolId) || scope.environment.unavailable) throw new Error('Confirm the active account, campus and environment before committing this review.');
  if (scope.environment.mode === 'live') {
    const expired = peopleReviewExpired(expiresAt, (options.wallNow ?? Date.now)());
    options.assertCurrent(); return expired;
  }
  const selected = scope.environment;
  if (selected.mode !== 'simulation' || !uuid(selected.run_id) || !selected.namespace_id || selected.institution_id !== scope.schoolId || !new RegExp(`^scenario:[0-9a-f-]{36}:run:${selected.run_id}$`, 'i').test(selected.namespace_id)) throw new Error('The selected Simulation could not be confirmed. The review was kept; nothing was committed.');
  const response = await options.readSession();
  options.assertCurrent();
  const session = response as { authenticated?: unknown; user?: { id?: unknown; active_school_id?: unknown }; execution_environment?: { mode?: unknown; institution_id?: unknown; namespace_id?: unknown; run_id?: unknown; unavailable?: unknown; virtual_clock?: { now?: unknown } } } | null;
  const current = session?.execution_environment, instant = current?.virtual_clock?.now;
  if (session?.authenticated !== true || session.user?.id !== scope.actorId || session.user.active_school_id !== scope.schoolId || current?.mode !== 'simulation' || current.institution_id !== scope.schoolId || current.namespace_id !== selected.namespace_id || current.run_id !== selected.run_id || current.unavailable === true || typeof instant !== 'string') throw new Error('The session did not confirm this exact actor, campus and Simulation. The review was kept; nothing was committed.');
  const expired = peopleReviewExpired(expiresAt, Date.parse(instant));
  options.assertCurrent(); return expired;
}
export function guardianAuthorityBelongsToPerson(authority: Pick<GuardianAuthority, 'student_id' | 'guardian_id'>, sources: readonly { id: string; kind: string }[]) {
  return sources.some(source => source.kind === 'learning' && source.id === authority.student_id || source.kind === 'guardian' && source.id === authority.guardian_id);
}
export function enrollmentInput(values: { schoolId: string; personId: string; revision: number; admission: string; birth: string; enrolledOn: string; roll: string; option: EnrollmentOption }): EnrollmentInput {
  const admission = values.admission.trim().toUpperCase(), roll = Number(values.roll), option = values.option;
  if (!uuid(values.schoolId) || !uuid(values.personId) || !positive(values.revision) || !/^[A-Z0-9/-]{2,64}$/.test(admission) || !positive(roll) || roll > 32767 || !isPeopleDate(values.enrolledOn) || values.enrolledOn < option.starts_on || values.enrolledOn > option.ends_on || values.birth && (!isPeopleDate(values.birth) || values.birth < '1900-01-01' || values.birth >= values.enrolledOn || values.birth > option.today)) throw new Error('Confirm the admission number, dates, class and roll number. Birth date is optional.');
  return { school_id: values.schoolId, person: { id: values.personId, expected_revision: values.revision }, admission_number: admission, date_of_birth: values.birth || null, class_section_id: option.class_section_id, term_id: option.term_id, roll_number: roll, enrolled_on: values.enrolledOn, guardian: null, can_authorize_leave: false };
}
export function enrollmentChangeInput(values: { schoolId: string; current: EnrollmentHistory; today: string; action: EnrollmentAction; reason: string; target?: EnrollmentOption; roll: string }): EnrollmentChangeInput {
  const current = values.current, common = { school_id: values.schoolId, expected_enrollment_id: current.id, expected_revision: current.revision, effective_on: values.today, reason: peopleReason(values.reason), action: values.action };
  if (!uuid(values.schoolId) || !uuid(current.id) || !positive(current.revision) || !isPeopleDate(values.today) || !['move_class', 'withdraw', 'transfer_out'].includes(values.action)) throw new Error('Reload the current enrollment before reviewing this change.');
  if (values.action !== 'move_class') return common;
  const target = values.target, roll = Number(values.roll);
  if (!target || target.term_id !== current.term_id || target.class_section_id === current.class_section_id || !positive(roll) || roll > 32767) throw new Error('Choose a different class in the current term and a valid roll number. Use term promotion for a new term.');
  return { ...common, target_class_section_id: target.class_section_id, target_term_id: target.term_id, roll_number: roll };
}
export function guardianAuthorityInput(values: { schoolId: string; source: GuardianAuthority; enabled: boolean; start: string; end: string; reason: string; verified: boolean }): AuthorityInput {
  const reason = values.reason.trim();
  if (!uuid(values.schoolId) || !positive(values.source.revision) || !values.verified || reason.length < 10 || reason.length > 500) throw new Error('Verify this guardian’s school-approved authority and record a reason of 10–500 characters.');
  if (values.enabled && (!isPeopleDate(values.start) || values.start < values.source.today || values.end && (!isPeopleDate(values.end) || values.end < values.start))) throw new Error('Choose today or a future start and an optional last day on or after it.');
  return { school_id: values.schoolId, expected_revision: values.source.revision, enabled: values.enabled, valid_from: values.enabled ? values.start : null, valid_until: values.enabled && values.end ? values.end : null, reason, verified: true };
}
export function workProfileInput(personId: string, revision: number, values: { code: string; kind: WorkProfile['staff_kind']; designation: string; department: string; employment: WorkProfile['employment_type']; joined: string }) {
  const code = values.code.trim(), designation = values.designation.trim(), department = values.department.trim();
  if (!uuid(personId) || !positive(revision) || !/^[A-Za-z0-9][A-Za-z0-9/_-]{1,39}$/.test(code) || designation.length < 2 || designation.length > 120 || department.length > 120 || !['teaching', 'non_teaching'].includes(values.kind) || !['unspecified', 'full_time', 'part_time', 'contract'].includes(values.employment) || values.joined && !isPeopleDate(values.joined)) throw new Error('Confirm the staff code, position, team, employment and optional joining date.');
  return { person: { id: personId, expected_revision: revision }, staff_code: code, staff_kind: values.kind, designation, department, employment_type: values.employment, joined_on: values.joined || null };
}
export function validatePeopleReview(value: unknown, kind: PeopleReviewKind, schoolId: string, personId: string, studentId?: string): value is PeopleReviewValue {
  if (!value || typeof value !== 'object') return false;
  const review = value as PeopleReviewValue;
  if (!uuid(review.id) || !Number.isFinite(Date.parse(review.expires_at)) || !review.input || review.input.school_id !== schoolId) return false;
  if (kind === 'enrollment_review') { const intake = review as EnrollmentReview; return intake.input.person?.id === personId && positive(intake.input.person.expected_revision) && Array.isArray(intake.warnings) && intake.warnings.every(warning => typeof warning === 'string') && typeof intake.class_name === 'string' && typeof intake.term_name === 'string' && uuid(intake.input.class_section_id) && uuid(intake.input.term_id) && positive(intake.input.roll_number) && intake.input.roll_number <= 32767 && isPeopleDate(intake.input.enrolled_on) && typeof intake.input.admission_number === 'string' && /^[A-Z0-9/-]{2,64}$/.test(intake.input.admission_number) && (intake.input.date_of_birth === null || isPeopleDate(intake.input.date_of_birth)) && intake.input.guardian === null && intake.input.can_authorize_leave === false; }
  const change = review as EnrollmentChangeReview;
  return change.input.student_id === studentId && uuid(change.input.expected_enrollment_id) && positive(change.input.expected_revision) && change.current?.id === change.input.expected_enrollment_id && change.current.revision === change.input.expected_revision && ['move_class', 'withdraw', 'transfer_out'].includes(change.input.action) && !!change.impact && ['attendance_registers', 'submitted_registers', 'assessments', 'transport_assignments', 'departure_plans'].every(key => Number.isSafeInteger(change.impact[key as keyof typeof change.impact]) && change.impact[key as keyof typeof change.impact] >= 0);
}
export function validateRetainedPeopleReview(value: unknown, scopeKey: string, kind: PeopleReviewKind, schoolId: string, personId: string, studentId?: string): value is RetainedPeopleReview {
  const record = value as RetainedPeopleReview;
  return !!record && record.version === 1 && record.scopeKey === scopeKey && record.kind === kind && record.personId === personId && /^[a-f0-9]{64}$/.test(record.fingerprint) && validatePeopleReview(record.review, kind, schoolId, personId, studentId);
}
