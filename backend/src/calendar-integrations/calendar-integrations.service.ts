import {BadRequestException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {createHash,randomBytes} from 'node:crypto';
import {sql,type Kysely,type Transaction} from 'kysely';
import {z} from 'zod';
import type {AuthenticatedRequest,AuthUser} from '../common/request.js';
import {config} from '../config.js';
import {DatabaseService} from '../database/database.service.js';
import type {Database} from '../database/types.js';
import {AssessmentsService} from '../assessments/assessments.service.js';
import {CampusEventsService} from '../campus-events/campus-events.service.js';
import {SchoolService} from '../school/school.service.js';
import {serializeCalendar,type ICalendarEvent} from './ical.js';

const portal=z.enum(['principal','teacher','parent','student']);
const scopeInput=z.object({portal,student_id:z.string().uuid().optional()}).strict();
const rangeInput=z.object({portal,student_id:z.string().uuid().optional(),from:z.iso.date(),to:z.iso.date()}).strict();
type Portal=z.infer<typeof portal>;
interface Scope {ownerId:string;schoolId:string;schoolName:string;timezone:string;portal:Portal;studentId:string|null;calendarName:string}

function hash(value:string){return createHash('sha256').update(value).digest('hex');}
function plusDays(value:string,amount:number){const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);}
function durationDays(from:string,to:string){return Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000)+1;}

@Injectable()
export class CalendarIntegrationsService {
  constructor(private readonly db:DatabaseService,private readonly school:SchoolService,
    private readonly assessments:AssessmentsService,private readonly campusEvents:CampusEventsService){}

  private async scope(user:AuthUser,input:{portal:Portal;student_id?:string|undefined}):Promise<Scope>{
    const expected={principal:'admin',teacher:'staff',parent:'guardian',student:'student'}[input.portal] as 'admin'|'staff'|'guardian'|'student';
    let membershipQuery=this.db.selectFrom('school_memberships as membership').innerJoin('schools as school','school.id','membership.school_id')
      .select(['membership.school_id','school.name as school_name','school.timezone']).where('membership.user_id','=',user.id)
      .where('membership.role','=',expected).where('membership.is_active','=',true);
    if(user.active_school_id)membershipQuery=membershipQuery.where('membership.school_id','=',user.active_school_id);
    const memberships=await membershipQuery.execute();
    if(memberships.length!==1)throw new ForbiddenException(memberships.length?'Select one active school before connecting a calendar.':'This portal is not available to the signed-in account.');
    const membership=memberships[0]!;let studentId:string|null=null;let suffix='';
    if(input.portal==='parent'||input.portal==='student'){
      const student=await this.school.studentForUser(user,input.student_id);
      if(student.school_id!==membership.school_id)throw new NotFoundException('Student not found in the active school.');
      await this.school.requireRole(user,student,input.portal==='parent'?'guardian':'student');studentId=student.id;
      const person=await this.db.selectFrom('school_people').select(['first_name','last_name']).where('id','=',student.person_id).executeTakeFirst();
      suffix=person?` · ${`${person.first_name} ${person.last_name}`.trim()}`:'';
    }
    return {ownerId:user.id,schoolId:membership.school_id,schoolName:membership.school_name,timezone:membership.timezone,
      portal:input.portal,studentId,calendarName:`${membership.school_name}${suffix}`};
  }

  async status(request:AuthenticatedRequest,query:Record<string,string|undefined>){
    const input=scopeInput.parse(query);const scope=await this.scope(request.authUser,input);
    const item=(await sql<{id:string;token_hint:string;created_at:Date;last_fetched_at:Date|null;revision:number}>`
      SELECT id,token_hint,created_at,last_fetched_at,revision FROM calendar_subscriptions
      WHERE owner_id=${scope.ownerId}::uuid AND school_id=${scope.schoolId}::uuid AND portal=${scope.portal}
        AND student_id IS NOT DISTINCT FROM ${scope.studentId}::uuid AND state='active' LIMIT 1`.execute(this.db)).rows[0];
    return {scope:{portal:scope.portal,student_id:scope.studentId,calendar_name:scope.calendarName},subscription:item??null};
  }

  async createSubscription(request:AuthenticatedRequest){
    const input=scopeInput.parse(request.body);const scope=await this.scope(request.authUser,input);
    const base=config().PUBLIC_URL?.replace(/\/$/,'');
    if(!base)throw new BadRequestException('Calendar subscriptions require the public application URL to be configured.');
    const raw=randomBytes(32).toString('base64url');const tokenHash=hash(raw);const hint=raw.slice(-6);
    const row=await this.db.transaction().execute(async tx=>{
      await sql`UPDATE calendar_subscriptions SET state='revoked',revoked_at=now(),revision=revision+1
        WHERE owner_id=${scope.ownerId}::uuid AND school_id=${scope.schoolId}::uuid AND portal=${scope.portal}
          AND student_id IS NOT DISTINCT FROM ${scope.studentId}::uuid AND state='active'`.execute(tx);
      const created=(await sql<{id:string;created_at:Date;revision:number}>`INSERT INTO calendar_subscriptions(owner_id,school_id,portal,student_id,token_hash,token_hint)
        VALUES(${scope.ownerId}::uuid,${scope.schoolId}::uuid,${scope.portal},${scope.studentId}::uuid,${tokenHash},${hint})
        RETURNING id,created_at,revision`.execute(tx)).rows[0]!;
      await this.audit(tx,request,scope,'calendar.subscription.created',created.id,{portal:scope.portal,student_id:scope.studentId});return created;
    });
    return {...row,token_hint:hint,feed_url:`${base}/api/v1/calendar-connections/subscriptions/${raw}/feed.ics`,calendar_name:scope.calendarName};
  }

  async revoke(request:AuthenticatedRequest,id:string){
    const row=(await sql<{id:string;school_id:string;portal:Portal;student_id:string|null}>`UPDATE calendar_subscriptions SET state='revoked',revoked_at=now(),revision=revision+1
      WHERE id=${z.string().uuid().parse(id)}::uuid AND owner_id=${request.authUser.id}::uuid AND state='active'
      RETURNING id,school_id,portal,student_id`.execute(this.db)).rows[0];
    if(!row)throw new NotFoundException('This calendar subscription is not active.');
    await this.audit(this.db,request,{ownerId:request.authUser.id,schoolId:row.school_id,portal:row.portal,studentId:row.student_id} as Scope,
      'calendar.subscription.revoked',row.id,{portal:row.portal,student_id:row.student_id});
    return {id:row.id,active:false};
  }

  async export(request:AuthenticatedRequest,query:Record<string,string|undefined>){
    const input=rangeInput.parse(query);if(input.from>input.to||durationDays(input.from,input.to)>370)throw new BadRequestException('Choose a calendar range of up to 370 days.');
    const scope=await this.scope(request.authUser,input);const body=await this.calendar(scope,request.authUser,input.from,input.to);
    await this.audit(this.db,request,scope,'calendar.exported',null,{portal:scope.portal,student_id:scope.studentId,from:input.from,to:input.to});
    return {body,filename:`edura-${input.from}-${input.to}.ics`};
  }

  async feed(rawToken:string){
    if(!/^[A-Za-z0-9_-]{43}$/.test(rawToken))throw new NotFoundException('Calendar subscription not found.');
    const subscription=(await sql<{id:string;owner_id:string;school_id:string;portal:Portal;student_id:string|null;created_at:Date}>`
      SELECT id,owner_id,school_id,portal,student_id,created_at FROM calendar_subscriptions WHERE token_hash=${hash(rawToken)} AND state='active' LIMIT 1`.execute(this.db)).rows[0];
    if(!subscription)throw new NotFoundException('Calendar subscription not found.');
    const user=(await this.db.selectFrom('users').select(['id','username','email','first_name','last_name','avatar_url','role','is_active','email_verified_at'])
      .where('id','=',subscription.owner_id).where('is_active','=',true).executeTakeFirst()) as AuthUser|undefined;
    if(!user)throw new NotFoundException('Calendar subscription not found.');
    let scope:Scope;
    try{
      scope=await this.scope({...user,active_school_id:subscription.school_id},{portal:subscription.portal,...(subscription.student_id?{student_id:subscription.student_id}:{})});
    }catch(cause){
      if(cause instanceof ForbiddenException||cause instanceof NotFoundException)throw new NotFoundException('Calendar subscription not found.');
      throw cause;
    }
    const today=(await sql<{today:string}>`SELECT (now() AT TIME ZONE ${scope.timezone})::date::text AS today`.execute(this.db)).rows[0]!.today;
    const body=await this.calendar(scope,user,plusDays(today,-30),plusDays(today,370),subscription.created_at);
    await sql`UPDATE calendar_subscriptions SET last_fetched_at=now() WHERE id=${subscription.id}::uuid
      AND (last_fetched_at IS NULL OR last_fetched_at<now()-interval '15 minutes')`.execute(this.db);
    return body;
  }

  private async calendar(scope:Scope,user:AuthUser,from:string,to:string,generatedAt?:Date){
    const [holidays,timetable,events,assessments]=await Promise.all([
      this.holidays(scope,from,to),this.timetable(scope,from,to),this.events(scope,user,from,to),this.assessmentEvents(scope,user,from,to),
    ]);
    return serializeCalendar({name:scope.calendarName,timezone:scope.timezone,events:[...holidays,...timetable,...events,...assessments],
      ...(generatedAt?{generatedAt}:{}),
    });
  }

  private async holidays(scope:Scope,from:string,to:string):Promise<ICalendarEvent[]>{
    const rows=(await sql<{id:string;date:string;label:string;reason:string;revision:number}>`SELECT id,date::text,label,reason,revision FROM school_calendar_days
      WHERE school_id=${scope.schoolId}::uuid AND date BETWEEN ${from}::date AND ${to}::date AND NOT is_instructional ORDER BY date`.execute(this.db)).rows;
    return rows.map(row=>({uid:`holiday-${row.id}@edura`,title:row.label||'School closed',description:row.reason||'School calendar',start:row.date,end:plusDays(row.date,1),allDay:true,sequence:row.revision}));
  }

  private async timetable(scope:Scope,from:string,to:string):Promise<ICalendarEvent[]>{
    if(scope.portal==='principal')return [];
    const rows=(await sql<{id:string;date:string;starts_at:Date;ends_at:Date;title:string;room:string;class_name:string;period_number:number;plan_version:number|null}>`
      SELECT schedule.id,day::date::text AS date,
        ((day::date+schedule.starts_at) AT TIME ZONE school.timezone) AS starts_at,
        ((day::date+schedule.ends_at) AT TIME ZONE school.timezone) AS ends_at,
        COALESCE(subject.name,NULLIF(schedule.title,''),'School period') AS title,schedule.room,
        'Class '||section.grade||section.section AS class_name,schedule.period_number,schedule.plan_version
      FROM generate_series(${from}::date,${to}::date,'1 day') day
      JOIN schools school ON school.id=${scope.schoolId}::uuid
      CROSS JOIN LATERAL effective_school_schedule(${scope.schoolId}::uuid,day::date) schedule
      JOIN class_sections section ON section.id=schedule.class_section_id
      LEFT JOIN subjects subject ON subject.id=schedule.subject_id
      WHERE NOT schedule.cancelled AND schedule.slot_type<>'break'
        AND ((${scope.portal}='teacher' AND schedule.teacher_user_id=${scope.ownerId}::uuid)
          OR (${scope.portal} IN ('parent','student') AND EXISTS(SELECT 1 FROM enrollments enrollment JOIN academic_terms term ON term.id=enrollment.term_id
            WHERE enrollment.student_id=${scope.studentId}::uuid AND enrollment.class_section_id=schedule.class_section_id
              AND enrollment.term_id=schedule.term_id AND enrollment.is_active AND enrollment.enrolled_on<=day::date AND day::date BETWEEN term.starts_on AND term.ends_on)))
      ORDER BY day,schedule.starts_at,schedule.period_number`.execute(this.db)).rows;
    return rows.map(row=>({uid:`period-${row.id}-${row.date}@edura`,title:scope.portal==='teacher'?`${row.title} · ${row.class_name}`:row.title,
      description:`Period ${row.period_number}. Open Edura for current school details.`,location:row.room,start:row.starts_at,end:row.ends_at,sequence:row.plan_version??0}));
  }

  private async events(scope:Scope,user:AuthUser,from:string,to:string):Promise<ICalendarEvent[]>{
    const statuses=['published','completed','cancelled'] as const;
    const lists=await Promise.all(statuses.map(async status=>{
      const items=[];let cursor:string|undefined;
      do{
        const page=await this.campusEvents.list(user,{school_id:scope.schoolId,from:`${from}T00:00:00.000Z`,to:`${plusDays(to,1)}T00:00:00.000Z`,
          status,student_id:scope.studentId??undefined,limit:'100',cursor});
        items.push(...page.items);cursor=page.next_cursor??undefined;
      }while(cursor);
      return items;
    }));
    const unique=new Map(lists.flat().map(item=>[item.id,item]));
    return [...unique.values()].map(item=>({uid:`event-${item.id}@edura`,title:item.status==='cancelled'?`Cancelled · ${item.title}`:item.title,
      description:'Open Edura for current event details.',location:item.venue,start:item.starts_at,end:item.ends_at,sequence:item.revision,cancelled:item.status==='cancelled'}));
  }

  private async assessmentEvents(scope:Scope,user:AuthUser,from:string,to:string):Promise<ICalendarEvent[]>{
    const items:Array<{id:string;title:string;scheduled_at:string;venue:string;subject_name:string;class_name:string;duration_minutes?:number|null}>=[];
    for(let cursor=from;cursor<=to;){const end=[plusDays(cursor,92),to].sort()[0]!;const page=await this.assessments.calendar(user,scope.schoolId,cursor,end,scope.studentId??undefined);items.push(...page.items);cursor=plusDays(end,1);}
    return items.map(item=>{const start=new Date(item.scheduled_at);const end=new Date(start.getTime()+(item.duration_minutes??60)*60_000);return {
      uid:`assessment-${item.id}@edura`,title:`${item.subject_name} · ${item.title}`,description:`${item.class_name}. Open Edura for assessment details.`,
      location:item.venue,start,end,
    };});
  }

  private audit(db:Kysely<Database>|Transaction<Database>,request:AuthenticatedRequest,scope:Scope,action:string,targetId:string|null,metadata:unknown){
    return sql`INSERT INTO audit_events(action,actor_id,school_id,target_type,target_id,request_id,metadata)
      VALUES(${action},${scope.ownerId}::uuid,${scope.schoolId}::uuid,'calendar_subscription',${targetId}::uuid,${request.requestId}::uuid,${JSON.stringify(metadata)}::jsonb)`.execute(db);
  }
}
