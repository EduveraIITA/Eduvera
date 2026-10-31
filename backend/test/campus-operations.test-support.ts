import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { DatabaseService } from '../src/database/database.service.js';
import { CampusPersonalService } from '../src/campus-view/campus-personal.service.js';
import { CampusOperationsService } from '../src/campus-view/campus-operations.service.js';
import { CampusViewRepository } from '../src/campus-view/campus-view.repository.js';
import { WorkspaceRepository } from '../src/workspace/workspace.repository.js';
import { ResponsibilityProjectionService } from '../src/campus-model-core/responsibility-projection.service.js';
import { ScopedExecutionClock, SystemWallClock } from '../src/database/execution-clock.runtime.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { CampusEventsService } from '../src/campus-events/campus-events.service.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { campusSceneServices, campusSceneDocument } from './campus-scenes.test-support.js';
import { createFacilitiesFixture, facilitiesServices } from './facilities.test-support.js';
import { teachingSessionServices } from './teaching-sessions.test-support.js';
import { ActivityAttendanceService } from '../src/attendance/activity-attendance.service.js';
import { OwnedParticipationBridge } from '../src/attendance/owned-participation-bridge.service.js';
import { ParticipationContextAuthorityRegistry } from '../src/attendance/participation-context-authority.js';
import { OwnedPlanFootprintBridge } from '../src/schedule-planning/owned-plan-footprint.bridge.js';
import { resourceLoanRequest } from './resource-loans.test-support.js';
import type { CampusEventDto } from '../src/campus-events/contracts.js';

export function campusOperationsServices(database: DatabaseService) {
  const scene = campusSceneServices(database), facilities = facilitiesServices(database).facilities;
  const teaching = teachingSessionServices(database), authorities = new ParticipationContextAuthorityRegistry(), core=teaching.core;
  const kernel=new ActivityAttendanceService(database,core,core,core,core,core,authorities);
  const events = new CampusEventsService(database, new SchoolEventService(database,core), new OwnedParticipationBridge(kernel),
    authorities, core, new OwnedPlanFootprintBridge(core), teaching.planning);
  const repository = new CampusViewRepository(database);
  const personal = new CampusPersonalService(database, repository,
    new WorkspaceRepository(database, new ResponsibilityProjectionService(teaching.core)), teaching.context,
    teaching.planning, facilities, new ScopedExecutionClock(new ExecutionDataPlaneScope(), new SystemWallClock()), teaching.core, scene.scenes);
  return { ...scene, facilities, events, personal,
    operations: new CampusOperationsService(personal, scene.scenes, facilities, events, repository) };
}

export async function createCampusOperationsFixture(database: DatabaseService) {
  const f = await createFacilitiesFixture(database), services = campusOperationsServices(database);
  const place = await services.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId,
    name: 'West library', code: 'WEST-LIB', kind: 'building' }, resourceLoanRequest(f.user));
  const other = await services.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId,
    name: 'East lecture centre', code: 'EAST-LEC', kind: 'building' }, resourceLoanRequest(f.user));
  await f.run(async () => {
    // Explicit passive enrollment fixture for the existing Events audience owner;
    // it grants no app access and is not part of the asset projection payload.
    const passive = await services.people.create(resourceLoanRequest(f.user),f.schoolId,{first_name:'Research',last_name:'Participant',idempotency_key:randomUUID()});
    const year=new Date(f.now).getUTCFullYear(), academicYear=`${year}-${String(year+1).slice(-2)}`;
    const term=(await sql<{id:string}>`INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active)
      VALUES(${f.schoolId}::uuid,${academicYear},'Research term',${f.now}::timestamptz::date-90,${f.now}::timestamptz::date+90,85,true) RETURNING id`.execute(database)).rows[0]!;
    const section=await database.insertInto('class_sections').values({school_id:f.schoolId,academic_year:academicYear,grade:'M.Tech',section:'Research'}).returning('id').executeTakeFirstOrThrow();
    const student=await database.insertInto('students').values({school_id:f.schoolId,person_id:passive.id,admission_number:`MAP-${randomUUID().slice(0,8)}`}).returning('id').executeTakeFirstOrThrow();
    await database.insertInto('enrollments').values({student_id:student.id,class_section_id:section.id,term_id:term.id,roll_number:1,enrolled_on:f.now.slice(0,10)}).execute();
    const document = campusSceneDocument(String(place.id));
    document.elements.push({ ...document.elements[0]!, id: 'building-two', space_id: String(other.id), label: 'East lecture centre',
      geometry: { type: 'polygon', points: [{ x: 300, y: 40 }, { x: 440, y: 40 }, { x: 440, y: 160 }, { x: 300, y: 160 }] } });
    document.elements.push({ id: 'walk-lamp', kind: 'fixture', label: 'Library walk lamp', asset_key: 'lamp', holding_id: f.holdingId,
      space_id: null, floor_id: null, geometry: { type: 'point', points: [{ x: 220, y: 180 }] }, review_state: 'reviewed' });
    const saved = await services.scenes.saveDraft(f.user, f.schoolId, f.campusId, { idempotency_key: randomUUID(), expected_revision: 0, document });
    await services.scenes.publish(f.user, f.schoolId, f.campusId, { idempotency_key: randomUUID(), expected_revision: saved.revision });
    await services.facilities.saveSettings(f.user, f.schoolId, { command_id: randomUUID(), expected_revision: 0,
      handler_person_id: f.custodianPersonId, verifier_mode: 'reporter' });
  });
  const startsAt = new Date(Date.parse(f.now) + 3_600_000).toISOString(), endsAt = new Date(Date.parse(f.now) + 7_200_000).toISOString();
  const eventInput = (extra: Record<string, unknown> = {}) => ({ school_id: f.schoolId, idempotency_key: randomUUID(),
    event_type: 'workshop', title: 'Library research workshop', venue: 'West library', space_id: String(place.id),
    starts_at: startsAt, ends_at: endsAt, audience: { mode: 'school', class_section_ids: [], student_ids: [] },
    participation_requirement: 'mandatory', requires_rsvp: false, requires_guardian_consent: false, payment_required: false,
    sessions: [{ title: 'Main programme', session_type: 'activity', venue: 'West library', use_event_space: true,
      starts_at: startsAt, ends_at: endsAt, attendance_mode: 'none', participant_student_ids: [] }], ...extra });
  const eventDefinition = (event: CampusEventDto, extra: Record<string, unknown> = {}) => eventInput({
    expected_revision: event.revision, event_type: event.event_type, title: event.title, venue: event.venue, space_id: event.space_id,
    starts_at: event.starts_at, ends_at: event.ends_at, sessions: event.sessions.map(session => ({ id: session.id, title: session.title,
      session_type: session.session_type, venue: session.venue, space_id: session.space_id, use_event_space: session.use_event_space,
      starts_at: session.starts_at, ends_at: session.ends_at, attendance_mode: session.attendance_mode,
      participant_student_ids: session.participant_student_ids })), staff: event.staff.map(person => ({ user_id: person.user_id, role: person.role })), ...extra });
  return { ...f, ...services, placeId: String(place.id), otherPlaceId: String(other.id), startsAt, endsAt, eventInput, eventDefinition };
}
