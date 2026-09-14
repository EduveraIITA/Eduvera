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

  async conversations(user: AuthUser) {
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
        attachment.content_type, attachment.size_bytes
      FROM chat_messages message
      JOIN users sender ON sender.id=message.sender_id
      LEFT JOIN chat_attachments attachment ON attachment.message_id=message.id
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

  async deleteMessage(user: AuthUser, conversationId: string, messageId: string) {
    await this.conversationForUser(user, conversationId);
    if (!uuid.safeParse(messageId).success) throw new NotFoundException("Message not found.");
    const message = await this.db.selectFrom("chat_messages").selectAll()
      .where("id", "=", messageId)
      .where("conversation_id", "=", conversationId)
      .executeTakeFirst();
    if (!message) throw new NotFoundException("Message not found.");
    if (message.sender_id !== user.id) throw new ForbiddenException("You can only delete messages you sent.");
    if (Date.now() - new Date(message.created_at).getTime() > 15 * 60_000) {
      throw new BadRequestException("Messages can be deleted for 15 minutes after sending.");
    }
    await this.db.updateTable("chat_messages").set({
      body: "",
      is_deleted: true,
      updated_at: new Date(),
    }).where("id", "=", messageId).execute();
    return { id: messageId, is_deleted: true };
  }

  async reportMessage(user: AuthUser, conversationId: string, messageId: string, body: unknown) {
    await this.conversationForUser(user, conversationId);
    const data = reportSchema.parse(body);
    const message = await this.db.selectFrom("chat_messages").select(["id", "sender_id"])
      .where("id", "=", messageId)
      .where("conversation_id", "=", conversationId)
      .executeTakeFirst();
    if (!message) throw new NotFoundException("Message not found.");
    if (message.sender_id === user.id) throw new BadRequestException("You cannot report your own message.");
    const report = await this.db.insertInto("chat_message_reports").values({
      message_id: messageId,
      reported_by: user.id,
      reason: data.reason,
      status: "open",
    }).onConflict((conflict) => conflict.columns(["message_id", "reported_by"]).doUpdateSet({
      reason: data.reason,
      status: "open",
    })).returning(["id", "status"]).executeTakeFirstOrThrow();
    return report;
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
    const postingMode = data.group_type === "parent_group" || data.group_type === "announcement" ? "moderators" : "all";
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
