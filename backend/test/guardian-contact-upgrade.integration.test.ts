import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const upgradeUrl=process.env.PEOPLE_UPGRADE_TEST_URL;
describe.skipIf(!upgradeUrl)('migration 218 nonempty predecessor preservation',()=>{
  it('retires the global contact copy without changing canonical contacts, relationships or exact-scope foreign keys',async()=>{
    const pool=new Pool({connectionString:requireIsolatedTestDatabaseUrl(upgradeUrl),max:1}),client=await pool.connect();
    try {
      await client.query('BEGIN');
      for(const file of ['214_attendance_storage_convergence.sql','215_finance_review_storage_convergence.sql','216_canonical_staff_person_details.sql','217_guardian_fee_review_world_guard.sql']) {
        await client.query(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
      }
      const school=randomUUID(),account=randomUUID(),student=randomUUID(),guardian=randomUUID(),relationship=randomUUID();
      await client.query("INSERT INTO schools(id,name,code) VALUES($1,'Fictional contact upgrade',$2)",[school,randomUUID().slice(0,20)]);
      await client.query("INSERT INTO users(id,username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'unused','Account label','Only','parent')",
        [account,`upgrade-${account}`,`upgrade-${account}@example.test`]);
      const learnerPerson=randomUUID();
      await client.query("INSERT INTO school_people(id,school_id,first_name,last_name) VALUES($1,$2,'Fictional learner','Only')",[learnerPerson,school]);
      await client.query("INSERT INTO students(id,school_id,person_id,admission_number) VALUES($1,$2,$3,$4)",[student,school,learnerPerson,`UP-${student}`]);
      await client.query('INSERT INTO parents(id,user_id,phone) VALUES($1,$2,$3)',[guardian,account,'+919000000201']);
      await client.query("INSERT INTO guardian_relationships(id,student_id,guardian_id,relationship) VALUES($1,$2,$3,'guardian')",[relationship,student,guardian]);
      const profile=(await client.query('SELECT person_id FROM guardian_school_profiles WHERE school_id=$1 AND guardian_id=$2',[school,guardian])).rows[0];
      await client.query("UPDATE school_people SET first_name='Canonical guardian',contact_phone='+919000000202',contact_email='canonical-upgrade@example.test' WHERE id=$1",[profile.person_id]);
      const relations=(await client.query('SELECT * FROM guardian_relationships ORDER BY id')).rows;
      const profiles=(await client.query('SELECT * FROM guardian_school_profiles ORDER BY school_id,guardian_id')).rows;
      const people=(await client.query('SELECT id,school_id,first_name,last_name,contact_email,contact_phone,revision FROM school_people ORDER BY id')).rows;
      const foreignKeys=(await client.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND conrelid IN ('parents'::regclass,'guardian_relationships'::regclass,'guardian_school_profiles'::regclass,'school_people'::regclass) ORDER BY conname")).rows;
      const boundary=(await client.query('SELECT now() AS recorded_at')).rows[0].recorded_at;
      await client.query(readFileSync(new URL('../migrations/218_explicit_guardian_person_contacts.sql',import.meta.url),'utf8'));
      expect((await client.query('SELECT * FROM guardian_relationships ORDER BY id')).rows).toEqual(relations);
      expect((await client.query('SELECT * FROM guardian_school_profiles ORDER BY school_id,guardian_id')).rows).toEqual(profiles);
      expect((await client.query('SELECT id,school_id,first_name,last_name,contact_email,contact_phone,revision FROM school_people ORDER BY id')).rows).toEqual(people);
      expect((await client.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND conrelid IN ('parents'::regclass,'guardian_relationships'::regclass,'guardian_school_profiles'::regclass,'school_people'::regclass) ORDER BY conname")).rows).toEqual(foreignKeys);
      const audit=(await client.query("SELECT metadata,created_at FROM audit_events WHERE action='database.guardian_contact_copy_retired' AND target_id=$1 AND school_id=$2",[guardian,school])).rows;
      expect(audit).toEqual([{metadata:{migration:218,person_id:profile.person_id,retired_intake_phone:'+919000000201',current_owner:'school_people',
        knowledge_boundary:'recorded_at_migration_not_original_effective_time'},created_at:boundary}]);
      expect((await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='parents' AND column_name='phone'")).rows).toEqual([]);
      const unbound=randomUUID();await client.query('INSERT INTO parents(id,user_id) VALUES($1,NULL)',[unbound]);
      await client.query('SAVEPOINT invalid_guardian');
      await expect(client.query("INSERT INTO guardian_relationships(student_id,guardian_id,relationship) VALUES($1,$2,'guardian')",[student,unbound]))
        .rejects.toThrow(/explicit canonical guardian profile/);
      await client.query('ROLLBACK TO SAVEPOINT invalid_guardian');
      expect((await client.query('SELECT person_id FROM guardian_school_profiles WHERE school_id=$1 AND guardian_id=$2',[school,unbound])).rows).toEqual([]);
    } finally {await client.query('ROLLBACK');client.release();await pool.end();}
  },120000);
});
