import { Pool } from "pg";
import { postgresClientConnectionConfig } from "./connection-policy.js";

export interface HumanAgentIdentityDemoSeedOptions {
  demoMode: boolean;
  environment: string;
}

const allowedDemoEnvironments = new Set(["development", "local", "test"]);

export function assertHumanAgentIdentityDemoSeedAllowed(options: HumanAgentIdentityDemoSeedOptions) {
  if (!options.demoMode) throw new Error("Human-agent identity demo seeding requires DEMO_MODE=true.");
  if (!allowedDemoEnvironments.has(options.environment.trim().toLowerCase())) {
    throw new Error("Human-agent identity demo seeding is limited to development, local or test environments.");
  }
}

/**
 * Reconciles the synthetic school's direct SQL fixture with the same identity
 * invariant used by the runtime: one institution person -> one stable human
 * agent -> one current ThatCampus account endpoint. It never matches on mutable
 * contact details and never merges identities across institutions.
 */
export async function seedHumanAgentIdentitiesDemo(
  pool: Pool,
  options: HumanAgentIdentityDemoSeedOptions,
) {
  assertHumanAgentIdentityDemoSeedAllowed(options);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('demo:human-agent-identities'))");
    const targetSchools = (await client.query<{ id: string }>(`SELECT school.id
      FROM schools school
      JOIN users principal ON principal.username='meera.principal'
        AND principal.email='meera.kapoor@example.test' AND principal.is_active
      JOIN school_memberships membership ON membership.school_id=school.id
        AND membership.user_id=principal.id AND membership.role='admin' AND membership.is_active
      WHERE school.code='cis'`)).rows;
    if (targetSchools.length !== 1) throw new Error("The Cambridge demo institution is missing or ambiguous.");
    const targetSchoolId = targetSchools[0]!.id;

    await client.query(`CREATE TEMP TABLE demo_human_identity_map(
      school_id uuid NOT NULL,
      user_id uuid NOT NULL,
      person_id uuid NOT NULL,
      source_kind text NOT NULL,
      PRIMARY KEY(school_id,user_id,person_id,source_kind)
    ) ON COMMIT DROP`);
    await client.query(`INSERT INTO demo_human_identity_map(school_id,user_id,person_id,source_kind)
      SELECT student.school_id,student.user_id,student.person_id,'student_profile'
      FROM students student WHERE student.school_id=$1 AND student.user_id IS NOT NULL
      UNION ALL
      SELECT profile.school_id,parent.user_id,profile.person_id,'guardian_profile'
      FROM guardian_school_profiles profile
      JOIN parents parent ON parent.id=profile.guardian_id
      WHERE profile.school_id=$1 AND parent.user_id IS NOT NULL
      UNION ALL
      SELECT profile.school_id,profile.user_id,profile.person_id,'staff_profile'
      FROM staff_profiles profile WHERE profile.school_id=$1 AND profile.user_id IS NOT NULL
      UNION ALL
      SELECT DISTINCT appointment.school_id,appointment.linked_user_id,appointment.person_id,'governance_appointment'
      FROM institution_governance_appointments appointment
      WHERE appointment.school_id=$1 AND appointment.linked_user_id IS NOT NULL
      UNION ALL
      SELECT endpoint.school_id,endpoint.user_id,agent.person_id,'existing_account_endpoint'
      FROM campus_model_agent_endpoints endpoint
      JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
      WHERE endpoint.school_id=$1 AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
        AND endpoint.user_id IS NOT NULL AND endpoint.status='active'
        AND endpoint.effective_until IS NULL AND agent.agent_kind='human'
        AND agent.person_id IS NOT NULL`, [targetSchoolId]);

    const ambiguous = (await client.query(`SELECT school_id,user_id
      FROM demo_human_identity_map GROUP BY school_id,user_id
      HAVING count(DISTINCT person_id)>1 LIMIT 1`)).rows[0];
    if (ambiguous) {
      throw new Error("A demo campus account is linked to more than one person; identity reconciliation stopped.");
    }

    // An administrator can exist before a domain profile or governance appointment.
    // Create a person only for that exact active membership/account pair.
    const missing = (await client.query<{
      school_id: string; user_id: string; first_name: string; last_name: string; email: string;
    }>(`SELECT membership.school_id,membership.user_id,account.first_name,account.last_name,account.email
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=$1 AND membership.is_active AND membership.role='admin'
        AND NOT EXISTS(SELECT 1 FROM demo_human_identity_map mapped
          WHERE mapped.school_id=membership.school_id AND mapped.user_id=membership.user_id)
      ORDER BY membership.school_id,membership.user_id`, [targetSchoolId])).rows;
    for (const account of missing) {
      const person = (await client.query<{ id: string }>(`INSERT INTO school_people(
          school_id,first_name,last_name,contact_email
        ) VALUES($1,$2,$3,$4) RETURNING id`, [
        account.school_id, account.first_name, account.last_name, account.email,
      ])).rows[0]!;
      await client.query(`INSERT INTO demo_human_identity_map(school_id,user_id,person_id,source_kind)
        VALUES($1,$2,$3,'membership_account')`, [account.school_id, account.user_id, person.id]);
    }

    await client.query(`INSERT INTO campus_model_agents(
        school_id,agent_kind,person_id,label,status,metadata
      ) SELECT mapped.school_id,'human',mapped.person_id,
          COALESCE(NULLIF(trim(concat_ws(' ',account.first_name,account.last_name)),''),account.username),
          'active',jsonb_build_object('fixture','cambridge_demo','identity_source','explicit_account_link')
        FROM (
          SELECT school_id,user_id,min(person_id::text)::uuid person_id
          FROM demo_human_identity_map GROUP BY school_id,user_id
        ) mapped
        JOIN users account ON account.id=mapped.user_id AND account.is_active
        JOIN school_memberships membership ON membership.school_id=mapped.school_id
          AND membership.user_id=mapped.user_id AND membership.is_active
      ON CONFLICT(school_id,person_id) WHERE agent_kind='human' DO UPDATE SET
        label=EXCLUDED.label,
        status=CASE WHEN campus_model_agents.status='revoked' THEN 'revoked' ELSE 'active' END,
        revision=CASE WHEN campus_model_agents.label IS DISTINCT FROM EXCLUDED.label
          OR campus_model_agents.status IS DISTINCT FROM
            CASE WHEN campus_model_agents.status='revoked' THEN 'revoked' ELSE 'active' END
          THEN campus_model_agents.revision+1 ELSE campus_model_agents.revision END,
        updated_at=now()`);

    await client.query(`WITH eligible AS (
        SELECT DISTINCT ON (membership.school_id,membership.user_id)
          membership.school_id,membership.user_id,membership.id membership_id,
          membership.role,membership.created_at,mapped.person_id
        FROM school_memberships membership
        JOIN users account ON account.id=membership.user_id AND account.is_active
        JOIN (
          SELECT school_id,user_id,min(person_id::text)::uuid person_id
          FROM demo_human_identity_map GROUP BY school_id,user_id
        ) mapped ON mapped.school_id=membership.school_id AND mapped.user_id=membership.user_id
        WHERE membership.is_active
        ORDER BY membership.school_id,membership.user_id,
          CASE membership.role WHEN 'admin' THEN 1 WHEN 'staff' THEN 2
            WHEN 'guardian' THEN 3 ELSE 4 END,
          membership.created_at,membership.id
      ) INSERT INTO campus_model_agent_endpoints(
        school_id,agent_id,endpoint_kind,provider,user_id,status,effective_from,
        source_domain,source_record_id,source_revision,linked_by_user_id,metadata
      ) SELECT eligible.school_id,agent.id,'account','thatcampus',eligible.user_id,'active',
          eligible.created_at,'demo_identity',eligible.membership_id::text,1,
          administrator.user_id,jsonb_build_object('fixture','cambridge_demo','membership_role',eligible.role)
        FROM eligible
        JOIN campus_model_agents agent ON agent.school_id=eligible.school_id
          AND agent.agent_kind='human' AND agent.person_id=eligible.person_id AND agent.status='active'
        JOIN LATERAL (
          SELECT admin.user_id FROM school_memberships admin
          JOIN users admin_account ON admin_account.id=admin.user_id AND admin_account.is_active
          WHERE admin.school_id=eligible.school_id AND admin.role='admin' AND admin.is_active
          ORDER BY admin.created_at,admin.id LIMIT 1
        ) administrator ON true
        WHERE NOT EXISTS(
          SELECT 1 FROM campus_model_agent_endpoints current_endpoint
          WHERE current_endpoint.school_id=eligible.school_id
            AND current_endpoint.endpoint_kind='account'
            AND current_endpoint.provider='thatcampus'
            AND current_endpoint.user_id=eligible.user_id
            AND current_endpoint.status='active'
            AND current_endpoint.effective_until IS NULL
        )
      ON CONFLICT(school_id,source_domain,source_record_id,source_revision) DO NOTHING`);

    const unresolved = (await client.query<{ count: string }>(`SELECT count(*)::text count
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.is_active
        AND EXISTS(SELECT 1 FROM demo_human_identity_map mapped
          WHERE mapped.school_id=membership.school_id AND mapped.user_id=membership.user_id)
        AND NOT EXISTS(SELECT 1 FROM campus_model_agent_endpoints endpoint
          JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
          WHERE endpoint.school_id=membership.school_id AND endpoint.user_id=membership.user_id
            AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
            AND endpoint.status='active' AND endpoint.effective_until IS NULL
            AND agent.agent_kind='human' AND agent.status='active')`)).rows[0]!.count;
    if (Number(unresolved) !== 0) throw new Error("Some explicitly linked demo accounts lack an active human-agent endpoint.");

    const result = (await client.query<{ agents: string; endpoints: string }>(`SELECT
      (SELECT count(*)::text FROM campus_model_agents
        WHERE school_id=$1 AND agent_kind='human' AND status='active') agents,
      (SELECT count(*)::text FROM campus_model_agent_endpoints
        WHERE school_id=$1 AND endpoint_kind='account' AND provider='thatcampus' AND status='active'
          AND effective_until IS NULL) endpoints`, [targetSchoolId])).rows[0]!;
    await client.query("COMMIT");
    return { agents: Number(result.agents), endpoints: Number(result.endpoints) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const options = {
    demoMode: process.env.DEMO_MODE === "true",
    environment: process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  };
  const pool = new Pool({
    ...postgresClientConnectionConfig(url, {
      name: "DATABASE_URL",
      purpose: "migrations",
      requireRemoteTls: options.environment === "stage" || options.environment === "production",
    }),
    max: 1,
  });
  try {
    process.stdout.write(`${JSON.stringify(await seedHumanAgentIdentitiesDemo(pool, options))}\n`);
  } finally {
    await pool.end();
  }
}
