import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { DOMAIN_COMMAND_RECEIPT_READ_PORT, type DomainCommandReceiptReadPort } from "../campus-model-core/domain-command-receipt-read.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { SchoolEventService } from "./school-event.service.js";
import { practiceCommand, practiceCompletion, practiceId, practiceNote, publishPractice, type PracticeCommand } from "./class-practice.contracts.js";

type Db = Kysely<Database> | Transaction<Database>;
type Binding = { source_id: string; revision: number; subject_id: string | null; starts_on: string; ends_on: string | null };
function localDate(timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(executionNow()); }
function pageOf(value?: string) { const page = Number(value ?? 1); if (!Number.isInteger(page) || page < 1 || page > 1000) throw new BadRequestException("Choose a valid page."); return page; }

/** Diary owns immutable class instructions and reported completion, not submissions or grades. */
@Injectable()
export class ClassPracticeService {
  constructor(private readonly db: DatabaseService, private readonly events: SchoolEventService,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT) private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identity: HumanAgentIdentityPort) {}

  private async school(db: Db, user: AuthUser) {
    if (!user.active_school_id || !user.is_active) throw new ForbiddenException("Choose an active campus account.");
    const school = await db.selectFrom("schools").innerJoin("school_memberships as membership", "membership.school_id", "schools.id")
      .innerJoin("users as account", "account.id", "membership.user_id").select(["schools.id", "schools.timezone"])
      .where("schools.id", "=", user.active_school_id).where("membership.user_id", "=", user.id)
      .where("membership.is_active", "=", true).where("account.is_active", "=", true).executeTakeFirst();
    if (!school) throw new ForbiddenException("Your campus access is no longer active.");
    const selected = executionEnvironmentStorage.getStore();
    if (selected && selected.institution_id !== school.id) throw new ForbiddenException("The selected world does not match this campus.");
    return { ...school, today: localDate(school.timezone) };
  }

  private async acting(db:Transaction<Database>,user:AuthUser,schoolId:string){
    const actor=await this.identity.resolveAccountEndpoint(db,{school_id:schoolId,user_id:user.id,at:executionNow().toISOString()});
    if(!actor.acting)throw new ForbiddenException("Your current campus person/account link is unavailable. Ask your campus administrator to review it.");
    return actor;
  }

  private async teacher(db: Transaction<Database>, user: AuthUser, classId: string, subjectId?: string | null) {
    practiceId.parse(classId);
    const school = await this.school(db, user);
    await this.acting(db,user,school.id);
    const bindings = (await sql<Binding>`SELECT binding.source_id,binding.revision,binding.subject_id,
      binding.starts_on::text,binding.ends_on::text FROM staff_role_bindings binding
      WHERE binding.school_id=${school.id}::uuid AND binding.user_id=${user.id}::uuid
        AND binding.context_kind='class' AND binding.scope_id=${classId}::uuid
        AND binding.status='active' AND binding.role_active
        AND ${school.today}::date>=binding.starts_on AND (binding.ends_on IS NULL OR ${school.today}::date<=binding.ends_on)
        AND 'learning.work.publish'=ANY(binding.permissions)
        AND (${subjectId === undefined} OR binding.subject_id IS NULL OR binding.subject_id=${subjectId ?? null}::uuid)
      ORDER BY binding.source_id`.execute(db)).rows;
    if (!bindings.length) throw new ForbiddenException("Your class practice assignment is unavailable. Ask your campus administrator to review it.");
    const section = await db.selectFrom("class_sections").select(["id", "grade", "section", "academic_year"])
      .where("id", "=", classId).where("school_id", "=", school.id).executeTakeFirst();
    if (!section) throw new NotFoundException("Class unavailable.");
    return { school, section, bindings };
  }

  private async source(db: Db, user: AuthUser, id: string) {
    practiceId.parse(id);
    const school = await this.school(db, user);
    const item = await db.selectFrom("diary_items").selectAll().where("id", "=", id).where("school_id", "=", school.id)
      .where("item_type", "=", "homework").where("published_at", "<=", executionNow()).executeTakeFirst();
    if (!item) throw new NotFoundException("Practice unavailable.");
    return { school, item };
  }

  private async learner(db: Transaction<Database>, user: AuthUser, item: { school_id: string; class_section_id: string; term_id: string }, studentId: string) {
    practiceId.parse(studentId);
    const school = await this.school(db, user);
    await this.acting(db,user,school.id);
    const student = (await sql<{ id: string; self: boolean; guardian: boolean }>`SELECT student.id,
      (student.user_id=${user.id}::uuid AND EXISTS(SELECT 1 FROM school_memberships self_member WHERE self_member.user_id=${user.id}::uuid
        AND self_member.school_id=student.school_id AND self_member.is_active AND self_member.role='student')) AS self,
      EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id
        JOIN school_memberships membership ON membership.user_id=parent.user_id AND membership.school_id=relationship.school_id
          AND membership.is_active AND membership.role='guardian'
        WHERE relationship.school_id=${school.id}::uuid AND relationship.student_id=student.id AND parent.user_id=${user.id}::uuid) AS guardian
      FROM students student JOIN enrollments enrollment ON enrollment.student_id=student.id
      JOIN academic_terms term ON term.id=enrollment.term_id
      WHERE student.id=${studentId}::uuid AND student.school_id=${school.id}::uuid AND student.school_id=${item.school_id}::uuid
        AND enrollment.class_section_id=${item.class_section_id}::uuid AND enrollment.term_id=${item.term_id}::uuid
        AND enrollment.is_active AND enrollment.enrolled_on<=${school.today}::date
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${school.today}::date)
        AND ${school.today}::date BETWEEN term.starts_on AND term.ends_on LIMIT 1`.execute(db)).rows[0];
    if (!student || !student.self && !student.guardian) throw new ForbiddenException("Only this learner or a current linked guardian may update their practice.");
    return student;
  }

  private async audience(db: Db, item: { school_id: string; class_section_id: string; term_id: string }, studentId?: string) {
    const school = await db.selectFrom("schools").select("timezone").where("id", "=", item.school_id).executeTakeFirstOrThrow();
    const today = localDate(school.timezone);
    return (await sql<{ id: string }>`SELECT DISTINCT account.id FROM (
      SELECT student.id AS student_id,student.user_id,'student'::text AS role FROM students student
      UNION ALL SELECT relationship.student_id,parent.user_id,'guardian'::text FROM guardian_relationships relationship
        JOIN parents parent ON parent.id=relationship.guardian_id WHERE relationship.school_id=${item.school_id}::uuid
      ) person JOIN students student ON student.id=person.student_id AND student.school_id=${item.school_id}::uuid
      JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.class_section_id=${item.class_section_id}::uuid
        AND enrollment.term_id=${item.term_id}::uuid AND enrollment.is_active AND enrollment.enrolled_on<=${today}::date
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${today}::date)
      JOIN academic_terms term ON term.id=enrollment.term_id AND term.school_id=student.school_id
        AND ${today}::date BETWEEN term.starts_on AND term.ends_on
      JOIN users account ON account.id=person.user_id AND account.is_active
      JOIN school_memberships membership ON membership.user_id=account.id AND membership.school_id=${item.school_id}::uuid AND membership.is_active AND membership.role=person.role
      WHERE (${studentId ?? null}::uuid IS NULL OR student.id=${studentId ?? null}::uuid)`.execute(db)).rows.map(row => row.id);
  }

  async authorizeLearnerSource(db:Transaction<Database>,user:AuthUser,id:string,studentId:string){
    practiceId.parse(id);
    const school=await this.school(db,user);
    const item=await db.selectFrom("diary_items").selectAll().where("id","=",id).where("school_id","=",school.id).where("published_at","<=",executionNow()).executeTakeFirst();
    if(!item)throw new NotFoundException("Diary item unavailable.");
    await this.learner(db,user,item,studentId);
    return item;
  }

  private async prepare(db: Transaction<Database>, user: AuthUser, item: { id: string; school_id: string; class_section_id: string; title: string },
    action: "publish" | "complete" | "reopen" | "note.add" | "note.reply", command: PracticeCommand, payload: unknown, authority: unknown[], creation = false) {
    const actor = await this.acting(db,user,item.school_id);
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const retained = await this.receipts.readDomainCommandReceipt(db, { school_id: item.school_id, actor_user_id: user.id, source_domain: "learning_diary",
      handler_key: "learning.class_practice", handler_version: 1, idempotency_key: `practice:${user.id}:${command.command_id}` });
    if (retained) {
      if (retained.actor_agent_id!==actor.agent_id || retained.command_type !== `learning.practice.${action}` || retained.target.domain !== "learning_diary" || retained.target.domain_id !== item.id
        || retained.target.kind !== "learning_work" || retained.expected_revision !== (creation ? 0 : 1) || retained.safe_context.payload_hash !== hash)
        throw new ConflictException("This practice command was already used for different work.");
      if (retained.state === "pending") throw new ConflictException("This action is still awaiting confirmation. Refresh its current source before retrying.");
      if (retained.receipt.terminal_state !== "accepted") throw new ConflictException("This practice action was not accepted. Review its current source.");
      return retained.receipt;
    }
    const prepared = await this.commands.prepareDomainCommand(db, { school_id: item.school_id, actor_user_id: user.id,
      command_type: `learning.practice.${action}`, handler_key: "learning.class_practice", handler_version: 1, source_domain: "learning_diary",
      target: { kind: "learning_work", domain: "learning_diary", domain_id: item.id, label: "Class practice", lifecycle_state: "active", source_revision: 1, metadata: {} },
      current_revision: creation ? 0 : 1, expected_revision: creation ? 0 : 1,
      capability: action === "publish" ? "learning.work.publish" : action === "note.reply" ? "messages.send" : "learning.practice.self",
      purpose: `practice_${action.replaceAll(".", "_")}`, requested_at: executionNow().toISOString(), correlation_id: command.command_id, causation_id: null,
      idempotency_key: `practice:${user.id}:${command.command_id}`, operating_rule_version_ref: null, configuration_refs: [],
      authority_attestation: { evaluator_domain: "learning_diary", decision: "allowed", reason_codes: [creation ? "current_class_learning_assignment" : "current_source_relationship"],
        authority_source_refs: authority, operating_rule_refs: [], valid_until: null },
      safe_context: { practice_id: item.id, class_section_id: item.class_section_id,
        payload_hash: hash } });
    if (prepared.status === "ready" && prepared.actor_agent_id !== actor.agent_id) throw new ForbiddenException("Your campus account link changed after this action began. Refresh before continuing.");
    return prepared;
  }

  private async finish(db: Transaction<Database>, schoolId: string, commandId: string, sourceId: string, metadata: Record<string, unknown>) {
    await this.commands.completeDomainCommand(db, { school_id: schoolId, command_id: commandId, terminal_state: "accepted", code: "practice_action_accepted",
      explanation: "The class practice action was accepted by its owning service.", resulting_revision: 1, domain_event_id: null,
      metadata: { practice_id: sourceId, ...metadata }, completed_at: executionNow().toISOString() });
  }

  private async emit(db: Transaction<Database>, item: { id: string; school_id: string; class_section_id: string; term_id: string; author_id: string;subject_id:string|null }, action: string, commandId: string, studentId?: string) {
    const school = await db.selectFrom("schools").select("timezone").where("id", "=", item.school_id).executeTakeFirstOrThrow();
    const today = localDate(school.timezone);
    const author = (await sql<{ id: string }>`SELECT binding.user_id AS id FROM staff_role_bindings binding
      JOIN users account ON account.id=binding.user_id AND account.is_active
      JOIN school_memberships membership ON membership.user_id=account.id AND membership.school_id=binding.school_id AND membership.is_active
      WHERE binding.school_id=${item.school_id}::uuid AND binding.user_id=${item.author_id}::uuid AND binding.context_kind='class'
        AND binding.scope_id=${item.class_section_id}::uuid AND binding.role_active AND binding.status='active'
        AND ${today}::date>=binding.starts_on AND (binding.ends_on IS NULL OR ${today}::date<=binding.ends_on)
        AND (binding.subject_id IS NULL OR binding.subject_id=${item.subject_id}::uuid)
        AND 'learning.work.publish'=ANY(binding.permissions)
        AND (${action !== "note_added" && action !== "replied"} OR EXISTS(SELECT 1 FROM staff_role_bindings messaging
          WHERE messaging.school_id=binding.school_id AND messaging.user_id=binding.user_id
            AND messaging.context_kind='class' AND messaging.scope_id=binding.scope_id
            AND messaging.role_active AND messaging.status='active' AND 'messages.send'=ANY(messaging.permissions)
            AND ${today}::date>=messaging.starts_on AND (messaging.ends_on IS NULL OR ${today}::date<=messaging.ends_on)
            AND (messaging.subject_id IS NULL OR messaging.subject_id=${item.subject_id}::uuid))) LIMIT 1`.execute(db)).rows.map(row => row.id);
    await this.events.enqueueUserEvent(db, { schoolId: item.school_id, eventType: "diary.updated", aggregateType: action === "completed" || action === "reopened" ? "homework_completion" : "class_practice", aggregateId: item.id,
      audienceUserIds: [...await this.audience(db, item, studentId), ...author],
      payload: { diary_item_id: item.id, class_section_id: item.class_section_id, ...(studentId ? { student_id: studentId } : {}), action, command_id: commandId,
        refresh: ["student.home", "student.diary", "parent.home", "parent.diary", "teacher.class_practice"] },
      idempotencyKey: `practice-event:${commandId}` });
  }

  async list(user: AuthUser, classId: string, pageValue?: string) {
    return this.db.transaction().execute(async db=>{
    const access = await this.teacher(db, user, classId), page = pageOf(pageValue);
    const terms = await db.selectFrom("academic_terms").select(["id", "name", "starts_on", "ends_on"])
      .where("school_id", "=", access.school.id).where("academic_year", "=", access.section.academic_year)
      .where("starts_on", "<=", access.school.today).where("ends_on", ">=", access.school.today).orderBy("starts_on", "desc").execute();
    const subjects = await db.selectFrom("subjects").select(["id", "name"]).where("school_id", "=", access.school.id).orderBy("name").execute();
    const items = await db.selectFrom("diary_items").select(["id", "date", "title", "body", "due_at", "published_at", "term_id", "subject_id"])
      .where("school_id", "=", access.school.id).where("class_section_id", "=", classId).where("author_id", "=", user.id)
      .where("item_type", "=", "homework").where("published_at", "<=", executionNow()).orderBy("published_at", "desc").orderBy("id").limit(11).offset((page - 1) * 10).execute();
    return { school_id: access.school.id, timezone: access.school.timezone, today: access.school.today,
      class_section: { id: classId, label: `Class ${access.section.grade}${access.section.section}` },
      terms, subjects: subjects.filter(subject => access.bindings.some(binding => !binding.subject_id || binding.subject_id === subject.id)),
      can_publish: true,can_publish_general:access.bindings.some(binding=>binding.subject_id===null), items: items.slice(0, 10).map(item => ({ ...item, revision: 1 })), page, has_more: items.length > 10 };
    });
  }

  async publish(user: AuthUser, body: unknown) {
    const data = publishPractice.parse(body);
    return this.db.transaction().execute(async db => {
      const access = await this.teacher(db, user, data.class_section_id, data.subject_id);
      if (!access.bindings.some(binding => data.date >= binding.starts_on && (!binding.ends_on || data.date <= binding.ends_on))) throw new ForbiddenException("The practice date is outside your class assignment.");
      const term = await db.selectFrom("academic_terms").select("id").where("school_id", "=", access.school.id).where("id", "=", data.term_id)
        .where("academic_year", "=", access.section.academic_year).where("starts_on", "<=", data.date).where("ends_on", ">=", data.date)
        .where("starts_on", "<=", access.school.today).where("ends_on", ">=", access.school.today).executeTakeFirst();
      if (!term) throw new BadRequestException("Choose this class's current term and a date within it.");
      if (data.subject_id && !await db.selectFrom("subjects").select("id").where("school_id", "=", access.school.id).where("id", "=", data.subject_id).executeTakeFirst()) throw new BadRequestException("Subject unavailable.");
      const source = { id: data.practice_id, school_id: access.school.id, class_section_id: data.class_section_id, title: data.title };
      const prepared = await this.prepare(db, user, source, "publish", data, data, access.bindings, true);
      if (prepared.status === "completed") return { id: source.id, revision: 1, replayed: true };
      if (data.due_at && new Date(data.due_at).getTime() < executionNow().getTime()) throw new BadRequestException("Choose a future due time for new practice.");
      if (await db.selectFrom("diary_items").select("id").where("id", "=", data.practice_id).executeTakeFirst()) throw new ConflictException("This practice identity is already in use. Open the existing item.");
      const item = await db.insertInto("diary_items").values({ id: data.practice_id, school_id: access.school.id, class_section_id: data.class_section_id,
        term_id: data.term_id, subject_id: data.subject_id, date: data.date, item_type: "homework", title: data.title, body: data.body,
        author_id: user.id, due_at: data.due_at ? new Date(data.due_at) : null, requires_acknowledgement: false, published_at: executionNow(), created_at: executionNow() }).returningAll().executeTakeFirstOrThrow();
      await this.emit(db, item, "published", prepared.command_id);
      await this.finish(db, access.school.id, prepared.command_id, item.id, {});
      return { id: item.id, revision: 1, replayed: false };
    });
  }

  async detail(user: AuthUser, id: string, classId: string, pageValue?: string, studentId?: string) {
    return this.db.transaction().execute(async db=>{
    const { item } = await this.source(db, user, id);
    const access = await this.teacher(db, user, classId, item.subject_id);
    if (item.class_section_id !== classId || item.author_id !== user.id) throw new ForbiddenException("Only the current authorized source author can open practice progress and private replies.");
    await this.currentTerm(db,item.term_id,item.school_id,access.school.today);
    const page = pageOf(pageValue);
    const rows = (await sql<{ id: string; name: string; completed_at: Date | null; total: number; completed_count: number }>`WITH roster AS (
      SELECT DISTINCT student.id,concat_ws(' ',person.first_name,person.last_name) AS name,completion.completed_at
      FROM students student JOIN school_people person ON person.id=student.person_id AND person.school_id=student.school_id
      JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.class_section_id=${classId}::uuid
        AND enrollment.term_id=${item.term_id}::uuid AND enrollment.is_active AND enrollment.enrolled_on<=${access.school.today}::date
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>${access.school.today}::date)
      LEFT JOIN homework_completions completion ON completion.item_id=${item.id}::uuid AND completion.student_id=student.id
      WHERE student.school_id=${item.school_id}::uuid)
      SELECT *,count(*) OVER()::int AS total,count(completed_at) OVER()::int AS completed_count FROM roster
      ORDER BY name,id LIMIT 20 OFFSET ${(page - 1) * 20}`.execute(db)).rows;
    if(page>1&&!rows.length)throw new BadRequestException("This learner page is unavailable. Return to the first page.");
    const canReply = (await sql<{ ok: boolean }>`SELECT EXISTS(SELECT 1 FROM staff_role_bindings binding
      WHERE binding.school_id=${item.school_id}::uuid AND binding.user_id=${user.id}::uuid AND binding.context_kind='class'
        AND binding.scope_id=${classId}::uuid AND binding.role_active AND binding.status='active'
        AND ${access.school.today}::date>=binding.starts_on AND (binding.ends_on IS NULL OR ${access.school.today}::date<=binding.ends_on)
        AND (binding.subject_id IS NULL OR binding.subject_id=${item.subject_id}::uuid)
        AND 'messages.send'=ANY(binding.permissions)) AS ok`.execute(db)).rows[0]?.ok ?? false;
    let thread: unknown[] | undefined;
    if (studentId) {
      practiceId.parse(studentId);
      if (!canReply) throw new ForbiddenException("Your current class messaging assignment is unavailable.");
      if (!await db.selectFrom("enrollments").select("id").where("student_id", "=", studentId).where("class_section_id", "=", classId).where("term_id", "=", item.term_id).where("is_active", "=", true)
        .where("enrolled_on", "<=", access.school.today).where(eb => eb.or([eb("inactive_from", "is", null), eb("inactive_from", ">", access.school.today)])).executeTakeFirst()) throw new NotFoundException("Learner unavailable in this class.");
      thread = await this.notes(db, item.id, studentId);
    }
    return { item: { ...item, revision: 1 }, progress: { items: rows.map(({ id, name, completed_at }) => ({ id, name, completed_at })), total: rows[0]?.total ?? 0,
      completed: rows[0]?.completed_count ?? 0, page }, can_reply: canReply, ...(thread ? { thread } : {}) };
    });
  }

  private async notes(db: Db, itemId: string, studentId: string) {
    const rows=await db.selectFrom("diary_notes as note").innerJoin("users as account", "account.id", "note.author_id")
      .select(["note.id", "note.body", "note.created_at", sql<string>`concat_ws(' ',account.first_name,account.last_name)`.as("author_name")])
      .where("note.item_id", "=", itemId).where("note.student_id", "=", studentId).orderBy("note.created_at","desc").orderBy("note.id","desc").limit(100).execute();
    return rows.reverse();
  }

  private async currentTerm(db:Db,termId:string,schoolId:string,today:string){
    if(!await db.selectFrom("academic_terms").select("id").where("id","=",termId).where("school_id","=",schoolId)
      .where("starts_on","<=",today).where("ends_on",">=",today).executeTakeFirst())throw new ForbiddenException("This practice is outside the current class term. Its retained record has not been changed.");
  }

  async note(user: AuthUser, id: string, body: unknown, teacherReply = false) {
    const data = practiceNote.parse(body);
    return this.db.transaction().execute(async db => {
      const { item } = await this.source(db, user, id);
      let authority: unknown[];
      if (teacherReply) {
        const access = await this.teacher(db, user, item.class_section_id, item.subject_id);
        await this.currentTerm(db,item.term_id,item.school_id,access.school.today);
        if (item.author_id !== user.id) throw new ForbiddenException("Only the authorized practice author may reply.");
        const messaging = (await sql<{ id: string }>`SELECT source_id AS id FROM staff_role_bindings WHERE school_id=${item.school_id}::uuid
          AND user_id=${user.id}::uuid AND context_kind='class' AND scope_id=${item.class_section_id}::uuid AND role_active AND status='active'
          AND ${access.school.today}::date>=starts_on AND (ends_on IS NULL OR ${access.school.today}::date<=ends_on)
          AND (subject_id IS NULL OR subject_id=${item.subject_id}::uuid)
          AND 'messages.send'=ANY(permissions) ORDER BY source_id`.execute(db)).rows;
        if (!messaging.length) throw new ForbiddenException("Your current class messaging assignment is unavailable.");
        const learner = await db.selectFrom("students").innerJoin("enrollments", "enrollments.student_id", "students.id").select("students.id")
          .where("students.id", "=", data.student_id).where("students.school_id", "=", item.school_id)
          .where("enrollments.class_section_id", "=", item.class_section_id).where("enrollments.term_id", "=", item.term_id).where("enrollments.is_active", "=", true)
          .where("enrollments.enrolled_on", "<=", access.school.today).where(eb => eb.or([eb("enrollments.inactive_from", "is", null), eb("enrollments.inactive_from", ">", access.school.today)])).executeTakeFirst();
        if (!learner) throw new NotFoundException("Learner unavailable in this class.");
        if (!await db.selectFrom("diary_notes").select("id").where("item_id", "=", id).where("student_id", "=", data.student_id).executeTakeFirst()) throw new BadRequestException("There is no private learner thread to reply to yet.");
        authority = [...access.bindings, ...messaging];
      } else authority = [await this.learner(db, user, item, data.student_id)];
      const prepared = await this.prepare(db, user, item, teacherReply ? "note.reply" : "note.add", data, data, authority);
      if (prepared.status === "completed") return { id: data.note_id, replayed: true };
      await db.insertInto("diary_notes").values({ id: data.note_id, item_id: id, student_id: data.student_id, author_id: user.id, body: data.body, created_at: executionNow() }).execute();
      await this.emit(db, item, teacherReply ? "replied" : "note_added", prepared.command_id, data.student_id);
      await this.finish(db, item.school_id, prepared.command_id, id, { note_id: data.note_id });
      return { id: data.note_id, replayed: false };
    });
  }

  async complete(user: AuthUser, id: string, body: unknown) {
    const data = practiceCompletion.parse(body);
    return this.db.transaction().execute(async db => {
      const { item } = await this.source(db, user, id);
      const relationship = await this.learner(db, user, item, data.student_id);
      const prepared = await this.prepare(db, user, item, data.completed ? "complete" : "reopen", data, data, [relationship]);
      if (prepared.status === "completed") return { item_id: id, student_id: data.student_id, completed: data.completed, replayed: true };
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`practice-completion:${item.school_id}:${id}:${data.student_id}`},0))`.execute(db);
      const changed = data.completed ? await db.insertInto("homework_completions").values({ item_id: id, student_id: data.student_id, completed_by: user.id, completed_at: executionNow() })
        .onConflict(conflict => conflict.columns(["item_id", "student_id"]).doNothing()).returning("item_id").executeTakeFirst()
        : await db.deleteFrom("homework_completions").where("item_id", "=", id).where("student_id", "=", data.student_id).returning("item_id").executeTakeFirst();
      if (changed) await this.emit(db, item, data.completed ? "completed" : "reopened", prepared.command_id, data.student_id);
      await this.finish(db, item.school_id, prepared.command_id, id, { student_id: data.student_id, completed: data.completed });
      return { item_id: id, student_id: data.student_id, completed: data.completed, replayed: false };
    });
  }

  legacyCommand(value?: unknown) { return value ? practiceCommand.parse(value) : { command_id: randomUUID() }; }
}
