import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { GateService } from '../src/gate/gate.service.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import type { AuthUser } from '../src/common/request.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const suite=process.env.TEST_DATABASE_ISOLATED==='true'?describe:describe.skip;
suite('visitor approval delivery and current host authority',()=>{
 let pool:Pool,db:DatabaseService,events:SchoolEventService,gate:GateService;
 let school:string,otherSchool:string,admin:AuthUser,host:AuthUser,unrelated:AuthUser,guard:AuthUser;
 async function query(text:string,values:unknown[]=[]){return (await pool.query(text,values)).rows[0];}
 const request=()=>({name:'Visitor Test',phone:'9876543210',purpose:'Document delivery',host_user_id:host.id,request_id:randomUUID()});
 beforeAll(async()=>{
  pool=new Pool({connectionString:requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),max:1});db=new DatabaseService();events=new SchoolEventService(db);gate=new GateService(db,events,new CampusModelCoreService(db));
  school=(await query("INSERT INTO schools(name,code) VALUES('Approval test',$1) RETURNING id",[randomUUID().slice(0,20)])).id;
  otherSchool=(await query("INSERT INTO schools(name,code) VALUES('Other approval test',$1) RETURNING id",[randomUUID().slice(0,20)])).id;
  async function account(role:'admin'|'staff'){
   const key=randomUUID();const user=await query("INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES($1,$2,'x','Host','Test',$3) RETURNING *",[key,key+'@example.test',role]);
   await query('INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$2,$3)',[user.id,school,role]);return user;
  }
  admin=await account('admin');host=await account('staff');unrelated=await account('staff');
  const created=await gate.gatekeeper(admin,school,{name:'Gate Approval Test',username:'gate.'+randomUUID().slice(0,8)});
  guard=await query('SELECT * FROM users WHERE id=$1',[created.id]);
 });
 afterAll(async()=>{await db?.destroy();await pool?.end();});
 it('atomically creates one request and delivers a durable host notification',async()=>{
  const body=request();const first=await gate.visitor(guard,school,body);const repeated=await gate.visitor(guard,school,body);
  expect(first.id).toBe(repeated.id);expect(first).not.toHaveProperty('token_hash');
  await expect(gate.visitor(guard,school,{...body,purpose:'Changed purpose'})).rejects.toThrow(/reference already used/);
  const outbox=(await pool.query("SELECT * FROM event_outbox WHERE aggregate_id=$1 AND event_type='gate.visitor.updated'",[first.id])).rows;
  expect(outbox).toHaveLength(1);expect(outbox[0].notification_user_ids).toEqual([host.id]);
  expect(outbox[0].payload).not.toHaveProperty('phone');expect(outbox[0].audience_user_ids).not.toContain(unrelated.id);
  expect((await gate.approvals(host)).map(row=>row.id)).toContain(first.id);
  expect(await gate.approvals(unrelated)).toEqual([]);
  expect(await gate.approvals({...host,active_school_id:otherSchool})).toEqual([]);
  // Claim only this fixture event, then exercise the real publisher SQL.
  const publisher=events as unknown as {workerId:string;publishClaimedEvents:(ids:string[])=>Promise<number>};
  await query("UPDATE event_outbox SET published_by=$2,claim_expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1",[outbox[0].id,publisher.workerId]);
  expect(await publisher.publishClaimedEvents([outbox[0].id])).toBe(1);
  const notification=await query('SELECT * FROM notifications WHERE recipient_id=$1 AND dedupe_key=$2',[host.id,`event:${outbox[0].id}`]);
  expect(notification.title).toBe('Visitor approval requested');expect(notification.link).toBe(`/?visitor_request=${first.id}`);
  expect((await query('SELECT notification_is_currently_visible($1,$2) allowed',[notification.id,host.id])).allowed).toBe(true);
  const approved=await gate.visitorAction(host,school,first.id,'approve',{expected_revision:1});
  expect(approved.visitor).toMatchObject({state:'approved',revision:2});
  expect(await gate.visitorAction(host,school,first.id,'approve',{expected_revision:1})).toEqual(approved);
  expect((await gate.approvals(host)).map(row=>row.id)).not.toContain(first.id);
  expect((await query('SELECT notification_is_currently_visible($1,$2) allowed',[notification.id,host.id])).allowed).toBe(false);
  const decision=await query("SELECT * FROM event_outbox WHERE aggregate_id=$1 AND payload->>'action'='approve'",[first.id]);
  expect(decision.notification_user_ids).toEqual([guard.id]);
 });
 it('denies other hosts, revoked hosts and foreign schools',async()=>{
  const visitor=await gate.visitor(guard,school,request());
  await expect(gate.visitorAction(unrelated,school,visitor.id,'approve')).rejects.toThrow(/requested host/);
  await expect(gate.visitorAction(guard,school,visitor.id,'approve')).rejects.toThrow(/requested host/);
  await expect(gate.visitorAction(host,otherSchool,visitor.id,'approve')).rejects.toThrow(/not found/);
  await query('UPDATE school_memberships SET is_active=false WHERE user_id=$1 AND school_id=$2',[host.id,school]);
  expect(await gate.approvals(host)).toEqual([]);
  await expect(gate.visitorAction(host,school,visitor.id,'approve')).rejects.toThrow(/requested host/);
  expect((await query("SELECT event_user_is_authorized($1,'gate.visitor.updated',$2::jsonb,$3) allowed",[school,JSON.stringify({visitor_id:visitor.id,action:'requested'}),host.id])).allowed).toBe(false);
  await query('UPDATE school_memberships SET is_active=true WHERE user_id=$1 AND school_id=$2',[host.id,school]);
  await gate.visitorAction(admin,school,visitor.id,'deny',{expected_revision:1});
  await expect(gate.visitorAction(guard,school,visitor.id,'in')).rejects.toThrow(/not ready/);
 });
 it('rejects expired requests and serializes conflicting decisions',async()=>{
  const expired=await gate.visitor(guard,school,request());
  await query("UPDATE gate_visitors SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
  expect((await gate.approvals(host)).map(row=>row.id)).not.toContain(expired.id);
  expect((await gate.workspace(guard,school)).visitors.find(row=>row.id===expired.id)?.state).toBe('expired');
  await expect(gate.visitorAction(host,school,expired.id,'approve',{expected_revision:1})).rejects.toThrow(/expired/);
  const visitor=await gate.visitor(guard,school,request());
  const results=await Promise.allSettled(['approve','deny'].map(action=>gate.visitorAction(host,school,visitor.id,action,{expected_revision:1})));
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect((await query('SELECT revision FROM gate_visitors WHERE id=$1',[visitor.id])).revision).toBe(2);
  expect((await query("SELECT count(*)::int total FROM event_outbox WHERE aggregate_id=$1 AND event_type='gate.visitor.updated'",[visitor.id])).total).toBe(2);
 });
 it('records host-free arrivals once without inventing a host approval',async()=>{
  const body={...request(),host_user_id:'',category:'delivery'};
  const visitor=await gate.visitor(guard,school,body);
  expect(visitor).toMatchObject({state:'inside',host_user_id:null,category:'delivery',revision:1});
  expect(visitor.checked_in_at).toBeTruthy();expect(visitor.decided_at).toBeNull();
  expect((await gate.visitor(guard,school,body)).id).toBe(visitor.id);
  expect((await gate.workspace(guard,school)).visitors.map(v=>v.id)).toContain(visitor.id);
  expect((await gate.approvals(host)).map(v=>v.id)).not.toContain(visitor.id);
  const event=await query("SELECT * FROM event_outbox WHERE aggregate_id=$1",[visitor.id]);
  expect(event.notification_user_ids).toEqual([]);
  await expect(gate.visitor(unrelated,school,body)).rejects.toThrow(/permission/);
  await expect(gate.visitorAction(host,school,visitor.id,'approve',{expected_revision:1})).rejects.toThrow();
  expect((await gate.visitorAction(guard,school,visitor.id,'out',{expected_revision:1})).visitor.state).toBe('out');
  const observations=(await pool.query(`SELECT observation.payload,entity.kind,entity.domain,entity.domain_id,entity.metadata
    FROM campus_model_observations observation
    JOIN campus_model_entities entity ON entity.id=observation.subject_entity_id
    WHERE observation.school_id=$1 AND observation.source_type='gate.visitor_movement'
      AND entity.domain='gate' AND entity.domain_id=$2
    ORDER BY observation.observed_at,observation.id`,[school,visitor.id])).rows;
  expect(observations).toHaveLength(2);
  expect(observations.map(row=>row.payload.direction)).toEqual(['in','out']);
  expect(observations[0]).toMatchObject({kind:'visitor',domain:'gate',domain_id:visitor.id,metadata:{category:'delivery'}});
  expect(JSON.stringify(observations)).not.toContain(body.phone);
 });
 it('keeps photos private to current host, administrator and gate operators',async()=>{
  const data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
  const upload={data,mimetype:'image/png'};const body=request();
  const visitor=await gate.visitor(guard,school,body,upload);
  expect(visitor.state).toBe('pending');expect(visitor.photo_url).toContain(`/visitors/${visitor.id}/photo/`);
  expect((await gate.visitor(guard,school,body,upload)).id).toBe(visitor.id);
  await expect(gate.visitor(guard,school,body)).rejects.toThrow(/reference already used/);
  expect((await gate.approvals(host)).find(v=>v.id===visitor.id)?.photo_url).toBe(visitor.photo_url);
  for(const actor of [host,admin,guard]){const photo=await gate.visitorPhoto(actor,school,visitor.id);expect(photo.type).toBe('image/png');const chunks:Buffer[]=[];for await(const chunk of photo.stream)chunks.push(Buffer.from(chunk));expect(Buffer.concat(chunks)).toEqual(data);}
  await expect(gate.visitorPhoto(unrelated,school,visitor.id)).rejects.toThrow(/permission/);
  await expect(gate.visitorPhoto(host,otherSchool,visitor.id)).rejects.toThrow(/not found/);
  await expect(gate.visitorPhoto({...host,active_school_id:otherSchool},school,visitor.id)).rejects.toThrow(/access/);
  await query('UPDATE school_memberships SET is_active=false WHERE user_id=$1 AND school_id=$2',[host.id,school]);
  await expect(gate.visitorPhoto(host,school,visitor.id)).rejects.toThrow(/access/);
  await query('UPDATE school_memberships SET is_active=true WHERE user_id=$1 AND school_id=$2',[host.id,school]);
  await expect(gate.visitor(guard,school,request(),{data:Buffer.from('<svg/>'),mimetype:'image/png'})).rejects.toThrow(/JPEG or PNG/);
 });

});
