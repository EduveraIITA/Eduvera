import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import { config } from '../config.js';
import { invitationCodeHash } from './invitation-code.js';
import { deliverInvitation } from './invitation-email.js';
import { captureSimulationProviderEffect, selectedSimulationResources } from './simulation-resources.js';
import { assertLiveAccountMailControl, deliverPendingAccountMail } from './account-email-queue.js';

type Invitation = {id: string; email: string; token: string; expires_at: Date | string};
const key = () => createHmac('sha256', config().COOKIE_SECRET).update('eduera:invitation-email-queue:v1').digest();
// A queued invitation is not authority to send after its source is ended or
// replaced. Future work may be invited now; only the end bounds this delivery.
const currentInvitationSource = sql<boolean>`(i.access_scope='campus' OR EXISTS(
  SELECT 1 FROM facilities_repairs repair
  JOIN facilities_external_assignments access ON access.id=repair.external_assignment_id AND access.school_id=repair.school_id AND access.repair_id=repair.id
  JOIN school_people person ON person.id=access.person_id AND person.school_id=access.school_id AND person.retired_at IS NULL
  WHERE i.access_scope='assigned_work' AND i.work_source_kind='facility_repair' AND repair.school_id=i.school_id
    AND repair.id=i.work_source_id AND access.id=i.work_access_id AND person.id=i.person_id
    AND access.status='granted' AND access.ends_at>now() AND repair.state<>'closed'
    AND facilities_external_issuer_valid(i.school_id,repair.id,i.created_by,now())) OR (
      i.access_scope='assigned_work' AND i.work_source_kind='visit_arrangement'
      AND gate_visit_share_issuer_valid(i.school_id,i.work_source_id,i.work_visit_access_id,i.created_by,now())
      AND EXISTS(SELECT 1 FROM gate_visit_shares access JOIN school_people person ON person.id=access.organiser_person_id AND person.school_id=access.school_id
        WHERE access.id=i.work_visit_access_id AND access.school_id=i.school_id AND access.visit_id=i.work_source_id
          AND person.id=i.person_id AND person.retired_at IS NULL)))`;

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
  if (selectedSimulationResources()) {
    const receipt=await captureSimulationProviderEffect({kind:'external_notification',provider:'invitation',operation:'enqueue',
      logicalKey:invitation.id,idempotencyKey:`invitation:${invitation.id}`,
      payload:{evidence_mode:'simulation',delivered_externally:false}});
    // No deliverable code or encrypted provider job leaves this run. `manual`
    // retains the native UI contract; the durable receipt reports captured.
    return {...invitation,delivery:'manual' as const,evidence_mode:'simulation' as const,simulation_receipt:receipt?.sink_record_id};
  }
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
      assertLiveAccountMailControl();
      // Acceptance may have happened before a crash. Never duplicate an uncertain send.
      await sql`UPDATE invitation_email_jobs SET delivery_state='unknown',encrypted_token=NULL,updated_at=now()
        WHERE delivery_state='sending' AND updated_at<now()-interval '2 minutes'`.execute(this.db);
      await sql`UPDATE invitation_email_jobs j SET delivery_state='cancelled',encrypted_token=NULL,updated_at=now()
        FROM school_invitations i WHERE j.invitation_id=i.id AND j.delivery_state='queued'
        AND (i.token_hash<>j.token_hash OR i.revoked_at IS NOT NULL OR i.accepted_at IS NOT NULL OR i.expires_at<=now()
          OR NOT ${currentInvitationSource})`.execute(this.db);
      if (!config().INVITATION_EMAIL_ENABLED) return;
      const accountMails = await deliverPendingAccountMail(this.db, 2);
      for (let n = accountMails; n < 10; n++) {
        const job = (await sql<{id:string;invitation_id:string;encrypted_token:string;email:string;expires_at:Date}>`
          WITH candidate AS (
            SELECT j.id,i.email,i.expires_at FROM invitation_email_jobs j JOIN school_invitations i ON i.id=j.invitation_id
            WHERE j.delivery_state='queued' AND i.token_hash=j.token_hash AND i.revoked_at IS NULL
              AND i.accepted_at IS NULL AND i.expires_at>now() AND ${currentInvitationSource}
            ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED
          ) UPDATE invitation_email_jobs j SET delivery_state='sending',updated_at=now()
            FROM candidate c WHERE j.id=c.id RETURNING j.id,j.invitation_id,j.encrypted_token,c.email,c.expires_at`.execute(this.db)).rows[0];
        if (!job) break;
        let outcome = 'failed';
        try {
          const result = await deliverInvitation({email: job.email, expires_at: job.expires_at, token: openInvitationCode(job.encrypted_token, job.invitation_id), idempotency_key: `invitation/${job.id}`});
          outcome = result.delivery === 'email_accepted' ? 'email_accepted' : result.delivery === 'failed' && ['authentication','recipient'].includes(result.delivery_error) ? 'failed' : 'unknown';
        } catch { this.logger.warn('Invitation delivery could not be confirmed. Resend is available in the invitation list.'); }
        await sql`UPDATE invitation_email_jobs SET delivery_state=${outcome},encrypted_token=NULL,updated_at=now()
          WHERE id=${job.id}::uuid AND delivery_state='sending'`.execute(this.db);
      }
    } catch { this.logger.warn('Invitation queue unavailable; pending emails will be checked again.'); }
    finally { this.busy = false; }
  }
}
