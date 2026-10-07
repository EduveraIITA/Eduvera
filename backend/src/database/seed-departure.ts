import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { postgresClientConnectionConfig } from "./connection-policy.js";
import { demoId } from "./seed-operations.js";

const indiaDate=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date());

export async function seedDepartureDemo(pool:Pool,demoMode:boolean){
  if(!demoMode)return {skipped:"Demo mode is disabled"};
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const scope=(await client.query(`SELECT school.id,admin.id admin_id,collector.id collector_id
      FROM schools school
      JOIN users admin ON admin.username='meera.principal' AND admin.email='meera.kapoor@example.test'
      JOIN school_memberships admin_membership ON admin_membership.school_id=school.id AND admin_membership.user_id=admin.id AND admin_membership.role='admin' AND admin_membership.is_active
      JOIN users collector ON collector.username='kavita.staff' AND collector.is_active
      JOIN school_memberships collector_membership ON collector_membership.school_id=school.id AND collector_membership.user_id=collector.id AND collector_membership.role='staff' AND collector_membership.is_active
      WHERE school.code='cis'`)).rows[0];
    if(!scope){await client.query("ROLLBACK");return {skipped:"Cambridge demo identities are unavailable"};}
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[scope.id]);
    const learners=(await client.query(`SELECT student.id,student.admission_number,relationship.id relationship_id
      FROM students student JOIN guardian_relationships relationship ON relationship.student_id=student.id
      WHERE student.school_id=$1 AND student.admission_number IN ('CIS-2023-071','CIS-2023-061')
      ORDER BY student.admission_number,relationship.is_primary DESC,relationship.created_at LIMIT 2`,[scope.id])).rows;
    if(learners.length<2){await client.query("ROLLBACK");return {skipped:"Demo learners are unavailable"};}

    await client.query(`INSERT INTO departure_policies(school_id,enabled,enabled_modes,change_cutoff,location_retention_hours,location_stale_seconds,updated_by)
      VALUES($1,true,ARRAY['guardian_pickup','authorized_collector','independent_departure','school_transport','external_transport']::text[],'23:59',24,90,$2)
      ON CONFLICT(school_id) DO NOTHING`,[scope.id,scope.admin_id]);
    await client.query(`INSERT INTO school_custom_role_duties(school_id,role_id,responsibility_type_id)
      SELECT role.school_id,role.id,type.id FROM school_custom_roles role
      JOIN staff_responsibility_types type ON type.school_id=role.school_id AND type.code='transport_attendant'
      WHERE role.school_id=$1 AND lower(role.name)='transport staff' ON CONFLICT DO NOTHING`,[scope.id]);

    for(const learner of learners){
      await client.query(`INSERT INTO departure_collection_authorities(id,school_id,student_id,guardian_relationship_id,valid_from,verification_method,verification_note,granted_by)
        VALUES($1,$2,$3,$4,current_date-30,'school_record','Demo guardian record reviewed',$5)
        ON CONFLICT(id) DO NOTHING`,[demoId(`departure-authority-${learner.admission_number}`),scope.id,learner.id,learner.relationship_id,scope.admin_id]);
    }

    const routeId=demoId("departure-route-south");
    await client.query(`INSERT INTO transport_routes(id,school_id,code,name,service_kind,vehicle_label,provider_name,created_by,updated_by)
      VALUES($1,$2,'DEMO-SOUTH','South Bengaluru','institution_managed','Bus 14 · KA 01 AB 1234','Cambridge school transport',$3,$3)
      ON CONFLICT(school_id,code) DO UPDATE SET name=EXCLUDED.name,vehicle_label=EXCLUDED.vehicle_label,provider_name=EXCLUDED.provider_name RETURNING id`,[routeId,scope.id,scope.admin_id]);
    const stops=[
      {id:demoId("departure-stop-school"),sequence:1,name:"Cambridge International School",time:"15:30",lat:12.971599,lng:77.594566},
      {id:demoId("departure-stop-jayanagar"),sequence:2,name:"Jayanagar 4th Block",time:"15:55",lat:12.925007,lng:77.593803},
      {id:demoId("departure-stop-jp-nagar"),sequence:3,name:"JP Nagar 6th Phase",time:"16:15",lat:12.907728,lng:77.585941},
    ];
    for(const stop of stops)await client.query(`INSERT INTO transport_stops(id,school_id,route_id,direction,sequence,name,planned_time,latitude,longitude)
      VALUES($1,$2,$3,'from_institution',$4,$5,$6,$7,$8) ON CONFLICT(route_id,direction,sequence) DO NOTHING`,[stop.id,scope.id,routeId,stop.sequence,stop.name,stop.time,stop.lat,stop.lng]);

    for(const [index,learner] of learners.entries())await client.query(`INSERT INTO transport_student_assignments(id,school_id,student_id,route_id,stop_id,direction,valid_from,created_by)
      SELECT $1,$2,$3,$4,$5,'from_institution',current_date-30,$6 WHERE NOT EXISTS(
        SELECT 1 FROM transport_student_assignments WHERE student_id=$3 AND direction='from_institution' AND status='active' AND valid_until IS NULL)
      ON CONFLICT(id) DO NOTHING`,[demoId(`departure-assignment-${learner.admission_number}`),scope.id,learner.id,routeId,stops[index+1]!.id,scope.admin_id]);

    // The natural key includes valid_from, which moves with the calendar. Re-seeding
    // must reuse the stable demo record instead of inserting its existing UUID again.
    const requestedPatternId=demoId("departure-pattern-south-afternoon");
    const patternId=(await client.query(`INSERT INTO transport_service_patterns(id,school_id,route_id,label,direction,weekdays,departure_time,primary_collector_user_id,backup_collector_user_id,valid_from,created_by,updated_by)
      VALUES($1,$2,$3,'South route afternoon','from_institution',ARRAY[1,2,3,4,5,6]::smallint[],'15:30',$4,$5,current_date-30,$5,$5)
      ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,primary_collector_user_id=EXCLUDED.primary_collector_user_id,backup_collector_user_id=EXCLUDED.backup_collector_user_id
      RETURNING id`,[requestedPatternId,scope.id,routeId,scope.collector_id,scope.admin_id])).rows[0].id;

    const serviceDate=indiaDate();const tripId=demoId(`departure-trip-${serviceDate}`);
    const trip=(await client.query(`INSERT INTO transport_trips(id,school_id,route_id,service_date,direction,service_pattern_id,scheduled_departure_time,assigned_collector_user_id,backup_collector_user_id,collector_assignment_status,assignment_accepted_at,state,roster_frozen_at,departed_at,location_started_at,created_by)
      VALUES($1,$2,$3,$4,'from_institution',$5,'15:30',$6,$7,'accepted',now(),'in_progress',now(),now()-interval '8 minutes',now()-interval '8 minutes',$7)
      ON CONFLICT(route_id,service_date,direction,scheduled_departure_time) DO UPDATE SET assigned_collector_user_id=EXCLUDED.assigned_collector_user_id,collector_assignment_status='accepted',assignment_accepted_at=COALESCE(transport_trips.assignment_accepted_at,now())
      RETURNING id,state`,[tripId,scope.id,routeId,serviceDate,patternId,scope.collector_id,scope.admin_id])).rows[0];
    for(const [index,learner] of learners.entries()){
      const state=learner.admission_number==='CIS-2023-071'?'boarded':'expected';
      await client.query(`INSERT INTO transport_trip_roster(school_id,trip_id,student_id,stop_id,state,boarded_at,recorded_by,outcome_note)
        VALUES($1,$2,$3,$4,$5::varchar,CASE WHEN $5::text='boarded' THEN now()-interval '7 minutes' END,CASE WHEN $5::text='boarded' THEN $6::uuid END,'Demo journey')
        ON CONFLICT(trip_id,student_id) DO NOTHING`,[scope.id,trip.id,learner.id,stops[index+1]!.id,state,scope.collector_id]);
      const current=(await client.query("SELECT id,revision FROM departure_plans WHERE student_id=$1 AND service_date=$2 AND is_current",[learner.id,serviceDate])).rows[0];
      if(!current)await client.query(`INSERT INTO departure_plans(school_id,student_id,service_date,revision,mode,state,trip_id,stop_id,source,approved_by,approved_at,created_by)
        VALUES($1,$2,$3,1,'school_transport','ready',$4,$5,'transport_assignment',$6,now(),$6)`,[scope.id,learner.id,serviceDate,trip.id,stops[index+1]!.id,scope.admin_id]);
    }
    if(trip.state==='in_progress'){
      await client.query("DELETE FROM transport_location_samples WHERE trip_id=$1",[trip.id]);
      await client.query(`INSERT INTO transport_location_samples(school_id,trip_id,recorded_by,latitude,longitude,accuracy_metres,heading_degrees,speed_metres_per_second,observed_at)
        VALUES($1,$2,$3,12.949840,77.593640,18,184,7.2,now())`,[scope.id,trip.id,scope.collector_id]);
    }
    await client.query("COMMIT");
    return {school_id:scope.id,trip_id:trip.id,riders:learners.length};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.DEMO_MODE!=="true")throw new Error("Departure demo seeding requires DEMO_MODE=true");
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required");
  const environment=process.env.DEPLOYMENT_ENVIRONMENT??process.env.NODE_ENV??"development";
  const connection=postgresClientConnectionConfig(process.env.DATABASE_URL,{name:"DATABASE_URL",purpose:"migrations",requireRemoteTls:environment==="stage"||environment==="production"});
  const pool=new Pool({...connection,max:1,application_name:"eduera_departure_demo"});
  try{process.stdout.write(`Departure demo seed: ${JSON.stringify(await seedDepartureDemo(pool,true))}\n`);}finally{await pool.end();}
}
