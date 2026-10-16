import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { postgresClientConnectionConfig } from "./connection-policy.js";
import { demoId } from "./seed-operations.js";

export interface TransportDutyCoordinationDemoSeedOptions {
  demoMode:boolean;
  explicitOptIn:boolean;
  environment:string;
}

const allowedDemoEnvironments=new Set(["development","local","test"]);

export function assertTransportDutyCoordinationDemoSeedAllowed(options:TransportDutyCoordinationDemoSeedOptions) {
  if(!options.demoMode)throw new Error("Transport-duty coordination demo seeding requires DEMO_MODE=true.");
  if(!options.explicitOptIn)throw new Error("Transport-duty coordination demo seeding requires SEED_TRANSPORT_DUTY_COORDINATION=true.");
  if(!allowedDemoEnvironments.has(options.environment.trim().toLowerCase())) {
    throw new Error("Transport-duty coordination demo seeding is limited to development, local or test environments.");
  }
}

function assertOne(rows:unknown[],description:string) {
  if(rows.length!==1)throw new Error(`The ${description} demo fixture is missing or ambiguous.`);
}

/** Installs explicit demo configuration; it is never a runtime default. */
export async function seedTransportDutyCoordinationDemo(
  pool:Pool,
  options:TransportDutyCoordinationDemoSeedOptions,
) {
  assertTransportDutyCoordinationDemoSeedAllowed(options);
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const schoolId=demoId("school-cis");
    const principalId=demoId("user-meera-principal");
    const sourceId=demoId("governance-source-cis-management-scheme");
    const officeId=demoId("governance-office-principal");
    const appointmentId=demoId("governance-appointment-principal");
    const scope=(await client.query(`SELECT school.id school_id,principal.id principal_id,
        source.id source_id,office.id office_id,appointment.id appointment_id,
        principal_agent.id principal_agent_id
      FROM schools school
      JOIN users principal ON principal.id=$2 AND principal.is_active
      JOIN school_memberships membership ON membership.school_id=school.id
        AND membership.user_id=principal.id AND membership.role='admin' AND membership.is_active
      JOIN institution_authority_sources source ON source.school_id=school.id AND source.id=$3
        AND source.verification_state IN ('verified','self_attested')
        AND source.effective_from<=current_date
        AND (source.effective_until IS NULL OR source.effective_until>=current_date)
      JOIN institution_governance_offices office ON office.school_id=school.id AND office.id=$4
        AND office.status='active' AND office.authority_source_id=source.id
      JOIN institution_governance_appointments appointment ON appointment.school_id=school.id
        AND appointment.id=$5 AND appointment.office_id=office.id
        AND appointment.linked_user_id=principal.id AND appointment.status='active'
        AND appointment.starts_on<=current_date
        AND (appointment.ends_on IS NULL OR appointment.ends_on>=current_date)
      JOIN campus_model_agent_endpoints principal_endpoint ON principal_endpoint.school_id=school.id
        AND principal_endpoint.endpoint_kind='account' AND principal_endpoint.provider='thatcampus'
        AND principal_endpoint.user_id=principal.id AND principal_endpoint.status='active'
        AND principal_endpoint.effective_from<=current_timestamp
        AND (principal_endpoint.effective_until IS NULL OR principal_endpoint.effective_until>current_timestamp)
      JOIN campus_model_agents principal_agent ON principal_agent.school_id=school.id
        AND principal_agent.id=principal_endpoint.agent_id AND principal_agent.agent_kind='human'
        AND principal_agent.status='active'
      WHERE school.id=$1 AND school.code='cis'`,[schoolId,principalId,sourceId,officeId,appointmentId])).rows;
    assertOne(scope,"transport decision authority");
    const fixture=scope[0] as {school_id:string;principal_id:string;source_id:string;office_id:string;appointment_id:string;principal_agent_id:string};
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`demo:transport-duty-coordination:${fixture.school_id}`]);

    const ruleId=demoId("governance-rule-transport-duty-change-decision");
    await client.query(`INSERT INTO institution_decision_matter_rules(
        id,school_id,code,title,category,initiation_summary,review_summary,decision_summary,
        execution_summary,decision_mode,decision_office_id,authority_source_ids,conditions_summary,
        material_fields,status,effective_from,created_by
      ) VALUES(
        $1,$2,'transport_duty_change_decision','Transport duty change decision','operations',
        'An assigned collector asks one identified colleague to cover or exchange a dated trip.',
        'The colleague responds before the configured duty-change cutoff.',
        'The configured officeholder decides whether responsibility may change.',
        'Departure and transport atomically rechecks and changes the dated trip assignment.',
        'individual',$3,ARRAY[$4]::uuid[],
        'The officeholder, colleague, trip revisions and duty-change window must remain current.',
        ARRAY['request_type','requester_trip','target_trip','requester','target']::text[],
        'confirmed','2026-04-01',$5
      ) ON CONFLICT DO NOTHING`,[ruleId,fixture.school_id,fixture.office_id,fixture.source_id,fixture.principal_id]);
    assertOne((await client.query(`SELECT id FROM institution_decision_matter_rules
      WHERE id=$1 AND school_id=$2 AND code='transport_duty_change_decision'
        AND decision_mode='individual' AND decision_office_id=$3 AND status='confirmed'
        AND authority_source_ids=ARRAY[$4]::uuid[] AND created_by=$5`,
      [ruleId,fixture.school_id,fixture.office_id,fixture.source_id,fixture.principal_id])).rows,"transport duty decision rule");

    const decideAuthorityId=demoId("campus-model-authority-transport-duty-principal");
    const decisionConstraints={fixture:"cambridge_demo",decision_matter:"transport_duty_change_decision",decision_rule_id:ruleId,decision_office_id:fixture.office_id};
    await client.query(`INSERT INTO campus_model_agent_authorities(
        id,school_id,agent_id,capability,scope_entity_id,effective_from,grant_source,
        grant_reference_id,approved_by,operating_rule_version_ref,constraints
      ) VALUES($1,$2,$3,'transport_duty_change:decide',null,'2026-04-01T00:00:00Z',
        'governance_decision_rule',$4,$5,'transport_duty_change_decision:1',$6::jsonb)
      ON CONFLICT DO NOTHING`,[decideAuthorityId,fixture.school_id,fixture.principal_agent_id,ruleId,fixture.principal_id,JSON.stringify(decisionConstraints)]);

    const eligible=(await client.query<{agent_id:string;user_id:string}>(`SELECT DISTINCT agent.id agent_id,endpoint.user_id
      FROM campus_model_agents agent
      JOIN campus_model_agent_endpoints endpoint ON endpoint.school_id=agent.school_id
        AND endpoint.agent_id=agent.id AND endpoint.endpoint_kind='account'
        AND endpoint.provider='thatcampus' AND endpoint.status='active'
        AND endpoint.effective_from<=current_timestamp
        AND (endpoint.effective_until IS NULL OR endpoint.effective_until>current_timestamp)
      JOIN users account ON account.id=endpoint.user_id AND account.is_active
      JOIN school_memberships membership ON membership.school_id=agent.school_id
        AND membership.user_id=account.id AND membership.is_active
        AND membership.role IN ('staff','admin')
      WHERE agent.school_id=$1 AND agent.agent_kind='human' AND agent.status='active'
      ORDER BY endpoint.user_id`,[fixture.school_id])).rows;
    if(eligible.length<2)throw new Error("The transport-duty demo needs at least two explicitly linked active staff agents.");
    for(const item of eligible) {
      const authorityId=demoId(`campus-model-authority-transport-duty-response-${item.user_id}`);
      const constraints={fixture:"cambridge_demo",purpose:"respond_to_explicit_transport_duty_offer",user_id:item.user_id};
      await client.query(`INSERT INTO campus_model_agent_authorities(
          id,school_id,agent_id,capability,scope_entity_id,effective_from,grant_source,
          grant_reference_id,approved_by,operating_rule_version_ref,constraints
        ) VALUES($1,$2,$3,'transport_duty_change:respond',null,'2026-04-01T00:00:00Z',
          'transport_operating_rule',$4,$5,'transport_duty_change_offer:1',$6::jsonb)
        ON CONFLICT DO NOTHING`,[authorityId,fixture.school_id,item.agent_id,ruleId,fixture.principal_id,JSON.stringify(constraints)]);
    }

    const routes=[
      {
        behaviourId:demoId("campus-model-behaviour-transport-duty-offer-v1"),
        behaviourKey:"transport_duty_offer_routing",subscriptionId:demoId("campus-model-subscription-transport-duty-requested-v1"),
        subscriptionKey:"transport_duty_requested_to_target",eventType:"transport.duty_change.requested",
        selectorKey:"transport_duty_target_colleague",capability:"transport_duty_change:respond",reactionKind:"transport_duty_offer",messageKind:"offer",
      },
      {
        behaviourId:demoId("campus-model-behaviour-transport-duty-decision-v1"),
        behaviourKey:"transport_duty_decision_routing",subscriptionId:demoId("campus-model-subscription-transport-duty-accepted-v1"),
        subscriptionKey:"transport_duty_accepted_to_decision_owner",eventType:"transport.duty_change.accepted",
        selectorKey:"transport_duty_change_decision_owner",capability:"transport_duty_change:decide",reactionKind:"transport_duty_decision_review",messageKind:"request",
      },
    ] as const;
    for(const route of routes) {
      const configuration={fixture:"cambridge_demo",selector_key:route.selectorKey,authority_recheck:"on_publish_and_response",missing_configuration:"coordination_exception"};
      await client.query(`INSERT INTO campus_model_behaviour_versions(
          id,school_id,behaviour_key,version,status,effective_from,configuration,
          configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at
        ) VALUES($1,$2,$3,1,'approved','2026-04-01T00:00:00Z',$4::jsonb,1,$5,$5,'2026-04-01T00:00:00Z')
        ON CONFLICT DO NOTHING`,[route.behaviourId,fixture.school_id,route.behaviourKey,JSON.stringify(configuration),fixture.principal_agent_id]);
      const selector={mode:"explicit_authorized_agents",selector_key:route.selectorKey,required_capability:route.capability,scope_mode:"institution",min_recipients:1,max_recipients:1};
      await client.query(`INSERT INTO campus_model_event_subscriptions(
          id,school_id,behaviour_version_id,subscription_key,source_domain,event_type,
          reaction_kind,message_kind,message_schema_version,recipient_selector,
          response_due_after_seconds,expires_after_seconds,max_attempts,retry_after_seconds,priority
        ) VALUES($1,$2,$3,$4,'departure_transport',$5,$6,$7,1,$8::jsonb,43200,172800,3,1800,8)
        ON CONFLICT DO NOTHING`,[route.subscriptionId,fixture.school_id,route.behaviourId,route.subscriptionKey,route.eventType,route.reactionKind,route.messageKind,JSON.stringify(selector)]);
      assertOne((await client.query(`SELECT subscription.id FROM campus_model_event_subscriptions subscription
        JOIN campus_model_behaviour_versions behaviour ON behaviour.id=subscription.behaviour_version_id
          AND behaviour.school_id=subscription.school_id
        WHERE subscription.id=$1 AND subscription.school_id=$2 AND subscription.source_domain='departure_transport'
          AND subscription.event_type=$3 AND subscription.message_kind=$4
          AND subscription.recipient_selector=$5::jsonb AND behaviour.status='approved'`,
        [route.subscriptionId,fixture.school_id,route.eventType,route.messageKind,JSON.stringify(selector)])).rows,`${route.messageKind} transport route`);
    }

    await client.query("COMMIT");
    return {school_id:fixture.school_id,decision_rule_id:ruleId,eligible_colleague_agents:eligible.length,
      offer_subscription_id:routes[0].subscriptionId,decision_subscription_id:routes[1].subscriptionId};
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required");
  const environment=process.env.DEPLOYMENT_ENVIRONMENT??process.env.NODE_ENV??"development";
  const options={demoMode:process.env.DEMO_MODE==="true",explicitOptIn:process.env.SEED_TRANSPORT_DUTY_COORDINATION==="true",environment};
  assertTransportDutyCoordinationDemoSeedAllowed(options);
  const connection=postgresClientConnectionConfig(process.env.DATABASE_URL,{name:"DATABASE_URL",purpose:"migrations",requireRemoteTls:environment==="stage"||environment==="production"});
  const pool=new Pool({...connection,max:1,application_name:"thatcampus_transport_duty_coordination_demo"});
  try {
    process.stdout.write(`Transport-duty coordination demo seed: ${JSON.stringify(await seedTransportDutyCoordinationDemo(pool,options))}\n`);
  } finally {
    await pool.end();
  }
}
