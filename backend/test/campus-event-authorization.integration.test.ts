import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertIsolatedTestDatabaseName,
  requireIsolatedTestDatabaseUrl,
} from "./test-database.js";

const pool = new Pool({
  connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),
  max: 1,
  application_name: "campus_event_authorization_tests",
});

let client: PoolClient;

beforeAll(async () => {
  client = await pool.connect();
  const identity = await client.query<{ database_name: string }>("SELECT current_database() AS database_name");
  assertIsolatedTestDatabaseName(identity.rows[0]?.database_name ?? "");
});

afterAll(async () => {
  client?.release();
  await pool.end();
});

describe("SchoolEventService campus_event.updated replay authorization", () => {
  it("uses the current event roster, staff duties and guardian relationship", async () => {
    await client.query("BEGIN");
    try {
      const suffix = randomUUID();
      const school = (await client.query<{ id: string }>(
        "INSERT INTO schools(name,code,timezone) VALUES($1,$2,'Asia/Kolkata') RETURNING id",
        ["Campus event authorization school", `event-auth-${suffix.slice(0, 12)}`],
      )).rows[0]!.id;
      const users = (await client.query<{ id: string; role: string }>(`
        INSERT INTO users(username,email,password_hash,first_name,last_name,role)
        VALUES
          ($1,$2,'!','Admin','User','admin'),
          ($3,$4,'!','Assigned','Teacher','staff'),
          ($5,$6,'!','Other','Teacher','staff'),
          ($7,$8,'!','Student','User','student'),
          ($9,$10,'!','Guardian','User','parent')
        RETURNING id,role
      `, [
        `admin-${suffix}`, `admin-${suffix}@example.invalid`,
        `assigned-${suffix}`, `assigned-${suffix}@example.invalid`,
        `other-${suffix}`, `other-${suffix}@example.invalid`,
        `student-${suffix}`, `student-${suffix}@example.invalid`,
        `guardian-${suffix}`, `guardian-${suffix}@example.invalid`,
      ])).rows;
      const byRole = (role: string, offset = 0) => users.filter((row) => row.role === role)[offset]!.id;
      const admin = byRole("admin");
      const assigned = byRole("staff");
      const outsider = byRole("staff", 1);
      const studentUser = byRole("student");
      const guardianUser = byRole("parent");
      await client.query(`
        INSERT INTO school_memberships(user_id,school_id,role)
        VALUES($1,$6,'admin'),($2,$6,'staff'),($3,$6,'staff'),($4,$6,'student'),($5,$6,'guardian')
      `, [admin, assigned, outsider, studentUser, guardianUser, school]);
      const person = (await client.query<{ id: string }>(
        "INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Student','User') RETURNING id",
        [school],
      )).rows[0]!.id;
      const student = (await client.query<{ id: string }>(
        "INSERT INTO students(user_id,person_id,school_id,admission_number) VALUES($1,$2,$3,$4) RETURNING id",
        [studentUser, person, school, `AUTH-${suffix.slice(0, 8)}`],
      )).rows[0]!.id;
      const parent = (await client.query<{ id: string }>(
        "INSERT INTO parents(user_id,phone) VALUES($1,'9000000000') RETURNING id",
        [guardianUser],
      )).rows[0]!.id;
      const relationship = (await client.query<{ id: string }>(`
        INSERT INTO guardian_relationships(school_id,guardian_id,student_id,relationship,is_primary)
        VALUES($1,$2,$3,'mother',true) RETURNING id
      `, [school, parent, student])).rows[0]!.id;
      const event = (await client.query<{ id: string }>(`
        INSERT INTO campus_events(
          school_id,event_type,status,title,description,venue,starts_at,ends_at,
          audience_mode,participation_requirement,requires_rsvp,
          requires_guardian_consent,payment_required,created_by,published_by,published_at
        ) VALUES(
          $1,'excursion','published','Authorization test','','',now()+interval '1 day',now()+interval '2 days',
          'students','optional',true,false,false,$2,$2,now()
        ) RETURNING id
      `, [school, admin])).rows[0]!.id;
      await client.query(
        "INSERT INTO campus_event_participants(school_id,event_id,student_id,participation_requirement) VALUES($1,$2,$3,'optional')",
        [school, event, student],
      );
      await client.query(
        "INSERT INTO campus_event_staff(school_id,event_id,user_id,role) VALUES($1,$2,$3,'duty_staff')",
        [school, event, assigned],
      );

      const authorized = async (candidate: string, eventId = event) => (await client.query<{ value: boolean }>(`
        SELECT event_user_is_authorized(
          $1::uuid,'campus_event.updated',jsonb_build_object('event_id',$2::text),$3::uuid
        ) AS value
      `, [school, eventId, candidate])).rows[0]!.value;

      await expect(authorized(admin)).resolves.toBe(true);
      await expect(authorized(assigned)).resolves.toBe(true);
      await expect(authorized(outsider)).resolves.toBe(false);
      await expect(authorized(studentUser)).resolves.toBe(true);
      await expect(authorized(guardianUser)).resolves.toBe(true);
      await expect(authorized(guardianUser, randomUUID())).resolves.toBe(false);

      await client.query("DELETE FROM guardian_relationships WHERE id=$1", [relationship]);
      await expect(authorized(guardianUser)).resolves.toBe(false);
      await client.query("DELETE FROM campus_event_participants WHERE event_id=$1 AND student_id=$2", [event, student]);
      await expect(authorized(studentUser)).resolves.toBe(false);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
