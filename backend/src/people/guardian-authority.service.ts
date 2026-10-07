import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import type { Database } from "../database/types.js";
import { DatabaseService } from "../database/database.service.js";
import { SchoolEventService } from "../school/school-event.service.js";

type Db = Kysely<Database> | Transaction<Database>;
const commandSchema = z.object({school_id:z.string().uuid(),expected_revision:z.number().int().positive(),
  enabled:z.boolean(),valid_from:z.iso.date().nullable(),valid_until:z.iso.date().nullable(),
  reason:z.string().trim().min(10).max(500),verified:z.literal(true),idempotency_key:z.string().uuid(),
}).strict().refine(v=>!v.enabled||Boolean(v.valid_from),"A grant needs a start date.")
  .refine(v=>!v.valid_until||!v.valid_from||v.valid_until>=v.valid_from,"End date must not precede the start date.")
  .refine(v=>v.enabled||(!v.valid_from&&!v.valid_until),"Revocation takes effect immediately; omit grant dates.");
type AuthorityRow = {id:string;student_id:string;guardian_id:string;student_name:string;guardian_name:string;
  revision:number;enabled:boolean;valid_from:string|null;valid_until:string|null;effective:boolean;source:string;today:string};

@Injectable()
export class GuardianAuthorityService {
  constructor(private readonly db:DatabaseService,private readonly events:SchoolEventService){}

  private async authorize(db:Db,user:AuthUser,schoolId:string,lock=false){
    const member=(await sql`SELECT m.id FROM school_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.user_id=${user.id}::uuid AND m.school_id=${schoolId}::uuid AND m.role='admin' AND m.is_active AND u.is_active
      ${lock?sql`FOR SHARE OF m,u`:sql``}`.execute(db)).rows[0];
    if(!member)throw new ForbiddenException("Only a current school administrator can manage guardian authority.");
  }

  private async row(db:Db,schoolId:string,id:string,lock=false){
    const row=(await sql<AuthorityRow>`SELECT g.id,g.student_id,g.guardian_id,g.authority_revision AS revision,
      g.can_authorize_leave AS enabled,g.leave_valid_from::text AS valid_from,g.leave_valid_until::text AS valid_until,
      g.authority_source AS source,concat_ws(' ',sp.first_name,sp.last_name) AS student_name,
      concat_ws(' ',gp.first_name,gp.last_name) AS guardian_name,(clock_timestamp() AT TIME ZONE sc.timezone)::date::text AS today,
      guardian_may_sign_leave(g,(clock_timestamp() AT TIME ZONE sc.timezone)::date) AS effective
      FROM guardian_relationships g JOIN students s ON s.id=g.student_id JOIN schools sc ON sc.id=g.school_id
      JOIN school_people sp ON sp.id=s.person_id
      JOIN guardian_school_profiles profile ON profile.school_id=g.school_id AND profile.guardian_id=g.guardian_id
      JOIN school_people gp ON gp.id=profile.person_id
      WHERE g.school_id=${schoolId}::uuid AND g.id=${id}::uuid ${lock?sql`FOR UPDATE OF g`:sql``}`.execute(db)).rows[0];
    if(!row)throw new NotFoundException("Guardian relationship not found in this school.");
    return row;
  }

  async detail(user:AuthUser,idValue:string,schoolValue:string){
    const id=z.string().uuid().parse(idValue),schoolId=z.string().uuid().parse(schoolValue);
    await this.authorize(this.db,user,schoolId);
    const current=await this.row(this.db,schoolId,id);
    const history=(await sql`SELECT c.id,c.previous,c.result,c.reason,c.recorded_at,
      concat_ws(' ',u.first_name,u.last_name) AS actor_name
      FROM guardian_leave_authority_commands c JOIN users u ON u.id=c.actor_id
      WHERE c.school_id=${schoolId}::uuid AND c.relationship_id=${id}::uuid
      ORDER BY c.recorded_at DESC,c.id DESC LIMIT 50`.execute(this.db)).rows;
    return {...current,history};
  }

  async change(req:AuthenticatedRequest,idValue:string,body:unknown){
    const id=z.string().uuid().parse(idValue),input=commandSchema.parse(body);
    return this.db.transaction().execute(async db=>{
      await this.authorize(db,req.authUser,input.school_id,true);
      // A command key cannot apply to two relationships, even concurrently.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`guardian-authority:${input.school_id}:${req.authUser.id}:${input.idempotency_key}`},0))`.execute(db);
      const previous=(await sql<{relationship_id:string;matches:boolean;result:unknown}>`SELECT relationship_id,input=${JSON.stringify(input)}::jsonb AS matches,result
        FROM guardian_leave_authority_commands WHERE school_id=${input.school_id}::uuid AND actor_id=${req.authUser.id}::uuid AND command_key=${input.idempotency_key}::uuid`.execute(db)).rows[0];
      if(previous){
        if(previous.relationship_id!==id||!previous.matches)throw new ConflictException("This request key was already used for different details.");
        return previous.result;
      }
      const current=await this.row(db,input.school_id,id,true);
      if(current.revision!==input.expected_revision)throw new ConflictException("Authority changed since you opened this form. Reload and review it again.");
      if(input.enabled&&input.valid_from!<current.today)throw new ConflictException("New grants cannot be backdated. Use today or a future date.");
      await sql`UPDATE guardian_relationships SET can_authorize_leave=${input.enabled},leave_valid_from=${input.valid_from}::date,
        leave_valid_until=${input.valid_until}::date,authority_revision=authority_revision+1,authority_source='reviewed'
        WHERE id=${id}::uuid AND school_id=${input.school_id}::uuid`.execute(db);
      const result=await this.row(db,input.school_id,id);
      const snapshot=(r:AuthorityRow)=>({revision:r.revision,enabled:r.enabled,valid_from:r.valid_from,valid_until:r.valid_until,source:r.source});
      const receipt=snapshot(result);
      const command=(await sql<{id:string}>`INSERT INTO guardian_leave_authority_commands(school_id,relationship_id,actor_id,command_key,input,previous,result,reason)
        VALUES(${input.school_id}::uuid,${id}::uuid,${req.authUser.id}::uuid,${input.idempotency_key}::uuid,${JSON.stringify(input)}::jsonb,
          ${JSON.stringify(snapshot(current))}::jsonb,${JSON.stringify(receipt)}::jsonb,${input.reason}) RETURNING id`.execute(db)).rows[0]!;
      await db.insertInto("audit_events").values({school_id:input.school_id,actor_id:req.authUser.id,action:"people.guardian.leave_authority_changed",
        target_type:"guardian_relationship",target_id:id,request_id:req.requestId,ip_hash:null,
        metadata:{command_id:command.id,student_id:current.student_id,revision:result.revision,enabled:input.enabled}}).execute();
      const audience=(await sql<{user_id:string}>`SELECT DISTINCT m.user_id FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active
        WHERE m.school_id=${input.school_id}::uuid AND m.is_active AND (m.role='admin' OR
          (m.role='guardian' AND EXISTS(SELECT 1 FROM parents p JOIN guardian_relationships g ON g.guardian_id=p.id WHERE p.user_id=m.user_id AND g.student_id=${current.student_id}::uuid)) OR
          (m.role='student' AND EXISTS(SELECT 1 FROM students s WHERE s.id=${current.student_id}::uuid AND s.user_id=m.user_id)))`.execute(db)).rows.map(r=>r.user_id);
      await this.events.enqueueUserEvent(db,{schoolId:input.school_id,eventType:"people.updated",aggregateType:"student",aggregateId:current.student_id,
        audienceUserIds:audience,idempotencyKey:`guardian-authority:${command.id}`,payload:{student_id:current.student_id,revision:result.revision,
          refresh:["people","parent.home","parent.leave","student.leave"]}});
      return receipt;
    });
  }
}
