import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { postgresClientConnectionConfig } from "./connection-policy.js";
import { demoId } from "./seed-operations.js";

export interface AssessmentInvigilationCoordinationDemoSeedOptions {
  demoMode:boolean;
  explicitOptIn:boolean;
  environment:string;
}

const allowedDemoEnvironments=new Set(["development","local","test"]);

export function assertAssessmentInvigilationCoordinationDemoSeedAllowed(
  options:AssessmentInvigilationCoordinationDemoSeedOptions,
) {
  if(!options.demoMode) throw new Error("Assessment-invigilation coordination demo seeding requires DEMO_MODE=true.");
  if(!options.explicitOptIn) throw new Error("Assessment-invigilation coordination demo seeding requires SEED_ASSESSMENT_INVIGILATION_COORDINATION=true.");
  if(!allowedDemoEnvironments.has(options.environment.trim().toLowerCase())){
    throw new Error("Assessment-invigilation coordination demo seeding is limited to development, local or test environments.");
  }
}

function assertOne(rows:unknown[],description:string){
  if(rows.length!==1) throw new Error(`The ${description} demo fixture is missing, ambiguous or differs from its approved configuration.`);
}

/** Installs explicit Cambridge demo configuration; it is never a runtime default. */
export async function seedAssessmentInvigilationCoordinationDemo(
  pool:Pool,
  options:AssessmentInvigilationCoordinationDemoSeedOptions,
) {
  assertAssessmentInvigilationCoordinationDemoSeedAllowed(options);
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const schoolId=demoId("school-cis");
    const administratorId=demoId("user-meera-principal");
    const scope=(await client.query<{school_id:string;administrator_id:string;administrator_agent_id:string}>(`SELECT
        school.id AS school_id,administrator.id AS administrator_id,
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
      WHERE school.id=$1 AND school.code='cis'`,[schoolId,administratorId])).rows;
    assertOne(scope,"Cambridge assessment-invigilation administrator identity");
    const fixture=scope[0]!;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
      `demo:assessment-invigilation-coordination:${fixture.school_id}`,
    ]);

    const eligible=(await client.query<{agent_id:string;user_id:string}>(`SELECT DISTINCT
        agent.id AS agent_id,endpoint.user_id
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
    if(eligible.length===0) throw new Error("The Cambridge assessment demo needs at least one explicitly linked active staff agent.");

    const behaviourId=demoId("campus-model-behaviour-assessment-invigilation-offer-v1");
    const subscriptionId=demoId("campus-model-subscription-assessment-invigilation-offered-v1");
    for(const item of eligible){
      const authorityId=demoId(`campus-model-authority-assessment-invigilation-response-${item.user_id}`);
      const constraints={
        fixture:"cambridge_demo",
        purpose:"respond_to_explicit_assessment_invigilation_offer",
        user_id:item.user_id,
      };
      await client.query(`INSERT INTO campus_model_agent_authorities(
          id,school_id,agent_id,capability,scope_entity_id,effective_from,
          grant_source,grant_reference_id,approved_by,operating_rule_version_ref,constraints
        ) VALUES($1,$2,$3,'assessment_invigilation:respond',null,'2026-04-01T00:00:00Z',
          'assessment_operating_rule',$4,$5,'assessment_invigilation_offer:1',$6::jsonb)
        ON CONFLICT DO NOTHING`,[
        authorityId,fixture.school_id,item.agent_id,behaviourId,
        fixture.administrator_id,JSON.stringify(constraints),
      ]);
      assertOne((await client.query(`SELECT id FROM campus_model_agent_authorities
        WHERE id=$1 AND school_id=$2 AND agent_id=$3
          AND capability='assessment_invigilation:respond'
          AND scope_entity_id IS NULL AND effective_from='2026-04-01T00:00:00Z'::timestamptz
          AND effective_until IS NULL AND grant_source='assessment_operating_rule'
          AND grant_reference_id=$4 AND approved_by=$5
          AND operating_rule_version_ref='assessment_invigilation_offer:1'
          AND constraints=$6::jsonb AND revoked_at IS NULL`,[
        authorityId,fixture.school_id,item.agent_id,behaviourId,
        fixture.administrator_id,JSON.stringify(constraints),
      ])).rows,`assessment-invigilation response authority for ${item.user_id}`);
    }

    const configuration={
      workflow:"assessment_invigilation_offer_routing",
      recipient_strategy:"administrator_selected",
      response_outcomes:{
        accepted:"readiness_recheck",
        declined:"administrator_review",
        expired:"administrator_review",
      },
    };
    await client.query(`INSERT INTO campus_model_behaviour_versions(
        id,school_id,behaviour_key,version,status,effective_from,configuration,
        configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at
      ) VALUES($1,$2,'assessment_invigilation_offer_routing',1,'approved',
        '2026-04-01T00:00:00Z',$3::jsonb,1,$4,$4,'2026-04-01T00:00:00Z')
      ON CONFLICT DO NOTHING`,[
      behaviourId,fixture.school_id,JSON.stringify(configuration),fixture.administrator_agent_id,
    ]);
    assertOne((await client.query(`SELECT id FROM campus_model_behaviour_versions
      WHERE id=$1 AND school_id=$2 AND behaviour_key='assessment_invigilation_offer_routing'
        AND version=1 AND status='approved' AND effective_from='2026-04-01T00:00:00Z'::timestamptz
        AND effective_until IS NULL AND configuration=$3::jsonb
        AND configuration_schema_version=1 AND created_by_agent_id=$4
        AND approved_by_agent_id=$4 AND approved_at='2026-04-01T00:00:00Z'::timestamptz`,[
      behaviourId,fixture.school_id,JSON.stringify(configuration),fixture.administrator_agent_id,
    ])).rows,"assessment-invigilation Offer behaviour");

    const selector={
      mode:"explicit_authorized_agents",
      selector_key:"assessment_invigilation_recipient",
      required_capability:"assessment_invigilation:respond",
      scope_mode:"institution",
      min_recipients:1,
      max_recipients:1,
    };
    await client.query(`INSERT INTO campus_model_event_subscriptions(
        id,school_id,behaviour_version_id,subscription_key,source_domain,event_type,
        reaction_kind,message_kind,message_schema_version,recipient_selector,
        response_due_after_seconds,expires_after_seconds,max_attempts,retry_after_seconds,priority
      ) VALUES($1,$2,$3,'assessment_invigilation_offered_to_selected_staff',
        'assessments','assessment.invigilation.offered','assessment_invigilation_offer',
        'offer',1,$4::jsonb,43200,172800,3,1800,8)
      ON CONFLICT DO NOTHING`,[
      subscriptionId,fixture.school_id,behaviourId,JSON.stringify(selector),
    ]);
    assertOne((await client.query(`SELECT subscription.id
      FROM campus_model_event_subscriptions subscription
      JOIN campus_model_behaviour_versions behaviour
        ON behaviour.id=subscription.behaviour_version_id
        AND behaviour.school_id=subscription.school_id
      WHERE subscription.id=$1 AND subscription.school_id=$2
        AND subscription.behaviour_version_id=$3
        AND subscription.subscription_key='assessment_invigilation_offered_to_selected_staff'
        AND subscription.source_domain='assessments'
        AND subscription.event_type='assessment.invigilation.offered'
        AND subscription.reaction_kind='assessment_invigilation_offer'
        AND subscription.message_kind='offer' AND subscription.message_schema_version=1
        AND subscription.recipient_selector=$4::jsonb
        AND subscription.response_due_after_seconds=43200
        AND subscription.expires_after_seconds=172800
        AND subscription.max_attempts=3 AND subscription.retry_after_seconds=1800
        AND subscription.priority=8 AND behaviour.status='approved'`,[
      subscriptionId,fixture.school_id,behaviourId,JSON.stringify(selector),
    ])).rows,"assessment-invigilation Offer subscription");

    await client.query("COMMIT");
    return {
      school_id:fixture.school_id,
      eligible_recipient_agents:eligible.length,
      behaviour_version_id:behaviourId,
      subscription_id:subscriptionId,
    };
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{
    client.release();
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const environment=process.env.DEPLOYMENT_ENVIRONMENT??process.env.NODE_ENV??"development";
  const options={
    demoMode:process.env.DEMO_MODE==="true",
    explicitOptIn:process.env.SEED_ASSESSMENT_INVIGILATION_COORDINATION==="true",
    environment,
  };
  assertAssessmentInvigilationCoordinationDemoSeedAllowed(options);
  const connection=postgresClientConnectionConfig(process.env.DATABASE_URL,{
    name:"DATABASE_URL",
    purpose:"migrations",
    requireRemoteTls:environment==="stage"||environment==="production",
  });
  const pool=new Pool({...connection,max:1,application_name:"thatcampus_assessment_invigilation_coordination_demo"});
  try{
    process.stdout.write(`Assessment-invigilation coordination demo seed: ${JSON.stringify(await seedAssessmentInvigilationCoordinationDemo(pool,options))}\n`);
  }finally{
    await pool.end();
  }
}
