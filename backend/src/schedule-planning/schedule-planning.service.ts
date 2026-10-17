import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { AuthenticatedRequest, AuthUser } from '../common/request.js';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import { SchoolEventService } from '../school/school-event.service.js';
import { SchoolService } from '../school/school.service.js';
import { authorize, activeTeachers, dayContext } from '../day-plans/repository.js';
import { lockSchedule } from '../day-plans/schedule.js';
import type { PlanDb } from '../day-plans/contracts.js';
import { uuid } from '../day-plans/contracts.js';
import { action, start, save, year, localConflicts, type Version, type Period } from './contracts.js';
import { TEMPORAL_CONTEXT_PORT, type TemporalContextPort } from '../campus-model-core/temporal-context.port.js';
import {
  STAFF_COVERAGE_RECONCILIATION_PORT,
  type StaffCoverageReconciliationPort,
} from '../staff-operations/staff-coverage-reconciliation.service.js';

interface PublishedScheduleProjectionRow extends Period {
  school_id:string; timezone:string; published_at:Date|string; class_section_id:string;
  class_label:string; subject_name:string|null; subject_code:string|null;
  space_id:string|null; space_name:string|null; space_revision:number|null;
}

@Injectable()
export class SchedulePlanningService {
  constructor(
    private readonly db:DatabaseService,
    private readonly events:SchoolEventService,
    private readonly school:SchoolService,
    @Inject(STAFF_COVERAGE_RECONCILIATION_PORT) private readonly coverage:StaffCoverageReconciliationPort,
    @Optional() @Inject(TEMPORAL_CONTEXT_PORT) private readonly temporal?:TemporalContextPort,
  ) {}

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

  private async command<T>(req:AuthenticatedRequest,input:{school_id:string;idempotency_key:string},identity:unknown,run:(db:Transaction<Database>)=>Promise<T>) {
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
  private async projectPublishedSchedule(db:Transaction<Database>,req:AuthenticatedRequest,id:string,revision:number) {
    if(!this.temporal)return;
    const rows=(await sql<PublishedScheduleProjectionRow>`
      SELECT version.school_id,school.timezone,version.published_at,version.class_section_id,
        concat('Class ',section.grade,section.section) AS class_label,
        period.*,subject.name AS subject_name,subject.code AS subject_code,
        space.id AS space_id,space.name AS space_name,space.revision AS space_revision
      FROM schedule_versions version
      JOIN schools school ON school.id=version.school_id
      JOIN class_sections section ON section.id=version.class_section_id
      JOIN schedule_periods period ON period.version_id=version.id
      LEFT JOIN subjects subject ON subject.id=period.subject_id
      LEFT JOIN campus_spaces space ON space.id=period.space_id
      WHERE version.id=${id}::uuid
      ORDER BY period.weekday,period.period_number
    `.execute(db)).rows;
    const first=rows[0];
    if(!first)throw new ConflictException('The published timetable has no periods to project.');
    const version=(await sql<{starts_on:string;ends_on:string}>`SELECT starts_on::text,ends_on::text FROM schedule_versions WHERE id=${id}::uuid`.execute(db)).rows[0]!;
    await this.temporal.recordPublishedSchedule(db,{
      school_id:first.school_id,
      actor_user_id:req.authUser.id,
      schedule_version_id:id,
      schedule_revision:revision,
      starts_on:version.starts_on,
      ends_on:version.ends_on,
      timezone:first.timezone,
      published_at:new Date(first.published_at).toISOString(),
      class_section:{kind:'class',domain:'academic_structure',domain_id:first.class_section_id,label:first.class_label,lifecycle_state:'active',source_revision:1,metadata:{}},
      periods:rows.map(row=>({
        period_id:row.id,weekday:row.weekday,period_number:row.period_number,
        starts_at:row.starts_at,ends_at:row.ends_at,title:row.title,slot_type:row.slot_type,
        teacher_user_id:row.teacher_user_id,
        subject:row.subject_id?{kind:'subject',domain:'academic_structure',domain_id:row.subject_id,label:row.subject_name??row.subject_code??row.title,lifecycle_state:'active' as const,source_revision:1,metadata:{code:row.subject_code}}:null,
        space:row.space_id?{kind:'space',domain:'campus_topology',domain_id:row.space_id,label:row.space_name??row.room,lifecycle_state:'active' as const,source_revision:row.space_revision??1,metadata:{}}:null,
        room_snapshot:row.room,
      })),
      correlation_id:req.requestId,
      causation_event_id:null,
    });
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
      const publishedRevision=v.revision+1;
      const coverageReconciliationInput={
        school_id:v.school_id,from:v.starts_on,to:v.ends_on,
        class_section_id:v.class_section_id,actor_user_id:req.authUser.id,
        correlation_id:req.requestId,
        cause:{kind:'schedule_published',source_domain:'timetable',source_record_id:id,source_revision:publishedRevision},
      };
      // Retained pre-Core acceptances must be projected while their old source
      // is still the effective schedule. Publishing below can make that exact
      // source non-current, after which normal reconciliation cancels it.
      const coveragePreparation=await this.coverage.prepareEffectiveCoverageProjection(
        db,
        coverageReconciliationInput,
      );
      // Freeze the original baseline, including its original slot identities.
      let frozenBaselineId:string|null=null;
      if(!(await sql`SELECT 1 FROM schedule_versions WHERE class_section_id=${v.class_section_id}::uuid AND term_id=${v.term_id}::uuid AND baseline`.execute(db)).rows.length) {
        const frozen=(await sql<{id:string}>`INSERT INTO schedule_versions(school_id,term_id,class_section_id,starts_on,ends_on,created_by,baseline) SELECT ${v.school_id}::uuid,t.id,${v.class_section_id}::uuid,t.starts_on,t.ends_on,${req.authUser.id}::uuid,true FROM academic_terms t WHERE t.id=${v.term_id}::uuid RETURNING id`.execute(db)).rows[0]!;
        const copied=await sql`INSERT INTO schedule_periods(version_id,id,weekday,period_number,starts_at,ends_at,subject_id,teacher_user_id,title,slot_type,room) SELECT ${frozen.id}::uuid,s.id,s.weekday,s.period_number,s.starts_at,s.ends_at,s.subject_id,s.teacher_user_id,COALESCE(subject.name,NULLIF(s.title,''),'Period'),s.slot_type,s.room FROM timetable_slots s LEFT JOIN subjects subject ON subject.id=s.subject_id WHERE s.class_section_id=${v.class_section_id}::uuid AND s.term_id=${v.term_id}::uuid`.execute(db);
        if(Number(copied.numAffectedRows ?? 0)>0)frozenBaselineId=frozen.id;
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
      // Project the frozen term baseline before the dated change. Otherwise the
      // Model Core has no expected plan outside this new version's date range.
      if(frozenBaselineId)await this.projectPublishedSchedule(db,req,frozenBaselineId,1);
      await this.projectPublishedSchedule(db,req,id,publishedRevision);
      const coverageReceipt=await this.coverage.reconcileEffectiveCoverage(
        db,
        coverageReconciliationInput,
      );
      await this.audit(db,req,v.school_id,id,'published',{
        starts_on:v.starts_on,ends_on:v.ends_on,revision:v.revision+1,
        coverage_projection_preparation:coveragePreparation,
        coverage_reconciliation:coverageReceipt,
      });
      await this.events.enqueueTimetableUpdate(db,{schoolId:v.school_id,classSectionId:v.class_section_id,slotId:id,requestId:req.requestId,action:'updated'});
      await sql`
        WITH recipients AS (
          SELECT membership.user_id,'principal'::text AS portal,NULL::uuid AS student_id,
            ${`/principal/timetable/day?school=${v.school_id}&date=${v.starts_on}&class=${v.class_section_id}&schedule_id=${id}&schedule_revision=${publishedRevision}`}::text AS link
          FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
          WHERE membership.school_id=${v.school_id}::uuid AND membership.role='admin' AND membership.is_active
          UNION ALL
          SELECT membership.user_id,'teacher',NULL::uuid,${`/teacher/timetable?date=${v.starts_on}&schedule_id=${id}&schedule_revision=${publishedRevision}`}::text
          FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
          WHERE membership.school_id=${v.school_id}::uuid AND membership.role='staff' AND membership.is_active
            AND EXISTS(SELECT 1 FROM schedule_periods period WHERE period.version_id=${id}::uuid AND period.teacher_user_id=membership.user_id)
          UNION ALL
          SELECT student.user_id,'student',student.id,${`/student/timetable?date=${v.starts_on}`}::text
          FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id
          JOIN users account ON account.id=student.user_id AND account.is_active
          JOIN school_memberships membership ON membership.user_id=student.user_id
            AND membership.school_id=${v.school_id}::uuid AND membership.role='student' AND membership.is_active
          WHERE enrollment.class_section_id=${v.class_section_id}::uuid AND enrollment.term_id=${v.term_id}::uuid AND enrollment.is_active
          UNION ALL
          SELECT parent.user_id,'parent',enrollment.student_id,
            '/parent/timetable?date='||${v.starts_on}::text||'&student_id='||enrollment.student_id::text||
              '&schedule_id='||${id}::text||'&schedule_revision='||${publishedRevision}::text
          FROM enrollments enrollment
          JOIN guardian_relationships relationship ON relationship.student_id=enrollment.student_id AND relationship.school_id=${v.school_id}::uuid
          JOIN parents parent ON parent.id=relationship.guardian_id
          JOIN users account ON account.id=parent.user_id AND account.is_active
          JOIN school_memberships membership ON membership.user_id=parent.user_id
            AND membership.school_id=${v.school_id}::uuid AND membership.role='guardian' AND membership.is_active
          WHERE enrollment.class_section_id=${v.class_section_id}::uuid AND enrollment.term_id=${v.term_id}::uuid AND enrollment.is_active
        )
        INSERT INTO notifications(
          recipient_id,kind,title,body,link,metadata,dedupe_key,
          attention_eligible,attention_school_id,attention_student_id,attention_class_section_id,
          attention_portal,attention_module,attention_source_kind,attention_source_id,
          attention_source_revision,attention_topic_key
        )
        SELECT DISTINCT recipient.user_id,'general','Timetable updated',
          ${`A new timetable applies from ${v.starts_on} to ${v.ends_on}.`},
          recipient.link,
          ${JSON.stringify({school_id:v.school_id,class_section_id:v.class_section_id,schedule_id:id,starts_on:v.starts_on,ends_on:v.ends_on})}::jsonb,
          ${`schedule:${id}:`}||recipient.user_id||':'||recipient.portal||':'||COALESCE(recipient.student_id::text,'school'),
          recipient.portal<>'student',
          CASE WHEN recipient.portal<>'student' THEN ${v.school_id}::uuid END,
          CASE WHEN recipient.portal<>'student' THEN recipient.student_id END,
          CASE WHEN recipient.portal<>'student' THEN ${v.class_section_id}::uuid END,
          CASE WHEN recipient.portal<>'student' THEN recipient.portal END,
          CASE WHEN recipient.portal<>'student' THEN 'timetable' END,
          CASE WHEN recipient.portal<>'student' THEN 'timetable_publication' END,
          CASE WHEN recipient.portal<>'student' THEN ${id}::uuid END,
          CASE WHEN recipient.portal<>'student' THEN ${publishedRevision}::integer END,
          CASE WHEN recipient.portal<>'student' THEN ${`timetable:${v.class_section_id}:`}||recipient.portal||':'||COALESCE(recipient.student_id::text,'school') END
        FROM recipients recipient
        ON CONFLICT(recipient_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      `.execute(db);
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
