import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { SchoolEventService } from "../school/school-event.service.js";

type Db = Kysely<Database> | Transaction<Database>;
const contextSchema = z.enum(["staff", "guardian"]);
const message = z.string().trim().min(3).max(1000);
const createSchema = z.object({ student_id: z.string().uuid(), attendance_date: z.iso.date(), question: message,
  due_at: z.iso.datetime({ offset: true }), idempotency_key: z.string().uuid() }).strict();
const entrySchema = z.object({ context: contextSchema, kind: z.enum(["guardian_reply", "assisted_reply", "resolved"]),
  body: message, channel: z.enum(["app", "phone", "paper", "in_person"]).default("app"),
  guardian_id: z.string().uuid().optional(), observed_at: z.iso.datetime({ offset: true }).optional(),
  outcome: z.enum(["absence_explained", "record_corrected", "query_withdrawn"]).optional(),
  expected_revision: z.number().int().positive(), idempotency_key: z.string().uuid() }).strict();
interface Followup {
  id: string; school_id: string; student_id: string; attendance_record_id: string; attendance_date: string;
  source_revision: number; question: string; owner_user_id: string; due_at: Date; state: string; revision: number;
  outcome: string | null; resolved_at: Date | null; created_at: Date; updated_at: Date;
}

@Injectable()
export class CoordinationService {
  constructor(private readonly db: DatabaseService, private readonly events: SchoolEventService) {}

  async list(user: AuthUser, query: Record<string, string>) {
    const input = z.object({ context: contextSchema, student_id: z.string().uuid().optional(),
      state: z.enum(["open", "resolved"]).default("open"), cursor: z.string().max(200).optional() }).parse(query);
    let cursor: { at: string; id: string } | null = null;
    if (input.cursor) {
      try { cursor = z.object({ at: z.iso.datetime(), id: z.string().uuid() }).parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString())); }
      catch { throw new BadRequestException("Invalid follow-up cursor."); }
    }
    const rows = (await sql<Followup & { student_name: string; owner_name: string; overdue: boolean }>`
      SELECT f.*, concat_ws(' ',u.first_name,u.last_name) AS student_name,
        concat_ws(' ',owner.first_name,owner.last_name) AS owner_name,
        (f.state<>'resolved' AND f.due_at<now()) AS overdue
      FROM attendance_followups f JOIN students s ON s.id=f.student_id
      JOIN school_people u ON u.id=s.person_id JOIN users owner ON owner.id=f.owner_user_id
      WHERE coordination_actor_authorized(f.school_id,f.student_id,${user.id}::uuid,${input.context})
        AND (${input.student_id ?? null}::uuid IS NULL OR f.student_id=${input.student_id ?? null}::uuid)
        AND ${input.state === "resolved" ? sql`f.state='resolved'` : sql`f.state<>'resolved'`}
        AND (${cursor?.id ?? null}::uuid IS NULL OR (f.created_at,f.id)<(${cursor?.at ?? null}::timestamptz,${cursor?.id ?? null}::uuid))
      ORDER BY f.created_at DESC,f.id DESC LIMIT 26
    `.execute(this.db)).rows;
    const results = rows.slice(0, 25);
    const last = results.at(-1);
    return { results, next_cursor: rows.length > 25 && last
      ? Buffer.from(JSON.stringify({ at: new Date(last.created_at).toISOString(), id: last.id })).toString("base64url") : null };
  }

  private async authorize(db: Db, user: AuthUser, studentId: string, context: string, lock = false) {
    const student = await db.selectFrom("students").select(["id", "school_id"]).where("id", "=", studentId).executeTakeFirst();
    if (!student) throw new NotFoundException("Follow-up not found.");
    if (lock) {
      await sql`SELECT id FROM users WHERE id=${user.id}::uuid FOR SHARE`.execute(db);
      await sql`SELECT id FROM school_memberships WHERE user_id=${user.id}::uuid AND school_id=${student.school_id}::uuid FOR SHARE`.execute(db);
      await sql`SELECT id FROM guardian_relationships WHERE student_id=${studentId}::uuid FOR SHARE`.execute(db);
      await sql`SELECT id FROM enrollments WHERE student_id=${studentId}::uuid FOR SHARE`.execute(db);
      await sql`SELECT t.id FROM timetable_slots t JOIN enrollments e ON e.class_section_id=t.class_section_id AND e.term_id=t.term_id
        WHERE e.student_id=${studentId}::uuid AND t.teacher_user_id=${user.id}::uuid FOR SHARE OF t`.execute(db);
    }
    const allowed = (await sql<{ allowed: boolean }>`SELECT coordination_actor_authorized(${student.school_id}::uuid,${studentId}::uuid,${user.id}::uuid,${context}) AS allowed`.execute(db)).rows[0]?.allowed;
    if (!allowed) throw new NotFoundException("Follow-up not found or no longer accessible.");
    return student;
  }

  async detail(user: AuthUser, id: string, contextValue?: string) {
    const context = contextSchema.parse(contextValue);
    const row = (await sql<Followup>`SELECT * FROM attendance_followups WHERE id=${z.string().uuid().parse(id)}::uuid`.execute(this.db)).rows[0];
    if (!row) throw new NotFoundException("Follow-up not found.");
    await this.authorize(this.db, user, row.student_id, context);
    const entries = (await sql`SELECT e.id,e.revision,e.kind,e.channel,e.body,e.observed_at,e.recorded_at,
      concat_ws(' ',u.first_name,u.last_name) AS actor_name,
      CASE WHEN p.id IS NOT NULL THEN concat_ws(' ',g.first_name,g.last_name) END AS guardian_name
      FROM attendance_followup_entries e JOIN users u ON u.id=e.actor_id
      LEFT JOIN parents p ON p.id=e.guardian_id
      LEFT JOIN guardian_school_profiles gp ON gp.guardian_id=p.id AND gp.school_id=${row.school_id}::uuid
      LEFT JOIN school_people g ON g.id=gp.person_id
      WHERE e.followup_id=${id}::uuid ORDER BY e.revision`.execute(this.db)).rows;
    const guardians = context === "staff" ? (await sql`SELECT p.id,concat_ws(' ',u.first_name,u.last_name) AS name
      FROM guardian_relationships g JOIN parents p ON p.id=g.guardian_id
      JOIN guardian_school_profiles gp ON gp.guardian_id=p.id AND gp.school_id=${row.school_id}::uuid
      JOIN school_people u ON u.id=gp.person_id
      WHERE g.student_id=${row.student_id}::uuid ORDER BY g.is_primary DESC,p.id`.execute(this.db)).rows : [];
    const canResolve = context === "staff" && (row.owner_user_id === user.id || Boolean(await this.db.selectFrom("school_memberships")
      .select("id").where("school_id", "=", row.school_id).where("user_id", "=", user.id)
      .where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst()));
    return { ...row, entries, guardians, can_resolve: canResolve };
  }

  private async priorCommand(db: Db, actor: string, key: string, hash: string) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`coordination:${actor}:${key}`},0))`.execute(db);
    const prior = (await sql<{ request_hash: string; followup_id: string; result_revision: number }>`SELECT * FROM coordination_commands
      WHERE actor_id=${actor}::uuid AND idempotency_key=${key}::uuid`.execute(db)).rows[0];
    if (prior && prior.request_hash !== hash) throw new ConflictException("This operation ID was already used with different details.");
    return prior ? { id: prior.followup_id, revision: prior.result_revision } : null;
  }

  private async commitEvent(db: Db, row: Followup, req: AuthenticatedRequest, key: string, hash: string, kind: string) {
    await sql`INSERT INTO coordination_commands(actor_id,idempotency_key,request_hash,followup_id,result_revision)
      VALUES(${req.authUser.id}::uuid,${key}::uuid,${hash},${row.id}::uuid,${row.revision})`.execute(db);
    await db.insertInto("audit_events").values({ action: `coordination.followup.${kind}`, actor_id: req.authUser.id,
      school_id: row.school_id, target_type: "attendance_followup", target_id: row.id, request_id: req.requestId,
      ip_hash: null, metadata: { revision: row.revision, state: row.state } }).execute();
    const audience = (await sql<{ user_id: string }>`SELECT DISTINCT m.user_id FROM school_memberships m
      WHERE m.school_id=${row.school_id}::uuid AND m.is_active AND (
        coordination_actor_authorized(m.school_id,${row.student_id}::uuid,m.user_id,'staff') OR
        coordination_actor_authorized(m.school_id,${row.student_id}::uuid,m.user_id,'guardian'))`.execute(db)).rows.map((r) => r.user_id);
    await this.events.enqueueUserEvent(db, { schoolId: row.school_id, eventType: "coordination.updated", aggregateType: "attendance_followup",
      aggregateId: row.id, audienceUserIds: audience, idempotencyKey: `followup:${row.id}:${row.revision}`,
      payload: {
        student_id: row.student_id,
        revision: row.revision,
        refresh: ["coordination", "parent.home", "teacher.home", "principal.home", "notifications"],
      } });
    return { id: row.id, revision: row.revision };
  }

  async create(req: AuthenticatedRequest, body: unknown) {
    const input = createSchema.parse(body);
    const hash = createHash("sha256").update(JSON.stringify({ action: "create", ...input })).digest("hex");
    return this.db.transaction().execute(async (db) => {
      const student = await this.authorize(db, req.authUser, input.student_id, "staff", true);
      const prior = await this.priorCommand(db, req.authUser.id, input.idempotency_key, hash);
      if (prior) return prior;
      const due = new Date(input.due_at);
      if (due.getTime() <= Date.now() || due.getTime() > Date.now() + 30 * 86400000) throw new BadRequestException("Choose a response deadline within the next 30 days.");
      const record = await db.selectFrom("attendance_records").selectAll().where("student_id", "=", input.student_id)
        .where("date", "=", input.attendance_date).forUpdate().executeTakeFirst();
      if (!record || !["absent", "late", "half_day"].includes(record.status)) throw new BadRequestException("A follow-up needs a recorded absence, late arrival, or half day. An unmarked register is not absence.");
      const duplicate = (await sql`SELECT id FROM attendance_followups WHERE attendance_record_id=${record.id}::uuid AND state<>'resolved'`.execute(db)).rows[0];
      if (duplicate) throw new ConflictException("An open follow-up already exists for this attendance record.");
      const row = (await sql<Followup>`INSERT INTO attendance_followups(school_id,student_id,attendance_record_id,attendance_date,source_revision,question,owner_user_id,due_at)
        VALUES(${student.school_id}::uuid,${student.id}::uuid,${record.id}::uuid,${record.date}::date,${record.revision},${input.question},${req.authUser.id}::uuid,${due}) RETURNING *`.execute(db)).rows[0]!;
      await sql`INSERT INTO attendance_followup_entries(followup_id,revision,actor_id,kind,channel,body,observed_at)
        VALUES(${row.id}::uuid,1,${req.authUser.id}::uuid,'opened','app',${input.question},now())`.execute(db);
      return this.commitEvent(db, row, req, input.idempotency_key, hash, "opened");
    });
  }

  async respond(req: AuthenticatedRequest, idValue: string, body: unknown) {
    const id = z.string().uuid().parse(idValue);
    const input = entrySchema.parse(body);
    if ((input.kind === "guardian_reply") !== (input.context === "guardian")) throw new ForbiddenException("This action is not available in the selected role.");
    if (input.kind !== "assisted_reply" && input.channel !== "app") throw new BadRequestException("Only assisted replies can use a non-app channel.");
    const hash = createHash("sha256").update(JSON.stringify({ id, ...input })).digest("hex");
    return this.db.transaction().execute(async (db) => {
      const row = (await sql<Followup>`SELECT * FROM attendance_followups WHERE id=${id}::uuid FOR UPDATE`.execute(db)).rows[0];
      if (!row) throw new NotFoundException("Follow-up not found.");
      await this.authorize(db, req.authUser, row.student_id, input.context, true);
      const prior = await this.priorCommand(db, req.authUser.id, input.idempotency_key, hash);
      if (prior) return prior;
      if (row.revision !== input.expected_revision) throw new ConflictException("This follow-up has changed. Refresh before submitting.");
      if (row.state === "resolved") throw new ConflictException("This follow-up is already resolved.");
      let guardianId: string | null = null;
      let observedAt = new Date();
      if (input.kind === "guardian_reply") {
        guardianId = (await db.selectFrom("parents").select("id").where("user_id", "=", req.authUser.id).executeTakeFirstOrThrow()).id;
      } else if (input.kind === "assisted_reply") {
        if (!input.guardian_id || !input.observed_at || input.channel === "app") throw new BadRequestException("Choose the guardian, contact method, and when the response was received.");
        const link = await db.selectFrom("guardian_relationships").select("id").where("student_id", "=", row.student_id).where("guardian_id", "=", input.guardian_id).executeTakeFirst();
        if (!link) throw new BadRequestException("Choose a guardian linked to this student.");
        guardianId = input.guardian_id;
        observedAt = new Date(input.observed_at);
        if (observedAt.getTime() > Date.now() || observedAt < new Date(row.created_at)) throw new BadRequestException("Response time must fall between opening this follow-up and now.");
      } else {
        if (!input.outcome) throw new BadRequestException("Choose a recorded outcome.");
        const ownerOrAdmin = row.owner_user_id === req.authUser.id || Boolean(await db.selectFrom("school_memberships").select("id").where("school_id", "=", row.school_id)
          .where("user_id", "=", req.authUser.id).where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst());
        if (!ownerOrAdmin) throw new ForbiddenException("The responsible teacher or school administrator must resolve this follow-up.");
        const attendance = await db.selectFrom("attendance_records").select(["revision", "status"]).where("id", "=", row.attendance_record_id).forShare().executeTakeFirstOrThrow();
        if (input.outcome === "record_corrected" && attendance.revision <= row.source_revision) throw new ConflictException("Correct the attendance register first, then record this outcome.");
        if (input.outcome === "absence_explained" && row.state !== "in_review") throw new ConflictException("Record a guardian response before marking the absence explained.");
      }
      const resolved = input.kind === "resolved";
      const updated = (await sql<Followup>`UPDATE attendance_followups SET state=${resolved ? "resolved" : "in_review"},revision=revision+1,updated_at=now(),
        outcome=${resolved ? input.outcome! : null},resolved_at=${resolved ? new Date() : null},resolved_by=${resolved ? req.authUser.id : null}::uuid
        WHERE id=${id}::uuid RETURNING *`.execute(db)).rows[0]!;
      await sql`INSERT INTO attendance_followup_entries(followup_id,revision,actor_id,kind,channel,guardian_id,body,observed_at)
        VALUES(${id}::uuid,${updated.revision},${req.authUser.id}::uuid,${input.kind},${input.channel},${guardianId}::uuid,${input.body},${observedAt})`.execute(db);
      return this.commitEvent(db, updated, req, input.idempotency_key, hash, input.kind);
    });
  }
}
