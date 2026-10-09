import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database, DepartureMode } from "../database/types.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { assertActiveSchoolStaffMember, hasScopedSchoolPermission } from "../roles/authorization.js";
import { assertRiderTransition, assertTripTransition } from "./journey-rules.js";

const uuid=z.string().uuid();
const date=z.iso.date();
const mode=z.enum(["guardian_pickup","authorized_collector","independent_departure","school_transport","external_transport"]);
const direction=z.enum(["to_institution","from_institution"]);
type Db=DatabaseService|Transaction<Database>;

@Injectable()
export class DepartureCoordinationService {
  constructor(private readonly db:DatabaseService,private readonly events:SchoolEventService) {}

  private async membership(user:AuthUser,schoolId:string,admin=false) {
    uuid.parse(schoolId);
    const row=await this.db.selectFrom("school_memberships").selectAll().where("school_id","=",schoolId).where("user_id","=",user.id).where("is_active","=",true).executeTakeFirst();
    if(!row || (admin && !await hasScopedSchoolPermission(this.db,user.id,schoolId,"departure.manage","institution",schoolId))) throw new ForbiddenException(admin?"Departure management permission is required.":"This institution is not available to your account.");
    return row;
  }

  // Coordinate trip/plan/authority changes in a consistent lock order, including
  // empty (not yet created) plans. No network work is performed under this lock.
  private async lockSchool(tx:Transaction<Database>,schoolId:string) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`departure:${schoolId}`},0))`.execute(tx);
  }

  private async managedWrite(tx:Transaction<Database>,user:AuthUser,schoolId:string) {
    await this.lockSchool(tx,schoolId);
    if(!await hasScopedSchoolPermission(tx,user.id,schoolId,"departure.manage","institution",schoolId)) throw new ForbiddenException("Departure management permission is no longer active.");
  }

  private async operatingTrip(tx:Transaction<Database>,user:AuthUser,tripId:string) {
    uuid.parse(tripId);
    const reference=await tx.selectFrom("transport_trips").select("school_id").where("id","=",tripId).executeTakeFirst();
    if(!reference) throw new NotFoundException("Trip not found.");
    await this.lockSchool(tx,reference.school_id);
    const trip=await tx.selectFrom("transport_trips").selectAll().where("id","=",tripId).forUpdate().executeTakeFirstOrThrow();
    if(trip.assigned_collector_user_id!==user.id || !await hasScopedSchoolPermission(tx,user.id,trip.school_id,"departure.collect","trip",trip.id)) throw new ForbiddenException("Only the currently assigned collector can operate this journey.");
    return trip;
  }

  private async managedTrip(tx:Transaction<Database>,user:AuthUser,schoolId:string,tripId:string) {
    uuid.parse(tripId); await this.managedWrite(tx,user,schoolId);
    const trip=await tx.selectFrom("transport_trips").selectAll().where("school_id","=",schoolId).where("id","=",tripId).forUpdate().executeTakeFirst();
    if(!trip) throw new NotFoundException("Journey not found in this institution.");
    return trip;
  }

  private async localDate(db:Db,schoolId:string) {
    return (await sql<{date:string}>`SELECT (now() AT TIME ZONE timezone)::date::text AS date FROM schools WHERE id=${schoolId}::uuid`.execute(db)).rows[0]!.date;
  }

  private async journeyWindow(db:Db,tripId:string) {
    const result=await sql<{controls_open_at:Date;controls_available:boolean;duty_change_available:boolean}>`SELECT
      ((t.service_date+t.scheduled_departure_time) AT TIME ZONE s.timezone)-interval '30 minutes' controls_open_at,
      now()>=((t.service_date+t.scheduled_departure_time) AT TIME ZONE s.timezone)-interval '30 minutes'
        AND (now() AT TIME ZONE s.timezone)::date<=t.service_date controls_available,
      t.state='planned' AND t.roster_frozen_at IS NULL
        AND now()<((t.service_date+t.scheduled_departure_time) AT TIME ZONE s.timezone)-interval '30 minutes' duty_change_available
      FROM transport_trips t JOIN schools s ON s.id=t.school_id WHERE t.id=${tripId}::uuid`.execute(db);
    return result.rows[0]!;
  }

  private async assertDutyChangeWindow(db:Db,tripId:string) {
    if(!(await this.journeyWindow(db,tripId)).duty_change_available) throw new ConflictException("Duty changes close 30 minutes before departure. Contact school operations for urgent cover.");
  }

  private async schoolAudience(db:Db,schoolId:string) {
    return (await db.selectFrom("school_memberships").select("user_id").where("school_id","=",schoolId).where("is_active","=",true).where("role","in",["admin","staff"]).execute()).map(r=>r.user_id);
  }

  private async familyAudience(db:Db,studentId:string) {
    const result=await sql<{user_id:string}>`SELECT DISTINCT user_id FROM (
      SELECT s.user_id FROM students s JOIN users u ON u.id=s.user_id AND u.is_active WHERE s.id=${studentId}::uuid
      UNION SELECT p.user_id FROM guardian_relationships gr JOIN parents p ON p.id=gr.guardian_id
        JOIN users u ON u.id=p.user_id AND u.is_active WHERE gr.student_id=${studentId}::uuid
    ) linked WHERE user_id IS NOT NULL`.execute(db);
    return result.rows.map(r=>r.user_id);
  }

  private async emit(db:Db,schoolId:string,type:"departure.updated"|"transport.updated",targetType:string,targetId:string,studentId?:string,extra:Record<string,unknown>={}) {
    const riderIds=targetType==="transport_trip"&&!studentId?(await db.selectFrom("transport_trip_roster").select("student_id").where("trip_id","=",targetId).execute()).map(row=>row.student_id):studentId?[studentId]:[];
    const audience=[...new Set([...(await this.schoolAudience(db,schoolId)),...(await Promise.all(riderIds.map(id=>this.familyAudience(db,id)))).flat()])];
    const candidate=extra.revision??extra.action;
    const action=typeof extra.action==="string"?extra.action:"updated";
    const eventVersion=typeof candidate==="string"||typeof candidate==="number"||typeof candidate==="boolean"?candidate:Date.now();
    await this.events.enqueueUserEvent(db,{schoolId,eventType:type,aggregateType:targetType,aggregateId:targetId,audienceUserIds:audience,payload:{...extra,refresh:["departure","parent.home","principal.home","teacher.home"]},idempotencyKey:`${type}:${targetType}:${targetId}:${studentId??"trip"}:${action}:${eventVersion}`});
  }

  private async familyStudent(user:AuthUser,requested?:string,db:Db=this.db,learner=false) {
    if(requested) uuid.parse(requested);
    const rows=(await sql<{id:string;school_id:string;first_name:string;last_name:string;admission_number:string;avatar_url:string;grade:string|null;section:string|null;school_name:string}>`
      SELECT s.id,s.school_id,person.first_name,person.last_name,s.admission_number,s.avatar_url,
        section.grade,section.section,school.name AS school_name
      FROM students s JOIN school_people person ON person.id=s.person_id
      JOIN schools school ON school.id=s.school_id
      LEFT JOIN LATERAL (SELECT cs.grade,cs.section FROM enrollments e JOIN class_sections cs ON cs.id=e.class_section_id WHERE e.student_id=s.id AND e.is_active ORDER BY e.enrolled_on DESC LIMIT 1) section ON true
      WHERE EXISTS(SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
        WHERE membership.school_id=s.school_id AND membership.user_id=${user.id}::uuid AND membership.is_active)
        AND (CASE WHEN ${learner} THEN s.user_id=${user.id}::uuid ELSE EXISTS(
          SELECT 1 FROM guardian_relationships gr JOIN parents p ON p.id=gr.guardian_id
          WHERE gr.student_id=s.id AND gr.school_id=s.school_id AND p.user_id=${user.id}::uuid) END)
      ORDER BY person.first_name,person.last_name,s.id
    `.execute(db)).rows;
    const selected=requested?rows.find(r=>r.id===requested):rows[0];
    if(!selected) throw new ForbiddenException("The selected learner is not linked to this guardian.");
    return {selected,children:rows};
  }

  async family(user:AuthUser,studentId?:string,serviceDate?:string,learner=false) {
    const {selected,children}=await this.familyStudent(user,studentId,this.db,learner);
    const localDate=await this.localDate(this.db,selected.school_id);
    const selectedDate=serviceDate?date.parse(serviceDate):localDate;
    const policy=await this.db.selectFrom("departure_policies").select(["enabled","enabled_modes","change_cutoff"]).where("school_id","=",selected.school_id).executeTakeFirst();
    const result=await sql<any>`SELECT
      (SELECT jsonb_build_object('id',p.id,'service_date',p.service_date,'revision',p.revision,'mode',p.mode,'state',p.state,'authority_id',p.authority_id,'trip_id',p.trip_id,'stop_id',p.stop_id,'external_arrangement',p.external_arrangement)
        FROM departure_plans p WHERE p.school_id=${selected.school_id}::uuid AND p.student_id=${selected.id}::uuid AND p.service_date=${selectedDate}::date AND p.is_current) plan,
      (SELECT jsonb_build_object('id',r.id,'status',r.status,'requested_mode',r.requested_mode,'reason',r.reason,'created_at',r.created_at)
        FROM departure_change_requests r WHERE r.student_id=${selected.id}::uuid AND r.service_date=${selectedDate}::date AND r.status='submitted' LIMIT 1) request
    `.execute(this.db);
    const journeys=(await sql<any>`SELECT t.id,t.state,t.revision,t.service_date,t.direction,t.scheduled_departure_time,t.departed_at,t.completed_at,
      route.name route_name,route.code route_code,route.vehicle_label,route.provider_name,
      rider.state rider_state,rider.boarded_at,rider.dropped_at,stop.name stop_name,stop.planned_time,
      point.latitude,point.longitude,point.accuracy_metres,point.observed_at,
      COALESCE(point.observed_at>=now()-make_interval(secs=>COALESCE(policy.location_stale_seconds,90)),false) location_fresh
      FROM transport_trip_roster rider JOIN transport_trips t ON t.id=rider.trip_id JOIN transport_routes route ON route.id=t.route_id
      JOIN transport_stops stop ON stop.id=rider.stop_id LEFT JOIN departure_policies policy ON policy.school_id=t.school_id
      LEFT JOIN LATERAL (SELECT latitude,longitude,accuracy_metres,observed_at FROM transport_location_samples location
        WHERE location.trip_id=t.id AND t.state='in_progress' AND rider.state='boarded'
          AND t.service_date=${localDate}::date AND COALESCE(policy.enabled,true)
          AND (t.direction='to_institution' OR EXISTS(SELECT 1 FROM departure_plans p WHERE p.student_id=rider.student_id AND p.trip_id=t.id AND p.is_current AND p.state NOT IN ('completed','cancelled')))
          AND location.received_at>=now()-make_interval(hours=>COALESCE(policy.location_retention_hours,24))
        ORDER BY observed_at DESC,id DESC LIMIT 1) point ON true
      WHERE rider.student_id=${selected.id}::uuid AND t.school_id=${selected.school_id}::uuid AND t.service_date=${selectedDate}::date
      ORDER BY t.scheduled_departure_time,t.id`.execute(this.db)).rows;
    const requests=learner?[]:await this.db.selectFrom("departure_change_requests").select(["id","service_date","status","requested_mode","reason","decision_note","revision","requester_user_id","created_at"]).where("school_id","=",selected.school_id).where("student_id","=",selected.id).orderBy("created_at","desc").limit(20).execute();
    const authorities=learner?[]:(await sql<any>`SELECT a.id,a.valid_from,a.valid_until,CASE WHEN a.guardian_relationship_id IS NULL THEN 'collector' ELSE 'guardian' END kind,
      concat_ws(' ',person.first_name,person.last_name) name,right(person.contact_phone,4) phone_last4
      FROM departure_collection_authorities a LEFT JOIN guardian_relationships gr ON gr.id=a.guardian_relationship_id
      LEFT JOIN guardian_school_profiles gp ON gp.school_id=a.school_id AND gp.guardian_id=gr.guardian_id
      JOIN school_people person ON person.id=COALESCE(a.collector_person_id,gp.person_id)
      WHERE a.school_id=${selected.school_id}::uuid AND a.student_id=${selected.id}::uuid AND a.status='active'
        AND ${selectedDate}::date BETWEEN a.valid_from AND COALESCE(a.valid_until,'infinity'::date) ORDER BY person.first_name`.execute(this.db)).rows;
    return {student:{...selected},children,service_date:selectedDate,local_date:localDate,can_request:!learner,plan:result.rows[0]?.plan??null,request:learner?null:result.rows[0]?.request??null,requests,
      trip:journeys.find(journey=>journey.id===result.rows[0]?.plan?.trip_id)??null,journeys,authorities,
      policy:policy??{enabled:true,enabled_modes:["guardian_pickup","authorized_collector","school_transport","external_transport"],change_cutoff:"13:00"},map:{tile_url:process.env.MAP_TILE_URL||"https://tile.openstreetmap.org/{z}/{x}/{y}.png",attribution:"© OpenStreetMap contributors"}};
  }

  async workspace(user:AuthUser,schoolId:string) {
    await this.membership(user,schoolId,true);
    const school=await this.db.selectFrom("schools").select(["id","name","timezone","institution_kind"]).where("id","=",schoolId).executeTakeFirstOrThrow();
    const [policy,routes,trips,patterns,swaps,requests,students,collectors,authorities,guardianLinks,plans]=await Promise.all([
      this.db.selectFrom("departure_policies").selectAll().where("school_id","=",schoolId).executeTakeFirst(),
      sql<any>`SELECT r.*,COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'direction',s.direction,'sequence',s.sequence,'name',s.name,'planned_time',s.planned_time,'latitude',s.latitude,'longitude',s.longitude) ORDER BY s.direction,s.sequence) FILTER(WHERE s.id IS NOT NULL),'[]') stops FROM transport_routes r LEFT JOIN transport_stops s ON s.route_id=r.id WHERE r.school_id=${schoolId}::uuid GROUP BY r.id ORDER BY r.name`.execute(this.db),
      sql<any>`SELECT t.*,r.name route_name,r.code route_code,r.vehicle_label,concat(u.first_name,' ',u.last_name) collector_name,
        concat(backup.first_name,' ',backup.last_name) backup_collector_name,pattern.label service_pattern_label,
        count(roster.*)::int roster_count,count(*) FILTER(WHERE roster.state='boarded')::int boarded_count,count(*) FILTER(WHERE roster.state='dropped')::int dropped_count,
        (SELECT row_to_json(l) FROM transport_location_samples l WHERE l.trip_id=t.id ORDER BY l.observed_at DESC,l.id DESC LIMIT 1) latest_location
        FROM transport_trips t JOIN transport_routes r ON r.id=t.route_id JOIN users u ON u.id=t.assigned_collector_user_id
        LEFT JOIN users backup ON backup.id=t.backup_collector_user_id LEFT JOIN transport_service_patterns pattern ON pattern.id=t.service_pattern_id
        LEFT JOIN transport_trip_roster roster ON roster.trip_id=t.id
        WHERE t.school_id=${schoolId}::uuid AND t.service_date BETWEEN current_date-7 AND current_date+90
        GROUP BY t.id,r.id,u.id,backup.id,pattern.id ORDER BY t.service_date,t.scheduled_departure_time,t.created_at`.execute(this.db),
      sql<any>`SELECT pattern.*,route.name route_name,route.code route_code,route.vehicle_label,
        concat(primary_user.first_name,' ',primary_user.last_name) primary_collector_name,
        concat(backup_user.first_name,' ',backup_user.last_name) backup_collector_name
        FROM transport_service_patterns pattern JOIN transport_routes route ON route.id=pattern.route_id
        JOIN users primary_user ON primary_user.id=pattern.primary_collector_user_id
        LEFT JOIN users backup_user ON backup_user.id=pattern.backup_collector_user_id
        WHERE pattern.school_id=${schoolId}::uuid ORDER BY pattern.status,pattern.label,pattern.departure_time`.execute(this.db),
      sql<any>`SELECT swap.*,request_trip.service_date requester_service_date,request_trip.scheduled_departure_time requester_departure_time,
        request_route.name requester_route_name,target_trip.service_date target_service_date,target_trip.scheduled_departure_time target_departure_time,
        target_route.name target_route_name,concat(requester.first_name,' ',requester.last_name) requester_name,
        concat(target.first_name,' ',target.last_name) target_name
        FROM transport_duty_swap_requests swap
        JOIN transport_trips request_trip ON request_trip.id=swap.requester_trip_id JOIN transport_routes request_route ON request_route.id=request_trip.route_id
        LEFT JOIN transport_trips target_trip ON target_trip.id=swap.target_trip_id LEFT JOIN transport_routes target_route ON target_route.id=target_trip.route_id
        JOIN users requester ON requester.id=swap.requester_user_id JOIN users target ON target.id=swap.target_user_id
        WHERE swap.school_id=${schoolId}::uuid AND swap.status IN ('submitted','accepted') ORDER BY swap.created_at`.execute(this.db),
      sql<any>`SELECT req.*,concat(person.first_name,' ',person.last_name) student_name FROM departure_change_requests req JOIN students s ON s.id=req.student_id JOIN school_people person ON person.id=s.person_id WHERE req.school_id=${schoolId}::uuid AND req.status='submitted' ORDER BY req.created_at`.execute(this.db),
      sql<any>`SELECT s.id,s.admission_number,concat(p.first_name,' ',p.last_name) name FROM students s JOIN school_people p ON p.id=s.person_id WHERE s.school_id=${schoolId}::uuid ORDER BY p.first_name,p.last_name LIMIT 500`.execute(this.db),
      sql<any>`SELECT m.user_id AS id,concat(u.first_name,' ',u.last_name) name,m.role
        FROM school_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.school_id=${schoolId}::uuid AND m.is_active AND m.role IN ('staff','admin')
        ORDER BY u.first_name,u.last_name`.execute(this.db),
      sql<any>`SELECT a.*,concat(person.first_name,' ',person.last_name) collector_name FROM departure_collection_authorities a LEFT JOIN guardian_relationships gr ON gr.id=a.guardian_relationship_id LEFT JOIN guardian_school_profiles gp ON gp.school_id=a.school_id AND gp.guardian_id=gr.guardian_id JOIN school_people person ON person.id=COALESCE(a.collector_person_id,gp.person_id) WHERE a.school_id=${schoolId}::uuid AND a.status='active' ORDER BY a.created_at DESC`.execute(this.db),
      sql<any>`SELECT gr.id,gr.student_id,person.id person_id,concat(person.first_name,' ',person.last_name) guardian_name,gr.relationship FROM guardian_relationships gr JOIN guardian_school_profiles gp ON gp.school_id=gr.school_id AND gp.guardian_id=gr.guardian_id JOIN school_people person ON person.id=gp.person_id WHERE gr.school_id=${schoolId}::uuid ORDER BY person.first_name,person.last_name`.execute(this.db),
      sql<any>`SELECT p.*,concat(person.first_name,' ',person.last_name) student_name,a.collector_name FROM departure_plans p JOIN students s ON s.id=p.student_id JOIN school_people person ON person.id=s.person_id LEFT JOIN LATERAL (SELECT concat(cp.first_name,' ',cp.last_name) collector_name FROM departure_collection_authorities ca LEFT JOIN guardian_relationships gr ON gr.id=ca.guardian_relationship_id LEFT JOIN guardian_school_profiles gp ON gp.school_id=ca.school_id AND gp.guardian_id=gr.guardian_id JOIN school_people cp ON cp.id=COALESCE(ca.collector_person_id,gp.person_id) WHERE ca.id=p.authority_id) a ON true WHERE p.school_id=${schoolId}::uuid AND p.is_current AND p.service_date BETWEEN current_date AND current_date+7 ORDER BY p.service_date,person.first_name`.execute(this.db),
    ]);
    return {school,policy:policy??{school_id:schoolId,enabled:true,enabled_modes:["guardian_pickup","authorized_collector","independent_departure","school_transport","external_transport"],change_cutoff:"13:00",location_retention_hours:24,location_stale_seconds:90,minimum_location_interval_seconds:10,maximum_location_accuracy_metres:250,revision:0},routes:routes.rows,trips:trips.rows,patterns:patterns.rows,swaps:swaps.rows,requests:requests.rows,students:students.rows,collectors:collectors.rows,authorities:authorities.rows,guardian_links:guardianLinks.rows,plans:plans.rows,map:{tile_url:process.env.MAP_TILE_URL||"https://tile.openstreetmap.org/{z}/{x}/{y}.png",attribution:"© OpenStreetMap contributors"}};
  }

  async savePolicy(user:AuthUser,schoolId:string,body:unknown) {
    await this.membership(user,schoolId,true);
    const input=z.object({expected_revision:z.number().int().min(0),enabled:z.boolean(),enabled_modes:z.array(mode).min(1),change_cutoff:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),location_retention_hours:z.number().int().min(1).max(168),location_stale_seconds:z.number().int().min(30).max(600)}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      const current=await tx.selectFrom("departure_policies").selectAll().where("school_id","=",schoolId).forUpdate().executeTakeFirst();
      if((current?.revision??0)!==input.expected_revision) throw new ConflictException("Departure policy changed. Reload and review it again.");
      const {expected_revision, ...policy}=input;
      void expected_revision;
      const row=current?await tx.updateTable("departure_policies").set({...policy,revision:current.revision+1,updated_by:user.id,updated_at:new Date()}).where("school_id","=",schoolId).returningAll().executeTakeFirstOrThrow():await tx.insertInto("departure_policies").values({...policy,school_id:schoolId,revision:1,updated_by:user.id}).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,schoolId,user.id,"policy.updated","departure_policy",schoolId,{revision:row.revision}); await this.emit(tx,schoolId,"departure.updated","departure_policy",schoolId,undefined,{revision:row.revision}); return row;
    });
  }

  async createRoute(user:AuthUser,schoolId:string,body:unknown) {
    await this.membership(user,schoolId,true);
    const input=z.object({code:z.string().trim().min(2).max(32).transform(v=>v.toUpperCase()),name:z.string().trim().min(2).max(120),service_kind:z.enum(["institution_managed","contracted"]).default("institution_managed"),vehicle_label:z.string().trim().max(80).default(""),provider_name:z.string().trim().max(120).default(""),stops:z.array(z.object({direction,sequence:z.number().int().min(1).max(500),name:z.string().trim().min(2).max(120),planned_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),latitude:z.number().min(-90).max(90).nullable().optional(),longitude:z.number().min(-180).max(180).nullable().optional()})).min(1)}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      const route=await tx.insertInto("transport_routes").values({school_id:schoolId,code:input.code,name:input.name,service_kind:input.service_kind,vehicle_label:input.vehicle_label,provider_name:input.provider_name,created_by:user.id,updated_by:user.id}).returningAll().executeTakeFirstOrThrow();
      for(const stop of input.stops) await tx.insertInto("transport_stops").values({school_id:schoolId,route_id:route.id,direction:stop.direction,sequence:stop.sequence,name:stop.name,planned_time:stop.planned_time??null,latitude:stop.latitude==null?null:String(stop.latitude),longitude:stop.longitude==null?null:String(stop.longitude)}).execute();
      await this.audit(tx,schoolId,user.id,"route.created","transport_route",route.id,{stops:input.stops.length}); await this.emit(tx,schoolId,"transport.updated","transport_route",route.id,undefined,{revision:route.revision}); return route;
    });
  }

  async assignStudent(user:AuthUser,schoolId:string,body:unknown) {
    await this.membership(user,schoolId,true);
    const input=z.object({student_id:uuid,route_id:uuid,stop_id:uuid,direction,valid_from:date,valid_until:date.nullable().optional()}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      if(input.valid_until&&input.valid_until<input.valid_from) throw new BadRequestException("The end date cannot be before the start date.");
      if(input.valid_from<await this.localDate(tx,schoolId)) throw new BadRequestException("Route assignments must start today or later.");
      const future=await tx.selectFrom("transport_student_assignments").select("id").where("school_id","=",schoolId).where("student_id","=",input.student_id).where("direction","=",input.direction).where("status","=","active").where("valid_from",">",input.valid_from).executeTakeFirst();
      if(future) throw new ConflictException("A later route assignment already exists. Review it before inserting an earlier change.");
      const stop=await tx.selectFrom("transport_stops").selectAll().where("school_id","=",schoolId).where("id","=",input.stop_id).where("route_id","=",input.route_id).where("direction","=",input.direction).executeTakeFirst(); if(!stop) throw new BadRequestException("The stop does not belong to this route and direction.");
      await tx.updateTable("transport_student_assignments").set({status:"ended",valid_until:sql<string>`greatest(valid_from, ${input.valid_from}::date - 1)`}).where("school_id","=",schoolId).where("student_id","=",input.student_id).where("direction","=",input.direction).where("status","=","active").execute();
      const row=await tx.insertInto("transport_student_assignments").values({school_id:schoolId,...input,valid_until:input.valid_until??null,created_by:user.id}).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,schoolId,user.id,"student.assigned","transport_assignment",row.id,{student_id:input.student_id,route_id:input.route_id}); await this.emit(tx,schoolId,"transport.updated","transport_assignment",row.id,input.student_id,{action:"assigned"}); return row;
    });
  }

  private async assertTripStaff(tx:Transaction<Database>,schoolId:string,userId:string,label="collector") {
    const membership=await tx.selectFrom("school_memberships").select("id").where("school_id","=",schoolId).where("user_id","=",userId).where("is_active","=",true).where("role","in",["staff","admin"]).executeTakeFirst();
    if(!membership) throw new BadRequestException(`Choose an active ${label} from this institution.`);
    await assertActiveSchoolStaffMember(tx,userId,schoolId,"transport_attendant");
  }

  private async assertNoTripDutyConflict(tx:Transaction<Database>,schoolId:string,userId:string,serviceDate:string,departureTime:string,excludeTripIds:string[]=[]){
    let query=tx.selectFrom("transport_trips").select(["id","route_id"]).where("school_id","=",schoolId).where("assigned_collector_user_id","=",userId).where("service_date","=",serviceDate).where("scheduled_departure_time","=",departureTime).where("state","in",["planned","boarding","in_progress"]).where("collector_assignment_status","!=","declined");
    if(excludeTripIds.length) query=query.where("id","not in",excludeTripIds);
    if(await query.executeTakeFirst()) throw new ConflictException("This collector already has another trip at the same date and departure time.");
  }

  private async prepareTripRoster(tx:Transaction<Database>,user:AuthUser,trip:{id:string;school_id:string;route_id:string;direction:"to_institution"|"from_institution";service_date:string;state:string;roster_frozen_at:Date|null}) {
    if(trip.state!=="planned"||trip.roster_frozen_at) throw new ConflictException("Only an unfrozen planned trip roster can be refreshed.");
    const assigned=(await sql<{student_id:string;stop_id:string}>`SELECT student_id,stop_id FROM (
      SELECT DISTINCT ON(student_id) student_id,stop_id,route_id FROM transport_student_assignments
      WHERE school_id=${trip.school_id}::uuid AND direction=${trip.direction}
        AND valid_from<=${trip.service_date}::date AND COALESCE(valid_until,'infinity'::date)>=${trip.service_date}::date
      ORDER BY student_id,valid_from DESC,created_at DESC,id DESC
    ) effective WHERE route_id=${trip.route_id}::uuid`.execute(tx)).rows;
    const existing=await tx.selectFrom("transport_trip_roster").select(["student_id","state","stop_id"]).where("trip_id","=",trip.id).execute();
    if(!assigned.length&&!existing.length) throw new BadRequestException("Assign at least one learner to this route before preparing its roster.");
    const existingIds=new Set(existing.map(item=>item.student_id));
    for(const rider of assigned){
      if(existingIds.has(rider.student_id)) {
        const previous=existing.find(item=>item.student_id===rider.student_id)!;
        if(previous.state==="expected"&&previous.stop_id!==rider.stop_id) {
          await tx.updateTable("transport_trip_roster").set({stop_id:rider.stop_id,revision:sql<number>`revision+1`,updated_at:new Date()}).where("trip_id","=",trip.id).where("student_id","=",rider.student_id).execute();
          await tx.updateTable("departure_plans").set({stop_id:rider.stop_id,revision:sql<number>`revision+1`,updated_at:new Date()}).where("trip_id","=",trip.id).where("student_id","=",rider.student_id).where("is_current","=",true).where("state","in",["planned","ready"]).execute();
        }
      }
      else {
        await tx.insertInto("transport_trip_roster").values({school_id:trip.school_id,trip_id:trip.id,student_id:rider.student_id,stop_id:rider.stop_id}).execute();
        if(trip.direction==="from_institution") {
          const approved=await tx.selectFrom("departure_plans").select("id").where("school_id","=",trip.school_id).where("student_id","=",rider.student_id).where("service_date","=",trip.service_date).where("is_current","=",true).executeTakeFirst();
          if(!approved) await this.upsertPlan(tx,user,trip.school_id,{student_id:rider.student_id,service_date:trip.service_date,mode:"school_transport",trip_id:trip.id,stop_id:rider.stop_id,source:"transport_assignment"});
          else await tx.updateTable("transport_trip_roster").set({state:"not_riding",revision:2,recorded_by:user.id,outcome_note:"An approved departure arrangement already exists; school review is required to change it."}).where("trip_id","=",trip.id).where("student_id","=",rider.student_id).execute();
        }
      }
    }
    const assignedIds=new Set(assigned.map(item=>item.student_id));
    for(const rider of existing.filter(item=>!assignedIds.has(item.student_id)&&item.state==="expected")) {
      await tx.updateTable("transport_trip_roster").set({state:"exception",revision:sql<number>`revision+1`,recorded_by:user.id,outcome_note:"Route assignment changed. School review is required before travel.",updated_at:new Date()}).where("trip_id","=",trip.id).where("student_id","=",rider.student_id).execute();
    }
    return {roster_count:new Set([...existingIds,...assignedIds]).size,added_count:assigned.filter(item=>!existingIds.has(item.student_id)).length,retained_exception_count:existing.filter(item=>!assignedIds.has(item.student_id)).length};
  }

  async createTrip(user:AuthUser,schoolId:string,body:unknown) {
    await this.membership(user,schoolId,true);
    const input=z.object({route_id:uuid,service_date:date,direction,scheduled_departure_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),assigned_collector_user_id:uuid,backup_collector_user_id:uuid.nullable().optional()}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      await this.assertTripStaff(tx,schoolId,input.assigned_collector_user_id);
      if(input.backup_collector_user_id){ if(input.backup_collector_user_id===input.assigned_collector_user_id) throw new BadRequestException("Primary and backup collectors must be different."); await this.assertTripStaff(tx,schoolId,input.backup_collector_user_id,"backup collector"); }
      const route=await tx.selectFrom("transport_routes").select("id").where("school_id","=",schoolId).where("id","=",input.route_id).where("status","=","active").executeTakeFirst(); if(!route) throw new BadRequestException("Choose an active route from this institution.");
      const stopTime=await tx.selectFrom("transport_stops").select(({fn})=>fn.min<string>("planned_time").as("time")).where("route_id","=",input.route_id).where("direction","=",input.direction).executeTakeFirst();
      const scheduled=input.scheduled_departure_time??stopTime?.time?.slice(0,5)??(input.direction==="to_institution"?"07:30":"15:30");
      await this.assertNoTripDutyConflict(tx,schoolId,input.assigned_collector_user_id,input.service_date,scheduled);
      const trip=await tx.insertInto("transport_trips").values({school_id:schoolId,route_id:input.route_id,service_date:input.service_date,direction:input.direction,scheduled_departure_time:scheduled,assigned_collector_user_id:input.assigned_collector_user_id,backup_collector_user_id:input.backup_collector_user_id??null,collector_assignment_status:"pending",assignment_accepted_at:null,assignment_declined_at:null,created_by:user.id}).returningAll().executeTakeFirstOrThrow();
      const prepared=await this.prepareTripRoster(tx,user,trip);
      await this.audit(tx,schoolId,user.id,"trip.created","transport_trip",trip.id,{...prepared,assigned_collector_user_id:input.assigned_collector_user_id}); await this.emit(tx,schoolId,"transport.updated","transport_trip",trip.id,undefined,{revision:trip.revision}); return {...trip,...prepared};
    });
  }

  async createServicePattern(user:AuthUser,schoolId:string,body:unknown) {
    await this.membership(user,schoolId,true);
    const input=z.object({route_id:uuid,label:z.string().trim().min(2).max(120),direction,weekdays:z.array(z.number().int().min(1).max(7)).min(1).max(7),departure_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),primary_collector_user_id:uuid,backup_collector_user_id:uuid.nullable().optional(),valid_from:date,valid_until:date.nullable().optional()}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      await this.assertTripStaff(tx,schoolId,input.primary_collector_user_id);
      if(input.backup_collector_user_id){ if(input.backup_collector_user_id===input.primary_collector_user_id) throw new BadRequestException("Primary and backup collectors must be different."); await this.assertTripStaff(tx,schoolId,input.backup_collector_user_id,"backup collector"); }
      const route=await tx.selectFrom("transport_routes").select("id").where("school_id","=",schoolId).where("id","=",input.route_id).where("status","=","active").executeTakeFirst(); if(!route) throw new BadRequestException("Choose an active route from this institution.");
      const stop=await tx.selectFrom("transport_stops").select("id").where("school_id","=",schoolId).where("route_id","=",input.route_id).where("direction","=",input.direction).executeTakeFirst(); if(!stop) throw new BadRequestException("Add stops for this route direction before scheduling it.");
      const overlap=await sql<{id:string}>`SELECT id FROM transport_service_patterns WHERE school_id=${schoolId}::uuid AND status='active'
        AND primary_collector_user_id=${input.primary_collector_user_id}::uuid AND departure_time=${input.departure_time}::time
        AND weekdays && ${input.weekdays}::smallint[] AND daterange(valid_from,COALESCE(valid_until,'infinity'::date),'[]') && daterange(${input.valid_from}::date,COALESCE(${input.valid_until??null}::date,'infinity'::date),'[]') LIMIT 1`.execute(tx);
      if(overlap.rows.length) throw new ConflictException("This collector already has an overlapping service schedule at that time.");
      const row=await tx.insertInto("transport_service_patterns").values({school_id:schoolId,route_id:input.route_id,label:input.label,direction:input.direction,weekdays:[...new Set(input.weekdays)].sort(),departure_time:input.departure_time,primary_collector_user_id:input.primary_collector_user_id,backup_collector_user_id:input.backup_collector_user_id??null,valid_from:input.valid_from,valid_until:input.valid_until??null,created_by:user.id,updated_by:user.id}).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,schoolId,user.id,"service_pattern.created","transport_service_pattern",row.id,{weekdays:row.weekdays,route_id:row.route_id});
      await this.emit(tx,schoolId,"transport.updated","transport_service_pattern",row.id,undefined,{revision:row.revision}); return row;
    });
  }

  private serviceDates(from:string,to:string) {
    const start=new Date(`${from}T00:00:00.000Z`); const end=new Date(`${to}T00:00:00.000Z`);
    const days=Math.round((end.getTime()-start.getTime())/86400000);
    if(!Number.isFinite(days)||days<0||days>42) throw new BadRequestException("Prepare between one day and six weeks at a time.");
    return Array.from({length:days+1},(_,index)=>{const current=new Date(start.getTime()+index*86400000);return {date:current.toISOString().slice(0,10),weekday:current.getUTCDay()===0?7:current.getUTCDay()};});
  }

  async generateTrips(user:AuthUser,schoolId:string,body:unknown) {
    await this.membership(user,schoolId,true);
    const input=z.object({from_date:date,to_date:date,pattern_id:uuid.optional()}).parse(body); const dates=this.serviceDates(input.from_date,input.to_date);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      let query=tx.selectFrom("transport_service_patterns").selectAll().where("school_id","=",schoolId).where("status","=","active").where("valid_from","<=",input.to_date).where(eb=>eb.or([eb("valid_until","is",null),eb("valid_until",">=",input.from_date)]));
      if(input.pattern_id) query=query.where("id","=",input.pattern_id);
      const patterns=await query.execute(); if(!patterns.length) throw new BadRequestException("No active service pattern covers these dates.");
      const created:Array<{id:string;service_date:string;pattern_id:string;roster_count:number}>=[]; let existingCount=0;
      for(const pattern of patterns){
        for(const day of dates){
          if(!pattern.weekdays.includes(day.weekday)||day.date<pattern.valid_from||(pattern.valid_until&&day.date>pattern.valid_until)) continue;
          const existing=await tx.selectFrom("transport_trips").select("id").where("route_id","=",pattern.route_id).where("service_date","=",day.date).where("direction","=",pattern.direction).where("scheduled_departure_time","=",pattern.departure_time).executeTakeFirst();
          if(existing){existingCount+=1;continue;}
          await this.assertNoTripDutyConflict(tx,schoolId,pattern.primary_collector_user_id,day.date,pattern.departure_time);
          const trip=await tx.insertInto("transport_trips").values({school_id:schoolId,route_id:pattern.route_id,service_date:day.date,direction:pattern.direction,service_pattern_id:pattern.id,scheduled_departure_time:pattern.departure_time,assigned_collector_user_id:pattern.primary_collector_user_id,backup_collector_user_id:pattern.backup_collector_user_id,collector_assignment_status:"pending",assignment_accepted_at:null,assignment_declined_at:null,created_by:user.id}).returningAll().executeTakeFirstOrThrow();
          const prepared=await this.prepareTripRoster(tx,user,trip); created.push({id:trip.id,service_date:day.date,pattern_id:pattern.id,roster_count:prepared.roster_count});
          await this.audit(tx,schoolId,user.id,"trip.generated","transport_trip",trip.id,{pattern_id:pattern.id,roster_count:prepared.roster_count});
          await this.emit(tx,schoolId,"transport.updated","transport_trip",trip.id,undefined,{revision:trip.revision,action:"generated"});
        }
      }
      return {created_count:created.length,existing_count:existingCount,trips:created};
    });
  }

  async refreshTripRoster(user:AuthUser,schoolId:string,tripId:string,body:unknown) {
    await this.membership(user,schoolId,true); const input=z.object({expected_revision:z.number().int().positive()}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      const trip=await tx.selectFrom("transport_trips").selectAll().where("school_id","=",schoolId).where("id","=",tripId).forUpdate().executeTakeFirst(); if(!trip) throw new NotFoundException("Trip not found."); if(trip.revision!==input.expected_revision) throw new ConflictException("Trip changed. Reload before refreshing its roster.");
      const prepared=await this.prepareTripRoster(tx,user,trip); const row=await tx.updateTable("transport_trips").set({revision:trip.revision+1,updated_at:new Date()}).where("id","=",trip.id).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,schoolId,user.id,"roster.refreshed","transport_trip",trip.id,prepared); await this.emit(tx,schoolId,"transport.updated","transport_trip",trip.id,undefined,{revision:row.revision,action:"roster_refreshed"}); return {...row,...prepared};
    });
  }

  async assignTripCollector(user:AuthUser,schoolId:string,tripId:string,body:unknown) {
    await this.membership(user,schoolId,true); const input=z.object({collector_user_id:uuid,backup_collector_user_id:uuid.nullable().optional(),expected_revision:z.number().int().positive(),note:z.string().trim().min(3).max(500)}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      const trip=await tx.selectFrom("transport_trips").selectAll().where("school_id","=",schoolId).where("id","=",tripId).forUpdate().executeTakeFirst(); if(!trip) throw new NotFoundException("Trip not found."); if(trip.state!=="planned"||trip.roster_frozen_at) throw new ConflictException("Staff can be reassigned only before boarding opens."); if(trip.revision!==input.expected_revision) throw new ConflictException("Trip changed. Reload before assigning staff.");
      await this.assertTripStaff(tx,schoolId,input.collector_user_id); if(input.backup_collector_user_id){if(input.backup_collector_user_id===input.collector_user_id)throw new BadRequestException("Primary and backup collectors must be different.");await this.assertTripStaff(tx,schoolId,input.backup_collector_user_id,"backup collector");}
      await this.assertNoTripDutyConflict(tx,schoolId,input.collector_user_id,trip.service_date,trip.scheduled_departure_time,[trip.id]);
      const row=await tx.updateTable("transport_trips").set({assigned_collector_user_id:input.collector_user_id,backup_collector_user_id:input.backup_collector_user_id??null,collector_assignment_status:"pending",assignment_accepted_at:null,assignment_declined_at:null,assignment_note:input.note,revision:trip.revision+1,updated_at:new Date()}).where("id","=",trip.id).returningAll().executeTakeFirstOrThrow();
      await tx.updateTable("transport_duty_swap_requests").set({status:"cancelled",revision:sql<number>`revision+1`,updated_at:new Date()}).where("requester_trip_id","=",trip.id).where("status","in",["submitted","accepted"]).execute();
      await this.audit(tx,schoolId,user.id,"trip.collector_assigned","transport_trip",trip.id,{from:trip.assigned_collector_user_id,to:input.collector_user_id,note:input.note}); await this.emit(tx,schoolId,"transport.updated","transport_trip",trip.id,undefined,{revision:row.revision,action:"collector_assigned"}); return row;
    });
  }

  async requestDutySwap(user:AuthUser,body:unknown) {
    const input=z.object({requester_trip_id:uuid,request_type:z.enum(["cover","exchange"]),target_user_id:uuid,target_trip_id:uuid.nullable().optional(),reason:z.string().trim().min(3).max(500)}).parse(body);
    return this.db.transaction().execute(async tx=>{
      const trip=await this.operatingTrip(tx,user,input.requester_trip_id); if(trip.assigned_collector_user_id!==user.id) throw new ForbiddenException("Only the current assignee can request a duty change."); if(trip.state!=="planned"||trip.roster_frozen_at) throw new ConflictException("A journey cannot be transferred after boarding opens."); if(trip.collector_assignment_status!=="accepted") throw new ConflictException("Accept this duty before requesting a change."); if(input.target_user_id===user.id) throw new BadRequestException("Choose another staff member."); await this.assertTripStaff(tx,trip.school_id,input.target_user_id,"replacement collector");
      let targetRevision:number|null=null;
      await this.assertDutyChangeWindow(tx,trip.id);
      if(input.request_type==="exchange"){
        if(!input.target_trip_id) throw new BadRequestException("Choose the colleague's trip to exchange."); const target=await tx.selectFrom("transport_trips").selectAll().where("school_id","=",trip.school_id).where("id","=",input.target_trip_id).forUpdate().executeTakeFirst(); if(!target||target.assigned_collector_user_id!==input.target_user_id) throw new BadRequestException("The exchange trip is not assigned to that colleague."); if(target.state!=="planned"||target.roster_frozen_at||target.collector_assignment_status!=="accepted") throw new ConflictException("The colleague's trip is not available for exchange."); targetRevision=target.revision;
        await this.assertDutyChangeWindow(tx,input.target_trip_id);
      }else if(input.target_trip_id) throw new BadRequestException("A cover request does not exchange another trip.");
      const row=await tx.insertInto("transport_duty_swap_requests").values({school_id:trip.school_id,request_type:input.request_type,requester_trip_id:trip.id,target_trip_id:input.request_type==="exchange"?input.target_trip_id??null:null,requester_user_id:user.id,target_user_id:input.target_user_id,requester_trip_revision:trip.revision,target_trip_revision:targetRevision,reason:input.reason}).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,trip.school_id,user.id,"duty_swap.requested","transport_duty_swap",row.id,{request_type:row.request_type,requester_trip_id:trip.id,target_trip_id:row.target_trip_id}); await this.emit(tx,trip.school_id,"transport.updated","transport_duty_swap",row.id,undefined,{revision:row.revision,action:"requested"}); return row;
    });
  }

  async respondDutySwap(user:AuthUser,swapId:string,body:unknown) {
    const input=z.object({decision:z.enum(["accepted","rejected"]),expected_revision:z.number().int().positive(),note:z.string().trim().max(500).default("")}).parse(body);
    return this.db.transaction().execute(async tx=>{
      uuid.parse(swapId);
      const reference=await tx.selectFrom("transport_duty_swap_requests").select("school_id").where("id","=",swapId).where("target_user_id","=",user.id).executeTakeFirst();
      if(!reference) throw new NotFoundException("Duty request not found.");
      await this.lockSchool(tx,reference.school_id); await this.assertTripStaff(tx,reference.school_id,user.id);
      const swap=await tx.selectFrom("transport_duty_swap_requests").selectAll().where("id","=",swapId).forUpdate().executeTakeFirst(); if(!swap) throw new NotFoundException("Duty request not found."); if(swap.target_user_id!==user.id) throw new ForbiddenException("Only the requested colleague can respond."); if(swap.status!=="submitted"||swap.revision!==input.expected_revision) throw new ConflictException("This duty request has already changed.");
      await this.assertDutyChangeWindow(tx,swap.requester_trip_id);
      if(swap.target_trip_id) await this.assertDutyChangeWindow(tx,swap.target_trip_id);
      const row=await tx.updateTable("transport_duty_swap_requests").set({status:input.decision,response_note:input.note,target_responded_at:new Date(),revision:swap.revision+1,updated_at:new Date()}).where("id","=",swap.id).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,swap.school_id,user.id,`duty_swap.${input.decision}`,"transport_duty_swap",row.id,{request_type:row.request_type}); await this.emit(tx,swap.school_id,"transport.updated","transport_duty_swap",row.id,undefined,{revision:row.revision,action:input.decision}); return row;
    });
  }

  async decideDutySwap(user:AuthUser,schoolId:string,swapId:string,body:unknown) {
    await this.membership(user,schoolId,true); const input=z.object({decision:z.enum(["approved","declined_by_school"]),expected_revision:z.number().int().positive(),note:z.string().trim().min(3).max(500)}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      const swap=await tx.selectFrom("transport_duty_swap_requests").selectAll().where("school_id","=",schoolId).where("id","=",swapId).forUpdate().executeTakeFirst(); if(!swap) throw new NotFoundException("Duty request not found."); if(swap.status!=="accepted"||swap.revision!==input.expected_revision) throw new ConflictException("The colleague must accept the current request before school approval.");
      const requesterTrip=await tx.selectFrom("transport_trips").selectAll().where("school_id","=",schoolId).where("id","=",swap.requester_trip_id).forUpdate().executeTakeFirstOrThrow(); if(requesterTrip.state!=="planned"||requesterTrip.roster_frozen_at||requesterTrip.revision!==swap.requester_trip_revision) throw new ConflictException("The original trip changed after this request. Create a new duty request.");
      let targetTrip:typeof requesterTrip|undefined;
      if(swap.request_type==="exchange") { targetTrip=await tx.selectFrom("transport_trips").selectAll().where("school_id","=",schoolId).where("id","=",swap.target_trip_id!).forUpdate().executeTakeFirstOrThrow(); if(targetTrip.state!=="planned"||targetTrip.roster_frozen_at||targetTrip.revision!==swap.target_trip_revision||targetTrip.assigned_collector_user_id!==swap.target_user_id) throw new ConflictException("The colleague's trip changed after this request. Create a new duty request."); }
      if(input.decision==="approved"){
        await this.assertDutyChangeWindow(tx,requesterTrip.id);
        if(targetTrip) await this.assertDutyChangeWindow(tx,targetTrip.id);
        await this.assertTripStaff(tx,schoolId,swap.target_user_id);
        if(targetTrip) await this.assertTripStaff(tx,schoolId,swap.requester_user_id);
        await this.assertNoTripDutyConflict(tx,schoolId,swap.target_user_id,requesterTrip.service_date,requesterTrip.scheduled_departure_time,targetTrip?[requesterTrip.id,targetTrip.id]:[requesterTrip.id]);
        if(targetTrip) await this.assertNoTripDutyConflict(tx,schoolId,swap.requester_user_id,targetTrip.service_date,targetTrip.scheduled_departure_time,[requesterTrip.id,targetTrip.id]);
        await tx.updateTable("transport_trips").set({assigned_collector_user_id:swap.target_user_id,collector_assignment_status:"accepted",assignment_accepted_at:new Date(),assignment_declined_at:null,assignment_note:`Approved ${swap.request_type} request ${swap.id}`,revision:requesterTrip.revision+1,updated_at:new Date()}).where("id","=",requesterTrip.id).execute();
        if(targetTrip) await tx.updateTable("transport_trips").set({assigned_collector_user_id:swap.requester_user_id,collector_assignment_status:"accepted",assignment_accepted_at:new Date(),assignment_declined_at:null,assignment_note:`Approved exchange request ${swap.id}`,revision:targetTrip.revision+1,updated_at:new Date()}).where("id","=",targetTrip.id).execute();
      }
      const row=await tx.updateTable("transport_duty_swap_requests").set({status:input.decision,decided_by:user.id,decided_at:new Date(),decision_note:input.note,revision:swap.revision+1,updated_at:new Date()}).where("id","=",swap.id).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,schoolId,user.id,`duty_swap.${input.decision}`,"transport_duty_swap",row.id,{requester_trip_id:row.requester_trip_id,target_trip_id:row.target_trip_id}); await this.emit(tx,schoolId,"transport.updated","transport_duty_swap",row.id,undefined,{revision:row.revision,action:input.decision}); return row;
    });
  }

  async createAuthority(user:AuthUser,schoolId:string,body:unknown) {
    await this.membership(user,schoolId,true);
    const input=z.object({student_id:uuid,guardian_relationship_id:uuid.nullable().optional(),collector:z.object({first_name:z.string().trim().min(1).max(150),last_name:z.string().trim().max(150).default(""),phone:z.string().trim().min(6).max(32)}).nullable().optional(),valid_from:date,valid_until:date.nullable().optional(),verification_method:z.enum(["school_record","in_person","document","guardian_confirmed"]),verification_note:z.string().trim().min(3).max(500)}).refine(v=>Boolean(v.guardian_relationship_id)!==Boolean(v.collector),"Choose either a linked guardian or another collector.").parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      if(input.valid_until&&input.valid_until<input.valid_from) throw new BadRequestException("The end date cannot precede the start date.");
      let personId:string|null=null;
      if(input.collector) personId=(await tx.insertInto("school_people").values({school_id:schoolId,first_name:input.collector.first_name,last_name:input.collector.last_name,contact_phone:input.collector.phone}).returning("id").executeTakeFirstOrThrow()).id;
      if(input.guardian_relationship_id) { const rel=await tx.selectFrom("guardian_relationships").select("id").where("school_id","=",schoolId).where("student_id","=",input.student_id).where("id","=",input.guardian_relationship_id).executeTakeFirst(); if(!rel) throw new BadRequestException("That guardian is not linked to this learner."); }
      const row=await tx.insertInto("departure_collection_authorities").values({school_id:schoolId,student_id:input.student_id,guardian_relationship_id:input.guardian_relationship_id??null,collector_person_id:personId,valid_from:input.valid_from,valid_until:input.valid_until??null,verification_method:input.verification_method,verification_note:input.verification_note,granted_by:user.id}).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,schoolId,user.id,"authority.granted","departure_authority",row.id,{student_id:row.student_id}); await this.emit(tx,schoolId,"departure.updated","departure_authority",row.id,row.student_id,{revision:row.revision}); return row;
    });
  }

  async revokeAuthority(user:AuthUser,schoolId:string,authorityId:string,body:unknown) {
    await this.membership(user,schoolId,true);
    const input=z.object({expected_revision:z.number().int().positive(),reason:z.string().trim().min(3).max(500)}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      const current=await tx.selectFrom("departure_collection_authorities").selectAll().where("school_id","=",schoolId).where("id","=",authorityId).forUpdate().executeTakeFirst();
      if(!current) throw new NotFoundException("Collection authority not found.");
      if(current.status!=="active"||current.revision!==input.expected_revision) throw new ConflictException("Collection authority changed. Reload before revoking it.");
      const row=await tx.updateTable("departure_collection_authorities").set({status:"revoked",revision:current.revision+1,revoked_by:user.id,revoked_at:new Date(),revocation_reason:input.reason}).where("id","=",authorityId).returningAll().executeTakeFirstOrThrow();
      await tx.updateTable("departure_plans").set({state:"exception",revision:sql<number>`revision+1`,updated_at:new Date()}).where("school_id","=",schoolId).where("authority_id","=",authorityId).where("is_current","=",true).where("service_date",">=",sql<string>`current_date`).where("state","in",["planned","ready","change_pending"]).execute();
      await this.audit(tx,schoolId,user.id,"authority.revoked","departure_authority",row.id,{student_id:row.student_id,reason:input.reason});
      await this.emit(tx,schoolId,"departure.updated","departure_authority",row.id,row.student_id,{revision:row.revision});
      return row;
    });
  }

  async createPlan(user:AuthUser,schoolId:string,body:unknown) {
    await this.membership(user,schoolId,true); const input=this.planInput(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId); const row=await this.upsertPlan(tx,user,schoolId,{...input,source:"administrator"}); await this.audit(tx,schoolId,user.id,"plan.created","departure_plan",row.id,{student_id:row.student_id,mode:row.mode}); await this.emit(tx,schoolId,"departure.updated","departure_plan",row.id,row.student_id,{revision:row.revision}); return row; });
  }

  async requestChange(user:AuthUser,body:unknown) {
    const input=this.planInput(body); const family=await this.familyStudent(user,input.student_id); const schoolId=family.selected.school_id;
    return this.db.transaction().execute(async tx=>{
      await this.lockSchool(tx,schoolId);
      await this.familyStudent(user,input.student_id,tx);
      await this.assertRequestAllowed(schoolId,input.service_date,input.mode,tx);
      await this.assertReceiver(tx,schoolId,input);
      const current=await tx.selectFrom("departure_plans").selectAll().where("school_id","=",schoolId).where("student_id","=",input.student_id).where("service_date","=",input.service_date).where("is_current","=",true).forUpdate().executeTakeFirst();
      await this.assertChangeable(tx,schoolId,input.student_id,input.service_date,current);
      const row=await tx.insertInto("departure_change_requests").values({school_id:schoolId,student_id:input.student_id,service_date:input.service_date,current_plan_id:current?.id??null,requested_mode:input.mode,requested_authority_id:input.authority_id??null,requested_trip_id:input.trip_id??null,requested_stop_id:input.stop_id??null,external_arrangement:input.external_arrangement??"",reason:input.reason,channel:"app",requester_user_id:user.id,requester_person_id:null,recorded_by:user.id}).returningAll().executeTakeFirstOrThrow();
      if(current) await tx.updateTable("departure_plans").set({state:"change_pending",revision:current.revision+1,updated_at:new Date()}).where("id","=",current.id).execute();
      await this.audit(tx,schoolId,user.id,"request.submitted","departure_request",row.id,{student_id:row.student_id,mode:row.requested_mode}); await this.emit(tx,schoolId,"departure.updated","departure_request",row.id,row.student_id,{revision:row.revision}); return row;
    });
  }

  async recordOfficeRequest(user:AuthUser,schoolId:string,body:unknown) {
    await this.membership(user,schoolId,true);
    const input=this.planInput(body);
    const assisted=z.object({channel:z.enum(["phone","paper","in_person"]),requester_person_id:uuid}).parse(body);
    const requester=await sql<{id:string}>`SELECT person.id FROM guardian_relationships relationship
      JOIN guardian_school_profiles profile ON profile.school_id=relationship.school_id AND profile.guardian_id=relationship.guardian_id
      JOIN school_people person ON person.id=profile.person_id
      WHERE relationship.school_id=${schoolId}::uuid AND relationship.student_id=${input.student_id}::uuid AND person.id=${assisted.requester_person_id}::uuid`.execute(this.db);
    if(!requester.rows[0]) throw new BadRequestException("Choose a guardian linked to this learner as the assisted requester.");
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      const current=await tx.selectFrom("departure_plans").selectAll().where("school_id","=",schoolId).where("student_id","=",input.student_id).where("service_date","=",input.service_date).where("is_current","=",true).forUpdate().executeTakeFirst();
      await this.assertChangeable(tx,schoolId,input.student_id,input.service_date,current);
      const row=await tx.insertInto("departure_change_requests").values({school_id:schoolId,student_id:input.student_id,service_date:input.service_date,current_plan_id:current?.id??null,requested_mode:input.mode,requested_authority_id:input.authority_id??null,requested_trip_id:input.trip_id??null,requested_stop_id:input.stop_id??null,external_arrangement:input.external_arrangement??"",reason:input.reason,channel:assisted.channel,requester_user_id:null,requester_person_id:assisted.requester_person_id,recorded_by:user.id}).returningAll().executeTakeFirstOrThrow();
      if(current) await tx.updateTable("departure_plans").set({state:"change_pending",revision:current.revision+1,updated_at:new Date()}).where("id","=",current.id).execute();
      await this.audit(tx,schoolId,user.id,"request.office_recorded","departure_request",row.id,{student_id:row.student_id,channel:row.channel});
      await this.emit(tx,schoolId,"departure.updated","departure_request",row.id,row.student_id,{revision:row.revision});
      return row;
    });
  }

  async decideRequest(user:AuthUser,schoolId:string,requestId:string,body:unknown) {
    await this.membership(user,schoolId,true); const input=z.object({decision:z.enum(["approved","rejected"]),expected_revision:z.number().int().positive(),note:z.string().trim().max(500).default("")}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      const req=await tx.selectFrom("departure_change_requests").selectAll().where("school_id","=",schoolId).where("id","=",requestId).forUpdate().executeTakeFirst(); if(!req) throw new NotFoundException("Departure request not found."); if(req.status!=="submitted"||req.revision!==input.expected_revision) throw new ConflictException("This request was already changed. Reload it.");
      const current=await tx.selectFrom("departure_plans").select(["id","state"]).where("school_id","=",schoolId).where("student_id","=",req.student_id).where("service_date","=",req.service_date).where("is_current","=",true).executeTakeFirst();
      if(input.decision==="approved" && ((current?.id??null)!==req.current_plan_id || (current&&current.state!=="change_pending"))) throw new ConflictException("The approved arrangement changed after this request. Decline it and review a new request.");
      if(input.decision==="approved") await this.upsertPlan(tx,user,schoolId,{student_id:req.student_id,service_date:req.service_date,mode:req.requested_mode,authority_id:req.requested_authority_id,trip_id:req.requested_trip_id,stop_id:req.requested_stop_id,external_arrangement:req.external_arrangement,source:req.channel==="app"?"guardian_request":"office_assisted",source_reference_id:req.id});
      else if(req.current_plan_id) await tx.updateTable("departure_plans").set({state:"planned",revision:sql<number>`revision+1`,updated_at:new Date()}).where("id","=",req.current_plan_id).where("is_current","=",true).where("state","=","change_pending").execute();
      const row=await tx.updateTable("departure_change_requests").set({status:input.decision,revision:req.revision+1,decided_by:user.id,decided_at:new Date(),decision_note:input.note,updated_at:new Date()}).where("id","=",req.id).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,schoolId,user.id,`request.${input.decision}`,"departure_request",row.id,{student_id:row.student_id}); await this.emit(tx,schoolId,"departure.updated","departure_request",row.id,row.student_id,{revision:row.revision}); return row;
    });
  }

  async collectorWorkspace(user:AuthUser) {
    const staff=await this.db.selectFrom("school_memberships").innerJoin("users","users.id","school_memberships.user_id").select("school_memberships.school_id").where("school_memberships.user_id","=",user.id).where("school_memberships.is_active","=",true).where("users.is_active","=",true).where("school_memberships.role","in",["staff","admin"]).execute();
    if(!staff.length) throw new ForbiddenException("Active staff membership is required to read transport duties.");
    const trips=(await sql<any>`SELECT t.*,r.name route_name,r.code route_code,r.vehicle_label,r.provider_name,s.name school_name,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',point.id,'direction',point.direction,'sequence',point.sequence,'name',point.name,'planned_time',point.planned_time,'latitude',point.latitude,'longitude',point.longitude) ORDER BY point.sequence) FROM transport_stops point WHERE point.school_id=t.school_id AND point.route_id=t.route_id AND point.direction=t.direction),'[]') stops,
      COALESCE(jsonb_agg(jsonb_build_object('student_id',roster.student_id,'state',roster.state,'revision',roster.revision,'boarded_at',roster.boarded_at,'dropped_at',roster.dropped_at,'outcome_note',roster.outcome_note,'student_name',concat(person.first_name,' ',person.last_name),'admission_number',student.admission_number,'stop_id',stop.id,'stop_name',stop.name,'stop_sequence',stop.sequence,'planned_time',stop.planned_time) ORDER BY stop.sequence,person.first_name) FILTER(WHERE roster.student_id IS NOT NULL),'[]') roster,
      (SELECT row_to_json(l) FROM transport_location_samples l WHERE l.trip_id=t.id ORDER BY l.observed_at DESC,l.id DESC LIMIT 1) latest_location
      FROM transport_trips t JOIN transport_routes r ON r.id=t.route_id JOIN schools s ON s.id=t.school_id
      LEFT JOIN transport_trip_roster roster ON roster.trip_id=t.id LEFT JOIN students student ON student.id=roster.student_id LEFT JOIN school_people person ON person.id=student.person_id LEFT JOIN transport_stops stop ON stop.id=roster.stop_id
      WHERE t.assigned_collector_user_id=${user.id}::uuid AND t.service_date BETWEEN (now() AT TIME ZONE s.timezone)::date-1 AND (now() AT TIME ZONE s.timezone)::date+30 GROUP BY t.id,r.id,s.id ORDER BY t.service_date,t.scheduled_departure_time,t.created_at`.execute(this.db)).rows;
    const colleagues=(await sql<any>`SELECT DISTINCT membership.school_id,membership.user_id id,concat(staff.first_name,' ',staff.last_name) name
      FROM school_memberships mine JOIN school_memberships membership ON membership.school_id=mine.school_id AND membership.is_active AND membership.role IN ('staff','admin')
      JOIN users staff ON staff.id=membership.user_id AND staff.is_active
      WHERE mine.user_id=${user.id}::uuid AND mine.is_active AND mine.role IN ('staff','admin') AND membership.user_id<>${user.id}::uuid ORDER BY name`.execute(this.db)).rows;
    const swapCandidates=(await sql<any>`SELECT trip.id,trip.school_id,trip.service_date,trip.scheduled_departure_time,trip.direction,trip.assigned_collector_user_id,
      route.name route_name,concat(staff.first_name,' ',staff.last_name) collector_name
      FROM transport_trips trip JOIN transport_routes route ON route.id=trip.route_id JOIN users staff ON staff.id=trip.assigned_collector_user_id
      JOIN school_memberships mine ON mine.school_id=trip.school_id AND mine.user_id=${user.id}::uuid AND mine.is_active AND mine.role IN ('staff','admin')
      WHERE trip.assigned_collector_user_id<>${user.id}::uuid AND trip.service_date BETWEEN current_date AND current_date+30
        AND trip.state='planned' AND trip.roster_frozen_at IS NULL AND trip.collector_assignment_status='accepted'
      ORDER BY trip.service_date,trip.scheduled_departure_time,route.name`.execute(this.db)).rows;
    const swaps=(await sql<any>`SELECT swap.*,request_trip.service_date requester_service_date,request_trip.scheduled_departure_time requester_departure_time,
      request_route.name requester_route_name,target_trip.service_date target_service_date,target_trip.scheduled_departure_time target_departure_time,
      target_route.name target_route_name,concat(requester.first_name,' ',requester.last_name) requester_name,concat(target.first_name,' ',target.last_name) target_name
      FROM transport_duty_swap_requests swap JOIN transport_trips request_trip ON request_trip.id=swap.requester_trip_id
      JOIN transport_routes request_route ON request_route.id=request_trip.route_id LEFT JOIN transport_trips target_trip ON target_trip.id=swap.target_trip_id
      LEFT JOIN transport_routes target_route ON target_route.id=target_trip.route_id JOIN users requester ON requester.id=swap.requester_user_id JOIN users target ON target.id=swap.target_user_id
      WHERE (swap.requester_user_id=${user.id}::uuid OR swap.target_user_id=${user.id}::uuid) AND swap.school_id=ANY(${staff.map(member=>member.school_id)}::uuid[]) AND swap.created_at>=now()-interval '30 days'
      ORDER BY swap.created_at DESC`.execute(this.db)).rows;
    const visible=[];
    for(const trip of trips) {
      const member=await this.db.selectFrom("school_memberships").select("id").where("school_id","=",trip.school_id).where("user_id","=",user.id).where("is_active","=",true).where("role","in",["admin","staff"]).executeTakeFirst();
      if(!member) continue;
      if(!["completed","cancelled"].includes(trip.state)&&!await hasScopedSchoolPermission(this.db,user.id,trip.school_id,"departure.collect","trip",trip.id)) continue;
      const policy=await this.db.selectFrom("departure_policies").select(["location_stale_seconds","location_retention_hours"]).where("school_id","=",trip.school_id).executeTakeFirst();
      const location=trip.state==="in_progress"&&trip.latest_location&&Date.now()-new Date(trip.latest_location.received_at).getTime()<=(policy?.location_retention_hours??24)*3_600_000?trip.latest_location:null;
      visible.push({...trip,...await this.journeyWindow(this.db,trip.id),latest_location:location,location_fresh:Boolean(location&&Date.now()-new Date(location.observed_at).getTime()<=(policy?.location_stale_seconds??90)*1000),local_date:await this.localDate(this.db,trip.school_id)});
    }
    const availableCandidates=[];
    for(const candidate of swapCandidates) if((await this.journeyWindow(this.db,candidate.id)).duty_change_available) availableCandidates.push(candidate);
    const currentSwaps=[];
    for(const swap of swaps) currentSwaps.push({...swap,self_service_open:(await this.journeyWindow(this.db,swap.requester_trip_id)).duty_change_available&&(!swap.target_trip_id||(await this.journeyWindow(this.db,swap.target_trip_id)).duty_change_available)});
    return {trips:visible,colleagues,swap_candidates:availableCandidates,swaps:currentSwaps,map:{tile_url:process.env.MAP_TILE_URL||"https://tile.openstreetmap.org/{z}/{x}/{y}.png",attribution:"© OpenStreetMap contributors"},tracking:{foreground_only:true,min_interval_seconds:10}};
  }

  async journey(user:AuthUser,schoolId:string,tripId:string) {
    await this.membership(user,schoolId,true); uuid.parse(tripId);
    const trip=await this.db.selectFrom("transport_trips as trip").innerJoin("transport_routes as route","route.id","trip.route_id").innerJoin("users as collector","collector.id","trip.assigned_collector_user_id")
      .selectAll("trip").select(["route.name as route_name","route.code as route_code","route.vehicle_label","route.provider_name","collector.first_name as collector_name"])
      .where("trip.school_id","=",schoolId).where("trip.id","=",tripId).executeTakeFirst();
    if(!trip) throw new NotFoundException("Journey not found in this institution.");
    const roster=(await sql<any>`SELECT rider.*,concat_ws(' ',person.first_name,person.last_name) student_name,student.admission_number,
      stop.name stop_name,stop.sequence stop_sequence,stop.planned_time FROM transport_trip_roster rider
      JOIN students student ON student.id=rider.student_id JOIN school_people person ON person.id=student.person_id JOIN transport_stops stop ON stop.id=rider.stop_id
      WHERE rider.school_id=${schoolId}::uuid AND rider.trip_id=${tripId}::uuid ORDER BY stop.sequence,person.first_name`.execute(this.db)).rows;
    const policy=await this.db.selectFrom("departure_policies").select(["location_retention_hours","location_stale_seconds"]).where("school_id","=",schoolId).executeTakeFirst();
    const location=trip.state==="in_progress"?await this.db.selectFrom("transport_location_samples").select(["latitude","longitude","accuracy_metres","observed_at"]).where("trip_id","=",tripId).where("received_at",">=",sql<Date>`now()-make_interval(hours=>${policy?.location_retention_hours??24})`).orderBy("observed_at","desc").executeTakeFirst():null;
    const history=await this.db.selectFrom("departure_audits").select(["id","action","metadata","created_at"]).where("school_id","=",schoolId).where("target_id","=",tripId).orderBy("id","desc").limit(50).execute();
    return {trip,roster,history,location:location??null,location_fresh:Boolean(location&&Date.now()-new Date(location.observed_at).getTime()<=(policy?.location_stale_seconds??90)*1000),map:{tile_url:process.env.MAP_TILE_URL||"https://tile.openstreetmap.org/{z}/{x}/{y}.png",attribution:"© OpenStreetMap contributors"}};
  }

  async tripAction(user:AuthUser,tripId:string,action:string,body:unknown,managementSchoolId?:string) {
    const input=z.object({expected_revision:z.number().int().positive(),note:z.string().trim().max(500).default("")}).parse(body);
    if(!["accept","decline","boarding","start","complete","cancel"].includes(action)) throw new BadRequestException("Unsupported trip action.");
    return this.db.transaction().execute(async tx=>{
      const trip=managementSchoolId?await this.managedTrip(tx,user,managementSchoolId,tripId):await this.operatingTrip(tx,user,tripId); if(trip.revision!==input.expected_revision) throw new ConflictException("Trip state changed. Reload the journey.");
      if(managementSchoolId&&(!["complete","cancel"].includes(action)||input.note.length<3)) throw new BadRequestException("School reconciliation requires a closure or cancellation reason.");
      if(action==="accept"||action==="decline"){
        if(trip.state!=="planned"||trip.roster_frozen_at) throw new ConflictException("This duty can no longer be accepted or declined.");
        if(trip.collector_assignment_status!=="pending") throw new ConflictException("This duty response is already recorded.");
        const now=new Date(); const status=action==="accept"?"accepted":"declined";
        const row=await tx.updateTable("transport_trips").set({collector_assignment_status:status,assignment_accepted_at:action==="accept"?now:null,assignment_declined_at:action==="decline"?now:null,assignment_note:input.note,revision:trip.revision+1,updated_at:now}).where("id","=",trip.id).returningAll().executeTakeFirstOrThrow();
        await this.audit(tx,trip.school_id,user.id,`trip.assignment_${status}`,"transport_trip",trip.id,{note:input.note}); await this.emit(tx,trip.school_id,"transport.updated","transport_trip",trip.id,undefined,{revision:row.revision,action:`assignment_${status}`}); return row;
      }
      if(!managementSchoolId&&trip.service_date!==await this.localDate(tx,trip.school_id)) throw new ForbiddenException("Only the currently assigned collector can operate this journey on its service date. Ask school operations to reconcile an overdue journey.");
      if(!managementSchoolId&&trip.collector_assignment_status!=="accepted") throw new ConflictException("Accept the assigned duty before operating this trip.");
      if(!managementSchoolId&&["boarding","cancel"].includes(action)&&!(await this.journeyWindow(tx,trip.id)).controls_available) throw new ConflictException("Journey controls open 30 minutes before departure and are available on the service date. Contact school operations for other changes.");
      if(["boarding","start"].includes(action)) {
        if(action==="start"&&trip.service_date!==await this.localDate(tx,trip.school_id)) throw new ConflictException("Departure is available only on this journey's service date.");
        const active=await tx.selectFrom("transport_trips").select("id").where("assigned_collector_user_id","=",user.id).where("id","!=",trip.id).where("state","in",["boarding","in_progress"]).executeTakeFirst();
        if(active) throw new ConflictException("Complete your active journey before opening another.");
        const policy=await tx.selectFrom("departure_policies").select(["enabled","enabled_modes"]).where("school_id","=",trip.school_id).executeTakeFirst();
        if(policy&&(!policy.enabled||!policy.enabled_modes.includes("school_transport"))) throw new ConflictException("School transport is disabled. Contact school operations.");
      }
      const next=action==="boarding"?"boarding":action==="start"?"in_progress":action==="complete"?"completed":"cancelled";
      const riders=await tx.selectFrom("transport_trip_roster").select("state").where("trip_id","=",tripId).execute();
      assertTripTransition(trip,action,riders,input.note);
      if(action==="cancel") {
        await tx.updateTable("departure_plans").set({state:"exception",revision:sql<number>`revision+1`,updated_at:new Date()}).where("trip_id","=",tripId).where("is_current","=",true).where("state","not in",["completed","cancelled"]).execute();
        await tx.deleteFrom("transport_location_samples").where("trip_id","=",tripId).execute();
      }
      const now=new Date(); const row=await tx.updateTable("transport_trips").set({state:next,revision:trip.revision+1,roster_frozen_at:action==="boarding"||action==="start"?(trip.roster_frozen_at??now):trip.roster_frozen_at,departed_at:action==="start"?now:trip.departed_at,location_started_at:action==="start"?now:trip.location_started_at,completed_at:action==="complete"?now:trip.completed_at,location_ended_at:action==="complete"?now:trip.location_ended_at,cancelled_at:action==="cancel"?now:trip.cancelled_at,cancellation_reason:action==="cancel"?input.note:trip.cancellation_reason,updated_at:now}).where("id","=",tripId).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,trip.school_id,user.id,`trip.${action}`,"transport_trip",trip.id,{from:trip.state,to:next,note:input.note,school_reconciliation:Boolean(managementSchoolId)}); await this.emit(tx,trip.school_id,"transport.updated","transport_trip",trip.id,undefined,{revision:row.revision,action}); return row;
    });
  }

  async recordLocation(user:AuthUser,tripId:string,body:unknown) {
    const input=z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),accuracy_metres:z.number().positive().max(5000),heading_degrees:z.number().min(0).max(360).nullable().optional(),speed_metres_per_second:z.number().min(0).max(100).nullable().optional(),observed_at:z.string().datetime()}).parse(body);
    return this.db.transaction().execute(async tx=>{
      const trip=await this.operatingTrip(tx,user,tripId); if(trip.state!=="in_progress"||trip.collector_assignment_status!=="accepted") throw new ConflictException("Location is accepted only while this accepted trip is in progress.");
      if(!await hasScopedSchoolPermission(tx,user.id,trip.school_id,"departure.collect","trip",trip.id))throw new ForbiddenException("Your current assignment does not allow sharing this journey location.");
      const policy=await tx.selectFrom("departure_policies").selectAll().where("school_id","=",trip.school_id).executeTakeFirst(); if(policy&&!policy.enabled) throw new ForbiddenException("Journey location sharing is disabled by institution policy."); const observed=new Date(input.observed_at); const skew=Math.abs(Date.now()-observed.getTime()); if(skew>120000) throw new BadRequestException("Location time is too old or ahead of the server clock."); if(input.accuracy_metres>(policy?.maximum_location_accuracy_metres??250)) throw new BadRequestException("Location accuracy is too low. Move to a clearer area and retry.");
      const last=await tx.selectFrom("transport_location_samples").select("observed_at").where("trip_id","=",trip.id).orderBy("observed_at","desc").executeTakeFirst(); if(last && observed.getTime()-new Date(last.observed_at).getTime()<(policy?.minimum_location_interval_seconds??10)*1000) return {accepted:false,reason:"too_frequent"};
      const row=await tx.insertInto("transport_location_samples").values({school_id:trip.school_id,trip_id:trip.id,recorded_by:user.id,latitude:String(input.latitude),longitude:String(input.longitude),accuracy_metres:String(input.accuracy_metres),heading_degrees:input.heading_degrees==null?null:String(input.heading_degrees),speed_metres_per_second:input.speed_metres_per_second==null?null:String(input.speed_metres_per_second),observed_at:observed}).returningAll().executeTakeFirstOrThrow();
      await tx.deleteFrom("transport_location_samples").where("school_id","=",trip.school_id).where("received_at","<",sql<Date>`now() - make_interval(hours=>${policy?.location_retention_hours??24})`).execute(); return {accepted:true,location:row};
    });
  }

  async recordRider(user:AuthUser,tripId:string,studentId:string,body:unknown,managementSchoolId?:string) {
    const input=z.object({state:z.enum(["boarded","dropped","not_riding","exception"]),expected_revision:z.number().int().positive(),note:z.string().trim().max(500).default("")}).parse(body);
    return this.db.transaction().execute(async tx=>{
      uuid.parse(studentId);
      const trip=managementSchoolId?await this.managedTrip(tx,user,managementSchoolId,tripId):await this.operatingTrip(tx,user,tripId);
      if(!managementSchoolId&&trip.collector_assignment_status!=="accepted") throw new ConflictException("Accept the duty before recording riders.");
      if(!managementSchoolId&&trip.service_date!==await this.localDate(tx,trip.school_id)) throw new ForbiddenException("Only the currently assigned collector can operate this journey on its service date. Ask school operations to reconcile an overdue journey.");
      if(managementSchoolId&&input.state==="boarded") throw new BadRequestException("Boarding must be recorded by the assigned attendant.");
      if(managementSchoolId&&input.note.length<3) throw new BadRequestException("Describe the evidence used for school reconciliation.");
      const rider=await tx.selectFrom("transport_trip_roster").selectAll().where("trip_id","=",tripId).where("student_id","=",studentId).forUpdate().executeTakeFirst(); if(!rider) throw new NotFoundException("Rider not found on this trip."); if(rider.revision!==input.expected_revision) throw new ConflictException("Rider status changed. Reload the roster.");
      assertRiderTransition(trip,rider,input.state,input.note);
      if(input.state==="boarded"&&trip.direction==="from_institution") {
        const approved=await tx.selectFrom("departure_plans").select(["trip_id","state"]).where("student_id","=",studentId).where("service_date","=",trip.service_date).where("is_current","=",true).executeTakeFirst();
        if(!approved||approved.trip_id!==tripId||!["planned","ready","exception"].includes(approved.state)) throw new ConflictException("The learner's current departure plan does not permit boarding this trip. Ask school operations to review it.");
      }
      const now=new Date(); const row=await tx.updateTable("transport_trip_roster").set({state:input.state,revision:rider.revision+1,boarded_at:input.state==="boarded"?(rider.boarded_at??now):rider.boarded_at,dropped_at:input.state==="dropped"?now:null,recorded_by:user.id,outcome_note:input.note,updated_at:now}).where("trip_id","=",tripId).where("student_id","=",studentId).returningAll().executeTakeFirstOrThrow();
      const plan=await tx.selectFrom("departure_plans").selectAll().where("trip_id","=",tripId).where("student_id","=",studentId).where("is_current","=",true).executeTakeFirst();
      const planState=input.state==="dropped"?"completed":input.state==="boarded"?"ready":"exception";
      if(plan) await tx.updateTable("departure_plans").set({state:planState,revision:plan.revision+1,updated_at:now}).where("id","=",plan.id).execute();
      if(plan&&input.state==="dropped") await tx.insertInto("departure_handovers").values({school_id:trip.school_id,plan_id:plan.id,student_id:studentId,outcome:"transport_dropped",authority_id:null,authority_snapshot:{trip_id:trip.id,rider_revision:row.revision},evidence_method:"transport_roster",note:input.note,occurred_at:now,recorded_by:user.id}).onConflict(conflict=>conflict.column("plan_id").doNothing()).execute();
      await this.audit(tx,trip.school_id,user.id,`rider.${input.state}`,"transport_trip",trip.id,{student_id:studentId,from:rider.state,to:input.state,note:input.note,rider_revision:row.revision,school_reconciliation:Boolean(managementSchoolId)}); await this.emit(tx,trip.school_id,"transport.updated","transport_trip",trip.id,studentId,{revision:row.revision,action:input.state}); return row;
    });
  }

  async recordHandover(user:AuthUser,schoolId:string,planId:string,body:unknown) {
    await this.membership(user,schoolId,true); const input=z.object({expected_revision:z.number().int().positive(),outcome:z.enum(["handed_over","departed_independently","refused","no_show","escalated"]),authority_id:uuid.nullable().optional(),evidence_method:z.enum(["school_record","in_person_verification","phone_verification","staff_observation"]),note:z.string().trim().min(3).max(500),occurred_at:z.string().datetime()}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      const plan=await tx.selectFrom("departure_plans").selectAll().where("school_id","=",schoolId).where("id","=",planId).where("is_current","=",true).forUpdate().executeTakeFirst(); if(!plan) throw new NotFoundException("Current departure plan not found."); if(plan.mode==="school_transport") throw new BadRequestException("Use the trip roster for school-transport handover."); if(plan.state!=="ready") throw new ConflictException("Mark the learner ready after completing the departure checks before recording handover.");
      if(plan.revision!==input.expected_revision) throw new ConflictException("The departure plan changed. Reload before recording handover.");
      if(plan.service_date!==await this.localDate(tx,schoolId)) throw new ConflictException("Record handover on the planned service date.");
      if(Math.abs(Date.now()-new Date(input.occurred_at).getTime())>300_000) throw new BadRequestException("Record a current handover; historical corrections require school review.");
      if(input.authority_id&&input.authority_id!==plan.authority_id) throw new ConflictException("The receiver differs from the approved plan. Update the arrangement first.");
      if(input.outcome==="departed_independently"&&plan.mode!=="independent_departure") throw new BadRequestException("Independent departure is not approved for this learner.");
      let snapshot:unknown={}; const authorityId=plan.authority_id;
      if(["guardian_pickup","authorized_collector"].includes(plan.mode)) { if(!authorityId) throw new BadRequestException("A current collection authority is required."); const authority=await tx.selectFrom("departure_collection_authorities").selectAll().where("school_id","=",schoolId).where("id","=",authorityId).where("student_id","=",plan.student_id).where("status","=","active").where("valid_from","<=",plan.service_date).where(eb=>eb.or([eb("valid_until","is",null),eb("valid_until",">=",plan.service_date)])).executeTakeFirst(); if(!authority) throw new ForbiddenException("Collection authority is no longer current."); snapshot={authority_id:authority.id,revision:authority.revision,verification_method:authority.verification_method}; }
      if(plan.mode==="independent_departure"&&input.outcome==="handed_over") throw new BadRequestException("Independent departure requires its matching factual outcome.");
      const terminal=["handed_over","departed_independently"].includes(input.outcome); const row=await tx.insertInto("departure_handovers").values({school_id:schoolId,plan_id:plan.id,student_id:plan.student_id,outcome:input.outcome,authority_id:authorityId??null,authority_snapshot:snapshot,evidence_method:input.evidence_method,note:input.note,occurred_at:new Date(input.occurred_at),recorded_by:user.id}).returningAll().executeTakeFirstOrThrow();
      await tx.updateTable("departure_plans").set({state:terminal?"completed":"exception",revision:plan.revision+1,updated_at:new Date()}).where("id","=",plan.id).execute(); await this.audit(tx,schoolId,user.id,`handover.${input.outcome}`,"departure_plan",plan.id,{student_id:plan.student_id}); await this.emit(tx,schoolId,"departure.updated","departure_plan",plan.id,plan.student_id,{revision:plan.revision+1,action:input.outcome}); return row;
    });
  }

  async planAction(user:AuthUser,schoolId:string,planId:string,action:string,body:unknown) {
    await this.membership(user,schoolId,true);
    if(!["ready","cancel"].includes(action)) throw new BadRequestException("Unsupported departure-plan action.");
    const input=z.object({expected_revision:z.number().int().positive(),note:z.string().trim().max(500).default("")}).parse(body);
    return this.db.transaction().execute(async tx=>{
      await this.managedWrite(tx,user,schoolId);
      const current=await tx.selectFrom("departure_plans").selectAll().where("school_id","=",schoolId).where("id","=",planId).where("is_current","=",true).forUpdate().executeTakeFirst();
      if(!current) throw new NotFoundException("Current departure plan not found.");
      if(current.revision!==input.expected_revision) throw new ConflictException("Departure plan changed. Reload before continuing.");
      if(current.mode==="school_transport") throw new BadRequestException("Manage this learner through their journey roster or approve a replacement departure arrangement.");
      if(action==="ready"&&current.service_date!==await this.localDate(tx,schoolId)) throw new ConflictException("Departure checks can be completed only on the service date.");
      if(action==="cancel"&&input.note.length<3) throw new BadRequestException("Give a reason for cancelling this departure plan.");
      if(action==="ready"&&current.state!=="planned") throw new ConflictException("Only a planned departure can be marked ready.");
      if(action==="cancel"&&!["planned","change_pending","ready","exception"].includes(current.state)) throw new ConflictException("This departure plan can no longer be cancelled.");
      if(action==="ready"&&["guardian_pickup","authorized_collector"].includes(current.mode)){
        const authority=await tx.selectFrom("departure_collection_authorities").select("id").where("school_id","=",schoolId).where("id","=",current.authority_id??"").where("student_id","=",current.student_id).where("status","=","active").where("valid_from","<=",current.service_date).where(eb=>eb.or([eb("valid_until","is",null),eb("valid_until",">=",current.service_date)])).executeTakeFirst();
        if(!authority) throw new ForbiddenException("Collection authority is no longer current.");
      }
      const state=action==="ready"?"ready":"cancelled";
      const row=await tx.updateTable("departure_plans").set({state,revision:current.revision+1,updated_at:new Date()}).where("id","=",current.id).returningAll().executeTakeFirstOrThrow();
      await this.audit(tx,schoolId,user.id,`plan.${action}`,"departure_plan",row.id,{student_id:row.student_id,note:input.note});
      await this.emit(tx,schoolId,"departure.updated","departure_plan",row.id,row.student_id,{revision:row.revision,action});
      return row;
    });
  }

  private planInput(body:unknown) {
    return z.object({student_id:uuid,service_date:date,mode,authority_id:uuid.nullable().optional(),trip_id:uuid.nullable().optional(),stop_id:uuid.nullable().optional(),external_arrangement:z.string().trim().max(300).default(""),reason:z.string().trim().min(3).max(500).default("Updated departure arrangement")})
      .refine(input=>["guardian_pickup","authorized_collector"].includes(input.mode)===Boolean(input.authority_id),"Choose an approved receiver for adult pickup only.")
      .refine(input=>input.mode==="school_transport"?Boolean(input.trip_id&&input.stop_id):!input.trip_id&&!input.stop_id,"School transport requires a dated trip and its stop.")
      .refine(input=>input.mode!=="external_transport"||input.external_arrangement.length>=3,"Describe the external arrangement.").parse(body);
  }

  private async assertChangeable(tx:Transaction<Database>,schoolId:string,studentId:string,serviceDate:string,current:{state:string;trip_id:string|null}|undefined) {
    if(serviceDate<await this.localDate(tx,schoolId)) throw new BadRequestException("A past departure cannot be changed.");
    if(current?.state==="completed"||current?.state==="cancelled") throw new ConflictException("This departure is already completed or cancelled. Contact school operations.");
    if(await tx.selectFrom("departure_change_requests").select("id").where("student_id","=",studentId).where("service_date","=",serviceDate).where("status","=","submitted").executeTakeFirst()) throw new ConflictException("A change request is already awaiting review for this date.");
    if(current?.trip_id) {
      const rider=await tx.selectFrom("transport_trip_roster").select(["boarded_at","state"]).where("trip_id","=",current.trip_id).where("student_id","=",studentId).executeTakeFirst();
      if(rider&&(rider.boarded_at||rider.state==="exception")) throw new ConflictException("The learner's journey needs to be resolved before requesting another departure arrangement.");
    }
  }

  async withdrawRequest(user:AuthUser,requestId:string,body:unknown) {
    uuid.parse(requestId);
    const input=z.object({expected_revision:z.number().int().positive()}).parse(body);
    const reference=await this.db.selectFrom("departure_change_requests").select(["school_id","student_id"]).where("id","=",requestId).where("requester_user_id","=",user.id).executeTakeFirst();
    if(!reference) throw new NotFoundException("Your change request was not found.");
    return this.db.transaction().execute(async tx=>{
      await this.lockSchool(tx,reference.school_id); await this.familyStudent(user,reference.student_id,tx);
      const request=await tx.selectFrom("departure_change_requests").selectAll().where("id","=",requestId).forUpdate().executeTakeFirstOrThrow();
      if(request.status!=="submitted"||request.revision!==input.expected_revision) throw new ConflictException("The request changed. Reload before withdrawing it.");
      const row=await tx.updateTable("departure_change_requests").set({status:"withdrawn",revision:request.revision+1,updated_at:new Date()}).where("id","=",request.id).returningAll().executeTakeFirstOrThrow();
      if(request.current_plan_id) await tx.updateTable("departure_plans").set({state:"planned",revision:sql<number>`revision+1`,updated_at:new Date()}).where("id","=",request.current_plan_id).where("is_current","=",true).where("state","=","change_pending").execute();
      await this.audit(tx,reference.school_id,user.id,"request.withdrawn","departure_request",request.id,{student_id:reference.student_id});
      await this.emit(tx,reference.school_id,"departure.updated","departure_request",request.id,reference.student_id,{revision:row.revision,action:"withdrawn"});
      return row;
    });
  }

  private async assertRequestAllowed(schoolId:string,serviceDate:string,requestedMode:DepartureMode,db:Db=this.db) {
    const result=await sql<{enabled:boolean;enabled_modes:DepartureMode[];local_date:string;local_time:string;change_cutoff:string}>`SELECT
      COALESCE(policy.enabled,true) enabled,
      COALESCE(policy.enabled_modes,ARRAY['guardian_pickup','authorized_collector','school_transport','external_transport']::text[]) enabled_modes,
      (now() AT TIME ZONE school.timezone)::date::text local_date,
      (now() AT TIME ZONE school.timezone)::time::text local_time,
      COALESCE(policy.change_cutoff,'13:00'::time)::text change_cutoff
      FROM schools school LEFT JOIN departure_policies policy ON policy.school_id=school.id WHERE school.id=${schoolId}::uuid`.execute(db);
    const policy=result.rows[0];
    if(!policy?.enabled || !policy.enabled_modes.includes(requestedMode)) throw new ForbiddenException("This departure arrangement is not enabled by the institution.");
    if(serviceDate<policy.local_date) throw new BadRequestException("A departure change cannot be requested for a past date.");
    if(serviceDate===policy.local_date && policy.local_time.slice(0,8)>=policy.change_cutoff.slice(0,8)) throw new ConflictException(`Today's departure change cutoff was ${policy.change_cutoff.slice(0,5)}.`);
  }

  private async assertReceiver(db:Db,schoolId:string,input:{student_id:string;service_date:string;mode:DepartureMode;authority_id?:string|null|undefined}) {
    if(!["guardian_pickup","authorized_collector"].includes(input.mode)) return;
    if(!input.authority_id) throw new BadRequestException("Choose an approved receiver.");
    const authority=await db.selectFrom("departure_collection_authorities").select(["id","guardian_relationship_id"]).where("school_id","=",schoolId).where("student_id","=",input.student_id).where("id","=",input.authority_id).where("status","=","active").where("valid_from","<=",input.service_date).where(eb=>eb.or([eb("valid_until","is",null),eb("valid_until",">=",input.service_date)])).executeTakeFirst();
    if(!authority||Boolean(authority.guardian_relationship_id)!==(input.mode==="guardian_pickup")) throw new BadRequestException("Choose a current receiver matching this learner, date and pickup arrangement.");
  }

  private async upsertPlan(tx:Transaction<Database>,user:AuthUser,schoolId:string,input:{student_id:string;service_date:string;mode:DepartureMode;authority_id?:string|null|undefined;trip_id?:string|null|undefined;stop_id?:string|null|undefined;external_arrangement?:string|undefined;source:"default"|"guardian_request"|"office_assisted"|"administrator"|"transport_assignment";source_reference_id?:string|null|undefined}) {
    await this.lockSchool(tx,schoolId);
    if(input.service_date<await this.localDate(tx,schoolId)) throw new BadRequestException("Past departure plans cannot be replaced.");
    const current=await tx.selectFrom("departure_plans").selectAll().where("school_id","=",schoolId).where("student_id","=",input.student_id).where("service_date","=",input.service_date).where("is_current","=",true).forUpdate().executeTakeFirst();
    if(current?.state==="completed") throw new ConflictException("This departure is already completed. Its history cannot be replaced.");
    const policy=await tx.selectFrom("departure_policies").select(["enabled","enabled_modes"]).where("school_id","=",schoolId).executeTakeFirst();
    if(policy && (!policy.enabled || !policy.enabled_modes.includes(input.mode))) throw new ForbiddenException("This departure arrangement is disabled by institution policy.");
    await this.assertReceiver(tx,schoolId,input);
    if(input.mode==="school_transport") {
      const trip=await tx.selectFrom("transport_trips").selectAll().where("school_id","=",schoolId).where("id","=",input.trip_id??"").executeTakeFirst();
      const rider=await tx.selectFrom("transport_trip_roster").selectAll().where("trip_id","=",input.trip_id??"").where("student_id","=",input.student_id).executeTakeFirst();
      if(!trip||trip.direction!=="from_institution"||trip.service_date!==input.service_date||!["planned","boarding"].includes(trip.state)||!rider||rider.stop_id!==input.stop_id||rider.state!=="expected") throw new BadRequestException("Choose the learner's expected afternoon trip and stop for this date.");
    }
    if(current?.trip_id && current.trip_id!==input.trip_id) {
      const rider=await tx.selectFrom("transport_trip_roster").selectAll().where("trip_id","=",current.trip_id).where("student_id","=",input.student_id).forUpdate().executeTakeFirst();
      if(rider&&(rider.boarded_at||rider.state==="exception")) throw new ConflictException("Resolve this learner's journey before changing their departure arrangement.");
      if(rider?.state==="expected") {
        await tx.updateTable("transport_trip_roster").set({state:"not_riding",revision:rider.revision+1,outcome_note:"Approved departure arrangement changed by school operations",recorded_by:user.id,updated_at:new Date()}).where("trip_id","=",current.trip_id).where("student_id","=",input.student_id).execute();
        await this.audit(tx,schoolId,user.id,"rider.plan_changed","transport_trip",current.trip_id,{student_id:input.student_id,plan_id:current.id});
        await this.emit(tx,schoolId,"transport.updated","transport_trip",current.trip_id,input.student_id,{revision:rider.revision+1,action:"plan_changed"});
      }
    }
    if(current) await tx.updateTable("departure_plans").set({is_current:false,updated_at:new Date()}).where("id","=",current.id).execute();
    return tx.insertInto("departure_plans").values({school_id:schoolId,student_id:input.student_id,service_date:input.service_date,revision:(current?.revision??0)+1,mode:input.mode,state:"planned",authority_id:input.authority_id??null,trip_id:input.trip_id??null,stop_id:input.stop_id??null,external_arrangement:input.external_arrangement??"",source:input.source,source_reference_id:input.source_reference_id??null,supersedes_plan_id:current?.id??null,approved_by:user.id,approved_at:new Date(),created_by:user.id}).returningAll().executeTakeFirstOrThrow();
  }

  private audit(tx:Transaction<Database>,schoolId:string,actorId:string,action:string,targetType:string,targetId:string,metadata:Record<string,unknown>) { return tx.insertInto("departure_audits").values({school_id:schoolId,actor_id:actorId,action,target_type:targetType,target_id:targetId,metadata}).execute(); }
}
