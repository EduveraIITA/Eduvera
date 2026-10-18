import {afterEach,expect,it,vi} from 'vitest';
import {apiFetch} from './api';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
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
it('ends a stalled read after 20 seconds with a non-retrying timeout error',async()=>{
  vi.useFakeTimers();
  vi.stubGlobal('fetch',vi.fn((_path:RequestInfo|URL,init?:RequestInit)=>new Promise((_resolve,reject)=>{
    init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
  })));
  const result=expect(apiFetch('/api/v1/screens/principal/home/')).rejects.toMatchObject({status:408,message:'The school service is taking too long to respond. Please try again.'});
  await vi.advanceTimersByTimeAsync(20_000);
  await result;
  expect(vi.getTimerCount()).toBe(0);
});
it('includes a stalled response body in the read deadline',async()=>{
  vi.useFakeTimers();
  vi.stubGlobal('fetch',vi.fn((_path:RequestInfo|URL,init?:RequestInit)=>Promise.resolve({
    text:()=>new Promise<string>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))),
  } as Response)));
  const result=expect(apiFetch('/api/test')).rejects.toMatchObject({status:408});
  await vi.advanceTimersByTimeAsync(20_000);
  await result;
});
it('preserves caller cancellation and removes the timeout after a successful read',async()=>{
  vi.useFakeTimers();
  const controller=new AbortController();
  vi.stubGlobal('fetch',vi.fn((_path:RequestInfo|URL,init?:RequestInit)=>new Promise((_resolve,reject)=>{
    init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
  })));
  const result=expect(apiFetch('/api/test',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  controller.abort();await result;
  expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json'}})));
  await apiFetch('/api/test');
  expect(vi.getTimerCount()).toBe(0);
});
it('does not apply the read timeout to long-running writes',async()=>{
  vi.useFakeTimers();
  let finish!:(value:Response)=>void;
  let signal!:AbortSignal;
  vi.stubGlobal('fetch',vi.fn((_path:RequestInfo|URL,init?:RequestInit)=>{signal=init!.signal!;return new Promise<Response>(resolve=>{finish=resolve;});}));
  const result=apiFetch('/api/upload',{method:'POST'});
  await vi.advanceTimersByTimeAsync(20_001);
  expect(signal.aborted).toBe(false);
  finish(new Response('{}',{headers:{'content-type':'application/json'}}));
  await result;
});
