import {afterEach,expect,it,vi} from 'vitest';
import {apiFetch} from './api';
afterEach(()=>vi.unstubAllGlobals());
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
