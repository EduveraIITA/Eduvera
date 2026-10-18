import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import type { OrganizationNode } from "../src/organization/organization.contracts.js";
import { OrganizationService } from "../src/organization/organization.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;

suite("organization structure against disposable PostgreSQL", () => {
  let pool: Pool;
  let database: DatabaseService;
  let organization: OrganizationService;
  let user: AuthUser;
  let schoolId: string;
  let staffId: string;
  const rootId = randomUUID();
  const childId = randomUUID();
  const requestId = randomUUID();

  const nodes = (): OrganizationNode[] => [
    {
      id: rootId,
      parent_id: null,
      kind: "leadership",
      name: "Leadership",
      description: "",
      tone: "violet",
      head_staff_id: staffId,
      member_ids: [],
    },
    {
      id: childId,
      parent_id: rootId,
      kind: "department",
      name: "Academics",
      description: "",
      tone: "blue",
      head_staff_id: null,
      member_ids: [staffId],
    },
  ];

  beforeAll(async () => {
    pool = new Pool({
      connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),
      max: 2,
    });
    database = new DatabaseService();
    organization = new OrganizationService(database);
    const key = randomUUID();
    user = (await pool.query<AuthUser>(`
      INSERT INTO users(username,email,password_hash,first_name,last_name,role)
      VALUES($1,$2,'unused-test-hash','Organization','Admin','admin') RETURNING *
    `, [key, `${key}@example.test`])).rows[0]!;
    schoolId = (await pool.query<{ id: string }>(`
      INSERT INTO schools(name,code) VALUES('Organization test',$1) RETURNING id
    `, [key.slice(0, 20)])).rows[0]!.id;
    await pool.query(
      "INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'admin')",
      [user.id, schoolId],
    );
    staffId = (await pool.query<{ id: string }>(`
      INSERT INTO staff_profiles(
        school_id,user_id,staff_code,first_name,last_name,email,staff_kind,
        designation,employment_type,joined_on,status
      ) VALUES(
        $1,$2,'ORG-ADMIN','Organization','Admin',$3,'non_teaching',
        'Administrator','full_time',CURRENT_DATE,'active'
      ) RETURNING id
    `, [schoolId, user.id, user.email])).rows[0]!.id;
  });

  afterAll(async () => {
    await database?.destroy();
    await pool?.end();
  });

  it("saves and replays with an immutable revision, audit record and event", async () => {
    expect((await organization.workspace(user, schoolId)).revision).toBe(0);
    const input = { expected_revision: 0, request_id: requestId, nodes: nodes() };
    await expect(organization.save(user, schoolId, input)).resolves.toMatchObject({ revision: 1, replayed: false });
    await expect(organization.save(user, schoolId, input)).resolves.toMatchObject({ revision: 1, replayed: true });
    const trace = await pool.query<{ revision: number; event_type: string; action: string }>(`
      SELECT revision.revision,event.event_type,audit.action
      FROM organization_structure_revisions revision
      JOIN event_outbox event ON event.id=revision.event_id
      JOIN audit_events audit ON audit.request_id=revision.request_id
      WHERE revision.school_id=$1
    `, [schoolId]);
    expect(trace.rows).toEqual([{
      revision: 1,
      event_type: "organization.structure.updated",
      action: "organization.structure.saved",
    }]);
    expect((await organization.workspace(user, schoolId)).nodes).toHaveLength(2);
  });

  it("serializes concurrent editors and retains only one next revision", async () => {
    const outcomes = await Promise.allSettled([
      "Academic programmes",
      "Learning",
    ].map((name) => organization.save(user, schoolId, {
      expected_revision: 1,
      request_id: randomUUID(),
      nodes: nodes().map((entry) => entry.id === childId ? { ...entry, name } : entry),
    })));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect((await organization.workspace(user, schoolId)).revision).toBe(2);
  });
});
