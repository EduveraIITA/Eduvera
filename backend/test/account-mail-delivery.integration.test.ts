import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { AuthService } from '../src/auth/auth.service.js';
import { verifyPassword } from '../src/auth/password.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { AuditService } from '../src/common/audit.service.js';
import { deliverPendingAccountMail, openAccountMailToken, prepareAccountMail } from '../src/common/account-email-queue.js';
import * as transport from '../src/common/email-transport.js';
import * as configuration from '../src/config.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const target = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/account_mail_unused_test';
const applicationName=`account-mail-test-${randomUUID()}`;
const db = new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:target,max:4,application_name:applicationName})})});
const connection=db as DatabaseService, core=new CampusModelCoreService(connection,new ExecutionDataPlaneScope());
const auth=new AuthService(connection,new AuditService(connection),{} as never,new ProgressiveWorkspaceProvisioner(core));
const password='Local-Account-Forest-2026!', nextPassword='Local-New-River-2026!';
const request=()=>({ip:'127.0.0.1',headers:{'user-agent':'isolated account mail test'},requestId:randomUUID()}) as unknown as FastifyRequest;
const accounts = new Set<string>();
type Job={id:string;account_token_id:string;purpose:'password_reset'|'email_verification';recipient_email:string;encrypted_token:string|null;delivery_state:string;provider_message_id:string|null;expires_at:Date;token_hash:string;consumed_at:Date|null;email_at_issue:string|null};
async function jobs(userId:string) {return (await sql<Job>`SELECT job.*,token.expires_at,token.token_hash,token.consumed_at,token.email_at_issue
  FROM auth_account_email_jobs job JOIN auth_account_tokens token ON token.id=job.account_token_id WHERE token.user_id=${userId}::uuid ORDER BY job.created_at,job.id`.execute(db)).rows;}
const raw=(job:Job)=>openAccountMailToken(job.encrypted_token!,job.account_token_id,job.purpose);
async function fixture() {
  const result=await auth.register({email:`mail-${randomUUID()}@example.test`,password},request()); accounts.add(result.user.id);
  return result.user;
}
// RFC 4226 test-side authenticator; production secret generation/enrollment and
// proof verification still run through the ordinary owning service.
function totp(secret:string,at=Date.now()) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bits=[...secret].map(char=>alphabet.indexOf(char).toString(2).padStart(5,'0')).join('');
  const key=Buffer.from(Array.from({length:Math.floor(bits.length/8)},(_,index)=>Number.parseInt(bits.slice(index*8,index*8+8),2)));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(at/30000)));
  const digest=createHmac('sha1',key).update(counter).digest(),offset=digest[digest.length-1]!&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
async function mfaFixture() {
  const user=await fixture(),verification=raw((await jobs(user.id))[0]!);
  await auth.confirmEmailVerification(user,{token:verification},request());
  const setup=await auth.beginMfaEnrollment(user,request());
  const confirmed=await auth.confirmMfaEnrollment(user,{code:totp(setup.secret)},request());
  return {user,secret:setup.secret,recovery:confirmed.recovery_codes};
}
async function waitForAccountLocks(count:number) {
  for(let attempt=0;attempt<100;attempt++){
    const waiting=(await sql<{count:number}>`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query ILIKE '%users%'`.execute(db)).rows[0]!.count;
    if(waiting>=count)return;await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Expected isolated account-row lock contention was not observed');
}
async function holdAccount(userId:string) {
  let release!:()=>void,locked!:()=>void;
  const held=new Promise<void>(resolve=>{locked=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const transaction=db.transaction().execute(async tx=>{await sql`SELECT id FROM users WHERE id=${userId}::uuid FOR NO KEY UPDATE`.execute(tx);locked();await gate;});
  await held;return {release,transaction};
}

describe.runIf(enabled)('durable account mail and proof lifecycle against isolated PostgreSQL',()=>{
  let mail:MockInstance<typeof transport.sendTransactionalEmail>;
  beforeAll(()=>{const settings=configuration.config();vi.spyOn(configuration,'config').mockReturnValue({...settings,INVITATION_EMAIL_ENABLED:true,INVITATION_EMAIL_PROVIDER:'resend',INVITATION_EMAIL_FROM:'sender@example.test',RESEND_API_KEY:'local-fake-only',PUBLIC_URL:'https://app2.thatcampus.com'});});
  afterAll(async()=>{vi.restoreAllMocks();await db.destroy();});
  afterEach(async()=>{
    mail?.mockRestore();
    for(const id of accounts) await sql`UPDATE auth_account_email_jobs job SET delivery_state='cancelled',encrypted_token=NULL
      FROM auth_account_tokens token WHERE token.id=job.account_token_id AND token.user_id=${id}::uuid AND job.delivery_state IN ('queued','sending')`.execute(db);
  });
  function acceptMail(){mail=vi.spyOn(transport,'sendTransactionalEmail').mockImplementation(message=>{
    expect(message.to.endsWith('@example.test')).toBe(true); return Promise.resolve({provider_message_id:'local-provider-accepted'});
  }); return mail;}
  it('commits registration plus an encrypted single-use verification job, then accepts it once outside the account transaction',async()=>{
    const send=acceptMail(),user=await fixture(),[job]=await jobs(user.id);
    expect(send).not.toHaveBeenCalled();expect(job!.delivery_state).toBe('queued');expect(job!.email_at_issue).toBe(user.email);
    const token=raw(job!);expect(job!.token_hash).toBe(AuthService.tokenHash(token));expect(job!.encrypted_token).not.toContain(token);
    expect((await db.selectFrom('school_people').select('id').where('school_id','=',user.active_school_id!).execute()).length).toBeGreaterThan(0);
    await Promise.all([deliverPendingAccountMail(db,2),deliverPendingAccountMail(db,2)]);
    expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0]![0].idempotencyKey).toBe(`account-action/${job!.account_token_id}`);
    expect((await jobs(user.id))[0]).toMatchObject({delivery_state:'email_accepted',encrypted_token:null,provider_message_id:'local-provider-accepted'});
    await deliverPendingAccountMail(db,2);expect(send).toHaveBeenCalledOnce();
    const wrong=await fixture();await expect(auth.confirmEmailVerification(wrong,{token},request())).rejects.toMatchObject({status:400});
    expect(await auth.confirmEmailVerification(user,{token},request())).toEqual({verified:true});
    await expect(auth.confirmEmailVerification(user,{token},request())).rejects.toMatchObject({status:400});
    expect((await db.selectFrom('users').select('email_verified_at').where('id','=',wrong.id).executeTakeFirstOrThrow()).email_verified_at).toBeNull();
  });
  it('rolls back the token and delivery intent together, and serializes concurrent retries without replacing their link',async()=>{
    acceptMail();const user=await fixture(),before=await jobs(user.id);
    await expect(db.transaction().execute(async tx=>{await prepareAccountMail(tx,user.id,'password_reset',30*60_000);throw new Error('local rollback');})).rejects.toThrow('local rollback');
    expect(await jobs(user.id)).toEqual(before);
    const responses=await Promise.all([auth.requestEmailVerification(user,request()),auth.requestEmailVerification(user,request())]);
    expect(responses.every(value=>value.delivery==='queued')).toBe(true);expect(await jobs(user.id)).toHaveLength(1);
    await Promise.all([auth.requestPasswordReset({email:user.email},request()),auth.requestPasswordReset({email:user.email},request())]);
    expect((await jobs(user.id)).filter(job=>job.purpose==='password_reset')).toHaveLength(1);
  });
  it('holds uncertain provider outcomes and crash claims permanently instead of resending after the provider dedupe window',async()=>{
    const send=acceptMail(),user=await fixture();send.mockRejectedValue(Object.assign(new Error('private provider token and recipient'),{code:'ETIMEDOUT'}));
    await deliverPendingAccountMail(db,2);expect(send).toHaveBeenCalledOnce();expect((await jobs(user.id))[0]).toMatchObject({delivery_state:'unknown',encrypted_token:null});
    await sql`UPDATE auth_account_email_jobs SET updated_at=now()-interval '2 days' WHERE account_token_id IN (SELECT id FROM auth_account_tokens WHERE user_id=${user.id}::uuid)`.execute(db);
    await deliverPendingAccountMail(db,2);expect(send).toHaveBeenCalledOnce();
    const second=await fixture();await sql`UPDATE auth_account_email_jobs SET delivery_state='sending',updated_at=now()-interval '3 minutes' WHERE account_token_id IN (SELECT id FROM auth_account_tokens WHERE user_id=${second.id}::uuid)`.execute(db);
    await deliverPendingAccountMail(db,2);expect(send).toHaveBeenCalledOnce();expect((await jobs(second.id))[0]).toMatchObject({delivery_state:'unknown',encrypted_token:null});
    const audit=await db.selectFrom('audit_events').select('metadata').where('actor_id','=',user.id).execute();expect(JSON.stringify(audit)).not.toMatch(/private provider|token_hash|encrypted_token/);
  });
  it('cancels expired, replaced, changed-address and deactivated-account jobs before sending',async()=>{
    const send=acceptMail(),user=await fixture();
    await sql`UPDATE auth_account_tokens SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE user_id=${user.id}::uuid`.execute(db);
    await deliverPendingAccountMail(db,2);expect((await jobs(user.id))[0]!.delivery_state).toBe('cancelled');
    const replaced=await fixture();await sql`UPDATE auth_account_tokens SET created_at=now()-interval '2 minutes' WHERE user_id=${replaced.id}::uuid`.execute(db);
    await auth.requestEmailVerification(replaced,request());await deliverPendingAccountMail(db,2);
    expect((await jobs(replaced.id)).map(job=>job.delivery_state)).toEqual(['cancelled','email_accepted']);expect(send).toHaveBeenCalledOnce();
    const changed=await fixture(),token=raw((await jobs(changed.id))[0]!);
    await db.updateTable('users').set({email:`changed-${randomUUID()}@example.test`}).where('id','=',changed.id).execute();
    await expect(auth.confirmEmailVerification(changed,{token},request())).rejects.toMatchObject({status:400});
    const inactive=await fixture();await db.updateTable('users').set({is_active:false}).where('id','=',inactive.id).execute();
    await deliverPendingAccountMail(db,2);expect((await jobs(changed.id))[0]!.delivery_state).toBe('cancelled');expect((await jobs(inactive.id))[0]!.delivery_state).toBe('cancelled');expect(send).toHaveBeenCalledOnce();
  });
  it('keeps reset responses uniform, consumes a valid proof once and revokes existing sessions without auto-login',async()=>{
    acceptMail();const user=await fixture(),session=await auth.createSession(user,request());
    const a=await auth.requestPasswordReset({email:user.email},request()),b=await auth.requestPasswordReset({email:`absent-${randomUUID()}@example.test`},request());
    expect(a).toEqual({accepted:true,recovery_available:true});expect(b).toEqual(a);
    const reset=(await jobs(user.id)).find(job=>job.purpose==='password_reset')!,token=raw(reset);
    await expect(auth.confirmPasswordReset({token,password:'weak'},request())).rejects.toMatchObject({status:400});
    expect(await auth.confirmPasswordReset({token,password:nextPassword},request())).toEqual({reset:true});
    expect(await auth.resolveSession(session.rawToken)).toBeNull();
    expect(await db.selectFrom('auth_sessions').select('token_hash').where('user_id','=',user.id).execute()).toEqual([]);
    const account=await db.selectFrom('users').selectAll().where('id','=',user.id).executeTakeFirstOrThrow();
    expect(await verifyPassword(nextPassword,account.password_hash)).toBe(true);expect(await verifyPassword(password,account.password_hash)).toBe(false);
    await expect(auth.confirmPasswordReset({token,password},request())).rejects.toMatchObject({status:400});
  });
  it('serializes reset with an in-flight old-password login and refuses post-reset stale session issuance',async()=>{
    acceptMail();const user=await fixture();
    // Ordinary login verifies the old credential and returns its internal row;
    // controller session issuance is intentionally paused across a real reset.
    const primary=await auth.login({identifier:user.email,password},request());
    await auth.requestPasswordReset({email:user.email},request());
    const token=raw((await jobs(user.id)).find(job=>job.purpose==='password_reset')!);
    let release!:()=>void,locked!:()=>void;
    const held=new Promise<void>(resolve=>{locked=resolve;}),releaseGate=new Promise<void>(resolve=>{release=resolve;});
    const blocker=db.transaction().execute(async tx=>{
      await sql`SELECT id FROM users WHERE id=${user.id}::uuid FOR NO KEY UPDATE`.execute(tx);
      locked();await releaseGate;
    });
    const waitForLocks=async(count:number)=>{
      for(let attempt=0;attempt<100;attempt++){
        const waiting=(await sql<{count:number}>`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query ILIKE '%users%'`.execute(db)).rows[0]!.count;
        if(waiting>=count)return;await new Promise(resolve=>setTimeout(resolve,20));
      }
      throw new Error('Expected isolated account-row lock contention was not observed');
    };
    await held;
    const reset=auth.confirmPasswordReset({token,password:nextPassword},request());
    let stale:Promise<unknown>|undefined;
    try {
      await waitForLocks(1);
      // Queue the old-password controller step behind the already-waiting reset.
      stale=auth.createSession(primary.user,request());
      const retained=stale.then(value=>({value}),error=>({error}));
      await waitForLocks(2);release();await blocker;expect(await reset).toEqual({reset:true});
      expect(await retained).toMatchObject({error:{status:401}});
    } finally {release();await blocker;await reset.catch(()=>{});await stale?.catch(()=>{});}
    const fresh=await auth.login({identifier:user.email,password:nextPassword},request());
    expect((await auth.createSession(fresh.user,request())).rawToken.length).toBeGreaterThan(32);
    expect(await db.selectFrom('auth_sessions').select('token_hash').where('user_id','=',user.id).execute()).toHaveLength(1);
  });
  it('does not create an MFA challenge from an old password verified before a committed reset',async()=>{
    const f=await mfaFixture();await auth.requestPasswordReset({email:f.user.email},request());
    const token=raw((await jobs(f.user.id)).find(job=>job.purpose==='password_reset')!);
    let verified!:()=>void,resume!:()=>void;
    const primaryVerified=new Promise<void>(resolve=>{verified=resolve;}),gate=new Promise<void>(resolve=>{resume=resolve;});
    const original=auth.finishPrimaryLogin.bind(auth);
    const paused=vi.spyOn(auth,'finishPrimaryLogin').mockImplementationOnce(async(user,req)=>{verified();await gate;return original(user,req);});
    const login=auth.login({identifier:f.user.email,password},request()).then(value=>({value}),error=>({error}));
    try{
      await primaryVerified;expect(await auth.confirmPasswordReset({token,password:nextPassword},request())).toEqual({reset:true});
      resume();expect(await login).toMatchObject({error:{status:401}});
      expect((await sql`SELECT token_hash FROM auth_mfa_login_challenges WHERE user_id=${f.user.id}::uuid`.execute(db)).rows).toEqual([]);
      expect(await db.selectFrom('auth_sessions').select('token_hash').where('user_id','=',f.user.id).execute()).toEqual([]);
      expect(await auth.login({identifier:f.user.email,password:nextPassword},request())).toHaveProperty('mfaChallenge');
    }finally{resume();await login;paused.mockRestore();}
  });
  it.each(['reset_first','mfa_first'] as const)('serializes reset and MFA completion account-first (%s), without a surviving stale session',async(order)=>{
    const f=await mfaFixture(),primary=await auth.login({identifier:f.user.email,password},request());
    expect(primary.mfaChallenge).toBeDefined();await auth.requestPasswordReset({email:f.user.email},request());
    const token=raw((await jobs(f.user.id)).find(job=>job.purpose==='password_reset')!),blocker=await holdAccount(f.user.id);
    const reset=()=>auth.confirmPasswordReset({token,password:nextPassword},request()).then(value=>({value}),error=>({error}));
    const complete=()=>auth.completeMfaLogin({challenge_token:primary.mfaChallenge!,code:f.recovery[0]!},request(),{transport:'native'}).then(value=>({value}),error=>({error}));
    let resetResult:ReturnType<typeof reset>|undefined,mfaResult:ReturnType<typeof complete>|undefined;
    try{
      if(order==='reset_first')resetResult=reset();else mfaResult=complete();
      await waitForAccountLocks(1);
      if(order==='reset_first')mfaResult=complete();else resetResult=reset();
      await waitForAccountLocks(2);blocker.release();await blocker.transaction;
      expect(await resetResult!).toMatchObject({value:{reset:true}});
      const result=await mfaResult!;
      if(order==='reset_first'){
        expect(result).toMatchObject({error:{status:401}});
        expect((await sql<{used_at:Date|null}>`SELECT used_at FROM auth_mfa_recovery_codes WHERE user_id=${f.user.id}::uuid AND code_hash=${AuthService.tokenHash(f.recovery[0]!.replace(/-/g,''))}`.execute(db)).rows[0]!.used_at).toBeNull();
      }else{
        expect(result).toHaveProperty('value.session.rawToken');
        if('value' in result)expect(await auth.resolveSession(result.value.session.rawToken)).toBeNull();
      }
      expect((await sql`SELECT token_hash FROM auth_mfa_login_challenges WHERE user_id=${f.user.id}::uuid`.execute(db)).rows).toEqual([]);
      expect(await db.selectFrom('auth_sessions').select('token_hash').where('user_id','=',f.user.id).execute()).toEqual([]);
      const fresh=await auth.login({identifier:f.user.email,password:nextPassword},request());
      // Reset does not disable MFA; an unused recovery code remains one-use.
      const accepted=await auth.completeMfaLogin({challenge_token:fresh.mfaChallenge!,code:f.recovery[1]!},request(),{transport:'native'});
      expect(accepted.session.rawToken).toMatch(/^tc_native_/u);
      await expect(auth.completeMfaLogin({challenge_token:fresh.mfaChallenge!,code:f.recovery[1]!},request())).rejects.toMatchObject({status:401});
      const retry=await auth.login({identifier:f.user.email,password:nextPassword},request());
      await expect(auth.completeMfaLogin({challenge_token:retry.mfaChallenge!,code:f.recovery[1]!},request())).rejects.toMatchObject({status:401});
      await auth.logout(AuthService.tokenHash(accepted.session.rawToken));
    }finally{blocker.release();await blocker.transaction;await resetResult;await mfaResult;}
  });
  it('keeps active MFA mandatory at delayed plain-session issuance and consumes a TOTP once',async()=>{
    const user=await fixture(),primary=await auth.login({identifier:user.email,password},request());
    await auth.confirmEmailVerification(user,{token:raw((await jobs(user.id))[0]!)},request());
    const setup=await auth.beginMfaEnrollment(user,request()),now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);
    try{
      await auth.confirmMfaEnrollment(user,{code:totp(setup.secret,now)},request());
      await expect(auth.createSession(primary.user,request())).rejects.toMatchObject({status:401});
      const fresh=await auth.login({identifier:user.email,password},request());
      await expect(auth.completeMfaLogin({challenge_token:fresh.mfaChallenge!,code:totp(setup.secret,now)},request())).rejects.toMatchObject({status:401});
      clock.mockReturnValue(now+30000);
      const code=totp(setup.secret,now+30000),accepted=await auth.completeMfaLogin({challenge_token:fresh.mfaChallenge!,code},request());
      expect(accepted.session.rawToken).not.toMatch(/^tc_native_/u);
      const replay=await auth.login({identifier:user.email,password},request());
      await expect(auth.completeMfaLogin({challenge_token:replay.mfaChallenge!,code},request())).rejects.toMatchObject({status:401});
      await auth.logout(AuthService.tokenHash(accepted.session.rawToken));
    }finally{clock.mockRestore();}
  });

});
