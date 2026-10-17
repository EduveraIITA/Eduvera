import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { postgresClientConnectionConfig } from "./connection-policy.js";
import { demoId } from "./seed-operations.js";

export interface AttendanceCompletionCoordinationDemoSeedOptions {
  demoMode: boolean;
  explicitOptIn: boolean;
  environment: string;
}

const allowedDemoEnvironments = new Set(["development", "local", "test"]);

export function assertAttendanceCompletionCoordinationDemoSeedAllowed(
  options: AttendanceCompletionCoordinationDemoSeedOptions,
) {
  if (!options.demoMode) throw new Error("Attendance-completion coordination demo seeding requires DEMO_MODE=true.");
  if (!options.explicitOptIn) throw new Error("Attendance-completion coordination demo seeding requires SEED_ATTENDANCE_COMPLETION_COORDINATION=true.");
  if (!allowedDemoEnvironments.has(options.environment.trim().toLowerCase())) {
    throw new Error("Attendance-completion coordination demo seeding is limited to development, local or test environments.");
  }
}

function assertOne(rows: unknown[], description: string) {
  if (rows.length !== 1) throw new Error(`The ${description} demo fixture is missing, ambiguous or differs from its approved configuration.`);
}

/** Installs explicit Cambridge demo behaviour; it is never a runtime default. */
export async function seedAttendanceCompletionCoordinationDemo(
  pool: Pool,
  options: AttendanceCompletionCoordinationDemoSeedOptions,
) {
  assertAttendanceCompletionCoordinationDemoSeedAllowed(options);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const schoolId = demoId("school-cis");
    const administratorId = demoId("user-meera-principal");
    const scope = (await client.query<{
      school_id: string;
      administrator_id: string;
      administrator_agent_id: string;
    }>(`SELECT school.id AS school_id,administrator.id AS administrator_id,
        administrator_agent.id AS administrator_agent_id
      FROM schools school
      JOIN users administrator ON administrator.id=$2 AND administrator.username='meera.principal'
        AND administrator.email='meera.kapoor@example.test' AND administrator.is_active
      JOIN school_memberships membership ON membership.school_id=school.id
        AND membership.user_id=administrator.id AND membership.role='admin' AND membership.is_active
      JOIN campus_model_agent_endpoints administrator_endpoint
        ON administrator_endpoint.school_id=school.id
        AND administrator_endpoint.endpoint_kind='account'
        AND administrator_endpoint.provider='thatcampus'
        AND administrator_endpoint.user_id=administrator.id
        AND administrator_endpoint.status='active'
        AND administrator_endpoint.effective_from<=current_timestamp
        AND (administrator_endpoint.effective_until IS NULL
          OR administrator_endpoint.effective_until>current_timestamp)
      JOIN campus_model_agents administrator_agent
        ON administrator_agent.school_id=school.id
        AND administrator_agent.id=administrator_endpoint.agent_id
        AND administrator_agent.agent_kind='human' AND administrator_agent.status='active'
      WHERE school.id=$1 AND school.code='cis'`, [schoolId, administratorId])).rows;
    assertOne(scope, "Cambridge attendance-completion administrator identity");
    const fixture = scope[0]!;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `demo:attendance-completion-coordination:${fixture.school_id}`,
    ]);

    const eligible = (await client.query<{ agent_id: string; user_id: string }>(`SELECT DISTINCT
        agent.id AS agent_id,endpoint.user_id
      FROM campus_model_agents agent
      JOIN campus_model_agent_endpoints endpoint ON endpoint.school_id=agent.school_id
        AND endpoint.agent_id=agent.id AND endpoint.endpoint_kind='account'
        AND endpoint.provider='thatcampus' AND endpoint.status='active'
        AND endpoint.effective_from<=current_timestamp
        AND (endpoint.effective_until IS NULL OR endpoint.effective_until>current_timestamp)
      JOIN users account ON account.id=endpoint.user_id AND account.is_active
      JOIN school_memberships membership ON membership.school_id=agent.school_id
        AND membership.user_id=account.id AND membership.is_active AND membership.role='staff'
      WHERE agent.school_id=$1 AND agent.agent_kind='human' AND agent.status='active'
      ORDER BY endpoint.user_id`, [fixture.school_id])).rows;
    if (eligible.length === 0) throw new Error("The Cambridge attendance demo needs at least one explicitly linked active staff agent.");

    const behaviourId = demoId("campus-model-behaviour-attendance-completion-v1");
    for (const item of eligible) {
      const authorityId = demoId(`campus-model-authority-attendance-completion-${item.user_id}`);
      const constraints = {
        fixture: "cambridge_demo",
        purpose: "complete_owned_attendance_register",
        user_id: item.user_id,
      };
      await client.query(`INSERT INTO campus_model_agent_authorities(
          id,school_id,agent_id,capability,scope_entity_id,effective_from,
          grant_source,grant_reference_id,approved_by,operating_rule_version_ref,constraints
        ) VALUES($1,$2,$3,'attendance_completion:complete',null,'2026-04-01T00:00:00Z',
          'attendance_operating_rule',$4,$5,'attendance_completion:1',$6::jsonb)
        ON CONFLICT DO NOTHING`, [
        authorityId, fixture.school_id, item.agent_id, behaviourId,
        fixture.administrator_id, JSON.stringify(constraints),
      ]);
      assertOne((await client.query(`SELECT id FROM campus_model_agent_authorities
        WHERE id=$1 AND school_id=$2 AND agent_id=$3
          AND capability='attendance_completion:complete' AND scope_entity_id IS NULL
          AND effective_from='2026-04-01T00:00:00Z'::timestamptz AND effective_until IS NULL
          AND grant_source='attendance_operating_rule' AND grant_reference_id=$4
          AND approved_by=$5 AND operating_rule_version_ref='attendance_completion:1'
          AND constraints=$6::jsonb AND revoked_at IS NULL`, [
        authorityId, fixture.school_id, item.agent_id, behaviourId,
        fixture.administrator_id, JSON.stringify(constraints),
      ])).rows, `attendance-completion authority for ${item.user_id}`);
    }

    const configuration = {
      workflow: "attendance_completion",
      owner_strategy: "effective_responsible_teacher",
      timing_source: "institution_operating_rules",
      escalation_projection: "administration_requests_queue",
      completion_source: "authoritative_attendance_register_state",
    };
    await client.query(`INSERT INTO campus_model_behaviour_versions(
        id,school_id,behaviour_key,version,status,effective_from,configuration,
        configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at
      ) VALUES($1,$2,'attendance_completion_routing',1,'approved','2026-04-01T00:00:00Z',
        $3::jsonb,1,$4,$4,'2026-04-01T00:00:00Z')
      ON CONFLICT DO NOTHING`, [
      behaviourId, fixture.school_id, JSON.stringify(configuration), fixture.administrator_agent_id,
    ]);
    assertOne((await client.query(`SELECT id FROM campus_model_behaviour_versions
      WHERE id=$1 AND school_id=$2 AND behaviour_key='attendance_completion_routing'
        AND version=1 AND status='approved' AND effective_from='2026-04-01T00:00:00Z'::timestamptz
        AND effective_until IS NULL AND configuration=$3::jsonb
        AND configuration_schema_version=1 AND created_by_agent_id=$4
        AND approved_by_agent_id=$4 AND approved_at='2026-04-01T00:00:00Z'::timestamptz`, [
      behaviourId, fixture.school_id, JSON.stringify(configuration), fixture.administrator_agent_id,
    ])).rows, "attendance-completion behaviour");

    const selector = {
      mode: "explicit_authorized_agents",
      selector_key: "attendance_register_owner",
      required_capability: "attendance_completion:complete",
      scope_mode: "institution",
      min_recipients: 1,
      max_recipients: 1,
    };
    const subscriptions = [
      {
        id: demoId("campus-model-subscription-daily-attendance-overdue-v1"),
        key: "daily_attendance_register_overdue",
        eventType: "attendance.register.overdue",
      },
      {
        id: demoId("campus-model-subscription-session-attendance-overdue-v1"),
        key: "subject_attendance_register_overdue",
        eventType: "attendance.session.overdue",
      },
    ] as const;
    for (const subscription of subscriptions) {
      await client.query(`INSERT INTO campus_model_event_subscriptions(
          id,school_id,behaviour_version_id,subscription_key,source_domain,event_type,
          reaction_kind,message_kind,message_schema_version,recipient_selector,
          response_due_after_seconds,expires_after_seconds,max_attempts,retry_after_seconds,priority
        ) VALUES($1,$2,$3,$4,'attendance',$5,'attendance_completion_task','task',1,
          $6::jsonb,null,null,3,300,6)
        ON CONFLICT DO NOTHING`, [
        subscription.id, fixture.school_id, behaviourId, subscription.key,
        subscription.eventType, JSON.stringify(selector),
      ]);
      assertOne((await client.query(`SELECT id FROM campus_model_event_subscriptions
        WHERE id=$1 AND school_id=$2 AND behaviour_version_id=$3 AND subscription_key=$4
          AND source_domain='attendance' AND event_type=$5
          AND reaction_kind='attendance_completion_task' AND message_kind='task'
          AND message_schema_version=1 AND recipient_selector=$6::jsonb
          AND response_due_after_seconds IS NULL AND expires_after_seconds IS NULL
          AND max_attempts=3 AND retry_after_seconds=300 AND priority=6`, [
        subscription.id, fixture.school_id, behaviourId, subscription.key,
        subscription.eventType, JSON.stringify(selector),
      ])).rows, `${subscription.key} subscription`);
    }

    await client.query("COMMIT");
    return {
      school_id: fixture.school_id,
      eligible_recipient_agents: eligible.length,
      behaviour_version_id: behaviourId,
      subscription_ids: subscriptions.map((item) => item.id),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const environment = process.env.DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
  const options = {
    demoMode: process.env.DEMO_MODE === "true",
    explicitOptIn: process.env.SEED_ATTENDANCE_COMPLETION_COORDINATION === "true",
    environment,
  };
  assertAttendanceCompletionCoordinationDemoSeedAllowed(options);
  const connection = postgresClientConnectionConfig(process.env.DATABASE_URL, {
    name: "DATABASE_URL",
    purpose: "migrations",
    requireRemoteTls: environment === "stage" || environment === "production",
  });
  const pool = new Pool({ ...connection, max: 1, application_name: "thatcampus_attendance_completion_coordination_demo" });
  try {
    process.stdout.write(`Attendance-completion coordination demo seed: ${JSON.stringify(await seedAttendanceCompletionCoordinationDemo(pool, options))}\n`);
  } finally {
    await pool.end();
  }
}
