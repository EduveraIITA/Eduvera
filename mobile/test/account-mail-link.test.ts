import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React, { act } from 'react';
import ts from 'typescript';
import { accountMailLinkInput, accountMailLinks, accountMailNativeHref, createAccountMailLinks } from '../src/auth/account-mail-link';
import { accountSecurityEntryHref } from '../src/auth/account-recovery';

const require=createRequire(import.meta.url),origin='https://app2.thatcampus.com',token='local-test-account-proof-'.padEnd(43,'x');
function load(file:string,dependencies:Record<string,unknown>,window?:Window) {
  const code=ts.transpileModule(readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports:Record<string,unknown>={};runInNewContext(code,{exports,URL,URLSearchParams,window,require:(name:string)=>{if(!(name in dependencies))throw new Error(`Unexpected dependency ${name}`);return dependencies[name];}});return exports;
}
test('account email proof grammar rejects duplicate, mixed and foreign links without choosing a credential',()=>{
  assert.deepEqual(accountMailLinkInput(`${origin}/reset-password#token=${token}`,origin),{purpose:'password_reset',token});
  assert.deepEqual(accountMailLinkInput(`/account/security?token=${token}`,origin),{purpose:'email_verification',token});
  for(const value of [`${origin}/reset-password#token=${token}&token=${token}`,`${origin}/account/security?token=${token}#token=${token}`,`${origin}/reset-password#token=${token}&next=https://foreign.test`,`${origin}/account/security#token=short`,`https://foreign.test/reset-password#token=${token}`]) assert.equal(accountMailLinkInput(value,origin),null);
  assert.equal(accountMailLinkInput(`${origin}/areas#token=${token}`,origin),undefined);
});
test('volatile continuations bind API origin, action purpose and expiry without storing a proof in their route',()=>{
  let now=1000;const links=createAccountMailLinks(()=>now),retained=links.retain(token,'password_reset',origin,randomUUID);
  assert.ok(!retained.href.includes(token));assert.equal(links.read(retained.id,'password_reset',origin),token);
  assert.equal(links.read(retained.id,'email_verification',origin),null);assert.equal(links.read(retained.id,'password_reset','https://other.test'),null);
  now+=30*60_000;assert.equal(links.read(retained.id,'password_reset',origin),null);
  assert.equal(createAccountMailLinks(()=>now).read(retained.id,'password_reset',origin),null,'cold/reloaded process cannot reconstruct proof');
});
test('actual native entry captures an HTTPS or custom-scheme fragment before routing and strips malformed proofs',()=>{
  let next=0;const ids=[randomUUID(),randomUUID()];
  const exports=load('app/+native-intent.tsx',{'../src/auth/account-mail-link':{accountMailNativeHref},'../src/lib/api':{getApiOrigin:()=>origin},'expo-crypto':{randomUUID:()=>ids[next++]},'../src/auth/google-native-flow':{googleNativeReturns:{redirect:(path:string)=>path}},'../src/auth/visit-join-continuation':{visitJoinContinuations:{}},'../src/auth/visit-join-policy':{visitJoinNativeEntry:()=>undefined}});
  const redirect=exports.redirectSystemPath as (input:{path:string;initial:boolean})=>string;
  for(const path of [`${origin}/reset-password#token=${token}`,`thatcampus://account/security#token=${token}`]){
    const href=redirect({path,initial:true});assert.match(href,/\?continue=/);assert.ok(!href.includes(token));
    const id=new URL(href,origin).searchParams.get('continue');assert.equal(accountMailLinks.read(id,path.includes('reset-password')?'password_reset':'email_verification',origin),token);
  }
  assert.equal(redirect({path:`${origin}/reset-password#token=short`,initial:true}),'/login?account_link=invalid');
  assert.equal(redirect({path:'/areas',initial:false}),'/areas');
});

type ResetProps = { resetToken?: string; resetContinuation?: string };
type MountedEntry = {
  document: Document;
  resetProps: ResetProps[];
  navigations: string[];
  routeParamReplacements: Array<Record<string, unknown>>;
  rerender(): Promise<void>;
  setOrigin(value: string): void;
  status(value: string): void;
};
async function mounted(url:string,kind:'verify'|'reset',work:(h:MountedEntry)=>Promise<void>){
  const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>',{url});
  const previous={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  let apiOrigin=origin,status='anonymous';
  const resetProps: ResetProps[] = [], navigations: string[] = [], routeParamReplacements: MountedEntry['routeParamReplacements'] = [];
  const routeNavigation = { replaceParams: (params: Record<string, unknown>) => routeParamReplacements.push({ ...params }) };
  const params = () => {
    const href = new URL(dom.window.location.href), out: Record<string, unknown> = {};
    for (const key of href.searchParams.keys()) {
      const values = href.searchParams.getAll(key);
      out[key] = values.length === 1 ? values[0] : values;
    }
    if (href.hash) out['#'] = href.hash.slice(1);
    return out;
  };
  const hook = load('src/auth/use-account-mail-entry.ts', {
    react: React,
    'expo-router': { useNavigation: () => routeNavigation, useLocalSearchParams: params },
    'expo-crypto': { randomUUID },
    '../lib/api': { getApiOrigin: () => apiOrigin },
    './account-mail-link': { accountMailLinkInput, accountMailLinks },
  }, dom.window).useAccountMailEntry;
  const Box = ({ children }: React.PropsWithChildren) => React.createElement('div', null, children);
  const components = {
    Page: Box,
    Loading: () => React.createElement('p', null, 'Opening'),
    Empty: ({ title }: { title: string }) => React.createElement('p', null, title),
    Button: ({ title, onPress }: { title: string; onPress(): void }) => React.createElement('button', { onClick: onPress }, title),
  };
  function LoginScreen({ resetToken, resetContinuation }: ResetProps) {
    resetProps.push({ resetToken, resetContinuation });
    return React.createElement('p', null, 'Choose a new password');
  }
  const router = { replace: (href: string) => navigations.push(href) };
  const Screen=(kind==='verify'?load('src/auth/AccountSecurityEntryScreen.tsx', {
      'react/jsx-runtime': require('react/jsx-runtime'),
      'expo-router': {
        useLocalSearchParams: params,
        useRouter: () => router,
        Redirect: ({ href }: { href: string }) => React.createElement('a', { href }, 'continue'),
      },
      './SessionProvider': { useSession: () => ({ status }) },
      './account-recovery': { accountSecurityEntryHref },
      './use-account-mail-entry': { useAccountMailEntry: hook },
      '../ui/components': components,
    }).AccountSecurityEntryScreen
    :load('app/reset-password.tsx', {
      'react/jsx-runtime': require('react/jsx-runtime'),
      'expo-router': { useLocalSearchParams: params, useRouter: () => router },
      '../src/auth/use-account-mail-entry': { useAccountMailEntry: hook },
      '../src/ui/components': components,
      '../src/auth/LoginScreen': { LoginScreen },
    }).default) as React.ComponentType;
  const {createRoot}=require('react-dom/client'),root=createRoot(dom.window.document.getElementById('root'));
  try{await act(async()=>root.render(React.createElement(Screen)));await work({document:dom.window.document,resetProps,navigations,routeParamReplacements,rerender:async()=>{await act(async()=>root.render(React.createElement(Screen)));},setOrigin:value=>{apiOrigin=value;},status:value=>{status=value;}});}
  finally{await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,previous);}
}
test('mounted browser verification captures and scrubs a proof before anonymous login then uses the same authenticated owner',async()=>{
  await mounted(`${origin}/account/security#token=${token}`,'verify',async h=>{
    assert.equal(globalThis.window.location.hash,'');assert.ok(!globalThis.window.location.href.includes(token));
    const continuation = new URL(globalThis.window.location.href).searchParams.get('continue');
    assert.ok(continuation);
    assert.deepEqual(h.routeParamReplacements, [{ continue: continuation }]);
    const first=h.document.querySelector('a')!.getAttribute('href')!;assert.ok(first.startsWith('/login?next='));assert.ok(!first.includes(token));assert.match(decodeURIComponent(first),/more\/account\/security\?continue=/);
    assert.equal(globalThis.window.localStorage.length,0);assert.equal(globalThis.window.sessionStorage.length,0);
    h.status('authenticated');await h.rerender();assert.match(h.document.querySelector('a')!.getAttribute('href')!,/^\/more\/account\/security\?continue=/);
    h.setOrigin('https://other.test');await h.rerender();assert.match(h.document.body.textContent??'',/verification link is incomplete/);
    const recover = [...h.document.querySelectorAll('button')].find(button => button.textContent === 'Go to Account security');
    assert.ok(recover);
    await act(async () => recover.click());
    assert.deepEqual(h.navigations, ['/more/account/security']);
  });
});
test('mounted reset hands a hidden proof and its volatile continuation to the password form', async () => {
  for (const suffix of [`#token=${token}`, `?token=${token}`]) await mounted(`${origin}/reset-password${suffix}`, 'reset', async h => {
    const url = new URL(globalThis.window.location.href);
    const continuation = url.searchParams.get('continue');
    assert.ok(continuation);
    assert.deepEqual(h.resetProps.at(-1), { resetToken: token, resetContinuation: continuation });
    assert.match(h.document.body.textContent ?? '', /Choose a new password/);
    assert.ok(!h.document.body.innerHTML.includes(token));
    assert.ok(!url.href.includes(token));
    assert.deepEqual(h.routeParamReplacements, [{ continue: continuation }]);
    assert.equal(accountMailLinks.read(continuation, 'password_reset', origin), token);
  });
});

test('mounted reset sends missing or unusable links to recovery without opening the password form', async () => {
  for (const suffix of ['', `?continue=${randomUUID()}`, `?token=${token}&token=${token}`]) await mounted(`${origin}/reset-password${suffix}`, 'reset', async h => {
    assert.deepEqual(h.resetProps, []);
    assert.match(h.document.body.textContent ?? '', /original reset email/i);
    assert.ok(!globalThis.window.location.href.includes(token));
    if (suffix.includes('token=')) assert.deepEqual(h.routeParamReplacements, [{}]);
    const request = [...h.document.querySelectorAll('button')].find(button => button.textContent === 'Request a new reset link');
    assert.ok(request);
    await act(async () => request.click());
    assert.deepEqual(h.navigations, ['/forgot-password']);
  });
});
