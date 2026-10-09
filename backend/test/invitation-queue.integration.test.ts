import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { DatabaseService } from '../src/database/database.service.js';
import * as configuration from '../src/config.js';
import { invitationCodeHash } from '../src/common/invitation-code.js';
import { enqueueInvitation, InvitationEmailWorker } from '../src/common/invitation-queue.js';
import { deliverInvitation } from '../src/common/invitation-email.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
vi.mock('../src/common/invitation-email.js',()=>({deliverInvitation:vi.fn()}));
const suite=process.env.TEST_DATABASE_ISOLATED==='true'?describe:describe.skip;
suite('durable invitation email queue against isolated PostgreSQL',()=>{
  let db:DatabaseService;let school:string;let creator:string;let worker:InvitationEmailWorker;
  let settings:ReturnType<typeof configuration.config>;
  beforeAll(async()=>{
    requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
    settings=configuration.config();
    db=new DatabaseService();worker=new InvitationEmailWorker(db);
    creator=(await sql<{id:string}>`INSERT INTO users(username,email,password_hash,first_name,last_name,role)
      VALUES(${randomUUID()},${randomUUID()+'@example.test'},'unused','Queue','Tester','admin') RETURNING id`.execute(db)).rows[0]!.id;
    school=(await sql<{id:string}>`INSERT INTO schools(name,code) VALUES('Invitation queue test',${randomUUID().slice(0,20)}) RETURNING id`.execute(db)).rows[0]!.id;
  });
  beforeEach(()=>{
    vi.spyOn(configuration,'config').mockReturnValue({...settings,INVITATION_EMAIL_ENABLED:true});
    vi.mocked(deliverInvitation).mockImplementation(invite=>Promise.resolve({...invite,delivery:'email_accepted'}));
  });
  afterEach(async()=>{vi.restoreAllMocks();vi.clearAllMocks();await sql`DELETE FROM invitation_email_jobs WHERE invitation_id IN (SELECT id FROM school_invitations WHERE school_id=${school}::uuid)`.execute(db);});
  afterAll(async()=>{await db.destroy();});
  async function create(){
    const token='012345';const email=randomUUID()+'@example.test';
    const row=(await sql<{id:string;expires_at:Date}>`INSERT INTO school_invitations(school_id,email,role,token_hash,created_by,expires_at)
      VALUES(${school}::uuid,${email},'staff',${invitationCodeHash(email,token)},${creator}::uuid,now()+interval '30 minutes') RETURNING id,expires_at`.execute(db)).rows[0]!;
    return {...row,email,token};
  }
  const status=async(id:string)=>(await sql<{delivery_state:string;encrypted_token:string|null}>`SELECT delivery_state,encrypted_token FROM invitation_email_jobs WHERE invitation_id=${id}::uuid`.execute(db)).rows[0]!;
  it('commits the queue without contacting the provider, then sends once in the worker',async()=>{
    const invitation=await create();const result=await db.transaction().execute(tx=>enqueueInvitation(tx,invitation));
    expect(result.delivery).toBe('queued');expect(deliverInvitation).not.toHaveBeenCalled();
    expect((await status(invitation.id)).encrypted_token).not.toContain(invitation.token);
    await Promise.all([worker.deliverPending(),new InvitationEmailWorker(db).deliverPending()]);
    expect(deliverInvitation).toHaveBeenCalledTimes(1);
    expect(deliverInvitation).toHaveBeenCalledWith(expect.objectContaining({token:'012345',email:invitation.email}));
    expect(await status(invitation.id)).toEqual({delivery_state:'email_accepted',encrypted_token:null});
  });
  it('rolls back queued email with its surrounding transaction',async()=>{
    const invitation=await create();
    await expect(db.transaction().execute(async tx=>{await enqueueInvitation(tx,invitation);throw new Error('rollback');})).rejects.toThrow('rollback');
    expect(await status(invitation.id)).toBeUndefined();await worker.deliverPending();expect(deliverInvitation).not.toHaveBeenCalled();
  });
  it('keeps slow provider work off the enqueue path and exposes sending until acceptance',async()=>{
    const invitation=await create();await enqueueInvitation(db,invitation);
    let finish!:()=>void;let started!:()=>void;
    const began=new Promise<void>(resolve=>{started=resolve;});
    vi.mocked(deliverInvitation).mockImplementation(async invite=>{started();await new Promise<void>(resolve=>{finish=resolve;});return {...invite,delivery:'email_accepted'};});
    const running=worker.deliverPending();await began;
    expect((await status(invitation.id)).delivery_state).toBe('sending');
    await worker.deliverPending();expect(deliverInvitation).toHaveBeenCalledTimes(1);
    finish();await running;expect((await status(invitation.id)).delivery_state).toBe('email_accepted');
  });
  it.each(['revoked','accepted','expired','replaced'])('never sends a %s invitation',async state=>{
    const invitation=await create();await enqueueInvitation(db,invitation);
    if(state==='revoked')await sql`UPDATE school_invitations SET revoked_at=now() WHERE id=${invitation.id}::uuid`.execute(db);
    if(state==='accepted')await sql`UPDATE school_invitations SET accepted_at=now() WHERE id=${invitation.id}::uuid`.execute(db);
    if(state==='expired')await sql`UPDATE school_invitations SET expires_at=now()-interval '1 minute' WHERE id=${invitation.id}::uuid`.execute(db);
    if(state==='replaced')await sql`UPDATE school_invitations SET token_hash=${randomUUID()} WHERE id=${invitation.id}::uuid`.execute(db);
    await worker.deliverPending();expect(deliverInvitation).not.toHaveBeenCalled();
    expect(await status(invitation.id)).toEqual({delivery_state:'cancelled',encrypted_token:null});
  });
  it('marks an interrupted send unknown, erases its code and does not duplicate it',async()=>{
    const invitation=await create();await enqueueInvitation(db,invitation);
    await sql`UPDATE invitation_email_jobs SET delivery_state='sending',updated_at=now()-interval '3 minutes' WHERE invitation_id=${invitation.id}::uuid`.execute(db);
    await worker.deliverPending();expect(deliverInvitation).not.toHaveBeenCalled();
    expect(await status(invitation.id)).toEqual({delivery_state:'unknown',encrypted_token:null});
  });
  it.each(['authentication','connection'])('exposes %s failure without retrying an ambiguous send',async code=>{
    const invitation=await create();await enqueueInvitation(db,invitation);
    vi.mocked(deliverInvitation).mockResolvedValue({...invitation,delivery:'failed',delivery_error:code,delivery_message:'Safe error'});
    await worker.deliverPending();await worker.deliverPending();expect(deliverInvitation).toHaveBeenCalledTimes(1);
    expect(await status(invitation.id)).toEqual({delivery_state:code==='authentication'?'failed':'unknown',encrypted_token:null});
  });
});
