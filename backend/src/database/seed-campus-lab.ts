import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import {
  CAMBRIDGE_CAMPUS_FIXTURE_VERSION,
  CAMBRIDGE_OPERATIONAL_STAFF,
  CAMBRIDGE_SPACES,
  cambridgeFixtureId,
  validateCambridgeCampusFixture,
} from "./cambridge-campus-fixture.js";
import { postgresClientConnectionConfig } from "./connection-policy.js";

export interface CampusLabSeedOptions {
  demoMode:boolean;
  explicitOptIn:boolean;
  environment:string;
}

const allowedEnvironments=new Set(["development","local","test"]);

export function assertCampusLabSeedAllowed(options:CampusLabSeedOptions) {
  if(!options.demoMode)throw new Error("Campus Lab fixture seeding requires DEMO_MODE=true.");
  if(!options.explicitOptIn)throw new Error("Campus Lab fixture seeding requires SEED_CAMPUS_LAB=true.");
  if(!allowedEnvironments.has(options.environment.trim().toLowerCase())) {
    throw new Error("Campus Lab fixture seeding is limited to development, local or test environments.");
  }
}

type SeedScope={schoolId:string;campusId:string;adminId:string;timezone:string};

async function seedSpaces(client:PoolClient,scope:SeedScope){
  const byCode=new Map<string,string>();
  let inserted=0;
  let reconciled=0;
  for(const space of CAMBRIDGE_SPACES){
    const parentId=space.parent_code?byCode.get(space.parent_code):null;
    if(space.parent_code&&!parentId)throw new Error(`Cambridge parent space was not seeded: ${space.parent_code}`);
    const fixtureAttributes={
      fixture_source:CAMBRIDGE_CAMPUS_FIXTURE_VERSION,
      synthetic:true,
      zone:space.zone,
      purpose:space.purpose,
      schematic:space.map,
      aliases:space.aliases??[],
    };
    const exact=(await client.query<{id:string}>(`SELECT id::text FROM campus_spaces
      WHERE school_id=$1 AND campus_id=$2 AND code=$3`,[scope.schoolId,scope.campusId,space.code])).rows[0];
    const legacy=exact??(space.kind==="classroom"?(await client.query<{id:string}>(`SELECT id::text FROM campus_spaces
      WHERE school_id=$1 AND campus_id=$2 AND kind='classroom' AND name=$3
      ORDER BY created_at,id LIMIT 1`,[scope.schoolId,scope.campusId,space.name])).rows[0]:undefined);
    let spaceId=legacy?.id;
    if(spaceId){
      const updated=await client.query(`UPDATE campus_spaces SET
        parent_space_id=$3,
        code=CASE WHEN code=$4 OR code ~ '^ROOM-[0-9A-Fa-f]{8}$' THEN $4 ELSE code END,
        capacity=COALESCE(capacity,$5),
        is_accessible=is_accessible OR $6,
        attributes=attributes||$7::jsonb,
        updated_by=$8
        WHERE school_id=$1 AND id=$2 AND (
          parent_space_id IS DISTINCT FROM $3::uuid
          OR (code<>$4 AND code ~ '^ROOM-[0-9A-Fa-f]{8}$')
          OR (capacity IS NULL AND $5::int IS NOT NULL)
          OR (NOT is_accessible AND $6)
          OR NOT (attributes @> $7::jsonb)
        )`,[
        scope.schoolId,spaceId,parentId,space.code,space.capacity,space.accessible,JSON.stringify(fixtureAttributes),scope.adminId,
      ]);
      reconciled+=updated.rowCount??0;
    }else{
      spaceId=cambridgeFixtureId(`space:${space.code}`);
      const created=await client.query(`INSERT INTO campus_spaces(
          id,school_id,campus_id,parent_space_id,name,code,kind,capacity,is_accessible,is_bookable,attributes,created_by,updated_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$12)
        ON CONFLICT(campus_id,code) DO NOTHING`,[
        spaceId,scope.schoolId,scope.campusId,parentId,space.name,space.code,space.kind,space.capacity,
        space.accessible,space.bookable,JSON.stringify(fixtureAttributes),scope.adminId,
      ]);
      inserted+=created.rowCount??0;
      if(!created.rowCount){
        spaceId=(await client.query<{id:string}>(`SELECT id::text FROM campus_spaces WHERE campus_id=$1 AND code=$2`,[scope.campusId,space.code])).rows[0]?.id;
      }
    }
    if(!spaceId)throw new Error(`Cambridge space could not be resolved: ${space.code}`);
    byCode.set(space.code,spaceId);
  }
  return {byCode,inserted,reconciled};
}

async function seedResources(client:PoolClient,scope:SeedScope,spaces:Map<string,string>){
  const holdings=[
    {key:"computer-lab-workstations",type:"COMPUTER",space:"LAB-COMPUTER",name:"Student computer workstations",quantity:30,asset:null},
    {key:"science-lab-sets",type:"LAB-EQUIPMENT",space:"LAB-SCI",name:"Student science practical sets",quantity:32,asset:null},
    {key:"library-tablets",type:"TABLET",space:"LIBRARY",name:"Library research tablets",quantity:20,asset:null},
    {key:"auditorium-projector",type:"PROJECTOR",space:"AUDITORIUM",name:"Auditorium projector",quantity:1,asset:"CIS-PROJ-AUD-01"},
  ] as const;
  let inserted=0;
  for(const holding of holdings){
    const spaceId=spaces.get(holding.space);
    if(!spaceId)throw new Error(`Cambridge resource space is unavailable: ${holding.space}`);
    const result=await client.query(`INSERT INTO campus_resource_holdings(
        id,school_id,campus_id,space_id,resource_type_id,name,quantity,asset_tag,state,notes,created_by,updated_by
      ) SELECT $1,$2,$3,$4,type.id,$5,$6,$7,'available',$8,$9,$9
      FROM campus_resource_types type WHERE type.school_id=$2 AND type.code=$10
      ON CONFLICT(id) DO NOTHING`,[
      cambridgeFixtureId(`resource:${holding.key}`),scope.schoolId,scope.campusId,spaceId,holding.name,holding.quantity,holding.asset,
      `Wholly synthetic ${CAMBRIDGE_CAMPUS_FIXTURE_VERSION} holding.`,scope.adminId,holding.type,
    ]);
    inserted+=result.rowCount??0;
  }
  return inserted;
}

async function seedOperationalStaff(client:PoolClient,scope:SeedScope,spaces:Map<string,string>){
  let inserted=0;
  let assigned=0;
  let duties=0;
  const term=(await client.query<{starts_on:string;ends_on:string}>(`SELECT starts_on::text,ends_on::text FROM academic_terms
    WHERE school_id=$1 AND is_active ORDER BY starts_on DESC LIMIT 1`,[scope.schoolId])).rows[0];
  for(const person of CAMBRIDGE_OPERATIONAL_STAFF){
    const profileId=cambridgeFixtureId(`staff:${person.code}`);
    const created=await client.query(`INSERT INTO staff_profiles(
        id,school_id,user_id,staff_code,first_name,last_name,email,phone,staff_kind,designation,department,
        employment_type,joined_on,status,created_by,updated_by
      ) SELECT $1,$2,NULL,$3,$4,$5,$6,$7,'non_teaching',$8,$9,$10,$11,'active',$12,$12
      WHERE NOT EXISTS(SELECT 1 FROM staff_profiles existing WHERE existing.school_id=$2 AND existing.staff_code=$3::varchar)
      ON CONFLICT(school_id,staff_code) DO NOTHING`,[
      profileId,scope.schoolId,person.code,person.first_name,person.last_name,person.email,person.phone,
      person.designation,person.department,person.employment_type,person.joined_on,scope.adminId,
    ]);
    inserted+=created.rowCount??0;
    const resolvedProfile=(await client.query<{id:string}>(`SELECT id::text FROM staff_profiles
      WHERE school_id=$1 AND staff_code=$2`,[scope.schoolId,person.code])).rows[0]?.id;
    if(!resolvedProfile)throw new Error(`Cambridge staff profile could not be resolved: ${person.code}`);
    const campusAssignment=await client.query(`INSERT INTO staff_campus_assignments(
        id,school_id,staff_profile_id,campus_id,is_primary,effective_from,assigned_by
      ) SELECT $1,$2,$3,$4,true,$5::date,$6
      WHERE NOT EXISTS(SELECT 1 FROM staff_campus_assignments existing
        WHERE existing.school_id=$2 AND existing.staff_profile_id=$3 AND existing.is_primary
          AND existing.effective_from<=current_date AND (existing.effective_until IS NULL OR existing.effective_until>=current_date))
      ON CONFLICT(id) DO NOTHING`,[
      cambridgeFixtureId(`staff-campus:${person.code}`),scope.schoolId,resolvedProfile,scope.campusId,person.joined_on,scope.adminId,
    ]);
    assigned+=campusAssignment.rowCount??0;
    const homeSpaceId=spaces.get(person.home_space_code);
    if(!homeSpaceId)throw new Error(`Cambridge staff home space could not be resolved: ${person.home_space_code}`);
    const duty=await client.query(`INSERT INTO staff_responsibility_assignments(
        id,school_id,responsibility_type_id,staff_profile_id,scope_label,location,starts_on,ends_on,
        starts_at,ends_at,status,notes,assigned_by,responded_at
      ) SELECT $1,$2,type.id,$3,$4,$5,$6::date,$7::date,'08:00'::time,'16:00'::time,'active',$8,$9,now()
      FROM staff_responsibility_types type WHERE type.school_id=$2 AND type.code=$10
      ON CONFLICT(id) DO NOTHING`,[
      cambridgeFixtureId(`staff-duty:${person.code}`),scope.schoolId,resolvedProfile,person.duty_label,person.duty_location,
      term?.starts_on??person.joined_on,term?.ends_on??null,
      `Synthetic operational duty. Planned home space ${homeSpaceId}; this is not physical-presence evidence.`,
      scope.adminId,person.responsibility_code,
    ]);
    duties+=duty.rowCount??0;
  }
  // Versions before this NOT EXISTS guard could invoke the staff-person trigger
  // before ON CONFLICT discarded a repeat. Remove only unreferenced, exact
  // synthetic contacts left by that local fixture bug.
  const removedOrphanPeople=await client.query(`DELETE FROM school_people person
    WHERE person.school_id=$1 AND lower(person.contact_email)=ANY($2::text[])
      AND NOT EXISTS(SELECT 1 FROM staff_profiles profile WHERE profile.school_id=person.school_id AND profile.person_id=person.id)`,[
    scope.schoolId,CAMBRIDGE_OPERATIONAL_STAFF.map((person)=>person.email.toLowerCase()),
  ]);
  return {inserted,assigned,duties,removed_orphan_people:removedOrphanPeople.rowCount??0};
}

async function reconcileModelProjection(client:PoolClient,scope:SeedScope){
  const fixtureMetadata=JSON.stringify({synthetic:true,fixture_source:CAMBRIDGE_CAMPUS_FIXTURE_VERSION});
  await client.query(`INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata)
    SELECT space.school_id,'space','campus_topology',space.id::text,space.name,
      CASE space.status WHEN 'inactive' THEN 'inactive' ELSE 'active' END,space.revision,$2::jsonb
    FROM campus_spaces space WHERE space.school_id=$1 AND space.attributes->>'fixture_source'=$3
    ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
      label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,source_revision=EXCLUDED.source_revision,
      metadata=campus_model_entities.metadata||EXCLUDED.metadata,updated_at=now()
    WHERE campus_model_entities.label IS DISTINCT FROM EXCLUDED.label
      OR campus_model_entities.lifecycle_state IS DISTINCT FROM EXCLUDED.lifecycle_state
      OR campus_model_entities.source_revision IS DISTINCT FROM EXCLUDED.source_revision
      OR NOT (campus_model_entities.metadata @> EXCLUDED.metadata)`,[
    scope.schoolId,fixtureMetadata,CAMBRIDGE_CAMPUS_FIXTURE_VERSION,
  ]);
  await client.query(`INSERT INTO campus_model_entities(school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata)
    SELECT profile.school_id,'staff','people',profile.id::text,trim(concat_ws(' ',profile.first_name,profile.last_name)),
      CASE profile.status WHEN 'inactive' THEN 'inactive' ELSE 'active' END,profile.revision,$2::jsonb
    FROM staff_profiles profile WHERE profile.school_id=$1 AND profile.staff_code=ANY($3::text[])
    ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
      label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,source_revision=EXCLUDED.source_revision,
      metadata=campus_model_entities.metadata||EXCLUDED.metadata,updated_at=now()
    WHERE campus_model_entities.label IS DISTINCT FROM EXCLUDED.label
      OR campus_model_entities.lifecycle_state IS DISTINCT FROM EXCLUDED.lifecycle_state
      OR campus_model_entities.source_revision IS DISTINCT FROM EXCLUDED.source_revision
      OR NOT (campus_model_entities.metadata @> EXCLUDED.metadata)`,[
    scope.schoolId,fixtureMetadata,CAMBRIDGE_OPERATIONAL_STAFF.map((person)=>person.code),
  ]);
  // A targeted fixture upgrade may re-parent the legacy classroom rows. Close
  // only the stale current topology link, retaining it as recorded history.
  await client.query(`UPDATE campus_model_relationships relationship SET effective_until=now(),updated_at=now()
    FROM campus_spaces space
    JOIN campus_model_entities source ON source.school_id=space.school_id AND source.domain='campus_topology' AND source.domain_id=space.id::text
    JOIN campus_model_entities expected_target ON expected_target.school_id=space.school_id AND expected_target.domain='campus_topology'
      AND expected_target.domain_id=COALESCE(space.parent_space_id,space.campus_id)::text
    WHERE relationship.school_id=$1 AND space.school_id=relationship.school_id
      AND space.attributes->>'fixture_source'=$2 AND relationship.relation_type='part_of'
      AND relationship.source_entity_id=source.id AND relationship.effective_until IS NULL
      AND relationship.target_entity_id<>expected_target.id AND relationship.effective_from<now()`,[
    scope.schoolId,CAMBRIDGE_CAMPUS_FIXTURE_VERSION,
  ]);
  await client.query(`INSERT INTO campus_model_relationships(
      school_id,relation_type,source_entity_id,target_entity_id,effective_from,source_domain,source_record_id,source_revision,metadata
    ) SELECT space.school_id,'part_of',source.id,target.id,now(),'campus_topology',space.id::text,space.revision,$3::jsonb
    FROM campus_spaces space
    JOIN campus_model_entities source ON source.school_id=space.school_id AND source.domain='campus_topology' AND source.domain_id=space.id::text
    JOIN campus_model_entities target ON target.school_id=space.school_id AND target.domain='campus_topology'
      AND target.domain_id=COALESCE(space.parent_space_id,space.campus_id)::text
    WHERE space.school_id=$1 AND space.attributes->>'fixture_source'=$2
      AND NOT EXISTS(SELECT 1 FROM campus_model_relationships current
        WHERE current.school_id=space.school_id AND current.relation_type='part_of'
          AND current.source_entity_id=source.id AND current.target_entity_id=target.id AND current.effective_until IS NULL)`,[
    scope.schoolId,CAMBRIDGE_CAMPUS_FIXTURE_VERSION,fixtureMetadata,
  ]);
  await client.query(`INSERT INTO campus_model_relationships(
      school_id,relation_type,source_entity_id,target_entity_id,effective_from,effective_until,
      source_domain,source_record_id,source_revision,metadata
    ) SELECT assignment.school_id,'assigned_to',staff_entity.id,campus_entity.id,
      assignment.effective_from::timestamp AT TIME ZONE campus.timezone,
      CASE WHEN assignment.effective_until IS NULL THEN NULL ELSE (assignment.effective_until+1)::timestamp AT TIME ZONE campus.timezone END,
      'campus_topology',assignment.id::text,assignment.revision,$2::jsonb
    FROM staff_campus_assignments assignment
    JOIN staff_profiles profile ON profile.id=assignment.staff_profile_id AND profile.school_id=assignment.school_id
    JOIN institution_campuses campus ON campus.id=assignment.campus_id
    JOIN campus_model_entities staff_entity ON staff_entity.school_id=assignment.school_id AND staff_entity.domain='people' AND staff_entity.domain_id=profile.id::text
    JOIN campus_model_entities campus_entity ON campus_entity.school_id=assignment.school_id AND campus_entity.domain='campus_topology' AND campus_entity.domain_id=campus.id::text
    WHERE assignment.school_id=$1 AND profile.staff_code=ANY($3::text[])
    ON CONFLICT DO NOTHING`,[
    scope.schoolId,fixtureMetadata,CAMBRIDGE_OPERATIONAL_STAFF.map((person)=>person.code),
  ]);
}

/**
 * Adds the versioned Cambridge topology and synthetic operating team. It is an
 * explicitly opted-in local fixture, never a production default or runtime
 * inference. Existing reviewed records are not deleted.
 */
export async function seedCampusLab(pool:Pool,options:CampusLabSeedOptions) {
  assertCampusLabSeedAllowed(options);
  validateCambridgeCampusFixture();
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const scope=(await client.query(`SELECT school.id,school.timezone,membership.user_id AS admin_id,campus.id AS campus_id
      FROM schools school
      JOIN school_memberships membership ON membership.school_id=school.id
        AND membership.role='admin' AND membership.is_active
      JOIN users principal ON principal.id=membership.user_id
        AND principal.username='meera.principal' AND principal.email='meera.kapoor@example.test'
        AND principal.is_active
      JOIN institution_campuses campus ON campus.school_id=school.id AND campus.is_primary AND campus.status='active'
      WHERE school.code='cis'`)).rows;
    if(scope.length!==1)throw new Error("The Cambridge Campus Lab school is missing or ambiguous.");
    const seedScope:SeedScope={
      schoolId:String(scope[0].id),campusId:String(scope[0].campus_id),adminId:String(scope[0].admin_id),timezone:String(scope[0].timezone),
    };
    const schoolId=seedScope.schoolId;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`campus-lab:space-capacity:${schoolId}`]);
    await client.query(`UPDATE institution_campuses SET
      address_line=CASE WHEN trim(address_line)='' THEN '42 Learning Avenue' ELSE address_line END,
      city=CASE WHEN trim(city)='' THEN 'Bengaluru' ELSE city END,
      state=CASE WHEN trim(state)='' THEN 'Karnataka' ELSE state END,
      postal_code=CASE WHEN trim(postal_code)='' THEN '560001' ELSE postal_code END,
      updated_by=$2
      WHERE id=$1 AND (trim(address_line)='' OR trim(city)='' OR trim(state)='' OR trim(postal_code)='')`,[seedScope.campusId,seedScope.adminId]);
    const spaceResult=await seedSpaces(client,seedScope);
    const remaining=(await client.query(`SELECT count(*)::int AS count FROM campus_spaces
      WHERE school_id=$1 AND kind='classroom' AND status='active' AND capacity IS NULL`,[schoolId])).rows[0]?.count??0;
    if(Number(remaining)!==0)throw new Error("Some active Cambridge dummy classrooms still have no recorded capacity.");
    const resourceHoldings=await seedResources(client,seedScope,spaceResult.byCode);
    const staffResult=await seedOperationalStaff(client,seedScope,spaceResult.byCode);
    await reconcileModelProjection(client,seedScope);
    await client.query("COMMIT");
    return {
      school_id:schoolId,
      campus_id:seedScope.campusId,
      fixture_version:CAMBRIDGE_CAMPUS_FIXTURE_VERSION,
      spaces:{total:CAMBRIDGE_SPACES.length,inserted:spaceResult.inserted,reconciled:spaceResult.reconciled},
      resources:{configured:4,inserted:resourceHoldings},
      operational_staff:{total:CAMBRIDGE_OPERATIONAL_STAFF.length,...staffResult},
    };
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
  const options={demoMode:process.env.DEMO_MODE==="true",explicitOptIn:process.env.SEED_CAMPUS_LAB==="true",environment};
  assertCampusLabSeedAllowed(options);
  const connection=postgresClientConnectionConfig(process.env.DATABASE_URL,{name:"DATABASE_URL",purpose:"migrations",requireRemoteTls:false});
  const pool=new Pool({...connection,max:1,application_name:"thatcampus_campus_lab_seed"});
  try {
    process.stdout.write(`Campus Lab fixture seed: ${JSON.stringify(await seedCampusLab(pool,options))}\n`);
  } finally {
    await pool.end();
  }
}
