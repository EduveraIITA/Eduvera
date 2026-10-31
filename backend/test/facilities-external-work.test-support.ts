import { randomUUID } from 'node:crypto';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import type { AuthUser } from '../src/common/request.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { createFacilitiesFixture } from './facilities.test-support.js';
import { acceptWithRecipientProof } from './invitation-recipient-proof.test-support.js';
import { resourceLoanRequest } from './resource-loans.test-support.js';

export const externalCommand = (revision: number) => ({ command_id: randomUUID(), expected_revision: revision });
export const externalPhoto = (label: string) => ({ filename: `${label}.png`, mimetype: 'image/png',
  data: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(label)]) });
export const readExternalBytes = async (stream: AsyncIterable<Buffer | string>) => {
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
};
export const externalRunAt = <T>(schoolId: string, at: string, operation: () => Promise<T>) => executionEnvironmentStorage.run(
  createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(at), nowIso: () => at } }), operation);

/** Ordinary People and recipient-proof acceptance; no credentials, linkage or authority are seeded. */
export async function createExternalRepairFixture(db: DatabaseService, options: { pending?: boolean } = {}) {
  const base = await createFacilitiesFixture(db), email = `external-technician-${randomUUID()}@example.test`;
  const person = await base.people.create(resourceLoanRequest(base.user), base.schoolId, {
    first_name: 'Fictional External Technician', last_name: '', affiliation: 'contractor', idempotency_key: randomUUID(),
  });
  const password = 'Fictional-External-Technician-2026!';
  const join = async () => {
    const invitation = await base.operations.invite(base.user, base.schoolId, {
      role: 'member', person_id: person.id, email, idempotency_key: randomUUID(),
    });
    if (invitation.delivery !== 'manual' || !invitation.token) throw new Error('The isolated fixture needs an ordinary controlled invitation.');
    await acceptWithRecipientProof(base.operations, { email, token: invitation.token, password, first_name: 'Invited Technician', last_name: '' });
    const account = await db.selectFrom('users').select(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active'])
      .where('email', '=', email).executeTakeFirstOrThrow();
    return { user: { ...account, active_school_id: base.schoolId } as AuthUser, invitation };
  };
  const joined = options.pending ? undefined : await join();
  const now = new Date().toISOString(), run = <T>(operation: () => Promise<T>) => externalRunAt(base.schoolId, now, operation);
  const endsAt = new Date(Date.parse(now) + 3 * 86_400_000).toISOString();
  await run(() => base.facilities.saveSettings(base.user, base.schoolId, { ...externalCommand(0),
    handler_person_id: base.custodianPersonId, verifier_mode: 'reporter' }));
  const repair = await run(() => base.facilities.report(base.borrower, base.schoolId, { ...externalCommand(0),
    problem: 'PRIVATE original complaint: fictional resident and confidential circumstances',
    location_note: 'PRIVATE original residential access note', holding_id: base.holdingId }));
  const personRevision = async () => (await db.selectFrom('school_people').select('revision').where('school_id', '=', base.schoolId)
    .where('id', '=', person.id).executeTakeFirstOrThrow()).revision;
  const grantInput = async (revision: number, extra: Record<string, unknown> = {}) => ({ ...externalCommand(revision),
    person_id: person.id, expected_person_revision: await personRevision(), starts_at: now, ends_at: endsAt,
    instructions: 'Check the camera connector and report the work done. Contact the campus coordinator for access.',
    shared_photo_ids: [], ...extra });
  return { ...base, now, run, endsAt, repair, person, email, password, joined, join, personRevision, grantInput };
}
