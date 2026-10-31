import { createHash } from "node:crypto";
import { sql } from "kysely";
import { participationRosterFingerprint } from "./activity-attendance.contracts.js";
/** Shared with the executor. Matching a policy is not proof that its worker ran. */
export function automaticParticipationPolicyMatches(revision, source, current) {
    return current.revision === revision && current.snapshot.configuration_state === "configured"
        && current.snapshot.finalization_mode === "automatic" && source.configuration_state === "configured"
        && source.finalization_mode === "automatic" && Boolean(source.approved_by && source.approved_at)
        && current.snapshot.approved_by === source.approved_by && current.snapshot.approved_at === source.approved_at
        && current.snapshot.auto_finalize_minutes === source.auto_finalize_minutes;
}
/** Internal read composition over already-authorized register IDs; no actor/configuration writes. */
export async function readParticipationFinalization(db, identities, schoolId, registerIds, at) {
    if (!registerIds.length)
        return new Map();
    const rows = (await sql `SELECT register.id,register.policy_revision,register.policy_snapshot,register.auto_finalize_at,
    register.roster_fingerprint,register.roster_source_revision,occurrence.revision AS occurrence_revision,occurrence.state AS occurrence_state,
    policy.revision AS current_revision,policy.attendance_finalization_mode AS finalization_mode,
    policy.attendance_auto_finalize_minutes AS auto_finalize_minutes,policy.updated_by AS approved_by,policy.updated_at AS approved_at,
    CASE WHEN register.auto_finalize_at IS NULL THEN 0 ELSE (SELECT count(*)::int FROM activity_attendance_roster roster LEFT JOIN activity_attendance_entries entry
      ON entry.school_id=roster.school_id AND entry.register_id=roster.register_id AND entry.person_id=roster.person_id
      WHERE roster.school_id=register.school_id AND roster.register_id=register.id AND roster.requirement='required' AND entry.status IS NULL) END AS unrecorded,
    CASE WHEN register.auto_finalize_at IS NULL THEN 0 ELSE (SELECT count(*)::int FROM activity_attendance_evidence evidence WHERE evidence.school_id=register.school_id
      AND evidence.register_id=register.id AND evidence.state='pending') END AS pending,
    CASE WHEN register.auto_finalize_at IS NULL THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('person_id',person_id,'source_kind',source_kind,'source_ref',source_ref,
      'source_revision',source_revision,'participation_role',participation_role,'requirement',requirement))
      FROM schedule_activity_occurrence_people participant WHERE participant.school_id=register.school_id
        AND participant.occurrence_id=register.occurrence_id AND participant.attendance_expected),'[]'::jsonb) END AS source_roster
    FROM activity_attendance_registers register JOIN schedule_activity_occurrences occurrence
      ON occurrence.school_id=register.school_id AND occurrence.id=register.occurrence_id
    LEFT JOIN institution_operating_rules policy ON policy.school_id=register.school_id
    WHERE register.school_id=${schoolId}::uuid AND register.id=ANY(${[...new Set(registerIds)]}::uuid[]) AND register.state='submitted'`.execute(db)).rows;
    const approvers = new Map();
    const result = new Map();
    for (const row of rows) {
        const scheduledAt = row.auto_finalize_at ? new Date(row.auto_finalize_at).toISOString() : null;
        const review = (reason) => ({ state: "review_required", reason, scheduled_at: scheduledAt });
        if (!scheduledAt) {
            result.set(row.id, review("manual"));
            continue;
        }
        const current = { revision: row.current_revision ?? 0, snapshot: {
                finalization_mode: row.finalization_mode ?? "principal_review", auto_finalize_minutes: row.auto_finalize_minutes ?? 0,
                configuration_state: row.current_revision && row.approved_by ? "configured" : "manual_fallback",
                approved_by: row.approved_by, approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
            } };
        if (!automaticParticipationPolicyMatches(row.policy_revision, row.policy_snapshot, current)) {
            result.set(row.id, review("policy_changed"));
            continue;
        }
        const approverId = row.policy_snapshot.approved_by;
        if (!approvers.has(approverId)) {
            // The identity port is read-only here. Inactive approval cannot be repaired by a GET.
            const identity = await identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: approverId, at });
            approvers.set(approverId, identity.acting);
        }
        if (!approvers.get(approverId)) {
            result.set(row.id, review("approver_unavailable"));
            continue;
        }
        const sourceFingerprint = createHash("sha256").update(participationRosterFingerprint(row.source_roster)).digest("hex");
        if (row.occurrence_state !== "expected" || row.roster_source_revision !== row.occurrence_revision || row.roster_fingerprint !== sourceFingerprint) {
            result.set(row.id, review("roster_changed"));
            continue;
        }
        if (row.unrecorded) {
            result.set(row.id, review("marks_missing"));
            continue;
        }
        if (row.pending) {
            result.set(row.id, review("evidence_pending"));
            continue;
        }
        // No arbitrary grace period: an unconfirmed scheduled outcome remains visible
        // to its reviewer once due. This says overdue, not that a worker failure was proved.
        result.set(row.id, Date.parse(scheduledAt) > Date.parse(at)
            ? { state: "automatic_pending", reason: "scheduled", scheduled_at: scheduledAt } : review("overdue"));
    }
    return result;
}
//# sourceMappingURL=participation-finalization.js.map