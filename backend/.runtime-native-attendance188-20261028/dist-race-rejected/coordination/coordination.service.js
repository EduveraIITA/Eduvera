var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { findAcademicAttendanceDecision } from "../attendance/participation-continuity.js";
import { FollowupModelBridgeService, followupCoordinationSummary } from "./followup-model-bridge.service.js";
const contextSchema = z.enum(["staff", "guardian"]);
const message = z.string().trim().min(3).max(1000);
const createSchema = z.object({ student_id: z.string().uuid(), attendance_date: z.iso.date(), question: message,
    due_at: z.iso.datetime({ offset: true }), idempotency_key: z.string().uuid() }).strict();
const entrySchema = z.object({ context: contextSchema, kind: z.enum(["guardian_reply", "assisted_reply", "resolved"]),
    body: message, channel: z.enum(["app", "phone", "paper", "in_person"]).default("app"),
    guardian_id: z.string().uuid().optional(), observed_at: z.iso.datetime({ offset: true }).optional(),
    outcome: z.enum(["absence_explained", "record_corrected", "query_withdrawn"]).optional(),
    expected_revision: z.number().int().positive(), idempotency_key: z.string().uuid() }).strict();
export { createSchema, entrySchema };
let CoordinationService = class CoordinationService {
    db;
    events;
    model;
    constructor(db, events, model) {
        this.db = db;
        this.events = events;
        this.model = model;
    }
    async list(user, query) {
        const input = z.object({ context: contextSchema, student_id: z.string().uuid().optional(),
            state: z.enum(["open", "resolved"]).default("open"), cursor: z.string().max(200).optional() }).parse(query);
        let cursor = null;
        if (input.cursor) {
            try {
                cursor = z.object({ at: z.iso.datetime(), id: z.string().uuid() }).parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
            }
            catch {
                throw new BadRequestException("Invalid follow-up cursor.");
            }
        }
        const rows = (await sql `
      SELECT f.*, concat_ws(' ',u.first_name,u.last_name) AS student_name,
        concat_ws(' ',owner.first_name,owner.last_name) AS owner_name,
        (f.state<>'resolved' AND f.due_at<now()) AS overdue
      FROM attendance_followups f JOIN students s ON s.id=f.student_id
      JOIN school_people u ON u.id=s.person_id JOIN users owner ON owner.id=f.owner_user_id
      WHERE coordination_actor_authorized(f.school_id,f.student_id,${user.id}::uuid,${input.context})
        AND (${input.student_id ?? null}::uuid IS NULL OR f.student_id=${input.student_id ?? null}::uuid)
        AND ${input.state === "resolved" ? sql `f.state='resolved'` : sql `f.state<>'resolved'`}
        AND (${cursor?.id ?? null}::uuid IS NULL OR (f.created_at,f.id)<(${cursor?.at ?? null}::timestamptz,${cursor?.id ?? null}::uuid))
      ORDER BY f.created_at DESC,f.id DESC LIMIT 26
    `.execute(this.db)).rows;
        const results = rows.slice(0, 25);
        const last = results.at(-1);
        return { results, next_cursor: rows.length > 25 && last
                ? Buffer.from(JSON.stringify({ at: new Date(last.created_at).toISOString(), id: last.id })).toString("base64url") : null };
    }
    async authorize(db, user, studentId, context, lock = false) {
        const student = await db.selectFrom("students").select(["id", "school_id"]).where("id", "=", studentId).executeTakeFirst();
        if (!student)
            throw new NotFoundException("Follow-up not found.");
        if (lock) {
            await sql `SELECT id FROM users WHERE id=${user.id}::uuid FOR SHARE`.execute(db);
            await sql `SELECT id FROM school_memberships WHERE user_id=${user.id}::uuid AND school_id=${student.school_id}::uuid FOR SHARE`.execute(db);
            await sql `SELECT id FROM guardian_relationships WHERE student_id=${studentId}::uuid FOR SHARE`.execute(db);
            await sql `SELECT id FROM enrollments WHERE student_id=${studentId}::uuid FOR SHARE`.execute(db);
            await sql `SELECT t.id FROM timetable_slots t JOIN enrollments e ON e.class_section_id=t.class_section_id AND e.term_id=t.term_id
        WHERE e.student_id=${studentId}::uuid AND t.teacher_user_id=${user.id}::uuid FOR SHARE OF t`.execute(db);
        }
        const allowed = (await sql `SELECT coordination_actor_authorized(${student.school_id}::uuid,${studentId}::uuid,${user.id}::uuid,${context}) AS allowed`.execute(db)).rows[0]?.allowed;
        if (!allowed)
            throw new NotFoundException("Follow-up not found or no longer accessible.");
        return student;
    }
    async detail(user, id, contextValue) {
        const context = contextSchema.parse(contextValue);
        const row = (await sql `SELECT * FROM attendance_followups WHERE id=${z.string().uuid().parse(id)}::uuid`.execute(this.db)).rows[0];
        if (!row)
            throw new NotFoundException("Follow-up not found.");
        await this.authorize(this.db, user, row.student_id, context);
        const entries = (await sql `SELECT e.id,e.revision,e.kind,e.channel,e.body,e.observed_at,e.recorded_at,
      concat_ws(' ',u.first_name,u.last_name) AS actor_name,
      CASE WHEN p.id IS NOT NULL THEN concat_ws(' ',g.first_name,g.last_name) END AS guardian_name
      FROM attendance_followup_entries e JOIN users u ON u.id=e.actor_id
      LEFT JOIN parents p ON p.id=e.guardian_id
      LEFT JOIN guardian_school_profiles gp ON gp.guardian_id=p.id AND gp.school_id=${row.school_id}::uuid
      LEFT JOIN school_people g ON g.id=gp.person_id
      WHERE e.followup_id=${id}::uuid ORDER BY e.revision`.execute(this.db)).rows;
        const guardians = context === "staff" ? (await sql `SELECT p.id,concat_ws(' ',u.first_name,u.last_name) AS name
      FROM guardian_relationships g JOIN parents p ON p.id=g.guardian_id
      JOIN guardian_school_profiles gp ON gp.guardian_id=p.id AND gp.school_id=${row.school_id}::uuid
      JOIN school_people u ON u.id=gp.person_id
      WHERE g.student_id=${row.student_id}::uuid ORDER BY g.is_primary DESC,p.id`.execute(this.db)).rows : [];
        const canResolve = context === "staff" && (row.owner_user_id === user.id || Boolean(await this.db.selectFrom("school_memberships")
            .select("id").where("school_id", "=", row.school_id).where("user_id", "=", user.id)
            .where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst()));
        const receipt = (await sql `SELECT model_receipt FROM coordination_commands
      WHERE followup_id=${row.id}::uuid AND result_revision=${row.revision} ORDER BY created_at DESC LIMIT 1`.execute(this.db)).rows[0]?.model_receipt ?? null;
        return { ...row, entries, guardians, can_resolve: canResolve, coordination: followupCoordinationSummary(receipt) };
    }
    async priorCommand(db, actor, key, hash) {
        await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`coordination:${actor}:${key}`},0))`.execute(db);
        const prior = (await sql `SELECT * FROM coordination_commands
      WHERE actor_id=${actor}::uuid AND idempotency_key=${key}::uuid`.execute(db)).rows[0];
        if (prior && prior.request_hash !== hash)
            throw new ConflictException("This operation ID was already used with different details.");
        return prior ? { id: prior.followup_id, revision: prior.result_revision, coordination: followupCoordinationSummary(prior.model_receipt) } : null;
    }
    async commitEvent(db, row, req, key, hash, kind, prepared, previous, responseRecipient = null, channel = "app", observedAt = null) {
        await db.insertInto("audit_events").values({ action: `coordination.followup.${kind}`, actor_id: req.authUser.id,
            school_id: row.school_id, target_type: "attendance_followup", target_id: row.id, request_id: req.requestId,
            ip_hash: null, metadata: { revision: row.revision, state: row.state } }).execute();
        const audience = (await sql `SELECT DISTINCT m.user_id FROM school_memberships m
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
        const outbox = await db.insertInto("event_outbox").values({ school_id: row.school_id, event_type: `coordination.followup.${kind}`,
            aggregate_type: "attendance_followup", aggregate_id: row.id, audience_user_ids: [], payload: { followup_id: row.id, revision: row.revision, state: row.state },
            idempotency_key: `followup-typed:${row.id}:${row.revision}` }).returning("id").executeTakeFirstOrThrow();
        const recipients = kind === "opened" ? (await sql `SELECT DISTINCT parent.user_id FROM guardian_relationships relationship
      JOIN parents parent ON parent.id=relationship.guardian_id JOIN users account ON account.id=parent.user_id
      WHERE relationship.student_id=${row.student_id}::uuid AND account.is_active
        AND coordination_actor_authorized(${row.school_id}::uuid,${row.student_id}::uuid,parent.user_id,'guardian')`.execute(db)).rows.map(item => item.user_id)
            : row.state !== "resolved" && (await sql `SELECT coordination_actor_authorized(${row.school_id}::uuid,${row.student_id}::uuid,${row.owner_user_id}::uuid,'staff') AS allowed`.execute(db)).rows[0]?.allowed
                ? [row.owner_user_id] : [];
        const receipt = await this.model.accepted(db, req, row, prepared, { action: kind, key, outbox_id: outbox.id, previous,
            recipient_user_ids: recipients, response_recipient_user_id: responseRecipient, channel, observed_at: observedAt });
        await sql `INSERT INTO coordination_commands(actor_id,idempotency_key,request_hash,followup_id,result_revision,model_receipt)
      VALUES(${req.authUser.id}::uuid,${key}::uuid,${hash},${row.id}::uuid,${row.revision},${JSON.stringify(receipt)}::jsonb)`.execute(db);
        return { id: row.id, revision: row.revision, coordination: followupCoordinationSummary(receipt) };
    }
    async create(req, body) {
        const input = createSchema.parse(body);
        const hash = createHash("sha256").update(JSON.stringify({ action: "create", ...input })).digest("hex");
        return this.db.transaction().execute(async (db) => {
            const student = await this.authorize(db, req.authUser, input.student_id, "staff", true);
            const prior = await this.priorCommand(db, req.authUser.id, input.idempotency_key, hash);
            if (prior)
                return prior;
            const due = new Date(input.due_at);
            if (due.getTime() <= executionNow().getTime() || due.getTime() > executionNow().getTime() + 30 * 86400000)
                throw new BadRequestException("Choose a response deadline within the next 30 days.");
            const record = await findAcademicAttendanceDecision(db, { school_id: student.school_id, student_id: input.student_id, date: input.attendance_date });
            if (!record?.status || !["absent", "late", "half_day"].includes(record.status))
                throw new BadRequestException("A follow-up needs a recorded absence, late arrival, or half day. An unmarked register is not absence.");
            const duplicate = (await sql `SELECT id FROM attendance_followups WHERE school_id=${student.school_id}::uuid
        AND (attendance_record_id=${record.id}::uuid OR participation_entry_id=${record.id}::uuid) AND state<>'resolved'`.execute(db)).rows[0];
            if (duplicate)
                throw new ConflictException("An open follow-up already exists for this attendance record.");
            const id = randomUUID();
            const prepared = await this.model.prepare(db, req, { id, school_id: student.school_id, student_id: student.id,
                owner_user_id: req.authUser.id, revision: 0, state: "open" }, input.idempotency_key, hash, "opened", "staff", null);
            const row = (await sql `INSERT INTO attendance_followups(id,school_id,student_id,attendance_record_id,participation_entry_id,attendance_date,source_revision,question,owner_user_id,due_at)
        VALUES(${id}::uuid,${student.school_id}::uuid,${student.id}::uuid,${record.store === "legacy" ? record.id : null}::uuid,
          ${record.store === "participation" ? record.id : null}::uuid,${record.date}::date,${record.revision},${input.question},${req.authUser.id}::uuid,${due}) RETURNING *`.execute(db)).rows[0];
            await sql `INSERT INTO attendance_followup_entries(followup_id,revision,actor_id,kind,channel,body,observed_at)
        VALUES(${row.id}::uuid,1,${req.authUser.id}::uuid,'opened','app',${input.question},now())`.execute(db);
            return this.commitEvent(db, row, req, input.idempotency_key, hash, "opened", prepared, null);
        });
    }
    async respond(req, idValue, body) {
        const id = z.string().uuid().parse(idValue);
        const input = entrySchema.parse(body);
        if ((input.kind === "guardian_reply") !== (input.context === "guardian"))
            throw new ForbiddenException("This action is not available in the selected role.");
        if (input.kind !== "assisted_reply" && input.channel !== "app")
            throw new BadRequestException("Only assisted replies can use a non-app channel.");
        const hash = createHash("sha256").update(JSON.stringify({ id, ...input })).digest("hex");
        return this.db.transaction().execute(async (db) => {
            const row = (await sql `SELECT * FROM attendance_followups WHERE id=${id}::uuid FOR UPDATE`.execute(db)).rows[0];
            if (!row)
                throw new NotFoundException("Follow-up not found.");
            await this.authorize(db, req.authUser, row.student_id, input.context, true);
            const prior = await this.priorCommand(db, req.authUser.id, input.idempotency_key, hash);
            if (prior)
                return prior;
            if (row.revision !== input.expected_revision)
                throw new ConflictException("This follow-up has changed. Refresh before submitting.");
            if (row.state === "resolved")
                throw new ConflictException("This follow-up is already resolved.");
            const previous = (await sql `SELECT model_receipt FROM coordination_commands
        WHERE followup_id=${row.id}::uuid AND result_revision=${row.revision} ORDER BY created_at DESC LIMIT 1`.execute(db)).rows[0]?.model_receipt ?? null;
            let guardianId = null;
            let observedAt = executionNow();
            if (input.kind === "guardian_reply") {
                guardianId = (await db.selectFrom("parents").select("id").where("user_id", "=", req.authUser.id).executeTakeFirstOrThrow()).id;
            }
            else if (input.kind === "assisted_reply") {
                if (!input.guardian_id || !input.observed_at || input.channel === "app")
                    throw new BadRequestException("Choose the guardian, contact method, and when the response was received.");
                const link = await db.selectFrom("guardian_relationships").select("id").where("student_id", "=", row.student_id).where("guardian_id", "=", input.guardian_id).executeTakeFirst();
                if (!link)
                    throw new BadRequestException("Choose a guardian linked to this student.");
                guardianId = input.guardian_id;
                observedAt = new Date(input.observed_at);
                const clockSkewToleranceMs = 5000;
                if (observedAt.getTime() > executionNow().getTime() + clockSkewToleranceMs ||
                    observedAt.getTime() < new Date(row.created_at).getTime() - clockSkewToleranceMs)
                    throw new BadRequestException("Response time must fall between opening this follow-up and now.");
            }
            else {
                if (!input.outcome)
                    throw new BadRequestException("Choose a recorded outcome.");
                const ownerOrAdmin = row.owner_user_id === req.authUser.id || Boolean(await db.selectFrom("school_memberships").select("id").where("school_id", "=", row.school_id)
                    .where("user_id", "=", req.authUser.id).where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst());
                if (!ownerOrAdmin)
                    throw new ForbiddenException("The responsible teacher or school administrator must resolve this follow-up.");
                const attendance = await findAcademicAttendanceDecision(db, { school_id: row.school_id, student_id: row.student_id,
                    date: row.attendance_date, record_id: row.participation_entry_id ?? row.attendance_record_id });
                if (input.outcome === "record_corrected" && (!attendance || attendance.revision <= row.source_revision))
                    throw new ConflictException("Correct the attendance register first, then record this outcome.");
                if (input.outcome === "absence_explained" && row.state !== "in_review")
                    throw new ConflictException("Record a guardian response before marking the absence explained.");
            }
            const prepared = await this.model.prepare(db, req, row, input.idempotency_key, hash, input.kind, input.context, previous);
            const resolved = input.kind === "resolved";
            const updated = (await sql `UPDATE attendance_followups SET state=${resolved ? "resolved" : "in_review"},revision=revision+1,updated_at=now(),
        outcome=${resolved ? input.outcome : null},resolved_at=${resolved ? executionNow() : null},resolved_by=${resolved ? req.authUser.id : null}::uuid
        WHERE id=${id}::uuid RETURNING *`.execute(db)).rows[0];
            await sql `INSERT INTO attendance_followup_entries(followup_id,revision,actor_id,kind,channel,guardian_id,body,observed_at)
        VALUES(${id}::uuid,${updated.revision},${req.authUser.id}::uuid,${input.kind},${input.channel},${guardianId}::uuid,${input.body},${observedAt})`.execute(db);
            const responseRecipient = input.kind === "resolved" ? req.authUser.id : guardianId
                ? (await db.selectFrom("parents").select("user_id").where("id", "=", guardianId).executeTakeFirst())?.user_id ?? null : null;
            return this.commitEvent(db, updated, req, input.idempotency_key, hash, input.kind, prepared, previous, responseRecipient, input.channel, observedAt.toISOString());
        });
    }
};
CoordinationService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService, SchoolEventService,
        FollowupModelBridgeService])
], CoordinationService);
export { CoordinationService };
//# sourceMappingURL=coordination.service.js.map