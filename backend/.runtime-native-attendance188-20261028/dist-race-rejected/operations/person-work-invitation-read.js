import { sql } from 'kysely';
import { executionEnvironmentStorage } from '../campus-model-core/execution-time.runtime.js';
/** Minimum People-owned delivery view, called after the source rechecks its coordinator. */
export async function readWorkInvitation(tx, source) {
    return readSourceInvitation(tx, { school_id: source.school_id, person_id: source.person_id,
        kind: 'facility_repair', source_id: source.repair_id, access_id: source.assignment_id });
}
/** The Visit owner must recheck the exact share before disclosing delivery state. */
export async function readVisitInvitation(tx, source) {
    return readSourceInvitation(tx, { school_id: source.school_id, person_id: source.person_id,
        kind: 'visit_arrangement', source_id: source.visit_id, access_id: source.share_id });
}
async function readSourceInvitation(tx, source) {
    if (executionEnvironmentStorage.getStore()?.kind === 'simulation')
        return null;
    const row = (await sql `SELECT invitation.id,invitation.email,invitation.expires_at,
      invitation.accepted_at,invitation.revoked_at,job.delivery_state AS delivery,job.id AS delivery_job_id
    FROM school_invitations invitation LEFT JOIN invitation_email_jobs job ON job.invitation_id=invitation.id AND job.token_hash=invitation.token_hash
    WHERE invitation.school_id=${source.school_id}::uuid AND invitation.person_id=${source.person_id}::uuid
      AND invitation.role='member' AND invitation.source='school' AND invitation.access_scope='assigned_work'
      AND invitation.work_source_kind=${source.kind} AND invitation.work_source_id=${source.source_id}::uuid
      AND coalesce(invitation.work_access_id,invitation.work_visit_access_id)=${source.access_id}::uuid
    ORDER BY invitation.created_at DESC,invitation.id DESC LIMIT 1`.execute(tx)).rows[0];
    return row ? { ...row, expires_at: row.expires_at.toISOString(), accepted_at: row.accepted_at?.toISOString() ?? null,
        revoked_at: row.revoked_at?.toISOString() ?? null } : null;
}
//# sourceMappingURL=person-work-invitation-read.js.map