import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import { config } from '../config.js';
import { invitationCodeHash } from './invitation-code.js';
import { deliverInvitation } from './invitation-email.js';

type Invitation = {id: string; email: string; token: string; expires_at: Date | string};
const key = () => createHmac('sha256', config().COOKIE_SECRET).update('eduera:invitation-email-queue:v1').digest();

// Short-lived codes are encrypted with a domain-separated key, never stored in plaintext.
export function sealInvitationCode(token: string, invitationId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(invitationId));
  const content = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64');
}
export function openInvitationCode(value: string, invitationId: string): string {
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(invitationId));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}

/** Enqueue inside the invitation transaction: both commit together, without SMTP. */
export async function enqueueInvitation<T extends Invitation>(db: Kysely<Database> | Transaction<Database>, invitation: T) {
  if (!config().INVITATION_EMAIL_ENABLED) return {...invitation, delivery: 'manual' as const};
  const tokenHash = invitationCodeHash(invitation.email, invitation.token);
  const job = (await sql<{id:string}>`INSERT INTO invitation_email_jobs(invitation_id,token_hash,encrypted_token)
    VALUES(${invitation.id}::uuid,${tokenHash},${sealInvitationCode(invitation.token, invitation.id)})
    ON CONFLICT(invitation_id,token_hash) DO UPDATE SET invitation_id=excluded.invitation_id RETURNING id`.execute(db)).rows[0]!;
  return {...invitation, delivery: 'queued' as const, delivery_job_id: job.id};
}

@Injectable()
export class InvitationEmailWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(InvitationEmailWorker.name);
  constructor(private readonly db: DatabaseService) {}
  onModuleInit() { this.timer = setInterval(() => void this.deliverPending(), 1000).unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async deliverPending() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Acceptance may have happened before a crash. Never duplicate an uncertain send.
      await sql`UPDATE invitation_email_jobs SET delivery_state='unknown',encrypted_token=NULL,updated_at=now()
        WHERE delivery_state='sending' AND updated_at<now()-interval '2 minutes'`.execute(this.db);
      await sql`UPDATE invitation_email_jobs j SET delivery_state='cancelled',encrypted_token=NULL,updated_at=now()
        FROM school_invitations i WHERE j.invitation_id=i.id AND j.delivery_state='queued'
        AND (i.token_hash<>j.token_hash OR i.revoked_at IS NOT NULL OR i.accepted_at IS NOT NULL OR i.expires_at<=now())`.execute(this.db);
      if (!config().INVITATION_EMAIL_ENABLED) return;
      for (let n = 0; n < 10; n++) {
        const job = (await sql<{id:string;invitation_id:string;encrypted_token:string;email:string;expires_at:Date}>`
          WITH candidate AS (
            SELECT j.id,i.email,i.expires_at FROM invitation_email_jobs j JOIN school_invitations i ON i.id=j.invitation_id
            WHERE j.delivery_state='queued' AND i.token_hash=j.token_hash AND i.revoked_at IS NULL
              AND i.accepted_at IS NULL AND i.expires_at>now()
            ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED
          ) UPDATE invitation_email_jobs j SET delivery_state='sending',updated_at=now()
            FROM candidate c WHERE j.id=c.id RETURNING j.id,j.invitation_id,j.encrypted_token,c.email,c.expires_at`.execute(this.db)).rows[0];
        if (!job) break;
        let outcome = 'failed';
        try {
          const result = await deliverInvitation({email: job.email, expires_at: job.expires_at, token: openInvitationCode(job.encrypted_token, job.invitation_id)});
          outcome = result.delivery === 'email_accepted' ? 'email_accepted' : result.delivery === 'failed' && ['authentication','recipient'].includes(result.delivery_error) ? 'failed' : 'unknown';
        } catch { this.logger.warn('Invitation delivery could not be confirmed. Resend is available in the invitation list.'); }
        await sql`UPDATE invitation_email_jobs SET delivery_state=${outcome},encrypted_token=NULL,updated_at=now()
          WHERE id=${job.id}::uuid AND delivery_state='sending'`.execute(this.db);
      }
    } catch { this.logger.warn('Invitation queue unavailable; pending emails will be checked again.'); }
    finally { this.busy = false; }
  }
}
