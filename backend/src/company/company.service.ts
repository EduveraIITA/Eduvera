import { issueInvitationCode } from '../common/invitation-code.js';
import { InstitutionsService } from '../institutions/institutions.service.js';
import { manualSchema } from '../institutions/schemas.js';
import { enqueueInvitation } from '../common/invitation-queue.js';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import type { AuthUser } from '../common/request.js';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
type Db = Kysely<Database> | Transaction<Database>;
const email = z.email().trim().toLowerCase().max(254);
@Injectable()
export class CompanyService {
  constructor(private readonly db: DatabaseService, private readonly directory: InstitutionsService) {}
  async authorize(user: AuthUser, db: Db = this.db) {
    const result = await sql`SELECT 1 FROM company_operators o JOIN users u ON u.id=o.user_id
      WHERE o.user_id=${user.id}::uuid AND o.is_active AND u.is_active FOR SHARE OF o,u`.execute(db);
    if (!result.rows.length) throw new ForbiddenException('Active company operator access is required.');
  }
  private async audit(db: Db, user: AuthUser, school: string | null, action: string, metadata: unknown) {
    await sql`INSERT INTO company_audit(actor_id,school_id,action,metadata)
      VALUES(${user.id}::uuid,${school}::uuid,${action},${JSON.stringify(metadata)}::jsonb)`.execute(db);
  }
  async workspace(user: AuthUser) {
    await this.authorize(user);
    const schools = await sql`SELECT s.id,s.name,s.code,s.timezone,s.institution_kind,o.status AS onboarding_status,
      (SELECT count(*)::int FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active WHERE m.school_id=s.id AND m.role='admin' AND m.is_active) AS admin_count,
      (SELECT count(*)::int FROM school_invitations i WHERE i.school_id=s.id AND i.source='company' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()) AS pending_admins
      FROM schools s LEFT JOIN institution_onboarding o ON o.school_id=s.id ORDER BY s.name`.execute(this.db);
    const invitations = await sql`SELECT i.id,i.school_id,s.name AS school_name,i.email,i.expires_at,i.accepted_at,i.revoked_at,
      (SELECT id FROM invitation_email_jobs j WHERE j.invitation_id=i.id AND j.token_hash=i.token_hash) AS delivery_job_id,
      (SELECT delivery_state FROM invitation_email_jobs j WHERE j.invitation_id=i.id AND j.token_hash=i.token_hash) AS delivery
      FROM school_invitations i JOIN schools s ON s.id=i.school_id WHERE i.source='company' ORDER BY i.created_at DESC LIMIT 100`.execute(this.db);
    const applications = await sql`SELECT a.id,a.institution_name,a.requested_code,a.institution_kind,a.timezone,a.state_code,a.district,
      a.website,a.applicant_role_title,a.regulator_type,a.regulator_reference,a.status,a.review_note,a.revision,a.submitted_at,a.updated_at,
      a.provisioned_school_id,u.first_name,u.last_name,u.email AS applicant_email
      FROM institution_onboarding_applications a JOIN users u ON u.id=a.applicant_user_id
      ORDER BY CASE a.status WHEN 'submitted' THEN 0 WHEN 'needs_information' THEN 1 ELSE 2 END,a.submitted_at DESC
      LIMIT 200`.execute(this.db);
    return { schools: schools.rows, invitations: invitations.rows, applications: applications.rows };
  }
  private async invitation(db: Db, user: AuthUser, school: string, recipient: string) {
    const {token,tokenHash}=await issueInvitationCode(db,recipient);
    const pending = await sql`SELECT 1 FROM users u WHERE lower(u.email)=${recipient} AND u.onboarding_pending
      AND NOT EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.school_id=${school}::uuid AND m.is_active)`.execute(db);
    if (pending.rows.length) throw new ConflictException('This account must complete its original school onboarding first.');
    await sql`UPDATE school_invitations SET revoked_at=now() WHERE school_id=${school}::uuid AND email=${recipient} AND accepted_at IS NULL AND revoked_at IS NULL`.execute(db);
    const row = (await sql<{id:string;expires_at:Date}>`INSERT INTO school_invitations(school_id,email,role,token_hash,created_by,expires_at,source)
      VALUES(${school}::uuid,${recipient},'admin',${tokenHash},${user.id}::uuid,now()+interval '30 minutes','company') RETURNING id,expires_at`.execute(db)).rows[0]!;
    await this.audit(db,user,school,'company.admin_invited',{invitation_id:row.id,email:recipient});
    return enqueueInvitation(db, {...row,email:recipient,token});
  }
  async create(user: AuthUser, body: unknown) {
    await this.authorize(user);
    const data = z.object({name:z.string().trim().min(2).max(180),code:z.string().trim().regex(/^[a-z0-9-]{2,32}$/),institution_kind:z.enum(['school','college']),timezone:z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Choose a valid timezone.').default('Asia/Kolkata'),admin_email:email,directory_id:z.uuid().optional(),manual:manualSchema.optional(),acknowledged_duplicate_ids:z.array(z.uuid()).max(50).default([])}).strict().refine(value=>!(value.directory_id && value.manual),'Select a directory record or enter manual details, not both.').parse(body);
    try {
      const result = await this.db.transaction().execute(async db=>{
        await this.authorize(user,db);
        const selected = await this.directory.prepare(db,data);
        const school = (await sql<{id:string;name:string}>`INSERT INTO schools(name,code,timezone,institution_kind)
          VALUES(${selected.name},${data.code},${data.timezone},${selected.institution_kind}) RETURNING *`.execute(db)).rows[0]!;
        await this.directory.link(db,school.id,selected.directory_id);
        const capability = selected.institution_kind === 'college' ? 'india_college_core' : 'india_school_core';
        await sql`UPDATE institution_regulatory_profiles SET institution_kind=${selected.institution_kind},
          capability_packs=ARRAY[${capability}]::text[],review_note='Company-managed provisioning; administrator must complete the regulatory profile.'
          WHERE school_id=${school.id}::uuid`.execute(db);
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${school.id},0))`.execute(db);
        await this.audit(db,user,school.id,'company.institution_created',{kind:selected.institution_kind,directory_id:selected.directory_id,acknowledged_duplicate_ids:data.acknowledged_duplicate_ids});
        const invitation=await this.invitation(db,user,school.id,data.admin_email);
        return {school,invitation};
      });
      return result;
    } catch(error) {if((error as {code?:string}).code==='23505') throw new ConflictException('Institution code is already in use.');throw error;}
  }
  async inviteAdmin(user: AuthUser, school: string, body: unknown) {
    z.uuid().parse(school);const data=z.object({email}).strict().parse(body);
    const invitation = await this.db.transaction().execute(async db=>{
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${school},0))`.execute(db);await this.authorize(user,db);
      if (!(await db.selectFrom('schools').select('id').where('id','=',school).executeTakeFirst())) throw new NotFoundException('Institution not found.');
      return this.invitation(db,user,school,data.email);
    });
    return invitation;
  }
  async resend(user: AuthUser, school: string, id: string) {
    z.uuid().parse(school); z.uuid().parse(id);
    const invitation = await this.db.transaction().execute(async db => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${school},0))`.execute(db);
      await this.authorize(user,db);
      const found = (await sql<{email:string;created_at:Date}>`SELECT email,created_at FROM school_invitations
        WHERE school_id=${school}::uuid AND id=${id}::uuid AND source='company'
          AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`.execute(db)).rows[0];
      if (!found) throw new NotFoundException('This invitation was accepted or revoked. Refresh the invitation list.');
      if (Date.now()-new Date(found.created_at).getTime()<60_000) throw new ConflictException('Please wait one minute before sending this invitation again.');
      const {token,tokenHash}=await issueInvitationCode(db,found.email);
      const row=(await sql<{id:string;expires_at:Date}>`UPDATE school_invitations
        SET token_hash=${tokenHash},expires_at=now()+interval '30 minutes',created_at=now()
        WHERE id=${id}::uuid AND school_id=${school}::uuid RETURNING id,expires_at`.execute(db)).rows[0]!;
      await this.audit(db,user,school,'company.admin_invitation_email_resent',{invitation_id:id});
      return enqueueInvitation(db, {...row,email:found.email,token});
    });
    return invitation;
  }

  async revoke(user: AuthUser, school: string, id: string) {
    z.uuid().parse(school);z.uuid().parse(id);
    return this.db.transaction().execute(async db=>{
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${school},0))`.execute(db);await this.authorize(user,db);
      const result=await sql`UPDATE school_invitations SET revoked_at=now() WHERE id=${id}::uuid AND school_id=${school}::uuid AND source='company' AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`.execute(db);
      if(!result.rows.length)throw new NotFoundException('Pending company invitation not found.');
      await this.audit(db,user,school,'company.admin_invitation_revoked',{invitation_id:id});return {revoked:true};
    });
  }

  async reviewApplication(user: AuthUser, applicationId: string, body: unknown) {
    z.uuid().parse(applicationId);
    const input = z.object({
      action: z.enum(['request_information','approve','reject']),
      note: z.string().trim().max(1000).default(''),
      institution_code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,31}$/).optional(),
    }).strict().superRefine((value, context) => {
      if (value.action !== 'approve' && value.note.length < 3) context.addIssue({ code: 'custom', path: ['note'], message: 'Add a clear note for the applicant.' });
    }).parse(body);
    try {
      return await this.db.transaction().execute(async db => {
        await this.authorize(user,db);
        const application = (await sql<{
          id:string;applicant_user_id:string;institution_name:string;requested_code:string;institution_kind:'school'|'college'|'hybrid';
          timezone:string;state_code:string;district:string;regulator_type:string;regulator_reference:string;status:string;
        }>`SELECT * FROM institution_onboarding_applications WHERE id=${applicationId}::uuid FOR UPDATE`.execute(db)).rows[0];
        if (!application) throw new NotFoundException('Institution onboarding application not found.');
        if (!['submitted','needs_information'].includes(application.status)) throw new ConflictException('This application has already reached a final decision.');
        if (input.action === 'request_information') {
          await sql`UPDATE institution_onboarding_applications SET status='needs_information',review_note=${input.note},reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now()
            WHERE id=${applicationId}::uuid`.execute(db);
          await sql`INSERT INTO institution_onboarding_audits(application_id,actor_id,action,from_status,to_status,note)
            VALUES(${applicationId}::uuid,${user.id}::uuid,'information_requested',${application.status},'needs_information',${input.note})`.execute(db);
          await this.audit(db,user,null,'company.institution_application_information_requested',{application_id:applicationId});
          return { status: 'needs_information' };
        }
        if (input.action === 'reject') {
          await sql`UPDATE institution_onboarding_applications SET status='rejected',review_note=${input.note},reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now()
            WHERE id=${applicationId}::uuid`.execute(db);
          await sql`INSERT INTO institution_onboarding_audits(application_id,actor_id,action,from_status,to_status,note)
            VALUES(${applicationId}::uuid,${user.id}::uuid,'rejected',${application.status},'rejected',${input.note})`.execute(db);
          await this.audit(db,user,null,'company.institution_application_rejected',{application_id:applicationId});
          return { status: 'rejected' };
        }
        const institutionCode = input.institution_code ?? application.requested_code;
        const official = (await sql<{id:string}>`SELECT id FROM institution_directory
          WHERE source=upper(${application.regulator_type}) AND source_code=upper(trim(${application.regulator_reference}))
          AND source IN ('UDISE','AISHE')`.execute(db)).rows[0];
        const selected = official ? await this.directory.prepare(db,{directory_id:official.id,name:application.institution_name,institution_kind:application.institution_kind}) : null;
        const school = (await sql<{id:string;name:string;code:string}>`INSERT INTO schools(
          name,code,timezone,institution_kind,onboarding_model,verification_status,created_by_user_id)
          VALUES(${application.institution_name},${institutionCode},${application.timezone},${application.institution_kind},'company_verified','approved',${application.applicant_user_id}::uuid)
          RETURNING id,name,code`.execute(db)).rows[0]!;
        if (selected) await this.directory.link(db,school.id,selected.directory_id);
        await sql`INSERT INTO school_memberships(user_id,school_id,role) VALUES(${application.applicant_user_id}::uuid,${school.id}::uuid,'admin')`.execute(db);
        const capability = application.institution_kind === 'college' ? 'india_college_core' : 'india_school_core';
        await sql`UPDATE institution_regulatory_profiles SET institution_kind=${application.institution_kind},state_code=${application.state_code},district=${application.district},
          capability_packs=ARRAY[${capability}]::text[],recognition_reference=${application.regulator_reference},reviewed_on=current_date,
          review_note=${input.note || 'Company verification completed during onboarding.'},updated_by=${user.id}::uuid WHERE school_id=${school.id}::uuid`.execute(db);
        await sql`UPDATE institution_onboarding_applications SET status='approved',requested_code=${institutionCode},review_note=${input.note},reviewed_by=${user.id}::uuid,
          reviewed_at=now(),provisioned_school_id=${school.id}::uuid,updated_at=now() WHERE id=${applicationId}::uuid`.execute(db);
        await sql`INSERT INTO institution_onboarding_audits(application_id,actor_id,action,from_status,to_status,note,metadata)
          VALUES(${applicationId}::uuid,${user.id}::uuid,'approved',${application.status},'approved',${input.note},${JSON.stringify({school_id:school.id})}::jsonb)`.execute(db);
        await sql`UPDATE auth_sessions SET active_school_id=${school.id}::uuid WHERE user_id=${application.applicant_user_id}::uuid`.execute(db);
        await this.audit(db,user,school.id,'company.institution_application_approved',{application_id:applicationId,kind:application.institution_kind});
        return { status: 'approved', school };
      });
    } catch (error) {
      if ((error as {code?:string}).code === '23505') throw new ConflictException('The institution code is already in use. Choose another code before approving.');
      throw error;
    }
  }
}
