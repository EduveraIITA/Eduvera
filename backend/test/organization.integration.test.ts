import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../src/database/database.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import type { AuthUser } from "../src/common/request.js";
import { OrganizationService } from "../src/organization/organization.service.js";
import type { OrganizationNode } from "../src/organization/organization.contracts.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;
suite("organization structure against disposable PostgreSQL and the real model gateway", () => {
  let pool: Pool, db: DatabaseService, organization: OrganizationService, user: AuthUser;
  let school: string, profileId: string;
  const rootId = randomUUID(), childId = randomUUID(), requestId = randomUUID();
  const nodes = (): OrganizationNode[] => [
    { id: rootId, parent_id: null, kind: "leadership", name: "Leadership", description: "", tone: "violet", head_staff_id: profileId, member_ids: [] },
    { id: childId, parent_id: rootId, kind: "department", name: "Academics", description: "", tone: "blue", head_staff_id: null, member_ids: [profileId] },
  ];
  beforeAll(async () => {
    pool = new Pool({ connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL), max: 2 });
    db = new DatabaseService(); const core = new CampusModelCoreService(db); organization = new OrganizationService(db, core, core);
    const key = randomUUID();
    user = (await pool.query<AuthUser>("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,'unused-test-hash','Organization','Admin','admin') RETURNING *", [key, `${key}@example.test`])).rows[0]!;
    school = (await pool.query<{ id: string }>("INSERT INTO schools(name,code) VALUES('Organization test',$1) RETURNING id", [key.slice(0, 20)])).rows[0]!.id;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,'admin')", [user.id, school]);
    const person = (await pool.query<{ id: string }>("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Organization','Admin') RETURNING id", [school])).rows[0]!.id;
    profileId = (await pool.query<{ id: string }>(`INSERT INTO staff_profiles(school_id,user_id,person_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status)
      VALUES($1,$2,$3,'ORG-ADMIN','Organization','Admin',$4,'non_teaching','Administrator','full_time',CURRENT_DATE,'active') RETURNING id`, [school, user.id, person, user.email])).rows[0]!.id;
    await db.transaction().execute(tx => core.linkAccountEndpoint(tx, { school_id: school, person_id: person, user_id: user.id, actor_user_id: user.id,
      effective_from: new Date(Date.now() - 1000).toISOString(), effective_until: null, source_domain: "staff", source_record_id: profileId, source_revision: 1, metadata: {} }));
  });
  afterAll(async () => { await db?.destroy(); await pool?.end(); });
  it("saves and replays with a correlated command, immutable revision and event", async () => {
    expect((await organization.workspace(user, school)).revision).toBe(0);
    const input = { expected_revision: 0, request_id: requestId, nodes: nodes() };
    expect(await organization.save(user, school, input)).toMatchObject({ revision: 1, replayed: false });
    expect(await organization.save(user, school, input)).toMatchObject({ revision: 1, replayed: true });
    const trace = await pool.query<{ state: string; revision: number; event_type: string }>(`SELECT command.state,revision.revision,event.event_type FROM organization_structure_revisions revision
      JOIN campus_model_commands command ON command.id=revision.command_id JOIN event_outbox event ON event.id=revision.event_id WHERE revision.school_id=$1`, [school]);
    expect(trace.rows).toEqual([{ state: "accepted", revision: 1, event_type: "organization.structure.updated" }]);
    const workspace = await organization.workspace(user, school); expect(workspace.nodes).toHaveLength(2); expect(workspace.staff.map(person => person.id)).toContain(profileId);
  });
  it("rejects stale saves, changed retry payloads and cycles without losing the saved structure", async () => {
    await expect(organization.save(user, school, { expected_revision: 0, request_id: randomUUID(), nodes: [] })).rejects.toThrow(/changed since/);
    await expect(organization.save(user, school, { expected_revision: 0, request_id: requestId, nodes: [] })).rejects.toThrow(/different changes/);
    await expect(organization.save(user, school, { expected_revision: 1, request_id: randomUUID(), nodes: nodes().map(node => node.id === rootId ? { ...node, parent_id: childId } : node) })).rejects.toThrow(/cycle/);
    expect((await organization.workspace(user, school)).nodes).toHaveLength(2);
  });
  it("serializes concurrent editors and retains exactly one new revision", async () => {
    const outcomes = await Promise.allSettled(["Academic programmes", "Learning"].map(name => organization.save(user, school, { expected_revision: 1, request_id: randomUUID(), nodes: nodes().map(node => node.id === childId ? { ...node, name } : node) })));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect((await organization.workspace(user, school)).revision).toBe(2);
  });
  it("rechecks revoked membership for reads, replay and event delivery", async () => {
    await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2", [school, user.id]);
    await expect(organization.workspace(user, school)).rejects.toThrow(/administrator/);
    await expect(organization.save(user, school, { expected_revision: 0, request_id: requestId, nodes: nodes() })).rejects.toThrow(/administrator/);
    const delivery = await pool.query<{ allowed: boolean }>("SELECT event_user_is_authorized($1,'organization.structure.updated','{}'::jsonb,$2) AS allowed", [school, user.id]);
    expect(delivery.rows[0]!.allowed).toBe(false);
  });
});
