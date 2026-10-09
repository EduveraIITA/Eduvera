/** Paid, read-only model evaluation against disposable synthetic app data only. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import assert from 'node:assert/strict';
import {requireIsolatedTestDatabaseUrl} from './test-database.js';
const database=requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
if(process.env.AGENT_LIVE_EVAL!=='true')throw new Error('Explicit AGENT_LIVE_EVAL=true required for paid inference.');
const pool=new Pool({connectionString:database}),base='http://127.0.0.1:8139';
const api=spawn(process.execPath,['dist/main.js'],{env:{...process.env,DATABASE_URL:database,EVENT_DATABASE_URL:database,NODE_ENV:'test',PORT:'8139',HOST:'127.0.0.1',DEMO_MODE:'true',COOKIE_SECRET:'isolated-agent-vertex-eval-secret-min-32-chars',AGENT_PROVIDER:'vertex',AGENT_MODEL:'gemini-3.1-flash-lite',AGENT_GOOGLE_PROJECT:'eduera-511111',AGENT_GOOGLE_LOCATION:'global',AGENT_BASE_URL:'',AGENT_API_KEY:'',AGENT_ENABLED_UNTIL:'2026-11-08T00:00:00Z',AGENT_DAILY_BUDGET_MICROS:'500000',AGENT_MONTHLY_BUDGET_MICROS:'1000000',AGENT_USER_HOURLY_LIMIT:'10',AGENT_USER_DAILY_LIMIT:'30',LOG_LEVEL:'silent',SPA_DIST_DIR:'none'},stdio:['ignore','ignore','pipe']});
let errors='';api.stderr?.on('data',chunk=>{errors+=chunk.toString();});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const cookies=new Map<string,string>();
async function request(path:string,body?:unknown):Promise<any>{
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRFToken':cookies.get('csrftoken')??''},...(body?{body:JSON.stringify(body)}:{})});
  for(const value of response.headers.getSetCookie()){const [pair]=value.split(';'),i=pair!.indexOf('=');cookies.set(pair!.slice(0,i),pair!.slice(i+1));}
  const data=await response.json();assert(response.ok,`HTTP ${response.status}`);return data;
}
try {
  for(let i=0;i<100;i++){try{if((await fetch(base+'/readyz')).ok)break;}catch{ /* Wait for the disposable API to bind. */ }await sleep(100);}
  await request('/api/v1/auth/csrf/');await request('/api/v1/auth/demo-session/',{role:'admin'});
  assert.equal((await request('/api/v1/agent/status?portal=principal')).ready,true,'ADC is not ready');
  const thread=await request('/api/v1/agent/threads',{portal:'principal'});
  for(const question of [
    'Hi',
    'Give me some analytics about Aarav Sharma. Show a bar chart of subject attendance.',
    'Compare his published marks average with Class 7A and the whole school in the same term. Show a chart and explain what is and is not known.',
    'Which attendance declines need a check-in, and which classes have upcoming cover gaps or deadline conflicts? Do not contact anyone.',
  ]) {
    const sent=await request(`/api/v1/agent/threads/${thread.id}/messages`,{question,client_id:randomUUID()});let run:any;
    for(let i=0;i<250;i++){const detail=await request(`/api/v1/agent/threads/${thread.id}`);run=detail.runs.find((r:any)=>r.id===sent.run_id);if(run?.status!=='running')break;await sleep(1000);}
    const diagnostics=(await pool.query("SELECT metadata FROM audit_events WHERE target_id=$1 AND action='agent.model.response_failed'",[sent.run_id])).rows;
    console.log(JSON.stringify({question,status:run?.status,answer:run?.answer,sources:run?.evidence?.map((s:any)=>({capability:s.capability,href:s.href,chart:s.chart?.kind})),diagnostics}));
    assert.equal(run?.status,'completed');assert.equal(run?.action,null);
    if(question.includes('analytics')){assert(run.evidence.some((s:any)=>s.capability==='principal_analytics'&&s.chart?.kind==='bar'));assert(run.evidence.some((s:any)=>s.href.includes('student_id=')));}
    if(question.startsWith('Compare'))assert(run.evidence.filter((s:any)=>s.capability==='principal_analytics').length>=3,'Learner/class/institute must each be sourced');
    if(question.startsWith('Which'))assert(run.evidence.some((s:any)=>s.capability==='principal_review'));
  }
  console.log({verified:true});
}finally {api.kill('SIGTERM');await pool.end();if(errors)console.log({serverErrors:errors.slice(-500)});}
