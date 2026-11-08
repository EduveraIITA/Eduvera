import { ForbiddenException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { executionEnvironmentStorage } from '../campus-model-core/execution-time.runtime.js';
import { config } from '../config.js';
import type { Database } from '../database/types.js';
import { accountEmailMode, deliverAccountAction, type AccountMailPurpose } from './account-email.js';
import { captureSimulationProviderEffect, selectedSimulationResources } from './simulation-resources.js';

type Db = Kysely<Database> | Transaction<Database>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const key = () => createHmac('sha256', config().COOKIE_SECRET).update('thatcampus:account-email-queue:v1').digest();

/** Account possession changes Live authentication, not a selected campus world. */
export function assertLiveAccountMailControl(): void {
  if (executionEnvironmentStorage.getStore()?.kind === 'simulation')
    throw new ForbiddenException('Account verification and password recovery are managed in Live. Return to Live before continuing.');
}

export function sealAccountMailToken(token: string, tokenId: string, purpose: AccountMailPurpose): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(JSON.stringify([tokenId, purpose])));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
export function openAccountMailToken(value: string, tokenId: string, purpose: AccountMailPurpose): string {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 29) throw new Error('Invalid encrypted account mail.');
  const cipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(JSON.stringify([tokenId, purpose]))); cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
}

/** Also safe as a provider adapter in Simulation: capture before credential access,
 * but ordinary account endpoints reject Simulation before issuing a token. */
export async function enqueueAccountMail(db: Db, input: { id: string; email: string; token: string; purpose: AccountMailPurpose; expiresAt: Date }) {
  if (selectedSimulationResources()) {
    const receipt = await captureSimulationProviderEffect({ kind: 'external_notification', provider: 'account_email', operation: 'enqueue',
      logicalKey: input.id, idempotencyKey: `account_email:${input.id}`,
      payload: { purpose: input.purpose, evidence_mode: 'simulation', delivered_externally: false } });
    return { delivery: 'captured' as const, evidence_mode: 'simulation' as const, simulation_receipt: receipt?.sink_record_id };
  }
  const mode = accountEmailMode();
  if (mode === 'unavailable') return { delivery: 'unavailable' as const };
  if (mode === 'development') return { delivery: 'manual' as const, development_token: input.token };
  await sql`INSERT INTO auth_account_email_jobs(account_token_id,recipient_email,purpose,encrypted_token)
    VALUES(${input.id}::uuid,${input.email.toLowerCase()},${input.purpose},${sealAccountMailToken(input.token, input.id, input.purpose)})
    ON CONFLICT(account_token_id) DO NOTHING`.execute(db);
  return { delivery: 'queued' as const };
}

/** Caller owns the transaction. Serialize issuance and confirmation on the account
 * row, then reuse a recent request instead of invalidating its link on a retry. */
export async function prepareAccountMail(db: Db, userId: string, purpose: AccountMailPurpose, ttlMs: number) {
  assertLiveAccountMailControl();
  if (accountEmailMode() === 'unavailable') return { delivery: 'unavailable' as const };
  const account = (await sql<{ email: string; email_verified_at: Date | null }>`SELECT email,email_verified_at FROM users
    WHERE id=${userId}::uuid AND is_active FOR NO KEY UPDATE`.execute(db)).rows[0];
  if (!account) {
    // A concurrent deactivation is still not an anonymous account discriminator.
    if (purpose === 'password_reset') return { delivery: 'cancelled' as const };
    throw new ForbiddenException('This account is unavailable. Sign in again.');
  }
  if (purpose === 'email_verification' && account.email_verified_at) return { delivery: 'not_required' as const };
  const prior = (await sql<{ expires_at: Date; delivery_state: string | null }>`SELECT token.expires_at,job.delivery_state
    FROM auth_account_tokens token LEFT JOIN auth_account_email_jobs job ON job.account_token_id=token.id
    WHERE token.user_id=${userId}::uuid AND token.purpose=${purpose} AND token.consumed_at IS NULL
      AND token.expires_at>now() AND token.created_at>now()-interval '1 minute'
      AND token.email_at_issue=lower(${account.email}) ORDER BY token.created_at DESC LIMIT 1`.execute(db)).rows[0];
  if (prior) return { delivery: prior.delivery_state ?? 'cooldown', expires_at: prior.expires_at, retry_after_seconds: 60 };
  const raw = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + ttlMs);
  await sql`UPDATE auth_account_tokens SET consumed_at=now() WHERE user_id=${userId}::uuid AND purpose=${purpose} AND consumed_at IS NULL`.execute(db);
  const token = (await sql<{ id: string }>`INSERT INTO auth_account_tokens(user_id,purpose,token_hash,expires_at,email_at_issue)
    VALUES(${userId}::uuid,${purpose},${hash(raw)},${expiresAt},lower(${account.email})) RETURNING id`.execute(db)).rows[0]!;
  return { ...await enqueueAccountMail(db, { id: token.id, email: account.email, token: raw, purpose, expiresAt }), expires_at: expiresAt };
}

/** Share the existing mail worker's serial bounded budget; no new timer. A claimed
 * send is never automatically retried, including beyond Resend's 24h dedupe window. */
export async function deliverPendingAccountMail(db: Db, budget: number): Promise<number> {
  assertLiveAccountMailControl();
  await sql`UPDATE auth_account_email_jobs SET delivery_state='unknown',encrypted_token=NULL,updated_at=now()
    WHERE delivery_state='sending' AND updated_at<now()-interval '2 minutes'`.execute(db);
  await sql`UPDATE auth_account_email_jobs job SET delivery_state='cancelled',encrypted_token=NULL,updated_at=now()
    FROM auth_account_tokens token,users account WHERE token.id=job.account_token_id AND account.id=token.user_id
      AND job.delivery_state='queued' AND (token.consumed_at IS NOT NULL OR token.expires_at<=now() OR NOT account.is_active
        OR lower(account.email)<>job.recipient_email OR token.email_at_issue IS DISTINCT FROM job.recipient_email
        OR token.purpose<>job.purpose OR (job.purpose='email_verification' AND account.email_verified_at IS NOT NULL))`.execute(db);
  if (accountEmailMode() !== 'email') return 0;
  let sent = 0;
  for (; sent < budget; sent++) {
    const settings = config();
    const job = (await sql<{ id: string; account_token_id: string; encrypted_token: string; recipient_email: string; purpose: AccountMailPurpose; expires_at: Date }>`
      WITH candidate AS (SELECT job.id,token.expires_at FROM auth_account_email_jobs job
        JOIN auth_account_tokens token ON token.id=job.account_token_id JOIN users account ON account.id=token.user_id
        WHERE job.delivery_state='queued' AND token.consumed_at IS NULL AND token.expires_at>now() AND account.is_active
          AND lower(account.email)=job.recipient_email AND token.email_at_issue=job.recipient_email AND token.purpose=job.purpose
          AND (job.purpose<>'email_verification' OR account.email_verified_at IS NULL)
        ORDER BY job.created_at LIMIT 1 FOR UPDATE OF job SKIP LOCKED)
      UPDATE auth_account_email_jobs job SET delivery_state='sending',provider=${settings.INVITATION_EMAIL_PROVIDER},updated_at=now()
        FROM candidate c WHERE job.id=c.id RETURNING job.id,job.account_token_id,job.encrypted_token,job.recipient_email,job.purpose,c.expires_at`.execute(db)).rows[0];
    if (!job) break;
    const outcome = await deliverAccountAction({ email: job.recipient_email, token: openAccountMailToken(job.encrypted_token, job.account_token_id, job.purpose),
      purpose: job.purpose, expiresAt: job.expires_at, idempotencyKey: `account-action/${job.account_token_id}` });
    const state = outcome.delivery === 'email_accepted' ? 'email_accepted'
      : outcome.delivery === 'failed' && ['authentication', 'recipient'].includes(outcome.failure_category) ? 'failed' : 'unknown';
    await sql`UPDATE auth_account_email_jobs SET delivery_state=${state},encrypted_token=NULL,updated_at=now(),
      provider_message_id=${'provider_message_id' in outcome ? outcome.provider_message_id ?? null : null},
      failure_category=${'failure_category' in outcome ? outcome.failure_category : null}
      WHERE id=${job.id}::uuid AND delivery_state='sending'`.execute(db);
  }
  return sent;
}
