import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedVisitAccount, checkedVisitJoin, checkedVisitPreview, checkedVisitProof, visitJoinFragment, visitJoinReturnTarget, visitPublicInput } from '../src/auth/visit-join-policy';
import { createVisitJoinContinuations } from '../src/auth/visit-join-continuation';
import { nativeAuthDestination } from '../src/auth/auth-entry';
import { safeAccountReturnTarget } from '../src/auth/account-return';
import type { SessionState } from '../src/auth/session-types';
import { canonicalNativeHref } from '../src/lib/navigation';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const token='T'.repeat(43), origin='https://campus.example';
const preview={ campus:{ id:id(1),name:'Fictional campus' },visit:{ id:id(2),title:'Fictional visit',starts_at:'2026-11-01T10:00:00Z',ends_at:'2026-11-01T11:00:00Z',place_label:'Reception' },timezone:'Asia/Kolkata',available_until:'2026-11-01T10:00:00Z',authentication_required:true as const };
const result={ accepted:true as const,registration_id:id(3),school_id:id(1),visit_id:id(2),href:`/areas/in-out/visits?visit=${id(2)}&participant=1`,replayed:false };
test('public fragment and auth return admit only one bounded token or opaque local nonce',()=>{
  assert.equal(visitJoinFragment(`#token=${token}`),token);
  for(const value of [token,`token=${token}&token=${token}`,`token=${token}&email=x`,`token=${token.slice(1)}`,'token=%00',null])assert.equal(visitJoinFragment(value),null);
  const href=`/visit-join?continue=${id(4)}`;assert.equal(visitJoinReturnTarget(href),href);
  for(const value of [`${href}#token=${token}`,`${href}&next=/company`,`/visit-join?token=${token}`,'//evil.test/visit-join','/visit-join?continue=x'])assert.equal(visitJoinReturnTarget(value),null);
});
test('the shared route classifier keeps only the public visit owner or exact opaque continuation',()=>{
  const next=`/visit-join?continue=${id(4)}`;
  assert.equal(canonicalNativeHref('/visit-join'),'/visit-join');assert.equal(canonicalNativeHref(next),next);
  for(const value of ['/visit-join/','/visit-joining',`/visit-join#token=${token}`,`/visit-join?token=${token}`,next+'&next=/company',next+'#private','/visit-join?continue=bad'])assert.equal(canonicalNativeHref(value),`/more/source?href=${encodeURIComponent(value)}`);
});
test('public projections are minimized, campus-timed and never accepted as sessions or private shared views',()=>{
  assert.deepEqual(checkedVisitPreview(preview),preview);
  assert.throws(()=>checkedVisitPreview({...preview,timezone:'Invalid/Zone'}));
  assert.throws(()=>checkedVisitPreview({...preview,question:{entries:['private']}}));
  assert.deepEqual(checkedVisitProof({challenge_id:id(4),expires_at:preview.available_until,delivery:'unavailable',retry_after_seconds:60}).delivery,'unavailable');
  assert.throws(()=>checkedVisitProof({challenge_id:id(4),expires_at:preview.available_until,delivery:'sent',retry_after_seconds:60}));
  for(const status of ['created','sign_in_required'])assert.equal(checkedVisitAccount({status}).status,status);
  assert.throws(()=>checkedVisitAccount({status:'created',access_token:'forbidden'}));
});
test('accepted join proves exact registration, source campus and own participant route',()=>{
  assert.deepEqual(checkedVisitJoin(result,preview),result);
  for(const change of [{school_id:id(5)},{visit_id:id(5)},{href:`/areas/in-out/visits?visit=${id(2)}&shared=1`},{href:result.href+'&next=/company'},{registration_id:'wrong'},{accepted:false},{share_id:id(5)}])assert.throws(()=>checkedVisitJoin({...result,...change},preview));
});
test('account input retains exact proof and refuses extra role/session fields or mismatched proof',()=>{
  const value={token,email:' GUEST@example.test ',challenge_id:id(4),code:'123456',first_name:' Guest ',last_name:'',password:'PrivateStrong!453'};
  assert.equal(visitPublicInput('account',value).email,'guest@example.test');
  for(const change of [{role:'staff'},{school_id:id(1)},{code:'12345'},{password:'short'},{token:'bad'},{challenge_id:'bad'}])assert.throws(()=>visitPublicInput('account',{...value,...change}));
});
test('volatile continuations bind origin, expire, keep pending actor commands and cannot reconstruct cold credentials',()=>{
  let now=1000;const vault=createVisitJoinContinuations(()=>now),href=vault.retain(token,origin,()=>id(4));
  assert.equal(vault.resolve(href,origin)?.token,token);assert.equal(vault.resolve(href,'https://other.example'),null);
  assert.equal(createVisitJoinContinuations(()=>now).resolve(href,origin),null);
  assert.throws(()=>vault.update(id(4),origin,value=>({...value,token:'X'.repeat(43)})));
  vault.update(id(4),origin,value=>({...value,command:{actorId:id(5),id:id(6),dispatched:true}}));
  assert.equal(vault.resolve(href,origin)?.command?.id,id(6));assert.equal(href.includes(token),false);
  now+=30*60_000;assert.equal(vault.resolve(href,origin),null);
});
test('bounded memory refuses to evict four uncertain commands for a fifth link',()=>{
  const vault=createVisitJoinContinuations();for(let n=1;n<=4;n++){vault.retain(token,origin,()=>id(n));vault.update(id(n),origin,value=>({...value,command:{actorId:id(8),id:id(n+10),dispatched:true}}));}
  assert.throws(()=>vault.retain(token,origin,()=>id(5)),/Finish an earlier/);assert.ok(vault.read(id(1),origin));
});
test('normal login and email verification preserve only the nonce, bypassing founder setup for neutral visitor accounts',()=>{
  const session:SessionState={status:'authenticated',user:{id:id(9),username:'guest',email:'guest@example.test',first_name:'Guest',last_name:'',display_name:'Guest',email_verified:true},memberships:[],environment:{mode:'live'},error:null,setupRequired:true};
  const next=`/visit-join?continue=${id(4)}`;assert.equal(nativeAuthDestination(session,next),next);assert.equal(safeAccountReturnTarget(next),next);
  assert.equal(nativeAuthDestination({...session,user:{...session.user!,email_verified:false}},next),`/more/account/security?from=${encodeURIComponent(next)}`);
  assert.notEqual(nativeAuthDestination(session,`/visit-join#token=${token}`),`/visit-join#token=${token}`);
});

test('native invitation capture preserves only the exact fragment entry before router normalization', async()=>{
 const {visitJoinNativeEntry}=await import('../src/auth/visit-join-policy');
 for(const path of [`thatcampus://visit-join#token=${token}`,`thatcampus:///visit-join#token=${token}`,`/visit-join#token=${token}`]) assert.equal(visitJoinNativeEntry(path),token);
 for(const suffix of [`?token=${token}#token=${token}`,`#token=${token}&extra=1`,'#token=short']) assert.equal(visitJoinNativeEntry('thatcampus:///visit-join'+suffix),null);
 for(const path of ['/areas','thatcampus://auth/google?code=secret','https://foreign.test/visit-join#token='+token,'/visit-join?continue='+id(4),'thatcampus://visit-join/other#token='+token]) assert.equal(visitJoinNativeEntry(path),undefined);
});
