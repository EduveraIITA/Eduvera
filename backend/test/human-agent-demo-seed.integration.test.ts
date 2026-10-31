import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { seedHumanAgentIdentitiesDemo } from "../src/database/seed-human-agent-identities.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const databaseUrl = requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

beforeAll(async () => {
  const version = (await pool.query<{ major: number }>(
    "SELECT current_setting('server_version_num')::int / 10000 AS major",
  )).rows[0]!.major;
  expect(version).toBeGreaterThanOrEqual(17);
});

afterAll(async () => {
  await pool.end();
});

describe("fresh demo human-agent identity convergence", () => {
  it("maps every explicitly linked active account exactly once and replays without drift", async () => {
    const schoolId = (await pool.query<{ id: string }>("SELECT id FROM schools WHERE code='cis'"))
      .rows[0]!.id;
    const first = await seedHumanAgentIdentitiesDemo(pool, { demoMode: true, environment: "test" });
    const converged = (await pool.query<{ agents: string[]; endpoints: string[] }>(`SELECT
      ARRAY(SELECT id::text FROM campus_model_agents
        WHERE school_id=$1 AND agent_kind='human' ORDER BY id) agents,
      ARRAY(SELECT id::text FROM campus_model_agent_endpoints
        WHERE school_id=$1 AND endpoint_kind='account' AND provider='thatcampus' ORDER BY id) endpoints`,
    [schoolId])).rows[0]!;
    const second = await seedHumanAgentIdentitiesDemo(pool, { demoMode: true, environment: "test" });
    expect(second).toEqual(first);

    const after = (await pool.query<{ agents: string[]; endpoints: string[] }>(`SELECT
      ARRAY(SELECT id::text FROM campus_model_agents
        WHERE school_id=$1 AND agent_kind='human' ORDER BY id) agents,
      ARRAY(SELECT id::text FROM campus_model_agent_endpoints
        WHERE school_id=$1 AND endpoint_kind='account' AND provider='thatcampus' ORDER BY id) endpoints`,
    [schoolId])).rows[0]!;
    expect(after).toEqual(converged);

    const violations = (await pool.query<{
      missing: string; duplicate_accounts: string; duplicate_people: string; mutable_contact_matches: string;
    }>(`WITH explicit_identity AS (
        SELECT student.school_id,student.user_id,student.person_id
        FROM students student WHERE student.school_id=$1 AND student.user_id IS NOT NULL
        UNION
        SELECT profile.school_id,parent.user_id,profile.person_id
        FROM guardian_school_profiles profile
        JOIN parents parent ON parent.id=profile.guardian_id
        WHERE profile.school_id=$1 AND parent.user_id IS NOT NULL
        UNION
        SELECT profile.school_id,profile.user_id,profile.person_id
        FROM staff_profiles profile WHERE profile.school_id=$1 AND profile.user_id IS NOT NULL
        UNION
        SELECT appointment.school_id,appointment.linked_user_id,appointment.person_id
        FROM institution_governance_appointments appointment
        WHERE appointment.school_id=$1 AND appointment.linked_user_id IS NOT NULL
      ), current_endpoints AS (
        SELECT endpoint.school_id,endpoint.user_id,endpoint.agent_id,agent.person_id
        FROM campus_model_agent_endpoints endpoint
        JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
        WHERE endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
          AND endpoint.status='active' AND endpoint.effective_until IS NULL
          AND agent.agent_kind='human' AND agent.status='active'
      ) SELECT
        (SELECT count(*)::text FROM explicit_identity identity
          JOIN school_memberships membership ON membership.school_id=identity.school_id
            AND membership.user_id=identity.user_id AND membership.is_active
          WHERE NOT EXISTS(SELECT 1 FROM current_endpoints endpoint
            WHERE endpoint.school_id=identity.school_id AND endpoint.user_id=identity.user_id
              AND endpoint.person_id=identity.person_id)) missing,
        (SELECT count(*)::text FROM (
          SELECT school_id,user_id FROM current_endpoints WHERE school_id=$1
          GROUP BY school_id,user_id HAVING count(*)<>1
        ) duplicate) duplicate_accounts,
        (SELECT count(*)::text FROM (
          SELECT school_id,person_id FROM campus_model_agents WHERE school_id=$1 AND agent_kind='human'
          GROUP BY school_id,person_id HAVING count(*)<>1
        ) duplicate) duplicate_people,
        (SELECT count(*)::text FROM campus_model_agent_endpoints endpoint
          JOIN users account ON account.id=endpoint.user_id
          JOIN school_people person ON person.school_id=endpoint.school_id
            AND lower(person.contact_email)=lower(account.email)
          JOIN campus_model_agents agent ON agent.id=endpoint.agent_id
          WHERE endpoint.school_id=$1 AND endpoint.endpoint_kind='account' AND person.id<>agent.person_id
            AND NOT EXISTS(SELECT 1 FROM explicit_identity identity
              WHERE identity.school_id=endpoint.school_id AND identity.user_id=endpoint.user_id
                AND identity.person_id=person.id)) mutable_contact_matches`, [schoolId])).rows[0]!;
    expect(violations).toEqual({
      missing: "0",
      duplicate_accounts: "0",
      duplicate_people: "0",
      mutable_contact_matches: "0",
    });
  });
});
