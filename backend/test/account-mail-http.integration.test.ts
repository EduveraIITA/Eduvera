import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openAccountMailToken, prepareAccountMail } from '../src/common/account-email-queue.js';
import * as configuration from '../src/config.js';
import type { Database } from '../src/database/types.js';
import { IsolatedAppHttp } from './isolated-app-http.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
const compiledRoot=process.env.ACCOUNT_MAIL_HTTP_COMPILED_ROOT??process.env.VISIT_ONBOARDING_HTTP_COMPILED_ROOT;
const target=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/account_mail_http_unused_test';
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:target,max:4})})});
const app=new IsolatedAppHttp(),password='Local-Http-Forest-2026!',replacement='Local-Http-New-River-2026!';
type Account={id:string;email:string;active_school_id:string};
function authenticatorCode(secret:string) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bits=[...secret].map(char=>alphabet.indexOf(char).toString(2).padStart(5,'0')).join('');
  const key=Buffer.from(Array.from({length:Math.floor(bits.length/8)},(_,index)=>Number.parseInt(bits.slice(index*8,index*8+8),2)));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',key).update(counter).digest(),offset=digest[digest.length-1]!&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}

describe.runIf(enabled)('account proof routes through the isolated compiled authenticated app',()=>{
  beforeAll(async()=>{
    if(!compiledRoot)throw new Error('Set an explicitly isolated ACCOUNT_MAIL_HTTP_COMPILED_ROOT or VISIT_ONBOARDING_HTTP_COMPILED_ROOT; ordinary dist is forbidden.');
    await app.start(target,{compiledRoot,publicUrl:'https://app2.thatcampus.com'});
  });
  afterAll(async()=>{await app.stop();await db.destroy();});
  function native(path:string,body:unknown,bearer?:string){return fetch(app.base+'/api/v1/auth/native/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});}
  /** Queue fixture comes from the same typed owner, with no provider dispatch.
   * The isolated API deliberately has mail disabled and all workers suppressed. */
  async function queuedProof(user:Account,purpose:'email_verification'|'password_reset'){
    const settings=configuration.config(),spy=vi.spyOn(configuration,'config').mockReturnValue({...settings,INVITATION_EMAIL_ENABLED:true});
    try{
      await db.transaction().execute(tx=>prepareAccountMail(tx,user.id,purpose,purpose==='password_reset'?1800000:86400000));
      const job=(await sql<{account_token_id:string;encrypted_token:string}>`SELECT job.account_token_id,job.encrypted_token FROM auth_account_email_jobs job
        JOIN auth_account_tokens token ON token.id=job.account_token_id WHERE token.user_id=${user.id}::uuid AND token.purpose=${purpose} AND token.consumed_at IS NULL ORDER BY token.created_at DESC LIMIT 1`.execute(db)).rows[0]!;
      return openAccountMailToken(job.encrypted_token,job.account_token_id,purpose);
    }finally{spy.mockRestore();}
  }
  it('retains uniform disabled readiness and enforces account binding, one use, password policy and web/native session revocation',async()=>{
    const owner=app.session(),other=app.session(),email=`http-mail-${randomUUID()}@example.test`;
    await owner.json('/api/v1/auth/csrf/');
    const registered=await owner.json<{user:Account;verification:{delivery:string}}>('/api/v1/auth/register/','POST',{email,password});
    expect(registered.verification).toEqual({delivery:'unavailable'});
    expect((await sql`SELECT id FROM auth_account_tokens WHERE user_id=${registered.user.id}::uuid`.execute(db)).rows).toHaveLength(0);
    const a=await native('password-reset/request/',{email}),b=await native('password-reset/request/',{email:`absent-${randomUUID()}@example.test`});
    expect(a.status).toBe(202);expect(b.status).toBe(202);expect(await a.json()).toEqual({accepted:true,recovery_available:false});expect(await b.json()).toEqual({accepted:true,recovery_available:false});
    await other.json('/api/v1/auth/csrf/');await other.json('/api/v1/auth/register/','POST',{email:`other-${randomUUID()}@example.test`,password});
    const verify=await queuedProof(registered.user,'email_verification');
    expect((await other.request('/api/v1/auth/email-verification/confirm/','POST',{token:verify})).status).toBe(400);
    expect(await owner.json('/api/v1/auth/email-verification/confirm/','POST',{token:verify})).toEqual({verified:true});
    expect((await owner.request('/api/v1/auth/email-verification/confirm/','POST',{token:verify})).status).toBe(400);
    const initial=await native('login/',{identifier:email,password});expect(initial.status).toBe(200);
    const access=(await initial.json() as {access_token:string}).access_token;expect(access.startsWith('tc_native_')).toBe(true);
    const reset=await queuedProof(registered.user,'password_reset');
    expect((await native('password-reset/confirm/',{token:verify,password:replacement})).status).toBe(400);
    expect((await native('password-reset/confirm/',{token:reset,password:'weak'})).status).toBe(400);
    const confirmed=await native('password-reset/confirm/',{token:reset,password:replacement});expect(confirmed.status).toBe(200);expect(await confirmed.json()).toEqual({reset:true});
    expect((await owner.request('/api/v1/auth/me/')).status).toBe(401);
    expect((await fetch(app.base+'/api/v1/auth/me/',{headers:{Authorization:`Bearer ${access}`}})).status).toBe(401);
    expect((await native('password-reset/confirm/',{token:reset,password})).status).toBe(400);
    expect((await native('login/',{identifier:email,password})).status).toBe(401);
    const fresh=await native('login/',{identifier:email,password:replacement});expect(fresh.status).toBe(200);
    const freshToken=(await fresh.json() as {access_token:string}).access_token;
    const protectedPost=(path:string,body:unknown)=>fetch(app.base+'/api/v1/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${freshToken}`},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const enrolled=await protectedPost('mfa/enroll/',{});expect(enrolled.ok).toBe(true);
    const secret=(await enrolled.json() as {secret:string}).secret;
    const activated=await protectedPost('mfa/confirm/',{code:authenticatorCode(secret)});expect(activated.status).toBe(200);
    const recovery=(await activated.json() as {recovery_codes:string[]}).recovery_codes;
    const nativePrimary=await native('login/',{identifier:email,password:replacement});expect(nativePrimary.status).toBe(202);
    const nativeChallenge=(await nativePrimary.json() as {challenge_token:string}).challenge_token;
    const nativeComplete=await native('mfa/login/',{challenge_token:nativeChallenge,code:recovery[0]!});expect(nativeComplete.status).toBe(200);
    const mfaToken=(await nativeComplete.json() as {access_token:string}).access_token;
    expect(mfaToken).toMatch(/^tc_native_/u);expect((await fetch(app.base+'/api/v1/auth/me/',{headers:{Authorization:`Bearer ${mfaToken}`}})).status).toBe(200);
    expect((await native('mfa/login/',{challenge_token:nativeChallenge,code:recovery[0]!})).status).toBe(401);
    const webMfa=app.session();await webMfa.json('/api/v1/auth/csrf/');
    const webChallenge=await webMfa.json<{mfa_required:boolean;challenge_token:string}>('/api/v1/auth/login/','POST',{identifier:email,password:replacement});
    expect(webChallenge.mfa_required).toBe(true);
    const webComplete=await webMfa.json<{user:Account}>('/api/v1/auth/mfa/login/','POST',{challenge_token:webChallenge.challenge_token,code:recovery[1]!});
    expect(webComplete.user.id).toBe(registered.user.id);expect((await webMfa.request('/api/v1/auth/me/')).status).toBe(200);
    expect((await webMfa.request('/api/v1/auth/mfa/login/','POST',{challenge_token:webChallenge.challenge_token,code:recovery[1]!})).status).toBe(401);
    await webMfa.request('/api/v1/auth/logout/','POST',{});
    expect((await native('logout/',{},mfaToken)).status).toBe(204);
    expect((await native('logout/',{},freshToken)).status).toBe(204);
    expect((await sql`SELECT token_hash FROM auth_sessions WHERE user_id=${registered.user.id}::uuid`.execute(db)).rows).toHaveLength(0);
    await other.request('/api/v1/auth/logout/','POST',{});
  });
});
