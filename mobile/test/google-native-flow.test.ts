import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { base64UrlBytes, googleCredential, googleWebConfiguration, GOOGLE_NATIVE_CALLBACK } from '../src/auth/google-auth-policy';
import { checkedGoogleNativeExchange, createGoogleNativeReturnRegistry, googleNativeCallback, googleNativeConfiguration, runGoogleNativeFlow } from '../src/auth/google-native-flow';

const state = 'S'.repeat(43),verifier = 'V'.repeat(43),challenge = createHash('sha256').update(verifier).digest('base64url'),code = 'v1.'+'C'.repeat(80),now = Date.parse('2026-10-29T10:00:00Z');
const callback = `${GOOGLE_NATIVE_CALLBACK}?code=${code}&state=${state}`;
function fixture(options: { config?: unknown; start?: unknown; returned?: { type: string; url?: string }; pause?: string; response?: unknown } = {}) {
  const calls: { path: string; body?: unknown }[] = [],opened: { url: string; callback: string }[] = [];
  let current = true,entropyCalls = 0; const returns = createGoogleNativeReturnRegistry();
  const check = () => { if (!current) throw new Error('context changed'); };
  const promise = runGoogleNativeFlow({ assertCurrent: check,returns,now: () => now,
    async request(path,body) {
      calls.push({ path,body }); if (options.pause === path) current = false;
      if (path.endsWith('/config/')) return options.config ?? { enabled: true,authorization_origin: 'https://campus.example' };
      if (path.endsWith('/start/')) return options.start ?? { authorization_url: 'https://campus.example/api/v1/auth/native/google/authorize/?request=v1.opaque',expires_at: new Date(now+600000).toISOString() };
      return options.response ?? { mfa_required: true,challenge_token: 'M'.repeat(43) };
    },
    async entropy() { entropyCalls++; if (options.pause === 'entropy') current = false; return { state,verifier,challenge }; },
    async open(url,callbackUrl) { opened.push({ url,callback: callbackUrl }); assert.equal(returns.redirect(callback,false,now),''); if (options.pause === 'browser') current = false; return options.returned ?? { type: 'success',url: callback }; },
  });
  return { promise,calls,opened,returns,entropyCalls: () => entropyCalls };
}
test('native Google uses fresh state/S256 and exchanges only the exact returned code in POST JSON',async () => {
  const f = fixture(); const result = await f.promise;
  assert.equal(result.kind,'response'); assert.deepEqual(f.calls.map(row => row.path),['/api/v1/auth/native/google/config/','/api/v1/auth/native/google/start/','/api/v1/auth/native/google/exchange/']);
  assert.deepEqual(f.calls[1]!.body,{ redirect_uri: GOOGLE_NATIVE_CALLBACK,state,code_challenge: challenge,code_challenge_method: 'S256' });
  assert.deepEqual(f.calls[2]!.body,{ code,code_verifier: verifier,redirect_uri: GOOGLE_NATIVE_CALLBACK });
  assert.equal(f.opened[0]!.callback,GOOGLE_NATIVE_CALLBACK); assert.ok(!f.opened[0]!.url.includes(verifier)); assert.ok(!f.opened[0]!.url.includes(code));
  assert.equal(f.returns.redirect(callback,false,now),'/login?google_return=expired','the verifier/return registration is not reconstructed after completion');
});
for (const type of ['cancel','dismiss']) test(`native Google ${type} never exchanges or installs a session`,async () => {
  const f = fixture({ returned: { type } }); assert.deepEqual(await f.promise,{ kind: 'cancelled' }); assert.equal(f.calls.length,2); assert.equal(f.returns.redirect(callback,false,now),'/login?google_return=expired');
});
test('unconfigured native Google stays unavailable without entropy, browser or POST',async () => {
  const f = fixture({ config: { enabled: false } }); await assert.rejects(f.promise,/not configured/); assert.equal(f.entropyCalls(),0); assert.equal(f.opened.length,0); assert.equal(f.calls.length,1);
});
for (const pause of ['/api/v1/auth/native/google/config/','entropy','/api/v1/auth/native/google/start/','browser','/api/v1/auth/native/google/exchange/']) test(`context change after ${pause} prevents subsequent I/O or result installation`,async () => {
  const f = fixture({ pause }); await assert.rejects(f.promise,/context changed/);
  const expected = pause.includes('config') || pause === 'entropy' ? 1 : pause.includes('start') || pause === 'browser' ? 2 : 3;
  assert.equal(f.calls.length,expected); assert.equal(f.returns.redirect(callback,false,now),'/login?google_return=expired');
});
for (const url of [callback.replace(state,'F'.repeat(43)),callback+'&access_token=secret',callback+'&state='+state,callback+'#private',callback.replace('thatcampus:','https:'),callback.replace('/google?','/google/other?'),callback.replace('auth/','wrong/'),callback.replace(`code=${code}`,`error=access_denied`)]) test('foreign or malformed Google return fails closed without exchange: '+url.slice(0,65),async () => {
  const f = fixture({ returned: { type: 'success',url } }); await assert.rejects(f.promise,/could not be confirmed/); assert.equal(f.calls.length,2);
});
for (const url of ['https://foreign.example/api/v1/auth/native/google/authorize/?request=v1.x','http://campus.example/api/v1/auth/native/google/authorize/?request=v1.x','https://campus.example/other?request=v1.x','https://campus.example/api/v1/auth/native/google/authorize/?request=x&request=y','https://campus.example/api/v1/auth/native/google/authorize/?request=x&next=https://evil.test']) test('browser cannot open an unadvertised or altered authorization target: '+url,async () => {
  const f = fixture({ start: { authorization_url: url,expires_at: new Date(now+600000).toISOString() } }); await assert.rejects(f.promise,/could not be confirmed/); assert.equal(f.opened.length,0);
});
test('expired start and unsupported browser result never exchange',async () => {
  const expired = fixture({ start: { authorization_url: 'https://campus.example/api/v1/auth/native/google/authorize/?request=x',expires_at: new Date(now).toISOString() } }); await assert.rejects(expired.promise,/could not be confirmed/); assert.equal(expired.opened.length,0);
  const locked = fixture({ returned: { type: 'locked' } }); await assert.rejects(locked.promise,/could not be confirmed/); assert.equal(locked.calls.length,2);
});
test('native intent ignores only the exact current attempt; cold/foreign returns strip private parameters',() => {
  const registry = createGoogleNativeReturnRegistry(); let current = true;
  const stop = registry.begin(state,() => { if (!current) throw new Error('changed'); },now+1000);
  assert.equal(registry.redirect('thatcampus://areas/people?person_id=one',false,now),'thatcampus://areas/people?person_id=one');
  assert.equal(registry.redirect(callback,false,now),'');
  assert.equal(registry.redirect(callback,true,now),'/login?google_return=expired');
  assert.equal(registry.redirect(callback.replace(state,'F'.repeat(43)),false,now),'/login?google_return=expired');
  assert.equal(registry.redirect(callback,false,now+1000),'/login?google_return=expired');
  current = false; assert.equal(registry.redirect(callback,false,now),'/login?google_return=expired');
  current = true; stop(); assert.equal(registry.redirect(callback,false,now),'/login?google_return=expired');
});
test('relative, encoded and malformed callback-like native intents always scrub grants instead of reaching router history',()=>{
  const registry=createGoogleNativeReturnRegistry();registry.begin(state,()=>{},now+1000);
  for(const path of [
    '/auth/google?code=synthetic&state=synthetic','auth/google?code=synthetic&state=synthetic',
    'thatcampus://auth/%67oogle?code=synthetic&state=synthetic','/auth/%2567oogle?code=synthetic&state=synthetic',
    '/auth/google%3fcode=synthetic%26state=synthetic','thatcampus://auth/google%253fcode=synthetic',
    '/google?code=synthetic&state=synthetic','thatcampus://auth:bad/google?code=synthetic&state=synthetic',
    'thatcampus:///auth/google?code=synthetic&state=synthetic','thatcampus://auth/google/other?code=synthetic&state=synthetic',
  ]) assert.equal(registry.redirect(path,false,now),'/login?google_return=expired',path);
  assert.equal(registry.redirect('/areas/people?search=google',false,now),'/areas/people?search=google');
  assert.equal(registry.redirect('https://example.test/articles/google?code=public',false,now),'https://example.test/articles/google?code=public');
  assert.throws(()=>googleNativeCallback(callback.replace('/google?','/%67oogle?'),state));
  assert.equal(registry.redirect(callback,false,now),'','only the exact absolute active callback can suppress the router');
});
test('Google config and proof validation never fabricate enabled support',() => {
  assert.deepEqual(googleWebConfiguration({ enabled: false }),{ enabled: false });
  assert.deepEqual(googleWebConfiguration({ enabled: true,client_id: '123-test.apps.googleusercontent.com',nonce: state }),{ enabled: true,clientId: '123-test.apps.googleusercontent.com',nonce: state });
  for (const value of [{ enabled: true },{ enabled: true,client_id: 'evil.test',nonce: state },{ enabled: true,client_id: '123.apps.googleusercontent.com',nonce: 'short' }]) assert.throws(() => googleWebConfiguration(value));
  for (const value of [{ enabled: true },{ enabled: true,authorization_origin: 'http://campus.example' },{ enabled: true,authorization_origin: 'https://campus.example/path' }]) assert.throws(() => googleNativeConfiguration(value));
  for (const value of [undefined,'',' ', 'x'.repeat(16385)]) assert.throws(() => googleCredential(value));
  assert.equal(googleCredential('exact.jwt.proof'),'exact.jwt.proof');
  assert.throws(() => googleNativeCallback(callback,'short'));
});
test('PKCE encoding agrees with base64url for cryptographic bytes and RFC7636 S256 vector',() => {
  for (let size=0;size<70;size++) { const bytes=Uint8Array.from({ length: size },(_,index) => (index*101+size)%256); assert.equal(base64UrlBytes(bytes),Buffer.from(bytes).toString('base64url')); }
  const digest=createHash('sha256').update('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk').digest(); assert.equal(base64UrlBytes(digest),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('only an exact native Live session or an isolated MFA challenge can be installed',() => {
  const wire={ user:{ id:'actor-1' },execution_environment:{ mode:'live',institution_id:'campus-1' },access_token:'tc_native_'+'A'.repeat(43),expires_at:new Date(now+100000).toISOString(),token_type:'Bearer' };
  const result=checkedGoogleNativeExchange(wire,now);assert.equal(result.kind,'session');
  assert.deepEqual(checkedGoogleNativeExchange({ mfa_required:true,challenge_token:'M'.repeat(43) },now),{ kind:'mfa',challenge:'M'.repeat(43) });
  for(const altered of [null,{}, {...wire,execution_environment:{mode:'simulation',namespace_id:'run'}},{...wire,token_type:'cookie'}, {...wire,access_token:'cookie-value'}, {...wire,public_demo:true},{...wire,expires_at:new Date(now).toISOString()},{...wire,user:{id:''}},{...wire,mfa_required:true,challenge_token:'M'.repeat(43)},{mfa_required:true,challenge_token:'short'}]) assert.throws(()=>checkedGoogleNativeExchange(altered,now));
});
test('a lost exchange is not replayed and no return registration survives it',async()=>{
  const calls:string[]=[],returns=createGoogleNativeReturnRegistry();
  await assert.rejects(runGoogleNativeFlow({assertCurrent(){},returns,now:()=>now,entropy:async()=>({state,verifier,challenge}),open:async()=>({type:'success',url:callback}),request:async(path)=>{calls.push(path);if(path.endsWith('/config/'))return{enabled:true,authorization_origin:'https://campus.example'};if(path.endsWith('/start/'))return{authorization_url:'https://campus.example/api/v1/auth/native/google/authorize/?request=opaque',expires_at:new Date(now+10000).toISOString()};throw new TypeError('lost response');}}),/lost response/);
  assert.equal(calls.filter(path=>path.endsWith('/exchange/')).length,1);assert.equal(returns.redirect(callback,false,now),'/login?google_return=expired');
});
