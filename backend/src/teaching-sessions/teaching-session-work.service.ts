import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import type { Database } from "../database/types.js";
import { DatabaseService } from "../database/database.service.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { TeachingSessionContextService, type TeachingAccess } from "./teaching-session-context.service.js";
import { TeachingSessionModelService } from "./teaching-session-model.service.js";
import { sessionCommand, sessionPage, sessionUuid } from "./teaching-session.contracts.js";

export const linkSessionWork = sessionCommand.extend({ work_kind:z.enum(["practice","assignment"]),work_id:sessionUuid }).strict();
type WorkKind = "practice" | "assignment";
interface WorkSource { work_kind: WorkKind;work_id:string;title:string;due_at:Date|string|null;author_id:string;state:string }

/** Exact associations only. Publication, attempts, private questions and reviews
 * remain owned and authorized by their existing Learning APIs. */
@Injectable()
export class TeachingSessionWorkService {
  constructor(private readonly db:DatabaseService,private readonly context:TeachingSessionContextService,private readonly model:TeachingSessionModelService) {}

  private async permissions(db:DatabaseService|Transaction<Database>,user:AuthUser,access:TeachingAccess) {
    const source=access.source;
    if (!source.class_section_id || !source.term_id) return [];
    return (await sql<{permission:string}>`SELECT unnest(binding.permissions) AS permission FROM staff_role_bindings binding
      JOIN staff_profiles staff ON staff.school_id=binding.school_id AND staff.user_id=binding.user_id AND staff.status='active' AND staff.person_id=${access.person_id}::uuid
      WHERE binding.school_id=${source.school_id}::uuid AND binding.user_id=${user.id}::uuid AND binding.context_kind='class'
        AND binding.scope_id=${source.class_section_id}::uuid AND binding.status='active' AND binding.role_active
        AND(binding.subject_id IS NULL OR binding.subject_id=${source.subject_id}::uuid)
        AND binding.starts_on<=(${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date
        AND(binding.ends_on IS NULL OR binding.ends_on>=(${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date)`.execute(db)).rows.map(row=>row.permission);
  }
  async canLink(user:AuthUser,access:TeachingAccess) {
    if (!access.can_manage || !access.source.class_section_id || !access.source.term_id) return false;
    const permissions=await this.permissions(this.db,user,access);
    return permissions.includes("learning.work.publish") || permissions.includes("learning.assignments.manage");
  }
  private href(kind:WorkKind,id:string,classId:string,studentId?:string) {
    return kind==="practice" ? `/areas/messages/diary?${new URLSearchParams(studentId ? {scope:"self",student_id:studentId,diary_item:id}
      : {scope:"class",class_section_id:classId,diary_item:id}).toString()}`
      : `/areas/messages/assignments?${new URLSearchParams(studentId ? {scope:"self",student_id:studentId,assignment:id}
        : {scope:"class",class_section_id:classId,assignment:id}).toString()}`;
  }
  private async authored(db:DatabaseService|Transaction<Database>,user:AuthUser,access:TeachingAccess,kind:WorkKind,id?:string) {
    const source=access.source,permissions=await this.permissions(db,user,access);
    if (!source.class_section_id || !source.term_id || !permissions.includes(kind==="practice"?"learning.work.publish":"learning.assignments.manage")) return [];
    if (kind==="practice") return (await sql<WorkSource>`SELECT 'practice'::text AS work_kind,item.id AS work_id,item.title,item.due_at,item.author_id,'published'::text AS state
      FROM diary_items item JOIN academic_terms term ON term.id=item.term_id AND term.school_id=item.school_id
      WHERE item.school_id=${source.school_id}::uuid AND item.class_section_id=${source.class_section_id}::uuid AND item.term_id=${source.term_id}::uuid
        AND item.subject_id IS NOT DISTINCT FROM ${source.subject_id}::uuid AND item.item_type='homework' AND item.author_id=${user.id}::uuid
        AND item.published_at<=${executionNow()}::timestamptz AND (${id===undefined} OR item.id=${id??null}::uuid)
        AND (${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date BETWEEN term.starts_on AND term.ends_on
      ORDER BY item.published_at DESC,item.id LIMIT 1`.execute(db)).rows;
    return (await sql<WorkSource>`SELECT 'assignment'::text AS work_kind,item.id AS work_id,item.title,item.due_at,item.author_id,item.state
      FROM learning_assignments item JOIN academic_terms term ON term.id=item.term_id AND term.school_id=item.school_id
      WHERE item.school_id=${source.school_id}::uuid AND item.context_kind='class_term' AND item.class_section_id=${source.class_section_id}::uuid AND item.term_id=${source.term_id}::uuid
        AND item.subject_id IS NOT DISTINCT FROM ${source.subject_id}::uuid AND item.author_id=${user.id}::uuid AND item.state='published'
        AND (${id===undefined} OR item.id=${id??null}::uuid)
        AND (${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date BETWEEN term.starts_on AND term.ends_on
      ORDER BY item.updated_at DESC,item.id LIMIT 1`.execute(db)).rows;
  }
  async options(user:AuthUser,id:string,date:string,pageValue?:string) {
    const access=await this.context.resolve(this.db,user,id,date),page=sessionPage.parse(pageValue),canLink=await this.canLink(user,access);
    const supported=Boolean(access.source.class_section_id&&access.source.term_id);
    if (!supported || !canLink) return {supported,reason:!supported?"Learning work needs its own class or offering context. This activity has no academic enrollment."
      :"Creating or linking class work requires your separate current learning permission.",page,page_size:10,has_more:false,items:[]};
    const source=access.source,permissions=await this.permissions(this.db,user,access);
    const all=(await sql<WorkSource>`SELECT * FROM (
      SELECT 'practice'::text AS work_kind,item.id AS work_id,item.title,item.due_at,item.author_id,'published'::text AS state
      FROM diary_items item JOIN academic_terms term ON term.id=item.term_id AND term.school_id=item.school_id
      WHERE ${permissions.includes("learning.work.publish")} AND item.school_id=${source.school_id}::uuid AND item.class_section_id=${source.class_section_id}::uuid
        AND item.term_id=${source.term_id}::uuid AND item.subject_id IS NOT DISTINCT FROM ${source.subject_id}::uuid
        AND item.item_type='homework' AND item.author_id=${user.id}::uuid AND item.published_at<=${executionNow()}::timestamptz
        AND (${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date BETWEEN term.starts_on AND term.ends_on
      UNION ALL
      SELECT 'assignment',item.id,item.title,item.due_at,item.author_id,item.state FROM learning_assignments item
      JOIN academic_terms term ON term.id=item.term_id AND term.school_id=item.school_id
      WHERE ${permissions.includes("learning.assignments.manage")} AND item.school_id=${source.school_id}::uuid AND item.context_kind='class_term'
        AND item.class_section_id=${source.class_section_id}::uuid AND item.term_id=${source.term_id}::uuid AND item.subject_id IS NOT DISTINCT FROM ${source.subject_id}::uuid
        AND item.author_id=${user.id}::uuid AND item.state='published'
        AND (${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date BETWEEN term.starts_on AND term.ends_on
      ) candidates ORDER BY title,work_id LIMIT 11 OFFSET ${(page-1)*10}`.execute(this.db)).rows;
    const items=all.slice(0,10).map(item=>({work_kind:item.work_kind,work_id:item.work_id,title:item.title,
      due_at:item.due_at?new Date(item.due_at).toISOString():null,href:this.href(item.work_kind,item.work_id,access.source.class_section_id!)}));
    if(page>1&&!items.length)throw new BadRequestException("This learning-work page is unavailable.");
    return {supported:true,reason:null,page,page_size:10,has_more:all.length>10,items};
  }
  async link(user:AuthUser,id:string,date:string,raw:unknown) {
    const data=linkSessionWork.parse(raw);
    const result=await this.db.transaction().execute(async tx=>{
      if(!user.active_school_id)throw new ForbiddenException("Choose an active campus.");
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${user.active_school_id}`},0))`.execute(tx);
      const access=await this.context.resolve(tx,user,id,date,true),source=access.source;
      // Independent source authority is checked before retained receipt lookup.
      const work=(await this.authored(tx,user,access,data.work_kind,data.work_id))[0];
      if(!work)throw new ForbiddenException("Choose your own published work from this exact class, term and subject with current learning authority.");
      const current=await this.model.lock(tx,source.school_id,id),revision=current?.revision??0;
      const prepared=await this.model.prepare(tx,user,access,"work.link",data,{id,date,...data},revision);
      if(prepared.status==="refused")return prepared;
      if(prepared.status==="completed")return {...prepared.metadata,replayed:true};
      if(!access.can_manage)throw new ForbiddenException("This session is cancelled or no longer assigned to you.");
      if(await tx.selectFrom("teaching_session_work").select("id").where("school_id","=",source.school_id).where("session_id","=",id)
        .where("work_kind","=",data.work_kind).where("work_id","=",data.work_id).executeTakeFirst())throw new ConflictException("This work is already linked to the session.");
      const count=await tx.selectFrom("teaching_session_work").select(tx.fn.countAll<number>().as("count")).where("school_id","=",source.school_id).where("session_id","=",id).executeTakeFirstOrThrow();
      if(Number(count.count)>=50)throw new BadRequestException("This session has reached its 50-work-item limit.");
      await this.model.ensure(tx,source);
      // Command identity is stable and unique; no separate client-generated link ID.
      const linkId=data.command_id;
      await tx.insertInto("teaching_session_work").values({id:linkId,school_id:source.school_id,session_id:id,work_kind:data.work_kind,work_id:data.work_id,
        practice_id:data.work_kind==="practice"?data.work_id:null,assignment_id:data.work_kind==="assignment"?data.work_id:null,
        command_id:prepared.command_id,created_by:user.id,created_at:executionNow()}).execute();
      await tx.updateTable("teaching_sessions").set({revision:revision+1,source_fingerprint:source.source_fingerprint,
        source_evidence:JSON.stringify(source.source_evidence),updated_at:executionNow()}).where("school_id","=",source.school_id).where("id","=",id).execute();
      const receipt={id,date,link_id:linkId,work_kind:data.work_kind,work_id:data.work_id,revision:revision+1};
      await this.model.finish(tx,user,source,prepared.command_id,revision+1,"work.linked",receipt);
      return {...receipt,replayed:false};
    });
    if("status" in result&&result.status==="refused")throw new ConflictException(result.error);
    return result;
  }
  async associated(user:AuthUser,access:TeachingAccess) {
    const source=access.source;
    if(!source.class_section_id||!source.term_id)return [];
    const links=await this.db.selectFrom("teaching_session_work").selectAll().where("school_id","=",source.school_id).where("session_id","=",source.id)
      .orderBy("created_at","desc").orderBy("id").limit(50).execute();
    const enrollment=(await sql<{student_id:string}>`SELECT enrollment.student_id FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id
      WHERE student.school_id=${source.school_id}::uuid AND student.person_id=${access.person_id}::uuid AND enrollment.class_section_id=${source.class_section_id}::uuid
        AND enrollment.term_id=${source.term_id}::uuid AND enrollment.is_active
        AND enrollment.enrolled_on<=(${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date
        AND(enrollment.inactive_from IS NULL OR enrollment.inactive_from>(${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date) LIMIT 1`.execute(this.db)).rows[0];
    const result:Array<{id:string;work_kind:WorkKind;work_id:string;title:string;due_at:string|null;href:string}>=[];
    for(const link of links){
      let work=(await this.authored(this.db,user,access,link.work_kind,link.work_id))[0],learner=false;
      if(!work&&enrollment){
        if(link.work_kind==="practice")work=(await sql<WorkSource>`SELECT 'practice'::text AS work_kind,id AS work_id,title,due_at,author_id,'published'::text AS state FROM diary_items
          WHERE school_id=${source.school_id}::uuid AND id=${link.work_id}::uuid AND class_section_id=${source.class_section_id}::uuid AND term_id=${source.term_id}::uuid
            AND item_type='homework' AND published_at<=${executionNow()}::timestamptz`.execute(this.db)).rows[0];
        else work=(await sql<WorkSource>`SELECT 'assignment'::text AS work_kind,item.id AS work_id,item.title,item.due_at,item.author_id,item.state
          FROM learning_assignments item JOIN learning_assignment_audience audience ON audience.school_id=item.school_id AND audience.assignment_id=item.id
          WHERE item.school_id=${source.school_id}::uuid AND item.id=${link.work_id}::uuid AND item.state='published' AND audience.student_id=${enrollment.student_id}::uuid`.execute(this.db)).rows[0];
        learner=Boolean(work);
      }
      if(work)result.push({id:link.id,work_kind:link.work_kind,work_id:link.work_id,title:work.title,due_at:work.due_at?new Date(work.due_at).toISOString():null,
        href:this.href(link.work_kind,link.work_id,source.class_section_id,learner?enrollment!.student_id:undefined)});
    }
    return result;
  }
}
