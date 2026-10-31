var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
/* eslint-disable */
// @ts-nocheck
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { operatingRules } from "../operating-rules/rules.js";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile, readEnvironmentStoredFile } from "../common/environment-files.js";
import { basename, extname, join } from "node:path";
import { sql } from "kysely";
import { z } from "zod";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { messageConversationsHref, safeguardingReportAttentionHref, } from "./chat-links.js";
import { ChatModelBridgeService } from "./chat-model-bridge.service.js";
import { decodeChatMessageCursor, encodeChatMessageCursor } from "./chat-message-cursor.js";
import { decodeChatDirectoryCursor, encodeChatDirectoryCursor } from "./chat-directory-cursor.js";
import { assertChatPolicy, chatCampusRoles, conversationWritePolicy, directMessagingAllowed, evaluateChatWritePolicy, readChatPolicy } from "./chat-policy.js";
import { schoolPermission } from "../roles/authorization.js";
const uuid = z.string().uuid();
const createConversationSchema = z.object({
    school_id: uuid,
    recipient_id: uuid,
    student_id: uuid.optional(),
    title: z.string().trim().max(180).optional().default(""),
}).strict();
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
    school_id: uuid,
    student_id: uuid.optional(),
}).strict().refine((input) => new Set(input.member_ids).size === input.member_ids.length, {
    message: "Choose each group member once.",
    path: ["member_ids"],
});
const allowedAttachments = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
function displayName(user) {
    return `${user.first_name} ${user.last_name}`.trim();
}
function correlationId(value) {
    return value && uuid.safeParse(value).success ? value : randomUUID();
}
function conversationLink(conversationId, studentId, relationshipScope) {
    return messageConversationsHref({ conversationId, studentId, relationshipScope });
}
/**
 * Keep the user-facing inbox bounded, while making the attention projection
 * complete. Attention asks PostgreSQL only for unread conversations and does
 * not cap that obligation set; a busy user's older unread thread must not
 * disappear behind the 100 most recently active conversations.
 */
export function chatConversationProjectionQuery(userId, mode, scope = {}) {
    const unreadOnly = mode === "attention"
        ? sql `AND EXISTS (
        SELECT 1
        FROM chat_messages unread_filter
        WHERE unread_filter.conversation_id=c.id
          AND unread_filter.sender_id<>${userId}::uuid
          AND unread_filter.created_at>COALESCE(cp.last_read_at, cp.joined_at)
    )`
        : sql ``;
    const resultLimit = mode === "list" ? sql `LIMIT 100` : sql ``;
    const selectedConversation = mode === "detail"
        ? sql `AND c.id=${scope.conversationId ?? null}::uuid`
        : sql ``;
    const selectedStudent = (mode === "detail" || mode === "directory") && scope.studentId
        ? sql `AND (c.context_student_id IS NULL OR c.context_student_id=${scope.studentId}::uuid)`
        : sql ``;
    const selectedSchool = scope.schoolId ? sql `AND c.school_id=${scope.schoolId}::uuid` : sql ``;
    return sql `
    SELECT c.id, c.school_id, c.kind, c.context_student_id, c.group_type, c.posting_mode, c.created_at, c.updated_at,
      cp.participant_role,
      COALESCE(NULLIF(c.title, ''), (
        SELECT concat_ws(' ', other_user.first_name, other_user.last_name)
        FROM chat_participants other_participant
        JOIN users other_user ON other_user.id=other_participant.user_id
        WHERE other_participant.conversation_id=c.id
          AND other_participant.user_id<>${userId}::uuid
          AND other_participant.is_active
        ORDER BY other_participant.joined_at
        LIMIT 1
      ), 'Conversation') AS title,
      COALESCE((
        SELECT other_user.role
        FROM chat_participants other_participant
        JOIN users other_user ON other_user.id=other_participant.user_id
        WHERE other_participant.conversation_id=c.id
          AND other_participant.user_id<>${userId}::uuid
          AND other_participant.is_active
        ORDER BY other_participant.joined_at
        LIMIT 1
      ), 'staff') AS other_role,
      COALESCE((
        SELECT COALESCE(NULLIF(st.avatar_url,''),NULLIF(other_user.avatar_url,''))
        FROM chat_participants other_participant
        JOIN users other_user ON other_user.id=other_participant.user_id
        LEFT JOIN students st ON st.user_id=other_participant.user_id
        WHERE other_participant.conversation_id=c.id
          AND other_participant.user_id<>${userId}::uuid
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
          AND unread.sender_id<>${userId}::uuid
          AND unread.created_at>COALESCE(cp.last_read_at, cp.joined_at)
      ), 0)::int AS unread_count,
      (SELECT count(*)::int FROM chat_participants members WHERE members.conversation_id=c.id AND members.is_active
        AND chat_actor_is_current_participant(c.school_id,members.user_id,'messages.view',c.id)) AS member_count,
      CASE WHEN c.posting_mode='moderators' THEN EXISTS (
        SELECT 1 FROM chat_participants moderator WHERE moderator.conversation_id=c.id
          AND moderator.user_id=${userId}::uuid AND moderator.participant_role='moderator' AND moderator.is_active
      ) ELSE true END AS can_post
    FROM chat_conversations c
    JOIN chat_participants cp ON cp.conversation_id=c.id
      AND cp.user_id=${userId}::uuid AND cp.is_active
    JOIN school_memberships membership ON membership.school_id=c.school_id
      AND membership.user_id=${userId}::uuid AND membership.is_active
    LEFT JOIN LATERAL (
      SELECT message.* FROM chat_messages message
      WHERE message.conversation_id=c.id
      ORDER BY message.created_at DESC, message.id DESC LIMIT 1
    ) last_message ON true
    LEFT JOIN chat_attachments last_attachment ON last_attachment.message_id=last_message.id
    WHERE chat_actor_is_current_participant(c.school_id,${userId}::uuid,'messages.view',c.id)
      ${unreadOnly}
      ${selectedConversation}
      ${selectedStudent}
      ${selectedSchool}
    ${mode === "directory" ? sql `` : sql `ORDER BY COALESCE(last_message.created_at, c.created_at) DESC`}
    ${resultLimit}
  `;
}
let ChatService = class ChatService {
    db;
    events;
    model;
    constructor(db, events, model) {
        this.db = db;
        this.events = events;
        this.model = model;
    }
    async selectedSchoolId(user) {
        if (!uuid.safeParse(user.active_school_id).success)
            throw new ForbiddenException("Choose an institution first.");
        const roles = await chatCampusRoles(this.db, user.active_school_id, user.id);
        if (!roles.length)
            throw new ForbiddenException("No active membership in the selected institution.");
        return user.active_school_id;
    }
    async conversationForUser(user, conversationId, action = "messages.view") {
        if (!uuid.safeParse(conversationId).success)
            throw new NotFoundException("Conversation not found.");
        const schoolId = await this.selectedSchoolId(user);
        const result = await sql `
      SELECT c.*, cp.last_read_at, cp.joined_at, cp.is_muted
      FROM chat_conversations c
      JOIN chat_participants cp ON cp.conversation_id=c.id
      JOIN school_memberships membership ON membership.school_id=c.school_id
        AND membership.user_id=${user.id}::uuid AND membership.is_active
      WHERE c.id=${conversationId}::uuid AND cp.user_id=${user.id}::uuid AND cp.is_active
        AND c.school_id=${schoolId}::uuid
        AND chat_actor_is_current_participant(c.school_id,${user.id}::uuid,${action},c.id)
      LIMIT 1
    `.execute(this.db);
        const conversation = result.rows[0];
        if (!conversation)
            throw new NotFoundException("Conversation not found.");
        return conversation;
    }
    async assertStudentScope(db, schoolId, actorId, action, studentId) {
        const allowed = (await sql `SELECT chat_actor_has_student_scope(
      ${schoolId}::uuid,${actorId}::uuid,${action},${studentId}::uuid
    ) AS allowed`.execute(db)).rows[0]?.allowed;
        if (!allowed)
            throw new ForbiddenException("This learner is outside the current school relationship.");
    }
    async conversations(user, input) {
        const parsed = z.object({ pagination: z.literal("cursor").optional(), q: z.string().max(120).refine(value => !value.includes("\u0000")).transform(value => value.trim()).optional(), cursor: z.string().max(2048).optional(), student_id: z.string().uuid().optional() }).strict().safeParse(input ?? {});
        if (!parsed.success)
            throw new BadRequestException("Invalid conversation search or pagination.");
        const options = parsed.data;
        if (!options.pagination && (options.q !== undefined || options.cursor !== undefined || options.student_id !== undefined))
            throw new BadRequestException("Conversation search requires cursor pagination.");
        const schoolId = await this.selectedSchoolId(user);
        const search = (options.q ?? "").toLowerCase();
        const scope = { user_id: user.id, namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}`, search, student_id: options.student_id ?? null };
        const position = options.cursor === undefined ? undefined : decodeChatDirectoryCursor(options.cursor, scope);
        // Class groups/participants are source-owned projections. Reading or paging
        // the directory must never provision groups or rewrite a campus roster.
        if (options.pagination) {
            const result = await sql `WITH allowed AS (${chatConversationProjectionQuery(user.id, "directory", { studentId: options.student_id, schoolId })})
        SELECT *,to_char(last_message_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_activity_at FROM allowed
        WHERE ${search ? sql `strpos(lower(concat_ws(' ',title,student_name,last_message)),${search})>0` : sql `TRUE`}
          AND ${position ? sql `(last_message_at,id)<(${position.activity_at}::timestamptz,${position.id}::uuid)` : sql `TRUE`}
        ORDER BY last_message_at DESC,id DESC LIMIT 21`.execute(this.db);
            const hasMore = result.rows.length > 20, rows = result.rows.slice(0, 20), oldest = rows.at(-1);
            return { results: rows.map(({ cursor_activity_at, ...row }) => row), has_more: hasMore,
                next_cursor: hasMore && oldest ? encodeChatDirectoryCursor({ ...scope, activity_at: oldest.cursor_activity_at, id: oldest.id }) : null };
        }
        const result = await chatConversationProjectionQuery(user.id, "list", { schoolId }).execute(this.db);
        return { results: result.rows };
    }
    async conversation(user, conversationId, selectedStudentId) {
        if (!uuid.safeParse(conversationId).success)
            throw new NotFoundException("Conversation not found.");
        if (selectedStudentId && !uuid.safeParse(selectedStudentId).success) {
            throw new NotFoundException("Conversation not found.");
        }
        const schoolId = await this.selectedSchoolId(user);
        const result = await chatConversationProjectionQuery(user.id, "detail", {
            conversationId,
            schoolId,
            ...(selectedStudentId ? { studentId: selectedStudentId } : {}),
        }).execute(this.db);
        const conversation = result.rows[0];
        if (!conversation)
            throw new NotFoundException("Conversation not found.");
        const posting = await conversationWritePolicy(this.db, conversation, user.id);
        return { ...conversation, can_post: conversation.can_post && posting.allowed,
            posting_restriction: posting.allowed ? null : posting.reason ?? "Messaging is not currently available." };
    }
    /** Complete read-only unread projection used by composed attention endpoints. */
    async attentionConversations(user) {
        const result = await chatConversationProjectionQuery(user.id, "attention").execute(this.db);
        return { results: result.rows };
    }
    async recipients(user, requestedStudentId, purpose = "direct") {
        z.enum(["direct", "group"]).parse(purpose);
        if (requestedStudentId && !uuid.safeParse(requestedStudentId).success) {
            throw new BadRequestException("student_id must be a valid UUID.");
        }
        if (!user.active_school_id)
            throw new ForbiddenException("Choose an institution first.");
        if (purpose === "group")
            await schoolPermission(this.db, user, user.active_school_id, "groups.create");
        const memberships = await this.db.selectFrom("school_memberships")
            .select(["school_id", "role"])
            .where("user_id", "=", user.id)
            .where("school_id", "=", user.active_school_id)
            .where("is_active", "=", true)
            .execute();
        if (!memberships.length)
            throw new ForbiddenException("No active membership in the selected institution.");
        const policy = await readChatPolicy(this.db, user.active_school_id);
        const senderRoles = memberships.map((membership) => membership.role);
        const targetMemberships = (await sql `SELECT membership.user_id,array_agg(DISTINCT membership.role) AS roles
      FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${user.active_school_id}::uuid AND membership.is_active GROUP BY membership.user_id`.execute(this.db)).rows;
        const targetRoles = new Map(targetMemberships.map((row) => [row.user_id, row.roles]));
        const recipients = new Map();
        for (const membership of memberships) {
            let result;
            if (membership.role === "admin") {
                result = await sql `
          SELECT target.id, target.first_name, target.last_name, target.role,
            target_membership.role AS membership_role, school.id AS school_id, school.name AS school_name,
            student.id AS student_id, COALESCE(NULLIF(student.avatar_url,''),NULLIF(target.avatar_url,''),'') AS avatar_url
          FROM school_memberships target_membership
          JOIN users target ON target.id=target_membership.user_id AND target.is_active
          JOIN schools school ON school.id=target_membership.school_id
          LEFT JOIN students student ON student.user_id=target.id
          WHERE target_membership.school_id=${membership.school_id}::uuid
            AND target_membership.is_active AND target.id<>${user.id}::uuid
          ORDER BY target.first_name, target.last_name
        `.execute(this.db);
            }
            else if (membership.role === "staff") {
                result = await sql `
          SELECT DISTINCT target.id, target.first_name, target.last_name, target.role,
            target_membership.role AS membership_role, school.id AS school_id, school.name AS school_name,
            student.id AS student_id, COALESCE(NULLIF(student.avatar_url,''),NULLIF(target.avatar_url,''),'') AS avatar_url
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
                  WHERE enrollment.student_id=student.id AND enrollment.is_active
                    AND staff_has_class_permission(${membership.school_id}::uuid,${user.id}::uuid,'messages.view',enrollment.class_section_id)
                    AND (${requestedStudentId ?? null}::uuid IS NULL OR student.id=${requestedStudentId ?? null}::uuid)
                )
              )
              OR (
                target_membership.role='guardian'
                AND EXISTS (
                  SELECT 1 FROM parents parent
                  JOIN guardian_relationships relationship ON relationship.guardian_id=parent.id
                  JOIN enrollments enrollment ON enrollment.student_id=relationship.student_id AND enrollment.is_active
                  WHERE parent.user_id=target.id
                    AND staff_has_class_permission(${membership.school_id}::uuid,${user.id}::uuid,'messages.view',enrollment.class_section_id)
                    AND (${requestedStudentId ?? null}::uuid IS NULL OR relationship.student_id=${requestedStudentId ?? null}::uuid)
                )
              )
            )
          ORDER BY target.first_name, target.last_name
        `.execute(this.db);
            }
            else if (membership.role === "guardian") {
                result = await sql `
          SELECT DISTINCT target.id, target.first_name, target.last_name, target.role,
            target_membership.role AS membership_role, school.id AS school_id, school.name AS school_name,
            NULL::uuid AS student_id, target.avatar_url
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
                  WHERE parent.user_id=${user.id}::uuid
                    AND staff_has_class_permission(${membership.school_id}::uuid,target.id,'messages.view',enrollment.class_section_id)
                    AND (${requestedStudentId ?? null}::uuid IS NULL OR relationship.student_id=${requestedStudentId ?? null}::uuid)
                )
              )
            )
          ORDER BY target.first_name, target.last_name
        `.execute(this.db);
            }
            else {
                result = await sql `
          SELECT DISTINCT target.id, target.first_name, target.last_name, target.role,
            target_membership.role AS membership_role, school.id AS school_id, school.name AS school_name,
            NULL::uuid AS student_id, target.avatar_url
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
                  SELECT 1 WHERE staff_has_class_permission(${membership.school_id}::uuid,target.id,'messages.view',enrollment.class_section_id)
                )
              )
            )
          ORDER BY target.first_name, target.last_name
        `.execute(this.db);
            }
            for (const row of result.rows) {
                if (purpose === "direct" && !directMessagingAllowed(policy, senderRoles, targetRoles.get(row.id) ?? []))
                    continue;
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
    async createConversation(user, body, request) {
        const data = createConversationSchema.parse(body);
        if (!user.active_school_id || data.school_id !== user.active_school_id)
            throw new ForbiddenException("Switch to this institution first.");
        if (data.recipient_id === user.id)
            throw new BadRequestException("You cannot start a conversation with yourself.");
        const creatorMembership = await this.db.selectFrom("school_memberships")
            .select("role")
            .where("school_id", "=", data.school_id)
            .where("user_id", "=", user.id)
            .where("is_active", "=", true)
            .executeTakeFirst();
        if (!creatorMembership)
            throw new ForbiddenException("Choose a school where your membership is active.");
        const allowed = await this.recipients(user, data.student_id);
        const recipient = allowed.results.find((item) => item.id === data.recipient_id && item.school_id === data.school_id);
        if (!recipient)
            throw new ForbiddenException("This person is not available to message.");
        if (data.student_id) {
            await this.assertStudentScope(this.db, data.school_id, user.id, "messages.send", data.student_id);
            await this.assertStudentScope(this.db, data.school_id, recipient.id, "messages.view", data.student_id);
        }
        const existing = await sql `
      SELECT conversation.id
      FROM chat_conversations conversation
      WHERE conversation.school_id=${data.school_id}::uuid
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
        if (existing.rows[0])
            return { id: existing.rows[0].id, created: false };
        const conversation = await this.db.transaction().execute(async (tx) => {
            const policy = await readChatPolicy(tx, data.school_id, true);
            assertChatPolicy(evaluateChatWritePolicy({ policy, kind: "direct",
                senderRoles: await chatCampusRoles(tx, data.school_id, user.id),
                recipientRoles: [await chatCampusRoles(tx, data.school_id, recipient.id)] }));
            const activeMembers = (await sql `SELECT membership.user_id
        FROM school_memberships membership
        JOIN users account ON account.id=membership.user_id AND account.is_active
        WHERE membership.school_id=${data.school_id}::uuid
          AND membership.user_id=ANY(${[user.id, recipient.id]}::uuid[])
          AND membership.is_active
        GROUP BY membership.user_id`.execute(tx)).rows;
            if (activeMembers.length !== 2)
                throw new ForbiddenException("Both participants must be active members of this school.");
            if (data.student_id) {
                await this.assertStudentScope(tx, data.school_id, user.id, "messages.send", data.student_id);
                await this.assertStudentScope(tx, data.school_id, recipient.id, "messages.view", data.student_id);
            }
            const created = await tx.insertInto("chat_conversations").values({
                school_id: data.school_id,
                kind: "direct",
                title: data.title,
                context_student_id: data.student_id ?? null,
                created_by: user.id,
            }).returning("id").executeTakeFirstOrThrow();
            await tx.insertInto("chat_participants").values([
                { conversation_id: created.id, user_id: user.id, participant_role: "member" },
                { conversation_id: created.id, user_id: recipient.id, participant_role: "member" },
            ]).execute();
            const member = await tx.selectFrom("school_memberships").select("role").where("school_id", "=", data.school_id).where("user_id", "=", user.id).where("is_active", "=", true).executeTakeFirst();
            if (member?.role === 'staff' && !(await sql `SELECT staff_has_conversation_permission(${data.school_id}::uuid,${user.id}::uuid,'messages.send',${created.id}::uuid) AS allowed`.execute(tx)).rows[0]?.allowed)
                throw new ForbiddenException("This conversation is outside your assigned messaging access.");
            await tx.insertInto("audit_events").values({
                action: "chat.conversation.created",
                actor_id: user.id,
                school_id: data.school_id,
                target_type: "chat_conversation",
                target_id: created.id,
                request_id: request.requestId,
                ip_hash: null,
                metadata: { recipient_id: recipient.id, context_student_id: data.student_id ?? null },
            }).execute();
            const occurredAt = executionNow().toISOString();
            await this.model.record(tx, {
                school_id: data.school_id,
                actor_user_id: user.id,
                audience_user_ids: [recipient.id],
                event_type: "communication.conversation.created",
                source_record_id: created.id,
                conversation_id: created.id,
                occurred_at: occurredAt,
                correlation_id: correlationId(request.requestId),
                idempotency_key: `communication-conversation-created:${created.id}`,
                subject_kind: "conversation",
                subject_label: data.title || "Direct school conversation",
                payload: {
                    conversation_kind: "direct",
                    has_student_context: Boolean(data.student_id),
                    participant_count: 2,
                },
            });
            return created;
        });
        return { id: conversation.id, created: true };
    }
    async messages(user, conversationId, before, cursor, throughCursor) {
        const conversation = await this.conversationForUser(user, conversationId);
        const rules = await operatingRules(this.db, conversation.school_id);
        if (before !== undefined && cursor !== undefined)
            throw new BadRequestException("Use either before or cursor, not both.");
        if (before !== undefined && throughCursor !== undefined)
            throw new BadRequestException("Use either before or through_cursor, not both.");
        const namespaceId = executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${conversation.school_id}`;
        const position = cursor === undefined ? undefined : decodeChatMessageCursor(cursor, { conversation_id: conversationId, namespace_id: namespaceId });
        const through = throughCursor === undefined ? undefined : decodeChatMessageCursor(throughCursor, { conversation_id: conversationId, namespace_id: namespaceId });
        if (position && through && (through.created_at > position.created_at || (through.created_at === position.created_at && through.id.toLowerCase() >= position.id.toLowerCase()))) {
            throw new BadRequestException("through_cursor must be older than cursor.");
        }
        let beforeDate;
        if (before !== undefined) {
            if (typeof before !== "string" || before.length > 80)
                throw new BadRequestException("before must be an ISO timestamp.");
            beforeDate = new Date(before);
            if (Number.isNaN(beforeDate.getTime()))
                throw new BadRequestException("before must be an ISO timestamp.");
        }
        const boundary = position
            ? sql `(message.created_at,message.id)<(${position.created_at}::timestamptz,${position.id}::uuid)`
            : beforeDate ? sql `message.created_at<${beforeDate}::timestamptz` : sql `TRUE`;
        const result = await sql `
      SELECT message.id, message.conversation_id, message.sender_id, message.client_id,
        CASE WHEN message.is_deleted THEN '' ELSE message.body END AS body,
        message.message_type, message.reply_to_id, message.is_deleted,
        message.created_at, message.updated_at,
        to_char(message.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
        ${through ? sql `CASE WHEN (message.created_at,message.id)=(${through.created_at}::timestamptz,${through.id}::uuid) THEN 0 WHEN (message.created_at,message.id)<(${through.created_at}::timestamptz,${through.id}::uuid) THEN -1 ELSE 1 END` : sql `1`} AS through_relation,
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
        AND ${boundary}
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT 51
    `.execute(this.db);
        // Refresh an already displayed window through its stable lower frontier.
        // Compare in PostgreSQL so microseconds and even a physically removed
        // boundary remain precise. Never pull older rows into that window.
        const crossing = through ? result.rows.findIndex((row) => row.through_relation <= 0) : -1;
        const reachedThrough = Boolean(through && ((crossing >= 0 && (crossing < 50 || result.rows[crossing].through_relation < 0)) || result.rows.length <= 50));
        const end = reachedThrough && crossing >= 0 ? crossing + (result.rows[crossing].through_relation === 0 ? 1 : 0) : 50;
        const page = result.rows.slice(0, Math.min(50, end));
        const oldest = page.at(-1);
        const boundaryCursor = reachedThrough ? throughCursor : oldest ? encodeChatMessageCursor({ conversation_id: conversationId, namespace_id: namespaceId, created_at: oldest.cursor_created_at, id: oldest.id }) : null;
        const hasMore = reachedThrough ? crossing >= 0 && (result.rows[crossing].through_relation < 0 || result.rows.length > crossing + 1) : result.rows.length > 50;
        return {
            results: page.reverse().map((row) => ({
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
                editable_until: new Date(new Date(row.created_at).getTime() + rules.message_edit_minutes * 60_000).toISOString(),
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
            has_more: hasMore,
            next_cursor: hasMore ? boundaryCursor : null,
            boundary_cursor: boundaryCursor,
            reached_through: reachedThrough,
        };
    }
    async send(user, conversationId, input, upload, request) {
        const conversation = await this.conversationForUser(user, conversationId, "messages.send");
        const data = messageSchema.parse(input);
        const restriction = await this.db.selectFrom("chat_messaging_restrictions")
            .select(["id", "expires_at"])
            .where("school_id", "=", conversation.school_id)
            .where("user_id", "=", user.id)
            .where("revoked_at", "is", null)
            .where("expires_at", ">", executionNow())
            .orderBy("expires_at", "desc")
            .executeTakeFirst();
        if (restriction) {
            throw new ForbiddenException(`Messaging is restricted by school staff until ${new Date(restriction.expires_at).toLocaleString("en-IN")}.`);
        }
        if (!data.body && !upload)
            throw new BadRequestException("Enter a message or attach a file.");
        if (data.reply_to_id) {
            const reply = await this.db.selectFrom("chat_messages").select("id")
                .where("id", "=", data.reply_to_id)
                .where("conversation_id", "=", conversationId)
                .executeTakeFirst();
            if (!reply)
                throw new BadRequestException("The replied-to message is not in this conversation.");
        }
        const clientId = data.client_id ?? randomUUID();
        const existing = await this.db.selectFrom("chat_messages").select("id")
            .where("conversation_id", "=", conversationId)
            .where("client_id", "=", clientId)
            .executeTakeFirst();
        if (existing)
            return { id: existing.id, duplicate: true };
        let storedPath;
        let storageKey;
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
                assertChatPolicy(await conversationWritePolicy(tx, conversation, user.id, Boolean(upload), true));
                const rules = await operatingRules(tx, conversation.school_id);
                if (upload && (!allowedAttachments.has(upload.mimetype) || upload.data.length === 0 || upload.data.length > rules.message_attachment_mb * 1024 * 1024)) {
                    throw new BadRequestException(`Attachments must be an image, PDF, DOC, or DOCX file up to ${rules.message_attachment_mb} MB.`);
                }
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
                const targets = (await sql `
          SELECT target.id,
            CASE
              WHEN ${conversation.context_student_id ?? null}::uuid IS NULL THEN NULL
              WHEN EXISTS (
                SELECT 1
                FROM students student
                WHERE student.id=${conversation.context_student_id ?? null}::uuid
                  AND student.school_id=${conversation.school_id}::uuid
                  AND student.user_id=target.id
              ) THEN 'self'
              WHEN EXISTS (
                SELECT 1
                FROM parents guardian
                JOIN guardian_relationships relationship ON relationship.guardian_id=guardian.id
                WHERE guardian.user_id=target.id
                  AND relationship.school_id=${conversation.school_id}::uuid
                  AND relationship.student_id=${conversation.context_student_id ?? null}::uuid
              ) THEN 'dependent'
              ELSE NULL
            END::text AS relationship_scope
          FROM chat_participants participant
          JOIN users target ON target.id=participant.user_id
          WHERE participant.conversation_id=${conversationId}::uuid
            AND participant.user_id<>${user.id}::uuid
            AND participant.is_active
            AND chat_actor_is_current_participant(
              ${conversation.school_id}::uuid,target.id,'messages.view',${conversationId}::uuid
            )
        `.execute(tx)).rows;
                if (targets.length) {
                    await tx.insertInto("notifications").values(targets.map((target) => ({
                        recipient_id: target.id,
                        kind: "general",
                        title: `New message from ${displayName(user)}`,
                        body: data.body ? data.body.slice(0, 180) : `Attachment: ${basename(upload?.filename ?? "File")}`,
                        link: conversationLink(conversationId, conversation.context_student_id, target.relationship_scope),
                        metadata: {
                            conversation_id: conversationId,
                            student_id: conversation.context_student_id,
                            relationship_scope: target.relationship_scope,
                            notification_scope: "chat_conversation",
                        },
                    }))).execute();
                }
                await this.events.enqueueUserEvent(tx, {
                    schoolId: conversation.school_id,
                    eventType: "chat.updated",
                    aggregateType: "chat_conversation",
                    aggregateId: conversationId,
                    audienceUserIds: [user.id, ...targets.map((target) => target.id)],
                    payload: {
                        conversation_id: conversationId,
                        change_kind: "message_sent",
                        refresh: ["messages", "notifications", "attention"],
                    },
                    idempotencyKey: `chat:message:${message.id}`,
                });
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
                await this.model.record(tx, {
                    school_id: conversation.school_id,
                    actor_user_id: user.id,
                    audience_user_ids: targets.map((target) => target.id),
                    event_type: "communication.message.sent",
                    source_record_id: message.id,
                    conversation_id: conversationId,
                    occurred_at: message.created_at.toISOString(),
                    correlation_id: correlationId(request.requestId),
                    idempotency_key: `communication-message-sent:${message.id}`,
                    subject_kind: "communication_message",
                    subject_label: "School message",
                    payload: {
                        conversation_kind: conversation.kind,
                        has_student_context: Boolean(conversation.context_student_id),
                        has_attachment: Boolean(upload),
                        is_reply: Boolean(data.reply_to_id),
                        recipient_count: targets.length,
                    },
                });
                return message;
            });
            return { id: created.id, created_at: created.created_at, duplicate: false };
        }
        catch (error) {
            if (storedPath)
                await unlink(storedPath).catch(() => undefined);
            throw error;
        }
    }
    async markRead(user, conversationId, request) {
        const conversation = await this.conversationForUser(user, conversationId);
        const readAt = executionNow();
        await this.db.transaction().execute(async (tx) => {
            await tx.updateTable("chat_participants").set({ last_read_at: readAt })
                .where("conversation_id", "=", conversationId)
                .where("user_id", "=", user.id)
                .execute();
            await sql `
        UPDATE notifications SET read_at=${readAt}
        WHERE recipient_id=${user.id}::uuid AND read_at IS NULL
          AND metadata->>'conversation_id'=${conversationId}
      `.execute(tx);
            await this.events.enqueueUserEvent(tx, {
                schoolId: conversation.school_id,
                eventType: "chat.updated",
                aggregateType: "chat_conversation",
                aggregateId: conversationId,
                audienceUserIds: [user.id],
                payload: {
                    conversation_id: conversationId,
                    change_kind: "read",
                    refresh: ["messages", "notifications", "attention"],
                },
                idempotencyKey: `chat:read:${request?.requestId ?? randomUUID()}:${conversationId}:${user.id}`,
            });
            await this.model.record(tx, {
                school_id: conversation.school_id,
                actor_user_id: user.id,
                audience_user_ids: [],
                event_type: "communication.conversation.read",
                source_record_id: conversationId,
                conversation_id: conversationId,
                occurred_at: readAt.toISOString(),
                correlation_id: correlationId(request?.requestId),
                idempotency_key: `communication-conversation-read:${conversationId}:${user.id}:${request?.requestId ?? readAt.toISOString()}`,
                subject_kind: "conversation",
                subject_label: "School conversation",
                payload: { read_through: readAt.toISOString() },
            });
        });
        return { conversation_id: conversationId, read_at: readAt };
    }
    async editMessage(user, conversationId, messageId, body, request) {
        const conversation = await this.conversationForUser(user, conversationId, "messages.send");
        if (!uuid.safeParse(messageId).success)
            throw new NotFoundException("Message not found.");
        const data = editMessageSchema.parse(body);
        return this.db.transaction().execute(async (tx) => {
            assertChatPolicy(await conversationWritePolicy(tx, conversation, user.id, false, true));
            const rules = await operatingRules(tx, conversation.school_id);
            const message = await tx.selectFrom("chat_messages").selectAll()
                .where("id", "=", messageId)
                .where("conversation_id", "=", conversationId)
                .forUpdate()
                .executeTakeFirst();
            if (!message)
                throw new NotFoundException("Message not found.");
            if (message.sender_id !== user.id)
                throw new ForbiddenException("You can only edit messages you sent.");
            if (message.message_type === "system" || rules.message_edit_minutes === 0 || executionNow().getTime() - new Date(message.created_at).getTime() >= rules.message_edit_minutes * 60_000) {
                throw new BadRequestException(`Messages can only be edited for ${rules.message_edit_minutes} minutes after sending.`);
            }
            const edited = await tx.updateTable("chat_messages")
                .set({ body: data.body, updated_at: executionNow() })
                .where("id", "=", messageId)
                .where("conversation_id", "=", conversationId)
                .returning(["id", "updated_at"])
                .executeTakeFirstOrThrow();
            const audience = await tx.selectFrom("chat_participants as participant")
                .innerJoin("users as account", "account.id", "participant.user_id")
                .select("participant.user_id")
                .where("participant.conversation_id", "=", conversationId)
                .where("participant.is_active", "=", true)
                .where("account.is_active", "=", true)
                .where(sql `chat_actor_is_current_participant(
          ${conversation.school_id}::uuid,participant.user_id,'messages.view',${conversationId}::uuid
        )`)
                .execute();
            await this.events.enqueueUserEvent(tx, {
                schoolId: conversation.school_id,
                eventType: "chat.updated",
                aggregateType: "chat_conversation",
                aggregateId: conversationId,
                audienceUserIds: audience.map((participant) => participant.user_id),
                payload: {
                    conversation_id: conversationId,
                    message_id: messageId,
                    change_kind: "message_edited",
                    refresh: ["messages", "notifications", "attention"],
                },
                idempotencyKey: `chat:message-edit:${messageId}:${edited.updated_at.toISOString()}`,
            });
            await tx.insertInto("audit_events").values({
                action: "chat.message.edited",
                actor_id: user.id,
                school_id: conversation.school_id,
                target_type: "chat_message",
                target_id: messageId,
                request_id: request?.requestId ?? randomUUID(),
                ip_hash: null,
                metadata: { conversation_id: conversationId },
            }).execute();
            await this.model.record(tx, {
                school_id: conversation.school_id,
                actor_user_id: user.id,
                audience_user_ids: audience.map((participant) => participant.user_id).filter((id) => id !== user.id),
                event_type: "communication.message.edited",
                source_record_id: messageId,
                conversation_id: conversationId,
                occurred_at: edited.updated_at.toISOString(),
                correlation_id: correlationId(request?.requestId),
                idempotency_key: `communication-message-edited:${messageId}:${edited.updated_at.toISOString()}`,
                subject_kind: "communication_message",
                subject_label: "School message",
                payload: { conversation_kind: conversation.kind },
            });
            return { id: edited.id, edited: true, updated_at: edited.updated_at };
        });
    }
    async reportMessage(user, conversationId, messageId, body, request) {
        const conversation = await this.conversationForUser(user, conversationId);
        const data = reportSchema.parse(body);
        const message = await this.db.selectFrom("chat_messages").select(["id", "sender_id"])
            .where("id", "=", messageId)
            .where("conversation_id", "=", conversationId)
            .executeTakeFirst();
        if (!message)
            throw new NotFoundException("Message not found.");
        if (message.sender_id === user.id)
            throw new BadRequestException("You cannot report your own message.");
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
                updated_at: executionNow(),
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
                    kind: "general",
                    title: "New reported chat message",
                    body: "A message needs review in the safeguarding queue.",
                    link: safeguardingReportAttentionHref("principal", saved.id),
                    metadata: {
                        report_id: saved.id,
                        conversation_id: conversationId,
                        notification_scope: "chat_report_review",
                    },
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
    async reports(user, status) {
        if (user.role !== "admin" && user.role !== "staff") {
            throw new ForbiddenException("Only authorised school staff can access message reports.");
        }
        const parsedStatus = status ? reportStatusSchema.safeParse(status) : undefined;
        if (parsedStatus && !parsedStatus.success)
            throw new BadRequestException("Invalid report status.");
        const selectedStatus = parsedStatus?.success ? parsedStatus.data : null;
        const result = await sql `
      SELECT report.id, report.message_id, report.reported_by, report.reason, report.status,
        report.assigned_to, report.reviewed_by, report.resolution_note, report.action_taken,
        report.created_at, report.updated_at, report.resolved_at,
        conversation.id AS conversation_id, conversation.title AS conversation_title,
        conversation.context_student_id,
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
        const summaryResult = await sql `
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
        for (const row of summaryResult.rows)
            summary[row.status] = Number(row.count);
        return {
            results: result.rows.map((row) => ({
                ...row,
                can_assign: row.reviewer_role === "admin",
                context_messages: Array.isArray(row.context_messages) ? row.context_messages : [],
            })),
            summary,
        };
    }
    async report(user, reportId) {
        if (user.role !== "admin" && user.role !== "staff") {
            throw new ForbiddenException("Only authorised school staff can access message reports.");
        }
        if (!uuid.safeParse(reportId).success)
            throw new NotFoundException("Report not found.");
        const result = await sql `
      SELECT report.id, report.message_id, report.reported_by, report.reason, report.status,
        report.assigned_to, report.reviewed_by, report.resolution_note, report.action_taken,
        report.created_at, report.updated_at, report.resolved_at,
        conversation.id AS conversation_id, conversation.title AS conversation_title,
        conversation.context_student_id,
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
      WHERE report.id=${reportId}::uuid
        AND (
          current_membership.role='admin'
          OR (current_membership.role='staff' AND report.assigned_to=${user.id}::uuid)
        )
      LIMIT 1
    `.execute(this.db);
        const row = result.rows[0];
        if (!row)
            throw new NotFoundException("Report not found.");
        return {
            ...row,
            can_assign: row.reviewer_role === "admin",
            context_messages: Array.isArray(row.context_messages) ? row.context_messages : [],
        };
    }
    async reportReviewers(user) {
        if (user.role !== "admin") {
            throw new ForbiddenException("Only school administrators can assign message reports.");
        }
        const result = await sql `
      SELECT DISTINCT target.id, concat_ws(' ', target.first_name, target.last_name) AS name,
        target_membership.role
      FROM school_memberships current_membership
      JOIN school_memberships target_membership ON target_membership.school_id=current_membership.school_id
        AND target_membership.is_active AND target_membership.role IN ('admin', 'staff')
      JOIN users target ON target.id=target_membership.user_id AND target.is_active
      WHERE current_membership.user_id=${user.id}::uuid
        AND current_membership.is_active AND current_membership.role='admin'
        AND (
          target_membership.role='admin'
          OR EXISTS (
            SELECT 1
            FROM staff_role_bindings binding
            WHERE binding.school_id=target_membership.school_id
              AND binding.user_id=target_membership.user_id
              AND binding.role_active
              AND binding.status='active'
              AND 'safeguarding.review'=ANY(binding.permissions)
              AND binding.starts_on<=current_date
              AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)
          )
        )
      ORDER BY name
    `.execute(this.db);
        return { results: result.rows };
    }
    async updateReport(user, reportId, body, request) {
        if (!uuid.safeParse(reportId).success)
            throw new NotFoundException("Report not found.");
        const data = moderationUpdateSchema.parse(body);
        const reportResult = await sql `
      SELECT report.*, message.sender_id, message.conversation_id,
        conversation.school_id, conversation.context_student_id, current_membership.role AS reviewer_role,
        CASE
          WHEN conversation.context_student_id IS NULL THEN NULL
          WHEN EXISTS (
            SELECT 1 FROM students student
            WHERE student.id=conversation.context_student_id
              AND student.school_id=conversation.school_id
              AND student.user_id=message.sender_id
          ) THEN 'self'
          WHEN EXISTS (
            SELECT 1 FROM parents guardian
            JOIN guardian_relationships relationship ON relationship.guardian_id=guardian.id
            WHERE guardian.user_id=message.sender_id
              AND relationship.school_id=conversation.school_id
              AND relationship.student_id=conversation.context_student_id
          ) THEN 'dependent'
          ELSE NULL
        END::text AS sender_relationship_scope,
        CASE
          WHEN conversation.context_student_id IS NULL THEN NULL
          WHEN EXISTS (
            SELECT 1 FROM students student
            WHERE student.id=conversation.context_student_id
              AND student.school_id=conversation.school_id
              AND student.user_id=report.reported_by
          ) THEN 'self'
          WHEN EXISTS (
            SELECT 1 FROM parents guardian
            JOIN guardian_relationships relationship ON relationship.guardian_id=guardian.id
            WHERE guardian.user_id=report.reported_by
              AND relationship.school_id=conversation.school_id
              AND relationship.student_id=conversation.context_student_id
          ) THEN 'dependent'
          ELSE NULL
        END::text AS reporter_relationship_scope
      FROM chat_message_reports report
      JOIN chat_messages message ON message.id=report.message_id
      JOIN chat_conversations conversation ON conversation.id=message.conversation_id
      JOIN school_memberships current_membership ON current_membership.school_id=conversation.school_id
        AND current_membership.user_id=${user.id}::uuid AND current_membership.is_active
      WHERE report.id=${reportId}::uuid
      LIMIT 1
    `.execute(this.db);
        const report = reportResult.rows[0];
        if (!report)
            throw new NotFoundException("Report not found.");
        const isAdmin = report.reviewer_role === "admin";
        const isAssignedStaff = report.reviewer_role === "staff" && report.assigned_to === user.id;
        if (!isAdmin && !isAssignedStaff)
            throw new ForbiddenException("This report is not assigned to you.");
        const hasReviewerConflict = report.sender_id === user.id || report.reported_by === user.id;
        if (report.status === "resolved" || report.status === "dismissed") {
            throw new BadRequestException("This report is already closed.");
        }
        let assignee = report.assigned_to;
        if (Object.prototype.hasOwnProperty.call(data, "assigned_to")) {
            if (!isAdmin)
                throw new ForbiddenException("Only administrators can assign reports.");
            assignee = data.assigned_to ?? null;
            if (assignee) {
                if (assignee === report.sender_id || assignee === report.reported_by) {
                    throw new BadRequestException("Choose an independent reviewer for this report.");
                }
                const eligible = (await sql `
          SELECT account.id, membership.role
          FROM school_memberships membership
          JOIN users account
            ON account.id=membership.user_id
            AND account.is_active
          WHERE membership.school_id=${report.school_id}::uuid
            AND membership.user_id=${assignee}::uuid
            AND membership.role IN ('admin','staff')
            AND membership.is_active
            AND (
              membership.role='admin'
              OR EXISTS (
                SELECT 1
                FROM staff_role_bindings binding
                WHERE binding.school_id=membership.school_id
                  AND binding.user_id=membership.user_id
                  AND binding.role_active
                  AND binding.status='active'
                  AND 'safeguarding.review'=ANY(binding.permissions)
                  AND binding.starts_on<=current_date
                  AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)
              )
            )
          LIMIT 1
        `.execute(this.db)).rows[0];
                if (!eligible)
                    throw new BadRequestException("Choose an authorised staff member.");
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
        if (requestedAction === "warning" || requestedAction === "restrict")
            nextStatus = "resolved";
        if (requestedAction === "escalate")
            nextStatus = "under_review";
        if (nextStatus === "under_review" && !assignee)
            assignee = user.id;
        if (nextStatus === "dismissed") {
            if (!data.note)
                throw new BadRequestException("Add a note before dismissing a report.");
        }
        if ((nextStatus === "resolved" || requestedAction === "warning" || requestedAction === "restrict" || requestedAction === "escalate") && !data.note) {
            throw new BadRequestException("Add a review note before taking this action.");
        }
        if (requestedAction === "restrict" && !data.restriction_days) {
            throw new BadRequestException("Choose a restriction period.");
        }
        const actionTaken = nextStatus === "dismissed" ? "no_action" : requestedAction;
        const resolvedAt = nextStatus === "resolved" || nextStatus === "dismissed" ? executionNow() : null;
        const updated = await this.db.transaction().execute(async (tx) => {
            const saved = await tx.updateTable("chat_message_reports").set({
                status: nextStatus,
                assigned_to: assignee,
                reviewed_by: user.id,
                resolution_note: data.note || report.resolution_note || "",
                action_taken: actionTaken,
                updated_at: executionNow(),
                resolved_at: resolvedAt,
            }).where("id", "=", reportId).returningAll().executeTakeFirstOrThrow();
            if (requestedAction === "restrict") {
                const expiresAt = new Date(executionNow().getTime() + (data.restriction_days ?? 7) * 24 * 60 * 60 * 1000);
                await tx.insertInto("chat_messaging_restrictions").values({
                    school_id: report.school_id,
                    user_id: report.sender_id,
                    report_id: reportId,
                    reason: data.note,
                    expires_at: expiresAt,
                    created_by: user.id,
                }).execute();
            }
            const notifications = [];
            if (assignee && assignee !== report.assigned_to && assignee !== user.id) {
                const target = await tx.selectFrom("users").select(["id", "role"]).where("id", "=", assignee).executeTakeFirst();
                const targetPortal = target?.role === "staff" ? "teacher"
                    : target?.role === "admin" ? "principal" : null;
                if (target && targetPortal)
                    notifications.push({
                        recipient_id: target.id, kind: "general", title: "Chat report assigned",
                        body: "A reported message has been assigned to you for review.",
                        link: safeguardingReportAttentionHref(targetPortal, reportId),
                        metadata: {
                            report_id: reportId,
                            conversation_id: report.conversation_id,
                            notification_scope: "chat_report_review",
                        },
                    });
            }
            if (requestedAction === "warning") {
                notifications.push({
                    recipient_id: report.sender_id, kind: "general", title: "Messaging conduct warning",
                    body: "School staff reviewed a message and issued a conduct warning.",
                    link: conversationLink(report.conversation_id, report.context_student_id, report.sender_relationship_scope),
                    metadata: {
                        report_id: reportId,
                        conversation_id: report.conversation_id,
                        student_id: report.context_student_id,
                        relationship_scope: report.sender_relationship_scope,
                        notification_scope: "chat_conversation",
                    },
                });
            }
            if (requestedAction === "restrict") {
                notifications.push({
                    recipient_id: report.sender_id, kind: "general", title: "Messaging temporarily restricted",
                    body: `School staff restricted messaging for ${data.restriction_days ?? 7} day(s).`,
                    link: conversationLink(report.conversation_id, report.context_student_id, report.sender_relationship_scope),
                    metadata: {
                        report_id: reportId,
                        conversation_id: report.conversation_id,
                        student_id: report.context_student_id,
                        relationship_scope: report.sender_relationship_scope,
                        notification_scope: "chat_conversation",
                    },
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
                    link: safeguardingReportAttentionHref("principal", reportId),
                    metadata: {
                        report_id: reportId,
                        conversation_id: report.conversation_id,
                        notification_scope: "chat_report_review",
                    },
                })));
            }
            if (nextStatus === "resolved" || nextStatus === "dismissed") {
                notifications.push({
                    recipient_id: report.reported_by, kind: "general",
                    title: nextStatus === "resolved" ? "Message report resolved" : "Message report reviewed",
                    body: "Authorised school staff completed their review.",
                    link: conversationLink(report.conversation_id, report.context_student_id, report.reporter_relationship_scope),
                    metadata: {
                        report_id: reportId,
                        conversation_id: report.conversation_id,
                        student_id: report.context_student_id,
                        relationship_scope: report.reporter_relationship_scope,
                        notification_scope: "chat_conversation",
                    },
                });
            }
            if (notifications.length)
                await tx.insertInto("notifications").values(notifications).execute();
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
    async policyForUser(user) {
        if (!user.active_school_id)
            throw new ForbiddenException("Choose an institution first.");
        const roles = await chatCampusRoles(this.db, user.active_school_id, user.id);
        if (!roles.length)
            throw new ForbiddenException("No active membership in the selected institution.");
        return { ...await readChatPolicy(this.db, user.active_school_id), can_manage: roles.includes("admin") };
    }
    async createGroup(user, body, request) {
        const data = groupSchema.parse(body);
        const membership = await this.db.selectFrom("school_memberships")
            .select(["school_id", "role"])
            .where("school_id", "=", data.school_id)
            .where("user_id", "=", user.id)
            .where("is_active", "=", true)
            .where("role", "in", ["staff", "admin"])
            .executeTakeFirst();
        if (!membership)
            throw new ForbiddenException("Only teachers and administrators can create groups.");
        if ((data.group_type === "staff" || data.group_type === "announcement") && membership.role !== "admin")
            throw new ForbiddenException("Only administrators can create this group type.");
        const schoolId = data.school_id;
        const members = await sql `
      SELECT membership.user_id,array_agg(DISTINCT membership.role) AS roles
      FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid
        AND membership.user_id=ANY(${data.member_ids}::uuid[])
        AND membership.is_active
      GROUP BY membership.user_id
    `.execute(this.db);
        if (members.rows.length !== data.member_ids.length)
            throw new ForbiddenException("Every group member must be an active member of the school.");
        const allowed = { student_group: ["student", "staff", "admin"], parent_group: ["guardian", "staff", "admin"], activity: ["student", "guardian", "staff", "admin"], staff: ["staff", "admin"], announcement: ["student", "guardian", "staff", "admin"], child_support: ["student", "guardian", "staff", "admin"] };
        if (members.rows.some((member) => !member.roles.some((role) => allowed[data.group_type].includes(role))))
            throw new ForbiddenException("One or more selected members are not eligible for this group type.");
        if (data.student_id) {
            await this.assertStudentScope(this.db, schoolId, user.id, "groups.create", data.student_id);
            for (const memberId of data.member_ids) {
                await this.assertStudentScope(this.db, schoolId, memberId, "messages.view", data.student_id);
            }
        }
        const postingMode = data.group_type === "parent_group" || data.group_type === "announcement" ? "moderators" : "all";
        const created = await this.db.transaction().execute(async (tx) => {
            const currentMembers = await sql `
        SELECT membership.user_id
        FROM school_memberships membership
        JOIN users account ON account.id=membership.user_id AND account.is_active
        WHERE membership.school_id=${schoolId}::uuid
          AND membership.user_id=ANY(${[user.id, ...data.member_ids]}::uuid[])
          AND membership.is_active
        GROUP BY membership.user_id
      `.execute(tx);
            if (currentMembers.rows.length !== new Set([user.id, ...data.member_ids]).size) {
                throw new ForbiddenException("Every group member must be an active member of the school.");
            }
            if (data.student_id) {
                await this.assertStudentScope(tx, schoolId, user.id, "groups.create", data.student_id);
                for (const memberId of data.member_ids) {
                    await this.assertStudentScope(tx, schoolId, memberId, "messages.view", data.student_id);
                }
            }
            const conversation = await tx.insertInto("chat_conversations").values({ school_id: schoolId, kind: data.group_type === "announcement" ? "announcement" : "group", title: data.title, context_student_id: data.student_id ?? null, created_by: user.id, group_type: data.group_type, posting_mode: postingMode }).returning("id").executeTakeFirstOrThrow();
            const rows = [{ conversation_id: conversation.id, user_id: user.id, participant_role: "moderator" }, ...data.member_ids.filter((id) => id !== user.id).map((id) => ({ conversation_id: conversation.id, user_id: id, participant_role: "member" }))];
            await tx.insertInto("chat_participants").values(rows).execute();
            if (membership.role === 'staff' && !(await sql `SELECT staff_has_conversation_permission(${schoolId}::uuid,${user.id}::uuid,'groups.create',${conversation.id}::uuid) AS allowed`.execute(tx)).rows[0]?.allowed)
                throw new ForbiddenException("Choose members within your assigned class scope.");
            await tx.insertInto("chat_messages").values({ conversation_id: conversation.id, sender_id: user.id, body: "Group created. Please keep communication respectful and school-related.", message_type: "system", client_id: randomUUID() }).execute();
            await tx.insertInto("audit_events").values({ action: "chat.group.created", actor_id: user.id, school_id: schoolId, target_type: "chat_conversation", target_id: conversation.id, request_id: request.requestId, ip_hash: null, metadata: { group_type: data.group_type, member_count: rows.length } }).execute();
            return conversation;
        });
        return { id: created.id };
    }
    async attachment(user, conversationId, messageId) {
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
        if (!result)
            throw new NotFoundException("Attachment not found.");
        const file = await readEnvironmentStoredFile(join(config().uploadDir, "chat", conversationId, result.storage_key), result.content_type, result.original_name);
        return { ...file, attachment: { ...result, content_type: file.content_type, original_name: file.original_name,
                size_bytes: file.size_bytes ?? result.size_bytes } };
    }
};
ChatService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [DatabaseService,
        SchoolEventService,
        ChatModelBridgeService])
], ChatService);
export { ChatService };
//# sourceMappingURL=chat.service.js.map