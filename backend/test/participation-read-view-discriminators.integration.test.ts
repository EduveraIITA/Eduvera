import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ActivityAttendanceWorkspaceService } from '../src/attendance/activity-attendance-workspace.service.js';
import { ResponsibilityAttendanceRepository } from '../src/attendance/responsibility-attendance.repository.js';
import { ResponsibilityProjectionService } from '../src/campus-model-core/responsibility-projection.service.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { ProgressiveSetupService } from '../src/institution-activation/progressive-setup.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { ActivityPlanningService } from '../src/schedule-planning/activity-planning.service.js';
import { academicParticipationTestServices, rollbackAcademicFixture } from './academic-participation.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
types.setTypeParser(1082, value => value);
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/unused', max: 2 });
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }) as DatabaseService;
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: { 'idempotency-key': randomUUID() } }) as unknown as AuthenticatedRequest;
afterAll(async () => database.destroy());

describe.skipIf(!enabled)('discriminator-safe accepted participation read contracts', () => {
  it('never casts a daily class key as a session/event UUID under predicate pushdown', async () => {
    await rollbackAcademicFixture(database, async (db, tx) => {
      const { core, school, events, kernel, bridge, sessions } = academicParticipationTestServices(db);
      const planning = new ActivityPlanningService(db, events, core, core, core, new ResponsibilityProjectionService(core));
      const workspace = new ActivityAttendanceWorkspaceService(db, planning, kernel, sessions, new ResponsibilityAttendanceRepository(db), bridge);
      const suffix = randomUUID();
      const account = await tx.insertInto('users').values({ username: `read-contract-${suffix}`, email: `read-contract-${suffix}@example.test`,
        first_name: 'Read', last_name: 'Contract', role: 'admin', password_hash: 'isolated-test-only-hash' })
        .returning(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).executeTakeFirstOrThrow();
      const schoolId = await new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, account, 'Asia/Kolkata');
      const user: AuthUser = { ...account, active_school_id: schoolId };
      const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const now = new Date(`${date}T04:00:00Z`);
      const environment = createLiveExecutionEnvironment({ institution_id: schoolId,
        clock: { now: () => new Date(now), nowIso: () => now.toISOString() } });
      await executionEnvironmentStorage.run(environment, async () => {
        const configured = await new ProgressiveSetupService(db, core, core, core).setupAttendance(user, schoolId,
          { group_name: 'Read contract', participant_names: ['Participant One'],
            responsible: { kind: 'current_user', self_teaches: true, display_name: 'Read Contract' },
            session: { starts_at: '09:00', ends_at: '10:00', weekdays: [1, 2, 3, 4, 5, 6, 7] } }, request(user));
        const classId = configured.resources.class_section_id;
        const initial = await school.teacherAttendanceScreen(user, classId, date);
        await school.saveTeacherAttendance(user, { class_section_id: classId, date, expected_revision: 0,
          records: initial.roster.map(person => ({ student_id: person.id, status: 'present' })) }, request(user));
        const daily = (await sql<{ source_id: string }>`SELECT source_id FROM activity_attendance_source_contexts
          WHERE school_id=${schoolId}::uuid AND source_kind='daily_class' AND state='active'`.execute(tx)).rows;
        expect(daily).toHaveLength(1);
        expect(daily[0]!.source_id).toContain(`:${date}`);
        expect((await tx.selectFrom('attendance_records').select('id').where('class_section_id', '=', classId).execute())).toHaveLength(1);
        const queue = await workspace.list(user, schoolId, { date });
        expect(queue.registers).toHaveLength(1);
        const summary = queue.registers[0]!;
        const detail = await kernel.detail(user, schoolId, summary.id);
        expect(summary).toMatchObject({ source_kind: 'daily_class', entry_mode: 'participation', title: detail.register.title,
          starts_at: detail.register.starts_at, ends_at: detail.register.ends_at, time_zone: detail.register.time_zone });
        expect(new Date(summary.ends_at).getTime() - new Date(summary.starts_at).getTime()).toBe(86_400_000);
        expect(summary.title).toContain('daily attendance');

        const unrelatedSession = randomUUID();
        const views = ['attendance_session_entries', 'attendance_session_submissions', 'attendance_session_entry_revisions',
          'attendance_session_evidence', 'campus_event_attendance_records', 'campus_event_attendance_revisions'] as const;
        for (const forceNestedLoop of [false, true]) {
          await sql`SELECT set_config('enable_hashjoin',${forceNestedLoop ? 'off' : 'on'},true),
            set_config('enable_mergejoin',${forceNestedLoop ? 'off' : 'on'},true)`.execute(tx);
          for (const view of views) {
            // The unqualified context filter is intentional: an optimizer may
            // evaluate it before the view's owning source-kind/tenant joins.
            const filtered = await sql`SELECT * FROM ${sql.table(view)} WHERE session_id=${unrelatedSession}::uuid`.execute(tx);
            expect(filtered.rows, `${view} must not reinterpret a daily source key`).toEqual([]);
            const tenantFiltered = await sql`SELECT * FROM ${sql.table(view)}
              WHERE school_id=${schoolId}::uuid AND session_id=${unrelatedSession}::uuid`.execute(tx);
            expect(tenantFiltered.rows, `${view} must retain its exact owning context`).toEqual([]);
          }
        }
      });
    });
  }, 60_000);
});
