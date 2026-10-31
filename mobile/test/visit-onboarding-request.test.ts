import test from 'node:test';
import assert from 'node:assert/strict';
import { requestVisitOnboarding } from '../src/auth/visit-onboarding-request';
import { createSessionLifecycle } from '../src/auth/session-lifecycle';
import { createBrowserSessionController } from '../src/auth/web-session-controller';

const token='T'.repeat(43), origin='https://campus.example';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(yes=>resolve=yes);return{promise,resolve};}
test('browser public requests prepare CSRF then post only the exact owning action and mark dispatch afterwards',async()=>{
  const calls:string[]=[],life=createSessionLifecycle(()=>origin);let dispatched=0;
  const api={async apiFetch<T>(path:string,init?:RequestInit){calls.push(path);if(path.endsWith('/csrf/'))assert.equal(dispatched,0);else{assert.equal(dispatched,1);assert.deepEqual(JSON.parse(String(init?.body)),{token});}return{ok:true} as T;}};
  await requestVisitOnboarding(api,'web','preview',{token},life.capture(),()=>{},()=>dispatched++);
  assert.deepEqual(calls,['/api/v1/auth/csrf/','/api/v1/auth/visit-onboarding/preview/']);
});
test('departed form or rebound auth lifecycle during CSRF preparation never dispatches account/proof',async()=>{
  for(const kind of ['form','session']){
    const wait=deferred(),calls:string[]=[],life=createSessionLifecycle(()=>origin);let current=true,dispatched=0;
    const api={async apiFetch<T>(path:string){calls.push(path);await wait.promise;return {} as T;}};
    const attempt=requestVisitOnboarding(api,'web','proof',{token,email:'guest@example.test'},life.capture(),()=>{if(!current)throw Error('Departed');},()=>dispatched++);
    if(kind==='form')current=false;else life.begin();wait.resolve();await assert.rejects(attempt);assert.deepEqual(calls,['/api/v1/auth/csrf/']);assert.equal(dispatched,0);
  }
});
test('native uses fixed aliases without cookie bootstrap and refuses late responses after rebinding',async()=>{
  const calls:string[]=[],wait=deferred(),life=createSessionLifecycle(()=>origin);
  const api={async apiFetch<T>(path:string){calls.push(path);await wait.promise;return{} as T;}};
  const attempt=requestVisitOnboarding(api,'native','preview',{token},life.capture(),()=>{});life.begin();wait.resolve();await assert.rejects(attempt);
  assert.deepEqual(calls,['/api/v1/auth/native/visit-onboarding/preview/']);
});
test('public wrapper refuses injected actions/fields before any I/O',async()=>{
  let requests=0;const api={async apiFetch<T>(){requests++;return {} as T;}},life=createSessionLifecycle(()=>origin);
  await assert.rejects(requestVisitOnboarding(api,'web','join' as never,{token},life.capture(),()=>{}));
  await assert.rejects(requestVisitOnboarding(api,'native','proof',{token,email:'guest@example.test',role:'admin'},life.capture(),()=>{}));assert.equal(requests,0);
});
test('real browser session owner does not publish authentication or load a profile after account creation',async()=>{
  const calls:string[]=[],states:string[]=[],controller=createBrowserSessionController({api:{getApiOrigin:()=>origin,blockApiRequests(){},bindApiSession(){},bindCookieSession(){},async apiFetch<T>(path:string){calls.push(path);if(path.endsWith('/session/'))return{authenticated:false,user:null} as T;return{status:'created'} as T;}},onState:value=>states.push(value.status),clearQueries(){},isExplicitlyLoggedOut:()=>false,markExplicitlyLoggedOut(){},announceChange(){}});
  await controller.refresh();const before=states.length;
  await controller.requestVisitOnboarding('account',{token,email:'guest@example.test',challenge_id:'10000000-0000-4000-8000-000000000001',code:'123456',first_name:'Guest',last_name:'',password:'PrivateStrong!453'},()=>{});
  assert.equal(states.length,before);assert.deepEqual(calls.slice(-2),['/api/v1/auth/csrf/','/api/v1/auth/visit-onboarding/account/']);assert.ok(!calls.some(path=>path.endsWith('/me/')));
});
