/* eslint-disable */
// @ts-nocheck
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";

export interface ChatUpload {
  filename: string;
  mimetype: string;
  data: Buffer;
}

const uuid = z.string().uuid();
const createConversationSchema = z.object({
  recipient_id: uuid,
  student_id: uuid.optional(),
  title: z.string().trim().max(180).optional().default(""),
});
const messageSchema = z.object({
  body: z.string().trim().max(4000).optional().default(""),
  client_id: uuid.optional(),
  reply_to_id: uuid.optional(),
});
const reportSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
const reportStatusSchema = z.enum(["open", "under_review", "resolved", "dismissed"]);
const moderationUpdateSchema = z.object({
  status: z.enum(["under_review", "resolved", "dismissed"]).optional(),
  assigned_to: uuid.nullable().optional(),
  action: z.enum(["none", "no_action", "warning", "restrict", "escalate"]).optional(),
  note: z.string().trim().max(1000).optional().default(""),
  restriction_days: z.number().int().min(1).max(30).optional(),
});
const editMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const groupSchema = z.object({
  title: z.string().trim().min(3).max(180),
  group_type: z.enum(["student_group", "parent_group", "activity", "staff", "child_support", "announcement"]),
  member_ids: z.array(uuid).min(1).max(200),
  school_id: uuid.optional(),
  student_id: uuid.optional(),
});
const policySchema = z.object({
  student_teacher_direct_enabled: z.boolean().optional(),
  guardian_teacher_direct_enabled: z.boolean().optional(),
  student_group_replies: z.boolean().optional(),
  guardian_group_replies: z.boolean().optional(),
  attachments_enabled: z.boolean().optional(),
  enforce_communication_hours: z.boolean().optional(),
  communication_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  communication_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  retention_days: z.number().int().min(30).max(3650).optional(),
});
const allowedAttachments = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function portalForRole(role: AuthUser["role"]): string {
  if (role === "parent") return "parent";
  if (role === "student") return "student";
  if (role === "staff") return "teacher";
  return "principal";
}

function displayName(user: Pick<AuthUser, "first_name" | "last_name">): string {
  return `${user.first_name} ${user.last_name}`.trim();
}

@Injectable()
export class ChatService {
  constructor(private readonly db: DatabaseService) {}

  private async conversationForUser(user: AuthUser, conversationId: string) {
    if (!uuid.safeParse(conversationId).success) throw new NotFoundException("Conversation not found.");
    const result = await sql<any>`
      SELECT c.*, cp.last_read_at, cp.joined_at, cp.is_muted
      FROM chat_conversations c
      JOIN chat_participants cp ON cp.conversation_id=c.id
      JOIN school_memberships membership ON membership.school_id=c.school_id
        AND membership.user_id=${user.id}::uuid AND membership.is_active
      WHERE c.id=${conversationId}::uuid AND cp.user_id=${user.id}::uuid AND cp.is_active
      LIMIT 1
    `.execute(this.db);
    const conversation = result.rows[0];
    if (!conversation) throw new NotFoundException("Conversation not found.");
    return conversation;
  }

  private async ensureClassGroups(user: AuthUser) {
    const sections = await sql<any>`SELECT DISTINCT cs.id, cs.school_id, cs.grade, cs.section
      FROM class_sections cs JOIN school_memberships sm ON sm.school_id=cs.school_id
      WHERE sm.user_id=${user.id}::uuid AND sm.is_active
        AND (sm.role IN ('admin', 'staff') OR (sm.role='student' AND EXISTS (
          SELECT 1 FROM students st JOIN enrollments e ON e.student_id=st.id
          WHERE st.user_id=${user.id}::uuid AND e.is_active AND e.class_section_id=cs.id
        ))) ORDER BY cs.id`.execute(this.db);
    for (const section of sections.rows) {
      await this.db.transaction().execute(async (tx) => {
        // Serialize creation per class so simultaneous first visits cannot create duplicates.
        await sql`SELECT id FROM class_sections WHERE id=${section.id}::uuid FOR UPDATE`.execute(tx);
        const title = "Grade " + section.grade + " · " + section.section;
        const existing = await sql<any>`SELECT id FROM chat_conversations
          WHERE school_id=${section.school_id}::uuid AND kind='group' AND group_type='student_group'
            AND context_student_id IS NULL AND title=${title} ORDER BY created_at, id LIMIT 1`.execute(tx);
        const conversation = existing.rows[0] ?? await tx.insertInto("chat_conversations").values({
          school_id: section.school_id, kind: "group", title, context_student_id: null,
          created_by: user.id, group_type: "student_group", posting_mode: "all",
        }).returning("id").executeTakeFirstOrThrow();
        // Current enrollments are the source of truth, including students added after creation.
        const members = await sql<any>`SELECT DISTINCT u.id, 'member' AS participant_role
          FROM enrollments e JOIN students st ON st.id=e.student_id
          JOIN users u ON u.id=st.user_id AND u.is_active
          JOIN school_memberships sm ON sm.user_id=u.id AND sm.school_id=${section.school_id}::uuid
            AND sm.role='student' AND sm.is_active
          WHERE e.class_section_id=${section.id}::uuid AND e.is_active
          UNION SELECT DISTINCT u.id, 'moderator' AS participant_role
          FROM school_memberships sm JOIN users u ON u.id=sm.user_id AND u.is_active
          WHERE sm.school_id=${section.school_id}::uuid AND sm.is_active
            AND (sm.role='admin' OR (sm.role='staff' AND EXISTS (
              SELECT 1 FROM timetable_slots slot WHERE slot.class_section_id=${section.id}::uuid
                AND slot.teacher_user_id=u.id
            )))`.execute(tx);
        const roles = new Map<string, string>();
        for (const member of members.rows) {
          if (roles.get(member.id) !== "moderator") roles.set(member.id, member.participant_role);
        }
        for (const [id, role] of roles) {
          await tx.insertInto("chat_participants").values({conversation_id: conversation.id,
            user_id: id, participant_role: role, is_active: true})
            .onConflict((conflict) => conflict.columns(["conversation_id", "user_id"])
              .doUpdateSet({participant_role: role, is_active: true})).execute();
        }
      });
    }
  }

  async conversations(user: AuthUser) {
    await this.ensureClassGroups(user);
    const result = await sql<any>`
      SELECT c.id, c.school_id, c.kind, c.context_student_id, c.group_type, c.posting_mode, c.created_at, c.updated_at,
        COALESCE(NULLIF(c.title, ''), (
          SELECT concat_ws(' ', other_user.first_name, other_user.last_name)
          FROM chat_participants other_participant
          JOIN users other_user ON other_user.id=other_participant.user_id
          WHERE other_participant.conversation_id=c.id
            AND other_participant.user_id<>${user.id}::uuid
            AND other_participant.is_active
          ORDER BY other_participant.joined_at
          LIMIT 1
        ), 'Conversation') AS title,
        COALESCE((
          SELECT other_user.role
          FROM chat_participants other_participant
          JOIN users other_user ON other_user.id=other_participant.user_id
          WHERE other_participant.conversation_id=c.id
            AND other_participant.user_id<>${user.id}::uuid
            AND other_participant.is_active
          ORDER BY other_participant.joined_at
          LIMIT 1
        ), 'staff') AS other_role,
        COALESCE((
          SELECT st.avatar_url
          FROM chat_participants other_participant
          JOIN students st ON st.user_id=other_participant.user_id
          WHERE other_participant.conversation_id=c.id
            AND other_participant.user_id<>${user.id}::uuid
            AND other_participant.is_active
          LIMIT 1
        ), '') AS avatar_url,
        CASE WHEN c.context_student_id IS NULL THEN NULL ELSE (
          SELECT concat_ws(' ', student_user.first_name, student_user.last_name)
          FROM students context_student JOIN users student_user ON student_user.id=context_student.user_id
          WHERE context_student.id=c.context_student_id
        ) END AS student_name,
        last_message.id AS last_message_id,
        CASE WHEN last_message.is_deleted THEN 'Message deleted'
          WHEN COALESCE(last_message.body, '') <> '' THEN last_message.body
          ELSE COALESCE(last_attachment.original_name, 'Attachment') END AS last_message,
        COALESCE(last_message.created_at, c.created_at) AS last_message_at,
        COALESCE((
          SELECT count(*)::int
          FROM chat_messages unread
          WHERE unread.conversation_id=c.id
            AND unread.sender_id<>${user.id}::uuid
            AND unread.created_at>COALESCE(cp.last_read_at, cp.joined_at)
        ), 0)::int AS unread_count,
        (SELECT count(*)::int FROM chat_participants members WHERE members.conversation_id=c.id AND members.is_active) AS member_count,
        CASE WHEN c.posting_mode='moderators' THEN EXISTS (
          SELECT 1 FROM chat_participants moderator WHERE moderator.conversation_id=c.id
            AND moderator.user_id=${user.id}::uuid AND moderator.participant_role='moderator' AND moderator.is_active
        ) ELSE true END AS can_post
      FROM chat_conversations c
      JOIN chat_participants cp ON cp.conversation_id=c.id
        AND cp.user_id=${user.id}::uuid AND cp.is_active
      JOIN school_memberships membership ON membership.school_id=c.school_id
        AND membership.user_id=${user.id}::uuid AND membership.is_active
      LEFT JOIN LATERAL (
        SELECT message.* FROM chat_messages message
        WHERE message.conversation_id=c.id
        ORDER BY message.created_at DESC, message.id DESC LIMIT 1
      ) last_message ON true
      LEFT JOIN chat_attachments last_attachment ON last_attachment.message_id=last_message.id
      ORDER BY COALESCE(last_message.created_at, c.created_at) DESC
      LIMIT 100
    `.execute(this.db);
    return { results: result.rows };
  }

  async recipients(user: AuthUser, requestedStudentId?: string) {
    if (requestedStudentId && !uuid.safeParse(requestedStudentId).success) {
      throw new BadRequestException("student_id must be a valid UUID.");
    }
    const memberships = await this.db.selectFrom("school_memberships")
      .select(["school_id", "role"])
      .where("user_id", "=", user.id)
      .where("is_active", "=", true)
      .execute();
    const recipients = new Map<string, any>();

    for (const membership of memberships) {
      let result;
      if (membership.role === "admin") {
        result = await sql<any>`
          SELECT target.id, target.first_name, target.last_name, target.role,
            target_membership.role AS membership_role, school.id AS school_id, school.name AS school_name,
            student.id AS student_id, student.avatar_url
          FROM school_memberships target_membership
          JOIN users target ON target.id=target_membership.user_id AND target.is_active
          JOIN schools school ON school.id=target_membership.school_id
          LEFT JOIN students student ON student.user_id=target.id
          WHERE target_membership.school_id=${membership.school_id}::uuid
            AND target_membership.is_active AND target.id<>${user.id}::uuid
          ORDER BY target.first_name, target.last_name
        `.execute(this.db);
      } else if (membership.role === "staff") {
        result = await sql<any>`
          SELECT DISTINCT target.id, target.first_name, target.last_name, target.role,
            target_membership.role AS membership_role, school.id AS school_id, school.name AS school_name,
            student.id AS student_id, student.avatar_url
          FROM school_memberships target_membership
          JOIN users target ON target.id=target_membership.user_id AND target.is_active
          JOIN schools school ON school.id=target_membership.school_id
          LEFT JOIN students student ON student.user_id=target.id
          WHERE target_membership.school_id=${membership.school_id}::uuid
            AND target_membership.is_active AND target.id<>${user.id}::uuid
            AND (
              target_membership.role IN ('staff', 'admin')
              OR (
                target_membership.role='student'
                AND EXISTS (
                  SELECT 1 FROM enrollments enrollment
                  JOIN timetable_slots slot ON slot.class_section_id=enrollment.class_section_id
                    AND slot.term_id=enrollment.term_id
                  WHERE enrollment.student_id=student.id AND enrollment.is_active
                    AND slot.teacher_user_id=${user.id}::uuid
                    AND (${requestedStudentId ?? null}::uuid IS NULL OR student.id=${requestedStudentId ?? null}::uuid)
                )
              )
              OR (
                target_membership.role='guardian'
                AND EXISTS (
                  SELECT 1 FROM parents parent
                  JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
                  JOIN enrollments enrollment ON enrollment.student_id=relationship.student_id AND enrollment.is_active
                  JOIN timetable_slots slot ON slot.class_section_id=enrollment.class_section_id
                    AND slot.term_id=enrollment.term_id AND slot.teacher_user_id=${user.id}::uuid
                  WHERE parent.user_id=target.id
                    AND (${requestedStudentId ?? null}::uuid IS NULL OR relationship.student_id=${requestedStudentId ?? null}::uuid)
                )
              )
            )
          ORDER BY target.first_name, target.last_name
        `.execute(this.db);
      } else if (membership.role === "guardian") {
        result = await sql<any>`
          SELECT DISTINCT target.id, target.first_name, target.last_name, target.role,
            target_membership.role AS membership_role, school.id AS school_id, school.name AS school_name,
            NULL::uuid AS student_id, ''::text AS avatar_url
          FROM school_memberships target_membership
          JOIN users target ON target.id=target_membership.user_id AND target.is_active
          JOIN schools school ON school.id=target_membership.school_id
          WHERE target_membership.school_id=${membership.school_id}::uuid
            AND target_membership.is_active AND target.id<>${user.id}::uuid
            AND (
              target_membership.role='admin'
              OR (
                target_membership.role='staff'
                AND EXISTS (
                  SELECT 1 FROM parents parent
                  JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
                  JOIN enrollments enrollment ON enrollment.student_id=relationship.student_id AND enrollment.is_active
                  JOIN timetable_slots slot ON slot.class_section_id=enrollment.class_section_id
                    AND slot.term_id=enrollment.term_id AND slot.teacher_user_id=target.id
                  WHERE parent.user_id=${user.id}::uuid
                    AND (${requestedStudentId ?? null}::uuid IS NULL OR relationship.student_id=${requestedStudentId ?? null}::uuid)
                )
              )
            )
          ORDER BY target.first_name, target.last_name
        `.execute(this.db);
      } else {
        result = await sql<any>`
          SELECT DISTINCT target.id, target.first_name, target.last_name, target.role,
            target_membership.role AS membership_role, school.id AS school_id, school.name AS school_name,
            NULL::uuid AS student_id, ''::text AS avatar_url
          FROM students own_student
          JOIN enrollments enrollment ON enrollment.student_id=own_student.id AND enrollment.is_active
          JOIN school_memberships target_membership ON target_membership.school_id=own_student.school_id
            AND target_membership.is_active
          JOIN users target ON target.id=target_membership.user_id AND target.is_active
          JOIN schools school ON school.id=target_membership.school_id
          WHERE own_student.user_id=${user.id}::uuid
            AND own_student.school_id=${membership.school_id}::uuid
            AND target.id<>${user.id}::uuid
            AND (
              target_membership.role='admin'
              OR (
                target_membership.role='staff'
                AND EXISTS (
                  SELECT 1 FROM timetable_slots slot
                  WHERE slot.class_section_id=enrollment.class_section_id
                    AND slot.term_id=enrollment.term_id AND slot.teacher_user_id=target.id
                )
              )
            )
          ORDER BY target.first_name, target.last_name
        `.execute(this.db);
      }

      for (const row of result.rows) {
        const detail = row.membership_role === "admin"
          ? "School administrator"
          : row.membership_role === "staff"
            ? "Teacher or staff"
            : row.membership_role === "student"
              ? "Student"
              : "Parent or guardian";
        recipients.set(`${row.school_id}:${row.id}`, {
          id: row.id,
          name: `${row.first_name} ${row.last_name}`.trim(),
          role: row.role,
          membership_role: row.membership_role,
          detail,
          school_id: row.school_id,
          school_name: row.school_name,
          student_id: row.student_id,
          avatar_url: row.avatar_url || null,
        });
      }
    }
    return { results: [...recipients.values()].sort((left, right) => left.name.localeCompare(right.name)) };
  }

  async createConversation(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = createConversationSchema.parse(body);
    if (data.recipient_id === user.id) throw new BadRequestException("You cannot start a conversation with yourself.");
    const allowed = await this.recipients(user, data.student_id);
    const recipient = allowed.results.find((item) => item.id === data.recipient_id);
    if (!recipient) throw new ForbiddenException("This person is not available to message.");

    const existing = await sql<{ id: string }>`
      SELECT conversation.id
      FROM chat_conversations conversation
      WHERE conversation.school_id=${recipient.school_id}::uuid
        AND conversation.kind='direct'
        AND conversation.context_student_id IS NOT DISTINCT FROM ${data.student_id ?? null}::uuid
        AND EXISTS (
          SELECT 1 FROM chat_participants participant
          WHERE participant.conversation_id=conversation.id
            AND participant.user_id=${user.id}::uuid AND participant.is_active
        )
        AND EXISTS (
          SELECT 1 FROM chat_participants participant
          WHERE participant.conversation_id=conversation.id
            AND participant.user_id=${recipient.id}::uuid AND participant.is_active
        )
        AND (
          SELECT count(*) FROM chat_participants participant
          WHERE participant.conversation_id=conversation.id AND participant.is_active
        )=2
      LIMIT 1
    `.execute(this.db);
    if (existing.rows[0]) return { id: existing.rows[0].id, created: false };

    const conversation = await this.db.transaction().execute(async (tx) => {
      const created = await tx.insertInto("chat_conversations").values({
        school_id: recipient.school_id,
        kind: "direct",
        title: data.title,
        context_student_id: data.student_id ?? null,
        created_by: user.id,
      }).returning("id").executeTakeFirstOrThrow();
      await tx.insertInto("chat_participants").values([
        { conversation_id: created.id, user_id: user.id, participant_role: "member" },
        { conversation_id: created.id, user_id: recipient.id, participant_role: "member" },
      ]).execute();
      await tx.insertInto("audit_events").values({
        action: "chat.conversation.created",
        actor_id: user.id,
        school_id: recipient.school_id,
        target_type: "chat_conversation",
        target_id: created.id,
        request_id: request.requestId,
        ip_hash: null,
        metadata: { recipient_id: recipient.id, context_student_id: data.student_id ?? null },
      }).execute();
      return created;
    });
    return { id: conversation.id, created: true };
  }

  async messages(user: AuthUser, conversationId: string, before?: string) {
    await this.conversationForUser(user, conversationId);
    let beforeDate: Date | undefined;
    if (before) {
      beforeDate = new Date(before);
      if (Number.isNaN(beforeDate.getTime())) throw new BadRequestException("before must be an ISO timestamp.");
    }
    const result = await sql<any>`
      SELECT message.id, message.conversation_id, message.sender_id, message.client_id,
        CASE WHEN message.is_deleted THEN '' ELSE message.body END AS body,
        message.message_type, message.reply_to_id, message.is_deleted,
        message.created_at, message.updated_at,
        sender.first_name, sender.last_name, sender.role AS sender_role,
        attachment.id AS attachment_id, attachment.original_name,
        attachment.content_type, attachment.size_bytes,
        (report.id IS NOT NULL) AS is_reported_by_me,
        report.status AS report_status
      FROM chat_messages message
      JOIN users sender ON sender.id=message.sender_id
      LEFT JOIN chat_attachments attachment ON attachment.message_id=message.id
      LEFT JOIN chat_message_reports report
        ON report.message_id=message.id AND report.reported_by=${user.id}::uuid
      WHERE message.conversation_id=${conversationId}::uuid
        AND (${beforeDate ?? null}::timestamptz IS NULL OR message.created_at<${beforeDate ?? null}::timestamptz)
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT 50
    `.execute(this.db);
    return {
      results: result.rows.reverse().map((row) => ({
        id: row.id,
        conversation_id: row.conversation_id,
        sender_id: row.sender_id,
        sender_name: `${row.first_name} ${row.last_name}`.trim(),
        sender_role: row.sender_role,
        body: row.body,
        message_type: row.message_type,
        reply_to_id: row.reply_to_id,
        is_deleted: row.is_deleted,
        is_mine: row.sender_id === user.id,
        is_reported_by_me: Boolean(row.is_reported_by_me),
        report_status: row.report_status ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        attachment: row.attachment_id && !row.is_deleted ? {
          id: row.attachment_id,
          original_name: row.original_name,
          content_type: row.content_type,
          size_bytes: row.size_bytes,
          file_url: `/api/v1/chat/conversations/${conversationId}/messages/${row.id}/attachment/`,
        } : null,
      })),
      has_more: result.rows.length === 50,
    };
  }

  async send(
    user: AuthUser,
    conversationId: string,
    input: unknown,
    upload: ChatUpload | undefined,
    request: AuthenticatedRequest,
  ) {
    const conversation = await this.conversationForUser(user, conversationId);
    const data = messageSchema.parse(input);
    const policy = await this.db.selectFrom("chat_policies").selectAll().where("school_id", "=", conversation.school_id).executeTakeFirst();
    const restriction = await this.db.selectFrom("chat_messaging_restrictions")
      .select(["id", "expires_at"])
      .where("school_id", "=", conversation.school_id)
      .where("user_id", "=", user.id)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", new Date())
      .orderBy("expires_at", "desc")
      .executeTakeFirst();
    if (restriction) {
      throw new ForbiddenException(`Messaging is restricted by school staff until ${new Date(restriction.expires_at).toLocaleString("en-IN")}.`);
    }
    const participant = await this.db.selectFrom("chat_participants").select("participant_role").where("conversation_id", "=", conversationId).where("user_id", "=", user.id).executeTakeFirst();
    if (conversation.posting_mode === "moderators" && participant?.participant_role !== "moderator") {
      throw new ForbiddenException("Only group moderators can post in this conversation.");
    }
    if (policy?.attachments_enabled === false && upload) throw new ForbiddenException("Attachments are disabled by school policy.");
    if (conversation.kind === "group" && user.role === "parent" && policy?.guardian_group_replies === false && participant?.participant_role !== "moderator") {
      throw new ForbiddenException("Parent replies are disabled in this group.");
    }
    if (conversation.kind === "group" && user.role === "student" && policy?.student_group_replies === false && participant?.participant_role !== "moderator") {
      throw new ForbiddenException("Student replies are disabled in this group.");
    }
    if (!data.body && !upload) throw new BadRequestException("Enter a message or attach a file.");
    if (upload && (!allowedAttachments.has(upload.mimetype) || upload.data.length === 0 || upload.data.length > 10 * 1024 * 1024)) {
      throw new BadRequestException("Attachments must be an image, PDF, DOC, or DOCX file up to 10 MB.");
    }
    if (data.reply_to_id) {
      const reply = await this.db.selectFrom("chat_messages").select("id")
        .where("id", "=", data.reply_to_id)
        .where("conversation_id", "=", conversationId)
        .executeTakeFirst();
      if (!reply) throw new BadRequestException("The replied-to message is not in this conversation.");
    }

    const clientId = data.client_id ?? randomUUID();
    const existing = await this.db.selectFrom("chat_messages").select("id")
      .where("conversation_id", "=", conversationId)
      .where("client_id", "=", clientId)
      .executeTakeFirst();
    if (existing) return { id: existing.id, duplicate: true };

    let storedPath: string | undefined;
    let storageKey: string | undefined;
    if (upload) {
      const safeExtension = extname(basename(upload.filename)).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
      storageKey = `${randomUUID()}${safeExtension}`;
      const directory = join(config().uploadDir, "chat", conversationId);
      await mkdir(directory, { recursive: true });
      storedPath = join(directory, storageKey);
      await writeFile(storedPath, upload.data, { flag: "wx" });
    }

    try {
      const created = await this.db.transaction().execute(async (tx) => {
        const message = await tx.insertInto("chat_messages").values({
          conversation_id: conversationId,
          sender_id: user.id,
          client_id: clientId,
          body: data.body,
          message_type: upload ? "file" : "text",
          reply_to_id: data.reply_to_id ?? null,
        }).returning(["id", "created_at"]).executeTakeFirstOrThrow();
        if (upload && storageKey) {
          await tx.insertInto("chat_attachments").values({
            message_id: message.id,
            storage_key: storageKey,
            original_name: basename(upload.filename).slice(0, 255),
            content_type: upload.mimetype,
            size_bytes: upload.data.length,
          }).execute();
        }
        await tx.updateTable("chat_conversations").set({
          last_message_at: message.created_at,
          updated_at: message.created_at,
        }).where("id", "=", conversationId).execute();
        await tx.updateTable("chat_participants").set({ last_read_at: message.created_at })
          .where("conversation_id", "=", conversationId)
          .where("user_id", "=", user.id)
          .execute();

        const targets = await tx.selectFrom("chat_participants as participant")
          .innerJoin("users as target", "target.id", "participant.user_id")
          .select(["target.id", "target.role"])
          .where("participant.conversation_id", "=", conversationId)
          .where("participant.user_id", "!=", user.id)
          .where("participant.is_active", "=", true)
          .execute();
        if (targets.length) {
          await tx.insertInto("notifications").values(targets.map((target) => ({
            recipient_id: target.id,
            kind: "general" as const,
            title: `New message from ${displayName(user)}`,
            body: data.body ? data.body.slice(0, 180) : `Attachment: ${basename(upload?.filename ?? "File")}`,
            link: `/${portalForRole(target.role)}/messages?conversation=${conversationId}`,
            metadata: { conversation_id: conversationId, student_id: conversation.context_student_id },
          }))).execute();
        }
        await tx.insertInto("audit_events").values({
          action: "chat.message.sent",
          actor_id: user.id,
          school_id: conversation.school_id,
          target_type: "chat_message",
          target_id: message.id,
          request_id: request.requestId,
          ip_hash: null,
          metadata: { conversation_id: conversationId, has_attachment: Boolean(upload) },
        }).execute();
        return message;
      });
      return { id: created.id, created_at: created.created_at, duplicate: false };
    } catch (error) {
      if (storedPath) await unlink(storedPath).catch(() => undefined);
      throw error;
    }
  }

  async markRead(user: AuthUser, conversationId: string) {
    await this.conversationForUser(user, conversationId);
    const readAt = new Date();
    await this.db.transaction().execute(async (tx) => {
      await tx.updateTable("chat_participants").set({ last_read_at: readAt })
        .where("conversation_id", "=", conversationId)
        .where("user_id", "=", user.id)
        .execute();
      await sql`
        UPDATE notifications SET read_at=${readAt}
        WHERE recipient_id=${user.id}::uuid AND read_at IS NULL
          AND metadata->>'conversation_id'=${conversationId}
      `.execute(tx);
    });
    return { conversation_id: conversationId, read_at: readAt };
  }

  async editMessage(user: AuthUser, conversationId: string, messageId: string, body: unknown) {
    await this.conversationForUser(user, conversationId);
    if (!uuid.safeParse(messageId).success) throw new NotFoundException("Message not found.");
    const data = editMessageSchema.parse(body);
    const message = await this.db.selectFrom("chat_messages").selectAll().where("id", "=", messageId).where("conversation_id", "=", conversationId).executeTakeFirst();
    if (!message) throw new NotFoundException("Message not found.");
    if (message.sender_id !== user.id) throw new ForbiddenException("You can only edit messages you sent.");
    if (message.message_type === "system" || Date.now() - new Date(message.created_at).getTime() > 2 * 60_000) {
      throw new BadRequestException("Messages can only be edited for 2 minutes after sending.");
    }
    await this.db.updateTable("chat_messages").set({ body: data.body, updated_at: new Date() }).where("id", "=", messageId).execute();
    return { id: messageId, edited: true };
  }

  async reportMessage(user: AuthUser, conversationId: string, messageId: string, body: unknown, request: AuthenticatedRequest) {
    const conversation = await this.conversationForUser(user, conversationId);
    const data = reportSchema.parse(body);
    const message = await this.db.selectFrom("chat_messages").select(["id", "sender_id"])
      .where("id", "=", messageId)
      .where("conversation_id", "=", conversationId)
      .executeTakeFirst();
    if (!message) throw new NotFoundException("Message not found.");
    if (message.sender_id === user.id) throw new BadRequestException("You cannot report your own message.");
    const report = await this.db.transaction().execute(async (tx) => {
      const saved = await tx.insertInto("chat_message_reports").values({
        message_id: messageId,
        reported_by: user.id,
        reason: data.reason,
        status: "open",
      }).onConflict((conflict) => conflict.columns(["message_id", "reported_by"]).doUpdateSet({
        reason: data.reason,
        status: "open",
        assigned_to: null,
        reviewed_by: null,
        resolution_note: "",
        action_taken: "none",
        updated_at: new Date(),
        resolved_at: null,
      })).returning(["id", "status"]).executeTakeFirstOrThrow();
      const admins = await tx.selectFrom("school_memberships")
        .select("user_id")
        .where("school_id", "=", conversation.school_id)
        .where("role", "=", "admin")
        .where("is_active", "=", true)
        .where("user_id", "!=", user.id)
        .execute();
      if (admins.length) {
        await tx.insertInto("notifications").values(admins.map((admin) => ({
          recipient_id: admin.user_id,
          kind: "general" as const,
          title: "New reported chat message",
          body: "A message needs review in the safeguarding queue.",
          link: "/principal/safeguarding",
          metadata: { report_id: saved.id, conversation_id: conversationId },
        }))).execute();
      }
      await tx.insertInto("audit_events").values({
        action: "chat.report.created",
        actor_id: user.id,
        school_id: conversation.school_id,
        target_type: "chat_message_report",
        target_id: saved.id,
        request_id: request.requestId,
        ip_hash: null,
        metadata: { conversation_id: conversationId, message_id: messageId },
      }).execute();
      return saved;
    });
    return report;
  }

  async reports(user: AuthUser, status?: string) {
    if (user.role !== "admin" && user.role !== "staff") {
      throw new ForbiddenException("Only authorised school staff can access message reports.");
    }
    const parsedStatus = status ? reportStatusSchema.safeParse(status) : undefined;
    if (parsedStatus && !parsedStatus.success) throw new BadRequestException("Invalid report status.");
    const selectedStatus = parsedStatus?.success ? parsedStatus.data : null;
    const result = await sql<any>`
      SELECT report.id, report.message_id, report.reported_by, report.reason, report.status,
        report.assigned_to, report.reviewed_by, report.resolution_note, report.action_taken,
        report.created_at, report.updated_at, report.resolved_at,
        conversation.id AS conversation_id, conversation.title AS conversation_title,
        conversation.kind AS conversation_kind, conversation.group_type,
        message.body AS message_body, message.created_at AS message_created_at,
        message.sender_id, concat_ws(' ', sender.first_name, sender.last_name) AS sender_name,
        concat_ws(' ', reporter.first_name, reporter.last_name) AS reporter_name,
        concat_ws(' ', assignee.first_name, assignee.last_name) AS assignee_name,
        current_membership.role AS reviewer_role,
        COALESCE((
          SELECT json_agg(context_row ORDER BY context_row.created_at)
          FROM (
            SELECT context_message.id, context_message.body, context_message.created_at,
              concat_ws(' ', context_sender.first_name, context_sender.last_name) AS sender_name,
              (context_message.id=message.id) AS is_flagged
            FROM chat_messages context_message
            JOIN users context_sender ON context_sender.id=context_message.sender_id
            WHERE context_message.conversation_id=conversation.id
              AND context_message.created_at<=message.created_at
            ORDER BY context_message.created_at DESC, context_message.id DESC
            LIMIT 5
          ) context_row
        ), '[]'::json) AS context_messages
      FROM chat_message_reports report
      JOIN chat_messages message ON message.id=report.message_id
      JOIN chat_conversations conversation ON conversation.id=message.conversation_id
      JOIN users sender ON sender.id=message.sender_id
      JOIN users reporter ON reporter.id=report.reported_by
      LEFT JOIN users assignee ON assignee.id=report.assigned_to
      JOIN school_memberships current_membership ON current_membership.school_id=conversation.school_id
        AND current_membership.user_id=${user.id}::uuid AND current_membership.is_active
      WHERE (
        current_membership.role='admin'
        OR (current_membership.role='staff' AND report.assigned_to=${user.id}::uuid)
      )
        AND (${selectedStatus}::text IS NULL OR report.status=${selectedStatus})
      ORDER BY CASE report.status WHEN 'open' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END,
        report.updated_at DESC, report.created_at DESC
      LIMIT 100
    `.execute(this.db);
    const summaryResult = await sql<any>`
      SELECT report.status, count(*)::int AS count
      FROM chat_message_reports report
      JOIN chat_messages message ON message.id=report.message_id
      JOIN chat_conversations conversation ON conversation.id=message.conversation_id
      JOIN school_memberships current_membership ON current_membership.school_id=conversation.school_id
        AND current_membership.user_id=${user.id}::uuid AND current_membership.is_active
      WHERE current_membership.role='admin'
        OR (current_membership.role='staff' AND report.assigned_to=${user.id}::uuid)
      GROUP BY report.status
    `.execute(this.db);
    const summary = { open: 0, under_review: 0, resolved: 0, dismissed: 0 };
    for (const row of summaryResult.rows) summary[row.status as keyof typeof summary] = Number(row.count);
    return {
      results: result.rows.map((row) => ({
        ...row,
        can_assign: row.reviewer_role === "admin",
        context_messages: Array.isArray(row.context_messages) ? row.context_messages : [],
      })),
      summary,
    };
  }

  async reportReviewers(user: AuthUser) {
    if (user.role !== "admin") {
      throw new ForbiddenException("Only school administrators can assign message reports.");
    }
    const result = await sql<any>`
      SELECT DISTINCT target.id, concat_ws(' ', target.first_name, target.last_name) AS name,
        target_membership.role
      FROM school_memberships current_membership
      JOIN school_memberships target_membership ON target_membership.school_id=current_membership.school_id
        AND target_membership.is_active AND target_membership.role IN ('admin', 'staff')
      JOIN users target ON target.id=target_membership.user_id AND target.is_active
      WHERE current_membership.user_id=${user.id}::uuid
        AND current_membership.is_active AND current_membership.role='admin'
      ORDER BY name
    `.execute(this.db);
    return { results: result.rows };
  }

  async updateReport(user: AuthUser, reportId: string, body: unknown, request: AuthenticatedRequest) {
    if (!uuid.safeParse(reportId).success) throw new NotFoundException("Report not found.");
    const data = moderationUpdateSchema.parse(body);
    const reportResult = await sql<any>`
      SELECT report.*, message.sender_id, message.conversation_id,
        conversation.school_id, current_membership.role AS reviewer_role,
        sender_user.role AS sender_role, reporter_user.role AS reporter_role
      FROM chat_message_reports report
      JOIN chat_messages message ON message.id=report.message_id
      JOIN users sender_user ON sender_user.id=message.sender_id
      JOIN users reporter_user ON reporter_user.id=report.reported_by
      JOIN chat_conversations conversation ON conversation.id=message.conversation_id
      JOIN school_memberships current_membership ON current_membership.school_id=conversation.school_id
        AND current_membership.user_id=${user.id}::uuid AND current_membership.is_active
      WHERE report.id=${reportId}::uuid
      LIMIT 1
    `.execute(this.db);
    const report = reportResult.rows[0];
    if (!report) throw new NotFoundException("Report not found.");
    const isAdmin = report.reviewer_role === "admin";
    const isAssignedStaff = report.reviewer_role === "staff" && report.assigned_to === user.id;
    if (!isAdmin && !isAssignedStaff) throw new ForbiddenException("This report is not assigned to you.");
    const hasReviewerConflict = report.sender_id === user.id || report.reported_by === user.id;
    if (report.status === "resolved" || report.status === "dismissed") {
      throw new BadRequestException("This report is already closed.");
    }

    let assignee = report.assigned_to as string | null;
    if (Object.prototype.hasOwnProperty.call(data, "assigned_to")) {
      if (!isAdmin) throw new ForbiddenException("Only administrators can assign reports.");
      assignee = data.assigned_to ?? null;
      if (assignee) {
        if (assignee === report.sender_id || assignee === report.reported_by) {
          throw new BadRequestException("Choose an independent reviewer for this report.");
        }
        const eligible = await this.db.selectFrom("school_memberships")
          .innerJoin("users", "users.id", "school_memberships.user_id")
          .select(["users.id", "users.role"])
          .where("school_memberships.school_id", "=", report.school_id)
          .where("school_memberships.user_id", "=", assignee)
          .where("school_memberships.role", "in", ["admin", "staff"])
          .where("school_memberships.is_active", "=", true)
          .where("users.is_active", "=", true)
          .executeTakeFirst();
        if (!eligible) throw new BadRequestException("Choose an authorised staff member.");
      }
    }

    const requestedAction = data.action ?? "none";
    if (hasReviewerConflict) {
      const assignmentOnly = isAdmin && Boolean(data.assigned_to)
        && data.assigned_to !== user.id && requestedAction === "none"
        && (!data.status || data.status === "under_review");
      if (!assignmentOnly) {
        throw new ForbiddenException("Assign an independent staff member to review this report.");
      }
    }
    let nextStatus = data.status ?? report.status;
    if (requestedAction === "warning" || requestedAction === "restrict") nextStatus = "resolved";
    if (requestedAction === "escalate") nextStatus = "under_review";
    if (nextStatus === "under_review" && !assignee) assignee = user.id;
    if (nextStatus === "dismissed") {
      if (!data.note) throw new BadRequestException("Add a note before dismissing a report.");
    }
    if ((nextStatus === "resolved" || requestedAction === "warning" || requestedAction === "restrict" || requestedAction === "escalate") && !data.note) {
      throw new BadRequestException("Add a review note before taking this action.");
    }
    if (requestedAction === "restrict" && !data.restriction_days) {
      throw new BadRequestException("Choose a restriction period.");
    }
    const actionTaken = nextStatus === "dismissed" ? "no_action" : requestedAction;
    const resolvedAt = nextStatus === "resolved" || nextStatus === "dismissed" ? new Date() : null;

    const updated = await this.db.transaction().execute(async (tx) => {
      const saved = await tx.updateTable("chat_message_reports").set({
        status: nextStatus,
        assigned_to: assignee,
        reviewed_by: user.id,
        resolution_note: data.note || report.resolution_note || "",
        action_taken: actionTaken,
        updated_at: new Date(),
        resolved_at: resolvedAt,
      }).where("id", "=", reportId).returningAll().executeTakeFirstOrThrow();

      if (requestedAction === "restrict") {
        const expiresAt = new Date(Date.now() + (data.restriction_days ?? 7) * 24 * 60 * 60 * 1000);
        await tx.insertInto("chat_messaging_restrictions").values({
          school_id: report.school_id,
          user_id: report.sender_id,
          report_id: reportId,
          reason: data.note,
          expires_at: expiresAt,
          created_by: user.id,
        }).execute();
      }

      const notifications: Array<Record<string, unknown>> = [];
      if (assignee && assignee !== report.assigned_to && assignee !== user.id) {
        const target = await tx.selectFrom("users").select(["id", "role"]).where("id", "=", assignee).executeTakeFirst();
        if (target) notifications.push({
          recipient_id: target.id, kind: "general", title: "Chat report assigned",
          body: "A reported message has been assigned to you for review.",
          link: `/${portalForRole(target.role)}/safeguarding`,
          metadata: { report_id: reportId },
        });
      }
      if (requestedAction === "warning") {
        notifications.push({
          recipient_id: report.sender_id, kind: "general", title: "Messaging conduct warning",
          body: "School staff reviewed a message and issued a conduct warning.",
          link: `/${portalForRole(report.sender_role)}/messages?conversation=${report.conversation_id}`,
          metadata: { report_id: reportId, conversation_id: report.conversation_id },
        });
      }
      if (requestedAction === "restrict") {
        notifications.push({
          recipient_id: report.sender_id, kind: "general", title: "Messaging temporarily restricted",
          body: `School staff restricted messaging for ${data.restriction_days ?? 7} day(s).`,
          link: "",
          metadata: { report_id: reportId },
        });
      }
      if (requestedAction === "escalate") {
        const administrators = await tx.selectFrom("school_memberships")
          .select("user_id")
          .where("school_id", "=", report.school_id)
          .where("role", "=", "admin")
          .where("is_active", "=", true)
          .where("user_id", "!=", user.id)
          .execute();
        notifications.push(...administrators.map((administrator) => ({
          recipient_id: administrator.user_id, kind: "general", title: "Chat report escalated",
          body: "A safeguarding review has been escalated for administrator attention.",
          link: "/principal/safeguarding",
          metadata: { report_id: reportId },
        })));
      }
      if (nextStatus === "resolved" || nextStatus === "dismissed") {
        notifications.push({
          recipient_id: report.reported_by, kind: "general",
          title: nextStatus === "resolved" ? "Message report resolved" : "Message report reviewed",
          body: "Authorised school staff completed their review.",
          link: `/${portalForRole(report.reporter_role)}/messages?conversation=${report.conversation_id}`,
          metadata: { report_id: reportId, conversation_id: report.conversation_id },
        });
      }
      if (notifications.length) await tx.insertInto("notifications").values(notifications as any).execute();
      await tx.insertInto("audit_events").values({
        action: "chat.report.reviewed",
        actor_id: user.id,
        school_id: report.school_id,
        target_type: "chat_message_report",
        target_id: reportId,
        request_id: request.requestId,
        ip_hash: null,
        metadata: {
          from_status: report.status, to_status: nextStatus, action_taken: actionTaken,
          assigned_to: assignee, restriction_days: data.restriction_days ?? null,
        },
      }).execute();
      return saved;
    });
    return updated;
  }

  async policyForUser(user: AuthUser) {
    const membership = await this.db.selectFrom("school_memberships").select(["school_id", "role"]).where("user_id", "=", user.id).where("is_active", "=", true).executeTakeFirst();
    if (!membership) throw new ForbiddenException("No active school membership.");
    let policy = await this.db.selectFrom("chat_policies").selectAll().where("school_id", "=", membership.school_id).executeTakeFirst();
    if (!policy) policy = await this.db.insertInto("chat_policies").values({ school_id: membership.school_id }).returningAll().executeTakeFirstOrThrow();
    return { ...policy, can_manage: membership.role === "admin" };
  }

  async updatePolicy(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const membership = await this.db.selectFrom("school_memberships").select(["school_id", "role"]).where("user_id", "=", user.id).where("is_active", "=", true).executeTakeFirst();
    if (!membership || membership.role !== "admin") throw new ForbiddenException("Only school administrators can change chat policy.");
    const data = policySchema.parse(body);
    const updated = await this.db.updateTable("chat_policies").set({ ...data, updated_by: user.id, updated_at: new Date() }).where("school_id", "=", membership.school_id).returningAll().executeTakeFirstOrThrow();
    await this.db.insertInto("audit_events").values({ action: "chat.policy.updated", actor_id: user.id, school_id: membership.school_id, target_type: "chat_policy", target_id: membership.school_id, request_id: request.requestId, ip_hash: null, metadata: data }).execute();
    return { ...updated, can_manage: true };
  }

  async createGroup(user: AuthUser, body: unknown, request: AuthenticatedRequest) {
    const data = groupSchema.parse(body);
    const membership = await this.db.selectFrom("school_memberships").select(["school_id", "role"]).where("user_id", "=", user.id).where("is_active", "=", true).where("role", "in", ["staff", "admin"]).executeTakeFirst();
    if (!membership) throw new ForbiddenException("Only teachers and administrators can create groups.");
    if ((data.group_type === "staff" || data.group_type === "announcement") && membership.role !== "admin") throw new ForbiddenException("Only administrators can create this group type.");
    const schoolId = data.school_id ?? membership.school_id;
    if (schoolId !== membership.school_id) throw new ForbiddenException("You can only create groups in your school.");
    const members = await this.db.selectFrom("school_memberships").select(["user_id", "role"]).where("school_id", "=", schoolId).where("user_id", "in", data.member_ids).where("is_active", "=", true).execute();
    if (members.length !== data.member_ids.length) throw new ForbiddenException("Every group member must be an active member of the school.");
    const allowed: Record<string, string[]> = { student_group: ["student", "staff", "admin"], parent_group: ["guardian", "staff", "admin"], activity: ["student", "guardian", "staff", "admin"], staff: ["staff", "admin"], announcement: ["student", "guardian", "staff", "admin"], child_support: ["student", "guardian", "staff", "admin"] };
    if (members.some((member) => !allowed[data.group_type].includes(member.role))) throw new ForbiddenException("One or more selected members are not eligible for this group type.");
    const postingMode: "all" | "moderators" = data.group_type === "parent_group" || data.group_type === "announcement" ? "moderators" : "all";
    const created = await this.db.transaction().execute(async (tx) => {
      const conversation = await tx.insertInto("chat_conversations").values({ school_id: schoolId, kind: data.group_type === "announcement" ? "announcement" : "group", title: data.title, context_student_id: data.student_id ?? null, created_by: user.id, group_type: data.group_type, posting_mode: postingMode }).returning("id").executeTakeFirstOrThrow();
      const rows = [{ conversation_id: conversation.id, user_id: user.id, participant_role: "moderator" as const }, ...data.member_ids.filter((id) => id !== user.id).map((id) => ({ conversation_id: conversation.id, user_id: id, participant_role: "member" as const }))];
      await tx.insertInto("chat_participants").values(rows).execute();
      await tx.insertInto("chat_messages").values({ conversation_id: conversation.id, sender_id: user.id, body: "Group created. Please keep communication respectful and school-related.", message_type: "system", client_id: randomUUID() }).execute();
      await tx.insertInto("audit_events").values({ action: "chat.group.created", actor_id: user.id, school_id: schoolId, target_type: "chat_conversation", target_id: conversation.id, request_id: request.requestId, ip_hash: null, metadata: { group_type: data.group_type, member_count: rows.length } }).execute();
      return conversation;
    });
    return { id: created.id };
  }

  async attachment(user: AuthUser, conversationId: string, messageId: string) {
    await this.conversationForUser(user, conversationId);
    const result = await this.db.selectFrom("chat_attachments as attachment")
      .innerJoin("chat_messages as message", "message.id", "attachment.message_id")
      .select([
        "attachment.id",
        "attachment.storage_key",
        "attachment.original_name",
        "attachment.content_type",
        "attachment.size_bytes",
      ])
      .where("message.id", "=", messageId)
      .where("message.conversation_id", "=", conversationId)
      .where("message.is_deleted", "=", false)
      .executeTakeFirst();
    if (!result) throw new NotFoundException("Attachment not found.");
    return {
      attachment: result,
      stream: createReadStream(join(config().uploadDir, "chat", conversationId, result.storage_key)),
    };
  }
}
