import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';

/** Explicit fixture People/profile link through the current Identity port.
 * Membership alone must never manufacture an acting campus person. */
export async function linkFixtureStaffIdentity(database: DatabaseService, input: {
  school_id: string; user_id: string; owner_user_id: string; teaching?: boolean; effective_from?: string;
}) {
  return database.transaction().execute(async (tx: Transaction<Database>) => {
    const account = await tx.selectFrom('users').select(['first_name','last_name','email'])
      .where('id','=',input.user_id).executeTakeFirstOrThrow();
    let profile = await tx.selectFrom('staff_profiles').select(['id','person_id'])
      .where('school_id','=',input.school_id).where('user_id','=',input.user_id).executeTakeFirst();
    if (!profile) {
      const person = await tx.insertInto('school_people').values({ school_id: input.school_id, first_name: account.first_name,
        last_name: account.last_name, contact_email: account.email }).returning('id').executeTakeFirstOrThrow();
      profile = (await sql<{id:string;person_id:string}>`WITH staff_fixture_input(school_id,person_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by) AS (VALUES (${input.school_id}::uuid,${person.id}::uuid,${input.user_id}::uuid,${`F-${randomUUID().slice(0,12)}`},${account.first_name},${account.last_name},${account.email},${input.teaching ? 'teaching' : 'non_teaching'},${input.teaching ? 'Teacher' : 'Administrator'},'full_time',${input.effective_from ?? new Date(Date.now()-86400000).toISOString()}::timestamptz::date,'active',${input.owner_user_id}::uuid,${input.owner_user_id}::uuid)) INSERT INTO staff_profiles(school_id,person_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by) SELECT input.school_id::uuid,input.person_id::uuid,input.user_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status,input.created_by::uuid,input.updated_by::uuid FROM staff_fixture_input input
        RETURNING id,person_id`.execute(tx)).rows[0]!;
    }
    return new CampusModelCoreService(database).linkAccountEndpoint(tx,{school_id:input.school_id,person_id:profile.person_id,
      user_id:input.user_id,actor_user_id:input.owner_user_id,effective_from:input.effective_from ?? new Date(Date.now()-86400000).toISOString(),
      effective_until:null,source_domain:'staff_operations',source_record_id:profile.id,source_revision:1,
      metadata:{fixture:'explicit_current_staff_profile'}});
  });
}
