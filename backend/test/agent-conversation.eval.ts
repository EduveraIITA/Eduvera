/** Paid model regression, with real APIs and a disposable synthetic database.
 * Run explicitly; never points at Stage or the personal preview database. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {requireIsolatedTestDatabaseUrl} from './test-database.js';
import {schoolDate} from '../src/agent/references.js';

const database=requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
if(process.env.AGENT_LIVE_EVAL!=='true')throw new Error('AGENT_LIVE_EVAL=true required for paid inference.');
const pool=new Pool({connectionString:database});
const base='http://127.0.0.1:8139';
const api=spawn(process.execPath,['dist/main.js'],{env:{...process.env,DATABASE_URL:database,EVENT_DATABASE_URL:database,
  NODE_ENV:'test',PORT:'8139',HOST:'127.0.0.1',DEMO_MODE:'true',COOKIE_SECRET:'isolated-conversation-eval-secret-32-chars',
  AGENT_PROVIDER:'vertex',AGENT_MODEL:'gemini-3.1-flash-lite',AGENT_BASE_URL:'',AGENT_API_KEY:'',
  AGENT_GOOGLE_PROJECT:'eduera-511111',AGENT_GOOGLE_LOCATION:'global',AGENT_USER_HOURLY_LIMIT:'60',AGENT_USER_DAILY_LIMIT:'100',
  LOG_LEVEL:'silent',SPA_DIST_DIR:'none'},stdio:['ignore','ignore','pipe']});
let serverErrors='';api.stderr?.on('data',chunk=>{serverErrors+=chunk.toString();});
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const cookies=new Map<string,string>();
async function request(path:string,body?:unknown):Promise<any> {
  const response=await fetch(base+'/api/v1'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',
    Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRFToken':cookies.get('csrftoken')??''},...(body?{body:JSON.stringify(body)}:{})});
  for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0]!,i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
  const data=await response.json();assert(response.ok,`${path}: HTTP ${response.status}`);return data;
}
async function turn(thread:string,question:string) {
  const sent=await request(`/agent/threads/${thread}/messages`,{question,client_id:randomUUID()});
  for(let i=0;i<250;i++) {
    const detail=await request(`/agent/threads/${thread}`),run=detail.runs.find((item:any)=>item.id===sent.run_id);
    if(run&&run.status!=='running') {
      console.log(JSON.stringify({question,status:run.status,answer:run.answer,capability:run.action?.capability,preview:run.action?.preview,sources:run.evidence.map((item:any)=>item.capability)}));
      assert.notEqual(run.status,'failed','Conversation must not fail');
      assert(!/\b(?:not authori[sz]ed|don.t have (?:the )?(?:permission|authorization|access)|cannot (?:modify|update) attendance)/i.test(run.answer),'Must not invent a permission denial');
      return run;
    }
    await pause(1000);
  }
  throw new Error('Run did not settle');
}
try {
  for(let i=0;i<100;i++){try{if((await fetch(base+'/readyz')).ok)break;}catch{/* startup */}await pause(100);}
  await pool.query('DELETE FROM api_rate_limit_buckets');
  await pool.query("UPDATE users SET pro_features_enabled=true WHERE username='meera.principal'");
  await request('/auth/csrf/');await request('/auth/demo-session/',{role:'admin'});
  const yesterday=schoolDate('Asia/Kolkata',new Date(Date.now()-86400000));
  const lookupPath=`/teacher/attendance/student?student=Aarav%20Sharma&date=${yesterday}`;
  const lookup=await request(lookupPath);assert(lookup.selected,'Synthetic learner must exist');
  const student=lookup.selected.student.id;
  // Set a known precondition only in the guarded, disposable fixture.
  const fixture=await pool.query("UPDATE attendance_records SET status='absent' WHERE student_id=$1 AND date=$2 RETURNING id",[student,yesterday]);
  assert.equal(fixture.rowCount,1,'Requires one seeded yesterday record');
  const before=await request(lookupPath);
  const thread=(await request('/agent/threads',{portal:'principal'})).id;
  const greeting=await turn(thread,'Hi');assert.equal(greeting.status,'completed');assert.equal(greeting.action,null);
  const found=await turn(thread,'Fina about aarav sharma');assert.equal(found.action,null);assert(found.evidence.length);
  const missing=await turn(thread,'Mark his attendence to present yesturday');
  assert.equal(missing.status,'completed');assert.equal(missing.action,null);assert.match(missing.answer,/reason|why|mistake|correction/i);
  const prepared=await turn(thread,'It was a data entry mistake.');
  assert.equal(prepared.status,'confirmation');assert.equal(prepared.action.capability,'record_student_attendance');
  assert.equal(prepared.action.preview.student,'Aarav Sharma');assert.equal(prepared.action.preview.date,yesterday);assert.equal(prepared.action.preview.status,'present');
  assert.equal((await request(lookupPath)).selected.student.status,'absent');
  await request(`/agent/threads/${thread}/actions/${prepared.action.id}`,{decision:'reject'});
  const discussion=await turn(thread,'No change please. Explain how attendance helps a principal plan support for students.');
  assert.equal(discussion.status,'completed');assert.equal(discussion.action,null);
  const resumed=await turn(thread,'Let us return to correcting his entry for yesterday with the reason I gave.');
  assert.equal(resumed.status,'confirmation');assert.equal(resumed.action.capability,'record_student_attendance');
  assert.equal(resumed.action.preview.student,'Aarav Sharma');assert.equal(resumed.action.preview.date,yesterday);assert.equal(resumed.action.preview.status,'present');
  const receipt=await request(`/agent/threads/${thread}/actions/${resumed.action.id}`,{decision:'confirm'});
  assert.equal(receipt.status,'succeeded');
  assert.equal((await request(lookupPath)).selected.student.status,'present');
  assert.equal((await request(lookupPath)).selected.register.revision,before.selected.register.revision+1);
  const followup=await turn(thread,'Did that change the whole class or just him?');
  assert.equal(followup.status,'completed');assert.equal(followup.action,null);
  // Historical assistant mistakes must not become an access policy. This models
  // a pre-fix conversation in the isolated DB, rather than adding retry phrases
  // or a special attendance case to the production prompt.
  const recovery=(await request('/agent/threads',{portal:'principal'})).id;
  for(const [index,item] of [
    {question:'Find Aarav Sharma',answer:'Aarav Sharma is in Class 7A.',status:'completed'},
    {question:'Mark his attendance late yesterday because the office entered the wrong status.',answer:'The prior attempt failed.',status:'failed'},
    {question:'Try again',answer:'I do not have authorization to update attendance. Use the portal.',status:'completed'},
  ].entries())await pool.query(`INSERT INTO agent_runs(id,thread_id,client_id,question,answer,status,progress,provider,model,created_at,finished_at)
    VALUES($1,$2,$3,$4,$5,$6,'Complete','test','historical-refusal',now()-($7::text||' minutes')::interval,now())`,
    [randomUUID(),recovery,randomUUID(),item.question,item.answer,item.status,3-index]);
  const recovered=await turn(recovery,'You were able to help earlier—could you finish this?');
  assert.equal(recovered.status,'confirmation');assert.equal(recovered.action.capability,'record_student_attendance');
  assert.equal(recovered.action.preview.student,'Aarav Sharma');assert.equal(recovered.action.preview.status,'late');assert.equal(recovered.action.preview.date,yesterday);
  await request(`/agent/threads/${recovery}/actions/${recovered.action.id}`,{decision:'reject'});
  const fees=await turn(recovery,'Leave that change for now. Are there unpaid fees for him?');
  assert.equal(fees.status,'completed');assert.equal(fees.action,null);
  assert(fees.evidence.some((item:any)=>item.capability==='student_fees'),'Topic switch must read the learner’s fee ledger');
  const diagnostics=(await pool.query("SELECT metadata FROM audit_events WHERE action='agent.model.response_failed' AND target_id IN (SELECT id FROM agent_runs WHERE thread_id=ANY($1::uuid[]))",[[thread,recovery]])).rows;
  assert.equal(diagnostics.length,0,'No provider recovery should be necessary');
  console.log(JSON.stringify({verified:true,thread,recovery,checks:'discussion, lookup, pronoun/date, clarification, rejection, contextual resumption, API approval, receipt, follow-up, prior false refusal, cross-domain switch'}));
} finally {api.kill('SIGTERM');await pool.end();if(serverErrors)console.error(serverErrors.slice(-500));}
