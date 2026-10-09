import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { DepartureCoordinationService } from "../src/departure-coordination/departure-coordination.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { TransportRetentionService } from "../src/departure-coordination/transport-retention.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const isolated=process.env.TEST_DATABASE_ISOLATED==="true";
describe.skipIf(!isolated)("transport lifecycle and privacy",()=>{
  const pool=new Pool({connectionString:isolated?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):"postgresql://invalid.invalid/unused",max:3});
  let db:DatabaseService; let service:DepartureCoordinationService;
  async function actor(role:AuthUser["role"]):Promise<AuthUser> {
    const id=randomUUID();const username=`transport-${id}`;
    await pool.query("INSERT INTO users(id,username,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,'unused','Transport','Test',$4)",[id,username,`${username}@example.test`,role]);
    return {id,username,email:`${username}@example.test`,first_name:"Transport",last_name:"Test",role,is_active:true};
  }
  async function fixture(direction:"from_institution"|"to_institution"="from_institution",learnerCount=2,stopCount=1) {
    const admin=await actor("admin");const collector=await actor("staff");const parent=await actor("parent");const student=await actor("student");const sibling=await actor("student");const outsider=await actor("parent");
    const school=(await pool.query("INSERT INTO schools(name,code,timezone) VALUES('Transport Test',$1,'Asia/Kolkata') RETURNING id",[randomUUID().slice(0,24)])).rows[0].id as string;
    for(const [user,role] of [[admin,"admin"],[collector,"staff"],[parent,"guardian"],[student,"student"],[sibling,"student"],[outsider,"guardian"]] as const) await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,$3)",[school,user.id,role]);
    const learnerIds:string[]=[];
    const guardian=(await pool.query("INSERT INTO parents(user_id) VALUES($1) RETURNING id",[parent.id])).rows[0].id;
    const learners=[student,sibling];
    while(learners.length<learnerCount){const learner=await actor("student");learners.push(learner);await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'student')",[school,learner.id]);}
    for(const learner of learners) {
      const id=(await pool.query("INSERT INTO students(user_id,school_id,admission_number) VALUES($1,$2,$3) RETURNING id",[learner.id,school,randomUUID()])).rows[0].id;
      learnerIds.push(id);await pool.query("INSERT INTO guardian_relationships(school_id,student_id,guardian_id,relationship) VALUES($1,$2,$3,'guardian')",[school,id,guardian]);
    }
    const day=(await pool.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS day")).rows[0].day as string;
    const route=await service.createRoute(admin,school,{code:"TEST",name:"Test route",stops:Array.from({length:stopCount},(_,index)=>({direction,sequence:index+1,name:stopCount===1?"Library stop":`Stop ${index+1}`,latitude:32.11+index*.001,longitude:77.16+index*.001}))});
    const stopIds=(await pool.query("SELECT id FROM transport_stops WHERE route_id=$1 ORDER BY sequence",[route.id])).rows.map(row=>row.id as string);const stop=stopIds[0]!;
    for(const [index,id] of learnerIds.entries()) await service.assignStudent(admin,school,{student_id:id,route_id:route.id,stop_id:stopIds[Math.floor(index*stopCount/learnerCount)],direction,valid_from:day});
    const trip=await service.createTrip(admin,school,{route_id:route.id,service_date:day,direction,assigned_collector_user_id:collector.id,scheduled_departure_time:"15:30"});
    await service.savePolicy(admin,school,{expected_revision:0,enabled:true,enabled_modes:["school_transport","external_transport","guardian_pickup"],change_cutoff:"23:59",location_retention_hours:24,location_stale_seconds:90});
    return {admin,collector,parent,student,sibling,outsider,school,day,trip,route,stop,learnerIds};
  }
  async function open(f:Awaited<ReturnType<typeof fixture>>) {
    await departureIn(f.trip.id,0);
    const accepted=await service.tripAction(f.collector,f.trip.id,"accept",{expected_revision:1});
    return service.tripAction(f.collector,f.trip.id,"boarding",{expected_revision:accepted.revision});
  }
  async function departureIn(tripId:string,minutes:number) {
    await pool.query("UPDATE transport_trips SET service_date=((now()+make_interval(mins=>$2)) AT TIME ZONE 'Asia/Kolkata')::date, scheduled_departure_time=((now()+make_interval(mins=>$2)) AT TIME ZONE 'Asia/Kolkata')::time WHERE id=$1",[tripId,minutes]);
  }
  const rider=(state:string,revision=1,note="Observed by assigned staff")=>({state,expected_revision:revision,note});
  beforeAll(()=>{db=new DatabaseService();service=new DepartureCoordinationService(db,new SchoolEventService(db));});
  afterAll(async()=>{await db?.destroy();await pool.end();});

  it.each(["to_institution","from_institution"] as const)("operates a 40-rider %s bus across eight geotagged stops",async direction=>{
    const f=await fixture(direction,40,8);const boarding=await open(f);
    const workspace=await service.collectorWorkspace(f.collector);const trip=workspace.trips.find(t=>t.id===f.trip.id)!;
    expect(trip.stops).toHaveLength(8);expect(trip.stops[0]).toMatchObject({latitude:32.11,longitude:77.16});expect(trip.roster).toHaveLength(40);
    expect(new Set(trip.roster.map((r:{stop_id:string})=>r.stop_id)).size).toBe(8);
    let started=direction==="to_institution"?await service.tripAction(f.collector,f.trip.id,"start",{expected_revision:boarding.revision}):null;
    const boarded=[];for(const id of f.learnerIds)boarded.push(await service.recordRider(f.collector,f.trip.id,id,{state:"boarded",expected_revision:1}));
    if(!started)started=await service.tripAction(f.collector,f.trip.id,"start",{expected_revision:boarding.revision});
    await service.recordLocation(f.collector,f.trip.id,{latitude:32.11,longitude:77.16,accuracy_metres:10,observed_at:new Date().toISOString()});
    const family=await service.family(f.parent,f.learnerIds[0]);expect(family.journeys[0].latitude).not.toBeNull();expect(family.journeys[0]).not.toHaveProperty("roster");expect(family.journeys[0]).not.toHaveProperty("stops");
    for(const row of boarded)await service.recordRider(f.collector,f.trip.id,row.student_id,{state:"dropped",expected_revision:row.revision});
    await service.tripAction(f.collector,f.trip.id,"complete",{expected_revision:started.revision});
    expect((await service.collectorWorkspace(f.collector)).trips.find(t=>t.id===f.trip.id)?.roster.every((r:{state:string})=>r.state==="dropped")).toBe(true);
    const audits=await pool.query("SELECT count(*)::int count FROM departure_audits WHERE target_id=$1 AND action='rider.dropped'",[f.trip.id]);expect(audits.rows[0].count).toBe(40);
    expect((await service.family(f.parent,f.learnerIds[0])).journeys[0].latitude).toBeNull();
  },15000);

  it("persists one-tap routine outcomes with actor, time, plan, handover and refresh evidence but no invented note",async()=>{
    const f=await fixture();const [first,second]=f.learnerIds as [string,string];const boarding=await open(f);
    const boarded=await service.recordRider(f.collector,f.trip.id,first,{state:"boarded",expected_revision:1});
    await service.recordRider(f.collector,f.trip.id,second,rider("not_riding",1,""));
    expect(boarded.recorded_by).toBe(f.collector.id);expect(boarded.boarded_at).toBeInstanceOf(Date);expect(boarded.outcome_note).toBe("");
    const started=await service.tripAction(f.collector,f.trip.id,"start",{expected_revision:boarding.revision});
    await expect(service.recordRider(f.collector,f.trip.id,first,rider("exception",boarded.revision,""))).rejects.toThrow(/Describe/);
    await service.recordLocation(f.collector,f.trip.id,{latitude:12.9,longitude:77.6,accuracy_metres:15,observed_at:new Date().toISOString()});
    const dropped=await service.recordRider(f.collector,f.trip.id,first,rider("dropped",boarded.revision,""));
    expect(dropped.recorded_by).toBe(f.collector.id);expect(dropped.dropped_at).toBeInstanceOf(Date);
    const handovers=await pool.query("SELECT recorded_by,occurred_at,note,evidence_method FROM departure_handovers WHERE school_id=$1 AND student_id=$2",[f.school,first]);
    expect(handovers.rows).toHaveLength(1);expect(handovers.rows[0]).toMatchObject({recorded_by:f.collector.id,note:"",evidence_method:"transport_roster"});expect(handovers.rows[0].occurred_at).toBeInstanceOf(Date);
    const family=await service.family(f.parent,first);expect(family.plan.state).toBe("completed");expect(family.trip.latitude).toBeNull();
    const audit=await pool.query("SELECT actor_id,created_at,metadata FROM departure_audits WHERE school_id=$1 AND target_id=$2 AND action='rider.dropped'",[f.school,f.trip.id]);
    expect(audit.rows).toHaveLength(1);expect(audit.rows[0].actor_id).toBe(f.collector.id);expect(audit.rows[0].created_at).toBeInstanceOf(Date);expect(audit.rows[0].metadata).toMatchObject({from:"boarded",to:"dropped",note:"",student_id:first,school_reconciliation:false});
    const events=await pool.query("SELECT payload,audience_user_ids FROM event_outbox WHERE school_id=$1 AND aggregate_id=$2",[f.school,f.trip.id]);
    const event=events.rows.find(row=>row.payload.action==="dropped");expect(event.audience_user_ids).toContain(f.parent.id);expect(JSON.stringify(event)).not.toContain("latitude");
    await expect(service.recordRider(f.collector,f.trip.id,first,rider("dropped",boarded.revision,""))).rejects.toThrow(/changed/);
    await service.tripAction(f.collector,f.trip.id,"complete",{expected_revision:started.revision});
  });

  it("runs accepted duty through boarding, exception reconciliation, private location, handover and closure",async()=>{
    const f=await fixture();const [first,second]=f.learnerIds as [string,string];
    await expect(service.tripAction(f.collector,f.trip.id,"boarding",{expected_revision:1})).rejects.toThrow(/Accept/);
    await expect(service.recordRider(f.admin,f.trip.id,first,rider("boarded"))).rejects.toThrow(/assigned/);
    const boarding=await open(f);
    await expect(service.tripAction(f.collector,f.trip.id,"start",{expected_revision:boarding.revision})).rejects.toThrow(/Account/);
    const boarded=await service.recordRider(f.collector,f.trip.id,first,rider("boarded"));
    await service.recordRider(f.collector,f.trip.id,second,rider("not_riding"));
    const started=await service.tripAction(f.collector,f.trip.id,"start",{expected_revision:boarding.revision});
    await service.recordLocation(f.collector,f.trip.id,{latitude:12.9,longitude:77.6,accuracy_metres:15,observed_at:new Date().toISOString()});
    expect((await service.family(f.parent,first)).trip.latitude).not.toBeNull();
    expect((await service.family(f.parent,second)).trip.latitude).toBeNull();
    await expect(service.family(f.outsider,first)).rejects.toThrow(/linked/);
    await expect(service.family(f.student,second,undefined,true)).rejects.toThrow(/linked/);
    expect((await service.family(f.student,undefined,undefined,true)).can_request).toBe(false);
    const exception=await service.recordRider(f.collector,f.trip.id,first,rider("exception",boarded.revision,"Receiver not at stop"));
    expect((await service.family(f.parent,first)).trip.latitude).toBeNull();
    await expect(service.tripAction(f.collector,f.trip.id,"complete",{expected_revision:started.revision})).rejects.toThrow(/Resolve/);
    const dropped=await service.recordRider(f.collector,f.trip.id,first,rider("dropped",exception.revision,"Receiver verified after contacting school"));
    expect((await service.family(f.parent,first)).trip.latitude).toBeNull();
    await expect(service.recordRider(f.collector,f.trip.id,first,rider("boarded",dropped.revision))).rejects.toThrow(/final/);
    await service.tripAction(f.collector,f.trip.id,"complete",{expected_revision:started.revision});
    const audits=await pool.query("SELECT metadata FROM departure_audits WHERE target_id=$1 AND action='rider.dropped'",[f.trip.id]);
    expect(audits.rows[0].metadata.note).toContain("Receiver verified");
    const events=await pool.query("SELECT audience_user_ids,payload FROM event_outbox WHERE aggregate_id=$1",[f.trip.id]);
    expect(events.rows.filter(event=>event.payload.action==="boarded")).toHaveLength(1);
    expect(events.rows.find(event=>event.payload.action==="start").audience_user_ids).toContain(f.parent.id);
    expect(JSON.stringify(events.rows)).not.toContain("latitude");
  });

  it("supports morning journeys without a departure plan and isolates every child's data",async()=>{
    const f=await fixture("to_institution");const boarding=await open(f);
    const started=await service.tripAction(f.collector,f.trip.id,"start",{expected_revision:boarding.revision});
    const boarded=await service.recordRider(f.collector,f.trip.id,f.learnerIds[0]!,rider("boarded"));
    await service.recordLocation(f.collector,f.trip.id,{latitude:12.9,longitude:77.6,accuracy_metres:10,observed_at:new Date().toISOString()});
    const family=await service.family(f.parent,f.learnerIds[0]);
    expect(family.plan).toBeNull();expect(family.journeys[0].direction).toBe("to_institution");expect(family.journeys[0].latitude).not.toBeNull();
    expect(family.journeys[0]).not.toHaveProperty("roster");
    await service.recordRider(f.collector,f.trip.id,f.learnerIds[0]!,rider("dropped",boarded.revision,"Arrived and handed to school staff"));
    expect((await service.family(f.parent,f.learnerIds[0])).journeys[0].latitude).toBeNull();
    await expect(service.tripAction(f.collector,f.trip.id,"complete",{expected_revision:started.revision})).rejects.toThrow(/Resolve/);
  });

  it("applies an approved pickup change atomically to the expected bus roster",async()=>{
    const f=await fixture();const id=f.learnerIds[0]!;
    const request=await service.requestChange(f.parent,{student_id:id,service_date:f.day,mode:"external_transport",external_arrangement:"Family-arranged taxi",reason:"Different pickup today"});
    await service.decideRequest(f.admin,f.school,request.id,{decision:"approved",expected_revision:request.revision});
    const roster=(await pool.query("SELECT state FROM transport_trip_roster WHERE trip_id=$1 AND student_id=$2",[f.trip.id,id])).rows[0];
    expect(roster.state).toBe("not_riding");expect((await service.family(f.parent,id)).plan.mode).toBe("external_transport");
    await open(f);
    await expect(service.recordRider(f.collector,f.trip.id,id,rider("boarded",2))).rejects.toThrow(/final/);
  });

  it("withdraws only the requester's open request and rejects duplicate/stale decisions",async()=>{
    const f=await fixture();const input={student_id:f.learnerIds[0],service_date:f.day,mode:"external_transport",external_arrangement:"Family car",reason:"Family pickup"};
    const request=await service.requestChange(f.parent,input);
    await expect(service.requestChange(f.parent,input)).rejects.toThrow(/already/);
    await expect(service.withdrawRequest(f.outsider,request.id,{expected_revision:1})).rejects.toThrow(/not found/);
    await service.withdrawRequest(f.parent,request.id,{expected_revision:1});
    expect((await service.family(f.parent,f.learnerIds[0])).plan.state).toBe("planned");
    await expect(service.decideRequest(f.admin,f.school,request.id,{decision:"approved",expected_revision:1})).rejects.toThrow(/already/);
  });

  it("cannot cancel an occupied bus, rewrite terminal riders, or bypass current membership",async()=>{
    const f=await fixture();const boarding=await open(f);const boarded=await service.recordRider(f.collector,f.trip.id,f.learnerIds[0]!,rider("boarded"));
    await expect(service.tripAction(f.collector,f.trip.id,"cancel",{expected_revision:boarding.revision,note:"Bus failure"})).rejects.toThrow(/on-board/);
    await expect(service.recordRider(f.collector,f.trip.id,f.learnerIds[0]!,rider("not_riding",boarded.revision))).rejects.toThrow(/cannot/);
    await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2",[f.school,f.collector.id]);
    await expect(service.recordRider(f.collector,f.trip.id,f.learnerIds[1]!,rider("boarded"))).rejects.toThrow(/assigned/);
    await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2",[f.school,f.parent.id]);
    await expect(service.family(f.parent,f.learnerIds[0])).rejects.toThrow(/linked/);
  });

  it("serializes racing rider updates and keeps events for different riders at the same revision",async()=>{
    const f=await fixture();await open(f);
    const outcomes=await Promise.allSettled([service.recordRider(f.collector,f.trip.id,f.learnerIds[0]!,rider("boarded")),service.recordRider(f.collector,f.trip.id,f.learnerIds[0]!,rider("not_riding"))]);
    expect(outcomes.filter(item=>item.status==="fulfilled")).toHaveLength(1);
    await service.recordRider(f.collector,f.trip.id,f.learnerIds[1]!,rider("boarded"));
    const events=await pool.query("SELECT id FROM event_outbox WHERE aggregate_id=$1 AND payload->>'revision'='2' AND payload->>'action' IN ('boarded','not_riding')",[f.trip.id]);
    expect(events.rows).toHaveLength(2);
    await expect(service.journey(f.collector,f.school,f.trip.id)).rejects.toThrow(/permission/);
    expect((await service.journey(f.admin,f.school,f.trip.id)).roster).toHaveLength(2);
  });

  it("transfers duty only after colleague acceptance and school approval, then removes the previous collector's write access",async()=>{
    const f=await fixture();await service.tripAction(f.collector,f.trip.id,"accept",{expected_revision:1});
    await departureIn(f.trip.id,60);
    const request=await service.requestDutySwap(f.collector,{requester_trip_id:f.trip.id,request_type:"cover",target_user_id:f.admin.id,reason:"Colleague covering assigned duty"});
    await expect(service.decideDutySwap(f.admin,f.school,request.id,{decision:"approved",expected_revision:1,note:"Approved cover"})).rejects.toThrow(/colleague/);
    await service.respondDutySwap(f.admin,request.id,{decision:"accepted",expected_revision:1});
    await service.decideDutySwap(f.admin,f.school,request.id,{decision:"approved",expected_revision:2,note:"Cover confirmed with both staff"});
    await expect(service.tripAction(f.collector,f.trip.id,"boarding",{expected_revision:3})).rejects.toThrow(/assigned/);
    await departureIn(f.trip.id,0);
    expect((await service.tripAction(f.admin,f.trip.id,"boarding",{expected_revision:3})).state).toBe("boarding");
  });

  it("rejects revoked replacement staff at approval and blocks future boarding",async()=>{
    const f=await fixture();const backup=await actor("staff");await pool.query("INSERT INTO school_memberships(school_id,user_id,role) VALUES($1,$2,'staff')",[f.school,backup.id]);
    await service.tripAction(f.collector,f.trip.id,"accept",{expected_revision:1});
    await departureIn(f.trip.id,60);
    const request=await service.requestDutySwap(f.collector,{requester_trip_id:f.trip.id,request_type:"cover",target_user_id:backup.id,reason:"Proposed cover"});
    const inbox=await service.collectorWorkspace(backup);expect(inbox.trips).toHaveLength(0);expect(inbox.swaps.some(swap=>swap.id===request.id)).toBe(true);
    await expect(service.collectorWorkspace(f.parent)).rejects.toThrow(/staff/);
    await service.respondDutySwap(backup,request.id,{decision:"accepted",expected_revision:1});
    await pool.query("UPDATE school_memberships SET is_active=false WHERE school_id=$1 AND user_id=$2",[f.school,backup.id]);
    await expect(service.decideDutySwap(f.admin,f.school,request.id,{decision:"approved",expected_revision:2,note:"Approved cover"})).rejects.toThrow(/active/);
    const future=(await pool.query("SELECT ($1::date+1)::text AS day",[f.day])).rows[0].day;
    const trip=await service.createTrip(f.admin,f.school,{route_id:f.route.id,service_date:future,direction:"from_institution",assigned_collector_user_id:f.collector.id,scheduled_departure_time:"15:30"});
    await service.tripAction(f.collector,trip.id,"accept",{expected_revision:1});
    await expect(service.tripAction(f.collector,trip.id,"boarding",{expected_revision:2})).rejects.toThrow(/service date/);
  });

  it("opens controls only in the 30-minute window and closes self-service duty changes",async()=>{
    const f=await fixture();await departureIn(f.trip.id,31);
    await service.tripAction(f.collector,f.trip.id,"accept",{expected_revision:1});
    const early=(await service.collectorWorkspace(f.collector)).trips.find(trip=>trip.id===f.trip.id)!;
    expect(early.controls_available).toBe(false);expect(early.duty_change_available).toBe(true);
    await expect(service.tripAction(f.collector,f.trip.id,"boarding",{expected_revision:2})).rejects.toThrow(/30 minutes/);
    await expect(service.tripAction(f.collector,f.trip.id,"cancel",{expected_revision:2,note:"Cannot operate today"})).rejects.toThrow(/30 minutes/);
    await departureIn(f.trip.id,30);
    const openWindow=(await service.collectorWorkspace(f.collector)).trips.find(trip=>trip.id===f.trip.id)!;
    expect(openWindow.controls_available).toBe(true);expect(openWindow.duty_change_available).toBe(false);
    await expect(service.requestDutySwap(f.collector,{requester_trip_id:f.trip.id,request_type:"cover",target_user_id:f.admin.id,reason:"Last minute cover"})).rejects.toThrow(/30 minutes/);
    expect((await service.tripAction(f.collector,f.trip.id,"boarding",{expected_revision:2})).state).toBe("boarding");
  });

  it("expires an outstanding duty invitation at the cutoff without changing the assignee",async()=>{
    const f=await fixture();await departureIn(f.trip.id,60);await service.tripAction(f.collector,f.trip.id,"accept",{expected_revision:1});
    const request=await service.requestDutySwap(f.collector,{requester_trip_id:f.trip.id,request_type:"cover",target_user_id:f.admin.id,reason:"Colleague cover"});
    await departureIn(f.trip.id,29);
    expect((await service.collectorWorkspace(f.admin)).swaps.find(swap=>swap.id===request.id)?.self_service_open).toBe(false);
    await expect(service.respondDutySwap(f.admin,request.id,{decision:"accepted",expected_revision:1})).rejects.toThrow(/30 minutes/);
    expect((await pool.query("SELECT assigned_collector_user_id FROM transport_trips WHERE id=$1",[f.trip.id])).rows[0].assigned_collector_user_id).toBe(f.collector.id);
  });

  it("requires school reassignment instead of approving a self-service swap after cutoff",async()=>{
    const f=await fixture();await departureIn(f.trip.id,60);await service.tripAction(f.collector,f.trip.id,"accept",{expected_revision:1});
    const request=await service.requestDutySwap(f.collector,{requester_trip_id:f.trip.id,request_type:"cover",target_user_id:f.admin.id,reason:"Colleague cover"});
    await service.respondDutySwap(f.admin,request.id,{decision:"accepted",expected_revision:1});await departureIn(f.trip.id,29);
    await expect(service.decideDutySwap(f.admin,f.school,request.id,{decision:"approved",expected_revision:2,note:"Late approval"})).rejects.toThrow(/30 minutes/);
    expect((await service.assignTripCollector(f.admin,f.school,f.trip.id,{collector_user_id:f.admin.id,expected_revision:2,note:"Urgent cover verified by school"})).assigned_collector_user_id).toBe(f.admin.id);
  });

  it("records pickup evidence with optimistic revision and matching outcome",async()=>{
    const f=await fixture();const id=f.learnerIds[0]!;
    const plan=await service.createPlan(f.admin,f.school,{student_id:id,service_date:f.day,mode:"external_transport",external_arrangement:"Family-arranged taxi"});
    const ready=await service.planAction(f.admin,f.school,plan.id,"ready",{expected_revision:plan.revision});
    const input={expected_revision:ready.revision,outcome:"handed_over",evidence_method:"in_person_verification",note:"Receiver and vehicle checked against approved arrangement",occurred_at:new Date().toISOString()};
    await expect(service.recordHandover(f.admin,f.school,plan.id,{...input,expected_revision:1})).rejects.toThrow(/changed/);
    await expect(service.recordHandover(f.admin,f.school,plan.id,{...input,outcome:"departed_independently"})).rejects.toThrow(/not approved/);
    await service.recordHandover(f.admin,f.school,plan.id,input);
    expect((await service.family(f.parent,id)).plan.state).toBe("completed");
    await expect(service.createPlan(f.admin,f.school,{student_id:id,service_date:f.day,mode:"external_transport",external_arrangement:"Different taxi"})).rejects.toThrow(/completed/);
  });

  it("expires precise location without deleting handover/audit history and stops sharing when policy is disabled",async()=>{
    const f=await fixture();const boarding=await open(f);
    await service.recordRider(f.collector,f.trip.id,f.learnerIds[0]!,rider("boarded"));await service.recordRider(f.collector,f.trip.id,f.learnerIds[1]!,rider("not_riding"));
    await service.tripAction(f.collector,f.trip.id,"start",{expected_revision:boarding.revision});
    const sample={latitude:12.9,longitude:77.6,accuracy_metres:10,observed_at:new Date().toISOString()};await service.recordLocation(f.collector,f.trip.id,sample);
    await pool.query("UPDATE transport_location_samples SET received_at=now()-interval '25 hours' WHERE trip_id=$1",[f.trip.id]);
    expect((await service.family(f.parent,f.learnerIds[0])).journeys[0].latitude).toBeNull();
    await new TransportRetentionService(db).purgeExpired();
    expect((await pool.query("SELECT id FROM transport_location_samples WHERE trip_id=$1",[f.trip.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM departure_audits WHERE target_id=$1",[f.trip.id])).rowCount).toBeGreaterThan(0);
    await service.savePolicy(f.admin,f.school,{expected_revision:1,enabled:false,enabled_modes:["school_transport"],change_cutoff:"23:59",location_retention_hours:24,location_stale_seconds:90});
    await expect(service.recordLocation(f.collector,f.trip.id,sample)).rejects.toThrow(/disabled/);
  });

  it("lets school operations reconcile an overdue journey without restoring expired collector access or inventing boarding",async()=>{
    const f=await fixture();const boarding=await open(f);
    const rider1=await service.recordRider(f.collector,f.trip.id,f.learnerIds[0]!,rider("boarded"));
    const rider2=await service.recordRider(f.collector,f.trip.id,f.learnerIds[1]!,rider("boarded"));
    const started=await service.tripAction(f.collector,f.trip.id,"start",{expected_revision:boarding.revision});
    await pool.query("UPDATE transport_trips SET service_date=service_date-1 WHERE id=$1",[f.trip.id]);
    await expect(service.recordRider(f.collector,f.trip.id,f.learnerIds[0]!,rider("dropped",rider1.revision))).rejects.toThrow(/assigned/);
    await expect(service.recordRider(f.outsider,f.trip.id,f.learnerIds[0]!,rider("dropped",rider1.revision),f.school)).rejects.toThrow(/permission/);
    await expect(service.recordRider(f.admin,f.trip.id,f.learnerIds[0]!,rider("dropped",rider1.revision,""),f.school)).rejects.toThrow(/evidence/);
    await service.recordRider(f.admin,f.trip.id,f.learnerIds[0]!,rider("dropped",rider1.revision,"Guardian and attendant confirmed handover; late recording"),f.school);
    await expect(service.tripAction(f.admin,f.trip.id,"complete",{expected_revision:started.revision,note:"Review complete"},f.school)).rejects.toThrow(/Resolve/);
    await service.recordRider(f.admin,f.trip.id,f.learnerIds[1]!,rider("dropped",rider2.revision,"Second receiver verified by school"),f.school);
    expect((await service.tripAction(f.admin,f.trip.id,"complete",{expected_revision:started.revision,note:"Every handover verified with attendant and families"},f.school)).state).toBe("completed");
    const audit=await pool.query("SELECT metadata FROM departure_audits WHERE target_id=$1 AND action='trip.complete'",[f.trip.id]);expect(audit.rows[0].metadata.school_reconciliation).toBe(true);
  });
});
