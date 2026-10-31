import { afterEach, expect, it, vi } from 'vitest';
import { TestApiSession, managedTestApiEnvironment, startManagedTestApi } from './http-api.test-support.js';
import { loadConfig } from '../src/config.js';

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

it('binds all API connections to the guarded test database without inheriting a Simulation store or outbound providers',()=>{
  const databaseUrl='postgresql://127.0.0.1:5432/transport_test';
  const env=managedTestApiEnvironment(databaseUrl,{
    DATABASE_URL:'postgresql://127.0.0.1/live',EVENT_DATABASE_URL:'postgresql://127.0.0.1/live',
    MIGRATION_DATABASE_URL:'postgresql://127.0.0.1/live',CAMPUS_SIMULATION_DATABASE_URL:'postgresql://127.0.0.1/simulation',
    COOKIE_SECRET:'fictional-cookie-secret-at-least-32-characters',NODE_ENV:'test',
    TELEGRAM_BOT_ENABLED:'true',INVITATION_EMAIL_ENABLED:'true',RAZORPAY_ENABLED:'true',
  });
  expect(env).toMatchObject({DATABASE_URL:databaseUrl,EVENT_DATABASE_URL:databaseUrl,MIGRATION_DATABASE_URL:databaseUrl,
    TELEGRAM_BOT_ENABLED:'false',INVITATION_EMAIL_ENABLED:'false',RAZORPAY_ENABLED:'false',AI_PROVIDER:'mock',AGENT_PROVIDER:'mock'});
  expect(env.CAMPUS_SIMULATION_DATABASE_URL).toBeUndefined();
  for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);
  expect(()=>loadConfig()).not.toThrow();
});

it('retains each actor cookie and CSRF token without sharing accounts, and can explicitly omit CSRF',async()=>{
  const fetchMock=vi.fn<typeof fetch>().mockImplementation(()=>Promise.resolve(new Response('{}')))
    .mockResolvedValueOnce(new Response('{}',{headers:{'Set-Cookie':'csrftoken=csrf-value; Path=/'}}))
    .mockResolvedValueOnce(new Response('{}',{headers:{'Set-Cookie':'session=token=with-padding; HttpOnly'}}));
  vi.stubGlobal('fetch',fetchMock);
  const first=new TestApiSession('http://127.0.0.1:8061/api/v1/'),second=new TestApiSession('http://127.0.0.1:8061/api/v1/');
  await first.request('auth/csrf/');await first.request('auth/login/',{password:'fictional'});await first.request('protected/',{},'POST',false);
  expect(fetchMock.mock.calls[1]![1]).toMatchObject({headers:{Cookie:'csrftoken=csrf-value','X-CSRFToken':'csrf-value'}});
  expect(fetchMock.mock.calls[2]![1]).toMatchObject({headers:{Cookie:'csrftoken=csrf-value; session=token=with-padding'}});
  expect((fetchMock.mock.calls[2]![1]!.headers as Record<string,string>)['X-CSRFToken']).toBeUndefined();
  await second.request('auth/me/');expect(fetchMock.mock.calls[3]![1]).toMatchObject({headers:{Cookie:''}});
  first.clear();await first.request('auth/me/');expect(fetchMock.mock.calls[4]![1]).toMatchObject({headers:{Cookie:''}});
});

it('preserves HTTP errors and204 without pretending that a failed request succeeded',async()=>{
  const fetchMock=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"error":"conflict"}',{status:409}))
    .mockResolvedValueOnce(new Response(null,{status:204}));vi.stubGlobal('fetch',fetchMock);
  const session=new TestApiSession('http://127.0.0.1:8023/api/v1/');
  expect(await session.request('conflict/',{})).toEqual({status:409,data:{error:'conflict'}});
  expect(await session.request('deleted/',undefined,'DELETE')).toEqual({status:204,data:null});
  await expect(session.request('https://example.test/stolen/')).rejects.toThrow('another API origin');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('rejects a shared database before starting a child API or touching a port',async()=>{
  await expect(startManagedTestApi({port:8061,databaseUrl:'postgresql://runner@127.0.0.1/thatcampus',
    cookieSecret:'fictional',rateLimitStore:'memory'})).rejects.toThrow('isolated database');
});
