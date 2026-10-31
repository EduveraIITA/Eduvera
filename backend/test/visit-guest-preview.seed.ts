import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { createVisitGuestFixture } from './visit-guest-view.test-support.js';

// Explicit preview-only generator, excluded from the normal *.test.ts suite.
// It still runs through Vitest's isolated synthetic mailbox boundary instead of
// inserting acceptance, endpoint or source-authority proof.
it('creates one fictional preview organiser through the ordinary source invitation', async () => {
  if (process.env.TEST_DATABASE_ISOLATED !== 'true' || process.env.VISIT_GUEST_PREVIEW_SEED !== 'true')
    throw new Error('The visitor preview seed requires its explicit isolated harness.');
  const source = requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
  if (new URL(source).pathname !== '/thatcampus_visit_guest_ui_test_20261026')
    throw new Error('The visitor preview seed refuses any other source database.');
  const ledger = process.env.VISIT_GUEST_PREVIEW_LEDGER;
  if (!ledger || !isAbsolute(ledger) || !ledger.includes('/.runtime/visit-guest-20261026/preview-session-') || !ledger.endsWith('/credentials.json'))
    throw new Error('The visitor preview seed requires its private owned ledger path.');
  process.env.INVITATION_EMAIL_ENABLED = 'false';
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
  try {
    const f = await createVisitGuestFixture(db, { pending: true });
    await db.updateTable('schools').set({ name: 'Fictional Visitor Review', timezone: 'Asia/Kolkata' }).where('id', '=', f.schoolId).execute();
    const sharing = await f.run(async () => f.sharing.share(f.user, f.schoolId, f.visit.id, await f.shareInput(0)));
    const joined = await f.join({ kind: 'visit_arrangement', source_id: f.visit.id, access_id: sharing.current!.id });
    await db.updateTable('users').set({ password_hash: await hashPassword(f.password) }).where('id', '=', f.user.id).execute();
    expect((await db.selectFrom('school_memberships').select('access_scope').where('school_id', '=', f.schoolId)
      .where('user_id', '=', joined.user.id).executeTakeFirstOrThrow()).access_scope).toBe('assigned_work');
    expect((await f.run(() => f.sharing.sharedDetail(joined.user, f.schoolId, f.visit.id))).question).toBeNull();
    await writeFile(ledger, JSON.stringify({ fixture: 'Fictional isolated visitor preview', school_id: f.schoolId,
      visit_id: f.visit.id, share_id: sharing.current!.id, visit_title: f.visit.title,
      coordinator: { email: f.user.email, password: f.password }, guest: { email: f.email, password: f.password },
      route: `/areas/in-out/visits?visit=${f.visit.id}&shared=1`,
      created_at: new Date().toISOString(), actual_external_mail_sent: false,
    }, null, 2), { mode: 0o600, flag: 'wx' });
  } finally { await db.destroy(); }
}, 120_000);
