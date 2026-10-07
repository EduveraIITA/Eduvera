import { schoolPermission } from "../roles/authorization.js";
import {BadRequestException,ConflictException,Injectable,Logger,NotFoundException,type OnModuleInit,type OnModuleDestroy} from "@nestjs/common";
import {createHash,randomUUID} from "node:crypto";
import {sql} from "kysely";
import {z} from "zod";
import type {AuthenticatedRequest,AuthUser} from "../common/request.js";
import {DatabaseService} from "../database/database.service.js";
import {SchoolEventService} from "../school/school-event.service.js";
import {IMPORT_COLUMNS,csvCell,guardianChoiceSchema,parseImportCsv,valuesSchema} from "./import-csv.js";
import {validateImport} from "./import-validation.js";
import {saveValidatedImport} from "./import-writer.js";
import type {ImportDb,ImportJob,ImportRow} from "./import-types.js";
import type {Transaction} from "kysely";
import type {Database} from "../database/types.js";

const uuid=z.string().uuid();
@Injectable()
export class PeopleImportService implements OnModuleInit,OnModuleDestroy {
  private timer:ReturnType<typeof setInterval>|undefined;
  private cleaning=false;
  constructor(private readonly db:DatabaseService,private readonly events:SchoolEventService){}
  onModuleInit(){const run=()=>void this.expireDrafts().catch(()=>Logger.warn("Import retention cleanup will retry.","PeopleImportService"));run();this.timer=setInterval(run,15*60*1000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async expireDrafts(){
    if(this.cleaning)return;this.cleaning=true;
    try{await this.db.transaction().execute(async db=>{
      const expired=(await sql<{id:string}>`SELECT id FROM people_imports WHERE state='draft' AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED`.execute(db)).rows.map(r=>r.id);
      if(!expired.length)return;
      await sql`UPDATE people_import_rows SET raw_values='{}'::jsonb,guardian_choice='{}'::jsonb WHERE import_id=ANY(${expired}::uuid[])`.execute(db);
      await sql`UPDATE people_imports SET state='expired',revision=revision+1,updated_at=now() WHERE id=ANY(${expired}::uuid[])`.execute(db);
    });}finally{this.cleaning=false;}
  }
  private async authorize(db:ImportDb,user:AuthUser,schoolId:string,lock=false){
    uuid.parse(schoolId);
    await schoolPermission(db,user,schoolId,"sis.manage",lock);
  }
  private async job(db:ImportDb,id:string,schoolId:string,lock=false){
    const job=(await sql<ImportJob>`SELECT * FROM people_imports WHERE id=${uuid.parse(id)}::uuid AND school_id=${uuid.parse(schoolId)}::uuid ${lock?sql`FOR UPDATE`:sql``}`.execute(db)).rows[0];
    if(!job)throw new NotFoundException("Import not found in this school.");return job;
  }
  private async rows(db:ImportDb,id:string){return (await sql<ImportRow>`SELECT row_number,raw_values AS "values",decision,guardian_choice,student_id FROM people_import_rows WHERE import_id=${id}::uuid ORDER BY row_number`.execute(db)).rows;}
  private async audit(db:ImportDb,req:AuthenticatedRequest,schoolId:string,id:string,action:string,metadata:Record<string,unknown>){await db.insertInto("audit_events").values({school_id:schoolId,actor_id:req.authUser.id,action,target_type:"people_import",target_id:id,request_id:req.requestId,ip_hash:null,metadata}).execute();}
  private async notifyAdministrators(db:Transaction<Database>,schoolId:string,id:string,revision:number){
    const audience=(await sql<{user_id:string}>`SELECT DISTINCT m.user_id FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active WHERE m.school_id=${schoolId}::uuid AND m.role='admin' AND m.is_active`.execute(db)).rows.map(r=>r.user_id);
    await this.events.enqueueUserEvent(db,{schoolId,eventType:"people.updated",aggregateType:"people_import",aggregateId:id,audienceUserIds:audience,
      idempotencyKey:`import-draft:${id}:${revision}`,payload:{import_id:id,revision,refresh:["people"]}});
  }
  private ensureDraft(job:ImportJob,revision:number){if(job.state!=='draft')throw new ConflictException("This import is no longer editable.");if(new Date(job.expires_at).getTime()<=Date.now())throw new ConflictException("This import expired. Upload a new file.");if(job.revision!==revision)throw new ConflictException("This import changed. Reload the latest review before continuing.");}

  async template(user:AuthUser,schoolId:string){await this.authorize(this.db,user,schoolId);return `${IMPORT_COLUMNS.join(",")}\r\n`;}
  async list(user:AuthUser,query:Record<string,string>){
    const input=z.object({school_id:uuid,cursor:uuid.optional()}).parse(query);await this.authorize(this.db,user,input.school_id);await this.expireDrafts();
    const results=(await sql<{id:string}>`SELECT i.id,i.filename,i.state,i.revision,i.row_count,i.created_at,i.expires_at,i.committed_at,t.name AS term_name,
      concat_ws(' ',u.first_name,u.last_name) AS created_by_name,i.receipt-'enrolled' AS summary
      FROM people_imports i JOIN academic_terms t ON t.id=i.term_id JOIN users u ON u.id=i.created_by
      WHERE i.school_id=${input.school_id}::uuid AND (${input.cursor??null}::uuid IS NULL OR (i.created_at,i.id)<(SELECT c.created_at,c.id FROM people_imports c WHERE c.id=${input.cursor??null}::uuid AND c.school_id=${input.school_id}::uuid))
      ORDER BY i.created_at DESC,i.id DESC LIMIT 21`.execute(this.db)).rows;
    return {results:results.slice(0,20),next_cursor:results.length>20?results[19]!.id:null};
  }
  async stage(req:AuthenticatedRequest,body:unknown){
    const input=z.object({school_id:uuid,term_id:uuid,filename:z.string().trim().min(1).max(150).refine(v=>[...v].every(c=>c.charCodeAt(0)>=32&&c!=="/"&&c!=="\\"),"Use a filename without control characters or path separators."),csv:z.string().max(512*1024),idempotency_key:uuid}).strict().parse(body);
    await this.authorize(this.db,req.authUser,input.school_id);
    const rows=parseImportCsv(input.csv);const digest=createHash("sha256").update(input.csv).digest("hex");
    return this.db.transaction().execute(async db=>{
      await this.authorize(db,req.authUser,input.school_id,true);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`import-upload:${input.school_id}:${req.authUser.id}:${input.idempotency_key}`},0))`.execute(db);
      const existing=(await sql<{id:string;source_digest:string;term_id:string;filename:string}>`SELECT id,source_digest,term_id,filename FROM people_imports WHERE school_id=${input.school_id}::uuid AND created_by=${req.authUser.id}::uuid AND upload_key=${input.idempotency_key}::uuid`.execute(db)).rows[0];
      if(existing){if(existing.source_digest!==digest||existing.term_id!==input.term_id||existing.filename!==input.filename)throw new ConflictException("This upload key was used for a different file.");return {id:existing.id};}
      if(!(await sql`SELECT id FROM academic_terms WHERE id=${input.term_id}::uuid AND school_id=${input.school_id}::uuid AND is_active FOR SHARE`.execute(db)).rows.length)throw new BadRequestException("Select an active academic term in this school.");
      const job=(await sql<{id:string}>`INSERT INTO people_imports(school_id,term_id,created_by,filename,row_count,upload_key,source_digest) VALUES(${input.school_id}::uuid,${input.term_id}::uuid,${req.authUser.id}::uuid,${input.filename},${rows.length},${input.idempotency_key}::uuid,${digest}) RETURNING id`.execute(db)).rows[0]!;
      await sql`INSERT INTO people_import_rows(school_id,import_id,row_number,raw_values) SELECT ${input.school_id}::uuid,${job.id}::uuid,(ordinality+1)::int,value FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) WITH ORDINALITY`.execute(db);
      await this.audit(db,req,input.school_id,job.id,"people.import.staged",{row_count:rows.length,term_id:input.term_id});
      await this.notifyAdministrators(db,input.school_id,job.id,1);
      return job;
    });
  }
  async detail(user:AuthUser,id:string,schoolId:string){
    await this.authorize(this.db,user,schoolId);
    // Directly purge this authorized expired draft, even when the background queue is busy.
    await this.db.transaction().execute(async db=>{
      const job=await this.job(db,id,schoolId,true);
      if(job.state==='draft'&&new Date(job.expires_at).getTime()<=Date.now()){
        await sql`UPDATE people_import_rows SET raw_values='{}'::jsonb,guardian_choice='{}'::jsonb WHERE import_id=${id}::uuid`.execute(db);
        await sql`UPDATE people_imports SET state='expired',revision=revision+1,updated_at=now() WHERE id=${id}::uuid`.execute(db);
        await db.insertInto("audit_events").values({school_id:schoolId,actor_id:null,action:"people.import.expired",target_type:"people_import",target_id:id,request_id:randomUUID(),ip_hash:null,metadata:{}}).execute();
      }
    });
    // One repeatable snapshot prevents row edits from being paired with an older revision.
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async db=>{
      const job=await this.job(db,id,schoolId);
      const summary={id:job.id,filename:job.filename,state:job.state,revision:job.revision,row_count:job.row_count,created_at:job.created_at,expires_at:job.expires_at,receipt:job.receipt};
      if(job.state!=='draft'||new Date(job.expires_at).getTime()<=Date.now())return {...summary,state:job.state==='draft'?'expired':job.state,review:null};
      return {...summary,review:await validateImport(db,job,await this.rows(db,id))};
    });
  }
  async updateRow(req:AuthenticatedRequest,id:string,rowNumber:number,body:unknown){
    const input=z.object({school_id:uuid,expected_revision:z.number().int().positive(),values:valuesSchema,decision:z.enum(['include','skip']),guardian_choice:guardianChoiceSchema}).strict().parse(body);
    z.number().int().min(2).max(501).parse(rowNumber);
    return this.db.transaction().execute(async db=>{
      await this.authorize(db,req.authUser,input.school_id,true);const job=await this.job(db,id,input.school_id,true);this.ensureDraft(job,input.expected_revision);
      const updated=await sql`UPDATE people_import_rows SET raw_values=${JSON.stringify(input.values)}::jsonb,decision=${input.decision},guardian_choice=${JSON.stringify(input.guardian_choice)}::jsonb WHERE import_id=${id}::uuid AND row_number=${rowNumber} RETURNING row_number`.execute(db);
      if(!updated.rows.length)throw new NotFoundException("Import row not found.");
      await sql`UPDATE people_imports SET revision=revision+1,updated_at=now() WHERE id=${id}::uuid`.execute(db);
      await this.audit(db,req,input.school_id,id,"people.import.row_updated",{row_number:rowNumber,revision:job.revision+1,decision:input.decision,guardian_mode:input.guardian_choice.mode});
      await this.notifyAdministrators(db,input.school_id,id,job.revision+1);
      return {revision:job.revision+1};
    });
  }
  async cancel(req:AuthenticatedRequest,id:string,body:unknown){
    const input=z.object({school_id:uuid,expected_revision:z.number().int().positive()}).strict().parse(body);
    return this.db.transaction().execute(async db=>{
      await this.authorize(db,req.authUser,input.school_id,true);const job=await this.job(db,id,input.school_id,true);
      if(job.state==='cancelled')return {state:'cancelled'};this.ensureDraft(job,input.expected_revision);
      await sql`UPDATE people_import_rows SET raw_values='{}'::jsonb,guardian_choice='{}'::jsonb WHERE import_id=${id}::uuid`.execute(db);
      await sql`UPDATE people_imports SET state='cancelled',revision=revision+1,updated_at=now() WHERE id=${id}::uuid`.execute(db);
      await this.audit(db,req,input.school_id,id,"people.import.cancelled",{revision:job.revision+1});
      await this.notifyAdministrators(db,input.school_id,id,job.revision+1);
      return {state:'cancelled'};
    });
  }
  async commit(req:AuthenticatedRequest,id:string,body:unknown){
    const input=z.object({school_id:uuid,expected_revision:z.number().int().positive(),validation_token:z.string().regex(/^[a-f0-9]{64}$/),verified:z.literal(true)}).strict().parse(body);
    try{return await this.db.transaction().execute(async db=>{
      await sql`SET LOCAL lock_timeout='5s'`.execute(db);await sql`SET LOCAL statement_timeout='20s'`.execute(db);
      await this.authorize(db,req.authUser,input.school_id,true);const job=await this.job(db,id,input.school_id,true);
      if(job.state==='committed'){if(job.commit_token!==input.validation_token||job.revision!==input.expected_revision+1)throw new ConflictException("This import was committed from a different review.");return job.receipt;}
      this.ensureDraft(job,input.expected_revision);const rows=await this.rows(db,id);
      // Same lock order as individual enrollment: admission, classes, term, guardians, registers.
      const admissions=[...new Set(rows.filter(r=>r.decision==='include').map(r=>r.values.admission_number.toUpperCase()))].sort();
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(key,0)) FROM (SELECT unnest(${admissions.map(admission=>`admission:${job.school_id}:${admission}`)}::text[]) AS key ORDER BY key OFFSET 0) ordered_keys`.execute(db);
      const preflight=await validateImport(db,job,rows);const classIds=[...new Set(preflight.rows.flatMap(r=>r.normalized?[r.normalized.class_section_id]:[]))];
      await sql`SELECT c.id FROM class_sections c WHERE c.school_id=${job.school_id}::uuid AND c.id=ANY(${classIds}::uuid[]) ORDER BY c.id FOR UPDATE OF c`.execute(db);
      await sql`SELECT id FROM academic_terms WHERE id=${job.term_id}::uuid FOR SHARE`.execute(db);
      const guardians=rows.flatMap(r=>r.decision==='include'&&r.guardian_choice.mode==='existing'?[r.guardian_choice.id]:[]);
      await sql`SELECT p.id FROM parents p JOIN guardian_school_profiles gp ON gp.guardian_id=p.id JOIN school_people person ON person.id=gp.person_id WHERE gp.school_id=${job.school_id}::uuid AND p.id=ANY(${guardians}::uuid[]) ORDER BY p.id FOR UPDATE OF p FOR SHARE OF gp,person`.execute(db);
      await sql`SELECT id FROM attendance_registers WHERE school_id=${job.school_id}::uuid AND term_id=${job.term_id}::uuid AND class_section_id=ANY(${classIds}::uuid[]) ORDER BY id FOR UPDATE`.execute(db);
      const review=await validateImport(db,job,rows);
      if(!review.summary.included||review.summary.errors)throw new ConflictException("Resolve or skip every invalid row before importing. At least one valid row is required.");
      if(review.validation_token!==input.validation_token)throw new ConflictException("School records changed since this review. Reload and check the updated results before confirming.");
      return saveValidatedImport(db,this.events,req,job,review);
    });}catch(error){const code=(error as {code?:string}).code;if(['23505','40001','40P01','55P03','57014'].includes(code??''))throw new ConflictException("Another school update conflicted with this import. Nothing from this attempt was saved; reload and review before retrying.");throw error;}
  }
  async report(user:AuthUser,id:string,schoolId:string){
    const result=await this.detail(user,id,schoolId);
    if(result.review)return ["row,admission_number,student,decision,errors,warnings",...result.review.rows.map(r=>[r.row_number,r.values.admission_number,`${r.values.first_name} ${r.values.last_name}`.trim(),r.decision,r.errors.join(" | "),r.warnings.join(" | ")].map(csvCell).join(","))].join("\r\n");
    if(result.receipt)return ["row,admission_number,student_id",...result.receipt.enrolled.map(r=>[r.row_number,r.admission_number,r.student_id].map(csvCell).join(","))].join("\r\n");
    throw new ConflictException("Row details have been cleared for this closed import.");
  }
}
