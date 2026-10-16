import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { postgresClientConnectionConfig } from "./connection-policy.js";
import { demoId } from "./seed-operations.js";

export interface StaffLeaveCoordinationDemoSeedOptions {
  demoMode: boolean;
  explicitOptIn: boolean;
  environment: string;
}

const allowedDemoEnvironments = new Set(["development", "local", "test"]);

export function assertStaffLeaveCoordinationDemoSeedAllowed(
  options: StaffLeaveCoordinationDemoSeedOptions,
) {
  if (!options.demoMode) {
    throw new Error("Staff-leave coordination demo seeding requires DEMO_MODE=true.");
  }
  if (!options.explicitOptIn) {
    throw new Error("Staff-leave coordination demo seeding requires SEED_STAFF_LEAVE_COORDINATION=true.");
  }
  const environment = options.environment.trim().toLowerCase();
  if (!allowedDemoEnvironments.has(environment)) {
    throw new Error("Staff-leave coordination demo seeding is limited to development, local or test environments.");
  }
}

function assertOneExactRow(rows: unknown[], description: string) {
  if (rows.length !== 1) {
    throw new Error(`The ${description} demo fixture is missing or differs from its approved configuration.`);
  }
}

/**
 * Installs one explicit Cambridge demo route. This is fixture data, not a model
 * runtime default: other institutions remain unconfigured and therefore fail
 * closed until an administrator approves their own route.
 */
export async function seedStaffLeaveCoordinationDemo(
  pool: Pool,
  options: StaffLeaveCoordinationDemoSeedOptions,
) {
  assertStaffLeaveCoordinationDemoSeedAllowed(options);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const schoolId = demoId("school-cis");
    const principalId = demoId("user-meera-principal");
    const localSourceId = demoId("governance-source-cis-management-scheme");
    const principalOfficeId = demoId("governance-office-principal");
    const principalAppointmentId = demoId("governance-appointment-principal");
    const scope = (await client.query(`SELECT school.id AS school_id,principal.id AS principal_id,
        person.id AS principal_person_id,person.revision AS principal_person_revision,
        office.id AS principal_office_id,appointment.id AS principal_appointment_id,
        appointment.revision AS principal_appointment_revision,source.id AS authority_source_id
      FROM schools school
      JOIN users principal ON principal.id=$2 AND principal.username='meera.principal' AND principal.is_active
      JOIN school_memberships membership ON membership.school_id=school.id
        AND membership.user_id=principal.id AND membership.role='admin' AND membership.is_active
      JOIN institution_authority_sources source ON source.school_id=school.id
        AND source.id=$3 AND source.code='cis_management_scheme'
        AND source.verification_state='verified' AND source.effective_from IS NOT NULL
        AND source.effective_from<=current_date
        AND (source.effective_until IS NULL OR source.effective_until>=current_date)
      JOIN institution_governance_offices office ON office.school_id=school.id
        AND office.id=$4 AND office.code='principal' AND office.status='active'
        AND office.authority_source_id=source.id
      JOIN institution_governance_appointments appointment ON appointment.school_id=school.id
        AND appointment.id=$5 AND appointment.office_id=office.id
        AND appointment.linked_user_id=principal.id AND appointment.status='active'
        AND appointment.starts_on<=current_date
        AND (appointment.ends_on IS NULL OR appointment.ends_on>=current_date)
        AND appointment.authority_source_id=source.id
      JOIN school_people person ON person.school_id=school.id AND person.id=appointment.person_id
      WHERE school.id=$1 AND school.code='cis'`, [
      schoolId,
      principalId,
      localSourceId,
      principalOfficeId,
      principalAppointmentId,
    ])).rows;
    assertOneExactRow(scope, "verified Principal authority");
    const fixture = scope[0] as {
      school_id: string;
      principal_id: string;
      principal_person_id: string;
      principal_person_revision: number;
      principal_office_id: string;
      principal_appointment_id: string;
      principal_appointment_revision: number;
      authority_source_id: string;
    };

    const effectiveOfficeholders = (await client.query(`SELECT appointment.id
      FROM institution_governance_appointments appointment
      WHERE appointment.school_id=$1 AND appointment.office_id=$2
        AND appointment.status='active' AND appointment.starts_on<=current_date
        AND (appointment.ends_on IS NULL OR appointment.ends_on>=current_date)
      ORDER BY appointment.id`, [
      fixture.school_id,
      fixture.principal_office_id,
    ])).rows;
    assertOneExactRow(effectiveOfficeholders, "sole effective Principal officeholder");
    if (String(effectiveOfficeholders[0]!.id) !== fixture.principal_appointment_id) {
      throw new Error("The effective Principal officeholder differs from the approved demo appointment.");
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `demo:staff-leave-coordination:${fixture.school_id}`,
    ]);

    const principalAgentId = demoId("campus-model-agent-meera-principal");
    await client.query(`INSERT INTO campus_model_agents(
        id,school_id,agent_kind,person_id,label,status,metadata
      ) VALUES($1,$2,'human',$3,'Meera Kapoor','active',$4::jsonb)
      ON CONFLICT DO NOTHING`, [
      principalAgentId,
      fixture.school_id,
      fixture.principal_person_id,
      JSON.stringify({ fixture: "cambridge_demo", identity_source: "governance_appointment" }),
    ]);
    const agents = (await client.query(`SELECT id FROM campus_model_agents
      WHERE school_id=$1 AND agent_kind='human' AND person_id=$2 AND status='active'`, [
      fixture.school_id,
      fixture.principal_person_id,
    ])).rows;
    assertOneExactRow(agents, "Principal human agent");
    const principalAgent = String(agents[0]!.id);

    const currentEndpoints = (await client.query(`SELECT endpoint.id,endpoint.agent_id
      FROM campus_model_agent_endpoints endpoint
      WHERE endpoint.school_id=$1 AND endpoint.endpoint_kind='account'
        AND endpoint.provider='thatcampus' AND endpoint.user_id=$2
        AND endpoint.effective_from<=current_timestamp
        AND (endpoint.effective_until IS NULL OR endpoint.effective_until>current_timestamp)`, [
      fixture.school_id,
      fixture.principal_id,
    ])).rows;
    if (currentEndpoints.length === 0) {
      await client.query(`INSERT INTO campus_model_agent_endpoints(
          id,school_id,agent_id,endpoint_kind,provider,user_id,status,effective_from,
          source_domain,source_record_id,source_revision,linked_by_user_id,metadata
        ) VALUES($1,$2,$3,'account','thatcampus',$4,'active',current_timestamp,
          'governance',$5,$6,$4,$7::jsonb)`, [
        demoId("campus-model-endpoint-meera-principal"),
        fixture.school_id,
        principalAgent,
        fixture.principal_id,
        fixture.principal_appointment_id,
        fixture.principal_appointment_revision,
        JSON.stringify({ fixture: "cambridge_demo", identity_source: "governance_appointment" }),
      ]);
    }
    const endpoints = (await client.query(`SELECT endpoint.id
      FROM campus_model_agent_endpoints endpoint
      JOIN campus_model_agents agent ON agent.id=endpoint.agent_id AND agent.school_id=endpoint.school_id
      WHERE endpoint.school_id=$1 AND endpoint.endpoint_kind='account'
        AND endpoint.provider='thatcampus' AND endpoint.user_id=$2 AND endpoint.agent_id=$3
        AND endpoint.status='active' AND endpoint.effective_from<=current_timestamp
        AND (endpoint.effective_until IS NULL OR endpoint.effective_until>current_timestamp)
        AND agent.agent_kind='human' AND agent.person_id=$4 AND agent.status='active'`, [
      fixture.school_id,
      fixture.principal_id,
      principalAgent,
      fixture.principal_person_id,
    ])).rows;
    assertOneExactRow(endpoints, "Principal account endpoint");

    const decisionRuleId = demoId("governance-rule-staff-leave-decision");
    await client.query(`INSERT INTO institution_decision_matter_rules(
        id,school_id,code,title,category,initiation_summary,review_summary,decision_summary,
        execution_summary,decision_mode,decision_office_id,decision_body_id,standing_mandate_id,
        authority_source_ids,conditions_summary,material_fields,status,effective_from,created_by
      ) VALUES(
        $1,$2,'staff_leave_decision','Staff leave decision','people',
        'A staff member submits a dated leave request through Staff operations.',
        'The configured Principal reviews the request, current staffing context and supporting evidence.',
        'The current Principal officeholder decides this demo request as one identified individual.',
        'Staff operations records the decision and emits the correlated outcome before coverage planning continues.',
        'individual',$3,null,null,ARRAY[$4]::uuid[],
        'The office, appointment, linked account and authority source must all remain current.',
        ARRAY['staff_profile','leave_type','starts_on','ends_on','reason','supporting_document']::text[],
        'confirmed','2026-04-01',$5
      ) ON CONFLICT DO NOTHING`, [
      decisionRuleId,
      fixture.school_id,
      fixture.principal_office_id,
      fixture.authority_source_id,
      fixture.principal_id,
    ]);
    const rules = (await client.query(`SELECT id FROM institution_decision_matter_rules
      WHERE id=$1 AND school_id=$2 AND code='staff_leave_decision'
        AND title='Staff leave decision' AND category='people'
        AND initiation_summary='A staff member submits a dated leave request through Staff operations.'
        AND review_summary='The configured Principal reviews the request, current staffing context and supporting evidence.'
        AND decision_summary='The current Principal officeholder decides this demo request as one identified individual.'
        AND execution_summary='Staff operations records the decision and emits the correlated outcome before coverage planning continues.'
        AND decision_mode='individual' AND decision_office_id=$3
        AND decision_body_id IS NULL AND standing_mandate_id IS NULL
        AND authority_source_ids=ARRAY[$4]::uuid[] AND status='confirmed'
        AND conditions_summary='The office, appointment, linked account and authority source must all remain current.'
        AND material_fields=ARRAY['staff_profile','leave_type','starts_on','ends_on','reason','supporting_document']::text[]
        AND effective_from='2026-04-01'::date AND effective_until IS NULL
        AND created_by=$5`, [
      decisionRuleId,
      fixture.school_id,
      fixture.principal_office_id,
      fixture.authority_source_id,
      fixture.principal_id,
    ])).rows;
    assertOneExactRow(rules, "staff-leave decision rule");

    const authorityId = demoId("campus-model-authority-staff-leave-principal");
    const authorityConstraints = {
      fixture: "cambridge_demo",
      decision_mode: "individual",
      decision_matter: "staff_leave_decision",
      decision_office_id: fixture.principal_office_id,
      decision_rule_id: decisionRuleId,
    };
    await client.query(`INSERT INTO campus_model_agent_authorities(
        id,school_id,agent_id,capability,scope_entity_id,effective_from,effective_until,
        grant_source,grant_reference_id,approved_by,operating_rule_version_ref,constraints
      ) VALUES($1,$2,$3,'staff_leave:decide',null,'2026-04-01T00:00:00Z',null,
        'governance_decision_rule',$4,$5,'staff_leave_decision:1',$6::jsonb)
      ON CONFLICT DO NOTHING`, [
      authorityId,
      fixture.school_id,
      principalAgent,
      decisionRuleId,
      fixture.principal_id,
      JSON.stringify(authorityConstraints),
    ]);
    const authorities = (await client.query(`SELECT id FROM campus_model_agent_authorities
      WHERE id=$1 AND school_id=$2 AND agent_id=$3 AND capability='staff_leave:decide'
        AND scope_entity_id IS NULL AND effective_from='2026-04-01T00:00:00Z'::timestamptz
        AND effective_until IS NULL AND grant_source='governance_decision_rule'
        AND grant_reference_id=$4 AND approved_by=$5 AND operating_rule_version_ref='staff_leave_decision:1'
        AND constraints=$6::jsonb AND revoked_at IS NULL AND revoked_by IS NULL`, [
      authorityId,
      fixture.school_id,
      principalAgent,
      decisionRuleId,
      fixture.principal_id,
      JSON.stringify(authorityConstraints),
    ])).rows;
    assertOneExactRow(authorities, "Principal staff-leave capability grant");

    const behaviourVersionId = demoId("campus-model-behaviour-staff-leave-decision-v1");
    const behaviourConfiguration = {
      fixture: "cambridge_demo",
      matter_code: "staff_leave_decision",
      selector_key: "leave_decision_owner",
      authority_recheck: "on_publish_and_response",
      missing_configuration: "coordination_exception",
      purpose: "Route one submitted staff leave request to its current configured decision owner.",
    };
    await client.query(`INSERT INTO campus_model_behaviour_versions(
        id,school_id,behaviour_key,version,status,effective_from,effective_until,
        configuration,configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at
      ) VALUES($1,$2,'staff_leave_decision_routing',1,'approved','2026-04-01T00:00:00Z',null,
        $3::jsonb,1,$4,$4,'2026-04-01T00:00:00Z') ON CONFLICT DO NOTHING`, [
      behaviourVersionId,
      fixture.school_id,
      JSON.stringify(behaviourConfiguration),
      principalAgent,
    ]);
    const behaviours = (await client.query(`SELECT id FROM campus_model_behaviour_versions
      WHERE id=$1 AND school_id=$2 AND behaviour_key='staff_leave_decision_routing'
        AND version=1 AND status='approved' AND effective_from='2026-04-01T00:00:00Z'::timestamptz
        AND effective_until IS NULL AND configuration=$3::jsonb AND configuration_schema_version=1
        AND created_by_agent_id=$4 AND approved_by_agent_id=$4
        AND approved_at='2026-04-01T00:00:00Z'::timestamptz AND retired_at IS NULL`, [
      behaviourVersionId,
      fixture.school_id,
      JSON.stringify(behaviourConfiguration),
      principalAgent,
    ])).rows;
    assertOneExactRow(behaviours, "approved staff-leave behaviour version");

    const subscriptionId = demoId("campus-model-subscription-staff-leave-submitted-v1");
    const recipientSelector = {
      mode: "explicit_authorized_agents",
      selector_key: "leave_decision_owner",
      required_capability: "staff_leave:decide",
      scope_mode: "institution",
      min_recipients: 1,
      max_recipients: 1,
    };
    await client.query(`INSERT INTO campus_model_event_subscriptions(
        id,school_id,behaviour_version_id,subscription_key,source_domain,event_type,reaction_kind,
        message_kind,message_schema_version,recipient_selector,response_due_after_seconds,
        expires_after_seconds,max_attempts,retry_after_seconds,priority
      ) VALUES($1,$2,$3,'staff_leave_submitted_to_decision_owner','staff_operations','staff.leave_submitted',
        'staff_leave_decision_review','request',1,$4::jsonb,172800,604800,3,3600,7)
      ON CONFLICT DO NOTHING`, [
      subscriptionId,
      fixture.school_id,
      behaviourVersionId,
      JSON.stringify(recipientSelector),
    ]);
    const subscriptions = (await client.query(`SELECT id FROM campus_model_event_subscriptions
      WHERE id=$1 AND school_id=$2 AND behaviour_version_id=$3
        AND subscription_key='staff_leave_submitted_to_decision_owner'
        AND source_domain='staff_operations' AND event_type='staff.leave_submitted'
        AND reaction_kind='staff_leave_decision_review' AND message_kind='request'
        AND message_schema_version=1 AND recipient_selector=$4::jsonb
        AND response_due_after_seconds=172800 AND expires_after_seconds=604800
        AND max_attempts=3 AND retry_after_seconds=3600 AND priority=7`, [
      subscriptionId,
      fixture.school_id,
      behaviourVersionId,
      JSON.stringify(recipientSelector),
    ])).rows;
    assertOneExactRow(subscriptions, "staff-leave event subscription");

    const activeMatches = (await client.query(`SELECT subscription.id
      FROM campus_model_behaviour_versions behaviour
      JOIN campus_model_event_subscriptions subscription
        ON subscription.school_id=behaviour.school_id
        AND subscription.behaviour_version_id=behaviour.id
      WHERE behaviour.school_id=$1 AND behaviour.status='approved'
        AND behaviour.effective_from<=current_timestamp
        AND (behaviour.effective_until IS NULL OR behaviour.effective_until>current_timestamp)
        AND subscription.source_domain='staff_operations'
        AND subscription.event_type='staff.leave_submitted'
        AND subscription.recipient_selector->>'selector_key'='leave_decision_owner'
        AND subscription.id=$2`, [fixture.school_id, subscriptionId])).rows;
    assertOneExactRow(activeMatches, "sole active staff-leave route");

    const overlappingMatches = (await client.query(`SELECT count(*)::int AS count
      FROM campus_model_behaviour_versions behaviour
      JOIN campus_model_event_subscriptions subscription
        ON subscription.school_id=behaviour.school_id
        AND subscription.behaviour_version_id=behaviour.id
      WHERE behaviour.school_id=$1 AND behaviour.status='approved'
        AND behaviour.effective_from<=current_timestamp
        AND (behaviour.effective_until IS NULL OR behaviour.effective_until>current_timestamp)
        AND subscription.source_domain='staff_operations'
        AND subscription.event_type='staff.leave_submitted'
        AND subscription.recipient_selector->>'selector_key'='leave_decision_owner'`, [
      fixture.school_id,
    ])).rows;
    if (overlappingMatches[0]?.count !== 1) {
      throw new Error("The staff-leave route overlaps another approved demo behaviour.");
    }

    await client.query("COMMIT");
    return {
      school_id: fixture.school_id,
      decision_rule_id: decisionRuleId,
      principal_agent_id: principalAgent,
      authority_id: authorityId,
      behaviour_version_id: behaviourVersionId,
      subscription_id: subscriptionId,
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
    explicitOptIn: process.env.SEED_STAFF_LEAVE_COORDINATION === "true",
    environment,
  };
  assertStaffLeaveCoordinationDemoSeedAllowed(options);
  const connection = postgresClientConnectionConfig(process.env.DATABASE_URL, {
    name: "DATABASE_URL",
    purpose: "migrations",
    requireRemoteTls: environment === "stage" || environment === "production",
  });
  const pool = new Pool({ ...connection, max: 1, application_name: "thatcampus_staff_leave_coordination_demo" });
  try {
    process.stdout.write(`Staff-leave coordination demo seed: ${JSON.stringify(
      await seedStaffLeaveCoordinationDemo(pool, options),
    )}\n`);
  } finally {
    await pool.end();
  }
}
