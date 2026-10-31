import { ConflictException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { HumanAgentIdentityPort } from '../campus-model-core/human-agent-identity.port.js';
import type { Database } from '../database/types.js';

/** Auth/People owns this exact accepted-invitation proof. Employment activation
 * cannot infer identity from a contact, restore a revoked endpoint, or grant work.
 * Before required onboarding completes, account access remains non-acting. */
export async function linkAcceptedStaffAccount(tx:Transaction<Database>, identities:HumanAgentIdentityPort, input:{
  school_id:string;person_id:string;user_id:string;actor_user_id:string;at:string;
}) {
  const profile=await tx.selectFrom('staff_profiles').select(['id','status']).where('school_id','=',input.school_id)
    .where('person_id','=',input.person_id).where('user_id','=',input.user_id).forUpdate().executeTakeFirst();
  if(!profile || profile.status!=='active') return;
  const current=await identities.resolveAccountEndpoint(tx,{school_id:input.school_id,user_id:input.user_id,at:input.at});
  if(current.acting) {
    if(current.person_id!==input.person_id) throw new ConflictException('This account belongs to another campus person. Review app access in People.');
    return;
  }
  if(current.reason!=='account_not_linked') throw new ConflictException('The retained account endpoint needs review. Work onboarding cannot restore app access.');
  const invite=(await sql<{id:string}>`SELECT invitation.id FROM school_invitations invitation
    JOIN users account ON account.id=invitation.accepted_by_user_id AND account.is_active AND account.email_verified_at IS NOT NULL
    JOIN school_memberships membership ON membership.user_id=account.id AND membership.school_id=invitation.school_id
      AND membership.role='staff' AND membership.is_active
    WHERE invitation.school_id=${input.school_id}::uuid AND invitation.person_id=${input.person_id}::uuid
      AND invitation.role='staff' AND invitation.source='school' AND invitation.accepted_by_user_id=${input.user_id}::uuid
      AND invitation.accepted_at IS NOT NULL AND invitation.revoked_at IS NULL AND invitation.expires_at>invitation.accepted_at
    ORDER BY invitation.accepted_at DESC,invitation.id LIMIT 1 FOR SHARE OF invitation,account,membership`.execute(tx)).rows[0];
  if(!invite) throw new ConflictException('Accept the exact-person app invitation before activating this work record.');
  await identities.linkAccountEndpoint(tx,{school_id:input.school_id,person_id:input.person_id,user_id:input.user_id,
    actor_user_id:input.actor_user_id,effective_from:input.at,effective_until:null,source_domain:'auth',source_record_id:invite.id,
    source_revision:1,metadata:{accepted_staff_invitation_id:invite.id,identity_only:true}});
}
