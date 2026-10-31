import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const databaseUrl = isolated
  ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : "postgresql://invalid.invalid/unused";
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

afterAll(async () => {
  await pool.end();
});

describe.skipIf(!isolated)("canonical responsibility writer convergence", () => {
  it("projects assignment, role and human-agent lifecycle changes inside the writer transaction", async () => {
    const client = await pool.connect();
    const suffix = randomUUID();
    try {
      await client.query("BEGIN");
      const school = (await client.query<{ id: string }>(
        "INSERT INTO schools(name,code) VALUES($1,$2) RETURNING id",
        ["Responsibility writer test", `responsibility-${suffix.slice(0, 8)}`],
      )).rows[0]!.id;
      const administrator = (await client.query<{ id: string }>(
        `INSERT INTO users(username,email,password_hash,first_name,last_name,role)
         VALUES($1,$2,'test-only-password-hash','Setup','Administrator','admin') RETURNING id`,
        [`setup.${suffix}`, `setup.${suffix}@example.test`],
      )).rows[0]!.id;
      const operator = (await client.query<{ id: string }>(
        `INSERT INTO users(username,email,password_hash,first_name,last_name,role)
         VALUES($1,$2,'test-only-password-hash','Finance','Operator','staff') RETURNING id`,
        [`operator.${suffix}`, `operator.${suffix}@example.test`],
      )).rows[0]!.id;
      await client.query(
        `INSERT INTO school_memberships(school_id,user_id,role) VALUES
         ($1,$2,'admin'),($1,$3,'staff'),($1,$3,'admin')`,
        [school, administrator, operator],
      );
      const profile = (await client.query<{ id: string; person_id: string }>(
        `WITH staff_fixture_input(school_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id) AS (VALUES ($1,$2,$3,'Finance','Operator',$4,'non_teaching','Finance operator','full_time',current_date,'active',$5,$5,gen_random_uuid())), canonical_fixture_person AS (INSERT INTO school_people(id,school_id,first_name,last_name,contact_email,contact_phone) SELECT input.person_id::uuid,input.school_id::uuid,input.first_name,input.last_name,input.email,'' FROM staff_fixture_input input RETURNING id) INSERT INTO staff_profiles(school_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id) SELECT input.school_id::uuid,input.user_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status,input.created_by::uuid,input.updated_by::uuid,input.person_id::uuid FROM staff_fixture_input input JOIN canonical_fixture_person person ON person.id=input.person_id::uuid
         RETURNING id,person_id`,
        [school, operator, `FIN-${suffix.slice(0, 8)}`, `operator.${suffix}@example.test`, administrator],
      )).rows[0]!;
      const agent = (await client.query<{ id: string }>(
        `INSERT INTO campus_model_agents(
           school_id,agent_kind,user_id,person_id,external_ref,label,status,metadata
         ) VALUES($1,'human',NULL,$2,NULL,'Finance Operator','active','{}'::jsonb)
         RETURNING id`,
        [school, profile.person_id],
      )).rows[0]!.id;
      const role = (await client.query<{ id: string }>(
        `INSERT INTO staff_responsibility_types(
           school_id,code,name,category,scope_kind,description,access_summary,
           capability_permissions,workflow_family,source_kind,context_kind,
           requires_acceptance,restricted,is_active,updated_by
         ) VALUES($1,$2,'Finance operator','operations','school',
           'Operate institution finance records.','Institution finance records.',
           ARRAY['fees.manage'],'finance_operator','institute','institution',false,false,true,$3)
         RETURNING id`,
        [school, `finance_${suffix.slice(0, 8)}`, administrator],
      )).rows[0]!.id;
      const assignment = (await client.query<{ id: string }>(
        `INSERT INTO staff_responsibility_assignments(
           school_id,responsibility_type_id,staff_profile_id,scope_label,starts_on,
           status,assigned_by
         ) VALUES($1,$2,$3,'Institution finance',current_date,'active',$4)
         RETURNING id`,
        [school, role, profile.id, administrator],
      )).rows[0]!.id;

      const projected = async () => (await client.query<{
        owner_agent_id: string; action_key: string; status: string; source_revision: number;
      }>(
        `SELECT owner_agent_id,action_key,status,source_revision
         FROM campus_responsibility_assignments
         WHERE school_id=$1 AND source_domain='access_assignments'
           AND provenance->>'source_kind'='assignment'
           AND provenance->>'source_id'=$2`,
        [school, assignment],
      )).rows;

      expect(await projected()).toEqual([expect.objectContaining({
        owner_agent_id: agent,
        action_key: "fees.manage",
        status: "active",
        source_revision: 1,
      })]);

      // An administrator relationship, even on the same account, contributes no
      // additional operational responsibility. Only the explicit assignment does.
      expect((await client.query<{ count: string }>(
        "SELECT count(*)::text count FROM campus_responsibility_assignments WHERE school_id=$1",
        [school],
      )).rows[0]!.count).toBe("1");

      await client.query("UPDATE staff_responsibility_types SET is_active=false WHERE id=$1", [role]);
      expect((await projected())[0]?.status).toBe("suspended");
      await client.query("UPDATE staff_responsibility_types SET is_active=true WHERE id=$1", [role]);
      expect((await projected())[0]?.status).toBe("active");

      await client.query("UPDATE staff_profiles SET status='inactive' WHERE id=$1", [profile.id]);
      expect((await projected())[0]?.status).toBe("suspended");
      await client.query("UPDATE staff_profiles SET status='active' WHERE id=$1", [profile.id]);
      expect((await projected())[0]?.status).toBe("active");

      await client.query("UPDATE campus_model_agents SET status='suspended' WHERE id=$1", [agent]);
      expect((await projected())[0]?.status).toBe("suspended");
      await client.query("UPDATE campus_model_agents SET status='active' WHERE id=$1", [agent]);
      expect((await projected())[0]?.status).toBe("active");

      await client.query(
        `UPDATE staff_responsibility_assignments
         SET status='revoked',revoked_by=$2,revoked_at=now(),revocation_reason='Test revocation'
         WHERE id=$1`,
        [assignment, administrator],
      );
      expect((await projected())[0]).toEqual(expect.objectContaining({ status: "revoked", source_revision: 2 }));

      await client.query("DELETE FROM staff_responsibility_assignments WHERE id=$1", [assignment]);
      expect((await projected())[0]?.status).toBe("revoked");
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  it("projects accepted timetable cover as a bounded delegation and revokes it when cover closes", async () => {
    const client = await pool.connect();
    const suffix = randomUUID();
    try {
      await client.query("BEGIN");
      const school = (await client.query<{ id: string }>(
        "INSERT INTO schools(name,code) VALUES($1,$2) RETURNING id",
        ["Cover projection test", `cover-${suffix.slice(0, 8)}`],
      )).rows[0]!.id;
      const coordinator = (await client.query<{ id: string }>(
        `INSERT INTO users(username,email,password_hash,first_name,last_name,role)
         VALUES($1,$2,'test-only-password-hash','Cover','Coordinator','admin') RETURNING id`,
        [`coordinator.${suffix}`, `coordinator.${suffix}@example.test`],
      )).rows[0]!.id;
      const absent = (await client.query<{ id: string }>(
        `INSERT INTO users(username,email,password_hash,first_name,last_name,role)
         VALUES($1,$2,'test-only-password-hash','Absent','Teacher','staff') RETURNING id`,
        [`absent.${suffix}`, `absent.${suffix}@example.test`],
      )).rows[0]!.id;
      const replacement = (await client.query<{ id: string }>(
        `INSERT INTO users(username,email,password_hash,first_name,last_name,role)
         VALUES($1,$2,'test-only-password-hash','Cover','Teacher','staff') RETURNING id`,
        [`cover.${suffix}`, `cover.${suffix}@example.test`],
      )).rows[0]!.id;
      await client.query(
        `INSERT INTO school_memberships(school_id,user_id,role) VALUES
         ($1,$2,'admin'),($1,$3,'staff'),($1,$4,'staff')`,
        [school, coordinator, absent, replacement],
      );
      const profiles = await client.query<{ id: string; user_id: string; person_id: string }>(
        `WITH staff_fixture_input(school_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id) AS (VALUES ($1,$2,$3,'Absent','Teacher',$4,'teaching','Teacher','full_time',current_date,'active',$6,$6,gen_random_uuid()),($1,$5,$7,'Cover','Teacher',$8,'teaching','Teacher','full_time',current_date,'active',$6,$6,gen_random_uuid())), canonical_fixture_person AS (INSERT INTO school_people(id,school_id,first_name,last_name,contact_email,contact_phone) SELECT input.person_id::uuid,input.school_id::uuid,input.first_name,input.last_name,input.email,'' FROM staff_fixture_input input RETURNING id) INSERT INTO staff_profiles(school_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id) SELECT input.school_id::uuid,input.user_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status,input.created_by::uuid,input.updated_by::uuid,input.person_id::uuid FROM staff_fixture_input input JOIN canonical_fixture_person person ON person.id=input.person_id::uuid
         RETURNING id,user_id,person_id`,
        [
          school,
          absent,
          `ABS-${suffix.slice(0, 8)}`,
          `absent.${suffix}@example.test`,
          replacement,
          coordinator,
          `REP-${suffix.slice(0, 8)}`,
          `cover.${suffix}@example.test`,
        ],
      );
      const absentProfile = profiles.rows.find((row) => row.user_id === absent)!;
      const replacementProfile = profiles.rows.find((row) => row.user_id === replacement)!;
      const replacementAgent = (await client.query<{ id: string }>(
        `INSERT INTO campus_model_agents(
           school_id,agent_kind,user_id,person_id,external_ref,label,status,metadata
         ) VALUES($1,'human',NULL,$2,NULL,'Cover Teacher','active','{}'::jsonb)
         RETURNING id`,
        [school, replacementProfile.person_id],
      )).rows[0]!.id;
      const section = (await client.query<{ id: string }>(
        `INSERT INTO class_sections(school_id,academic_year,grade,section,updated_by)
         VALUES($1,'2030-31','6','A',$2) RETURNING id`,
        [school, coordinator],
      )).rows[0]!.id;
      const subject = (await client.query<{ id: string }>(
        `INSERT INTO subjects(school_id,code,name,short_name,updated_by)
         VALUES($1,$2,'Mathematics','Math',$3) RETURNING id`,
        [school, `M-${suffix.slice(0, 6)}`, coordinator],
      )).rows[0]!.id;
      const policy = (await client.query<{ id: string }>(
        `INSERT INTO staff_leave_policies(
           school_id,academic_year,code,name,annual_allowance,updated_by
         ) VALUES($1,'2030-31',$2,'Test leave',10,$3) RETURNING id`,
        [school, `L-${suffix.slice(0, 6)}`, coordinator],
      )).rows[0]!.id;
      const dutyDate = "2030-04-08";
      const leave = (await client.query<{ id: string }>(
        `INSERT INTO staff_leave_requests(
           school_id,staff_profile_id,policy_id,starts_on,ends_on,requested_days,
           reason,status,decided_by,decided_at
         ) VALUES($1,$2,$3,$4,$4,1,'Test cover','approved',$5,now()) RETURNING id`,
        [school, absentProfile.id, policy, dutyDate, coordinator],
      )).rows[0]!.id;
      const sourceSchedule = randomUUID();
      const coverage = (await client.query<{ id: string; revision: number }>(
        `INSERT INTO staff_coverage_tasks(
           school_id,leave_request_id,absent_staff_profile_id,replacement_staff_profile_id,
           source_schedule_id,class_section_id,subject_id,duty_date,period_number,
           starts_at,ends_at,title,status,assigned_by,offered_at,responded_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,'09:00','09:45',
           'Mathematics cover','accepted',$9,now(),now()) RETURNING id,revision`,
        [
          school,
          leave,
          absentProfile.id,
          replacementProfile.id,
          sourceSchedule,
          section,
          subject,
          dutyDate,
          coordinator,
        ],
      )).rows[0]!;
      const substitution = (await client.query<{ id: string }>(
        `INSERT INTO staff_timetable_substitutions(
           school_id,coverage_task_id,class_section_id,subject_id,duty_date,
           period_number,starts_at,ends_at,source_schedule_id,source_occurrence_key,
           source_kind,source_record_id,source_revision,source_version,
           original_teacher_user_id,replacement_staff_profile_id,
           replacement_teacher_user_id,coverage_task_revision,accepted_by,accepted_at
         ) VALUES($1,$2,$3,$4,$5,1,'09:00','09:45',$6,
           repeat('a',64),'legacy_timetable',$7,1,NULL,$8,$9,$10,$11,$10,now())
         RETURNING id`,
        [
          school,
          coverage.id,
          section,
          subject,
          dutyDate,
          sourceSchedule,
          randomUUID(),
          absent,
          replacementProfile.id,
          replacement,
          coverage.revision,
        ],
      )).rows[0]!.id;

      const projected = async () => client.query<{
        owner_agent_id: string;
        authority_source_kind: string;
        action_key: string;
        status: string;
        starts: string;
        ends: string;
      }>(
        `SELECT owner_agent_id,authority_source_kind,action_key,status,
           to_char(effective_from AT TIME ZONE school.timezone,'YYYY-MM-DD HH24:MI') starts,
           to_char(effective_until AT TIME ZONE school.timezone,'YYYY-MM-DD HH24:MI') ends
         FROM campus_responsibility_assignments responsibility
         JOIN schools school ON school.id=responsibility.school_id
         WHERE responsibility.school_id=$1 AND source_domain='staff_coverage'
           AND provenance->>'substitution_id'=$2
         ORDER BY action_key`,
        [school, substitution],
      );

      expect((await projected()).rows).toEqual([
        "attendance.record", "attendance.view", "followups.manage", "groups.create",
        "messages.send", "messages.view", "photo.use", "timetable.view",
      ].map((action) => expect.objectContaining({
        owner_agent_id: replacementAgent,
        authority_source_kind: "delegation",
        action_key: action,
        status: "active",
        starts: "2030-04-08 09:00",
        ends: "2030-04-08 09:45",
      })));

      await client.query("UPDATE staff_profiles SET status='inactive' WHERE id=$1", [replacementProfile.id]);
      expect(new Set((await projected()).rows.map((row) => row.status))).toEqual(new Set(["suspended"]));
      await client.query("UPDATE staff_profiles SET status='active' WHERE id=$1", [replacementProfile.id]);
      expect(new Set((await projected()).rows.map((row) => row.status))).toEqual(new Set(["active"]));

      await client.query("UPDATE campus_model_agents SET status='suspended' WHERE id=$1", [replacementAgent]);
      expect(new Set((await projected()).rows.map((row) => row.status))).toEqual(new Set(["suspended"]));
      await client.query("UPDATE campus_model_agents SET status='active' WHERE id=$1", [replacementAgent]);
      await client.query(
        "UPDATE staff_timetable_substitutions SET state='cancelled',superseded_at=now() WHERE id=$1",
        [substitution],
      );
      expect(new Set((await projected()).rows.map((row) => row.status))).toEqual(new Set(["revoked"]));

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
