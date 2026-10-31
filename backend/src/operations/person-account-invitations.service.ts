import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { issueInvitationCode } from "../common/invitation-code.js";
import { enqueueInvitation } from "../common/invitation-queue.js";
import { selectedSimulationResources } from "../common/simulation-resources.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { institutionSchoolPermissionForUser } from "../roles/authorization.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { linkAcceptedStaffAccount } from '../people/accepted-staff-account.js';
import { authorizeExternalInvitation, externalContinuation } from '../facilities/facilities-external.access.js';
import { authorizeVisitInvitation, visitContinuation } from '../gate/visit-sharing.access.js';

const workContextSchema = z.object({ kind: z.enum(['facility_repair', 'visit_arrangement']), source_id: z.uuid(), access_id: z.uuid() }).strict();
type WorkContext = z.infer<typeof workContextSchema>;
type InvitationSource = { access_scope?: 'campus' | 'assigned_work'; work_source_kind?: 'facility_repair' | 'visit_arrangement' | null;
  work_source_id?: string | null; work_access_id?: string | null; work_visit_access_id?: string | null };
export function invitationWorkContext(source: InvitationSource): WorkContext | null {
  if (source.access_scope !== 'assigned_work') return null;
  const parsed = workContextSchema.safeParse({ kind: source.work_source_kind, source_id: source.work_source_id,
    access_id: source.work_source_kind === 'visit_arrangement' ? source.work_visit_access_id : source.work_access_id });
  if (!parsed.success) throw new ConflictException('The assigned-work invitation has no valid source. Ask the campus contact to review it.');
  return parsed.data;
}

export const personAccountInvitationSchema = z.object({
  email: z.email().trim().toLowerCase(), role: z.literal("member"), person_id: z.string().uuid(), idempotency_key: z.string().uuid(),
  work_context: workContextSchema.optional(),
}).strict();
type InvitationView = InvitationSource & { id: string; school_id: string; created_by: string; person_id: string | null; email: string; role: string; source: string;
  expires_at: Date; accepted_at: Date | null; revoked_at: Date | null; delivery: string | null; delivery_job_id: string | null };

/** UUIDv8: a namespaced request identifier, never an invitation credential. */
function invitationRequestId(schoolId: string, actorId: string, key: string) {
  const digest = createHash("sha256").update(JSON.stringify(["people.app_access.v1", schoolId, actorId, key])).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${((parseInt(digest[16]!, 16) & 3) | 8).toString(16)}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function assertLiveAppAccountControl() {
  if (executionEnvironmentStorage.getStore()?.kind === "simulation" || selectedSimulationResources())
    throw new ForbiddenException("App accounts and invitations are managed in Live. This simulation has not sent an invitation or changed access.");
}

/** Auth/People account control plane. No credentials, invitations or grants are created in a world. */
@Injectable()
export class PersonAccountInvitationsService {
  constructor(private readonly db: DatabaseService,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identity: HumanAgentIdentityPort,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly gateway: DomainCommandGatewayPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort) {}

  assertLive() {
    assertLiveAppAccountControl();
  }

  /** Read-only uncertain-response recovery; never restore an endpoint or membership. */
  async assertActiveAcceptedRecipient(tx: Transaction<Database>, input: { school_id: string; person_id: string; user_id: string }) {
    this.assertLive();
    const current = await this.identity.resolveAccountEndpoint(tx, { school_id: input.school_id,
      user_id: input.user_id, at: executionNow().toISOString() });
    if (!current.acting || current.person_id !== input.person_id)
      throw new ForbiddenException('This accepted campus access is no longer active. Sign in or ask the campus to review access.');
  }

  async unlinkedPersonIdsInTransaction(tx:Transaction<Database>,schoolId:string,personIds:string[]) {
    this.assertLive();
    const unlinked:string[]=[],at=executionNow().toISOString();
    for(let start=0;start<personIds.length;start+=25) {
      const states=await this.identity.listPersonAccountStates(tx,{school_id:schoolId,person_ids:personIds.slice(start,start+25),at});
      unlinked.push(...states.filter(state=>!state.has_account).map(state=>state.person_id));
    }
    return unlinked;
  }

  async linkAcceptedStaffEndpointInTransaction(tx:Transaction<Database>,input:{school_id:string;person_id:string;user_id:string}) {
    this.assertLive();
    await linkAcceptedStaffAccount(tx,this.identity,{...input,actor_user_id:input.user_id,at:executionNow().toISOString()});
  }

  async assertExactProfileAccountTargetInTransaction(tx:Transaction<Database>,input:{school_id:string;person_id:string;user_id:string}) {
    this.assertLive();
    const target=(await sql<{id:string;account_user_id:string|null}>`SELECT id,account_user_id FROM school_people WHERE school_id=${input.school_id}::uuid AND id=${input.person_id}::uuid AND retired_at IS NULL FOR UPDATE`.execute(tx)).rows[0];
    if(!target) throw new ConflictException('The intended campus person is no longer available. Ask the administrator to review app access.');
    if(target.account_user_id && target.account_user_id!==input.user_id)
      throw new ConflictException('This person has retained app access for another account. Review its People profile instead of replacing that identity.');
    const current=await this.identity.resolveAccountEndpoint(tx,{school_id:input.school_id,user_id:input.user_id,at:executionNow().toISOString()});
    if((current.person_id && current.person_id!==input.person_id) || (!current.acting && current.reason!=='account_not_linked'))
      throw new ConflictException('This account has retained campus app access. Review its exact People profile instead of accepting another identity.');
    const [state]=await this.identity.listPersonAccountStates(tx,{school_id:input.school_id,person_ids:[input.person_id],
      viewer_user_id:input.user_id,at:executionNow().toISOString()});
    if(state?.has_account && !(current.acting && current.person_id===input.person_id && state.is_you))
      throw new ConflictException('This person has retained app access. Review its People profile instead of replacing that identity.');
    const conflicting=(await sql`SELECT 1 FROM (
      SELECT id AS person_id FROM school_people WHERE school_id=${input.school_id}::uuid AND account_user_id=${input.user_id}::uuid
      UNION SELECT person_id FROM students WHERE school_id=${input.school_id}::uuid AND user_id=${input.user_id}::uuid
      UNION SELECT person_id FROM staff_profiles WHERE school_id=${input.school_id}::uuid AND user_id=${input.user_id}::uuid
      UNION SELECT profile.person_id FROM guardian_school_profiles profile JOIN parents guardian ON guardian.id=profile.guardian_id
        WHERE profile.school_id=${input.school_id}::uuid AND guardian.user_id=${input.user_id}::uuid
      UNION SELECT person_id FROM institution_governance_appointments WHERE school_id=${input.school_id}::uuid AND linked_user_id=${input.user_id}::uuid
    ) exact WHERE person_id<>${input.person_id}::uuid`.execute(tx)).rows[0];
    if(conflicting) throw new ConflictException('This account belongs to another campus person. Review app access in People.');
  }

  async linkAcceptedGuardianEndpointInTransaction(tx:Transaction<Database>,input:{school_id:string;guardian_id:string;user_id:string;invitation_id:string}) {
    this.assertLive();
    const source=(await sql<{person_id:string}>`SELECT profile.person_id FROM school_invitations invitation
      JOIN parents guardian ON guardian.id=invitation.guardian_id AND guardian.user_id=invitation.accepted_by_user_id
      JOIN guardian_school_profiles profile ON profile.guardian_id=guardian.id AND profile.school_id=invitation.school_id
      JOIN users account ON account.id=guardian.user_id AND account.is_active AND account.email_verified_at IS NOT NULL
      JOIN school_memberships membership ON membership.school_id=invitation.school_id AND membership.user_id=account.id
        AND membership.role='guardian' AND membership.is_active
      WHERE invitation.id=${input.invitation_id}::uuid AND invitation.school_id=${input.school_id}::uuid
        AND invitation.guardian_id=${input.guardian_id}::uuid AND invitation.accepted_by_user_id=${input.user_id}::uuid
        AND invitation.role='guardian' AND invitation.source='school' AND invitation.accepted_at IS NOT NULL
        AND invitation.revoked_at IS NULL AND invitation.expires_at>invitation.accepted_at
      FOR SHARE OF invitation,guardian,profile,account,membership`.execute(tx)).rows[0];
    if(!source) throw new ConflictException('Guardian access needs its exact accepted invitation and canonical campus profile.');
    const current=await this.identity.resolveAccountEndpoint(tx,{school_id:input.school_id,user_id:input.user_id,at:executionNow().toISOString()});
    if(current.acting) {
      if(current.person_id!==source.person_id) throw new ConflictException('The account belongs to a different campus person. Review app access in People.');
      return;
    }
    if(current.reason!=='account_not_linked') throw new ConflictException('The retained account endpoint needs review. An invitation cannot restore access.');
    await this.identity.linkAccountEndpoint(tx,{school_id:input.school_id,person_id:source.person_id,user_id:input.user_id,actor_user_id:input.user_id,
      effective_from:executionNow().toISOString(),effective_until:null,source_domain:'auth',source_record_id:input.invitation_id,source_revision:1,
      metadata:{accepted_guardian_invitation_id:input.invitation_id,identity_only:true}});
  }

  /** Student app access follows its exact accepted invitation, never an email/name match. */
  async linkAcceptedStudentEndpointInTransaction(tx:Transaction<Database>,input:{school_id:string;student_id:string;user_id:string;invitation_id:string}) {
    this.assertLive();
    const source=(await sql<{person_id:string;account_user_id:string|null;created_by:string;inviter_role:string}>`SELECT student.person_id,person.account_user_id,invitation.created_by,issuer.role AS inviter_role
      FROM school_invitations invitation
      JOIN students student ON student.school_id=invitation.school_id AND student.id=invitation.student_id
        AND student.user_id=invitation.accepted_by_user_id
      JOIN school_people person ON person.school_id=student.school_id AND person.id=student.person_id AND person.retired_at IS NULL
      JOIN users account ON account.id=student.user_id AND account.is_active AND account.email_verified_at IS NOT NULL
        AND lower(account.email)=invitation.email
      JOIN school_memberships membership ON membership.school_id=invitation.school_id AND membership.user_id=account.id
        AND membership.role='student' AND membership.is_active
      JOIN users inviter ON inviter.id=invitation.created_by AND inviter.is_active
      JOIN school_memberships issuer ON issuer.school_id=invitation.school_id AND issuer.user_id=inviter.id AND issuer.is_active
      WHERE invitation.id=${input.invitation_id}::uuid AND invitation.school_id=${input.school_id}::uuid
        AND invitation.student_id=${input.student_id}::uuid AND invitation.accepted_by_user_id=${input.user_id}::uuid
        AND invitation.role='student' AND invitation.source='school' AND invitation.custom_role_id IS NULL
        AND invitation.accepted_at IS NOT NULL AND invitation.revoked_at IS NULL AND invitation.expires_at>invitation.accepted_at
      ORDER BY (issuer.role='admin') DESC
      FOR SHARE OF invitation,student,person,account,membership,inviter,issuer`.execute(tx)).rows[0];
    if(!source) throw new ConflictException('Student access needs its exact accepted invitation and canonical learner profile.');
    if(source.inviter_role!=='admin') await institutionSchoolPermissionForUser(tx,source.created_by,input.school_id,'members.invite');
    await this.assertInviterIdentity(tx,input.school_id,source.created_by);
    if(source.account_user_id && source.account_user_id!==input.user_id)
      throw new ConflictException('This learner has retained app access for another account. Review its People profile.');
    // A historical learner profile can already name this exact account without an
    // endpoint. Validate both retained histories instead of treating that explicit
    // profile binding as permission to restore a revoked identity.
    const person=await this.identity.resolvePersonAgent(tx,{school_id:input.school_id,person_id:source.person_id,at:executionNow().toISOString()});
    if((person.acting && person.user_id!==input.user_id) || (!person.acting && !['agent_not_registered','account_not_linked'].includes(person.reason)))
      throw new ConflictException('The learner has retained campus app access. An invitation cannot replace or restore it.');
    const conflicting=(await sql`WITH bindings AS (
      SELECT id AS person_id,account_user_id AS user_id FROM school_people WHERE school_id=${input.school_id}::uuid AND account_user_id IS NOT NULL
      UNION SELECT person_id,user_id FROM students WHERE school_id=${input.school_id}::uuid AND user_id IS NOT NULL
      UNION SELECT person_id,user_id FROM staff_profiles WHERE school_id=${input.school_id}::uuid AND user_id IS NOT NULL
      UNION SELECT profile.person_id,guardian.user_id FROM guardian_school_profiles profile JOIN parents guardian ON guardian.id=profile.guardian_id
        WHERE profile.school_id=${input.school_id}::uuid AND guardian.user_id IS NOT NULL
      UNION SELECT person_id,linked_user_id FROM institution_governance_appointments WHERE school_id=${input.school_id}::uuid AND linked_user_id IS NOT NULL
    ) SELECT 1 FROM bindings WHERE (user_id=${input.user_id}::uuid AND person_id<>${source.person_id}::uuid)
      OR (person_id=${source.person_id}::uuid AND user_id<>${input.user_id}::uuid)`.execute(tx)).rows[0];
    if(conflicting) throw new ConflictException('The account and learner have conflicting campus person bindings. Review app access in People.');
    const current=await this.identity.resolveAccountEndpoint(tx,{school_id:input.school_id,user_id:input.user_id,at:executionNow().toISOString()});
    if(current.acting) {
      if(current.person_id!==source.person_id) throw new ConflictException('The account belongs to a different campus person. Review app access in People.');
      return;
    }
    if(current.reason!=='account_not_linked') throw new ConflictException('The retained account endpoint needs review. An invitation cannot restore access.');
    await this.identity.linkAccountEndpoint(tx,{school_id:input.school_id,person_id:source.person_id,user_id:input.user_id,actor_user_id:input.user_id,
      effective_from:executionNow().toISOString(),effective_until:null,source_domain:'auth',source_record_id:input.invitation_id,source_revision:1,
      metadata:{accepted_student_invitation_id:input.invitation_id,identity_only:true}});
  }

  /** The accepting owner confirms a profile; company membership alone never manufactures an acting person. */
  async confirmCompanyAdministratorInTransaction(tx: Transaction<Database>, invitation: {
    id: string; school_id: string; source: string; role: string;
  }, userId: string, profile: { confirmed: boolean; first_name: string; last_name: string }) {
    this.assertLive();
    const valid = (await sql`SELECT invitation.id FROM school_invitations invitation
      JOIN company_operators operator ON operator.user_id=invitation.created_by AND operator.is_active
      JOIN users inviter ON inviter.id=operator.user_id AND inviter.is_active
      JOIN users account ON account.id=${userId}::uuid AND account.is_active AND lower(account.email)=invitation.email
      JOIN school_memberships membership ON membership.school_id=invitation.school_id AND membership.user_id=account.id
        AND membership.role='admin' AND membership.is_active
      WHERE invitation.id=${invitation.id}::uuid AND invitation.school_id=${invitation.school_id}::uuid
        AND invitation.source='company' AND invitation.role='admin' AND invitation.accepted_at IS NULL
        AND invitation.revoked_at IS NULL AND invitation.expires_at>now()`.execute(tx)).rows[0];
    if (!valid || invitation.source !== "company" || invitation.role !== "admin")
      throw new ForbiddenException("A current company administrator invitation is required for this confirmation.");
    const explicit = (await sql<{ person_id: string }>`SELECT id AS person_id FROM school_people
        WHERE school_id=${invitation.school_id}::uuid AND account_user_id=${userId}::uuid
      UNION SELECT person_id FROM students WHERE school_id=${invitation.school_id}::uuid AND user_id=${userId}::uuid
      UNION SELECT person_id FROM staff_profiles WHERE school_id=${invitation.school_id}::uuid AND user_id=${userId}::uuid
      UNION SELECT profile.person_id FROM guardian_school_profiles profile JOIN parents parent ON parent.id=profile.guardian_id
        WHERE profile.school_id=${invitation.school_id}::uuid AND parent.user_id=${userId}::uuid
      UNION SELECT person_id FROM institution_governance_appointments
        WHERE school_id=${invitation.school_id}::uuid AND linked_user_id=${userId}::uuid`.execute(tx)).rows;
    if (explicit.length > 1) throw new ConflictException("This account has conflicting campus person bindings. Ask the institution to review them.");
    const at = executionNow().toISOString();
    const identity = await this.identity.resolveAccountEndpoint(tx, { school_id: invitation.school_id, user_id: userId, at });
    if (identity.acting) {
      if (explicit[0] && explicit[0].person_id !== identity.person_id)
        throw new ConflictException("This account has conflicting campus person bindings. Ask the institution to review them.");
      return { person_id: identity.person_id, created: false };
    }
    if (identity.reason !== "account_not_linked")
      throw new ConflictException("This account's retained campus identity needs review. An invitation cannot restore or replace it.");
    if (!profile.confirmed) throw new ConflictException({ code: "admin_person_confirmation_required",
      message: "Confirm your campus person profile to finish this administrator invitation. Your invitation has not been accepted yet." });
    let person = explicit[0] ? (await sql<{ id: string; first_name: string; last_name: string; revision: number; account_user_id: string | null; retired_at: Date | null }>`SELECT
      id,first_name,last_name,revision,account_user_id,retired_at FROM school_people
      WHERE school_id=${invitation.school_id}::uuid AND id=${explicit[0].person_id}::uuid FOR UPDATE`.execute(tx)).rows[0] : undefined;
    const created = !explicit.length;
    if (explicit.length && (!person || person.retired_at || (person.account_user_id && person.account_user_id !== userId)))
      throw new ConflictException("The existing campus person binding needs review. This invitation cannot replace it.");
    if (person) {
      const existingIdentity = await this.identity.resolvePersonAgent(tx, { school_id: invitation.school_id, person_id: person.id, at });
      if (existingIdentity.acting || !["agent_not_registered", "account_not_linked"].includes(existingIdentity.reason))
        throw new ConflictException("This person's retained app identity needs review. This invitation cannot replace it.");
      // Exact account/profile bindings can be completed, never matched by contact/name or silently renamed.
    } else {
      person = (await sql<{ id: string; first_name: string; last_name: string; revision: number; account_user_id: string | null; retired_at: Date | null }>`INSERT INTO school_people
        (school_id,first_name,last_name) VALUES
        (${invitation.school_id}::uuid,${profile.first_name},${profile.last_name})
        RETURNING id,first_name,last_name,revision,account_user_id,retired_at`.execute(tx)).rows[0]!;
    }
    // Persist the confirmed exact target before the guarded binding; all effects
    // and invitation consumption still roll back together if Core rejects it.
    await sql`UPDATE school_invitations SET person_id=${person.id}::uuid,accepted_at=now(),
      accepted_by_user_id=${userId}::uuid,admin_person_confirmed_at=now()
      WHERE id=${invitation.id}::uuid AND school_id=${invitation.school_id}::uuid`.execute(tx);
    await sql`UPDATE school_people SET account_user_id=${userId}::uuid,revision=revision+1
      WHERE school_id=${invitation.school_id}::uuid AND id=${person.id}::uuid AND account_user_id IS NULL`.execute(tx);
    await this.identity.linkAccountEndpoint(tx, { school_id: invitation.school_id, person_id: person.id, user_id: userId,
      actor_user_id: userId, effective_from: at, effective_until: null, source_domain: "auth", source_record_id: invitation.id,
      source_revision: 1, metadata: { accepted_company_administrator_invitation_id: invitation.id, profile_confirmation: true, identity_only: true } });
    await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
      VALUES(${invitation.school_id}::uuid,${userId}::uuid,'administrator.person_confirmed',${person.id}::uuid,
        ${JSON.stringify({ invitation_id: invitation.id, person_created: created, employment_created: false })}::jsonb)`.execute(tx);
    return { person_id: person.id, created };
  }

  async assertInviterIdentity(tx: Transaction<Database>, schoolId: string, userId: string) {
    const identity = await this.identity.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: userId,
      at: executionNow().toISOString() });
    if (!identity.acting) throw new ForbiddenException("The inviter's campus app access is no longer active. Ask an active administrator to review this invitation.");
  }

  private async authorize(tx: Transaction<Database>, user: AuthUser, schoolId: string) {
    z.string().uuid().parse(schoolId);
    if (user.active_school_id !== schoolId) throw new BadRequestException("Select this institution before managing app invitations.");
    const member = (await sql<{ role: string }>`SELECT membership.role FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id AND account.is_active
      WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${user.id}::uuid AND membership.is_active
      ORDER BY (membership.role='admin') DESC LIMIT 1`.execute(tx)).rows[0];
    if (!member) throw new ForbiddenException("Current invitation permission is required.");
    if (member.role !== "admin") await institutionSchoolPermissionForUser(tx, user.id, schoolId, "members.invite");
    await this.assertInviterIdentity(tx, schoolId, user.id);
    return member;
  }

  private async invitation(tx: Transaction<Database>, schoolId: string, id: string) {
    return (await sql<InvitationView>`SELECT invitation.id,invitation.school_id,invitation.created_by,invitation.person_id,invitation.email,invitation.role,invitation.source,
      invitation.access_scope,invitation.work_source_kind,invitation.work_source_id,invitation.work_access_id,invitation.work_visit_access_id,
      invitation.expires_at,invitation.accepted_at,invitation.revoked_at,job.delivery_state AS delivery,job.id AS delivery_job_id
      FROM school_invitations invitation LEFT JOIN invitation_email_jobs job
        ON job.invitation_id=invitation.id AND job.token_hash=invitation.token_hash
      WHERE invitation.school_id=${schoolId}::uuid AND invitation.id=${id}::uuid`.execute(tx)).rows[0];
  }

  async detail(user: AuthUser, schoolId: string, id: string) {
    this.assertLive(); z.string().uuid().parse(id);
    return this.db.transaction().execute(async tx => {
      const invitation = await this.invitation(tx, schoolId, id);
      if (!invitation) throw new NotFoundException("Invitation not found in this institution.");
      const context = invitationWorkContext(invitation);
      if (context) {
        await this.authorizeWork(tx, user, schoolId, invitation.person_id, context);
        const { source, created_by, ...view } = invitation; void source; void created_by;
        return view;
      }
      const authority = await this.authorize(tx, user, schoolId);
      if (authority.role !== "admin" && (invitation.role === "admin" || invitation.source !== "school"))
        throw new ForbiddenException("Only institution administrators can manage this invitation.");
      const { source, created_by, ...view } = invitation; void source; void created_by;
      return view;
    });
  }

  private async authorizeWork(tx: Transaction<Database>, user: Pick<AuthUser, 'id' | 'is_active' | 'active_school_id'>, schoolId: string, personId: string | null, context: WorkContext) {
    if (!user.is_active || user.active_school_id !== schoolId || !personId) throw new ForbiddenException('Select this campus and its current source coordinator before sharing access.');
    if (context.kind === 'visit_arrangement') return authorizeVisitInvitation(tx, { school_id: schoolId, visit_id: context.source_id,
      share_id: context.access_id, person_id: personId, actor_user_id: user.id });
    return authorizeExternalInvitation(tx, this.identity, { school_id: schoolId, repair_id: context.source_id,
      assignment_id: context.access_id, person_id: personId, actor_user_id: user.id });
  }

  async assertWorkIssuer(tx: Transaction<Database>, invitation: InvitationSource & { school_id: string; created_by: string; person_id: string | null }) {
    const context = invitationWorkContext(invitation);
    if (!context || !invitation.person_id) return false;
    await this.authorizeWork(tx, { id: invitation.created_by, is_active: true, active_school_id: invitation.school_id },
      invitation.school_id, invitation.person_id, context);
    await this.assertInviterIdentity(tx, invitation.school_id, invitation.created_by);
    return true;
  }

  async acceptedContinuation(tx: Transaction<Database>, invitation: InvitationSource & { id: string; school_id: string; person_id: string | null; created_by: string }, userId: string) {
    const context = invitationWorkContext(invitation);
    if (!context || !invitation.person_id) return null;
    // Joining establishes identity independently of a future work start. This
    // is only a navigation locator; opening it rechecks the active work window.
    await this.assertActiveAcceptedRecipient(tx, { school_id: invitation.school_id, person_id: invitation.person_id, user_id: userId });
    if (context.kind === 'visit_arrangement') await visitContinuation(tx, { school_id: invitation.school_id,
      visit_id: context.source_id, share_id: context.access_id, person_id: invitation.person_id, user_id: userId });
    else await this.assertWorkIssuer(tx, invitation);
    const destination = context.kind === 'visit_arrangement'
      ? { kind: 'visit_arrangement' as const, href: `/areas/in-out/visits?visit=${context.source_id}&shared=1`, label: 'Open visit' as const }
      : { kind: 'facility_repair' as const, href: `/areas/facilities?repair_id=${context.source_id}`, label: 'Open repair' as const };
    return { ...destination, invitation_id: invitation.id, school_id: invitation.school_id, source_id: context.source_id };
  }

  async continuation(user: AuthUser, schoolId: string, id: string) {
    this.assertLive(); z.uuid().parse(id); z.uuid().parse(schoolId);
    if (user.active_school_id !== schoolId) throw new ForbiddenException('Select the invited campus before opening this shared item.');
    return this.db.transaction().execute(async tx => {
      const invitation = await tx.selectFrom('school_invitations').selectAll().where('school_id', '=', schoolId).where('id', '=', id).executeTakeFirst();
      if (!invitation || !invitation.accepted_at || invitation.accepted_by_user_id !== user.id || invitation.revoked_at || !invitation.person_id)
        throw new ForbiddenException('This account has no current access through that invitation.');
      await this.assertActiveAcceptedRecipient(tx, { school_id: schoolId, person_id: invitation.person_id, user_id: user.id });
      const context = invitationWorkContext(invitation);
      if (context?.kind === 'visit_arrangement') await visitContinuation(tx, { school_id: schoolId, visit_id: context.source_id,
        share_id: context.access_id, person_id: invitation.person_id, user_id: user.id });
      else if (context) await externalContinuation(tx, { school_id: schoolId, repair_id: context.source_id,
        assignment_id: context.access_id, person_id: invitation.person_id, user_id: user.id });
      const continuation = await this.acceptedContinuation(tx, invitation, user.id);
      if (!continuation) throw new NotFoundException('This invitation has no shared item to open.');
      return continuation;
    });
  }

  private async managedWork(tx: Transaction<Database>, user: AuthUser, schoolId: string, id: string) {
    const invitation = await tx.selectFrom('school_invitations').selectAll().where('school_id', '=', schoolId).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!invitation || !invitationWorkContext(invitation)) return null;
    await this.authorizeWork(tx, user, schoolId, invitation.person_id, invitationWorkContext(invitation)!);
    return invitation;
  }

  /** Exact source authority can manage this invitation, not the campus directory. */
  async resendWork(user: AuthUser, schoolId: string, id: string) {
    this.assertLive(); z.uuid().parse(id);
    return this.db.transaction().execute(async tx => {
      const source = await this.managedWork(tx, user, schoolId, id);
      if (!source) return null;
      if (source.accepted_at || source.revoked_at) throw new ConflictException('This invitation was already accepted or revoked. Review its source access instead.');
      await this.assertResendable(tx, source);
      const previous = (await sql<{ last: Date }>`SELECT coalesce(max(created_at),${source.created_at}::timestamptz) AS last
        FROM school_operations_audit WHERE school_id=${schoolId}::uuid AND target_id=${id}::uuid AND action='invitation.email_resent'`.execute(tx)).rows[0]!;
      if (executionNow().getTime() - new Date(previous.last).getTime() < 60_000) throw new ConflictException('Please wait one minute before sending this invitation again.');
      const { token, tokenHash } = await issueInvitationCode(tx, source.email);
      const updated = (await sql<{ id: string; expires_at: Date }>`UPDATE school_invitations SET token_hash=${tokenHash},expires_at=now()+interval '30 minutes',
        recipient_proof_hash=NULL,recipient_proof_expires_at=NULL,recipient_proof_sent_at=NULL WHERE id=${id}::uuid AND school_id=${schoolId}::uuid RETURNING id,expires_at`.execute(tx)).rows[0]!;
      const ready = await enqueueInvitation(tx, { ...updated, email: source.email, token });
      await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata) VALUES
        (${schoolId}::uuid,${user.id}::uuid,'invitation.email_resent',${id}::uuid,'{"account_access_only":true,"scope":"assigned_work"}'::jsonb)`.execute(tx);
      return ready;
    });
  }

  async revokeWork(user: AuthUser, schoolId: string, id: string) {
    this.assertLive(); z.uuid().parse(id);
    return this.db.transaction().execute(async tx => {
      const source = await this.managedWork(tx, user, schoolId, id);
      if (!source) return null;
      if (source.accepted_at) throw new ConflictException('This account already joined. End its source access without deleting its account.');
      if (!source.revoked_at) {
        await tx.updateTable('school_invitations').set({ revoked_at: executionNow(), recipient_proof_hash: null, recipient_proof_expires_at: null })
          .where('school_id', '=', schoolId).where('id', '=', id).execute();
        await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata) VALUES
          (${schoolId}::uuid,${user.id}::uuid,'invitation.revoked',${id}::uuid,'{"scope":"assigned_work"}'::jsonb)`.execute(tx);
      }
      return { revoked: true as const };
    });
  }

  async assertResendable(tx: Transaction<Database>, invitation: InvitationSource & { school_id: string; created_by: string; person_id: string | null; email: string }) {
    this.assertLive();
    const workIssuer = await this.assertWorkIssuer(tx, invitation);
    const inviter = (await sql<{ role: string }>`SELECT membership.role FROM school_memberships membership
      JOIN users account ON account.id=membership.user_id WHERE membership.school_id=${invitation.school_id}::uuid
        AND membership.user_id=${invitation.created_by}::uuid AND membership.is_active AND account.is_active
      ORDER BY (membership.role='admin') DESC LIMIT 1 FOR SHARE OF membership,account`.execute(tx)).rows[0];
    if (!inviter) throw new ConflictException("The original inviter no longer has access. Revoke this invitation and create a new one.");
    if (!workIssuer && inviter.role !== "admin") {
      try { await institutionSchoolPermissionForUser(tx, invitation.created_by, invitation.school_id, "members.invite"); }
      catch { throw new ConflictException("The original inviter can no longer invite. Revoke this invitation and create a new one."); }
    }
    await this.assertInviterIdentity(tx, invitation.school_id, invitation.created_by);
    if (!invitation.person_id || !(await sql`SELECT id FROM school_people WHERE school_id=${invitation.school_id}::uuid
      AND id=${invitation.person_id}::uuid AND retired_at IS NULL FOR UPDATE`.execute(tx)).rows.length)
      throw new ConflictException("This person is no longer available. Revoke this invitation and review People.");
    const [state] = await this.identity.listPersonAccountStates(tx, { school_id: invitation.school_id,
      person_ids: [invitation.person_id], at: executionNow().toISOString() });
    if (state?.has_account) throw new ConflictException("This person already has retained app access. Revoke this outdated invitation.");
    const account = (await sql<{ is_active: boolean; onboarding_pending: boolean; campus_member: boolean }>`SELECT is_active,onboarding_pending,
      EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.user_id=account.id
        AND membership.school_id=${invitation.school_id}::uuid) AS campus_member FROM users account
      WHERE lower(account.email)=${invitation.email}`.execute(tx)).rows[0];
    if (account?.campus_member)
      throw new ConflictException("This email already has a campus account. Revoke this invitation and review its existing person.");
    if (account && (!account.is_active || account.onboarding_pending))
      throw new ConflictException("This recipient must finish or recover their existing account before the invitation can be resent.");
  }

  async create(user: AuthUser, schoolId: string, raw: unknown) {
    this.assertLive();
    const input = personAccountInvitationSchema.parse(raw), correlation = invitationRequestId(schoolId, user.id, input.idempotency_key);
    return this.db.transaction().execute(async tx => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId},0))`.execute(tx);
      const work = input.work_context;
      if (work) await this.authorizeWork(tx, user, schoolId, input.person_id, work);
      else await this.authorize(tx, user, schoolId);
      // Retain the original envelope on exact retries. Core hashes the whole request,
      // so a fresh clock/correlation would incorrectly turn a network retry into new work.
      const previous = (await sql<{ created_at: Date }>`SELECT created_at FROM school_invitations
        WHERE id=${correlation}::uuid AND school_id=${schoolId}::uuid AND created_by=${user.id}::uuid`.execute(tx)).rows[0];
      const requestedAt = previous?.created_at.toISOString() ?? executionNow().toISOString();
      const person = (await sql<{ id: string; label: string; revision: number }>`SELECT id,
        trim(concat_ws(' ',first_name,last_name)) AS label,revision FROM school_people
        WHERE school_id=${schoolId}::uuid AND id=${input.person_id}::uuid AND retired_at IS NULL FOR UPDATE`.execute(tx)).rows[0];
      if (!person) throw new NotFoundException("Choose an existing person from this institution.");
      const requestHash = createHash("sha256").update(JSON.stringify({ person_id: person.id, email: input.email, role: "member", ...(work ? { work_context: work } : {}) })).digest("hex");
      const target = { kind: "person", domain: "people", domain_id: person.id, label: person.label,
        lifecycle_state: "active" as const, source_revision: person.revision, metadata: {} };
      const prepared = await this.gateway.prepareDomainCommand(tx, {
        school_id: schoolId, actor_user_id: user.id, command_type: "people.account.invite", handler_key: "people.app_access",
        handler_version: 1, source_domain: "people", target, current_revision: person.revision, expected_revision: person.revision,
        capability: work ? 'people:invite_assigned_work' : "members:invite", purpose: "invite_existing_person_to_app", requested_at: requestedAt,
        correlation_id: correlation, causation_id: null, idempotency_key: `person-invite:${user.id}:${input.idempotency_key}`,
        operating_rule_version_ref: null, configuration_refs: [], safe_context: { request_hash: requestHash, person_id: person.id,
          ...(work ? { work_context: work, recipient_email_hash: createHash('sha256').update(`people-invite:${correlation}:${input.email}`).digest('hex') } : {}) },
        authority_attestation: { evaluator_domain: "people", decision: "allowed", reason_codes: [work ? work.kind === 'visit_arrangement' ? 'current_exact_visit_invitation_authority' : 'current_exact_repair_invitation_authority' : "current_members_invite_permission"],
          authority_source_refs: [work ? { school_id: schoolId, source_kind: work.kind, source_id: work.source_id, access_id: work.access_id, person_id: person.id, technical_scope: 'assigned_work' } : { school_id: schoolId, permission: "members.invite" }], operating_rule_refs: [], valid_until: null },
      });
      if (prepared.status === "completed") {
        const retainedId = z.string().uuid().safeParse(prepared.metadata.invitation_id);
        if (prepared.terminal_state !== "accepted" || !retainedId.success) throw new ConflictException("Refresh this person's app access before retrying.");
        const retained = await this.invitation(tx, schoolId, retainedId.data);
        if (!retained || retained.person_id !== person.id || retained.email !== input.email || JSON.stringify(invitationWorkContext(retained)) !== JSON.stringify(work ?? null))
          throw new ConflictException("This retry key belongs to another invitation.");
        return { id: retained.id, email: retained.email, expires_at: retained.expires_at, token: "", delivery: retained.delivery ?? "manual", replayed: true };
      }
      const [state] = await this.identity.listPersonAccountStates(tx, { school_id: schoolId, person_ids: [person.id],
        at: executionNow().toISOString(), viewer_user_id: user.id });
      const notCreated = { person_invitation: { confirmation: 'not_created', idempotency_key: input.idempotency_key } };
      if (state?.has_account) throw new ConflictException({ code: 'person_invitation_account_exists', fields: notCreated, message: "This person already has an app account. Invitations do not restore inactive or revoked access." });
      const account = (await sql<{ id: string; is_active: boolean; onboarding_pending: boolean; campus_member: boolean }>`SELECT account.id,
        account.is_active,account.onboarding_pending,EXISTS(SELECT 1 FROM school_memberships membership
          WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=account.id) AS campus_member
        FROM users account WHERE lower(account.email)=${input.email}`.execute(tx)).rows[0];
      if (account?.campus_member) throw new ConflictException({ code: 'person_invitation_account_exists', fields: notCreated, message: "This email already belongs to a campus account. Choose its existing person instead." });
      if (account && (!account.is_active || account.onboarding_pending)) throw new ConflictException({ code: 'person_invitation_account_exists', fields: notCreated, message: "This recipient must finish or recover their existing account before joining." });
      // The exact new source was authorised above. Retire only this person's
      // obsolete invitation to the same repair; another job's invitation is not
      // ours to replace. Never restore an accepted identity or its old authority.
      const superseded = work ? (await sql<{ id: string }>`UPDATE school_invitations SET revoked_at=now(),
        recipient_proof_hash=NULL,recipient_proof_expires_at=NULL
        WHERE school_id=${schoolId}::uuid AND person_id=${person.id}::uuid AND access_scope='assigned_work'
          AND work_source_kind=${work.kind} AND work_source_id=${work.source_id}::uuid
          AND coalesce(work_access_id,work_visit_access_id)<>${work.access_id}::uuid AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`.execute(tx)).rows : [];
      for (const retired of superseded) await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
        VALUES(${schoolId}::uuid,${user.id}::uuid,'invitation.superseded',${retired.id}::uuid,
          ${JSON.stringify({ replacement_invitation_id: correlation, source_kind: work!.kind, source_id: work!.source_id, scope: 'assigned_work' })}::jsonb)`.execute(tx);
      const pending = (await sql<{ id: string; email: string; current: boolean }>`SELECT id,email,expires_at>now() AS current
        FROM school_invitations WHERE school_id=${schoolId}::uuid AND person_id=${person.id}::uuid
          AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`.execute(tx)).rows[0];
      if (pending?.current) throw new ConflictException({ code: 'person_invitation_exists', fields: notCreated, message: "This person already has a pending invitation. Open App access to manage or resend it." });
      if (pending) await sql`UPDATE school_invitations SET revoked_at=now() WHERE id=${pending.id}::uuid`.execute(tx);
      if ((await sql`SELECT 1 FROM school_invitations WHERE school_id=${schoolId}::uuid AND email=${input.email}
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()`.execute(tx)).rows.length)
        throw new ConflictException({ code: 'person_invitation_exists', fields: notCreated, message: "An invitation for this email already exists. Review it before inviting another person." });
      const { token, tokenHash } = await issueInvitationCode(tx, input.email);
      const invitation = (await sql<{ id: string; expires_at: Date }>`INSERT INTO school_invitations
        (id,school_id,email,role,person_id,token_hash,created_by,created_at,expires_at,access_scope,work_source_kind,work_source_id,work_access_id,work_visit_access_id) VALUES
        (${correlation}::uuid,${schoolId}::uuid,${input.email},'member',${person.id}::uuid,${tokenHash},${user.id}::uuid,${requestedAt}::timestamptz,now()+interval '30 minutes',
          ${work ? 'assigned_work' : 'campus'},${work?.kind ?? null},${work?.source_id ?? null}::uuid,
          ${work?.kind === 'facility_repair' ? work.access_id : null}::uuid,${work?.kind === 'visit_arrangement' ? work.access_id : null}::uuid)
        RETURNING id,expires_at`.execute(tx)).rows[0]!;
      const ready = await enqueueInvitation(tx, { ...invitation, email: input.email, token });
      const eventKey = `person-invitation:${invitation.id}:created`;
      const event = (await tx.insertInto("event_outbox").values({ school_id: schoolId, event_type: "people.updated",
        aggregate_type: "school_invitation", aggregate_id: invitation.id, audience_user_ids: [user.id],
        payload: { action: "person_invitation_created", refresh: ["people.participants"], person_id: person.id },
        idempotency_key: eventKey }).returning("id").executeTakeFirstOrThrow());
      const journal = await this.journal.recordAcceptedEvent(tx, { school_id: schoolId, source_outbox_event_id: event.id,
        event_type: "people.updated", subject: target, context: null, actor_user_id: user.id, audience_user_ids: [],
        occurred_at: executionNow().toISOString(), effective_from: executionNow().toISOString(), effective_until: null,
        source_domain: "people", source_record_id: invitation.id, source_revision: 1, correlation_id: correlation,
        causation_event_id: null, idempotency_key: eventKey, payload: { action: "person_invitation_created", person_id: person.id } });
      await sql`INSERT INTO school_operations_audit(school_id,actor_id,action,target_id,metadata)
        VALUES(${schoolId}::uuid,${user.id}::uuid,'invitation.created',${invitation.id}::uuid,
          ${JSON.stringify({ person_id: person.id, account_access_only: true })}::jsonb)`.execute(tx);
      await this.gateway.completeDomainCommand(tx, { school_id: schoolId, command_id: prepared.command_id,
        terminal_state: "accepted", code: "person_app_invitation_created", explanation: "The existing person was invited without enrollment or operational authority.",
        resulting_revision: person.revision, domain_event_id: event.id, metadata: { invitation_id: invitation.id, model_event_id: journal.event_id,
          ...(superseded.length ? { superseded_invitation_ids: superseded.map(item => item.id) } : {}) },
        completed_at: executionNow().toISOString() });
      return ready;
    });
  }

  /** Caller has verified the email-bound code, password and current inviter authority in this same transaction. */
  async acceptInTransaction(tx: Transaction<Database>, invitation: { id: string; school_id: string; person_id: string | null; created_by: string }, userId: string) {
    this.assertLive();
    if (!invitation.person_id) throw new ConflictException("This invitation has no person to link.");
    const person = (await sql<{ id: string; label: string; revision: number; account_user_id: string | null }>`SELECT id,
      trim(concat_ws(' ',first_name,last_name)) AS label,revision,account_user_id
      FROM school_people WHERE school_id=${invitation.school_id}::uuid AND id=${invitation.person_id}::uuid
        AND retired_at IS NULL FOR UPDATE`.execute(tx)).rows[0];
    if (!person || person.account_user_id) throw new ConflictException("This person's account linkage changed. Ask the administrator to review it.");
    const [state] = await this.identity.listPersonAccountStates(tx, { school_id: invitation.school_id, person_ids: [person.id], at: executionNow().toISOString() });
    if (state?.has_account) throw new ConflictException("This person already has retained app access. It cannot be replaced by accepting another invitation.");
    await sql`UPDATE school_invitations SET accepted_at=now(),accepted_by_user_id=${userId}::uuid
      WHERE id=${invitation.id}::uuid AND school_id=${invitation.school_id}::uuid`.execute(tx);
    await sql`UPDATE school_people SET account_user_id=${userId}::uuid,revision=revision+1
      WHERE school_id=${invitation.school_id}::uuid AND id=${person.id}::uuid`.execute(tx);
    await this.identity.linkAccountEndpoint(tx, { school_id: invitation.school_id, person_id: person.id,
      user_id: userId, actor_user_id: userId, effective_from: executionNow().toISOString(), effective_until: null,
      source_domain: "auth", source_record_id: invitation.id, source_revision: 1,
      metadata: { accepted_person_invitation_id: invitation.id, account_access_only: true } });
    const event = await tx.insertInto("event_outbox").values({ school_id: invitation.school_id, event_type: "people.updated",
      aggregate_type: "person", aggregate_id: person.id, audience_user_ids: [invitation.created_by],
      payload: { action: "person_account_linked", person_id: person.id, refresh: ["people.participants", "activities.catalogue"] },
      idempotency_key: `person-invitation:${invitation.id}:accepted` }).returning("id").executeTakeFirstOrThrow();
    await this.journal.recordAcceptedEvent(tx, { school_id: invitation.school_id, source_outbox_event_id: event.id,
      event_type: "people.updated", subject: { kind: "person", domain: "people", domain_id: person.id, label: person.label,
        lifecycle_state: "active", source_revision: person.revision + 1, metadata: {} }, context: null,
      actor_user_id: userId, audience_user_ids: [], occurred_at: executionNow().toISOString(),
      effective_from: executionNow().toISOString(), effective_until: null, source_domain: "people",
      source_record_id: person.id, source_revision: person.revision + 1, correlation_id: invitation.id,
      causation_event_id: null, idempotency_key: `person-invitation:${invitation.id}:accepted`,
      payload: { action: "person_account_linked", person_id: person.id, invitation_id: invitation.id } });
  }
}
