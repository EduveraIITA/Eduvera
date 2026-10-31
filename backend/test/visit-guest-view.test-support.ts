import { randomUUID } from 'node:crypto';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { CoordinationConfigurationService } from '../src/campus-model-core/coordination-configuration.service.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import type { AuthUser } from '../src/common/request.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { VisitArrangementsService } from '../src/gate/visit-arrangements.service.js';
import { VisitSharingModel } from '../src/gate/visit-sharing.model.js';
import { VisitSharingService } from '../src/gate/visit-sharing.service.js';
import { acceptWithRecipientProof } from './invitation-recipient-proof.test-support.js';
import { createResourceLoanFixture, resourceLoanRequest } from './resource-loans.test-support.js';

export const visitGuestCommand = (revision: number) => ({ command_id: randomUUID(), expected_revision: revision });
export const visitGuestLater = (at: string, minutes: number) => new Date(Date.parse(at) + minutes * 60_000).toISOString();
export const visitGuestRunAt = <T>(school: string, at: string, operation: () => Promise<T>) => executionEnvironmentStorage.run(
  createLiveExecutionEnvironment({ institution_id: school, clock: { now: () => new Date(at), nowIso: () => at } }), operation);

export function visitGuestServices(db: DatabaseService) {
  const core = new CampusModelCoreService(db, new ExecutionDataPlaneScope());
  const model = new VisitSharingModel(core, core, core, new CoordinationConfigurationService(core), core);
  return { core, model, sharing: new VisitSharingService(db, core, model),
    visits: new VisitArrangementsService(db, core, core, core, core, core) };
}

/** Ordinary campus, canonical organiser and neutral joining; no source authority is seeded. */
export async function createVisitGuestFixture(db: DatabaseService, options: { pending?: boolean; passwordHash?: string; wholeCampus?: boolean } = {}) {
  const base = await createResourceLoanFixture(db, options.passwordHash ? { passwordHash: options.passwordHash } : {});
  const { visits, sharing, model } = visitGuestServices(db);
  const organiser = await base.people.create(resourceLoanRequest(base.user), base.schoolId, {
    first_name: 'Fictional Visit Organiser', last_name: '', affiliation: 'other', idempotency_key: randomUUID(),
  });
  const email = `visit-organiser-${randomUUID()}@example.test`, password = 'Fictional-Visit-Organiser-2026!';
  let now = new Date().toISOString();
  const run = <T>(operation: () => Promise<T>) => visitGuestRunAt(base.schoolId, now, operation);
  const account = async () => {
    const found = await db.selectFrom('users').select(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active'])
      .where('email', '=', email).executeTakeFirstOrThrow();
    return { ...found, active_school_id: base.schoolId } as AuthUser;
  };
  const join = async (workContext?: { kind: 'visit_arrangement'; source_id: string; access_id: string }) => {
    const invitation = await base.operations.invite(base.user, base.schoolId, { role: 'member', person_id: organiser.id,
      email, idempotency_key: randomUUID(), ...(workContext ? { work_context: workContext } : {}) });
    if (invitation.delivery !== 'manual' || !invitation.token)
      throw new Error('The isolated visit fixture needs an ordinary controlled invitation.');
    // Do not pin identity acceptance to the fixture clock: actual source guards
    // must accept an endpoint created after its transaction began.
    const acceptance = await acceptWithRecipientProof(base.operations, { email, token: invitation.token, password,
      first_name: 'Fictional Visit Organiser', last_name: '' });
    now = new Date().toISOString();
    return { user: await account(), invitation, acceptance };
  };
  const joined = options.pending ? undefined : await join();
  const place = await run(() => base.topology.createSpace(base.user, base.schoolId, {
    campus_id: base.campusId, name: 'Fictional visitor meeting room', code: `VISIT-${randomUUID().slice(0, 8)}`, kind: 'other',
  }, resourceLoanRequest(base.user)));
  if (typeof place.id !== 'string') throw new Error('A visit requires its canonical meeting place.');
  const contact = await db.selectFrom('school_people').select(['id', 'revision'])
    .where('school_id', '=', base.schoolId).where('id', '=', base.borrowerPersonId).executeTakeFirstOrThrow();
  const visitInput = (extra: Record<string, unknown> = {}) => ({ ...visitGuestCommand(0), person_id: null,
    person_revision: null, guest_name: 'Fictional school party', party_size: 12, title: 'Fictional campus tour',
    starts_at: visitGuestLater(now, 120), ends_at: visitGuestLater(now, 180), place_id: options.wholeCampus ? null : place.id, ...(options.wholeCampus ? {campus_id:base.campusId} : {}),
    contact_person_id: contact.id, contact_revision: contact.revision, ...extra });
  const input = visitInput();
  const visit = (await run(() => visits.create(base.user, base.schoolId, input))).visit;
  const organiserRevision = async () => (await db.selectFrom('school_people').select('revision')
    .where('school_id', '=', base.schoolId).where('id', '=', organiser.id).executeTakeFirstOrThrow()).revision;
  const shareInput = async (revision: number, extra: Record<string, unknown> = {}) => ({ ...visitGuestCommand(revision),
    expected_visit_revision: (await run(() => visits.detail(base.user, base.schoolId, visit.id))).visit.revision,
    organiser_person_id: organiser.id, organiser_person_revision: await organiserRevision(),
    ends_at: visitGuestLater(now, 240), directions: 'Use the reception entrance and ask for the campus tour coordinator.', ...extra });
  return { ...base, visits, sharing, model, organiser, email, password, joined, join, account, placeId: place.id, contact, input,
    visit, visitInput, shareInput, organiserRevision, run, get now() { return now; } };
}
