import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { hashPassword, validatePassword } from '../auth/password.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { HUMAN_AGENT_IDENTITY_PORT, type ActingHumanAgentIdentity, type HumanAgentIdentityPort } from '../campus-model-core/human-agent-identity.port.js';
import type { AuthUser } from '../common/request.js';
import type { Database } from '../database/types.js';
import { assertLiveAppAccountControl } from '../operations/person-account-invitations.service.js';

type Tx = Transaction<Database>;
type Account = AuthUser & { onboarding_pending: boolean };
const accountInput = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  firstName: z.string().trim().min(1).max(150),
  lastName: z.string().trim().max(150).default(''),
  password: z.string().min(1).max(128),
}).strict();
const sourceInput = z.object({ schoolId: z.uuid(), sourceId: z.uuid(), issuerId: z.uuid() }).strict();

export type VisitAccountRegistration = { status: 'created'; user: AuthUser } | { status: 'sign_in_required' };
export interface VisitIdentityJoin {
  user: AuthUser;
  schoolId: string;
  /** Exact retained onboarding registration / caller command ID. */
  sourceId: string;
  issuerId: string;
  /** Retain the caller's exact source evidence before the native account binding. */
  beforeBinding(personId: string): Promise<void>;
}
export interface VisitIdentityJoined {
  user: AuthUser;
  actor: ActingHumanAgentIdentity;
  createdCampusConnection: boolean;
}

function publicAccount(account: Account | AuthUser, activeSchool: string | null = null): AuthUser {
  return { id: account.id, username: account.username, email: account.email, first_name: account.first_name,
    last_name: account.last_name, role: account.role, is_active: account.is_active,
    email_verified_at: account.email_verified_at ?? null, active_school_id: activeSchool };
}

/** Identity only. The caller owns mailbox proof, normal authenticated MFA/session,
 * current link authority and final Gateway/journal evidence in this same transaction.
 * No visit access, invitation, credentials response or session is issued here. */
@Injectable()
export class VisitOnboardingIdentity {
  constructor(@Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort) {}

  /** Call only after independently validating and consuming the exact mailbox
   * challenge. An existing account always follows normal sign-in, including MFA. */
  async registerVerifiedAccount(tx: Tx, raw: { email: string; firstName: string; lastName?: string; password: string }): Promise<VisitAccountRegistration> {
    assertLiveAppAccountControl();
    const input = accountInput.parse(raw);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`visit-onboarding-account:${input.email}`},0))`.execute(tx);
    const existing = (await sql<{ id: string }>`SELECT id FROM users WHERE lower(email)=${input.email} FOR UPDATE`.execute(tx)).rows[0];
    if (existing) return { status: 'sign_in_required' };
    const errors = validatePassword(input.password, { email: input.email, firstName: input.firstName, lastName: input.lastName });
    if (errors.length) throw new BadRequestException(errors.join(' '));
    const passwordHash = await hashPassword(input.password), at = executionNow();
    // Other normal account ceremonies use the same unique email constraint.
    // A concurrent creation must never become a password reset or account claim.
    const account = (await sql<Account>`INSERT INTO users(username,email,password_hash,first_name,last_name,role,is_active,email_verified_at,onboarding_pending)
      VALUES(${`member.${randomUUID()}`},${input.email},${passwordHash},${input.firstName},${input.lastName},'member',true,${at},false)
      ON CONFLICT DO NOTHING
      RETURNING id,username,email,first_name,last_name,role,is_active,email_verified_at,onboarding_pending`.execute(tx)).rows[0];
    return account ? { status: 'created', user: publicAccount(account) } : { status: 'sign_in_required' };
  }

  /** Requires a normally authenticated verified account. Never restores retained
   * campus membership, profile or endpoint history, and never matches a person by
   * their name/email. Root-owned source guards validate beforeBinding evidence. */
  async joinIdentity(tx: Tx, input: VisitIdentityJoin): Promise<VisitIdentityJoined> {
    assertLiveAppAccountControl();
    const source = sourceInput.parse({ schoolId: input.schoolId, sourceId: input.sourceId, issuerId: input.issuerId });
    z.uuid().parse(input.user.id);
    if (!input.user.is_active || !input.user.email_verified_at || typeof input.beforeBinding !== 'function')
      throw new ForbiddenException('Sign in with a verified active account before joining this visit.');
    const account = (await sql<Account>`SELECT id,username,email,first_name,last_name,role,is_active,email_verified_at,onboarding_pending
      FROM users WHERE id=${input.user.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
    if (!account || !account.is_active || !account.email_verified_at || account.onboarding_pending
      || account.email.toLowerCase() !== input.user.email.trim().toLowerCase())
      throw new ForbiddenException('Your account changed. Complete normal sign-in and email verification before joining.');
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`visit-onboarding-person:${source.schoolId}:${account.id}`},0))`.execute(tx);
    const at = executionNow().toISOString(), current = await this.identities.resolveAccountEndpoint(tx, { school_id: source.schoolId, user_id: account.id, at });
    const user = publicAccount(account, input.user.active_school_id ?? null);
    if (current.acting) {
      this.assertActor(current, source.schoolId, account.id);
      await input.beforeBinding(current.person_id);
      return { user, actor: current, createdCampusConnection: false };
    }
    if (current.reason !== 'account_not_linked')
      throw new ConflictException('This account has retained campus identity. Ask the campus to review access instead of joining again.');
    const history = (await sql<{ retained: boolean }>`SELECT EXISTS(
      SELECT 1 FROM school_memberships WHERE school_id=${source.schoolId}::uuid AND user_id=${account.id}::uuid
      UNION ALL SELECT 1 FROM campus_model_agent_endpoints WHERE school_id=${source.schoolId}::uuid AND user_id=${account.id}::uuid
      UNION ALL SELECT 1 FROM school_people WHERE school_id=${source.schoolId}::uuid AND account_user_id=${account.id}::uuid
      UNION ALL SELECT 1 FROM students WHERE school_id=${source.schoolId}::uuid AND user_id=${account.id}::uuid
      UNION ALL SELECT 1 FROM staff_profiles WHERE school_id=${source.schoolId}::uuid AND user_id=${account.id}::uuid
      UNION ALL SELECT 1 FROM guardian_school_profiles profile JOIN parents guardian ON guardian.id=profile.guardian_id
        WHERE profile.school_id=${source.schoolId}::uuid AND guardian.user_id=${account.id}::uuid
      UNION ALL SELECT 1 FROM institution_governance_appointments WHERE school_id=${source.schoolId}::uuid AND linked_user_id=${account.id}::uuid
    ) AS retained`.execute(tx)).rows[0];
    if (!history || history.retained)
      throw new ConflictException('This account has retained campus access. Ask the campus to review its exact person instead of creating another.');
    const firstName = z.string().trim().min(1).max(150).parse(account.first_name), lastName = z.string().trim().max(150).parse(account.last_name);
    const person = (await sql<{ id: string }>`INSERT INTO school_people(school_id,first_name,last_name,contact_email)
      VALUES(${source.schoolId}::uuid,${firstName},${lastName},${account.email}) RETURNING id`.execute(tx)).rows[0];
    if (!person) throw new ConflictException('Your campus identity could not be retained.');
    await sql`INSERT INTO school_memberships(school_id,user_id,role,access_scope,is_active)
      VALUES(${source.schoolId}::uuid,${account.id}::uuid,'member','assigned_work',true)`.execute(tx);
    await input.beforeBinding(person.id);
    // The exact registration must satisfy the native binding guard; its deferred
    // Gateway/journal proof is completed by the caller before this transaction ends.
    const bound = (await sql<{ id: string }>`UPDATE school_people SET account_user_id=${account.id}::uuid,revision=revision+1
      WHERE school_id=${source.schoolId}::uuid AND id=${person.id}::uuid AND account_user_id IS NULL AND retired_at IS NULL RETURNING id`.execute(tx)).rows[0];
    if (!bound) throw new ConflictException('Your exact campus person changed before account linking.');
    const actor = await this.identities.linkAccountEndpoint(tx, { school_id: source.schoolId, person_id: person.id, user_id: account.id,
      actor_user_id: account.id, effective_from: at, effective_until: null, source_domain: 'gate',
      source_record_id: source.sourceId, source_revision: 1,
      metadata: { self_declared: true, account_access_only: true, technical_scope: 'assigned_work', issuer_user_id: source.issuerId } });
    this.assertActor(actor, source.schoolId, account.id, person.id);
    return { user, actor, createdCampusConnection: true };
  }

  private assertActor(actor: ActingHumanAgentIdentity, school: string, user: string, person?: string) {
    if (actor.school_id !== school || actor.user_id !== user || !z.uuid().safeParse(actor.person_id).success || person && actor.person_id !== person)
      throw new ConflictException('The identity receipt does not match this exact campus account and person.');
  }
}
