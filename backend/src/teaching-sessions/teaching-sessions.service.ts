import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { sql } from "kysely";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { AttendanceModelService } from "../attendance-model/attendance-model.service.js";
import { ActivityAttendanceWorkspaceService } from "../attendance/activity-attendance-workspace.service.js";
import { SchoolService } from "../school/school.service.js";
import { lessonSave, sessionPage, teachingSessionHref } from "./teaching-session.contracts.js";
import { TeachingSessionContextService, type TeachingAccess, type TeachingSource } from "./teaching-session-context.service.js";
import { TeachingSessionModelService } from "./teaching-session-model.service.js";
import { TeachingSessionMaterialsService } from "./teaching-session-materials.service.js";
import { TeachingSessionWorkService } from "./teaching-session-work.service.js";

const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
type Link = { href: string; label: string };

@Injectable()
export class TeachingSessionsService {
  constructor(private readonly db: DatabaseService, private readonly context: TeachingSessionContextService,
    private readonly model: TeachingSessionModelService, readonly materials: TeachingSessionMaterialsService,
    @Optional() private readonly attendanceModel?: AttendanceModelService,
    @Optional() private readonly attendanceWorkspace?: ActivityAttendanceWorkspaceService,
    @Optional() private readonly school?: SchoolService,
    @Optional() readonly work?: TeachingSessionWorkService) {}

  private summary(source: TeachingSource, state: "empty" | "prepared" | "reported") {
    return { id: source.id, date: source.date, title: source.title, group_label: source.group_label, starts_at: source.starts_at,
      ends_at: source.ends_at, timezone: source.timezone, place_label: source.place_label, teacher_name: source.teacher_name,
      original_teacher_name: source.original_teacher_name, is_cover: source.is_cover, source_kind: source.source_kind,
      state: source.state, source_fingerprint: source.source_fingerprint, lesson_state: state, href: teachingSessionHref(source.id,source.date) };
  }

  async list(user: AuthUser, date: string, pageValue?: string) {
    const page = sessionPage.parse(pageValue), all = await this.context.sources(this.db,user,date), authorized: TeachingAccess[] = [];
    for (const source of all.sources) {
      try { authorized.push(await this.context.access(this.db,user,source)); }
      catch (cause) { if (!(cause instanceof ForbiddenException)) throw cause; }
    }
    const total = authorized.length, totalPages = Math.max(1,Math.ceil(total/10));
    if (page > totalPages) throw new BadRequestException("This session page is unavailable. Return to the first page.");
    const visible = authorized.slice((page-1)*10,page*10), ids = visible.map(item => item.source.id);
    const records = ids.length ? await this.db.selectFrom("teaching_sessions").select(["id","state"]).where("school_id","=",all.school.id).where("id","in",ids).execute() : [];
    return { date, page, page_size: 10, total, total_pages: totalPages, items: visible.map(access => {
      const state = records.find(record => record.id === access.source.id)?.state ?? "empty";
      return this.summary(access.source,!access.can_read_preparation && state === "prepared" ? "empty" : state);
    }) };
  }

  async open(user: AuthUser, date: string, selector: { occurrence_id?: string; class_section_id?: string; period_number?: string }, historyPage?: string) {
    const opened = await this.context.open(user,date,selector); return this.detail(user,opened.id,opened.date,historyPage);
  }

  async detail(user: AuthUser, id: string, date: string, historyPageValue?: string) {
    const access = await this.context.resolve(this.db,user,id,date), source = access.source, historyPage = sessionPage.parse(historyPageValue);
    const record = await this.db.selectFrom("teaching_sessions").selectAll().where("school_id","=",source.school_id).where("id","=",id).executeTakeFirst();
    let historyQuery = this.db.selectFrom("teaching_session_revisions as revision").innerJoin("school_people as person", join =>
      join.onRef("person.id","=","revision.actor_person_id").onRef("person.school_id","=","revision.school_id"))
      .selectAll("revision").select(sql<string>`concat_ws(' ',person.first_name,person.last_name)`.as("actor_name"))
      .where("revision.school_id","=",source.school_id).where("revision.session_id","=",id);
    if (!access.can_read_preparation) historyQuery = historyQuery.where("revision.state","=","reported");
    const history = await historyQuery.orderBy("revision.revision","desc").limit(11).offset((historyPage-1)*10).execute();
    if (historyPage > 1 && !history.length) throw new BadRequestException("This lesson history page is unavailable.");
    let materialQuery = this.db.selectFrom("teaching_session_materials").selectAll().where("school_id","=",source.school_id).where("session_id","=",id);
    if (!access.can_read_preparation) materialQuery = materialQuery.where("shared","=",true);
    const materials = await materialQuery.orderBy("created_at","desc").orderBy("id").limit(50).execute();
    const reported = record?.state === "reported", visible = reported || access.can_read_preparation;
    const related = await this.related(user,access);
    return { session: this.summary(source,!access.can_read_preparation && record?.state === "prepared" ? "empty" : record?.state ?? "empty"),
      lesson: { revision: record?.revision ?? 0, state: !access.can_read_preparation && !reported ? "empty" : record?.state ?? "empty",
        topic: visible ? record?.topic ?? "" : "", learner_notes: visible ? record?.learner_notes ?? "" : "",
        ...(access.can_read_preparation ? { preparation: record?.preparation ?? "" } : {}), reported_at: iso(record?.reported_at ?? null), updated_at: iso(record?.updated_at ?? null) },
      capabilities: { can_manage: access.can_manage, can_read_preparation: access.can_read_preparation,
        can_link_work: this.work ? await this.work.canLink(user,access) : false },
      associated_work: this.work ? await this.work.associated(user,access) : [],
      materials: await Promise.all(materials.map(async material => ({ id: material.id, title: material.title, kind: material.kind, url: material.url, body: material.body,
        original_name: material.original_name, content_type: material.content_type, size_bytes: material.size_bytes, sha256: material.sha256,
        shared: material.shared, replaces_material_id: material.replaces_material_id, created_at: iso(material.created_at),
        download_href: material.kind === "file" ? `/api/v1/learning/sessions/${id}/materials/${material.id}/file?${new URLSearchParams({date}).toString()}` : null,
        source_content_omitted: material.kind === "file" ? await this.materials.omitted(source.school_id,id,material.storage_key!,material.content_type!,material.original_name!) : false }))),
      history: { items: history.slice(0,10).map(item => ({ revision: item.revision, state: item.state, topic: item.topic, learner_notes: item.learner_notes,
        reason: item.reason, recorded_at: iso(item.recorded_at), actor_name: item.actor_name,
        ...(access.can_read_preparation ? { preparation: item.preparation } : {}) })), page: historyPage, has_more: history.length > 10 },
      previous_lesson: await this.previous(user,access), related,
      availability_reason: source.state === "cancelled" ? "This session was cancelled. Recorded history is retained."
        : !access.can_manage && access.can_read_preparation ? "You can read this lesson; its current instructor records any changes."
          : !access.can_manage ? "Shared class resources and reported lesson notes." : null };
  }

  private async previous(user: AuthUser, access: TeachingAccess) {
    const source = access.source;
    let query = this.db.selectFrom("teaching_sessions").select(["id","session_date","topic","learner_notes"])
      .where("school_id","=",source.school_id).where("state","=","reported").where("session_date","<",source.date)
      .where("source_kind","=",source.source_kind);
    if (source.source_kind === "academic") query = query.where("class_section_id","=",source.class_section_id)
      .where("subject_id",source.subject_id ? "=" : "is",source.subject_id);
    else query = query.where(sql`source_evidence->>'plan_version_id'`,"=",String(source.source_evidence.plan_version_id));
    const rows = await query.orderBy("session_date","desc").orderBy("updated_at","desc").limit(5).execute();
    for (const row of rows) {
      try { await this.context.resolve(this.db,user,row.id,row.session_date); return { id: row.id, date: row.session_date,
        topic: row.topic, learner_notes: row.learner_notes, href: teachingSessionHref(row.id,row.session_date) }; }
      catch (cause) { if (!(cause instanceof ForbiddenException || cause instanceof NotFoundException)) throw cause; }
    }
    return null;
  }

  async save(user: AuthUser, id: string, date: string, raw: unknown) {
    const data = lessonSave.parse(raw);
    const result = await this.db.transaction().execute(async tx => {
      // Serialize with schedule publication/cover acceptance before checking the
      // reviewed source. Current authorization still precedes receipt discovery.
      if (!user.active_school_id) throw new ForbiddenException("Choose an active campus.");
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${user.active_school_id}`},0))`.execute(tx);
      const access = await this.context.resolve(tx,user,id,date,true), source = access.source;
      const current = await this.model.lock(tx,source.school_id,id), revision = current?.revision ?? 0;
      const prepared = await this.model.prepare(tx,user,access,"lesson.save",data,{ id,date,...data },revision);
      if (prepared.status === "refused") return prepared;
      if (prepared.status === "completed") return { ...prepared.metadata, replayed: true };
      if (!access.can_manage) throw new ForbiddenException("This session is cancelled or no longer assigned to you.");
      if (data.state === "reported" && executionNow().getTime() < Date.parse(source.starts_at)) throw new BadRequestException("Record what was taught after the session starts. You can save preparation now.");
      if (current?.state === "reported" && (data.state !== "reported" || data.reason.length < 3)) throw new BadRequestException("Keep the reported lesson and add a reason for its correction.");
      await this.model.ensure(tx,source);
      const now = executionNow(), next = revision+1;
      await tx.updateTable("teaching_sessions").set({ revision: next, state: data.state, preparation: data.preparation,
        topic: data.topic, learner_notes: data.learner_notes, source_fingerprint: source.source_fingerprint, source_evidence: JSON.stringify(source.source_evidence),
        reported_at: data.state === "reported" ? current?.reported_at ?? now : null, updated_at: now }).where("school_id","=",source.school_id).where("id","=",id).execute();
      await tx.insertInto("teaching_session_revisions").values({ school_id: source.school_id, session_id: id, revision: next,
        state: data.state, preparation: data.preparation, topic: data.topic, learner_notes: data.learner_notes, reason: data.reason,
        source_fingerprint: source.source_fingerprint, source_evidence: JSON.stringify(source.source_evidence), command_id: prepared.command_id,
        actor_id: user.id, actor_person_id: access.person_id, recorded_at: now }).execute();
      const result = { id,date,revision:next,state:data.state };
      await this.model.finish(tx,user,source,prepared.command_id,next,current?.state === "reported" ? "lesson.corrected" : data.state === "reported" ? "lesson.reported" : "lesson.prepared",result);
      return { ...result, replayed: false };
    });
    if ("status" in result && result.status === "refused") throw new ConflictException(result.error);
    return result;
  }

  private async related(user: AuthUser, access: TeachingAccess) {
    const source = access.source; let attendance: (Link & {grain:"daily_class"|"scheduled_session"|"activity"}) | null = null;
    if (source.source_kind === "activity" && this.attendanceWorkspace && source.occurrence_id) {
      try { const detail = await this.attendanceWorkspace.openOccurrence(user,source.school_id,source.occurrence_id);
        attendance = { href: `/areas/attendance/registers?${new URLSearchParams({date:source.date,register_id:detail.register.id}).toString()}`,
          label: "Activity attendance", grain: "activity" }; }
      catch (cause) { if (!(cause instanceof ForbiddenException || cause instanceof NotFoundException)) throw cause; }
    } else if (source.source_kind === "academic" && this.attendanceModel) {
      try { const workspace = await this.attendanceModel.workspace(user,source.date);
        if (workspace.mode === "scheduled_session") {
          const register = workspace.registers.find((row: {class_section_id:string;period_number:number}) => row.class_section_id === source.class_section_id && row.period_number === source.period_number);
          if (register) attendance = { href: `/areas/attendance/registers?${new URLSearchParams({date:source.date,session_id:String(register.session_id)}).toString()}`,
            label: "Lesson attendance", grain: "scheduled_session" };
        } else if (workspace.mode === "daily_class" && this.school) {
          await this.school.teacherAttendanceScreen(user,source.class_section_id!,source.date);
          attendance = { href: `/areas/attendance/registers?${new URLSearchParams({date:source.date,class_section_id:source.class_section_id!}).toString()}`,
            label: "Daily attendance", grain: "daily_class" };
        }
      } catch (cause) { if (!(cause instanceof ForbiddenException || cause instanceof NotFoundException)) throw cause; }
    }
    const grants = source.class_section_id && access.can_read_preparation ? (await sql<{permission:string}>`SELECT unnest(binding.permissions) AS permission
      FROM staff_role_bindings binding WHERE binding.school_id=${source.school_id}::uuid AND binding.user_id=${user.id}::uuid
        AND binding.context_kind='class' AND binding.scope_id=${source.class_section_id}::uuid AND binding.role_active AND binding.status='active'
        AND (${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date>=binding.starts_on
        AND(binding.ends_on IS NULL OR (${executionNow()}::timestamptz AT TIME ZONE ${source.timezone})::date<=binding.ends_on)
        AND(binding.subject_id IS NULL OR binding.subject_id=${source.subject_id}::uuid)`.execute(this.db)).rows : [];
    const has = (permission:string) => grants.some(item=>item.permission===permission);
    return { attendance,
      practice: has("learning.work.publish") ? { href:`/areas/messages/diary?${new URLSearchParams({scope:"class",class_section_id:source.class_section_id!}).toString()}`,label:"Class practice" } : null,
      assignments: has("learning.assignments.manage") ? { href:`/areas/messages/assignments?${new URLSearchParams({scope:"class",class_section_id:source.class_section_id!}).toString()}`,label:"Class assignments" } : null,
      schedule: has("timetable.view") ? { href:`/areas/timetable?${new URLSearchParams({date:source.date}).toString()}`,label:"Open timetable" } : null };
  }
}
