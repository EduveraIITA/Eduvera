import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { sharedVisitHref } from './visit-sharing.contracts.js';
/** People retains identity issuance; Gate alone authorizes this exact source. */
export async function authorizeVisitInvitation(tx, input) {
    const at = executionNow();
    const row = (await sql `
    SELECT share.id,share.owner_person_id,share.organiser_person_id,person.revision AS person_revision,share.starts_at,share.ends_at
    FROM gate_visit_shares share JOIN school_people person ON person.school_id=share.school_id AND person.id=share.organiser_person_id AND person.retired_at IS NULL
    WHERE share.school_id=${input.school_id}::uuid AND share.visit_id=${input.visit_id}::uuid AND share.id=${input.share_id}::uuid
      AND share.organiser_person_id=${input.person_id}::uuid
      AND gate_visit_share_issuer_valid(share.school_id,share.visit_id,share.id,${input.actor_user_id}::uuid,${at}::timestamptz)
    FOR SHARE OF person`.execute(tx)).rows[0];
    if (!row)
        throw new ForbiddenException('This exact visit invitation needs its current sharing coordinator and available access.');
    return { school_id: input.school_id, visit_id: input.visit_id, share_id: row.id, person_id: row.organiser_person_id,
        person_revision: row.person_revision, owner_person_id: row.owner_person_id, starts_at: row.starts_at.toISOString(), ends_at: row.ends_at.toISOString(), href: sharedVisitHref(input.visit_id) };
}
/** A continuation is a locator, never a bearer grant or an automatic visit action. */
export async function visitContinuation(tx, input) {
    const at = executionNow();
    const row = (await sql `SELECT current_share.id FROM gate_visit_shares retained
    JOIN LATERAL(SELECT candidate.* FROM gate_visit_shares candidate
      WHERE candidate.school_id=retained.school_id AND candidate.visit_id=retained.visit_id ORDER BY candidate.revision DESC LIMIT 1) current_share
      ON current_share.root_id=retained.root_id AND current_share.organiser_person_id=retained.organiser_person_id
    WHERE retained.school_id=${input.school_id}::uuid AND retained.visit_id=${input.visit_id}::uuid AND retained.id=${input.share_id}::uuid
      AND retained.organiser_person_id=${input.person_id}::uuid
      AND gate_visit_share_current(current_share.school_id,current_share.visit_id,current_share.organiser_person_id,${at}::timestamptz)
      AND campus_model_account_person_is_active(current_share.school_id,${input.user_id}::uuid,current_share.organiser_person_id,${at}::timestamptz)`.execute(tx)).rows[0];
    if (!row)
        throw new NotFoundException('This shared visit is no longer available. Ask the campus contact to review the access.');
    return { school_id: input.school_id, visit_id: input.visit_id, share_id: row.id, href: sharedVisitHref(input.visit_id) };
}
//# sourceMappingURL=visit-sharing.access.js.map