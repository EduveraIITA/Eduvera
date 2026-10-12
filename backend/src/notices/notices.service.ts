import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { SchoolEventService } from "../school/school-event.service.js";
import {
  assistedResponseSchema,
  cancelNoticeSchema,
  createNoticeSchema,
  deliveryAttemptSchema,
  noticePortalSchema,
  publishNoticeSchema,
  respondNoticeSchema,
  updateNoticeSchema,
  type NoticeAudienceInput,
  type NoticePortal,
} from "./notices.schemas.js";

type Db = Kysely<Database> | Transaction<Database>;
type NoticeStatus = "draft" | "published" | "cancelled";
type MembershipRole = "guardian" | "staff" | "admin";

interface NoticeRow {
  id: string;
  school_id: string;
  title: string;
  body: string;
  response_mode: "information" | "acknowledgement" | "choice";
  response_options: string[];
  priority: "urgent" | "high" | "normal";
  due_at: Date | null;
  status: NoticeStatus;
  revision: number;
  created_by: string;
  published_by: string | null;
  published_at: Date | null;
  cancelled_by: string | null;
  cancelled_at: Date | null;
  cancellation_reason: string;
  created_at: Date;
  updated_at: Date;
}

interface RecipientRow {
  id: string;
  school_id: string;
  notice_id: string;
  recipient_key: string;
  recipient_role: "guardian" | "staff" | "admin";
  user_id: string | null;
  guardian_id: string | null;
  student_id: string | null;
  recipient_name: string;
  contact_phone: string;
  contact_email: string;
  opened_at: Date | null;
  responded_at: Date | null;
  response_value: string | null;
  response_note: string;
  response_channel: "app" | "sms" | "paper" | "phone" | "in_person" | null;
  response_observed_at: Date | null;
  response_recorded_by: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

interface ActorScope {
  school_id: string;
  role: MembershipRole;
  guardian_id: string | null;
  student_id: string | null;
}

interface CommandRow { request_hash: string; result: unknown }
interface NoticeMutationResult { id: string; revision: number; status: NoticeStatus }
interface PublishResult extends NoticeMutationResult { recipient_count: number }
interface ResponseResult { id: string; recipient_id: string; recipient_revision: number; response_value: string | null }
interface DeliveryResult { id: string; recipient_id: string; delivery_attempt_id: string; status: string }

const listQuerySchema = z.object({
  portal: noticePortalSchema,
  school_id: z.string().uuid().optional(),
  student_id: z.string().uuid().optional(),
  status: z.enum(["draft", "published", "cancelled"]).optional(),
}).strict();

const detailQuerySchema = z.object({
  portal: noticePortalSchema,
  student_id: z.string().uuid().optional(),
}).strict();

@Injectable()
export class NoticesService {
  constructor(private readonly db: DatabaseService, private readonly events: SchoolEventService) {}

  async references(user: AuthUser, rawQuery: Record<string, string | undefined>) {
    const query = z.object({ portal: z.enum(["teacher", "principal"]), school_id: z.string().uuid().optional() }).strict().parse(rawQuery);
    const scope = await this.actorScope(this.db, user, query.portal, query.school_id);
    const rows = query.portal === "principal" ? (await sql<{ id: string; name: string }>`
      SELECT section.id,concat('Class ',section.grade,section.section) AS name
      FROM class_sections section WHERE section.school_id=${scope.school_id}::uuid
      ORDER BY section.academic_year DESC,section.grade,section.section,section.id
    `.execute(this.db)).rows : (await sql<{ id: string; name: string }>`
      SELECT section.id,concat('Class ',section.grade,section.section) AS name
      FROM class_sections section WHERE section.school_id=${scope.school_id}::uuid
        AND staff_has_class_permission(section.school_id,${user.id}::uuid,'messages.send',section.id)
      ORDER BY section.academic_year DESC,section.grade,section.section,section.id
    `.execute(this.db)).rows;
    return { school_id: scope.school_id, classes: rows };
  }

  async list(user: AuthUser, rawQuery: Record<string, string | undefined>) {
    const query = listQuerySchema.parse(rawQuery);
    const scope = await this.actorScope(this.db, user, query.portal, query.school_id, query.student_id);
    const rows = query.portal === "parent"
      ? await this.familyList(user, scope, query.status)
      : await this.staffList(user, scope, query.portal, query.status);
    return { portal: query.portal, school_id: scope.school_id, student_id: scope.student_id, results: rows };
  }

  async detail(user: AuthUser, idValue: string, rawQuery: Record<string, string | undefined>) {
    const id = z.string().uuid().parse(idValue);
    const query = detailQuerySchema.parse(rawQuery);
    const notice = await this.notice(this.db, id);
    const scope = await this.actorScope(this.db, user, query.portal, notice.school_id, query.student_id);
    const manager = query.portal === "principal" || (query.portal === "teacher" && notice.created_by === user.id);
    if (manager) {
      const [audiences, recipients, audits] = await Promise.all([
        this.audiences(this.db, notice.id),
        this.managerRecipients(this.db, notice.id),
        this.noticeAudits(this.db, notice.id),
      ]);
      return { ...notice, can_manage: true as const, audiences, recipients,
        self_recipient: recipients.find((recipient) => recipient.user_id === user.id) ?? null,
        audits, metrics: this.metrics(recipients) };
    }
    const recipients = await this.accessibleRecipients(this.db, user, scope, notice.id, false);
    if (!recipients.length) throw new NotFoundException("Notice not found.");
    const recipient = this.selectRecipient(recipients, scope.student_id);
    const deliveries = await this.deliveryHistory(this.db, recipient.id);
    return { ...notice, can_manage: false as const, audiences: [], recipient: { ...recipient, deliveries } };
  }

  async create(request: AuthenticatedRequest, body: unknown) {
    const input = createNoticeSchema.parse(body);
    this.validateDeadline(input);
    const hash = this.hash({ operation: "create", ...input });
    return this.db.transaction().execute(async (db) => {
      const role = await this.manageRole(db, request.authUser, input.school_id);
      await this.authorizeAudiences(db, request.authUser.id, input.school_id, role, input.audiences);
      const prior = await this.priorCommand<NoticeMutationResult>(db, request.authUser.id, input.idempotency_key, hash);
      if (prior) return prior;
      const notice = (await sql<NoticeRow>`
        INSERT INTO school_notices(school_id,title,body,response_mode,response_options,priority,due_at,created_by)
        VALUES(${input.school_id}::uuid,${input.title},${input.body},${input.response_mode},
          ${JSON.stringify(input.response_options)}::jsonb,${input.priority},${input.due_at ? new Date(input.due_at) : null},${request.authUser.id}::uuid)
        RETURNING *
      `.execute(db)).rows[0]!;
      await this.replaceAudiences(db, notice, input.audiences);
      await this.recordAudit(db, request, notice, "draft_created", null, "draft", null, { audience_count: input.audiences.length });
      const result = { id: notice.id, revision: notice.revision, status: notice.status };
      await this.saveCommand(db, notice, request.authUser.id, input.idempotency_key, hash, "create", result);
      return result;
    });
  }

  async update(request: AuthenticatedRequest, idValue: string, body: unknown) {
    const id = z.string().uuid().parse(idValue);
    const input = updateNoticeSchema.parse(body);
    this.validateDeadline(input);
    const hash = this.hash({ operation: "update", id, ...input });
    return this.db.transaction().execute(async (db) => {
      const notice = await this.lockNotice(db, id);
      const role = await this.assertManager(db, request.authUser, notice);
      await this.authorizeAudiences(db, request.authUser.id, notice.school_id, role, input.audiences);
      const prior = await this.priorCommand<NoticeMutationResult>(db, request.authUser.id, input.idempotency_key, hash);
      if (prior) return prior;
      if (notice.status !== "draft") throw new ConflictException("Only a draft notice can be edited.");
      this.assertRevision(notice.revision, input.expected_revision);
      const updated = (await sql<NoticeRow>`
        UPDATE school_notices SET title=${input.title},body=${input.body},response_mode=${input.response_mode},
          response_options=${JSON.stringify(input.response_options)}::jsonb,priority=${input.priority},
          due_at=${input.due_at ? new Date(input.due_at) : null},revision=revision+1,updated_at=now()
        WHERE id=${id}::uuid RETURNING *
      `.execute(db)).rows[0]!;
      await this.replaceAudiences(db, updated, input.audiences);
      await this.recordAudit(db, request, updated, "draft_updated", "draft", "draft", null, { audience_count: input.audiences.length });
      const result = { id: updated.id, revision: updated.revision, status: updated.status };
      await this.saveCommand(db, updated, request.authUser.id, input.idempotency_key, hash, "update", result);
      return result;
    });
  }

  async publish(request: AuthenticatedRequest, idValue: string, body: unknown) {
    const id = z.string().uuid().parse(idValue);
    const input = publishNoticeSchema.parse(body);
    const hash = this.hash({ operation: "publish", id, ...input });
    return this.db.transaction().execute(async (db) => {
      const notice = await this.lockNotice(db, id);
      const role = await this.assertManager(db, request.authUser, notice);
      const audiences = await this.audiences(db, id);
      await this.authorizeAudiences(db, request.authUser.id, notice.school_id, role, audiences);
      const prior = await this.priorCommand<PublishResult>(db, request.authUser.id, input.idempotency_key, hash);
      if (prior) return prior;
      if (notice.status !== "draft") throw new ConflictException("This notice has already left draft state.");
      this.assertRevision(notice.revision, input.expected_revision);
      this.validateDeadline(notice);
      await this.snapshotRecipients(db, notice, request.authUser.id);
      const count = Number((await sql<{ count: string }>`SELECT count(*)::text AS count FROM school_notice_recipients WHERE notice_id=${id}::uuid`.execute(db)).rows[0]?.count ?? 0);
      if (!count) throw new BadRequestException("The selected audience currently has no recipients.");
      const updated = (await sql<NoticeRow>`UPDATE school_notices SET status='published',published_by=${request.authUser.id}::uuid,
        published_at=now(),revision=revision+1,updated_at=now() WHERE id=${id}::uuid RETURNING *`.execute(db)).rows[0]!;
      await this.createInitialDeliveries(db, updated, request.authUser.id);
      await this.createAppNotifications(db, updated);
      await this.recordAudit(db, request, updated, "published", "draft", "published", null, { recipient_count: count });
      await this.emit(db, updated, "published", request.authUser.id);
      const result = { id: updated.id, revision: updated.revision, status: updated.status, recipient_count: count };
      await this.saveCommand(db, updated, request.authUser.id, input.idempotency_key, hash, "publish", result);
      return result;
    });
  }

  async cancel(request: AuthenticatedRequest, idValue: string, body: unknown) {
    const id = z.string().uuid().parse(idValue);
    const input = cancelNoticeSchema.parse(body);
    const hash = this.hash({ operation: "cancel", id, ...input });
    return this.db.transaction().execute(async (db) => {
      const notice = await this.lockNotice(db, id);
      await this.assertManager(db, request.authUser, notice);
      const prior = await this.priorCommand<NoticeMutationResult>(db, request.authUser.id, input.idempotency_key, hash);
      if (prior) return prior;
      if (notice.status !== "published") throw new ConflictException("Only a published notice can be cancelled.");
      this.assertRevision(notice.revision, input.expected_revision);
      const updated = (await sql<NoticeRow>`UPDATE school_notices SET status='cancelled',cancelled_by=${request.authUser.id}::uuid,
        cancelled_at=now(),cancellation_reason=${input.reason},revision=revision+1,updated_at=now()
        WHERE id=${id}::uuid RETURNING *`.execute(db)).rows[0]!;
      await sql`UPDATE school_notice_delivery_attempts SET status='cancelled'
        WHERE notice_id=${id}::uuid AND status='queued'`.execute(db);
      await this.recordAudit(db, request, updated, "cancelled", "published", "cancelled", null, { reason: input.reason });
      await this.emit(db, updated, "cancelled", request.authUser.id);
      const result = { id: updated.id, revision: updated.revision, status: updated.status };
      await this.saveCommand(db, updated, request.authUser.id, input.idempotency_key, hash, "cancel", result);
      return result;
    });
  }

  async open(request: AuthenticatedRequest, idValue: string, body: unknown) {
    const id = z.string().uuid().parse(idValue);
    const input = z.object({ student_id: z.string().uuid().optional() }).strict().parse(body ?? {});
    return this.db.transaction().execute(async (db) => {
      const notice = await this.notice(db, id);
      const scope = await this.recipientScope(db, request.authUser, notice.school_id, input.student_id);
      const recipients = await this.accessibleRecipients(db, request.authUser, scope, id, true);
      if (!recipients.length) throw new NotFoundException("Notice not found.");
      const recipient = this.selectRecipient(recipients, scope.student_id);
      if (recipient.opened_at) return { id: notice.id, recipient_id: recipient.id, revision: recipient.revision, opened_at: recipient.opened_at };
      const updated = (await sql<RecipientRow>`UPDATE school_notice_recipients SET opened_at=now(),revision=revision+1,updated_at=now()
        WHERE id=${recipient.id}::uuid RETURNING *`.execute(db)).rows[0]!;
      await this.recordAudit(db, request, notice, "opened", "unopened", "opened", updated.id, {});
      return { id: notice.id, recipient_id: updated.id, revision: updated.revision, opened_at: updated.opened_at };
    });
  }

  async respond(request: AuthenticatedRequest, idValue: string, body: unknown) {
    const id = z.string().uuid().parse(idValue);
    const input = respondNoticeSchema.parse(body);
    const hash = this.hash({ operation: "respond", id, ...input });
    return this.db.transaction().execute(async (db) => {
      const notice = await this.lockNotice(db, id);
      const scope = await this.recipientScope(db, request.authUser, notice.school_id, input.student_id);
      const recipients = await this.accessibleRecipients(db, request.authUser, scope, id, true);
      if (!recipients.length) throw new NotFoundException("Notice not found.");
      const recipient = this.selectRecipient(recipients, scope.student_id);
      const prior = await this.priorCommand<ResponseResult>(db, request.authUser.id, input.idempotency_key, hash);
      if (prior) return prior;
      this.assertResponseAllowed(notice, recipient, input.expected_revision);
      const value = this.responseValue(notice, input.response_value);
      const updated = await this.writeResponse(db, recipient, value, input.response_note, "app", new Date(), request.authUser.id);
      await this.recordAudit(db, request, notice, "responded", "pending", value, updated.id, { channel: "app" });
      await this.emit(db, notice, "responded", request.authUser.id);
      const result = { id: notice.id, recipient_id: updated.id, recipient_revision: updated.revision, response_value: updated.response_value };
      await this.saveCommand(db, notice, request.authUser.id, input.idempotency_key, hash, "respond", result);
      return result;
    });
  }

  async assistedResponse(request: AuthenticatedRequest, idValue: string, body: unknown) {
    const id = z.string().uuid().parse(idValue);
    const input = assistedResponseSchema.parse(body);
    const hash = this.hash({ operation: "assisted_response", id, ...input });
    return this.db.transaction().execute(async (db) => {
      const notice = await this.lockNotice(db, id);
      await this.assertAdministrator(db, request.authUser, notice.school_id);
      const prior = await this.priorCommand<ResponseResult>(db, request.authUser.id, input.idempotency_key, hash);
      if (prior) return prior;
      const recipient = await this.lockRecipient(db, notice, input.recipient_id);
      this.assertResponseAllowed(notice, recipient, input.expected_revision);
      const observedAt = new Date(input.observed_at);
      this.validateObservedAt(notice, observedAt);
      const value = this.responseValue(notice, input.response_value);
      const updated = await this.writeResponse(db, recipient, value, input.response_note, input.channel, observedAt, request.authUser.id);
      await this.recordAudit(db, request, notice, "assisted_response", "pending", value, updated.id, { channel: input.channel, observed_at: observedAt.toISOString() });
      await this.emit(db, notice, "responded", request.authUser.id);
      const result = { id: notice.id, recipient_id: updated.id, recipient_revision: updated.revision, response_value: updated.response_value };
      await this.saveCommand(db, notice, request.authUser.id, input.idempotency_key, hash, "assisted_response", result);
      return result;
    });
  }

  async recordDelivery(request: AuthenticatedRequest, idValue: string, body: unknown) {
    const id = z.string().uuid().parse(idValue);
    const input = deliveryAttemptSchema.parse(body);
    const hash = this.hash({ operation: "delivery", id, ...input });
    return this.db.transaction().execute(async (db) => {
      const notice = await this.lockNotice(db, id);
      await this.assertManager(db, request.authUser, notice);
      const prior = await this.priorCommand<DeliveryResult>(db, request.authUser.id, input.idempotency_key, hash);
      if (prior) return prior;
      if (notice.status === "draft") throw new ConflictException("Publish the notice before recording delivery.");
      const recipient = await this.lockRecipient(db, notice, input.recipient_id);
      const attemptedAt = new Date(input.attempted_at);
      this.validateObservedAt(notice, attemptedAt);
      const attempt = (await sql<{ id: string }>`INSERT INTO school_notice_delivery_attempts(
        school_id,notice_id,recipient_id,channel,status,note,provider_reference,attempted_at,recorded_by)
        VALUES(${notice.school_id}::uuid,${notice.id}::uuid,${recipient.id}::uuid,${input.channel},${input.status},
          ${input.note},${input.provider_reference},${attemptedAt},${request.authUser.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
      await this.recordAudit(db, request, notice, "delivery_recorded", null, input.status, recipient.id,
        { channel: input.channel, attempt_id: attempt.id, attempted_at: attemptedAt.toISOString() });
      const result = { id: notice.id, recipient_id: recipient.id, delivery_attempt_id: attempt.id, status: input.status };
      await this.saveCommand(db, notice, request.authUser.id, input.idempotency_key, hash, "delivery", result);
      return result;
    });
  }

  private async familyList(user: AuthUser, scope: ActorScope, status?: NoticeStatus) {
    return (await sql`
      SELECT notice.id,notice.title,notice.body,notice.response_mode,notice.response_options,notice.priority,
        notice.due_at,notice.status,notice.revision,notice.published_at,notice.cancelled_at,notice.cancellation_reason,
        notice.created_at,recipient.id AS recipient_id,recipient.student_id,recipient.opened_at,recipient.responded_at,
        recipient.response_value,recipient.response_channel,recipient.revision AS recipient_revision,
        concat_ws(' ',student_person.first_name,student_person.last_name) AS student_name,
        latest_delivery.channel AS delivery_channel,latest_delivery.status AS delivery_status
      FROM school_notice_recipients recipient
      JOIN school_notices notice ON notice.id=recipient.notice_id AND notice.school_id=recipient.school_id
      JOIN students student ON student.id=recipient.student_id
      JOIN school_people student_person ON student_person.id=student.person_id
      LEFT JOIN LATERAL (SELECT delivery.channel,delivery.status FROM school_notice_delivery_attempts delivery
        WHERE delivery.recipient_id=recipient.id ORDER BY delivery.created_at DESC,delivery.id DESC LIMIT 1) latest_delivery ON true
      WHERE recipient.guardian_id=${scope.guardian_id}::uuid AND recipient.student_id=${scope.student_id}::uuid
        AND notice.school_id=${scope.school_id}::uuid AND (${status ?? null}::text IS NULL OR notice.status=${status ?? null})
      ORDER BY notice.published_at DESC NULLS LAST,notice.created_at DESC,notice.id
    `.execute(this.db)).rows;
  }

  private async staffList(user: AuthUser, scope: ActorScope, portal: NoticePortal, status?: NoticeStatus) {
    return (await sql`
      SELECT notice.id,notice.title,notice.body,notice.response_mode,notice.response_options,notice.priority,
        notice.due_at,notice.status,notice.revision,notice.published_at,notice.cancelled_at,notice.cancellation_reason,
        notice.created_at,(notice.created_by=${user.id}::uuid) AS can_manage,
        recipient.id AS recipient_id,recipient.opened_at,recipient.responded_at,recipient.response_value,
        recipient.response_channel,recipient.revision AS recipient_revision,
        count(DISTINCT all_recipient.id)::int AS recipient_count,
        count(DISTINCT all_recipient.id) FILTER (WHERE all_recipient.responded_at IS NOT NULL)::int AS response_count
      FROM school_notices notice
      LEFT JOIN school_notice_recipients recipient ON recipient.notice_id=notice.id AND recipient.user_id=${user.id}::uuid
      LEFT JOIN school_notice_recipients all_recipient ON all_recipient.notice_id=notice.id
      WHERE notice.school_id=${scope.school_id}::uuid
        AND (${portal === "principal"}::boolean OR notice.created_by=${user.id}::uuid OR recipient.id IS NOT NULL)
        AND (${status ?? null}::text IS NULL OR notice.status=${status ?? null})
      GROUP BY notice.id,recipient.id
      ORDER BY notice.created_at DESC,notice.id
    `.execute(this.db)).rows;
  }

  private async actorScope(db: Db, user: AuthUser, portal: NoticePortal, requestedSchool?: string, requestedStudent?: string): Promise<ActorScope> {
    if (portal === "parent") {
      const rows = (await sql<ActorScope>`
        SELECT student.school_id,'guardian'::text AS role,parent.id AS guardian_id,student.id AS student_id
        FROM parents parent
        JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
        JOIN students student ON student.id=relationship.student_id AND student.school_id=relationship.school_id
        JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=student.school_id
          AND membership.role='guardian' AND membership.is_active
        WHERE parent.user_id=${user.id}::uuid
          AND (${requestedSchool ?? user.active_school_id ?? null}::uuid IS NULL OR student.school_id=${requestedSchool ?? user.active_school_id ?? null}::uuid)
          AND (${requestedStudent ?? null}::uuid IS NULL OR student.id=${requestedStudent ?? null}::uuid)
        ORDER BY relationship.is_primary DESC,student.id LIMIT 1
      `.execute(db)).rows;
      if (!rows[0]) throw new ForbiddenException("No accessible learner was found for this notice view.");
      return rows[0];
    }
    const expected = portal === "principal" ? "admin" : "staff";
    const row = (await sql<ActorScope>`
      SELECT membership.school_id,membership.role,NULL::uuid AS guardian_id,NULL::uuid AS student_id
      FROM school_memberships membership JOIN users actor ON actor.id=membership.user_id AND actor.is_active
      WHERE membership.user_id=${user.id}::uuid AND membership.role=${expected} AND membership.is_active
        AND (${requestedSchool ?? user.active_school_id ?? null}::uuid IS NULL OR membership.school_id=${requestedSchool ?? user.active_school_id ?? null}::uuid)
      ORDER BY membership.created_at LIMIT 1
    `.execute(db)).rows[0];
    if (!row) throw new ForbiddenException(`This account does not have an active ${expected} notice context.`);
    return row;
  }

  private async recipientScope(db: Db, user: AuthUser, schoolId: string, studentId?: string): Promise<ActorScope> {
    const memberships = await db.selectFrom("school_memberships").select(["school_id", "role"])
      .where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true).execute();
    const direct = memberships.find((membership) => membership.role === "staff" || membership.role === "admin");
    if (direct) return { school_id: schoolId, role: direct.role as "staff" | "admin", guardian_id: null, student_id: null };
    const guardian = (await sql<ActorScope>`SELECT student.school_id,'guardian'::text AS role,parent.id AS guardian_id,student.id AS student_id
      FROM parents parent JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
      JOIN students student ON student.id=relationship.student_id AND student.school_id=relationship.school_id
      JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=student.school_id
        AND membership.role='guardian' AND membership.is_active
      WHERE parent.user_id=${user.id}::uuid AND student.school_id=${schoolId}::uuid
        AND (${studentId ?? null}::uuid IS NULL OR student.id=${studentId ?? null}::uuid)
      ORDER BY relationship.is_primary DESC,student.id`.execute(db)).rows;
    if (!guardian.length) throw new NotFoundException("Notice not found.");
    if (!studentId && guardian.length > 1) return { ...guardian[0]!, student_id: null };
    return guardian[0]!;
  }

  private async manageRole(db: Db, user: AuthUser, schoolId: string): Promise<"staff" | "admin"> {
    if (user.active_school_id && user.active_school_id !== schoolId) throw new ForbiddenException("Choose the school before creating a notice.");
    const membership = await db.selectFrom("school_memberships").select("role")
      .where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true)
      .where("role", "in", ["staff", "admin"]).executeTakeFirst();
    if (!membership) throw new ForbiddenException("Only authorized school staff can manage notices.");
    return membership.role as "staff" | "admin";
  }

  private async assertAdministrator(db: Db, user: AuthUser, schoolId: string) {
    const role = await this.manageRole(db, user, schoolId);
    if (role !== "admin") throw new ForbiddenException("A school administrator must record an assisted response.");
  }

  private async assertManager(db: Db, user: AuthUser, notice: NoticeRow): Promise<"staff" | "admin"> {
    const role = await this.manageRole(db, user, notice.school_id);
    if (role === "staff" && notice.created_by !== user.id) throw new NotFoundException("Notice not found.");
    return role;
  }

  private async authorizeAudiences(db: Db, actorId: string, schoolId: string, role: "staff" | "admin", audiences: NoticeAudienceInput[]) {
    for (const audience of audiences) {
      if (audience.class_section_id) {
        const section = await db.selectFrom("class_sections").select("id")
          .where("id", "=", audience.class_section_id).where("school_id", "=", schoolId).executeTakeFirst();
        if (!section) throw new BadRequestException("Choose a class from this school.");
      }
      if (role === "staff") {
        if (audience.kind !== "class_guardians" || !audience.class_section_id) {
          throw new ForbiddenException("Staff notices must stay within an assigned class guardian audience.");
        }
        const allowed = (await sql<{ allowed: boolean }>`SELECT staff_has_class_permission(${schoolId}::uuid,${actorId}::uuid,
          'messages.send',${audience.class_section_id}::uuid) AS allowed`.execute(db)).rows[0]?.allowed;
        if (!allowed) throw new ForbiddenException("This class is outside your current communication assignment.");
      }
    }
  }

  private validateDeadline(input: { response_mode: NoticeRow["response_mode"]; due_at?: string | Date | null | undefined }) {
    if (input.response_mode === "information") return;
    const due = input.due_at ? new Date(input.due_at) : null;
    const now = Date.now();
    if (!due || due.getTime() <= now || due.getTime() > now + 180 * 86400000) {
      throw new BadRequestException("Choose a response deadline within the next 180 days.");
    }
  }

  private async replaceAudiences(db: Db, notice: NoticeRow, audiences: NoticeAudienceInput[]) {
    await sql`DELETE FROM school_notice_audiences WHERE notice_id=${notice.id}::uuid`.execute(db);
    for (const audience of audiences) {
      await sql`INSERT INTO school_notice_audiences(school_id,notice_id,audience_kind,class_section_id)
        VALUES(${notice.school_id}::uuid,${notice.id}::uuid,${audience.kind},${audience.class_section_id ?? null}::uuid)`.execute(db);
    }
  }

  private async audiences(db: Db, noticeId: string): Promise<NoticeAudienceInput[]> {
    const rows = (await sql<{ kind: NoticeAudienceInput["kind"]; class_section_id: string | null }>`
      SELECT audience_kind AS kind,class_section_id FROM school_notice_audiences WHERE notice_id=${noticeId}::uuid ORDER BY audience_kind,class_section_id
    `.execute(db)).rows;
    return rows;
  }

  private async snapshotRecipients(db: Db, notice: NoticeRow, actorId: string) {
    await sql`
      INSERT INTO school_notice_recipients(school_id,notice_id,recipient_key,recipient_role,user_id,
        guardian_id,student_id,recipient_name,contact_phone,contact_email)
      SELECT DISTINCT notice.school_id,notice.id,
        'guardian:'||guardian.id::text||':student:'||student.id::text,'guardian',
        CASE WHEN account.id IS NOT NULL AND membership.user_id IS NOT NULL THEN account.id END,
        guardian.id,student.id,concat_ws(' ',person.first_name,person.last_name),person.contact_phone,person.contact_email
      FROM school_notices notice
      JOIN school_notice_audiences audience ON audience.notice_id=notice.id AND audience.audience_kind IN ('school_guardians','class_guardians')
      JOIN enrollments enrollment ON enrollment.is_active
        AND (audience.audience_kind='school_guardians' OR enrollment.class_section_id=audience.class_section_id)
      JOIN students student ON student.id=enrollment.student_id AND student.school_id=notice.school_id
      JOIN guardian_relationships relationship ON relationship.student_id=student.id AND relationship.school_id=student.school_id
      JOIN parents guardian ON guardian.id=relationship.guardian_id
      JOIN guardian_school_profiles profile ON profile.guardian_id=guardian.id AND profile.school_id=student.school_id
      JOIN school_people person ON person.id=profile.person_id AND person.school_id=student.school_id
      LEFT JOIN users account ON account.id=guardian.user_id AND account.is_active
      LEFT JOIN school_memberships membership ON membership.user_id=account.id AND membership.school_id=student.school_id
        AND membership.role='guardian' AND membership.is_active
      WHERE notice.id=${notice.id}::uuid
      ON CONFLICT(notice_id,recipient_key) DO NOTHING
    `.execute(db);
    await sql`
      INSERT INTO school_notice_recipients(school_id,notice_id,recipient_key,recipient_role,user_id,
        recipient_name,contact_phone,contact_email)
      SELECT DISTINCT ON (membership.user_id) notice.school_id,notice.id,'user:'||membership.user_id::text,
        membership.role,membership.user_id,concat_ws(' ',account.first_name,account.last_name),
        COALESCE(profile.phone,''),COALESCE(NULLIF(profile.email,''),account.email)
      FROM school_notices notice
      JOIN school_notice_audiences audience ON audience.notice_id=notice.id AND audience.audience_kind='school_staff'
      JOIN school_memberships membership ON membership.school_id=notice.school_id AND membership.role IN ('staff','admin') AND membership.is_active
      JOIN users account ON account.id=membership.user_id AND account.is_active
      LEFT JOIN staff_profiles profile ON profile.user_id=account.id AND profile.school_id=notice.school_id
      WHERE notice.id=${notice.id}::uuid
      ORDER BY membership.user_id,(membership.role='admin') DESC
      ON CONFLICT(notice_id,recipient_key) DO NOTHING
    `.execute(db);
    await sql`SELECT id FROM users WHERE id=${actorId}::uuid FOR SHARE`.execute(db);
  }

  private async createInitialDeliveries(db: Db, notice: NoticeRow, actorId: string) {
    await sql`INSERT INTO school_notice_delivery_attempts(school_id,notice_id,recipient_id,channel,status,note,attempted_at,recorded_by)
      SELECT school_id,notice_id,id,'app','delivered','',now(),${actorId}::uuid FROM school_notice_recipients
      WHERE notice_id=${notice.id}::uuid AND user_id IS NOT NULL`.execute(db);
    await sql`INSERT INTO school_notice_delivery_attempts(school_id,notice_id,recipient_id,channel,status,note,attempted_at,recorded_by)
      SELECT school_id,notice_id,id,'paper','queued','No active app account',now(),${actorId}::uuid FROM school_notice_recipients
      WHERE notice_id=${notice.id}::uuid AND user_id IS NULL`.execute(db);
  }

  private async createAppNotifications(db: Db, notice: NoticeRow) {
    await sql`INSERT INTO notifications(recipient_id,kind,title,body,link,metadata,dedupe_key)
      SELECT recipient.user_id,'general',${notice.title},left(${notice.body},240),
        CASE recipient.recipient_role WHEN 'guardian' THEN '/parent/notices/'||notice.id::text||'?student_id='||recipient.student_id::text
          WHEN 'admin' THEN '/principal/notices/'||notice.id::text
          ELSE '/teacher/notices/'||notice.id::text END,
        jsonb_build_object('notice_id',notice.id,'response_mode',notice.response_mode,'student_id',recipient.student_id),
        'notice:'||notice.id::text||':recipient:'||recipient.id::text
      FROM school_notice_recipients recipient JOIN school_notices notice ON notice.id=recipient.notice_id
      WHERE recipient.notice_id=${notice.id}::uuid AND recipient.user_id IS NOT NULL
      ON CONFLICT(recipient_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`.execute(db);
  }

  private async accessibleRecipients(db: Db, user: AuthUser, scope: ActorScope, noticeId: string, lock: boolean): Promise<RecipientRow[]> {
    const query = scope.role === "guardian" ? sql<RecipientRow>`
      SELECT recipient.* FROM school_notice_recipients recipient
      WHERE recipient.notice_id=${noticeId}::uuid AND recipient.school_id=${scope.school_id}::uuid
        AND recipient.guardian_id=${scope.guardian_id}::uuid
        AND (${scope.student_id}::uuid IS NULL OR recipient.student_id=${scope.student_id}::uuid)
      ORDER BY recipient.student_id ${lock ? sql`FOR UPDATE` : sql``}
    ` : sql<RecipientRow>`
      SELECT recipient.* FROM school_notice_recipients recipient
      JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=recipient.school_id
        AND membership.is_active AND membership.role IN ('staff','admin')
      WHERE recipient.notice_id=${noticeId}::uuid AND recipient.user_id=${user.id}::uuid
      ${lock ? sql`FOR UPDATE OF recipient` : sql``}
    `;
    return (await query.execute(db)).rows;
  }

  private selectRecipient(recipients: RecipientRow[], studentId: string | null): RecipientRow {
    if (recipients.length === 1) return recipients[0]!;
    if (studentId) {
      const recipient = recipients.find((row) => row.student_id === studentId);
      if (recipient) return recipient;
    }
    throw new BadRequestException("Choose the learner this response is for.");
  }

  private assertResponseAllowed(notice: NoticeRow, recipient: RecipientRow, expectedRevision: number) {
    if (notice.status !== "published") throw new ConflictException("This notice is not accepting responses.");
    if (notice.response_mode === "information") throw new BadRequestException("This notice is for information only.");
    if (notice.due_at && notice.due_at.getTime() < Date.now()) throw new ConflictException("The response deadline has passed.");
    this.assertRevision(recipient.revision, expectedRevision);
    if (recipient.responded_at) throw new ConflictException("A response has already been recorded.");
  }

  private responseValue(notice: NoticeRow, supplied?: string): string {
    if (notice.response_mode === "acknowledgement") return "acknowledged";
    if (!supplied) throw new BadRequestException("Choose a response.");
    const choice = notice.response_options.find((option) => option.toLocaleLowerCase() === supplied.toLocaleLowerCase());
    if (!choice) throw new BadRequestException("Choose one of the available responses.");
    return choice;
  }

  private async writeResponse(db: Db, recipient: RecipientRow, value: string, note: string,
    channel: "app" | "sms" | "paper" | "phone" | "in_person", observedAt: Date, actorId: string) {
    return (await sql<RecipientRow>`UPDATE school_notice_recipients SET opened_at=COALESCE(opened_at,now()),responded_at=now(),
      response_value=${value},response_note=${note},response_channel=${channel},response_observed_at=${observedAt},
      response_recorded_by=${actorId}::uuid,revision=revision+1,updated_at=now() WHERE id=${recipient.id}::uuid RETURNING *`.execute(db)).rows[0]!;
  }

  private validateObservedAt(notice: NoticeRow, observedAt: Date) {
    const published = notice.published_at?.getTime() ?? Number.POSITIVE_INFINITY;
    if (observedAt.getTime() < published - 5000 || observedAt.getTime() > Date.now() + 5000) {
      throw new BadRequestException("The recorded time must fall between publication and now.");
    }
  }

  private async managerRecipients(db: Db, noticeId: string) {
    return (await sql`
      SELECT recipient.*,student_person.first_name||CASE WHEN student_person.last_name='' THEN '' ELSE ' '||student_person.last_name END AS student_name,
        COALESCE(delivery.attempts,'[]'::jsonb) AS deliveries
      FROM school_notice_recipients recipient
      LEFT JOIN students student ON student.id=recipient.student_id
      LEFT JOIN school_people student_person ON student_person.id=student.person_id
      LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',attempt.id,'channel',attempt.channel,'status',attempt.status,
        'note',attempt.note,'provider_reference',attempt.provider_reference,'attempted_at',attempt.attempted_at,'created_at',attempt.created_at)
        ORDER BY attempt.created_at DESC,attempt.id DESC) AS attempts FROM school_notice_delivery_attempts attempt
        WHERE attempt.recipient_id=recipient.id) delivery ON true
      WHERE recipient.notice_id=${noticeId}::uuid ORDER BY recipient.recipient_name,recipient.student_id,recipient.id
    `.execute(db)).rows as Array<Record<string, unknown> & RecipientRow & { deliveries: Array<{ status: string }> }>;
  }

  private metrics(recipients: Array<Record<string, unknown> & RecipientRow & { deliveries: Array<{ status: string }> }>) {
    return {
      recipients: recipients.length,
      opened: recipients.filter((recipient) => recipient.opened_at).length,
      responded: recipients.filter((recipient) => recipient.responded_at).length,
      delivery_exceptions: recipients.filter((recipient) => recipient.deliveries[0]?.status === "failed").length,
      app_accounts: recipients.filter((recipient) => recipient.user_id).length,
      assisted: recipients.filter((recipient) => recipient.responded_at && recipient.response_channel !== "app").length,
    };
  }

  private async deliveryHistory(db: Db, recipientId: string) {
    return (await sql`SELECT id,channel,status,note,provider_reference,attempted_at,created_at
      FROM school_notice_delivery_attempts WHERE recipient_id=${recipientId}::uuid ORDER BY created_at DESC,id DESC`.execute(db)).rows;
  }

  private async noticeAudits(db: Db, noticeId: string) {
    return (await sql`SELECT audit.id,audit.action,audit.from_status,audit.to_status,audit.metadata,audit.created_at,
      concat_ws(' ',actor.first_name,actor.last_name) AS actor_name,audit.recipient_id
      FROM school_notice_audits audit JOIN users actor ON actor.id=audit.actor_id
      WHERE audit.notice_id=${noticeId}::uuid ORDER BY audit.created_at DESC,audit.id DESC LIMIT 100`.execute(db)).rows;
  }

  private async notice(db: Db, id: string): Promise<NoticeRow> {
    const row = (await sql<NoticeRow>`SELECT * FROM school_notices WHERE id=${id}::uuid`.execute(db)).rows[0];
    if (!row) throw new NotFoundException("Notice not found.");
    return row;
  }

  private async lockNotice(db: Db, id: string): Promise<NoticeRow> {
    const row = (await sql<NoticeRow>`SELECT * FROM school_notices WHERE id=${id}::uuid FOR UPDATE`.execute(db)).rows[0];
    if (!row) throw new NotFoundException("Notice not found.");
    return row;
  }

  private async lockRecipient(db: Db, notice: NoticeRow, recipientId: string): Promise<RecipientRow> {
    const row = (await sql<RecipientRow>`SELECT * FROM school_notice_recipients
      WHERE id=${recipientId}::uuid AND notice_id=${notice.id}::uuid AND school_id=${notice.school_id}::uuid FOR UPDATE`.execute(db)).rows[0];
    if (!row) throw new NotFoundException("Notice recipient not found.");
    return row;
  }

  private assertRevision(actual: number, expected: number) {
    if (actual !== expected) throw new ConflictException("This notice has changed. Refresh before continuing.");
  }

  private hash(input: unknown) {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  }

  private async priorCommand<T>(db: Db, actorId: string, key: string, hash: string): Promise<T | null> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`notice:${actorId}:${key}`},0))`.execute(db);
    const prior = (await sql<CommandRow>`SELECT request_hash,result FROM school_notice_commands
      WHERE actor_id=${actorId}::uuid AND idempotency_key=${key}::uuid`.execute(db)).rows[0];
    if (prior && prior.request_hash !== hash) throw new ConflictException("This operation ID was already used with different details.");
    return prior ? prior.result as T : null;
  }

  private async saveCommand(db: Db, notice: NoticeRow, actorId: string, key: string, hash: string, operation: string, result: unknown) {
    await sql`INSERT INTO school_notice_commands(school_id,actor_id,idempotency_key,request_hash,operation,notice_id,result)
      VALUES(${notice.school_id}::uuid,${actorId}::uuid,${key}::uuid,${hash},${operation},${notice.id}::uuid,${JSON.stringify(result)}::jsonb)`.execute(db);
  }

  private async recordAudit(db: Db, request: AuthenticatedRequest, notice: NoticeRow, action: string,
    fromStatus: string | null, toStatus: string, recipientId: string | null, metadata: Record<string, unknown>) {
    await sql`INSERT INTO school_notice_audits(school_id,notice_id,recipient_id,actor_id,action,from_status,to_status,metadata)
      VALUES(${notice.school_id}::uuid,${notice.id}::uuid,${recipientId}::uuid,${request.authUser.id}::uuid,
        ${action},${fromStatus},${toStatus},${JSON.stringify(metadata)}::jsonb)`.execute(db);
    await db.insertInto("audit_events").values({
      action: `notice.${action}`, actor_id: request.authUser.id, school_id: notice.school_id,
      target_type: recipientId ? "school_notice_recipient" : "school_notice", target_id: recipientId ?? notice.id,
      request_id: request.requestId, ip_hash: null, metadata: { notice_id: notice.id, ...metadata },
    }).execute();
  }

  private async emit(db: Db, notice: NoticeRow, action: string, actorId: string) {
    const users = (await sql<{ user_id: string }>`SELECT DISTINCT user_id FROM school_notice_recipients
      WHERE notice_id=${notice.id}::uuid AND user_id IS NOT NULL
      UNION SELECT ${notice.created_by}::uuid
      UNION SELECT membership.user_id FROM school_memberships membership
        WHERE membership.school_id=${notice.school_id}::uuid AND membership.role='admin' AND membership.is_active`.execute(db)).rows.map((row) => row.user_id);
    await this.events.enqueueUserEvent(db, {
      schoolId: notice.school_id, eventType: "notice.updated", aggregateType: "school_notice", aggregateId: notice.id,
      audienceUserIds: users, idempotencyKey: `notice:${notice.id}:${action}:${notice.revision}:${actorId}`,
      payload: { notice_id: notice.id, action, revision: notice.revision,
        refresh: ["notices", "requests", "notifications", "parent.home", "teacher.home", "principal.home"] },
    });
  }
}
