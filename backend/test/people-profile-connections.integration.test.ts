import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ParticipationPeopleService } from "../src/people/participation-people.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { PeopleRelationshipProjection } from "../src/campus-model-core/people-relationship-projection.port.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const targetUrl = process.env.SIMULATION_PEOPLE_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
let queryCount = 0;
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }),
  log: event => { if (event.level === "query") queryCount++; } });
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID() }) as AuthenticatedRequest;
afterAll(() => db.destroy());
function services(database: Kysely<Database>) {
  const connection = database as DatabaseService, core = new CampusModelCoreService(connection, new ExecutionDataPlaneScope());
  return { core, people: new ParticipationPeopleService(connection, new SchoolEventService(connection, core), core, core, core, core) };
}
async function fixture() {
  const context = services(db), suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `connections-${suffix}`, email: `connections-${suffix}@example.test`,
    password_hash: "isolated-test-only", first_name: "Campus", last_name: "Owner", role: "admin" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, account, "America/New_York"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const now = "2037-03-07T12:00:00.000Z";
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: schoolId,
    clock: { now: () => new Date(now), nowIso: () => now } }), action);
  const person = (name: string) => context.people.create(request(user), schoolId, { first_name: name, idempotency_key: randomUUID() });
  const group = (name: string, ids: string[]) => context.people.createGroup(request(user), schoolId,
    { name, person_ids: ids, starts_on: "2037-03-07", idempotency_key: randomUUID() });
  return { ...context, user, schoolId, run, person, group, now };
}

describe.runIf(enabled)("canonical profile, informational connections and source-owned group projections", () => {
  it("corrects canonical contacts with revision/history, no account inference, exact retries and atomic refusals", async () => {
    const f = await fixture();
    await f.run(async () => {
      const person = await f.person("Passive contact");
      const input = { expected_revision: 1, contact_email: "contact@example.test", contact_phone: "+1 555 0100",
        reason: "Person confirmed their contact details", idempotency_key: randomUUID() };
      const saved = await f.people.correctProfile(request(f.user), f.schoolId, person.id, input);
      expect(saved).toMatchObject({ revision: 2, profile: { contact_email: input.contact_email } });
      expect(await f.people.correctProfile(request(f.user), f.schoolId, person.id, input)).toEqual(saved);
      await expect(f.people.correctProfile(request(f.user), f.schoolId, person.id, { ...input, contact_phone: "different" })).rejects.toThrow("different people data");
      await expect(f.people.correctProfile(request(f.user), f.schoolId, person.id, { ...input, idempotency_key: randomUUID() })).rejects.toThrow("changed");
      expect(await f.people.detail(f.user, f.schoolId, person.id)).toMatchObject({ has_account: false, source_profiles: [], revision: 2,
        profile: { contact_email: input.contact_email, contact_phone: input.contact_phone }, capabilities: { can_enroll: true, can_add_work_profile: true } });
      const history = (await sql<{ previous_value: unknown; current_value: unknown }>`SELECT previous_value,current_value FROM people_profile_history
        WHERE school_id=${f.schoolId}::uuid AND person_id=${person.id}::uuid`.execute(db)).rows;
      expect(history).toEqual([{ previous_value: { contact_email: "", contact_phone: "" }, current_value: { contact_email: input.contact_email, contact_phone: input.contact_phone } }]);
      await expect(sql`UPDATE people_profile_history SET reason='rewrite' WHERE person_id=${person.id}::uuid`.execute(db)).rejects.toThrow("immutable");
      expect((await sql<{ count: string }>`SELECT count(*) AS count FROM campus_model_agents WHERE school_id=${f.schoolId}::uuid AND person_id=${person.id}::uuid`.execute(db)).rows[0]!.count).toBe("0");
    });
  });

  it("retains directional mentor facts and exact end history without granting operational or app authority", async () => {
    const f = await fixture(), foreign = await fixture();
    await f.run(async () => {
      const mentor = await f.person("Mentor"), learner = await f.person("Mentee"), other = await f.person("Other mentee");
      const body = { type: "mentor_of", target_person_id: learner.id, starts_on: "2037-03-07", ends_on: null,
        reason: "Optional mentoring arrangement confirmed", idempotency_key: randomUUID() };
      const connection = await f.people.createConnection(request(f.user), f.schoolId, mentor.id, body);
      expect(await f.people.createConnection(request(f.user), f.schoolId, mentor.id, body)).toEqual(connection);
      await f.people.createConnection(request(f.user), f.schoolId, mentor.id, { ...body, target_person_id: other.id, idempotency_key: randomUUID() });
      expect(await f.people.connections(f.user, f.schoolId, learner.id, {})).toMatchObject({ total: 1,
        results: [{ id: connection.id, type: "mentor_of", direction: "incoming", related_person: { id: mentor.id, label: "Mentor" } }] });
      await expect(f.people.createConnection(request(f.user), f.schoolId, mentor.id, { ...body, idempotency_key: randomUUID() })).rejects.toThrow("overlaps");
      await expect(f.people.createConnection(request(f.user), f.schoolId, mentor.id, { ...body, target_person_id: mentor.id, idempotency_key: randomUUID() })).rejects.toThrow("another person");
      const alien = await foreign.run(() => foreign.person("Other institution"));
      await expect(f.people.createConnection(request(f.user), f.schoolId, mentor.id, { ...body, target_person_id: alien.id, idempotency_key: randomUUID() })).rejects.toThrow("not found");
      await f.people.endConnection(request(f.user), f.schoolId, connection.id, { expected_revision: 1, ends_on: "2037-03-08", reason: "Arrangement ending after review", idempotency_key: randomUUID() });
      const edges = (await sql<{ source_record_id: string; effective_until: Date | null; semantic_type_version: number; metadata: { authority: boolean } }>`SELECT source_record_id,effective_until,semantic_type_version,metadata
        FROM campus_model_relationships WHERE school_id=${f.schoolId}::uuid AND relation_type='mentor_of' ORDER BY source_record_id`.execute(db)).rows;
      expect(edges).toHaveLength(2); expect(edges.every(edge => edge.semantic_type_version === 1 && !edge.metadata.authority)).toBe(true);
      expect(edges.find(edge => edge.source_record_id === connection.id)!.effective_until?.toISOString()).toBe("2037-03-09T04:00:00.000Z");
      expect(edges.filter(edge => edge.effective_until === null)).toHaveLength(1);
      await expect(sql`DELETE FROM people_relationship_history WHERE source_id=${connection.id}::uuid`.execute(db)).rejects.toThrow("immutable");
      const facts = (await sql<{ agents: number; memberships: number; authorities: number }>`SELECT
        (SELECT count(*)::int FROM campus_model_agents WHERE school_id=${f.schoolId}::uuid) AS agents,
        (SELECT count(*)::int FROM school_memberships WHERE school_id=${f.schoolId}::uuid) AS memberships,
        (SELECT count(*)::int FROM campus_model_agent_authorities WHERE school_id=${f.schoolId}::uuid) AS authorities`.execute(db)).rows[0]!;
      expect(facts).toEqual({ agents: 1, memberships: 1, authorities: 0 });
    });
  });

  it("batches hundreds of passive members with finite pages, compact full edit baseline and DST-safe intervals", async () => {
    const f = await fixture();
    await f.run(async () => {
      const people = (await sql<{ id: string }>`INSERT INTO school_people(school_id,first_name,last_name)
        SELECT ${f.schoolId}::uuid,'Member '||lpad(n::text,3,'0'),'' FROM generate_series(1,300) n RETURNING id`.execute(db)).rows.map(row => row.id);
      const before = queryCount;
      const group = await f.people.createGroup(request(f.user), f.schoolId, { name: "Large training group", person_ids: people,
        starts_on: "2037-03-08", ends_on: "2037-03-08", idempotency_key: randomUUID() });
      const used = queryCount - before;
      expect(used).toBeLessThan(55); // Independent of the member count, not 2N calls.
      const edgeFacts = (await sql<{ count: number; hours: number }>`SELECT count(*)::int AS count,min(extract(epoch FROM effective_until-effective_from)/3600)::float AS hours
        FROM campus_model_relationships WHERE school_id=${f.schoolId}::uuid AND relation_type='member_of'`.execute(db)).rows[0]!;
      expect(edgeFacts).toEqual({ count: 300, hours: 23 });
      const onDate = createLiveExecutionEnvironment({ institution_id: f.schoolId, clock: { now: () => new Date("2037-03-08T15:00:00Z"), nowIso: () => "2037-03-08T15:00:00Z" } });
      await executionEnvironmentStorage.run(onDate, async () => {
        const list = await f.people.groups(f.user, f.schoolId, {});
        expect(list.results[0]).toMatchObject({ member_count: 300 }); expect(list.results[0]!.members).toHaveLength(3);
        const detail = await f.people.groupDetail(f.user, f.schoolId, group.id, { page: 2 });
        expect(detail).toMatchObject({ total: 300, page_size: 25 }); expect(detail.members).toHaveLength(25); expect(detail.member_ids).toHaveLength(300);
        expect((await f.people.groupDetail(f.user, f.schoolId, group.id, { page: 99 })).total).toBe(300);
        expect((await f.people.personGroups(f.user, f.schoolId, people[0]!, {})).results[0]?.id).toBe(group.id);
      });
      expect((await sql<{ count: string }>`SELECT count(*) AS count FROM campus_model_agents WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count).toBe("1");
    });
  });

  it("moves only an exact group's dated parent, rejects future cycles/stale/foreign moves and inherits no people", async () => {
    const f = await fixture(), foreign = await fixture();
    await f.run(async () => {
      const p = await f.person("Explicit member"), a = await f.group("Group A", [p.id]), b = await f.group("Group B", [p.id]), c = await f.group("Group C", [p.id]);
      const move = { parent_group_id: b.id, effective_on: "2037-03-07", expected_revision: 1, reason: "Describe the training structure", idempotency_key: randomUUID() };
      await f.people.moveGroup(request(f.user), f.schoolId, a.id, move);
      expect(await f.people.moveGroup(request(f.user), f.schoolId, a.id, move)).toMatchObject({ revision: 2 });
      await f.people.moveGroup(request(f.user), f.schoolId, b.id, { ...move, parent_group_id: c.id, effective_on: "2037-03-09", idempotency_key: randomUUID() });
      await expect(f.people.moveGroup(request(f.user), f.schoolId, c.id, { ...move, parent_group_id: a.id, effective_on: "2037-03-08", idempotency_key: randomUUID() })).rejects.toThrow("cycle");
      await expect(f.people.moveGroup(request(f.user), f.schoolId, a.id, { ...move, parent_group_id: c.id, effective_on: "2037-03-08", idempotency_key: randomUUID() })).rejects.toThrow("changed");
      const foreignPerson = await foreign.run(() => foreign.person("Private"));
      const foreignGroup = await foreign.run(() => foreign.group("Private", [foreignPerson.id]));
      await expect(f.people.moveGroup(request(f.user), f.schoolId, c.id, { ...move, parent_group_id: foreignGroup.id, idempotency_key: randomUUID() })).rejects.toThrow("this institution");
      await f.people.moveGroup(request(f.user), f.schoolId, a.id, { ...move, parent_group_id: c.id, expected_revision: 2, effective_on: "2037-03-08", idempotency_key: randomUUID() });
      const detail = await f.people.groupDetail(f.user, f.schoolId, a.id, {});
      expect(detail.parent).toMatchObject({ id: b.id }); expect(detail.member_ids).toEqual([p.id]); expect(detail.parent_history).toHaveLength(2);
      const before = (await sql<{ count: string }>`SELECT count(*) AS count FROM campus_model_relationships WHERE school_id=${f.schoolId}::uuid AND relation_type='member_of'`.execute(db)).rows[0]!.count;
      expect(before).toBe("3");
    });
  });

  it("composes exact source profile references, native class/org groups and guardian contacts without treating them as mentor authority", async () => {
    const f = await fixture();
    await f.run(async () => {
      const learner = await f.person("One canonical learner"), guardian = await f.person("One canonical guardian"), worker = await f.person("One canonical employee");
      const student = await db.insertInto("students").values({ school_id: f.schoolId, person_id: learner.id, admission_number: `L-${randomUUID()}` }).returning("id").executeTakeFirstOrThrow();
      const parent = await db.insertInto("parents").values({ user_id: null }).returning("id").executeTakeFirstOrThrow();
      await db.insertInto("guardian_school_profiles").values({ school_id: f.schoolId, guardian_id: parent.id, person_id: guardian.id }).execute();
      const relation = await db.insertInto("guardian_relationships").values({ school_id: f.schoolId, guardian_id: parent.id, student_id: student.id,
        relationship: "guardian", can_authorize_leave: false }).returning("id").executeTakeFirstOrThrow();
      const staff = await db.insertInto("staff_profiles").values({ school_id: f.schoolId, person_id: worker.id, staff_code: `W-${randomUUID()}`,
           staff_kind: "non_teaching", designation: "Worker", employment_type: "contract",
        status: "active", created_by: f.user.id, updated_by: f.user.id }).returning("id").executeTakeFirstOrThrow();
      const section = await db.insertInto("class_sections").values({ school_id: f.schoolId, academic_year: "2037", grade: "Adult", section: "A" }).returning("id").executeTakeFirstOrThrow();
      const term = await db.insertInto("academic_terms").values({ school_id: f.schoolId, academic_year: "2037", name: "Training", starts_on: "2037-01-01", ends_on: "2037-12-31", attendance_threshold: "75" }).returning("id").executeTakeFirstOrThrow();
      await db.insertInto("enrollments").values({ student_id: student.id, class_section_id: section.id, term_id: term.id, roll_number: 1, enrolled_on: "2037-01-01" }).execute();
      const nodeId = randomUUID();
      await sql`INSERT INTO organization_structures(school_id) VALUES(${f.schoolId}::uuid)`.execute(db);
      await sql`INSERT INTO organization_nodes(school_id,id,kind,name,description,tone,sort_order) VALUES(${f.schoolId}::uuid,${nodeId}::uuid,'department','Operations','','blue',0)`.execute(db);
      await sql`INSERT INTO organization_node_members(school_id,node_id,staff_id) VALUES(${f.schoolId}::uuid,${nodeId}::uuid,${staff.id}::uuid)`.execute(db);
      const learning = await f.people.detail(f.user, f.schoolId, learner.id), work = await f.people.detail(f.user, f.schoolId, worker.id);
      expect(learning).toMatchObject({ source_profiles: [{ kind: "learning", id: student.id, href: `/areas/people/records?student=${student.id}&context=learning` }], capabilities: { can_enroll: false } });
      expect(work).toMatchObject({ source_profiles: [{ kind: "work", id: staff.id }], has_account: false, capabilities: { can_add_work_profile: false } });
      expect(await f.people.resolvePerson(f.user, f.schoolId, { source_kind: "guardian", source_id: parent.id })).toEqual({ person_id: guardian.id });
      expect(await f.people.connections(f.user, f.schoolId, learner.id, {})).toMatchObject({ total: 1, results: [{ id: relation.id, type: "guardian_of", direction: "incoming",
        related_person: { id: guardian.id }, source_kind: "guardian", can_end: false, starts_on: null, source_href: `/areas/people/records?student=${student.id}&guardian=${relation.id}` }] });
      const groups = await f.people.groupCatalogue(f.user, f.schoolId, {});
      expect(groups.results).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "class", id: section.id, member_count: 1 }),
        expect.objectContaining({ kind: "organization", id: nodeId, member_count: 1 })]));
      expect(await f.people.nativeGroup(f.user, f.schoolId, "class", section.id, {})).toMatchObject({ members: [{ person_id: learner.id }], source_href: null });
      expect(await f.people.nativeGroup(f.user, f.schoolId, "organization", nodeId, {})).toMatchObject({ members: [{ person_id: worker.id }], source_href: "/more/setup/organization" });
      await expect(f.people.nativeGroup(f.user, f.schoolId, "class", randomUUID(), {})).rejects.toThrow("not found");
      const owner = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.user.id, at: f.now }));
      if (!owner.acting) throw new Error("Founder required");
      await db.insertInto("staff_profiles").values({ school_id: f.schoolId, person_id: owner.person_id, user_id: f.user.id, staff_code: `SIS-${randomUUID()}`,
           staff_kind: "non_teaching", designation: "People manager", employment_type: "contract",
        status: "active", created_by: f.user.id, updated_by: f.user.id }).execute();
      await sql`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on,created_by)
        VALUES(${f.schoolId}::uuid,${f.user.id}::uuid,'sis.manage','Explicit institution People scope only','manual','institution',
          ${f.now}::timestamptz::date-1,${f.now}::timestamptz::date+30,${f.now}::timestamptz::date+15,${f.user.id}::uuid)`.execute(db);
      await sql`UPDATE school_memberships SET role='staff' WHERE school_id=${f.schoolId}::uuid AND user_id=${f.user.id}::uuid`.execute(db);
      expect(await f.people.detail(f.user, f.schoolId, worker.id)).toMatchObject({ source_profiles: [], capabilities: { can_add_work_profile: false, can_invite: false } });
      expect((await f.people.groupCatalogue(f.user, f.schoolId, {})).results.some(row => row.kind === "organization")).toBe(false);
      expect((await f.people.personGroups(f.user, f.schoolId, worker.id, {})).total).toBe(0);
      expect((await f.people.personGroups(f.user, f.schoolId, learner.id, {})).results).toEqual([expect.objectContaining({ kind: "class", id: section.id })]);
      await expect(f.people.nativeGroup(f.user, f.schoolId, "organization", nodeId, {})).rejects.toThrow("not available");
      await expect(f.people.resolvePerson(f.user, f.schoolId, { source_kind: "staff", source_id: staff.id })).rejects.toThrow("not available");
    });
  });

  it("pages one person's reusable, learning and organization memberships together without cloning native groups or inventing organization dates", async () => {
    const f = await fixture();
    await f.run(async () => {
      const person = await f.person("Learner and employee"), reusable = await f.group("Community group", [person.id]);
      const student = await db.insertInto("students").values({ school_id: f.schoolId, person_id: person.id, admission_number: `M-${randomUUID()}` }).returning("id").executeTakeFirstOrThrow();
      const staff = await db.insertInto("staff_profiles").values({ school_id: f.schoolId, person_id: person.id, staff_code: `M-${randomUUID()}`,
           staff_kind: "non_teaching", designation: "Campus helper", employment_type: "contract",
        status: "active", created_by: f.user.id, updated_by: f.user.id }).returning("id").executeTakeFirstOrThrow();
      const section = await db.insertInto("class_sections").values({ school_id: f.schoolId, academic_year: "2037", grade: "Continuing", section: "A" }).returning("id").executeTakeFirstOrThrow();
      const term = await db.insertInto("academic_terms").values({ school_id: f.schoolId, academic_year: "2037", name: "Spring", starts_on: "2037-01-10", ends_on: "2037-06-30", attendance_threshold: "75" }).returning("id").executeTakeFirstOrThrow();
      await db.insertInto("enrollments").values({ student_id: student.id, class_section_id: section.id, term_id: term.id, roll_number: 1,
        enrolled_on: "2037-01-10", inactive_from: "2037-05-01", is_active: false, exit_kind: "withdrawn",
        exit_reason: "Future withdrawal recorded", ended_by: f.user.id, ended_at: new Date(f.now) }).execute(); // Effective interval, not today's mutable flag.
      const nodeId = randomUUID();
      await sql`INSERT INTO organization_structures(school_id) VALUES(${f.schoolId}::uuid)`.execute(db);
      await sql`INSERT INTO organization_nodes(school_id,id,kind,name,description,tone,sort_order) VALUES(${f.schoolId}::uuid,${nodeId}::uuid,'team','Campus helpers','','blue',0)`.execute(db);
      await sql`INSERT INTO organization_node_members(school_id,node_id,staff_id) VALUES(${f.schoolId}::uuid,${nodeId}::uuid,${staff.id}::uuid)`.execute(db);
      const before = (await sql<{ entities: number; relationships: number; reusable: number }>`SELECT
        (SELECT count(*)::int FROM campus_model_entities WHERE school_id=${f.schoolId}::uuid) AS entities,
        (SELECT count(*)::int FROM campus_model_relationships WHERE school_id=${f.schoolId}::uuid) AS relationships,
        (SELECT count(*)::int FROM participation_groups WHERE school_id=${f.schoolId}::uuid) AS reusable`.execute(db)).rows[0]!;
      const groups = await f.people.personGroups(f.user, f.schoolId, person.id, {});
      expect(groups).toMatchObject({ total: 3, page_size: 25 });
      expect(groups.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: reusable.id, kind: "participation", source_id: reusable.id, href: `/areas/people/groups/${reusable.id}`, starts_on: "2037-03-07", ends_on: null }),
        expect.objectContaining({ id: section.id, kind: "class", source_id: section.id, href: `/areas/people/groups/${section.id}?kind=class`, starts_on: "2037-01-10", ends_on: "2037-04-30" }),
        expect.objectContaining({ id: nodeId, kind: "organization", source_id: nodeId, href: `/areas/people/groups/${nodeId}?kind=organization`, starts_on: null, ends_on: null }),
      ]));
      expect(await f.people.personGroups(f.user, f.schoolId, person.id, { page: 99 })).toMatchObject({ total: 3, results: [] });
      const after = (await sql<{ entities: number; relationships: number; reusable: number }>`SELECT
        (SELECT count(*)::int FROM campus_model_entities WHERE school_id=${f.schoolId}::uuid) AS entities,
        (SELECT count(*)::int FROM campus_model_relationships WHERE school_id=${f.schoolId}::uuid) AS relationships,
        (SELECT count(*)::int FROM participation_groups WHERE school_id=${f.schoolId}::uuid) AS reusable`.execute(db)).rows[0]!;
      expect(after).toEqual(before);
    });
  });

  it("ends and replaces only source-owned member edges and never changes a published frozen activity roster", async () => {
    const f = await fixture();
    await f.run(async () => {
      const first = await f.person("Published attendee"), second = await f.person("New member"), parentMember = await f.person("Not inherited");
      const group = await f.group("Published roster", [first.id]), parent = await f.group("Descriptive container", [parentMember.id]);
      await f.people.moveGroup(request(f.user), f.schoolId, group.id, { parent_group_id: parent.id, effective_on: "2037-03-07", expected_revision: 1,
        reason: "Descriptive structure only", idempotency_key: randomUUID() });
      const planning = new ActivityPlanningService(db as DatabaseService, new SchoolEventService(db as DatabaseService, f.core), f.core, f.core, f.core, new ResponsibilityProjectionService(f.core));
      const draft = await planning.create(request(f.user), f.schoolId, { title: "Frozen People group", purpose: "training", timezone: "America/New_York",
        starts_on: "2037-03-10", recurrence: "once", starts_at: "13:00", ends_at: "14:00", group_ids: [`group:${group.id}`], person_ids: [], attendance_mode: "none", idempotency_key: randomUUID() });
      await planning.publish(request(f.user), f.schoolId, draft.id, { expected_revision: 1, idempotency_key: randomUUID() });
      await f.people.replaceMembers(request(f.user), f.schoolId, group.id, { expected_revision: 2, effective_on: "2037-03-09", person_ids: [second.id], idempotency_key: randomUUID() });
      const occurrences = await planning.listOccurrences(f.user, f.schoolId, { from: "2037-03-10", until: "2037-03-10" });
      expect(occurrences.items[0]?.participants.map(row => row.person_id)).toEqual([first.id]);
      const periods = await f.people.groupMembershipHistory(f.user, f.schoolId, group.id, {});
      expect(periods.total).toBe(2);
      expect(periods.results).toEqual(expect.arrayContaining([expect.objectContaining({ person_id: first.id, ends_on: "2037-03-08" }), expect.objectContaining({ person_id: second.id, starts_on: "2037-03-09" })]));
      const edges = (await sql<{ person_id: string; ends_at: Date | null }>`SELECT p.domain_id AS person_id,r.effective_until AS ends_at
        FROM campus_model_relationships r JOIN campus_model_entities p ON p.id=r.source_entity_id JOIN campus_model_entities g ON g.id=r.target_entity_id
        WHERE r.school_id=${f.schoolId}::uuid AND r.relation_type='member_of' AND g.domain_id=${group.id}`.execute(db)).rows;
      expect(edges).toHaveLength(2); expect(edges.find(edge => edge.person_id === first.id)!.ends_at?.toISOString()).toBe("2037-03-09T04:00:00.000Z");
      expect(edges.find(edge => edge.person_id === second.id)!.ends_at).toBeNull();
      expect((await sql<{ count: string }>`SELECT count(*) AS count FROM campus_model_relationships r JOIN campus_model_entities g ON g.id=r.target_entity_id
        WHERE r.school_id=${f.schoolId}::uuid AND r.relation_type='member_of' AND g.domain_id=${parent.id} AND r.effective_until IS NULL`.execute(db)).rows[0]!.count).toBe("1");
    });
  });

  it("fails closed on wrong prepared hash/actor/owner/terminal scope and rolls back domain effects on projection failure", async () => {
    const f = await fixture();
    await f.run(async () => {
      const capture = vi.spyOn(f.core, "projectPeopleRelationships");
      const p = await f.person("Projection participant"), group = await f.group("Projection group", [p.id]);
      const exactProjection = capture.mock.calls[0]![1];
      capture.mockRestore();
      await f.people.replaceMembers(request(f.user), f.schoolId, group.id, { expected_revision: 1, effective_on: "2037-03-08", person_ids: [p.id], idempotency_key: randomUUID() });
      expect(await db.transaction().execute(tx => f.core.projectPeopleRelationships(tx, exactProjection))).toMatchObject({ replayed: true });
      await expect(db.transaction().execute(tx => f.core.projectPeopleRelationships(tx, { ...exactProjection, actor_user_id: randomUUID() }))).rejects.toThrow("Current acting");
      await expect(db.transaction().execute(tx => f.core.projectPeopleRelationships(tx, { ...exactProjection,
        edges: exactProjection.edges.map(edge => ({ ...edge, target: { ...edge.target, domain_id: randomUUID() } })) }))).rejects.toThrow("foreign");
      const retained = (await sql<{ command_id: string; request_hash: string }>`SELECT c.id AS command_id,c.request_hash FROM campus_model_commands c
        JOIN campus_model_entities target ON target.id=c.target_entity_id WHERE c.school_id=${f.schoolId}::uuid AND target.domain_id=${group.id} AND c.expected_revision=0`.execute(db)).rows[0]!;
      const input: PeopleRelationshipProjection = { school_id: f.schoolId, actor_user_id: f.user.id, command_id: retained.command_id,
        prepared_request_hash: retained.request_hash, subject: { kind: "participation_group", domain: "people", domain_id: group.id, label: group.name,
          lifecycle_state: "active", source_revision: 1, metadata: {} }, edges: [] };
      await expect(db.transaction().execute(tx => f.core.projectPeopleRelationships(tx, { ...input, prepared_request_hash: "0".repeat(64) }))).rejects.toThrow("prepared");
      await expect(db.transaction().execute(tx => f.core.projectPeopleRelationships(tx, { ...input, subject: { ...input.subject, domain_id: randomUUID() } }))).rejects.toThrow("prepared");
      await expect(db.transaction().execute(tx => f.core.projectPeopleRelationships(tx, input))).rejects.toThrow("different facts");
      const broken = new ParticipationPeopleService(db as DatabaseService, new SchoolEventService(db as DatabaseService, f.core), f.core, f.core, f.core,
        { projectPeopleRelationships: () => Promise.reject(new Error("Injected projection failure")) });
      const key = randomUUID();
      await expect(broken.createGroup(request(f.user), f.schoolId, { name: "Never committed", person_ids: [p.id], starts_on: "2037-03-07", idempotency_key: key })).rejects.toThrow("Injected");
      expect((await sql<{ count: string }>`SELECT count(*) AS count FROM participation_groups WHERE school_id=${f.schoolId}::uuid AND name='Never committed'`.execute(db)).rows[0]!.count).toBe("0");
      await f.people.createGroup(request(f.user), f.schoolId, { name: "Never committed", person_ids: [p.id], starts_on: "2037-03-07", idempotency_key: key });
      const identity = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.user.id, at: f.now }));
      if (!identity.acting) throw new Error("Founder required");
      await db.transaction().execute(tx => f.core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: identity.endpoint_id, actor_user_id: f.user.id,
        expected_revision: 1, effective_at: f.now, disposition: "revoked", reason: "Explicit access revocation", source_domain: "auth", source_record_id: randomUUID(),
        source_revision: 1, idempotency_key: randomUUID() }));
      await expect(f.people.createGroup(request(f.user), f.schoolId, { name: "Never committed", person_ids: [p.id], starts_on: "2037-03-07", idempotency_key: key })).rejects.toThrow("Current app access");
    });
  });

  it("does not downgrade a newer entity snapshot or change retained member edges when a command holds a stale person snapshot", async () => {
    const f = await fixture();
    await f.run(async () => {
      const person = await f.person("Old projection"), original = await f.group("Retained group", [person.id]);
      const prior = (await sql<{ id: string; source_revision: number; effective_from: Date; effective_until: Date | null }>`SELECT r.id,r.source_revision,r.effective_from,r.effective_until
        FROM campus_model_relationships r JOIN campus_model_entities g ON g.id=r.target_entity_id
        WHERE r.school_id=${f.schoolId}::uuid AND g.domain_id=${original.id} AND r.relation_type='member_of'`.execute(db)).rows;
      // Simulates a newer concurrent projection already committed after the
      // owning command read its authoritative person row.
      await sql`UPDATE campus_model_entities SET source_revision=2,label='Newer projection' WHERE school_id=${f.schoolId}::uuid AND domain='people' AND domain_id=${person.id}`.execute(db);
      const input = { name: "Stale snapshot group", person_ids: [person.id], starts_on: "2037-03-07", idempotency_key: randomUUID() };
      await expect(f.people.createGroup(request(f.user), f.schoolId, input)).rejects.toThrow("referenced person or group changed");
      expect((await sql<{ label: string; source_revision: number }>`SELECT label,source_revision FROM campus_model_entities
        WHERE school_id=${f.schoolId}::uuid AND domain='people' AND domain_id=${person.id}`.execute(db)).rows[0]).toEqual({ label: "Newer projection", source_revision: 2 });
      expect((await sql<{ count: string }>`SELECT count(*) AS count FROM participation_groups WHERE school_id=${f.schoolId}::uuid AND name=${input.name}`.execute(db)).rows[0]!.count).toBe("0");
      expect((await sql<{ id: string; source_revision: number; effective_from: Date; effective_until: Date | null }>`SELECT r.id,r.source_revision,r.effective_from,r.effective_until
        FROM campus_model_relationships r JOIN campus_model_entities g ON g.id=r.target_entity_id
        WHERE r.school_id=${f.schoolId}::uuid AND g.domain_id=${original.id} AND r.relation_type='member_of'`.execute(db)).rows).toEqual(prior);
      await sql`UPDATE school_people SET first_name='Newer projection',revision=2 WHERE school_id=${f.schoolId}::uuid AND id=${person.id}::uuid`.execute(db);
      expect(await f.people.createGroup(request(f.user), f.schoolId, input)).toMatchObject({ name: input.name });
    });
  });

  it.runIf(Boolean(targetUrl))("mutates captured contacts/mentoring/group hierarchy in one COW world, leaving Live and sibling facts unchanged", async () => {
    const f = await fixture();
    const facts = await f.run(async () => {
      const p = await f.person("Captured participant"), q = await f.person("Captured mentor");
      const groupBody = { name: "Captured A", person_ids: [p.id], starts_on: "2037-03-07", idempotency_key: randomUUID() };
      const a = await f.people.createGroup(request(f.user), f.schoolId, groupBody), b = await f.group("Captured B", [q.id]), c = await f.group("Captured C", [p.id]);
      await f.people.moveGroup(request(f.user), f.schoolId, a.id, { parent_group_id: b.id, effective_on: "2037-03-07", expected_revision: 1,
        reason: "Captured descriptive parent", idempotency_key: randomUUID() });
      return { p, q, a, b, c, groupBody };
    });
    const store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 4), opened: Kysely<Database>[] = [];
    try {
      const captured = await store.capture(f.schoolId, f.now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId,
          namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } });
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: f.now,
          source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: "people-connections-test", checked_at: f.now });
        return { ...services(database), database, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        expect(await branch.people.createGroup(request(f.user), f.schoolId, facts.groupBody)).toEqual(facts.a);
        await expect(f.people.createGroup(request(f.user), f.schoolId, facts.groupBody)).rejects.toThrow("selected execution data plane");
        await branch.people.correctProfile(request(f.user), f.schoolId, facts.p.id, { expected_revision: 1, contact_email: "branch@example.test", contact_phone: "",
          reason: "Selected-world contact correction", idempotency_key: randomUUID() });
        await branch.people.createConnection(request(f.user), f.schoolId, facts.q.id, { type: "mentor_of", target_person_id: facts.p.id, starts_on: "2037-03-07",
          ends_on: null, reason: "Selected-world mentoring", idempotency_key: randomUUID() });
        await branch.people.moveGroup(request(f.user), f.schoolId, facts.a.id, { parent_group_id: facts.c.id, effective_on: "2037-03-08", expected_revision: 2,
          reason: "Selected-world future group move", idempotency_key: randomUUID() });
        expect((await branch.people.connections(f.user, f.schoolId, facts.p.id, {})).total).toBe(1);
        expect((await branch.people.groupDetail(f.user, f.schoolId, facts.a.id, {})).parent_history).toHaveLength(2);
        await expect(db.transaction().execute(tx => branch.core.projectPeopleRelationships(tx, { school_id: f.schoolId, actor_user_id: f.user.id,
          command_id: randomUUID(), prepared_request_hash: "0".repeat(64), subject: { kind: "participation_group", domain: "people", domain_id: facts.a.id,
            label: facts.a.name, lifecycle_state: "active", source_revision: 3, metadata: {} }, edges: [] }))).rejects.toThrow("selected execution data plane");
      });
      for (const context of [f, sibling]) await context.run(async () => {
        expect((await context.people.detail(f.user, f.schoolId, facts.p.id)).profile.contact_email).toBe("");
        expect((await context.people.connections(f.user, f.schoolId, facts.p.id, {})).total).toBe(0);
        expect((await context.people.groupDetail(f.user, f.schoolId, facts.a.id, {})).parent_history).toHaveLength(1);
      });
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120000);
});
