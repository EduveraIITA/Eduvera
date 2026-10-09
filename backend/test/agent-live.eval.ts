/** Real-model multi-turn smoke evaluation. Isolated database ONLY; no fixture resets.
 * Default: reads and previews, dismiss all actions. AGENT_EVAL_CONFIRM=true also
 * confirms one explicitly test-authored observation for Ananya in the test DB.
 * Run after build: DATABASE_URL=... node --import tsx test/agent-live.eval.ts
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const databaseUrl=requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
const pool=new Pool({connectionString:databaseUrl,max:2});
const port=Number(process.env.AGENT_EVAL_PORT??8139);
const base=`http://127.0.0.1:${port}`;
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const cookies=new Map<string,string>();
async function request(path:string,body?:unknown):Promise<any>{
  const result=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; '),'X-CSRFToken':cookies.get('csrftoken')??''},...(body?{body:JSON.stringify(body)}:{})});
  for(const value of result.headers.getSetCookie()){const pair=value.split(';')[0]!;const at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
  const data=await result.json();if(!result.ok)throw new Error(`Test API rejected ${path.split('?')[0]} (${result.status})`);return data;
}
async function turn(thread:string,question:string){
  const started=Date.now();const sent=await request(`/api/v1/agent/threads/${thread}/messages`,{question,client_id:randomUUID()});
  console.log(JSON.stringify({stage:'started',question}));
  for(let i=0;i<250;i++){
    const detail=await request(`/api/v1/agent/threads/${thread}`);
    const run=detail.runs.find((item:any)=>item.id===sent.run_id);
    if(run&&run.status!=='running'){
      console.log(JSON.stringify({stage:'completed',seconds:Math.round((Date.now()-started)/100)/10,status:run.status,tools:run.evidence.map((item:any)=>item.capability),action:run.action?.capability??null}));
      return run;
    }
    await pause(1000);
  }
  throw new Error('Real-model run timed out');
}
const api=spawn(process.execPath,['dist/main.js'],{env:{...process.env,DATABASE_URL:databaseUrl,EVENT_DATABASE_URL:databaseUrl,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',COOKIE_SECRET:'isolated-evaluation-cookie-secret-at-least-32',DEMO_MODE:'true',AGENT_PROVIDER:'ollama',AGENT_MODEL:process.env.AGENT_MODEL??'qwen3:8b',AGENT_BASE_URL:'http://127.0.0.1:11434',LOG_LEVEL:'silent',SPA_DIST_DIR:'no-spa'},stdio:'ignore'});
try{
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/readyz')).ok){ready=true;break;}}catch{/*starting*/}await pause(100);}
  assert(ready,'Isolated API did not start');
  await pool.query('DELETE FROM api_rate_limit_buckets');
  await request('/api/v1/auth/csrf/');await request('/api/v1/auth/demo-session/',{role:'admin'});
  const thread=(await request('/api/v1/agent/threads',{portal:'principal'})).id;
  const lookup=await turn(thread,'Check about aarav sharma');
  assert.equal(lookup.status,'completed');assert(lookup.evidence.some((item:any)=>['find_students','student_attendance'].includes(item.capability)));
  const attendance=await turn(thread,'Can you mark his presence today');
  assert.equal(attendance.status,'confirmation');assert.equal(attendance.action.capability,'record_student_attendance');
  assert.equal(attendance.action.preview.student,'Aarav Sharma');assert.equal(attendance.action.preview.status,'present');
  await request(`/api/v1/agent/threads/${thread}/actions/${attendance.action.id}`,{decision:'reject'});
  const other=(await request('/api/v1/agent/threads',{portal:'principal'})).id;
  const ambiguous=await turn(other,'Mark Sharma present today');
  assert.equal(ambiguous.action,null);assert(ambiguous.evidence.some((item:any)=>item.capability==='student_attendance'));
  assert(/multiple|several|which|choose|more than one/i.test(ambiguous.answer),'Expected an ambiguity question, not a missing-record excuse');
  if(process.env.AGENT_EVAL_CONFIRM==='true'){
    const before=await request('/api/v1/teacher/attendance/student?student=Ananya%20Iyer');
    const status=before.selected.student.status==='present'?'absent':'present';
    const isolated=(await request('/api/v1/agent/threads',{portal:'principal'})).id;
    if(before.selected.student.status){
      const clarification=await turn(isolated,`Mark Ananya Iyer ${status} today`);
      assert.equal(clarification.action,null,'A correction must ask for the user’s reason');
      assert(/reason|why/i.test(clarification.answer),'Expected a correction-reason question');
    }
    const correctionReason='I entered the wrong status in this isolated evaluation.';
    const proposal=await turn(isolated,before.selected.student.status?correctionReason:`Mark Ananya Iyer ${status} today. Correction reason: ${correctionReason}`);
    assert.equal(proposal.status,'confirmation');assert.equal(proposal.action.capability,'record_student_attendance');
    assert.equal(proposal.action.preview.reason,correctionReason);
    const result=await request(`/api/v1/agent/threads/${isolated}/actions/${proposal.action.id}`,{decision:'confirm'});
    assert.equal(result.status,'succeeded');
    const after=await request('/api/v1/teacher/attendance/student?student=Ananya%20Iyer');
    assert.equal(after.selected.student.status,status);assert.equal(after.selected.register.state,'draft');
    console.log(JSON.stringify({stage:'verified',workflow:'single-student confirmed write',thread:isolated,href:result.receipt.href}));
  }
  console.log(JSON.stringify({passed:true,provider:'ollama',model:process.env.AGENT_MODEL??'qwen3:8b',database:'isolated test database'}));
} finally {api.kill('SIGTERM');await pool.end();}
