import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import type { AuthUser } from '../common/request.js';
import type { Database } from '../database/types.js';
import { DatabaseService } from '../database/database.service.js';
import { hasScopedSchoolPermission } from '../roles/authorization.js';
import { hashPassword } from '../auth/password.js';
import { SchoolEventService } from '../school/school-event.service.js';
import { assertGateTransition, assertPassUsable, gateTokenHash, newGateToken } from './gate.rules.js';
type Db=DatabaseService|Transaction<Database>;
interface Person {id:string;name:string;avatar_url:string;admission_number:string;class_label:string;direction:string|null;plan_id:string|null;plan_revision:number|null;plan_state:string|null;mode:string|null;authority_id:string|null;collector_name:string|null;collector_photo:string|null}
interface Pass {id:string;student_id:string;plan_id:string|null;kind:'student'|'pickup';expires_at:Date;used_at:Date|null;revoked_at:Date|null}
interface VisitorRecord {id:string;school_id:string;name:string;phone:string;purpose:string;host_user_id:string;recorded_by:string;decided_by:string|null;state:string;revision:number;request_id:string|null;created_at:Date;expires_at:Date;decided_at:Date|null;checked_in_at:Date|null;checked_out_at:Date|null;host_name?:string;school_name?:string}
function visitorView(v:VisitorRecord) {
 return {id:v.id,school_id:v.school_id,name:v.name,phone:v.phone,purpose:v.purpose,host_user_id:v.host_user_id,
  host_name:v.host_name,school_name:v.school_name,revision:v.revision,created_at:v.created_at,expires_at:v.expires_at,
  decided_at:v.decided_at,checked_in_at:v.checked_in_at,checked_out_at:v.checked_out_at,
  state:['pending','approved'].includes(v.state)&&new Date(v.expires_at).getTime()<=Date.now()?'expired':v.state};
}
@Injectable()
export class GateService {
 constructor(private readonly db:DatabaseService,private readonly events:SchoolEventService) {}
 private async access(user:AuthUser,school:string,db:Db=this.db) {
  z.uuid().parse(school);
  if(!await hasScopedSchoolPermission(db,user.id,school,'gate.manage','institution',school)) throw new ForbiddenException('Manage In & Out permission is required.');
 }
 private async admin(user:AuthUser,school:string,db:Db=this.db) {
  z.uuid().parse(school);
  const m=await db.selectFrom('school_memberships').select('id').where('school_id','=',school).where('user_id','=',user.id).where('role','=','admin').where('is_active','=',true).executeTakeFirst();
  if(!m) throw new ForbiddenException('School administrator access is required.');
 }
 private async lock(db:Db,school:string) {await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`departure:${school}`},0))`.execute(db);}
 private async audit(db:Db,user:AuthUser,school:string,action:string,id:string) {
  await db.insertInto('audit_events').values({actor_id:user.id,school_id:school,action:`gate.${action}`,target_type:'gate',target_id:id,request_id:randomUUID(),ip_hash:'',metadata:{}}).execute();
 }
 private async people(db:Db,school:string,q:string,id?:string) {
  return (await sql<Person>`SELECT s.id,concat(p.first_name,' ',p.last_name) name,
   COALESCE(NULLIF(s.avatar_url,''),p.avatar_url) avatar_url,s.admission_number,
   COALESCE(c.grade||' '||c.section,'') class_label,g.direction,
   dp.id plan_id,dp.revision plan_revision,dp.state plan_state,dp.mode,dp.authority_id,
   concat(cp.first_name,' ',cp.last_name) collector_name,cp.avatar_url collector_photo
   FROM students s JOIN school_people p ON p.id=s.person_id
   LEFT JOIN LATERAL (SELECT cs.grade,cs.section FROM enrollments e JOIN class_sections cs ON cs.id=e.class_section_id
     WHERE e.student_id=s.id AND e.is_active ORDER BY e.enrolled_on DESC LIMIT 1) c ON true
   LEFT JOIN LATERAL (SELECT direction FROM gate_events ge WHERE ge.student_id=s.id ORDER BY occurred_at DESC,id DESC LIMIT 1) g ON true
   LEFT JOIN schools sc ON sc.id=s.school_id
   LEFT JOIN departure_plans dp ON dp.student_id=s.id AND dp.school_id=s.school_id AND dp.is_current AND dp.service_date=(now() AT TIME ZONE sc.timezone)::date
   LEFT JOIN departure_collection_authorities ca ON ca.id=dp.authority_id
   LEFT JOIN guardian_relationships gr ON gr.id=ca.guardian_relationship_id
   LEFT JOIN guardian_school_profiles gp ON gp.guardian_id=gr.guardian_id AND gp.school_id=s.school_id
   LEFT JOIN school_people cp ON cp.id=COALESCE(ca.collector_person_id,gp.person_id)
   WHERE s.school_id=${school}::uuid AND (${id??null}::uuid IS NULL OR s.id=${id??null}::uuid)
   AND (${q}='' OR concat(p.first_name,' ',p.last_name,' ',s.admission_number) ILIKE ${`%${q}%`})
   ORDER BY p.first_name,p.last_name LIMIT 30`.execute(db)).rows;
 }
 private async collectionCurrent(db:Db,school:string,person:Person) {
  if(person.mode==='independent_departure')return true;
  return Boolean((await sql<{allowed:boolean}>`SELECT EXISTS(SELECT 1 FROM departure_collection_authorities ca JOIN departure_plans dp ON dp.authority_id=ca.id WHERE dp.id=${person.plan_id}::uuid AND dp.school_id=${school}::uuid AND ca.school_id=dp.school_id AND ca.student_id=dp.student_id AND ca.status='active' AND ca.valid_from<=dp.service_date AND (ca.valid_until IS NULL OR ca.valid_until>=dp.service_date)) allowed`.execute(db)).rows[0]?.allowed);
 }
 async students(user:AuthUser,school:string,q:string) {
  await this.access(user,school);
  const term=z.string().trim().max(100).parse(q).toLowerCase();
  if(term.length<2)return [];
  // Match and cap the roster before looking up classes. The list does not need
  // gate history or pickup authority; those are fetched fresh on selection.
  const pattern=`%${term.replace(/[\\%_]/g,'\\$&')}%`;
  return (await sql<Pick<Person,'id'|'name'|'avatar_url'|'admission_number'|'class_label'|'plan_state'|'direction'>>`
   WITH matched_ids AS MATERIALIZED (
    SELECT s.id FROM school_people p
    JOIN students s ON s.person_id=p.id AND s.school_id=p.school_id
    WHERE p.school_id=${school}::uuid
     AND lower(p.first_name||' '||p.last_name) LIKE ${pattern} ESCAPE '\\'
    UNION
    SELECT s.id FROM students s WHERE s.school_id=${school}::uuid
     AND lower(s.admission_number) LIKE ${pattern} ESCAPE '\\'
   ), matches AS MATERIALIZED (
    SELECT s.id,s.admission_number,COALESCE(NULLIF(s.avatar_url,''),p.avatar_url) avatar_url,
     p.first_name,p.last_name
    FROM students s JOIN school_people p ON p.id=s.person_id AND p.school_id=s.school_id
    JOIN matched_ids found ON found.id=s.id
    WHERE s.school_id=${school}::uuid
    ORDER BY p.first_name,p.last_name,s.id LIMIT 30
   )
   SELECT m.id,m.first_name||' '||m.last_name name,m.avatar_url,m.admission_number,
    COALESCE(c.grade||' '||c.section,'') class_label,dp.state plan_state,g.direction
   FROM matches m
   JOIN schools sc ON sc.id=${school}::uuid
   LEFT JOIN departure_plans dp ON dp.student_id=m.id AND dp.school_id=sc.id AND dp.is_current
    AND dp.service_date=(now() AT TIME ZONE sc.timezone)::date
   LEFT JOIN LATERAL (
    SELECT cs.grade,cs.section FROM enrollments e JOIN class_sections cs ON cs.id=e.class_section_id
    WHERE e.student_id=m.id AND e.is_active AND cs.school_id=${school}::uuid
    ORDER BY e.enrolled_on DESC,e.id DESC LIMIT 1
   ) c ON true
   LEFT JOIN LATERAL (SELECT ge.direction FROM gate_events ge WHERE ge.student_id=m.id
    ORDER BY ge.occurred_at DESC,ge.id DESC LIMIT 1) g ON true
   ORDER BY m.first_name,m.last_name,m.id`.execute(this.db)).rows;
 }
 async student(user:AuthUser,school:string,id:string) {
  await this.access(user,school);z.uuid().parse(id);
  const student=(await this.people(this.db,school,'',id))[0];
  if(!student)throw new NotFoundException('Student not found.');
  return student;
 }
 async workspace(user:AuthUser,school:string) {
  await this.access(user,school);
  const visitors=(await sql<VisitorRecord>`SELECT v.*,u.first_name||' '||u.last_name host_name,
   CASE WHEN v.state IN ('pending','approved') AND v.expires_at<=now() THEN 'expired' ELSE v.state END state
   FROM gate_visitors v JOIN users u ON u.id=v.host_user_id
   WHERE v.school_id=${school}::uuid AND (v.state='inside' OR v.created_at>now()-interval '1 day')
   ORDER BY v.created_at DESC,v.id DESC LIMIT 100`.execute(this.db)).rows;
  const hosts=await this.db.selectFrom('school_memberships as m').innerJoin('users as u','u.id','m.user_id').select(['u.id','u.first_name','u.last_name']).where('m.school_id','=',school).where('m.is_active','=',true).where('u.is_active','=',true).where('m.role','in',['admin','staff']).execute();
  const office=await this.db.selectFrom('school_contacts').select(['name','phone']).where('school_id','=',school).where('phone','!=','').orderBy('priority').executeTakeFirst();
  return {office:office??null,visitors:visitors.map(visitorView),hosts:hosts.map(h=>({id:h.id,name:`${h.first_name} ${h.last_name}`})),pending:visitors.filter(v=>v.state==='pending').length};
 }
 async issuePass(user:AuthUser,school:string,body:unknown) {
  const b=z.object({student_id:z.uuid(),kind:z.enum(['student','pickup'])}).parse(body);
  return this.db.transaction().execute(async tx=>{
   await this.lock(tx,school);
   const student=await tx.selectFrom('students').select('id').where('school_id','=',school).where('id','=',b.student_id).executeTakeFirst();
   if(!student) throw new NotFoundException('Student not found.');
   const isAdmin=Boolean(await tx.selectFrom('school_memberships').select('id').where('user_id','=',user.id).where('school_id','=',school).where('role','=','admin').where('is_active','=',true).executeTakeFirst());
   if(!isAdmin) {
    const linked=(await sql<{allowed:boolean}>`SELECT EXISTS(SELECT 1 FROM guardian_relationships gr JOIN parents p ON p.id=gr.guardian_id JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=gr.school_id AND m.role='guardian' AND m.is_active WHERE gr.student_id=${b.student_id}::uuid AND gr.school_id=${school}::uuid AND p.user_id=${user.id}::uuid) allowed`.execute(tx)).rows[0]?.allowed;
    if(!linked) throw new ForbiddenException('Guardian access is required.');
   }
   const person=(await this.people(tx,school,'',b.student_id))[0]!;
   if(b.kind==='pickup' && (!person.plan_id || person.plan_state!=='ready' || !['guardian_pickup','authorized_collector','independent_departure'].includes(person.mode??''))) throw new ConflictException('School must approve the arrangement and mark the student ready first.');
   if(b.kind==='pickup'&&!await this.collectionCurrent(tx,school,person))throw new ForbiddenException('Pickup authority was revoked or has expired.');
   // A parent may display only their own currently approved guardian collection pass.
   if(!isAdmin && b.kind==='pickup') {
    const own=(await sql<{allowed:boolean}>`SELECT EXISTS(SELECT 1 FROM departure_collection_authorities ca JOIN guardian_relationships gr ON gr.id=ca.guardian_relationship_id JOIN parents p ON p.id=gr.guardian_id WHERE ca.id=${person.authority_id}::uuid AND p.user_id=${user.id}::uuid AND ca.status='active') allowed`.execute(tx)).rows[0]?.allowed;
    if(!own) throw new ForbiddenException('The school must issue this pass to the approved collecting person.');
   }
   const token=newGateToken(),expires=new Date(Date.now()+(b.kind==='student'?365*86400000:15*60000));
   const result=(await sql<{id:string}>`INSERT INTO gate_qr_passes(school_id,student_id,plan_id,token_hash,kind,expires_at,created_by) VALUES(${school}::uuid,${b.student_id}::uuid,${b.kind==='pickup'?person.plan_id:null}::uuid,${gateTokenHash(token)},${b.kind},${expires},${user.id}::uuid) RETURNING id`.execute(tx)).rows[0]!;
   await this.audit(tx,user,school,'pass_issued',result.id);
   return {qr:token,expires_at:expires,kind:b.kind,name:person.name};
  });
 }
 private async pass(db:Db,school:string,token:string) {
  const p=(await sql<Pass>`SELECT * FROM gate_qr_passes WHERE school_id=${school}::uuid AND token_hash=${gateTokenHash(token)} FOR UPDATE`.execute(db)).rows[0];
  if(!p) throw new NotFoundException('QR pass not found in this school.'); assertPassUsable(p); return p;
 }
 async scan(user:AuthUser,school:string,body:unknown) {
  await this.access(user,school); const b=z.object({qr:z.string().max(100)}).parse(body);
  return this.db.transaction().execute(async tx=>{
   const visitor=(await sql<VisitorRecord & {pass_expires_at:Date}>`SELECT v.*,u.first_name||' '||u.last_name host_name
    FROM gate_visitors v JOIN users u ON u.id=v.host_user_id WHERE v.school_id=${school}::uuid AND v.token_hash=${gateTokenHash(b.qr)}`.execute(tx)).rows[0];
   if(visitor){if(!['approved','inside'].includes(visitor.state)||new Date(visitor.pass_expires_at).getTime()<=Date.now()||(visitor.state==='approved'&&new Date(visitor.expires_at).getTime()<=Date.now())) throw new ConflictException('Visitor pass expired or was already used.');return {visitor:visitorView(visitor),kind:'visitor' as const};}
   const p=await this.pass(tx,school,b.qr); const student=(await this.people(tx,school,'',p.student_id))[0];
   if(!student) throw new NotFoundException('Student not found.');
   if(p.kind==='pickup' && (student.plan_id!==p.plan_id || student.plan_state!=='ready')) throw new ConflictException('The pickup arrangement has changed. Contact the school office.');
   if(p.kind==='pickup'&&!await this.collectionCurrent(tx,school,student))throw new ForbiddenException('Pickup authority was revoked or has expired.');
   return {student,kind:p.kind};});
 }
 async movement(user:AuthUser,school:string,body:unknown) {
  const b=z.object({student_id:z.uuid(),direction:z.enum(['in','out']),qr:z.string().max(100).optional(),command_id:z.uuid(),identity_verified:z.literal(true),gate:z.string().trim().min(1).max(80).default('Main gate')}).parse(body);
  return this.db.transaction().execute(async tx=>{
   await this.lock(tx,school); await this.access(user,school,tx);
   const previous=await tx.selectFrom('gate_events').select(['id','student_id','direction','recorded_by']).where('command_id','=',b.command_id).executeTakeFirst();
   if(previous){if(previous.student_id!==b.student_id || previous.direction!==b.direction || previous.recorded_by!==user.id) throw new ConflictException('Movement reference was already used.');return {id:previous.id,saved:true};}
   const person=(await this.people(tx,school,'',b.student_id))[0]; if(!person) throw new NotFoundException('Student not found.');
   const p=b.qr?await this.pass(tx,school,b.qr):null;
   if(p && p.student_id!==b.student_id) throw new BadRequestException('QR does not match this student.');
   assertGateTransition(person.direction??undefined,b.direction);
   if(p?.kind==='pickup' && b.direction!=='out') throw new BadRequestException('Pickup QR is for exit only.');
   if(b.direction==='out') {
    if(!p || p.kind!=='pickup' || person.plan_id!==p.plan_id || person.plan_state!=='ready') throw new ConflictException('A current approved pickup QR is required for exit.');
    const plan=await tx.selectFrom('departure_plans').selectAll().where('school_id','=',school).where('id','=',p.plan_id!).where('is_current','=',true).forUpdate().executeTakeFirstOrThrow();
    if(!['guardian_pickup','authorized_collector','independent_departure'].includes(plan.mode)) throw new BadRequestException('Use the school transport workflow for this departure.');
    let snapshot:Record<string,unknown>={};
    if(plan.mode!=='independent_departure') {
     const a=await tx.selectFrom('departure_collection_authorities').selectAll().where('id','=',plan.authority_id!).where('school_id','=',school).where('student_id','=',b.student_id).where('status','=','active').where('valid_from','<=',plan.service_date).where(eb=>eb.or([eb('valid_until','is',null),eb('valid_until','>=',plan.service_date)])).executeTakeFirst();
     if(!a) throw new ForbiddenException('Pickup authority was revoked or has expired.');snapshot={authority_id:a.id,revision:a.revision};
    }
    await tx.insertInto('departure_handovers').values({school_id:school,plan_id:plan.id,student_id:b.student_id,outcome:plan.mode==='independent_departure'?'departed_independently':'handed_over',authority_id:plan.authority_id,authority_snapshot:snapshot,evidence_method:'in_person_verification',note:'QR checked and identity verified at gate',occurred_at:new Date(),recorded_by:user.id}).execute();
    await tx.updateTable('departure_plans').set({state:'completed',revision:plan.revision+1,updated_at:new Date()}).where('id','=',plan.id).execute();
    await sql`UPDATE gate_qr_passes SET used_at=now() WHERE id=${p.id}::uuid`.execute(tx);
   }
   const row=await tx.insertInto('gate_events').values({student_id:b.student_id,direction:b.direction,gate:b.gate,source:'gatekeeper',device_reference:'',occurred_at:new Date(),recorded_by:user.id,command_id:b.command_id}).returning('id').executeTakeFirstOrThrow();
   await this.audit(tx,user,school,b.direction,row.id);
   const guardians=(await sql<{user_id:string}>`SELECT DISTINCT p.user_id FROM parents p JOIN guardian_relationships gr ON gr.guardian_id=p.id JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=gr.school_id AND m.role='guardian' AND m.is_active WHERE gr.student_id=${b.student_id}::uuid AND gr.school_id=${school}::uuid AND p.user_id IS NOT NULL`.execute(tx)).rows.map(g=>g.user_id);
   await this.events.enqueueUserEvent(tx,{schoolId:school,eventType:'departure.updated',aggregateType:'gate_event',aggregateId:row.id,audienceUserIds:guardians,idempotencyKey:`gate:${row.id}`,payload:{student_id:b.student_id,direction:b.direction},notificationUserIds:guardians,notificationPayload:{kind:'general',title:b.direction==='in'?'Student entered school':'Student left school',body:`${person.name} ${b.direction==='in'?'entered':'left'} through ${b.gate}.`,link:`/parent/departure?student_id=${b.student_id}`,metadata:{school_id:school,student_id:b.student_id}}});
   return {id:row.id,saved:true};
  });
 }
 async approvals(user:AuthUser) {
  const rows=(await sql<VisitorRecord>`SELECT v.*,s.name school_name,u.first_name||' '||u.last_name host_name
   FROM gate_visitors v JOIN schools s ON s.id=v.school_id JOIN users u ON u.id=v.host_user_id AND u.is_active
   WHERE v.host_user_id=${user.id}::uuid AND v.state='pending' AND v.expires_at>now()
    AND (${user.active_school_id??null}::uuid IS NULL OR v.school_id=${user.active_school_id??null}::uuid)
    AND EXISTS(SELECT 1 FROM school_memberships m WHERE m.school_id=v.school_id AND m.user_id=${user.id}::uuid AND m.is_active AND m.role IN ('staff','admin'))
   ORDER BY v.created_at,v.id LIMIT 30`.execute(this.db)).rows;
  return rows.map(visitorView);
 }
 private async visitorChanged(tx:Db,v:VisitorRecord,action:string) {
  const audience=(await sql<{user_id:string}>`SELECT DISTINCT m.user_id FROM school_memberships m
   JOIN users u ON u.id=m.user_id AND u.is_active
   WHERE m.school_id=${v.school_id}::uuid AND m.is_active AND m.role IN ('staff','admin')
    AND (m.user_id=${v.host_user_id}::uuid OR m.role='admin'
      OR staff_has_resource_permission(m.school_id,m.user_id,'gate.manage','institution',m.school_id))`.execute(tx)).rows.map(row=>row.user_id);
  const requested=action==='requested';
  const labels:Record<string,string>={requested:'Visitor approval requested',approve:'Visitor approved',deny:'Visitor declined',in:'Visitor checked in',out:'Visitor checked out'};
  await this.events.enqueueUserEvent(tx,{schoolId:v.school_id,eventType:'gate.visitor.updated',aggregateType:'gate_visitor',aggregateId:v.id,
   audienceUserIds:audience,payload:{visitor_id:v.id,revision:v.revision,action,refresh:['gate','notifications']},
   idempotencyKey:`gate-visitor:${v.id}:${v.revision}`,notificationUserIds:requested?[v.host_user_id]:['approve','deny'].includes(action)?[v.recorded_by]:[v.host_user_id],
   notificationPayload:{kind:'general',title:labels[action],body:requested?`${v.name} is waiting at the gate. ${v.purpose}`:`${v.name} · ${labels[action]}`,
    link:requested?`/?visitor_request=${v.id}`:['approve','deny'].includes(action)?'/gate':'/',metadata:{school_id:v.school_id,visitor_id:v.id}}});
 }
 async visitor(user:AuthUser,school:string,body:unknown) {
  const b=z.object({name:z.string().trim().min(2).max(150),phone:z.string().trim().min(6).max(32),purpose:z.string().trim().min(3).max(300),host_user_id:z.uuid(),request_id:z.uuid().optional()}).parse(body);
  const requestId=b.request_id??randomUUID();
  return this.db.transaction().execute(async tx=>{await this.access(user,school,tx);
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`visitor:${school}:${requestId}`},0))`.execute(tx);
   const existing=(await sql<VisitorRecord>`SELECT * FROM gate_visitors WHERE school_id=${school}::uuid AND request_id=${requestId}::uuid`.execute(tx)).rows[0];
   if(existing){if(existing.recorded_by!==user.id||existing.name!==b.name||existing.phone!==b.phone||existing.purpose!==b.purpose||existing.host_user_id!==b.host_user_id)throw new ConflictException('Request reference already used. Review the visitor list before starting a new request.');return visitorView(existing);}
   const host=await tx.selectFrom('school_memberships as m').innerJoin('users as u','u.id','m.user_id').select(['u.first_name','u.last_name']).where('m.user_id','=',b.host_user_id).where('m.school_id','=',school).where('m.role','in',['staff','admin']).where('m.is_active','=',true).where('u.is_active','=',true).executeTakeFirst();if(!host) throw new BadRequestException('Select an active host in this school.');
   const v=(await sql<VisitorRecord>`INSERT INTO gate_visitors(school_id,name,phone,purpose,host_user_id,recorded_by,request_id) VALUES(${school}::uuid,${b.name},${b.phone},${b.purpose},${b.host_user_id}::uuid,${user.id}::uuid,${requestId}::uuid) RETURNING *`.execute(tx)).rows[0]!;
   await this.audit(tx,user,school,'visitor_registered',v.id);await this.visitorChanged(tx,v,'requested');
   return visitorView({...v,host_name:`${host.first_name} ${host.last_name}`});});
 }
 async visitorAction(user:AuthUser,school:string,id:string,action:string,body:unknown={}) {
  z.uuid().parse(school);z.uuid().parse(id);z.enum(['approve','deny','in','out']).parse(action);
  const b=z.object({expected_revision:z.number().int().positive().optional()}).parse(body??{});
  return this.db.transaction().execute(async tx=>{
   const v=(await sql<VisitorRecord>`SELECT v.*,u.first_name||' '||u.last_name host_name FROM gate_visitors v
    JOIN users u ON u.id=v.host_user_id WHERE v.school_id=${school}::uuid AND v.id=${id}::uuid FOR UPDATE OF v`.execute(tx)).rows[0];if(!v) throw new NotFoundException('Visitor not found.');
   const decision=['approve','deny'].includes(action);
   const state=({approve:'approved',deny:'denied',in:'inside',out:'out'} as Record<string,string>)[action]!;
   if(decision){
    const member=await tx.selectFrom('school_memberships as m').innerJoin('users as u','u.id','m.user_id').select('m.role').where('m.school_id','=',school).where('m.user_id','=',user.id).where('m.is_active','=',true).where('u.is_active','=',true).where('m.role','in',['staff','admin']).executeTakeFirst();
    if(!member||(member.role!=='admin'&&v.host_user_id!==user.id)||(user.active_school_id&&user.active_school_id!==school))throw new ForbiddenException('Only the requested host or a school administrator can decide this request.');
    if(b.expected_revision!==undefined&&v.state===state&&v.decided_by===user.id&&v.revision===b.expected_revision+1)return {saved:true,visitor:visitorView(v)};
   }else await this.access(user,school,tx);
   if(b.expected_revision!==undefined&&b.expected_revision!==v.revision)throw new ConflictException('Visitor request changed. Refresh and review the current status.');
   if((decision||action==='in')&&new Date(v.expires_at).getTime()<=Date.now())throw new ConflictException('Visitor request expired. Ask the gate desk for a new request.');
   if(v.state!==(decision?'pending':action==='in'?'approved':'inside'))throw new ConflictException(decision?'Visitor decision already recorded.':'Visitor is not ready for this movement.');
   const updated=(await sql<VisitorRecord>`UPDATE gate_visitors SET state=${state},revision=revision+1,
    decided_by=CASE WHEN ${decision} THEN ${user.id}::uuid ELSE decided_by END,
    decided_at=CASE WHEN ${decision} THEN now() ELSE decided_at END,
    checked_in_at=CASE WHEN ${action}='in' THEN now() ELSE checked_in_at END,
    checked_out_at=CASE WHEN ${action}='out' THEN now() ELSE checked_out_at END
    WHERE id=${id}::uuid AND school_id=${school}::uuid RETURNING *`.execute(tx)).rows[0]!;
   await this.audit(tx,user,school,`visitor_${action}`,id);await this.visitorChanged(tx,updated,action);
   return {saved:true,visitor:visitorView({...updated,host_name:v.host_name??''})};
  });
 }
 async visitorPass(user:AuthUser,school:string,id:string) {
  z.uuid().parse(id);await this.admin(user,school);
  return this.db.transaction().execute(async tx=>{
   await this.admin(user,school,tx);
   const v=(await sql<{name:string;state:string;expires_at:Date}>`SELECT name,state,expires_at FROM gate_visitors WHERE id=${id}::uuid AND school_id=${school}::uuid FOR UPDATE`.execute(tx)).rows[0];
   if(!v || !['approved','inside'].includes(v.state)) throw new ConflictException('Approve the visitor before issuing a QR pass.');
   if(new Date(v.expires_at).getTime()<=Date.now())throw new ConflictException('Visitor request expired.');
   const token=newGateToken(),expires=new Date(Math.min(new Date(v.expires_at).getTime(),Date.now()+8*3600000));
   await sql`UPDATE gate_visitors SET token_hash=${gateTokenHash(token)},pass_expires_at=${expires} WHERE id=${id}::uuid`.execute(tx);
   await this.audit(tx,user,school,'visitor_pass_issued',id);
   return {qr:token,expires_at:expires,kind:'visitor',name:v.name};
  });
 }
 async gatekeeper(user:AuthUser,school:string,body:unknown) {
  await this.admin(user,school);const b=z.object({name:z.string().trim().min(2).max(100),username:z.string().regex(/^[a-z0-9._-]{4,60}$/)}).parse(body);
  const password=`E!7a${randomBytes(18).toString('base64url')}`,hash=await hashPassword(password);
  return this.db.transaction().execute(async tx=>{
   await this.admin(user,school,tx);
   if(await tx.selectFrom('users').select('id').where('username','=',b.username).executeTakeFirst()) throw new ConflictException('This username already exists.');
   const account=await tx.insertInto('users').values({username:b.username,email:`${b.username}.${randomUUID()}@accounts.eduera.invalid`,password_hash:hash,first_name:b.name,last_name:'',role:'staff',is_active:true,email_verified_at:new Date()}).returning('id').executeTakeFirstOrThrow();
   await tx.insertInto('school_memberships').values({user_id:account.id,school_id:school,role:'staff',is_active:true}).execute();
   const profile=await tx.insertInto('staff_profiles').values({school_id:school,user_id:account.id,staff_code:`GATE-${randomBytes(4).toString('hex')}`,first_name:b.name,last_name:'',email:`${account.id}@accounts.eduera.invalid`,phone:'',staff_kind:'non_teaching',designation:'Gatekeeper',department:'Security',employment_type:'full_time',joined_on:new Date().toISOString().slice(0,10),status:'active',created_by:user.id,updated_by:user.id}).returning('id').executeTakeFirstOrThrow();
   const role=(await sql<{id:string}>`INSERT INTO staff_responsibility_types(school_id,code,name,category,scope_kind,description,access_summary,requires_acceptance,capability_permissions,context_kind,source_kind,workflow_family) VALUES(${school}::uuid,'gatekeeper','Gatekeeper','operations','school','School gate entry and exit','Manage In & Out',false,ARRAY['gate.manage'],'institution','system','gatekeeper') ON CONFLICT(school_id,code) DO NOTHING RETURNING id`.execute(tx)).rows[0] ?? (await sql<{id:string}>`SELECT id FROM staff_responsibility_types WHERE school_id=${school}::uuid AND code='gatekeeper'`.execute(tx)).rows[0]!;
   await sql`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,scope_label,starts_on,status,assigned_by) VALUES(${school}::uuid,${role.id}::uuid,${profile.id}::uuid,'School gate',current_date,'active',${user.id}::uuid)`.execute(tx);
   await this.audit(tx,user,school,'gatekeeper_created',account.id);return {id:account.id,username:b.username,password};
  });
 }
}
