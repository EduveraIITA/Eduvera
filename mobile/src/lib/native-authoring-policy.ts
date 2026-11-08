import { campusMembershipActionAllowed } from './people-access';
import { campusInvitationActionAllowed } from './campus-invitations';
import { campusSceneActionAllowed } from './campus-scene-policy';
import { gateVisitorActionAllowed } from './gate-visitor';
import { gateVisitOnboardingActionAllowed } from './gate-visit-onboarding';
import { campusTopologyActionAllowed } from './campus-topology';
import { canonicalSpaceActionAllowed } from './canonical-space';
import type { NativePendingAction, NativePendingScope } from './native-pending-action';
import { attendanceFollowupActionAllowed } from './attendance-insights';
import { nativeScheduleAuthoringAllowed } from './schedule-planning-policy';
import { nativeCalendarDateAuthoringAllowed } from './calendar-date-policy';
import { assessmentOperationsActionAllowed } from './assessment-operations';
import { assessmentAuthoringActionAllowed } from './assessment-authoring';
import { attendanceReconciliationActionAllowed } from './attendance-continuity';
import { attendancePhotoActionAllowed } from './attendance-photo';
import { nativeLearningElectiveAllowed } from './learning-elective-policy';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fingerprint = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

function resourceSetup(record: NativePendingAction, scope: NativePendingScope) {
  const root = `/api/v1/schools/${encodeURIComponent(scope.schoolId)}/institution-setup`;
  if (record.payload.kind !== 'json' || record.replayPolicy !== 'inspect_only' || ![root, `${root}/`].includes(record.refreshPath)) return false;
  const body = JSON.parse(record.payload.body) as Record<string, unknown>, source = record.source;
  if (!source || 'command_id' in body || 'idempotency_key' in body || 'client_id' in body) return false;
  const path = record.endpoint.replace(/\/$/, '');
  if (record.method === 'POST' && [root + '/campuses', root + '/resource-types'].includes(path)) {
    return source.sourceId === scope.schoolId && source.revision === 0 && !('expected_revision' in body)
      && source.kind === (path.endsWith('/campuses') ? 'campus_creation' : 'resource_type_creation');
  }
  const tail = path.slice(root.length), match = /^\/(resource-types|assets)\/([^/]+)$/.exec(tail);
  return path.startsWith(root + '/') && record.method === 'PATCH' && !!match && uuid(match[2])
    && source.sourceId === match[2] && source.kind === (match[1] === 'assets' ? 'resource_item' : 'resource_type')
    && revision(source.revision, 1) && body.expected_revision === source.revision;
}

function facilities(record: NativePendingAction, scope: NativePendingScope) {
  const root = `/api/v1/schools/${encodeURIComponent(scope.schoolId)}/facilities`, source = record.source;
  if (record.method !== 'POST' || record.replayPolicy !== 'same_request' || !source) return false;
  if (record.endpoint === root + '/settings') {
    if (record.payload.kind !== 'json') return false;
    const body = JSON.parse(record.payload.body) as Record<string, unknown>;
    return record.refreshPath === root + '/settings' && source.kind === 'facilities_settings'
      && source.sourceId === scope.schoolId && revision(source.revision) && body.expected_revision === source.revision && body.command_id === record.clientId;
  }
  const match = /^\/repairs\/([^/]+)\/photos$/.exec(record.endpoint.slice(root.length));
  if (!record.endpoint.startsWith(root + '/') || !match || !uuid(match[1]) || record.payload.kind !== 'multipart') return false;
  const { fields, file } = record.payload;
  return record.refreshPath === `${root}/repairs/${match[1]}` && source.kind === 'facilities_photo' && source.sourceId === match[1]
    && revision(source.revision, 1) && /^(?:0|[1-9]\d*)$/.test(fields.expected_revision ?? '') && Number(fields.expected_revision) === source.revision
    && Object.keys(fields).length === 2 && fields.command_id === record.clientId && ['image/jpeg', 'image/png'].includes(file.type);
}

function eventRead(record: NativePendingAction, scope: NativePendingScope, body: Record<string, unknown>) {
  const root = '/api/v1/campus-events', read = new URL(record.refreshPath, 'https://thatcampus.invalid');
  const keys = [...read.searchParams.keys()];
  const owner = new URL(record.ownerHref, 'https://thatcampus.invalid'), ownerStudents = owner.searchParams.getAll('student_id');
  if (ownerStudents.length > 1 || ownerStudents.length === 1 && !uuid(ownerStudents[0])) return false;
  const ownerStudent = ownerStudents[0], bodyStudent = body.student_id;
  if (bodyStudent !== undefined && (!uuid(bodyStudent) || ownerStudent && bodyStudent !== ownerStudent)) return false;
  const student = ownerStudent ?? bodyStudent;
  if (read.searchParams.getAll('school_id').length !== 1 || read.searchParams.get('school_id') !== scope.schoolId || new Set(keys).size !== keys.length) return false;
  if (record.endpoint === root) {
    const detail = read.pathname.slice(root.length + 1);
    if (uuid(detail)) return read.pathname === `${root}/${detail}` && keys.every(key => key === 'school_id');
    return record.phase !== 'accepted' && [root, root + '/catalog'].includes(read.pathname)
      && keys.every(key => ['school_id', 'limit', 'cursor', 'status', 'from', 'to'].includes(key));
  }
  const tail = record.endpoint.slice(root.length + 1).split('/'), eventId = tail[0];
  if (!uuid(eventId)) return false;
  const finance = tail[1] === 'participants' && tail.length === 4 && ['withdraw', 'refunds'].includes(tail[3]!);
  if (finance) return read.pathname === `${root}/${eventId}/finance` && read.searchParams.get('student_id') === tail[2]
    && (!student || tail[2] === student) && keys.every(key => ['school_id', 'student_id'].includes(key));
  if (tail[1] === 'sessions') return read.pathname === `${root}/${eventId}/sessions/${tail[2]}/roster`
    && keys.every(key => key === 'school_id');
  return read.pathname === `${root}/${eventId}` && keys.every(key => ['school_id', 'student_id'].includes(key))
    && (student ? read.searchParams.get('student_id') === student : !read.searchParams.has('student_id'));
}

function events(record: NativePendingAction, scope: NativePendingScope) {
  const root = '/api/v1/campus-events';
  if (record.method !== 'POST' || record.payload.kind !== 'json' || record.replayPolicy !== 'same_request') return false;
  const body = JSON.parse(record.payload.body) as Record<string, unknown>, source = record.source;
  if (body.school_id !== scope.schoolId || body.idempotency_key !== record.clientId || !eventRead(record, scope, body)) return false;
  if (record.endpoint === root) return source?.kind === 'event_creation' && source.sourceId === scope.schoolId && source.revision === 0 && fingerprint(source.fingerprint);
  const tail = record.endpoint.slice(root.length + 1).split('/'), [eventId, action, targetId, operation] = tail;
  if (!record.endpoint.startsWith(root + '/') || !uuid(eventId)) return false;
  if (action === 'participants' && tail.length === 4 && ['withdraw', 'refunds'].includes(operation!)) return uuid(targetId)
    && source?.kind === 'event_finance_participant' && source.sourceId === targetId && revision(source.revision, 1) && fingerprint(source.fingerprint) && !('expected_revision' in body);
  if (action === 'sessions') return uuid(targetId) && tail[3] === 'attendance' && (tail.length === 4 || tail.length === 5 && ['lock', 'reopen'].includes(tail[4]!))
    && (!source || source.kind === 'event_session' && source.sourceId === targetId && source.revision === body.expected_revision);
  if (action === 'checklist') return tail.length === 3 && uuid(targetId);
  if (tail.length !== 2 || !['save', 'cancel', 'publish', 'complete', 'rsvp', 'consent'].includes(action!)) return false;
  if (['save', 'cancel'].includes(action!)) return source?.kind === 'event' && source.sourceId === eventId && source.revision === body.expected_revision && revision(source.revision, 1);
  return !source || source.kind === 'event' && source.sourceId === eventId && source.revision === body.expected_revision;
}

/** Extra path/source checks for native authoring and protected evidence journals. */
export function nativeAuthoringActionAllowed(record: NativePendingAction, scope: NativePendingScope) {
  if (record.domain === 'learning' && (record.source?.kind === 'elective_change' || record.endpoint.startsWith('/api/v1/learning/elective-changes') || record.endpoint.includes('/fees/elective-reviews/'))) return nativeLearningElectiveAllowed(record, scope);
  if(record.domain==='people' && record.source?.kind==='campus_membership') return campusMembershipActionAllowed(record,scope);
  if(record.domain==='people' && ['campus_invitation_creation','campus_invitation'].includes(record.source?.kind??'')) return campusInvitationActionAllowed(record,scope);
  if (record.domain === 'campus') return campusSceneActionAllowed(record, scope);
  if (record.domain === 'gate') return gateVisitorActionAllowed(record, scope) || gateVisitOnboardingActionAllowed(record, scope);
  if (record.domain === 'assessments') return assessmentOperationsActionAllowed(record, scope) || assessmentAuthoringActionAllowed(record, scope);
  if (record.domain === 'attendance') return attendanceFollowupActionAllowed(record, scope) || attendanceReconciliationActionAllowed(record, scope) || attendancePhotoActionAllowed(record, scope);
  if (record.domain === 'schedule') return nativeScheduleAuthoringAllowed(record, scope);
  if (record.domain === 'calendar') return nativeCalendarDateAuthoringAllowed(record, scope);
  if (record.domain === 'resources') return resourceSetup(record, scope) || canonicalSpaceActionAllowed(record, scope) || campusTopologyActionAllowed(record, scope);
  if (record.domain === 'facilities') return facilities(record, scope);
  if (record.domain === 'events') return events(record, scope);
  return true;
}
