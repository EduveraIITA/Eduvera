import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { sql } from "kysely";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
/** One read contract over the Messaging category of institution Operating rules.
 * Missing rows use the same historical, typed defaults without creating configuration.
 * Only OperatingRulesController owns changes to these values. */
export const DEFAULT_CHAT_POLICY = {
    student_teacher_direct_enabled: true,
    guardian_teacher_direct_enabled: true,
    student_group_replies: true,
    guardian_group_replies: false,
    attachments_enabled: true,
    enforce_communication_hours: false,
    communication_start: "06:00",
    communication_end: "21:00",
    retention_days: 455,
    revision: 0,
};
export async function readChatPolicy(db, schoolId, lock = false) {
    // The shared institution row serializes rule changes even when chat_policies
    // has not been configured yet. All OperatingRules writers lock that same row.
    if (lock)
        await sql `SELECT id FROM schools WHERE id=${schoolId}::uuid FOR SHARE`.execute(db);
    const row = (await sql `SELECT school.id AS school_id,school.timezone,
      COALESCE(policy.student_teacher_direct_enabled,true) AS student_teacher_direct_enabled,
      COALESCE(policy.guardian_teacher_direct_enabled,true) AS guardian_teacher_direct_enabled,
      COALESCE(policy.student_group_replies,true) AS student_group_replies,
      COALESCE(policy.guardian_group_replies,false) AS guardian_group_replies,
      COALESCE(policy.attachments_enabled,true) AS attachments_enabled,
      COALESCE(policy.enforce_communication_hours,false) AS enforce_communication_hours,
      COALESCE(to_char(policy.communication_start,'HH24:MI'),'06:00') AS communication_start,
      COALESCE(to_char(policy.communication_end,'HH24:MI'),'21:00') AS communication_end,
      COALESCE(policy.retention_days,455)::int AS retention_days,
      COALESCE(policy.revision,0)::int AS revision
    FROM schools school LEFT JOIN chat_policies policy ON policy.school_id=school.id
    WHERE school.id=${schoolId}::uuid`.execute(db)).rows[0];
    if (!row)
        throw new NotFoundException("Institution not found.");
    return row;
}
/** Campus membership, not the global signup role, governs this conversation. */
export async function chatCampusRoles(db, schoolId, userId) {
    const rows = (await sql `SELECT membership.role
    FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${userId}::uuid AND membership.is_active`
        .execute(db)).rows;
    return rows.map((row) => row.role);
}
export function directMessagingAllowed(policy, left, right) {
    const pairs = [[left, right], [right, left]];
    return pairs.every(([learner, teacher]) => {
        // These settings explicitly concern teaching/staff direct pairs, not all
        // campus conversations. An additional admin role grants no policy bypass.
        if (!teacher.includes("staff"))
            return true;
        return (!learner.includes("student") || policy.student_teacher_direct_enabled)
            && (!learner.includes("guardian") || policy.guardian_teacher_direct_enabled);
    });
}
/** Local wall time uses the owning institution zone and selected-world clock.
 * Start is inclusive, end exclusive; overnight ranges wrap; equal means all day. */
export function communicationHoursOpen(policy, now = executionNow()) {
    if (!policy.enforce_communication_hours)
        return true;
    const parse = (value) => {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
            throw new Error("Invalid communication hours.");
        return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    };
    const start = parse(policy.communication_start), end = parse(policy.communication_end);
    if (start === end)
        return true;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: policy.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const minute = Number(parts.find((part) => part.type === "hour")?.value) * 60
        + Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(minute))
        throw new Error("The institution communication time is unavailable.");
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
export function evaluateChatWritePolicy(input) {
    const { policy } = input;
    if (!communicationHoursOpen(policy, input.now))
        return {
            allowed: false, code: "COMMUNICATION_HOURS",
            reason: `Messaging is available ${policy.communication_start}–${policy.communication_end} (${policy.timezone}). You can still read or report messages.`,
        };
    if (input.kind === "direct" && input.recipientRoles?.some((roles) => !directMessagingAllowed(policy, input.senderRoles, roles)))
        return {
            allowed: false, code: "DIRECT_MESSAGES_DISABLED", reason: "Direct messaging with teaching staff is disabled by institution rules.",
        };
    if (input.kind === "group" && !input.moderator
        && ((input.senderRoles.includes("student") && !policy.student_group_replies)
            || (input.senderRoles.includes("guardian") && !policy.guardian_group_replies)))
        return {
            allowed: false, code: "GROUP_REPLIES_DISABLED", reason: "Replies are disabled for your campus relationship in this group.",
        };
    if (input.hasAttachment && !policy.attachments_enabled)
        return {
            allowed: false, code: "ATTACHMENTS_DISABLED", reason: "Attachments are disabled by institution rules.",
        };
    return { allowed: true };
}
export async function conversationWritePolicy(db, conversation, senderId, hasAttachment = false, lock = false) {
    const policy = await readChatPolicy(db, conversation.school_id, lock);
    const current = (await sql `SELECT
    chat_actor_is_current_participant(${conversation.school_id}::uuid,${senderId}::uuid,'messages.send',${conversation.id}::uuid)
      AND NOT EXISTS (SELECT 1 FROM chat_messaging_restrictions restriction
        WHERE restriction.school_id=${conversation.school_id}::uuid AND restriction.user_id=${senderId}::uuid
          AND restriction.revoked_at IS NULL AND restriction.expires_at>${executionNow()}) AS allowed`.execute(db)).rows[0];
    if (!current?.allowed)
        return { allowed: false, reason: "Your current conversation access does not allow sending." };
    const senderRoles = await chatCampusRoles(db, conversation.school_id, senderId);
    if (!senderRoles.length)
        return { allowed: false, reason: "Your institution membership is no longer active." };
    const participants = (await sql `SELECT
      participant.user_id,participant.participant_role,array_agg(DISTINCT membership.role) AS roles
    FROM chat_participants participant JOIN school_memberships membership
      ON membership.school_id=${conversation.school_id}::uuid AND membership.user_id=participant.user_id AND membership.is_active
    JOIN users account ON account.id=participant.user_id AND account.is_active
    WHERE participant.conversation_id=${conversation.id}::uuid AND participant.is_active
    GROUP BY participant.user_id,participant.participant_role`.execute(db)).rows;
    const moderator = participants.find((participant) => participant.user_id === senderId)?.participant_role === "moderator";
    if (conversation.posting_mode === "moderators" && !moderator)
        return { allowed: false, reason: "Only group moderators can post in this conversation." };
    return evaluateChatWritePolicy({ policy, kind: conversation.kind, senderRoles,
        recipientRoles: participants.filter((participant) => participant.user_id !== senderId).map((participant) => participant.roles),
        moderator, hasAttachment });
}
export function assertChatPolicy(decision) {
    if (!decision.allowed)
        throw new ForbiddenException(decision.reason ?? "Messaging is not currently available.");
}
//# sourceMappingURL=chat-policy.js.map