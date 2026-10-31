import { createHash, createHmac, randomInt } from 'node:crypto';
import { sql } from 'kysely';
import { config } from '../config.js';
export function invitationCodeHash(email, code) {
    if (!/^\d{6}$/.test(code))
        return createHash('sha256').update(code).digest('hex');
    return createHmac('sha256', config().COOKIE_SECRET)
        .update(`invitation-v2:${email.trim().toLowerCase()}:${code}`).digest('hex');
}
export async function issueInvitationCode(db, email) {
    for (let attempt = 0; attempt < 10; attempt++) {
        const token = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const tokenHash = invitationCodeHash(email, token);
        if (!(await sql `SELECT 1 FROM school_invitations WHERE token_hash=${tokenHash}`.execute(db)).rows.length)
            return { token, tokenHash };
    }
    throw new Error('Could not generate an invitation code. Try again.');
}
//# sourceMappingURL=invitation-code.js.map