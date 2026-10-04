import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import type { AuthUser } from '../common/request.js';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';
type Db = Kysely<Database> | Transaction<Database>;
const email = z.email().trim().toLowerCase().max(254);
@Injectable()
export class CompanyService {
  constructor(private readonly db: DatabaseService) {}
  async authorize(user: AuthUser, db: Db = this.db) {
    const result = await sql`SELECT 1 FROM company_operators o JOIN users u ON u.id=o.user_id
      WHERE o.user_id=${user.id}::uuid AND o.is_active AND u.is_active FOR SHARE OF o,u`.execute(db);
    if (!result.rows.length) throw new ForbiddenException('Active company operator access is required.');
  }
  private async audit(db: Db, user: AuthUser, school: string, action: string, metadata: unknown) {
    await sql`INSERT INTO company_audit(actor_id,school_id,action,metadata)
      VALUES(${user.id}::uuid,${school}::uuid,${action},${JSON.stringify(metadata)}::jsonb)`.execute(db);
  }
  async workspace(user: AuthUser) {
    await this.authorize(user);
    const schools = await sql`SELECT s.id,s.name,s.code,s.timezone,s.institution_kind,
      (SELECT count(*)::int FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active WHERE m.school_id=s.id AND m.role='admin' AND m.is_active) AS admin_count,
      (SELECT count(*)::int FROM school_invitations i WHERE i.school_id=s.id AND i.source='company' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()) AS pending_admins
      FROM schools s ORDER BY s.name`.execute(this.db);
    const invitations = await sql`SELECT i.id,i.school_id,s.name AS school_name,i.email,i.expires_at,i.accepted_at,i.revoked_at
      FROM school_invitations i JOIN schools s ON s.id=i.school_id WHERE i.source='company' ORDER BY i.created_at DESC LIMIT 100`.execute(this.db);
    return { schools: schools.rows, invitations: invitations.rows };
  }
  private async invitation(db: Db, user: AuthUser, school: string, recipient: string) {
    const token = randomBytes(32).toString('base64url');
    const pending = await sql`SELECT 1 FROM users u WHERE lower(u.email)=${recipient} AND u.onboarding_pending
      AND NOT EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.school_id=${school}::uuid AND m.is_active)`.execute(db);
    if (pending.rows.length) throw new ConflictException('This account must complete its original school onboarding first.');
    await sql`UPDATE school_invitations SET revoked_at=now() WHERE school_id=${school}::uuid AND email=${recipient} AND accepted_at IS NULL AND revoked_at IS NULL`.execute(db);
    const row = (await sql<{id:string;expires_at:Date}>`INSERT INTO school_invitations(school_id,email,role,token_hash,created_by,expires_at,source)
      VALUES(${school}::uuid,${recipient},'admin',${createHash('sha256').update(token).digest('hex')},${user.id}::uuid,now()+interval '72 hours','company') RETURNING id,expires_at`.execute(db)).rows[0]!;
    await this.audit(db,user,school,'company.admin_invited',{invitation_id:row.id,email:recipient});
    return {...row,email:recipient,token,delivery:'manual'};
  }
  async create(user: AuthUser, body: unknown) {
    await this.authorize(user);
    const data = z.object({name:z.string().trim().min(2).max(180),code:z.string().trim().regex(/^[a-z0-9-]{2,32}$/),institution_kind:z.enum(['school','college']),timezone:z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Choose a valid timezone.').default('Asia/Kolkata'),admin_email:email}).strict().parse(body);
    try {
      return await this.db.transaction().execute(async db=>{
        await this.authorize(user,db);
        const school = (await sql<{id:string;name:string}>`INSERT INTO schools(name,code,timezone,institution_kind)
          VALUES(${data.name},${data.code},${data.timezone},${data.institution_kind}) RETURNING *`.execute(db)).rows[0]!;
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${school.id},0))`.execute(db);
        await this.audit(db,user,school.id,'company.institution_created',{kind:data.institution_kind});
        const invitation=await this.invitation(db,user,school.id,data.admin_email);
        return {school,invitation};
      });
    } catch(error) {if((error as {code?:string}).code==='23505') throw new ConflictException('Institution code is already in use.');throw error;}
  }
  async inviteAdmin(user: AuthUser, school: string, body: unknown) {
    z.uuid().parse(school);const data=z.object({email}).strict().parse(body);
    return this.db.transaction().execute(async db=>{
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${school},0))`.execute(db);await this.authorize(user,db);
      if (!(await db.selectFrom('schools').select('id').where('id','=',school).executeTakeFirst())) throw new NotFoundException('Institution not found.');
      return this.invitation(db,user,school,data.email);
    });
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
}
