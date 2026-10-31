import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { requireIsolatedTestDatabaseUrl, requireManagedTestApiBaseUrl } from './test-database.js';

/** Transport only: each caller retains its own actors, records and assertions. */
export class TestApiSession {
  private readonly cookies = new Map<string,string>();
  constructor(private readonly baseUrl:string) {}

  clear() { this.cookies.clear(); }

  async request(path:string,body?:unknown,method=body===undefined?'GET':'POST',csrf=true) {
    const url=new URL(path,this.baseUrl);
    if(url.origin!==new URL(this.baseUrl).origin)throw new Error('Test sessions cannot send cookies to another API origin.');
    const headers:Record<string,string>={Cookie:[...this.cookies].map(([key,value])=>`${key}=${value}`).join('; ')};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(csrf&&this.cookies.has('csrftoken'))headers['X-CSRFToken']=this.cookies.get('csrftoken')!;
    const response=await fetch(url,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
    for(const cookie of response.headers.getSetCookie()) {
      const pair=cookie.split(';')[0]!,separator=pair.indexOf('=');
      if(separator>0)this.cookies.set(pair.slice(0,separator),pair.slice(separator+1));
    }
    const data:any=response.status===204?null:await response.json();
    return {status:response.status,data};
  }
}

export interface ManagedTestApi { stop():Promise<void> }

export function managedTestApiEnvironment(databaseUrl:string,inherited:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  const isolated=requireIsolatedTestDatabaseUrl(databaseUrl);
  return {...inherited,DATABASE_URL:isolated,EVENT_DATABASE_URL:isolated,MIGRATION_DATABASE_URL:isolated,
    // These transport suites do not provision a Simulation store. Do not
    // inherit a product store or violate its separate-database invariant.
    CAMPUS_SIMULATION_DATABASE_URL:undefined,
    AI_PROVIDER:'mock',AGENT_PROVIDER:'mock',TELEGRAM_BOT_ENABLED:'false',INVITATION_EMAIL_ENABLED:'false',RAZORPAY_ENABLED:'false'};
}

async function stopChild(child:ChildProcess) {
  if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
  const exited=new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.once('error',()=>resolve());});
  child.kill('SIGTERM');
  const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
  try { await exited; } finally { clearTimeout(timer); }
}

export async function startManagedTestApi(input:{port:number;databaseUrl:string;cookieSecret:string;rateLimitStore:'memory'|'postgres'}):Promise<ManagedTestApi> {
  const databaseUrl=requireIsolatedTestDatabaseUrl(input.databaseUrl);
  if(process.env.TEST_DATABASE_ISOLATED!=='true')throw new Error('Managed API tests require TEST_DATABASE_ISOLATED=true.');
  if(!Number.isInteger(input.port)||input.port<=8000||input.port>65535)throw new Error('Managed API tests require a dedicated test port above 8000.');
  const base=requireManagedTestApiBaseUrl(process.env.API_BASE_URL,`http://127.0.0.1:${input.port}`);
  // Do not mistake another running API for the child this fixture owns.
  await new Promise<void>((resolve,reject)=>{
    const probe=createServer();probe.once('error',reject);
    probe.listen({host:'127.0.0.1',port:input.port,exclusive:true},()=>probe.close(error=>error?reject(error):resolve()));
  });
  const child=spawn(process.execPath,['dist/main.js'],{env:{...managedTestApiEnvironment(databaseUrl),
    HOST:'127.0.0.1',PORT:String(input.port),
    COOKIE_SECRET:input.cookieSecret,NODE_ENV:'test',RATE_LIMIT_STORE:input.rateLimitStore,LOG_LEVEL:'silent'},stdio:['ignore','ignore','inherit']});
  let failure:Error|undefined;
  child.once('error',error=>{failure=error;});
  try {
    const deadline=Date.now()+8000;
    while(Date.now()<deadline) {
      if(failure)throw failure;
      if(child.exitCode!==null||child.signalCode!==null)throw new Error('Managed test API exited before readiness.');
      try { if((await fetch(`${base}/healthz`,{signal:AbortSignal.timeout(500)})).ok)return {stop:()=>stopChild(child)}; }
      catch { /* startup only; child failure is checked before the next poll */ }
      await delay(50);
    }
    throw new Error('Managed test API did not become ready within 8 seconds.');
  } catch(error) { await stopChild(child);throw error; }
}
