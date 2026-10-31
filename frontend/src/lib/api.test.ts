import {afterEach,expect,it,vi} from 'vitest';
import {apiBlob,apiFetch} from './api';
import {blockExecutionRequests,confirmExecutionRequestScope,EXECUTION_ENVIRONMENT_VERIFY_EVENT} from './executionRequestScope';
afterEach(()=>{confirmExecutionRequestScope(null);vi.unstubAllGlobals();});
it('never reuses browser HTTP cache across accounts or execution environments',async()=>{
  const fetch = vi.fn().mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json'}}));
  vi.stubGlobal('fetch',fetch);
  await apiFetch('/api/v1/workspace',{cache:'force-cache'});
  expect(fetch).toHaveBeenCalledWith('/api/v1/workspace',expect.objectContaining({
    cache:'no-store',credentials:'same-origin',
  }));
});
it.each([200,502,503])('rejects HTML proxy responses at status %s without displaying HTML',async status=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<!DOCTYPE html><html>ngrok error</html>',{status,headers:{'content-type':'text/html'}})));
  await expect(apiFetch('/api/v1/day-plans/test/discard',{method:'POST'})).rejects.toThrow('could not confirm whether the action completed');
});
it('detects HTML with an incorrect content type',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>',{status:502})));
  await expect(apiFetch('/api/test')).rejects.toThrow('server connection');
});
it('preserves domain validation messages and successful JSON',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({detail:'Reload this draft.'}),{status:409,headers:{'content-type':'application/json'}})).mockResolvedValueOnce(new Response(JSON.stringify({revision:3}),{headers:{'content-type':'application/json'}})));
  await expect(apiFetch('/api/test')).rejects.toThrow('Reload this draft.');
  await expect(apiFetch('/api/test')).resolves.toEqual({revision:3});
});
it('rejects malformed JSON without exposing parsing output',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{bad',{headers:{'content-type':'application/json'}})));
  await expect(apiFetch('/api/test')).rejects.toThrow('unreadable response');
});
it('sends the confirmed namespace and blocks domain requests during verification while allowing session confirmation',async()=>{
  const fetch=vi.fn<typeof globalThis.fetch>().mockImplementation(()=>Promise.resolve(new Response('{}',{headers:{'content-type':'application/json'}})));vi.stubGlobal('fetch',fetch);
  confirmExecutionRequestScope('live:school-a');
  await apiFetch('/api/v1/schools/school-a/fees/');
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('X-ThatCampus-Execution-Environment')).toBe('live:school-a');
  blockExecutionRequests();
  await expect(apiFetch('/api/v1/schools/school-a/fees/',{method:'POST'})).rejects.toThrow('Confirm the active campus');
  await apiFetch('/api/v1/auth/execution-environment/');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('rejects a late old-world response even when fetch ignores cancellation',async()=>{
  let resolve!:(response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>new Promise<Response>(done=>{resolve=done;})));
  confirmExecutionRequestScope('live:school-a');
  const pending=apiFetch('/api/v1/workspace');
  blockExecutionRequests();confirmExecutionRequestScope('scenario:scenario-a:run:run-a');
  resolve(new Response('{"campus":"old-live"}',{headers:{'content-type':'application/json'}}));
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
});
it('requests authoritative verification when the server rejects a stale namespace',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:'execution_environment_changed',detail:'Confirm this session.'}}),{status:409,headers:{'content-type':'application/json'}})));
  const verify=vi.fn();window.addEventListener(EXECUTION_ENVIRONMENT_VERIFY_EVENT,verify,{once:true});
  confirmExecutionRequestScope('live:school-a');
  await expect(apiFetch('/api/v1/workspace')).rejects.toThrow('Confirm this session.');
  expect(verify).toHaveBeenCalledOnce();
  await expect(apiFetch('/api/v1/workspace')).rejects.toThrow('Confirm the active campus');
});
it('downloads private bytes only within the confirmed selected world',async()=>{
  const fetch=vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('photo-bytes',{headers:{'content-type':'image/png'}}));
  vi.stubGlobal('fetch',fetch);confirmExecutionRequestScope('scenario:a:run:b');
  expect(await apiBlob('/api/v1/schools/a/facilities/repairs/b/photos/c')).toMatchObject({size:11,type:'image/png'});
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('X-ThatCampus-Execution-Environment')).toBe('scenario:a:run:b');
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({cache:'no-store',credentials:'same-origin'});
});
it('preserves denied private-download errors and rejects HTML and JSON success impostors',async()=>{
  vi.stubGlobal('fetch',vi.fn()
    .mockResolvedValueOnce(new Response('{"detail":"This photo is unavailable."}',{status:403,headers:{'content-type':'application/json'}}))
    .mockResolvedValueOnce(new Response('<html>proxy</html>',{headers:{'content-type':'image/png'}}))
    .mockResolvedValueOnce(new Response('{}',{headers:{'content-type':'application/json'}})));
  await expect(apiBlob('/api/photo')).rejects.toThrow('This photo is unavailable.');
  await expect(apiBlob('/api/photo')).rejects.toThrow('connection was interrupted');
  await expect(apiBlob('/api/photo')).rejects.toThrow('did not return');
});
it('discards an old-world private download even when fetch ignores abort',async()=>{
  let resolve!:(response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>new Promise<Response>(done=>{resolve=done;})));
  confirmExecutionRequestScope('live:school-a');const pending=apiBlob('/api/photo');
  blockExecutionRequests();confirmExecutionRequestScope('scenario:a:run:b');
  resolve(new Response('photo',{headers:{'content-type':'image/jpeg'}}));
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
});
