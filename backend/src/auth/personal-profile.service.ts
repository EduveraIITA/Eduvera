import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import type { AuthenticatedRequest } from '../common/request.js';
import { executionEnvironmentStorage } from '../campus-model-core/execution-time.runtime.js';
import { config } from '../config.js';
import { AccountPhoneDelivery } from './account-phone-delivery.js';
import { normalizeContactPhone, personalProfileSchema, phoneConfirmSchema, phoneStartSchema, sanitizedProfilePhoto } from './personal-profile.contracts.js';

type Profile = { user_id: string; revision: number; contact_phone: string; phone_verified_at: Date | null; education_background: string; photo_override: boolean; photo_bytes: Buffer | null; last_change_id: string | null };
type Challenge = { id: string; user_id: string; profile_revision: number; phone: string; session_hash: string; code_hash: string; state: string; attempts: number; expires_at: Date };
@Injectable()
export class PersonalProfileService {
  constructor(private readonly db: DatabaseService, private readonly delivery: AccountPhoneDelivery) {}
  private accountScope() { if (executionEnvironmentStorage.getStore()?.kind === 'simulation') throw new ConflictException('Personal details require the authenticated account control plane.'); }
  private async writable(tx: Transaction<Database>, request: AuthenticatedRequest, phone = false) {
    this.accountScope();
    if (request.publicDemo || request.internalAgentDelegation || request.hostedCampusSimulator) throw new ForbiddenException('Use your own signed-in account to change personal details.');
    if (phone && request.executionEnvironmentView?.mode !== 'live') throw new ConflictException('Phone verification is available in Live only. No SMS is sent from Simulation.');
    const row = await tx.selectFrom('auth_sessions').innerJoin('users', 'users.id', 'auth_sessions.user_id').select('auth_sessions.is_public_demo')
      .where('auth_sessions.token_hash', '=', request.sessionHash).where('auth_sessions.user_id', '=', request.authUser.id)
      .where('auth_sessions.expires_at', '>', new Date()).where('users.is_active', '=', true).forUpdate().executeTakeFirst();
    if (!row) throw new UnauthorizedException('Your session expired. Sign in again.');
    if (row.is_public_demo) throw new ForbiddenException('The public demo is read-only.');
  }
  private async profile(tx: DatabaseService | Transaction<Database>, id: string, lock = false): Promise<Profile> {
    const rows = await sql<Profile>`SELECT user_id,revision,contact_phone,phone_verified_at,education_background,photo_override,photo_bytes,last_change_id
      FROM auth_personal_profiles WHERE user_id=${id}::uuid ${lock ? sql`FOR UPDATE` : sql``}`.execute(tx);
    return rows.rows[0] ?? { user_id: id, revision: 0, contact_phone: '', phone_verified_at: null, education_background: '', photo_override: false, photo_bytes: null, last_change_id: null };
  }
  private view(profile: Profile, request: AuthenticatedRequest, account = request.authUser) {
    return { user_id: profile.user_id, first_name: account.first_name, last_name: account.last_name, email: account.email,
      revision: profile.revision, contact_phone: profile.contact_phone,
      phone_verified: !!profile.phone_verified_at, phone_verified_at: profile.phone_verified_at?.toISOString() ?? null,
      education_background: profile.education_background, photo_override: profile.photo_override,
      photo_data_url: profile.photo_bytes ? `data:image/jpeg;base64,${profile.photo_bytes.toString('base64')}` : null,
      last_change_id: profile.last_change_id, sms_available: this.delivery.configured() && request.executionEnvironmentView?.mode === 'live' && !request.publicDemo,
      scope: 'account', visibility: 'private', background_evidence: 'self_reported' };
  }
  async read(request: AuthenticatedRequest) { this.accountScope(); if(request.publicDemo||request.internalAgentDelegation||request.hostedCampusSimulator)throw new ForbiddenException('Private personal details require your own signed-in account.'); return this.view(await this.profile(this.db, request.authUser.id), request); }
  async update(request: AuthenticatedRequest) {
    this.accountScope();
    if (request.publicDemo || request.internalAgentDelegation || request.hostedCampusSimulator) throw new ForbiddenException('Use your own signed-in account to change personal details.');
    const input = personalProfileSchema.parse(request.body), phone = normalizeContactPhone(input.contact_phone);
    const photo = input.photo_data_url === undefined ? undefined : input.photo_data_url === null ? null : await sanitizedProfilePhoto(input.photo_data_url);
    return this.db.transaction().execute(async tx => {
      await this.writable(tx, request);
      await sql`INSERT INTO auth_personal_profiles(user_id) VALUES (${request.authUser.id}::uuid) ON CONFLICT DO NOTHING`.execute(tx);
      const current = await this.profile(tx, request.authUser.id, true);
      const account = await tx.selectFrom('users').select(['first_name','last_name']).where('id','=',request.authUser.id).executeTakeFirstOrThrow();
      if (account.first_name !== input.expected_first_name || account.last_name !== input.expected_last_name) throw new ConflictException('Your account name changed in another session. Reload it before saving.');
      const nameChanged = input.name !== `${account.first_name} ${account.last_name}`.trim();
      if (nameChanged && (!input.name || input.name.length > 150 || /\p{Cc}/u.test(input.name))) throw new BadRequestException('Enter a name of up to 150 characters, without control characters.');
      if (current.revision !== input.expected_revision) throw new ConflictException('Your profile changed in another session. Reload it before saving.');
      if (nameChanged) await tx.updateTable('users').set({first_name:input.name,last_name:'',updated_at:new Date()}).where('id','=',request.authUser.id).execute();
      await sql`UPDATE auth_personal_profiles SET revision=revision+1,contact_phone=${phone},education_background=${input.education_background},
        phone_verified_at=${phone === current.contact_phone ? current.phone_verified_at : null},
        photo_override=${photo === undefined ? current.photo_override : true},photo_bytes=${photo === undefined ? current.photo_bytes : photo},
        last_change_id=${input.client_request_id}::uuid,updated_at=now() WHERE user_id=${request.authUser.id}::uuid`.execute(tx);
      if (phone !== current.contact_phone) await sql`UPDATE auth_phone_challenges SET state='cancelled' WHERE user_id=${request.authUser.id}::uuid AND state IN ('pending','sent','delivery_unknown')`.execute(tx);
      await this.audit(tx, request, 'auth.personal_profile.changed', { fields: [...(nameChanged ? ['account_name'] : []), 'contact_phone', 'education_background', ...(photo === undefined ? [] : ['photo'])], scope: 'account' });
      return this.view(await this.profile(tx, request.authUser.id), request, nameChanged ? {...request.authUser,first_name:input.name,last_name:''} : request.authUser);
    });
  }
  private hash(challenge: string, code: string) { return createHmac('sha256', config().COOKIE_SECRET).update(`account-phone:${challenge}:${code}`).digest('hex'); }
  async requestCode(request: AuthenticatedRequest) {
    this.accountScope(); const input = phoneStartSchema.parse(request.body);
    const id = randomUUID(), code = String(randomInt(100000, 1000000)), expiresAt = new Date(Date.now() + 10 * 60_000);
    const phone = await this.db.transaction().execute(async tx => {
      await this.writable(tx, request, true);
      if (!this.delivery.configured()) throw new ServiceUnavailableException('SMS verification is not connected yet. Your contact number remains unverified.');
      const profile = await this.profile(tx, request.authUser.id, true);
      if (!profile.contact_phone || profile.revision !== input.expected_revision || profile.phone_verified_at) throw new ConflictException('Save and review the current unverified phone before requesting a code.');
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`account-phone:${profile.contact_phone}`}))`.execute(tx);
      const rate = (await sql<{ actor_count: number; phone_count: number; recent: boolean }>`SELECT
        count(*) FILTER (WHERE user_id=${request.authUser.id}::uuid)::integer AS actor_count,
        count(*) FILTER (WHERE phone=${profile.contact_phone})::integer AS phone_count,
        COALESCE(bool_or(created_at>now()-interval '60 seconds' AND user_id=${request.authUser.id}::uuid),false) AS recent
        FROM auth_phone_challenges WHERE created_at>now()-interval '24 hours' AND (user_id=${request.authUser.id}::uuid OR phone=${profile.contact_phone})`.execute(tx)).rows[0]!;
      if (rate.recent || rate.actor_count >= 10 || rate.phone_count >= 10) throw new HttpException('Too many verification requests. Wait before requesting another code.', 429);
      await sql`DELETE FROM auth_phone_challenges WHERE user_id=${request.authUser.id}::uuid AND created_at<now()-interval '24 hours'`.execute(tx);
      await sql`UPDATE auth_phone_challenges SET state='cancelled' WHERE user_id=${request.authUser.id}::uuid AND state IN ('pending','sent','delivery_unknown')`.execute(tx);
      await sql`INSERT INTO auth_phone_challenges(id,user_id,profile_revision,phone,session_hash,code_hash,state,expires_at)
        VALUES (${id}::uuid,${request.authUser.id}::uuid,${profile.revision},${profile.contact_phone},${request.sessionHash},${this.hash(id,code)},'pending',${expiresAt})`.execute(tx);
      return profile.contact_phone;
    });
    try { await this.delivery.send({ phone, code, expiresAt, challengeId: id }); }
    catch { await sql`UPDATE auth_phone_challenges SET state='delivery_unknown' WHERE id=${id}::uuid AND state='pending'`.execute(this.db); throw new ServiceUnavailableException('SMS delivery could not be confirmed. Wait before requesting another code. The number is still unverified.'); }
    const sent = await sql`UPDATE auth_phone_challenges SET state='sent' WHERE id=${id}::uuid AND state='pending' RETURNING id`.execute(this.db);
    if (!sent.rows.length) throw new ConflictException('The phone changed before delivery completed. Review your current profile.');
    return { challenge_id: id, expires_at: expiresAt.toISOString(), retry_after_seconds: 60, destination: `•••• ${phone.slice(-4)}`, sent: true };
  }
  async confirmCode(request: AuthenticatedRequest) {
    const input = phoneConfirmSchema.parse(request.body);
    // Return expected failures after commit so failed-attempt counters cannot roll back.
    const result = await this.db.transaction().execute(async tx => {
      await this.writable(tx, request, true);
      const profile = await this.profile(tx, request.authUser.id, true);
      const challenge = (await sql<Challenge>`SELECT * FROM auth_phone_challenges WHERE id=${input.challenge_id}::uuid AND user_id=${request.authUser.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      if (!challenge || challenge.session_hash !== request.sessionHash || challenge.state !== 'sent' || challenge.expires_at.getTime() <= Date.now() || challenge.attempts >= 5 || challenge.phone !== profile.contact_phone || challenge.profile_revision !== profile.revision) return { error: 'This code expired or no longer matches the current phone. Request a new code.', status: 410 };
      const matches = timingSafeEqual(Buffer.from(challenge.code_hash,'hex'), Buffer.from(this.hash(challenge.id,input.code),'hex'));
      await sql`UPDATE auth_phone_challenges SET attempts=attempts+1 WHERE id=${challenge.id}::uuid`.execute(tx);
      if (!matches) return { error: 'The code is incorrect. Check the message and try again.', status: 400 };
      await sql`UPDATE auth_phone_challenges SET state='verified',consumed_at=now() WHERE id=${challenge.id}::uuid`.execute(tx);
      await sql`UPDATE auth_personal_profiles SET phone_verified_at=now(),revision=revision+1,updated_at=now() WHERE user_id=${request.authUser.id}::uuid`.execute(tx);
      await this.audit(tx, request, 'auth.contact_phone.verified', { scope: 'account', challenge_id: challenge.id });
      return { profile: this.view(await this.profile(tx, request.authUser.id), request) };
    });
    if ('error' in result) throw new HttpException(result.error!, result.status!);
    return result.profile;
  }
  private async audit(tx: Transaction<Database>, request: AuthenticatedRequest, action: string, metadata: Record<string, unknown>) {
    await tx.insertInto('audit_events').values({ action, actor_id: request.authUser.id, school_id: null, target_type: 'user', target_id: request.authUser.id,
      request_id: request.requestId || randomUUID(), ip_hash: createHash('sha256').update(request.ip).digest('hex'), metadata }).execute();
  }
}
