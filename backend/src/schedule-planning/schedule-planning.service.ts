import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { AuthenticatedRequest, AuthUser } from '../common/request.js';
import { DatabaseService } from '../database/database.service.js';
import { SchoolEventService } from '../school/school-event.service.js';
import { SchoolService } from '../school/school.service.js';
import { authorize, activeTeachers, dayContext } from '../day-plans/repository.js';
import { lockSchedule } from '../day-plans/schedule.js';
import type { PlanDb } from '../day-plans/contracts.js';
import { uuid } from '../day-plans/contracts.js';
import { action, start, save, year, localConflicts, type Version, type Period } from './contracts.js';

@Injectable()
export class SchedulePlanningService {
  constructor(private readonly db:DatabaseService,private readonly events:SchoolEventService,private readonly school:SchoolService) {}

  async screen(user:AuthUser,term?:string) {
    const memberships=await this.db.selectFrom('school_memberships').select('school_id').where('user_id','=',user.id).where('role','=','admin').where('is_active','=',true).execute();
    const schoolId=memberships.find(m=>m.school_id===user.active_school_id)?.school_id ?? (memberships.length===1?memberships[0]!.school_id:null);
    if(!schoolId) throw new ForbiddenException('Select an institution with administrator access.');
    await authorize(this.db,user,schoolId,'admin');
    const data=await this.school.principalTimetableScreen(user,term);
    const versions=(await sql<Version>`SELECT * FROM schedule_versions WHERE school_id=${schoolId}::uuid AND term_id=${data.selected_term_id}::uuid AND state<>'discarded' ORDER BY starts_on DESC,created_at DESC`.execute(this.db)).rows;
    const periods=(await sql<Period & {version_id:string}>`SELECT p.* FROM schedule_periods p JOIN schedule_versions v ON v.id=p.version_id WHERE v.school_id=${schoolId}::uuid AND v.term_id=${data.selected_term_id}::uuid AND v.state<>'discarded' ORDER BY p.weekday,p.period_number`.execute(this.db)).rows;
    const selected=data.terms.find(t=>t.id===data.selected_term_id);
    const on=selected?[String(selected.starts_on),[data.school_date,String(selected.ends_on)].sort()[0]!].sort().at(-1)!:data.school_date;
    const coverage=data.coverage.map(row=>{
      const v=versions.filter(v=>v.class_section_id===row.class_section_id&&v.state==='published'&&v.starts_on<=on&&v.ends_on>=on).sort((a,b)=>Number(a.baseline)-Number(b.baseline)||b.starts_on.localeCompare(a.starts_on))[0];
      if(!v)return row;
      const rows=periods.filter(p=>p.version_id===v.id&&p.subject_id===row.subject_id&&p.slot_type==='class');
      const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
      return {...row,weekly_periods:rows.length,weekly_minutes:rows.reduce((sum,p)=>sum+minutes(p.ends_at)-minutes(p.starts_at),0)};
    });
    return {...data,coverage,school_id:schoolId,versions:versions.map(v=>({...v,periods:periods.filter(p=>p.version_id===v.id)}))};
  }

  private async command<T>(req:AuthenticatedRequest,input:{school_id:string;idempotency_key:string},identity:unknown,run:(db:PlanDb)=>Promise<T>) {
    const hash=createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    return this.db.transaction().execute(async db=>{
      await sql`SET LOCAL statement_timeout='30s'`.execute(db);
      await sql`SET LOCAL lock_timeout='5s'`.execute(db);
      await lockSchedule(db,input.school_id);
      await authorize(db,req.authUser,input.school_id,'admin',true);
      const old=(await sql<{request_hash:string;result:T}>`SELECT request_hash,result FROM day_plan_commands WHERE school_id=${input.school_id}::uuid AND actor_id=${req.authUser.id}::uuid AND command_key=${input.idempotency_key}::uuid`.execute(db)).rows[0];
      if(old) { if(old.request_hash!==hash) throw new ConflictException('This retry belongs to a different action.'); return old.result; }
      const result=await run(db);
      await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result) VALUES(${input.school_id}::uuid,${req.authUser.id}::uuid,${input.idempotency_key}::uuid,${hash},${JSON.stringify(result)}::jsonb)`.execute(db);
      return result;
    });
  }
  private async audit(db:PlanDb,req:AuthenticatedRequest,school:string,id:string,kind:string,metadata:Record<string,unknown>) {
    await db.insertInto('audit_events').values({school_id:school,actor_id:req.authUser.id,action:`schedule.${kind}`,target_type:'schedule',target_id:id,request_id:req.requestId,ip_hash:null,metadata}).execute();
    const admins=(await db.selectFrom('school_memberships').select('user_id').where('school_id','=',school).where('role','=','admin').where('is_active','=',true).execute()).map(m=>m.user_id);
    await this.events.enqueueUserEvent(db,{schoolId:school,eventType:'timetable.updated',aggregateType:'schedule',aggregateId:id,audienceUserIds:admins,idempotencyKey:`schedule:${id}:${req.requestId}:${kind}`,payload:{refresh:['principal.timetable'],change_kind:kind}});
  }
  private async draft(db:PlanDb,school:string,id:string,revision?:number) {
    uuid.parse(id);
    const v=(await sql<Version>`SELECT * FROM schedule_versions WHERE id=${id}::uuid AND school_id=${school}::uuid FOR UPDATE`.execute(db)).rows[0];
    if(!v) throw new NotFoundException('Timetable not found.');
    if(v.state!=='draft') throw new ConflictException('This timetable is read-only. Prepare a new draft.');
    if(revision!==undefined && v.revision!==revision) throw new ConflictException('Someone changed this draft. Reload before saving.');
    return v;
  }
  private async dates(db:PlanDb,school:string,term:string,classId:string,from:string,to:string) {
    const context=await dayContext(db,school,from);
    // Published recurring changes begin on a future day, never midway through today's attendance.
    if(from<=context.today) throw new BadRequestException('Choose a start date after today. Use Daily Plan for changes today.');
    const valid=(await sql`SELECT 1 FROM academic_terms t JOIN class_sections c ON c.school_id=t.school_id AND c.academic_year=t.academic_year WHERE t.school_id=${school}::uuid AND t.id=${term}::uuid AND c.id=${classId}::uuid AND ${from}::date>=t.starts_on AND ${to}::date<=t.ends_on AND ${to}::date>=${from}::date`.execute(db)).rows.length;
    if(!valid) throw new BadRequestException('Choose a class and dates within this term.');
    if((Date.parse(to)-Date.parse(from))/86400000>370) throw new BadRequestException('A timetable can cover up to 371 days.');
  }
  private async insertPeriods(db:PlanDb,id:string,rows:Period[]) {
    if(!rows.length)return;
    await sql`INSERT INTO schedule_periods(version_id,id,weekday,period_number,starts_at,ends_at,subject_id,teacher_user_id,title,slot_type,room) SELECT ${id}::uuid,p.id::uuid,p.weekday,p.period_number,p.starts_at::time,p.ends_at::time,p.subject_id::uuid,p.teacher_user_id::uuid,p.title,p.slot_type,p.room FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS p(id text,weekday smallint,period_number smallint,starts_at text,ends_at text,subject_id text,teacher_user_id text,title text,slot_type text,room text)`.execute(db);
  }
  private async reusePattern(db:PlanDb,target:string,school:string,classId:string,term:string,date:string) {
    const source=(await sql<{id:string}>`SELECT id FROM schedule_versions WHERE school_id=${school}::uuid AND class_section_id=${classId}::uuid AND term_id=${term}::uuid AND state='published' AND ${date}::date BETWEEN starts_on AND ends_on ORDER BY baseline ASC,starts_on DESC LIMIT 1`.execute(db)).rows[0];
    const rows=source
      ?(await sql<Period>`SELECT p.* FROM schedule_periods p WHERE version_id=${source.id}::uuid`.execute(db)).rows
      :(await sql<Period>`SELECT s.*,COALESCE(subject.name,NULLIF(s.title,''),'Period') AS title FROM timetable_slots s LEFT JOIN subjects subject ON subject.id=s.subject_id WHERE s.class_section_id=${classId}::uuid AND s.term_id=${term}::uuid`.execute(db)).rows;
    const active=(await sql<{id:string}>`SELECT m.user_id AS id FROM school_memberships m JOIN users u ON u.id=m.user_id WHERE m.school_id=${school}::uuid AND m.role='staff' AND m.is_active AND u.is_active`.execute(db)).rows.map(r=>r.id);
    // Reuse timings and subjects, but never silently restore a departed teacher.
    await this.insertPeriods(db,target,rows.map(p=>({...p,id:randomUUID(),teacher_user_id:p.teacher_user_id&&active.includes(p.teacher_user_id)?p.teacher_user_id:null})));
  }
  start(req:AuthenticatedRequest,body:unknown) {
    const input=start.parse(body);
    return this.command(req,input,{kind:'schedule.start',...input},async db=>{
      await this.dates(db,input.school_id,input.term_id,input.class_section_id,input.starts_on,input.ends_on);
      if((await sql`SELECT 1 FROM schedule_versions WHERE class_section_id=${input.class_section_id}::uuid AND term_id=${input.term_id}::uuid AND state='draft'`.execute(db)).rows.length) throw new ConflictException('This class already has a draft. Open it to continue.');
      const v=(await sql<Version>`INSERT INTO schedule_versions(school_id,term_id,class_section_id,starts_on,ends_on,created_by) VALUES(${input.school_id}::uuid,${input.term_id}::uuid,${input.class_section_id}::uuid,${input.starts_on}::date,${input.ends_on}::date,${req.authUser.id}::uuid) RETURNING *`.execute(db)).rows[0]!;
      if(input.source_id) {
        const source=(await sql<Version>`SELECT * FROM schedule_versions WHERE id=${input.source_id}::uuid AND school_id=${input.school_id}::uuid AND state='published'`.execute(db)).rows[0];
        if(!source)throw new BadRequestException('Choose a published timetable from this institution.');
        await sql`INSERT INTO schedule_periods(version_id,weekday,period_number,starts_at,ends_at,subject_id,teacher_user_id,title,slot_type,room) SELECT ${v.id}::uuid,weekday,period_number,starts_at,ends_at,subject_id,CASE WHEN EXISTS(SELECT 1 FROM school_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=p.teacher_user_id AND m.school_id=${input.school_id}::uuid AND m.role='staff' AND m.is_active AND u.is_active) THEN teacher_user_id END,title,slot_type,room FROM schedule_periods p WHERE version_id=${source.id}::uuid`.execute(db);
      } else {
        // Reuse the effective repeating pattern, never a dated substitution.
        await this.reusePattern(db,v.id,input.school_id,input.class_section_id,input.term_id,input.starts_on);
      }
      await this.audit(db,req,input.school_id,v.id,'draft_created',{starts_on:input.starts_on,ends_on:input.ends_on});
      return {id:v.id,revision:1};
    });
  }
  save(req:AuthenticatedRequest,id:string,body:unknown) {
    const input=save.parse(body);
    return this.command(req,input,{kind:'schedule.save',id,...input},async db=>{
      const v=await this.draft(db,input.school_id,id,input.expected_revision);
      await this.dates(db,v.school_id,v.term_id,v.class_section_id,input.starts_on,input.ends_on);
      await activeTeachers(db,v.school_id,input.periods.flatMap(p=>p.teacher_user_id?[p.teacher_user_id]:[]),true);
      const subjectIds=(await db.selectFrom('subjects').select('id').where('school_id','=',v.school_id).execute()).map(s=>s.id);
      if(input.periods.some(p=>p.subject_id&&!subjectIds.includes(p.subject_id)))throw new BadRequestException('Choose subjects from this institution.');
      await sql`DELETE FROM schedule_periods WHERE version_id=${v.id}::uuid`.execute(db);
      await this.insertPeriods(db,v.id,input.periods);
      await sql`UPDATE schedule_versions SET starts_on=${input.starts_on}::date,ends_on=${input.ends_on}::date,revision=revision+1 WHERE id=${v.id}::uuid`.execute(db);
      await this.audit(db,req,v.school_id,v.id,'draft_saved',{revision:v.revision+1});
      return {id:v.id,revision:v.revision+1,warnings:localConflicts(input.periods)};
    });
  }
  discard(req:AuthenticatedRequest,id:string,body:unknown) {
    const input=action.parse(body);
    return this.command(req,input,{kind:'schedule.discard',id,...input},async db=>{
      const v=await this.draft(db,input.school_id,id,input.expected_revision);
      await sql`UPDATE schedule_versions SET state='discarded',revision=revision+1 WHERE id=${id}::uuid`.execute(db);
      await this.audit(db,req,v.school_id,id,'discarded',{});
      return {id};
    });
  }
  publish(req:AuthenticatedRequest,id:string,body:unknown) {
    const input=action.parse(body);
    return this.command(req,input,{kind:'schedule.publish',id,...input},async db=>{
      const v=await this.draft(db,input.school_id,id,input.expected_revision);
      await this.dates(db,v.school_id,v.term_id,v.class_section_id,v.starts_on,v.ends_on);
      const rows=(await sql<Period>`SELECT * FROM schedule_periods WHERE version_id=${id}::uuid`.execute(db)).rows;
      if(!rows.length)throw new BadRequestException('Add periods before publishing. Use School dates for a closure.');
      const conflicts=localConflicts(rows);
      if(conflicts.length)throw new BadRequestException(conflicts[0]);
      if(rows.some(p=>p.slot_type==='class'&&!p.teacher_user_id))throw new BadRequestException('Assign a teacher to every teaching period before publishing.');
      await activeTeachers(db,v.school_id,rows.flatMap(p=>p.teacher_user_id?[p.teacher_user_id]:[]),true);
      if((await sql`SELECT 1 FROM schedule_versions WHERE class_section_id=${v.class_section_id}::uuid AND term_id=${v.term_id}::uuid AND state='published' AND NOT baseline AND starts_on=${v.starts_on}::date`.execute(db)).rows.length)throw new ConflictException('A published timetable already starts on this date. Choose a later date or a daily change.');
      if((await sql`SELECT 1 FROM schedule_versions WHERE class_section_id=${v.class_section_id}::uuid AND term_id=${v.term_id}::uuid AND state='published' AND NOT baseline AND starts_on>${v.starts_on}::date AND starts_on<=${v.ends_on}::date`.execute(db)).rows.length)throw new ConflictException('A later timetable is already scheduled within this range. End this arrangement before it, or choose a later start date.');
      // Freeze the original baseline, including its original slot identities.
      if(!(await sql`SELECT 1 FROM schedule_versions WHERE class_section_id=${v.class_section_id}::uuid AND term_id=${v.term_id}::uuid AND baseline`.execute(db)).rows.length) {
        const frozen=(await sql<{id:string}>`INSERT INTO schedule_versions(school_id,term_id,class_section_id,starts_on,ends_on,created_by,baseline) SELECT ${v.school_id}::uuid,t.id,${v.class_section_id}::uuid,t.starts_on,t.ends_on,${req.authUser.id}::uuid,true FROM academic_terms t WHERE t.id=${v.term_id}::uuid RETURNING id`.execute(db)).rows[0]!;
        await sql`INSERT INTO schedule_periods(version_id,id,weekday,period_number,starts_at,ends_at,subject_id,teacher_user_id,title,slot_type,room) SELECT ${frozen.id}::uuid,s.id,s.weekday,s.period_number,s.starts_at,s.ends_at,s.subject_id,s.teacher_user_id,COALESCE(subject.name,NULLIF(s.title,''),'Period'),s.slot_type,s.room FROM timetable_slots s LEFT JOIN subjects subject ON subject.id=s.subject_id WHERE s.class_section_id=${v.class_section_id}::uuid AND s.term_id=${v.term_id}::uuid`.execute(db);
        await sql`UPDATE schedule_versions SET state='published',published_at=now() WHERE id=${frozen.id}::uuid`.execute(db);
      }
      await sql`UPDATE schedule_versions SET state='published',published_at=now(),revision=revision+1 WHERE id=${id}::uuid`.execute(db);
      // Validate actual dates, including other versions and existing daily plans.
      const conflict=(await sql<{date:string;period_number:number;type:string}>`
        WITH days AS (SELECT d::date AS date FROM generate_series(${v.starts_on}::date,${v.ends_on}::date,'1 day') d),
        periods AS MATERIALIZED (SELECT d.date,p.* FROM days d CROSS JOIN LATERAL effective_school_schedule(${v.school_id}::uuid,d.date) p WHERE NOT p.cancelled)
        SELECT a.date::text,a.period_number,CASE WHEN a.class_section_id=b.class_section_id THEN 'class' WHEN a.teacher_user_id=b.teacher_user_id THEN 'teacher' ELSE 'room' END AS type
        FROM periods a JOIN periods b ON a.date=b.date AND a.id<>b.id AND a.starts_at<b.ends_at AND b.starts_at<a.ends_at
        WHERE a.class_section_id=${v.class_section_id}::uuid AND (a.class_section_id=b.class_section_id OR (a.teacher_user_id IS NOT NULL AND a.teacher_user_id=b.teacher_user_id) OR (a.slot_type<>'break' AND b.slot_type<>'break' AND trim(a.room)<>'' AND lower(trim(a.room))=lower(trim(b.room)))) LIMIT 1`.execute(db)).rows[0];
      if(conflict)throw new ConflictException(`Resolve the ${conflict.type} clash on ${conflict.date}, period ${conflict.period_number}, before publishing.`);
      await this.audit(db,req,v.school_id,id,'published',{starts_on:v.starts_on,ends_on:v.ends_on,revision:v.revision+1});
      await this.events.enqueueTimetableUpdate(db,{schoolId:v.school_id,classSectionId:v.class_section_id,slotId:id,requestId:req.requestId,action:'updated'});
      await sql`INSERT INTO notifications(recipient_id,kind,title,body,link,metadata,dedupe_key)
        SELECT DISTINCT m.user_id,'general','Timetable updated',${`A new timetable applies from ${v.starts_on} to ${v.ends_on}.`},CASE m.role WHEN 'guardian' THEN '/parent/timetable' WHEN 'student' THEN '/student/timetable' WHEN 'admin' THEN '/principal/timetable' ELSE '/teacher/timetable' END,${JSON.stringify({school_id:v.school_id,class_section_id:v.class_section_id,schedule_id:id})}::jsonb,${`schedule:${id}:`}||m.user_id
        FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active
        WHERE m.school_id=${v.school_id}::uuid AND m.is_active AND (m.role='admin' OR (m.role='staff' AND EXISTS(SELECT 1 FROM schedule_periods p WHERE p.version_id=${id}::uuid AND p.teacher_user_id=m.user_id)) OR EXISTS(SELECT 1 FROM enrollments e JOIN students s ON s.id=e.student_id LEFT JOIN guardian_relationships g ON g.student_id=s.id AND g.school_id=m.school_id LEFT JOIN parents parent ON parent.id=g.guardian_id WHERE e.class_section_id=${v.class_section_id}::uuid AND e.term_id=${v.term_id}::uuid AND e.is_active AND ((m.role='student' AND s.user_id=m.user_id) OR (m.role='guardian' AND parent.user_id=m.user_id))))
        ON CONFLICT(recipient_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`.execute(db);
      return {id,revision:v.revision+1};
    });
  }
  prepareYear(req:AuthenticatedRequest,body:unknown) {
    const input=year.parse(body);
    return this.command(req,input,{kind:'schedule.year',...input},async db=>{
      const today=(await dayContext(db,input.school_id,input.terms[0]!.starts_on)).today;
      const terms=[...input.terms].sort((a,b)=>a.starts_on.localeCompare(b.starts_on));
      if(terms.some((t,i)=>t.starts_on<=today || t.ends_on<t.starts_on || Date.parse(t.ends_on)-Date.parse(t.starts_on)>370*86400000 || (i>0&&terms[i-1]!.ends_on>=t.starts_on)))throw new BadRequestException('Use future, non-overlapping term dates, each no longer than 371 days.');
      if(new Set(terms.map(t=>t.name)).size!==terms.length)throw new BadRequestException('Term names must be distinct.');
      if((await db.selectFrom('academic_terms').select('id').where('school_id','=',input.school_id).where('academic_year','=',input.academic_year).execute()).length)throw new ConflictException('This academic year already exists. Select it in settings.');
      const existing=(await sql`SELECT 1 FROM academic_terms WHERE school_id=${input.school_id}::uuid AND starts_on<=${terms.at(-1)!.ends_on}::date AND ends_on>=${terms[0]!.starts_on}::date`.execute(db)).rows;
      if(existing.length)throw new ConflictException('These dates overlap an existing academic year.');
      const ids:string[]=[];
      for(const t of terms) {
        const row=await db.insertInto('academic_terms').values({school_id:input.school_id,academic_year:input.academic_year,name:t.name,starts_on:t.starts_on,ends_on:t.ends_on,is_active:false,attendance_threshold:'85.00'}).returning('id').executeTakeFirstOrThrow(); ids.push(row.id);
      }
      if(input.source_year) {
        const source=await db.selectFrom('class_sections').selectAll().where('school_id','=',input.school_id).where('academic_year','=',input.source_year).execute();
        if(!source.length)throw new BadRequestException('The source year has no classes to reuse.');
        const sourceTerms=await db.selectFrom('academic_terms').select(['id','ends_on']).where('school_id','=',input.school_id).where('academic_year','=',input.source_year).orderBy('starts_on').execute();
        for(const c of source) {
          const copied=await db.insertInto('class_sections').values({school_id:input.school_id,academic_year:input.academic_year,grade:c.grade,section:c.section,board:c.board,room_number:c.room_number}).returning('id').executeTakeFirstOrThrow();
          for(let i=0;i<terms.length;i++) {
            const old=sourceTerms[i]??sourceTerms.at(-1);
            if(!old)continue;
            const t=terms[i]!;
            const draft=(await sql<{id:string}>`INSERT INTO schedule_versions(school_id,term_id,class_section_id,starts_on,ends_on,created_by) VALUES(${input.school_id}::uuid,${ids[i]}::uuid,${copied.id}::uuid,${t.starts_on}::date,${t.ends_on}::date,${req.authUser.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
            await this.reusePattern(db,draft.id,input.school_id,c.id,old.id,String(old.ends_on));
          }
        }
      }
      await this.audit(db,req,input.school_id,ids[0]!,'year_prepared',{academic_year:input.academic_year,term_ids:ids,source_year:input.source_year??null});
      return {term_id:ids[0]!,term_ids:ids};
    });
  }
}
