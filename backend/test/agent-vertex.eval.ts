/** Paid, read-only model evaluation against disposable synthetic app data only. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import assert from 'node:assert/strict';
import {requireIsolatedTestDatabaseUrl} from './test-database.js';
const database=requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
if(process.env.AGENT_LIVE_EVAL!=='true')throw new Error('Explicit AGENT_LIVE_EVAL=true required for paid inference.');
const pool=new Pool({connectionString:database}),base='http://127.0.0.1:8139';
const api=spawn(process.execPath,['dist/main.js'],{env:{...process.env,DATABASE_URL:database,EVENT_DATABASE_URL:database,NODE_ENV:'test',PORT:'8139',HOST:'127.0.0.1',DEMO_MODE:'true',COOKIE_SECRET:'isolated-agent-vertex-eval-secret-min-32-chars',AGENT_PROVIDER:'vertex',AGENT_MODEL:'gemini-3.1-flash-lite',AGENT_GOOGLE_PROJECT:'eduera-511111',AGENT_GOOGLE_LOCATION:'global',AGENT_BASE_URL:'',AGENT_API_KEY:'',AGENT_ENABLED_UNTIL:'2026-11-08T00:00:00Z',AGENT_DAILY_BUDGET_MICROS:'1000000',AGENT_MONTHLY_BUDGET_MICROS:'1000000',AGENT_USER_HOURLY_LIMIT:'60',AGENT_USER_DAILY_LIMIT:'100',LOG_LEVEL:'silent',SPA_DIST_DIR:'none'},stdio:['ignore','ignore','pipe']});
let errors='';api.stderr?.on('data',chunk=>{errors+=chunk.toString();});
let staffGrantId:string|undefined;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const cookies=new Map<string,string>();
async function request(path:string,body?:unknown):Promise<any>{
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRFToken':cookies.get('csrftoken')??''},...(body?{body:JSON.stringify(body)}:{})});
  for(const value of response.headers.getSetCookie()){const [pair]=value.split(';'),i=pair!.indexOf('=');cookies.set(pair!.slice(0,i),pair!.slice(i+1));}
  const data=await response.json();assert(response.ok,`HTTP ${response.status}`);return data;
}
try {
  for(let i=0;i<100;i++){try{if((await fetch(base+'/readyz')).ok)break;}catch{ /* Wait for the disposable API to bind. */ }await sleep(100);}
  // This database is guarded as disposable by requireIsolatedTestDatabaseUrl.
  // Prior integration runs share its rate-limit table but are not model usage;
  // remove only those transient request buckets before the paid evaluation.
  await pool.query('DELETE FROM api_rate_limit_buckets');
  await request('/api/v1/auth/csrf/');await request('/api/v1/auth/demo-session/',{role:'admin'});
  assert.equal((await request('/api/v1/agent/status?portal=principal')).ready,true,'ADC is not ready');
  const thread=await request('/api/v1/agent/threads',{portal:'principal'});
  for(const question of [
    'Hi',
    'What is my name?',
    'Give me some analytics about Aarav Sharma. Show a bar chart of subject attendance.',
    'Compare his published marks average with Class 7A and the whole school in the same term. Show a chart and explain what is and is not known.',
    'Which attendance declines need a check-in, and which classes have upcoming cover gaps or deadline conflicts? Do not contact anyone.',
  ]) {
    const sent=await request(`/api/v1/agent/threads/${thread.id}/messages`,{question,client_id:randomUUID()});let run:any;
    for(let i=0;i<250;i++){const detail=await request(`/api/v1/agent/threads/${thread.id}`);run=detail.runs.find((r:any)=>r.id===sent.run_id);if(run?.status!=='running')break;await sleep(1000);}
    const diagnostics=(await pool.query("SELECT metadata FROM audit_events WHERE target_id=$1 AND action='agent.model.response_failed'",[sent.run_id])).rows;
    console.log(JSON.stringify({question,status:run?.status,answer:run?.answer,sources:run?.evidence?.map((s:any)=>({capability:s.capability,href:s.href,chart:s.chart?.kind})),diagnostics}));
    assert.equal(run?.status,'completed');assert.equal(run?.action,null);
    if(question==='Hi'){
      assert.match(run.answer,/\b(?:hello|hi|good morning|good afternoon|good evening)\b/i,'Opening reply should greet naturally');
      assert.match(run.answer,/\bMeera\b/i,'Opening reply should use the signed-in person\'s name');
      assert(!/(?:logged in|principal of|please state how|how may i assist|school operations today)/i.test(run.answer),'Opening reply must not narrate account state or use bureaucratic helpdesk wording');
      assert(run.answer.trim().split(/\s+/).length<=24,'Greeting should remain concise');
    }
    if(question==='What is my name?'){
      assert.match(run.answer,/\bMeera Kapoor\b/i,'Identity answer should use the live signed-in name');
      assert(!/(?:logged in|principal of|school operations)/i.test(run.answer),'Identity answer should be direct rather than narrating account state');
      assert(run.answer.trim().split(/\s+/).length<=18,'Identity answer should remain concise');
    }
    if(question.includes('analytics')){assert(run.evidence.some((s:any)=>s.capability==='principal_analytics'&&s.chart?.kind==='bar'));assert(run.evidence.some((s:any)=>s.href.includes('student_id=')));}
    if(question.startsWith('Compare'))assert(run.evidence.filter((s:any)=>s.capability==='principal_analytics').length>=3,'Learner/class/institute must each be sourced');
    if(question.startsWith('Which'))assert(run.evidence.some((s:any)=>s.capability==='principal_review'));
  }
  staffGrantId=(await pool.query(`INSERT INTO school_access_exceptions(
      school_id,user_id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on)
    SELECT membership.school_id,account.id,'ai.use','Temporary synthetic Vertex tone evaluation grant.',
      'migration_individual','assigned_resources',current_date,current_date+1,current_date
    FROM users account JOIN school_memberships membership ON membership.user_id=account.id
      AND membership.role='staff' AND membership.is_active
    WHERE account.username='kavita.staff' AND account.is_active
    ORDER BY membership.created_at LIMIT 1 RETURNING id`)).rows[0]?.id;
  assert(staffGrantId,'Synthetic staff persona is unavailable');
  cookies.clear();
  await request('/api/v1/auth/csrf/');await request('/api/v1/auth/demo-session/',{role:'staff'});
  const staffThread=await request('/api/v1/agent/threads',{portal:'teacher'});
  const staffSent=await request(`/api/v1/agent/threads/${staffThread.id}/messages`,{question:'Hi',client_id:randomUUID()});let staffRun:any;
  for(let i=0;i<250;i++){const detail=await request(`/api/v1/agent/threads/${staffThread.id}`);staffRun=detail.runs.find((r:any)=>r.id===staffSent.run_id);if(staffRun?.status!=='running')break;await sleep(1000);}
  console.log(JSON.stringify({question:'Hi',persona:'staff',status:staffRun?.status,answer:staffRun?.answer}));
  assert.equal(staffRun?.status,'completed');assert.equal(staffRun?.action,null);
  assert.match(staffRun.answer,/\bKavita\b/i,'Staff greeting should use the signed-in person\'s name');
  assert(!/(?:logged in|staff member|teacher at|please state how|school operations today)/i.test(staffRun.answer),'Staff greeting must not narrate account state');
  assert(staffRun.answer.trim().split(/\s+/).length<=24,'Staff greeting should remain concise');
  console.log({verified:true});
}finally {
  if(staffGrantId)await pool.query('DELETE FROM school_access_exceptions WHERE id=$1',[staffGrantId]).catch(()=>undefined);
  api.kill('SIGTERM');await pool.end();if(errors)console.log({serverErrors:errors.slice(-500)});
}
