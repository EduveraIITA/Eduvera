import { readVisitDestination } from './visit-destination.js';
import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { config } from '../config.js';
import type { AuthUser } from '../common/request.js';
import { sendTransactionalEmail } from '../common/email-transport.js';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
import { executionEnvironmentStorage, executionNow } from '../campus-model-core/execution-time.runtime.js';
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from '../campus-model-core/human-agent-identity.port.js';
import { hasScopedSchoolPermission } from '../roles/authorization.js';
import { assertLiveAppAccountControl } from '../operations/person-account-invitations.service.js';
import { VisitOnboardingIdentity } from './visit-onboarding-identity.js';
import { VisitOnboardingModel, type OnboardingSource } from './visit-onboarding.model.js';
import { onboardingAccountInput, onboardingJoinInput, onboardingLinkCommand, onboardingPreviewInput, onboardingProofInput, participantVisitHref } from './visit-onboarding.contracts.js';
type Tx = Transaction<Database>;
interface Link { id: string; school_id: string; visit_id: string; revision: number; action: 'issue' | 'revoke'; token_hash: string | null;
  ends_at: Date; recorded_at: Date; actor_user_id: string; actor_person_id: string }
const iso = (date: Date | string) => new Date(date).toISOString();
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
/** Deterministic only for exact response recovery. Only its hash is persisted. */
export const visitOnboardingCredential = (school: string, visit: string, command: string) => createHmac('sha256', config().COOKIE_SECRET)
  .update(JSON.stringify(['visit-onboarding-link/v1', executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${school}`, school, visit, command])).digest('base64url');
const proofHash = (challenge: string, email: string, code: string) => createHmac('sha256', config().COOKIE_SECRET)
  .update(JSON.stringify(['visit-onboarding-mailbox/v1', challenge, email, code])).digest('hex');
function joinUrl(token: string) {
  const configured = config().PUBLIC_URL;
  if (!configured) throw new ConflictException('The public visit-registration address is not configured. No link was issued.');
  const base = new URL(configured);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
    throw new ConflictException('The public visit-registration address is unavailable.');
  const url = new URL('/visit-join', base); url.hash = new URLSearchParams({ token }).toString(); return url.href;
}

@Injectable()
export class VisitOnboardingService {
  constructor(private readonly db: DatabaseService,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort,
    private readonly identity: VisitOnboardingIdentity, private readonly model: VisitOnboardingModel) {}
  private async manager(tx: Tx, user: AuthUser, school: string) {
    z.uuid().parse(school);
    if (!user.is_active || user.active_school_id !== school || !await hasScopedSchoolPermission(tx, user.id, school, 'gate.manage', 'institution', school))
      throw new ForbiddenException('Current Manage In & Out authority is required.');
    const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: school, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException('Current canonical campus identity is required.');
    return actor;
  }
  private async visit(tx: Tx, school: string, id: string, lock = false) {
    z.uuid().parse(id); let query = tx.selectFrom('gate_visit_arrangements').selectAll().where('school_id', '=', school).where('id', '=', id);
    if (lock) query = query.forUpdate(); const visit = await query.executeTakeFirst();
    if (!visit) throw new NotFoundException('This visit is unavailable in the selected campus.'); return visit;
  }
  private async head(tx: Tx, school: string, visit: string) {
    return (await sql<Link>`SELECT * FROM gate_visit_onboarding_links WHERE school_id=${school}::uuid AND visit_id=${visit}::uuid ORDER BY revision DESC LIMIT 1`.execute(tx)).rows[0];
  }
  private async current(tx: Tx, link: Link) {
    return (await sql<{ valid: boolean }>`SELECT gate_visit_onboarding_current(${link.school_id}::uuid,${link.id}::uuid,${executionNow()}::timestamptz) AS valid`.execute(tx)).rows[0]?.valid === true;
  }
  private async state(tx: Tx, user: AuthUser, school: string, id: string) {
    await this.manager(tx, user, school); const visit = await this.visit(tx, school, id), link = await this.head(tx, school, id);
    const simulation = executionEnvironmentStorage.getStore()?.kind === 'simulation';
    const count = link ? (await sql<{ count: number }>`SELECT count(*)::int AS count FROM gate_visit_onboarding_registrations WHERE link_id=${link.id}::uuid`.execute(tx)).rows[0]!.count : 0;
    const state = !link ? null : link.action === 'revoke' ? 'revoked' as const : visit.state === 'cancelled' ? 'cancelled' as const
      : link.ends_at <= executionNow() ? 'expired' as const : await this.current(tx, link) ? 'active' as const : 'issuer_unavailable' as const;
    return { visit_id: id, visit_revision: visit.revision, revision: link?.revision ?? 0, can_manage: true, can_issue: visit.state === 'confirmed', can_revoke: link?.action === 'issue',
      public_onboarding_supported: !simulation,
      current: link ? { id: link.id, revision: link.revision, state: state!, ends_at: iso(link.ends_at), issued_at: iso(link.recorded_at), registration_count: count } : null };
  }
  management(user: AuthUser, school: string, id: string) { return this.db.transaction().execute(tx => this.state(tx, user, school, id)); }
  async reveal(user: AuthUser, school: string, id: string, raw: unknown) {
    const input = z.object({ expected_revision: z.number().int().positive(), expected_visit_revision: z.number().int().positive() }).strict().parse(raw);
    assertLiveAppAccountControl(); await this.rate(`reveal:${user.id}:${school}:${id}`, 30);
    return this.db.transaction().execute(async tx => {
      await this.manager(tx, user, school); const visit = await this.visit(tx, school, id, true), link = await this.head(tx, school, id);
      if (!link || link.revision !== input.expected_revision || visit.revision !== input.expected_visit_revision)
        throw new ConflictException('The visit or link changed. Review its current version before sharing.');
      if (!await this.current(tx, link)) throw new NotFoundException('This registration link is unavailable.');
      const token = visitOnboardingCredential(school, id, link.id);
      if (link.token_hash !== digest(token)) throw new ConflictException('This credential cannot be revealed. Explicitly replace the registration link after reviewing its current visitors.');
      const url = joinUrl(token);
      await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
        VALUES(${school}::uuid,${user.id}::uuid,'visit_registration_link.revealed',${link.id}::uuid,${JSON.stringify({ visit_id: id, revision: link.revision })}::jsonb)`.execute(tx);
      return { visit_id: id, visit_revision: visit.revision, link_id: link.id, revision: link.revision, ends_at: iso(link.ends_at), join_url: url };
    });
  }
  confirmation(user: AuthUser, school: string, id: string, command: string) {
    z.uuid().parse(command);
    return this.db.transaction().execute(async tx => {
      await this.manager(tx, user, school); await this.visit(tx, school, id);
      const retained = await this.model.retained(tx, user, school, command);
      if (!retained) return { state: 'not_found' as const, command_id: command, visit_id: id };
      if (retained.target.domain_id !== id) throw new ConflictException('This command belongs to another visit.');
      if (retained.state === 'pending') return { state: 'pending' as const, command_id: command, visit_id: id };
      return { state: retained.receipt.terminal_state, command_id: command, visit_id: id, ...retained.receipt.metadata };
    });
  }
  async change(user: AuthUser, school: string, id: string, raw: unknown) {
    const input = onboardingLinkCommand.parse(raw);
    return this.db.transaction().execute(async tx => {
      const actor = await this.manager(tx, user, school), visit = await this.visit(tx, school, id, true), old = await this.head(tx, school, id);
      const existing = (await sql<Link>`SELECT * FROM gate_visit_onboarding_links WHERE id=${input.command_id}::uuid`.execute(tx)).rows[0];
      const revision = existing ? existing.revision - 1 : old?.revision ?? 0;
      const source: OnboardingSource = { school, visit: id, id, recordId: input.command_id, revision, action: input.action };
      const prepared = await this.model.prepare(tx, user, source, input.command_id, input);
      if (!prepared.replay) {
        if (revision !== input.expected_revision || visit.revision !== input.expected_visit_revision)
          throw new ConflictException('The visit or registration link changed. Review the current source.');
        if (input.action === 'issue' && (visit.state !== 'confirmed' || Date.parse(input.ends_at!) <= executionNow().getTime()))
          throw new ConflictException('Issue a link only for a confirmed visit with an explicit future expiry.');
        if (input.action === 'revoke' && (!old || old.action !== 'issue')) throw new ConflictException('There is no current link to revoke.');
        const token = input.action === 'issue' ? visitOnboardingCredential(school, id, input.command_id) : null,
          event = await this.model.complete(tx, user, source, prepared.command);
        await sql`INSERT INTO gate_visit_onboarding_links(id,school_id,visit_id,revision,previous_id,action,token_hash,ends_at,recorded_at,actor_user_id,actor_person_id,command_id,domain_event_id)
          VALUES(${input.command_id}::uuid,${school}::uuid,${id}::uuid,${revision + 1},${old?.id ?? null}::uuid,${input.action},${token ? digest(token) : null},
          ${input.ends_at ? new Date(input.ends_at) : old!.ends_at},${executionNow()},${user.id}::uuid,${actor.person_id}::uuid,${prepared.command.command_id}::uuid,${event}::uuid)`.execute(tx);
      }
      const state = await this.state(tx, user, school, id), selected = await this.head(tx, school, id);
      let join_url: string | null = null;
      if (input.action === 'issue' && selected?.id === input.command_id && state.current?.state === 'active' && state.public_onboarding_supported) {
        const token = visitOnboardingCredential(school, id, input.command_id);
        if (selected.token_hash === digest(token)) join_url = joinUrl(token);
      }
      return { ...state, receipt: { command_id: input.command_id, link_id: input.command_id, revision: revision + 1, action: input.action, replayed: prepared.replay }, join_url };
    });
  }
  private async token(tx: Tx, raw: string, lock = false) {
    const row = (await sql<Link>`SELECT * FROM gate_visit_onboarding_links WHERE token_hash=${digest(raw)}`.execute(tx)).rows[0];
    if (!row) throw new NotFoundException('This visit registration link is unavailable.');
    if (lock) await this.visit(tx, row.school_id, row.visit_id, true);
    if (!await this.current(tx, row)) throw new NotFoundException('This visit registration link is unavailable.'); return row;
  }
  async preview(raw: unknown) {
    assertLiveAppAccountControl(); const input = onboardingPreviewInput.parse(raw);
    return this.db.transaction().execute(async tx => {
      const link = await this.token(tx, input.token), visit = await this.visit(tx, link.school_id, link.visit_id);
      const campus = await tx.selectFrom('schools').select(['id', 'name', 'timezone']).where('id', '=', link.school_id).executeTakeFirstOrThrow(),
        place = await readVisitDestination(tx,link.school_id,visit);
      return { campus: { id: campus.id, name: campus.name }, timezone: campus.timezone, visit: { id: visit.id, title: visit.title, starts_at: iso(visit.starts_at), ends_at: iso(visit.ends_at), place_label: place.label }, available_until: iso(link.ends_at), authentication_required: true as const };
    });
  }
  private async rate(key: string, maximum: number) {
    const row = (await sql<{ hits: number }>`INSERT INTO api_rate_limit_buckets(bucket_key,hits,expires_at) VALUES(${digest(`visit-onboarding:${key}`)},1,now()+interval '15 minutes')
      ON CONFLICT(bucket_key) DO UPDATE SET hits=CASE WHEN api_rate_limit_buckets.expires_at<=now() THEN 1 ELSE api_rate_limit_buckets.hits+1 END,
      expires_at=CASE WHEN api_rate_limit_buckets.expires_at<=now() THEN excluded.expires_at ELSE api_rate_limit_buckets.expires_at END RETURNING hits`.execute(this.db)).rows[0]!;
    if (row.hits > maximum) throw new HttpException('Too many registration requests. Wait15minutes before trying again.', 429);
  }
  async proof(raw: unknown, ip: string) {
    assertLiveAppAccountControl(); const input = onboardingProofInput.parse(raw);
    await this.rate(`proof-ip:${ip}`, 20); await this.rate(`proof-email:${input.email}`, 5); await this.rate(`proof-link:${digest(input.token)}`, 100);
    // Bounded account-plane hygiene; no active proof or domain history is removed.
    await sql`WITH expired AS(SELECT id FROM auth_visit_onboarding_challenges WHERE expires_at<=now() ORDER BY expires_at,id LIMIT 1000)
      DELETE FROM auth_visit_onboarding_challenges challenge USING expired WHERE challenge.id=expired.id`.execute(this.db);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), id = randomUUID();
    const result = await this.db.transaction().execute(async tx => {
      const link = await this.token(tx, input.token, true), at = executionNow(), expiry = new Date(Math.min(at.getTime() + 600_000, link.ends_at.getTime()));
      const recent = (await sql`SELECT 1 FROM auth_visit_onboarding_challenges WHERE link_id=${link.id}::uuid AND email=${input.email}
        AND consumed_at IS NULL AND created_at>${new Date(at.getTime() - 60_000)} LIMIT 1`.execute(tx)).rows.length;
      if (recent) throw new HttpException('Wait one minute before requesting another email confirmation.', 429);
      await sql`DELETE FROM auth_visit_onboarding_challenges WHERE link_id=${link.id}::uuid AND expires_at<=${at}`.execute(tx);
      const count = (await sql<{ count: number }>`SELECT count(*)::int AS count FROM auth_visit_onboarding_challenges WHERE link_id=${link.id}::uuid`.execute(tx)).rows[0]!.count;
      if (count >= 200) throw new HttpException('This link has too many pending confirmations. Try again later.', 429);
      await sql`INSERT INTO auth_visit_onboarding_challenges(id,link_id,email,code_hash,created_at,expires_at)
        VALUES(${id}::uuid,${link.id}::uuid,${input.email},${proofHash(id, input.email, code)},${at},${expiry})`.execute(tx);
      return { challenge_id: id, expires_at: iso(expiry), delivery: 'unavailable' as 'email_accepted' | 'unavailable', retry_after_seconds: 60 };
    });
    if (config().INVITATION_EMAIL_ENABLED) try {
      await sendTransactionalEmail({ to: input.email, senderName: 'ThatCampus', subject: 'Confirm your visit registration email',
        text: `Your email confirmation code is: ${code}\n\nUse it only in the ThatCampus visit registration you opened. It expires at ${result.expires_at}. Do not forward it. This code grants no campus entry or presence.` });
      return { ...result, delivery: 'email_accepted' as const };
    } catch { /* Unknown delivery never becomes proof; a new explicit request is needed. */ }
    await sql`DELETE FROM auth_visit_onboarding_challenges WHERE id=${id}::uuid`.execute(this.db); return result;
  }
  async account(raw: unknown) {
    assertLiveAppAccountControl(); const input = onboardingAccountInput.parse(raw); await this.rate(`account:${input.challenge_id}`, 5);
    return this.db.transaction().execute(async tx => {
      const link = await this.token(tx, input.token, true), row = (await sql<{ code_hash: string; email: string; expires_at: Date; consumed_at: Date | null }>`
        SELECT code_hash,email,expires_at,consumed_at FROM auth_visit_onboarding_challenges WHERE id=${input.challenge_id}::uuid AND link_id=${link.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      const supplied = proofHash(input.challenge_id, input.email, input.code);
      if (!row || row.email !== input.email || row.expires_at <= executionNow() || row.consumed_at || !timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(supplied, 'hex')))
        throw new ForbiddenException('The email confirmation is invalid or expired. Request another code.');
      const result = await this.identity.registerVerifiedAccount(tx, { email: input.email, firstName: input.first_name, lastName: input.last_name, password: input.password });
      if (result.status === 'created') await tx.insertInto('audit_events').values({ school_id: null, actor_id: result.user.id, action: 'auth.visit_registration.account_created',
        target_type: 'user', target_id: result.user.id, request_id: input.challenge_id, ip_hash: null, metadata: { link_id: link.id, creates_membership: false } }).execute();
      await sql`DELETE FROM auth_visit_onboarding_challenges WHERE id=${input.challenge_id}::uuid`.execute(tx);
      return { status: result.status };
    });
  }
  async join(user: AuthUser, raw: unknown) {
    assertLiveAppAccountControl(); const input = onboardingJoinInput.parse(raw);
    return this.db.transaction().execute(async tx => {
      const link = await this.token(tx, input.token, true);
      const existing = (await sql<{ id: string; school_id: string; visit_id: string; link_id: string; user_id: string }>`SELECT * FROM gate_visit_onboarding_registrations
        WHERE id=${input.command_id}::uuid OR(link_id=${link.id}::uuid AND user_id=${user.id}::uuid) ORDER BY (id=${input.command_id}::uuid) DESC,registered_at LIMIT 1`.execute(tx)).rows[0];
      if (existing) {
        if (existing.user_id !== user.id || existing.link_id !== link.id) throw new ConflictException('This command belongs to another visitor registration.');
        const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: link.school_id, user_id: user.id, at: executionNow().toISOString() });
        if (!actor.acting || !user.email_verified_at) throw new ForbiddenException('Current verified campus identity is required to inspect registration.');
        return this.joinResult(existing.id, link, true);
      }
      const identity = await this.identity.joinIdentity(tx, { user, schoolId: link.school_id, sourceId: input.command_id, issuerId: link.actor_user_id,
        beforeBinding: async person => { await sql`INSERT INTO gate_visit_onboarding_registrations(id,school_id,visit_id,link_id,user_id,person_id,registered_at)
          VALUES(${input.command_id}::uuid,${link.school_id}::uuid,${link.visit_id}::uuid,${link.id}::uuid,${user.id}::uuid,${person}::uuid,${executionNow()})`.execute(tx); } });
      const source: OnboardingSource = { school: link.school_id, visit: link.visit_id, id: input.command_id, recordId: input.command_id, revision: 0, action: 'joined' };
      const prepared = await this.model.prepare(tx, { ...identity.user, active_school_id: link.school_id }, source, input.command_id, { link_id: link.id, user_id: user.id });
      if (prepared.replay) throw new ConflictException('The retained registration needs review; no second identity was created.');
      const event = await this.model.complete(tx, { ...identity.user, active_school_id: link.school_id }, source, prepared.command);
      await sql`UPDATE gate_visit_onboarding_registrations SET gateway_command_id=${prepared.command.command_id}::uuid,domain_event_id=${event}::uuid WHERE id=${input.command_id}::uuid`.execute(tx);
      return this.joinResult(input.command_id, link, false);
    });
  }
  private joinResult(id: string, link: Link, replayed: boolean) { return { accepted: true as const, registration_id: id, school_id: link.school_id, visit_id: link.visit_id, href: participantVisitHref(link.visit_id), replayed }; }
  async registered(user: AuthUser, school: string, rawPage?: string) {
    const page = z.coerce.number().int().min(1).max(2147483647).default(1).parse(rawPage);
    return this.db.transaction().setIsolationLevel('repeatable read').execute(async tx => {
      const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: school, user_id: user.id, at: executionNow().toISOString() });
      if (!actor.acting || user.active_school_id !== school) throw new ForbiddenException('Select your current campus identity.');
      const filter = sql`registration.school_id=${school}::uuid AND registration.user_id=${user.id}::uuid AND registration.person_id=${actor.person_id}::uuid
        AND link.action='issue' AND link.ends_at>${executionNow()} AND NOT EXISTS(SELECT 1 FROM gate_visit_onboarding_links later WHERE later.school_id=link.school_id AND later.visit_id=link.visit_id AND later.revision>link.revision)
        AND gate_visit_actor_can_manage(link.school_id,link.actor_user_id) AND campus_model_account_person_is_active(link.school_id,link.actor_user_id,link.actor_person_id,${executionNow()}::timestamptz)`;
      const from = sql`gate_visit_onboarding_registrations registration JOIN gate_visit_onboarding_links link ON link.id=registration.link_id
        JOIN gate_visit_arrangements visit ON visit.id=registration.visit_id AND visit.school_id=registration.school_id`;
      const count = (await sql<{ total: number }>`SELECT count(*)::int AS total FROM ${from} WHERE ${filter}`.execute(tx)).rows[0]!.total;
      const visits = (await sql<{ id: string; title: string; starts_at: Date; ends_at: Date; state: 'confirmed' | 'cancelled' }>`SELECT visit.id,visit.title,visit.starts_at,visit.ends_at,visit.state
        FROM ${from} WHERE ${filter} ORDER BY visit.starts_at,visit.id LIMIT 10 OFFSET ${(page - 1) * 10}`.execute(tx)).rows;
      const campus = await tx.selectFrom('schools').select('timezone').where('id', '=', school).executeTakeFirstOrThrow();
      return { timezone: campus.timezone, visits: visits.map(visit => ({ ...visit, starts_at: iso(visit.starts_at), ends_at: iso(visit.ends_at), href: participantVisitHref(visit.id) })),
        pagination: { page, page_size: 10, total: count, total_pages: Math.ceil(count / 10) } };
    });
  }
  async participant(user: AuthUser, school: string, id: string) {
    return this.db.transaction().execute(async tx => {
      const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: school, user_id: user.id, at: executionNow().toISOString() });
      if (!actor.acting || user.active_school_id !== school) throw new ForbiddenException('Select the campus and your current visitor identity.');
      const link = await this.head(tx, school, id), visit = await this.visit(tx, school, id);
      if (!link || link.action !== 'issue' || link.ends_at <= executionNow()) throw new NotFoundException('This visitor access has ended.');
      // Cancellation stays readable; it never becomes an arrival or entry grant.
      const issuer = (await sql<{ valid: boolean }>`SELECT gate_visit_actor_can_manage(${school}::uuid,${link.actor_user_id}::uuid)
        AND campus_model_account_person_is_active(${school}::uuid,${link.actor_user_id}::uuid,${link.actor_person_id}::uuid,${executionNow()}::timestamptz) AS valid`.execute(tx)).rows[0]?.valid;
      if (!issuer || visit.state !== 'cancelled' && !await this.current(tx, link)) throw new NotFoundException('This visitor access is unavailable.');
      const registration = (await sql<{ id: string; registered_at: Date }>`SELECT id,registered_at FROM gate_visit_onboarding_registrations WHERE school_id=${school}::uuid
        AND visit_id=${id}::uuid AND link_id=${link.id}::uuid AND user_id=${user.id}::uuid AND person_id=${actor.person_id}::uuid`.execute(tx)).rows[0];
      if (!registration) throw new NotFoundException('You have not registered for this visit.');
      const campus = await tx.selectFrom('schools').select('timezone').where('id', '=', school).executeTakeFirstOrThrow(),
        place = await readVisitDestination(tx,school,visit),
        contact = await tx.selectFrom('school_people').select(['first_name', 'last_name']).where('school_id', '=', school).where('id', '=', visit.contact_person_id).executeTakeFirstOrThrow();
      return { timezone: campus.timezone, registration: { id: registration.id, registered_at: iso(registration.registered_at), person_label: actor.label, evidence: 'self_registered' as const },
        available_until: iso(link.ends_at), visit: { id, revision: visit.revision, title: visit.title, state: visit.state, starts_at: iso(visit.starts_at), ends_at: iso(visit.ends_at), place:{label:place.label,campus_label:place.campus_label},
          contact: { label: `${contact.first_name} ${contact.last_name}`.trim() } }, entry_permission: false as const, presence_confirmed: false as const };
    });
  }
}
