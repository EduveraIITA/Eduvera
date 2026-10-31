var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Post, Param, Req, Module, ForbiddenException, ConflictException, HttpCode } from "@nestjs/common";
import { z } from "zod";
import { sql } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import { operatingRules, rulesSchema } from "./rules.js";
import { readChatPolicy } from "../chat/chat-policy.js";
const categorySchema = z.enum(["events", "departure", "messages"]);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const eventCategorySchema = z.object({
    expected_workflow_revision: z.number().int().min(0),
    expected_domain_revision: z.number().int().min(0),
    event_entry_hours_before: z.number().int().min(0).max(168),
    event_staff_hours_after: z.number().int().min(0).max(720),
    observation_hours_before: z.number().int().min(0).max(168),
    observation_hours_after: z.number().int().min(0).max(168),
}).strict();
const departureCategorySchema = z.object({
    expected_workflow_revision: z.number().int().min(0),
    expected_domain_revision: z.number().int().min(0),
    journey_lead_minutes: z.number().int().min(0).max(240),
    enabled: z.boolean(),
    enabled_modes: z.array(z.enum(["guardian_pickup", "authorized_collector", "independent_departure", "school_transport", "external_transport"])).min(1),
    change_cutoff: timeSchema,
    location_retention_hours: z.number().int().min(1).max(168),
    location_stale_seconds: z.number().int().min(30).max(600),
}).strict();
const messageCategorySchema = z.object({
    expected_workflow_revision: z.number().int().min(0),
    expected_domain_revision: z.number().int().min(0),
    message_edit_minutes: z.number().int().min(0).max(60),
    message_attachment_mb: z.number().int().min(1).max(10),
    student_teacher_direct_enabled: z.boolean(),
    guardian_teacher_direct_enabled: z.boolean(),
    student_group_replies: z.boolean(),
    guardian_group_replies: z.boolean(),
    attachments_enabled: z.boolean(),
    enforce_communication_hours: z.boolean(),
    communication_start: timeSchema,
    communication_end: timeSchema,
}).strict();
let OperatingRulesController = class OperatingRulesController {
    db;
    constructor(db) {
        this.db = db;
    }
    async enqueueUpdate(db, schoolId, category, revision, domainRevision) {
        const refresh = category === "events"
            ? ["principal.administration", "campus-events", "teacher.home", "principal.home"]
            : category === "departure"
                ? ["principal.administration", "departure", "student.home", "parent.home", "teacher.home", "principal.home", "campus-view"]
                : category === "messages"
                    ? ["principal.administration", "messages", "student.home", "parent.home", "teacher.home", "principal.home"]
                    : [
                        "principal.administration", "student.home", "student.attendance", "student.eligibility",
                        "parent.home", "parent.attendance", "teacher.home", "teacher.attendance", "principal.home",
                        "principal.attendance", "principal.attendance-history", "attendance-model",
                        "attendance-continuity", "campus-view",
                    ];
        const payload = {
            action: "operating_rules_updated",
            category,
            revision,
            ...(domainRevision === undefined ? {} : { domain_revision: domainRevision }),
            refresh,
        };
        const audience = await sql `SELECT membership.user_id
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.is_active
        AND event_user_is_authorized(
          ${schoolId}::uuid,
          'administration.updated',
          ${JSON.stringify(payload)}::jsonb,
          membership.user_id
        )`.execute(db);
        await db.insertInto("event_outbox").values({
            school_id: schoolId,
            event_type: "administration.updated",
            aggregate_type: "operating_rules",
            aggregate_id: schoolId,
            audience_user_ids: audience.rows.map((row) => row.user_id),
            payload,
            idempotency_key: `operating-rules:${schoolId}:${category}:${revision}:${domainRevision ?? "workflow"}`,
            notification_user_ids: [],
            notification_payload: null,
        }).execute();
    }
    async authorize(db, user, schoolId) {
        if (user.active_school_id && user.active_school_id !== schoolId)
            throw new ForbiddenException("Switch to this institution first.");
        const rows = await sql `SELECT m.user_id FROM school_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.school_id=${schoolId}::uuid AND m.user_id=${user.id}::uuid AND m.role='admin' AND m.is_active AND u.is_active
      FOR SHARE OF m,u`.execute(db);
        if (!rows.rows.length)
            throw new ForbiddenException("Only an active institution administrator can change operating rules.");
    }
    async get(req, value) {
        const schoolId = z.uuid().parse(value);
        await this.authorize(this.db, req.authUser, schoolId);
        return operatingRules(this.db, schoolId);
    }
    async categoryState(db, schoolId, category) {
        const workflow = await operatingRules(db, schoolId);
        if (category === "events") {
            const domain = (await sql `
        SELECT observation_hours_before,observation_hours_after,revision
        FROM campus_event_attendance_policies WHERE school_id=${schoolId}::uuid
      `.execute(db)).rows[0] ?? { observation_hours_before: 2, observation_hours_after: 4, revision: 0 };
            return { category, workflow, domain };
        }
        if (category === "departure") {
            const domain = (await sql `
        SELECT enabled,enabled_modes,to_char(change_cutoff,'HH24:MI') change_cutoff,
          location_retention_hours,location_stale_seconds,revision
        FROM departure_policies WHERE school_id=${schoolId}::uuid
      `.execute(db)).rows[0] ?? { enabled: true, enabled_modes: ["guardian_pickup", "authorized_collector", "independent_departure", "school_transport", "external_transport"], change_cutoff: "13:00", location_retention_hours: 24, location_stale_seconds: 90, revision: 0 };
            return { category, workflow, domain };
        }
        const domain = await readChatPolicy(db, schoolId);
        return { category, workflow, domain };
    }
    async getCategory(req, value, categoryValue) {
        const schoolId = z.uuid().parse(value);
        const category = categorySchema.parse(categoryValue);
        await this.authorize(this.db, req.authUser, schoolId);
        return this.categoryState(this.db, schoolId, category);
    }
    async saveCategory(req, value, categoryValue) {
        const schoolId = z.uuid().parse(value);
        const category = categorySchema.parse(categoryValue);
        const input = category === "events" ? eventCategorySchema.parse(req.body)
            : category === "departure" ? departureCategorySchema.parse(req.body)
                : messageCategorySchema.parse(req.body);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, req.authUser, schoolId);
            await sql `SELECT id FROM schools WHERE id=${schoolId}::uuid FOR UPDATE`.execute(db);
            if (category === "departure") {
                await sql `SELECT pg_advisory_xact_lock(hashtextextended(${`departure:${schoolId}`},0))`.execute(db);
                await sql `SELECT school_id FROM departure_policies WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(db);
            }
            else if (category === "events") {
                await sql `SELECT school_id FROM campus_event_attendance_policies WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(db);
            }
            else {
                await sql `SELECT school_id FROM chat_policies WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(db);
            }
            const before = await this.categoryState(db, schoolId, category);
            if (before.workflow.revision !== input.expected_workflow_revision || before.domain.revision !== input.expected_domain_revision) {
                throw new ConflictException("These operating rules changed. Reload before saving.");
            }
            const workflow = { ...before.workflow };
            if (category === "events") {
                const data = input;
                workflow.event_entry_hours_before = data.event_entry_hours_before;
                workflow.event_staff_hours_after = data.event_staff_hours_after;
                await sql `INSERT INTO campus_event_attendance_policies(school_id,observation_hours_before,observation_hours_after,updated_by)
          VALUES(${schoolId}::uuid,${data.observation_hours_before},${data.observation_hours_after},${req.authUser.id}::uuid)
          ON CONFLICT(school_id) DO UPDATE SET observation_hours_before=excluded.observation_hours_before,
          observation_hours_after=excluded.observation_hours_after,updated_by=excluded.updated_by,
          updated_at=now(),revision=campus_event_attendance_policies.revision+1`.execute(db);
            }
            else if (category === "departure") {
                const data = input;
                workflow.journey_lead_minutes = data.journey_lead_minutes;
                await sql `INSERT INTO departure_policies(school_id,enabled,enabled_modes,change_cutoff,location_retention_hours,location_stale_seconds,updated_by)
          VALUES(${schoolId}::uuid,${data.enabled},${data.enabled_modes}::text[],${data.change_cutoff}::time,${data.location_retention_hours},${data.location_stale_seconds},${req.authUser.id}::uuid)
          ON CONFLICT(school_id) DO UPDATE SET enabled=excluded.enabled,enabled_modes=excluded.enabled_modes,
          change_cutoff=excluded.change_cutoff,location_retention_hours=excluded.location_retention_hours,
          location_stale_seconds=excluded.location_stale_seconds,updated_by=excluded.updated_by,
          updated_at=now(),revision=departure_policies.revision+1`.execute(db);
            }
            else {
                const data = input;
                workflow.message_edit_minutes = data.message_edit_minutes;
                workflow.message_attachment_mb = data.message_attachment_mb;
                await sql `INSERT INTO chat_policies(school_id,student_teacher_direct_enabled,guardian_teacher_direct_enabled,
          student_group_replies,guardian_group_replies,attachments_enabled,enforce_communication_hours,
          communication_start,communication_end,updated_by)
          VALUES(${schoolId}::uuid,${data.student_teacher_direct_enabled},${data.guardian_teacher_direct_enabled},
          ${data.student_group_replies},${data.guardian_group_replies},${data.attachments_enabled},${data.enforce_communication_hours},
          ${data.communication_start}::time,${data.communication_end}::time,${req.authUser.id}::uuid)
          ON CONFLICT(school_id) DO UPDATE SET student_teacher_direct_enabled=excluded.student_teacher_direct_enabled,
          guardian_teacher_direct_enabled=excluded.guardian_teacher_direct_enabled,student_group_replies=excluded.student_group_replies,
          guardian_group_replies=excluded.guardian_group_replies,attachments_enabled=excluded.attachments_enabled,
          enforce_communication_hours=excluded.enforce_communication_hours,communication_start=excluded.communication_start,
          communication_end=excluded.communication_end,updated_by=excluded.updated_by,
          updated_at=now(),revision=chat_policies.revision+1`.execute(db);
            }
            await sql `INSERT INTO institution_operating_rules(school_id,attendance_finalization_mode,attendance_auto_finalize_minutes,attendance_overdue_reminder_minutes,attendance_overdue_escalation_minutes,event_entry_hours_before,event_staff_hours_after,journey_lead_minutes,message_edit_minutes,message_attachment_mb,updated_by)
        VALUES(${schoolId}::uuid,${workflow.attendance_finalization_mode},${workflow.attendance_auto_finalize_minutes},${workflow.attendance_overdue_reminder_minutes},${workflow.attendance_overdue_escalation_minutes},${workflow.event_entry_hours_before},${workflow.event_staff_hours_after},${workflow.journey_lead_minutes},${workflow.message_edit_minutes},${workflow.message_attachment_mb},${req.authUser.id}::uuid)
        ON CONFLICT(school_id) DO UPDATE SET attendance_finalization_mode=excluded.attendance_finalization_mode,attendance_auto_finalize_minutes=excluded.attendance_auto_finalize_minutes,attendance_overdue_reminder_minutes=excluded.attendance_overdue_reminder_minutes,attendance_overdue_escalation_minutes=excluded.attendance_overdue_escalation_minutes,event_entry_hours_before=excluded.event_entry_hours_before,event_staff_hours_after=excluded.event_staff_hours_after,
        journey_lead_minutes=excluded.journey_lead_minutes,message_edit_minutes=excluded.message_edit_minutes,message_attachment_mb=excluded.message_attachment_mb,
        updated_by=excluded.updated_by,updated_at=now(),revision=institution_operating_rules.revision+1`.execute(db);
            const after = await this.categoryState(db, schoolId, category);
            await db.insertInto("audit_events").values({ actor_id: req.authUser.id, school_id: schoolId, action: `operating_rules.${category}.updated`, target_type: "school", target_id: schoolId, request_id: req.requestId, ip_hash: null, metadata: { before, after } }).execute();
            await this.enqueueUpdate(db, schoolId, category, after.workflow.revision, after.domain.revision);
            return after;
        });
    }
    async save(req, value) {
        const schoolId = z.uuid().parse(value);
        const input = rulesSchema.extend({ expected_revision: z.number().int().min(0) }).strict().parse(req.body);
        return this.db.transaction().execute(async (db) => {
            await this.authorize(db, req.authUser, schoolId);
            await sql `SELECT id FROM schools WHERE id=${schoolId}::uuid FOR UPDATE`.execute(db);
            const before = await operatingRules(db, schoolId);
            if (before.revision !== input.expected_revision)
                throw new ConflictException("Operating rules changed. Reload before saving.");
            await sql `INSERT INTO institution_operating_rules(school_id,attendance_academic_mode,attendance_campus_mode,attendance_academic_channels,attendance_campus_channels,attendance_self_check_in_mode,attendance_session_open_before_minutes,attendance_session_close_after_minutes,attendance_finalization_mode,attendance_auto_finalize_minutes,attendance_overdue_reminder_minutes,attendance_overdue_escalation_minutes,event_entry_hours_before,event_staff_hours_after,journey_lead_minutes,message_edit_minutes,message_attachment_mb,updated_by)
        VALUES(${schoolId}::uuid,${input.attendance_academic_mode},${input.attendance_campus_mode},${input.attendance_academic_channels}::text[],${input.attendance_campus_channels}::text[],${input.attendance_self_check_in_mode},${input.attendance_session_open_before_minutes},${input.attendance_session_close_after_minutes},${input.attendance_finalization_mode},${input.attendance_auto_finalize_minutes},${input.attendance_overdue_reminder_minutes},${input.attendance_overdue_escalation_minutes},${input.event_entry_hours_before},${input.event_staff_hours_after},${input.journey_lead_minutes},${input.message_edit_minutes},${input.message_attachment_mb},${req.authUser.id}::uuid)
        ON CONFLICT(school_id) DO UPDATE SET attendance_academic_mode=excluded.attendance_academic_mode,attendance_campus_mode=excluded.attendance_campus_mode,attendance_academic_channels=excluded.attendance_academic_channels,attendance_campus_channels=excluded.attendance_campus_channels,attendance_self_check_in_mode=excluded.attendance_self_check_in_mode,attendance_session_open_before_minutes=excluded.attendance_session_open_before_minutes,attendance_session_close_after_minutes=excluded.attendance_session_close_after_minutes,attendance_finalization_mode=excluded.attendance_finalization_mode,attendance_auto_finalize_minutes=excluded.attendance_auto_finalize_minutes,attendance_overdue_reminder_minutes=excluded.attendance_overdue_reminder_minutes,attendance_overdue_escalation_minutes=excluded.attendance_overdue_escalation_minutes,event_entry_hours_before=excluded.event_entry_hours_before,event_staff_hours_after=excluded.event_staff_hours_after,
        journey_lead_minutes=excluded.journey_lead_minutes,message_edit_minutes=excluded.message_edit_minutes,message_attachment_mb=excluded.message_attachment_mb,
        updated_by=excluded.updated_by,updated_at=now(),revision=institution_operating_rules.revision+1`.execute(db);
            await sql `UPDATE schools SET attendance_submission_cutoff=${input.attendance_submission_cutoff}::time WHERE id=${schoolId}::uuid`.execute(db);
            const after = await operatingRules(db, schoolId);
            await db.insertInto("audit_events").values({ actor_id: req.authUser.id, school_id: schoolId, action: "operating_rules.updated", target_type: "school", target_id: schoolId, request_id: req.requestId, ip_hash: null, metadata: { before, after } }).execute();
            await this.enqueueUpdate(db, schoolId, "attendance", after.revision);
            return after;
        });
    }
};
__decorate([
    Get(":schoolId"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], OperatingRulesController.prototype, "get", null);
__decorate([
    Get(":schoolId/categories/:category"),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("category")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], OperatingRulesController.prototype, "getCategory", null);
__decorate([
    Post(":schoolId/categories/:category"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __param(2, Param("category")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], OperatingRulesController.prototype, "saveCategory", null);
__decorate([
    Post(":schoolId"),
    HttpCode(200),
    __param(0, Req()),
    __param(1, Param("schoolId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], OperatingRulesController.prototype, "save", null);
OperatingRulesController = __decorate([
    Controller("api/v1/operating-rules"),
    __metadata("design:paramtypes", [DatabaseService])
], OperatingRulesController);
export { OperatingRulesController };
let OperatingRulesModule = class OperatingRulesModule {
};
OperatingRulesModule = __decorate([
    Module({ controllers: [OperatingRulesController] })
], OperatingRulesModule);
export { OperatingRulesModule };
//# sourceMappingURL=operating-rules.module.js.map