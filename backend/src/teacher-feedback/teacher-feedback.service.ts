import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { config } from '../config.js';
import type { AuthUser } from '../common/request.js';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import { campaignInput, DEFAULT_PARAMETERS, responseInput, feedbackReleasePolicy, summarizeRatings, validRatingKeys, type Ratings } from './feedback-rules.js';
type Db = DatabaseService | Transaction<Database>;
interface Campaign { id:string; school_id:string; teacher_user_id:string; class_section_id:string; title:string; audience:'students'|'parents'; parameters:string[]; closes_at:Date; closed_at:Date|null; teacher_name:string; class_name:string; is_closed:boolean; response_count:number; submitted?:boolean }
const projection = sql`c.id,c.school_id,c.teacher_user_id,c.class_section_id,c.title,c.audience,c.parameters,c.closes_at,c.closed_at,
  u.first_name||' '||u.last_name AS teacher_name,cs.grade||cs.section AS class_name,
  (c.closed_at IS NOT NULL OR c.closes_at<=now()) AS is_closed`;
@Injectable()
export class TeacherFeedbackService {
  constructor(private readonly db: DatabaseService) {}
  private async member(db:Db,user:AuthUser,school:string,admin=false) {
    if (!z.uuid().safeParse(school).success) throw new BadRequestException('Invalid institution.');
    if (!user.is_active || (user.active_school_id && user.active_school_id!==school)) throw new ForbiddenException('Select the correct institution.');
    const member = await db.selectFrom('school_memberships as m').innerJoin('users as u','u.id','m.user_id')
      .select('m.role').where('m.school_id','=',school).where('m.user_id','=',user.id).where('m.is_active','=',true).where('u.is_active','=',true).execute();
    if (!member.length || (admin && !member.some(m=>m.role==='admin'))) throw new ForbiddenException('Principal administrator access is required.');
  }
  private async campaign(db:Db,school:string,id:string,lock=false) {
    if (!z.uuid().safeParse(id).success) throw new BadRequestException('Invalid feedback request.');
    const row=(await sql<Campaign>`SELECT ${projection} FROM teacher_feedback_campaigns c
      JOIN users u ON u.id=c.teacher_user_id JOIN class_sections cs ON cs.id=c.class_section_id
      WHERE c.school_id=${school}::uuid AND c.id=${id}::uuid ${lock?sql`FOR UPDATE OF c`:sql``}`.execute(db)).rows[0];
    if(!row) throw new NotFoundException('Feedback request not found.'); return row;
  }
  private eligible(user:AuthUser) {
    // Re-evaluate current enrollment, term and guardian relationship on every read and submission.
    return sql`c.teacher_user_id<>${user.id}::uuid AND EXISTS (
      SELECT 1 FROM enrollments e JOIN students s ON s.id=e.student_id AND s.school_id=c.school_id
      JOIN academic_terms term ON term.id=e.term_id AND term.school_id=c.school_id
      JOIN schools school ON school.id=c.school_id
      WHERE e.class_section_id=c.class_section_id AND e.is_active
        AND (now() AT TIME ZONE school.timezone)::date BETWEEN GREATEST(e.enrolled_on,term.starts_on) AND term.ends_on
        AND ((c.audience='students' AND s.user_id=${user.id}::uuid) OR (c.audience='parents' AND EXISTS (
          SELECT 1 FROM guardian_relationships gr JOIN parents p ON p.id=gr.guardian_id
          WHERE gr.student_id=s.id AND p.user_id=${user.id}::uuid))))`;
  }
  private async audit(db:Db,user:AuthUser,school:string,id:string,action:string) {
    await sql`INSERT INTO teacher_feedback_audits(school_id,campaign_id,actor_id,action) VALUES(${school}::uuid,${id}::uuid,${user.id}::uuid,${action})`.execute(db);
  }
  async workspace(user:AuthUser,school:string) {
    await this.member(this.db,user,school,true);
    const teachers=(await sql<{id:string;name:string}>`SELECT DISTINCT u.id,u.first_name||' '||u.last_name AS name FROM users u
      JOIN school_memberships m ON m.user_id=u.id WHERE m.school_id=${school}::uuid AND m.is_active AND u.is_active AND m.role IN ('staff','admin') ORDER BY name`.execute(this.db)).rows;
    const classes=await this.db.selectFrom('class_sections').select(['id','grade','section','academic_year']).where('school_id','=',school).orderBy('grade').orderBy('section').execute();
    const campaigns=(await sql<Campaign>`SELECT ${projection},(SELECT count(*)::int FROM teacher_feedback_responses r WHERE r.campaign_id=c.id) AS response_count
      FROM teacher_feedback_campaigns c JOIN users u ON u.id=c.teacher_user_id JOIN class_sections cs ON cs.id=c.class_section_id
      WHERE c.school_id=${school}::uuid ORDER BY c.created_at DESC LIMIT 100`.execute(this.db)).rows;
    return {teachers,classes,campaigns,default_parameters:DEFAULT_PARAMETERS};
  }
  async create(user:AuthUser,school:string,body:unknown) {
    const parsed=campaignInput.safeParse(body); if(!parsed.success) throw new BadRequestException('Choose a teacher, class, audience, deadline and 1–10 distinct parameters.');
    const data=parsed.data,deadline=new Date(data.closes_at).getTime();
    if(deadline<=Date.now() || deadline>Date.now()+90*86400000) throw new BadRequestException('Choose a future deadline within 90 days.');
    return this.db.transaction().execute(async db=>{
      await this.member(db,user,school,true);
      const teacher=await db.selectFrom('school_memberships as m').innerJoin('users as u','u.id','m.user_id').select('u.id')
        .where('m.school_id','=',school).where('m.user_id','=',data.teacher_user_id).where('m.role','in',['staff','admin']).where('m.is_active','=',true).where('u.is_active','=',true).executeTakeFirst();
      const classroom=await db.selectFrom('class_sections').select('id').where('id','=',data.class_section_id).where('school_id','=',school).executeTakeFirst();
      if(!teacher||!classroom) throw new BadRequestException('Teacher and class must belong to this institution.');
      const row=(await sql<{id:string}>`INSERT INTO teacher_feedback_campaigns(school_id,teacher_user_id,class_section_id,title,audience,parameters,closes_at,created_by)
        VALUES(${school}::uuid,${data.teacher_user_id}::uuid,${data.class_section_id}::uuid,${data.title},${data.audience},${JSON.stringify(data.parameters)}::jsonb,${data.closes_at}::timestamptz,${user.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
      await this.audit(db,user,school,row.id,'created'); return {id:row.id};
    });
  }
  async close(user:AuthUser,school:string,id:string) {
    return this.db.transaction().execute(async db=>{
      await this.member(db,user,school,true);const campaign=await this.campaign(db,school,id,true);
      if(!campaign.is_closed){await sql`UPDATE teacher_feedback_campaigns SET closed_at=clock_timestamp() WHERE id=${id}::uuid AND school_id=${school}::uuid`.execute(db);await this.audit(db,user,school,id,'closed');}
      return {id,closed:true};
    });
  }
  async results(user:AuthUser,school:string,id:string) {
    return this.db.transaction().execute(async db=>{
    await this.member(db,user,school,true);const campaign=await this.campaign(db,school,id,true);
    const activity=(await sql<{date:string;count:number}>`SELECT
      to_char(r.submitted_at AT TIME ZONE s.timezone,'YYYY-MM-DD') AS date,count(*)::int AS count
      FROM teacher_feedback_responses r JOIN schools s ON s.id=r.school_id
      WHERE r.school_id=${school}::uuid AND r.campaign_id=${id}::uuid GROUP BY 1 ORDER BY 1`.execute(db)).rows;
    const count=activity.reduce((sum,day)=>sum+day.count,0);
    const schoolRecord=await db.selectFrom('schools').select('code').where('id','=',school).executeTakeFirstOrThrow();
    const policy=feedbackReleasePolicy(config().DEMO_MODE,user,schoolRecord.code);
    // Closed, immutable cohorts prevent successive dashboard reads from revealing an individual's vote.
    if((!campaign.is_closed&&!policy.demo_preview)||count<policy.minimum_responses) return {campaign,response_count:count,available:false,parameters:[],activity,history:[],...policy};
    const rows=(await sql<{ratings:Ratings}>`SELECT ratings FROM teacher_feedback_responses WHERE school_id=${school}::uuid AND campaign_id=${id}::uuid`.execute(db)).rows;
    const parameters=summarizeRatings(campaign.parameters,rows.map(r=>r.ratings),policy.minimum_responses);
    // Compare only the same teacher, class, audience and exact question set. Every
    // parameter must independently pass suppression; a hidden answer never feeds a trend.
    const history=campaign.is_closed&&parameters.every(p=>p.counts!==null)?await this.history(db,school,id,policy.minimum_responses):[];
    return {campaign,response_count:count,available:true,parameters,activity,history,...policy};
    });
  }
  private async history(db:Db,school:string,id:string,minimum:number) {
    return (await sql<{id:string;closed_at:string;response_count:number;rated_count:number;high_percent:number}>`
      WITH current_request AS (
        SELECT * FROM teacher_feedback_campaigns WHERE school_id=${school}::uuid AND id=${id}::uuid
      ), rounds AS (
        SELECT c.id,c.parameters,LEAST(c.closed_at,c.closes_at) AS ended
        FROM teacher_feedback_campaigns c CROSS JOIN current_request current
        WHERE c.school_id=${school}::uuid AND c.teacher_user_id=current.teacher_user_id
          AND c.class_section_id=current.class_section_id AND c.audience=current.audience
          AND c.parameters @> current.parameters AND current.parameters @> c.parameters
          AND (c.closed_at IS NOT NULL OR c.closes_at<=now())
          AND LEAST(c.closed_at,c.closes_at)<=LEAST(current.closed_at,current.closes_at)
        ORDER BY ended DESC,c.id DESC LIMIT 6
      ), counts AS (
        SELECT c.id,c.ended,jsonb_array_length(c.parameters) AS parameter_count,q.parameter,
          count(*)::int AS responses,
          count(*) FILTER(WHERE r.ratings->>q.parameter IN ('low','okay','high'))::int AS rated,
          count(*) FILTER(WHERE r.ratings->>q.parameter='high')::int AS high
        FROM rounds c JOIN teacher_feedback_responses r ON r.campaign_id=c.id AND r.school_id=${school}::uuid
        CROSS JOIN LATERAL jsonb_array_elements_text(c.parameters) AS q(parameter)
        GROUP BY c.id,c.ended,c.parameters,q.parameter
      ) SELECT id,to_char(ended AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at,max(responses)::int AS response_count,
        sum(rated)::int AS rated_count,round(100.0*sum(high)/sum(rated),1)::float8 AS high_percent
      FROM counts GROUP BY id,ended HAVING min(rated)>=${minimum} AND count(*)=max(parameter_count)
      ORDER BY ended,id`.execute(db)).rows;
  }
  async pending(user:AuthUser,school:string) {
    await this.member(this.db,user,school);
    const campaigns=(await sql<Campaign>`SELECT ${projection},EXISTS(SELECT 1 FROM teacher_feedback_responses r WHERE r.campaign_id=c.id AND r.respondent_user_id=${user.id}::uuid) AS submitted
      FROM teacher_feedback_campaigns c JOIN users u ON u.id=c.teacher_user_id JOIN class_sections cs ON cs.id=c.class_section_id
      WHERE c.school_id=${school}::uuid AND c.closed_at IS NULL AND c.closes_at>now() AND ${this.eligible(user)} ORDER BY c.closes_at,c.id`.execute(this.db)).rows;
    return {campaigns};
  }
  async submit(user:AuthUser,school:string,id:string,body:unknown) {
    const parsed=responseInput.safeParse(body);if(!parsed.success) throw new BadRequestException('Choose Low, Okay, High or Not sure for each parameter.');
    return this.db.transaction().execute(async db=>{
      await this.member(db,user,school);const campaign=await this.campaign(db,school,id,true);
      const eligible=(await sql<{id:string}>`SELECT c.id FROM teacher_feedback_campaigns c WHERE c.id=${id}::uuid AND c.school_id=${school}::uuid AND ${this.eligible(user)}`.execute(db)).rows[0];
      if(!eligible) throw new ForbiddenException('This feedback request is not assigned to you.');
      // clock_timestamp is checked after acquiring the lock, including requests waiting across a deadline.
      const open=(await sql<{open:boolean}>`SELECT closed_at IS NULL AND closes_at>clock_timestamp() AS open FROM teacher_feedback_campaigns WHERE id=${id}::uuid`.execute(db)).rows[0]!.open;
      if(!open) throw new ConflictException('This feedback request has closed.');
      if(!validRatingKeys(campaign.parameters,parsed.data.ratings)) throw new BadRequestException('Answer every parameter, using Not sure when needed.');
      const inserted=(await sql<{id:string}>`INSERT INTO teacher_feedback_responses(school_id,campaign_id,respondent_user_id,ratings)
        VALUES(${school}::uuid,${id}::uuid,${user.id}::uuid,${JSON.stringify(parsed.data.ratings)}::jsonb) ON CONFLICT(campaign_id,respondent_user_id) DO NOTHING RETURNING id`.execute(db)).rows[0];
      if(!inserted) throw new ConflictException('You already submitted feedback for this request.');
      await this.audit(db,user,school,id,'submitted');return {submitted:true};
    });
  }
}
