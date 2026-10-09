import { spawn,type ChildProcess } from 'node:child_process';
import { createServer,type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { Pool } from 'pg';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const databaseUrl=requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
const pool=new Pool({connectionString:databaseUrl,max:3});
const base='http://127.0.0.1:8138';
let api:ChildProcess;let model:Server;let modelPort:number;let modelRequests:Record<string,any>[]=[];
let followupNotification:string;
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
class Session {
  cookies=new Map<string,string>();
  async raw(path:string,body?:unknown,csrf=true,headers:Record<string,string>={},method?:string){
    const result=await fetch(base+path,{method:method??(body===undefined?'GET':'POST'),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; '),...(csrf?{'X-CSRFToken':this.cookies.get('csrftoken')??''}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    for(const value of result.headers.getSetCookie()){const pair=value.split(';')[0]!;const i=pair.indexOf('=');this.cookies.set(pair.slice(0,i),pair.slice(i+1));}
    return result;
  }
  async request(path:string,body?:unknown){const result=await this.raw(path,body);const data=await result.json() as any;if(!result.ok)throw new Error(`${result.status} ${JSON.stringify(data)}`);return data;}
  async delete(path:string){const result=await this.raw(path,undefined,true,{},'DELETE');const data=await result.json() as any;if(!result.ok)throw new Error(`${result.status} ${JSON.stringify(data)}`);return data;}
  async login(role:string){await this.request('/api/v1/auth/csrf/');return this.request('/api/v1/auth/demo-session/',{role});}
}
async function run(session:Session,question:string,portal='student',threadId?:string){
  const thread=threadId?{id:threadId}:await session.request('/api/v1/agent/threads',{portal});
  const client_id=randomUUID();const sent=await session.request(`/api/v1/agent/threads/${thread.id}/messages`,{question,client_id});
  for(let i=0;i<100;i++){const detail=await session.request(`/api/v1/agent/threads/${thread.id}`);const latest=detail.runs.find((item:any)=>item.id===sent.run_id);if(latest&&latest.status!=='running')return{thread:thread.id,run:latest,client_id,runId:sent.run_id};await pause(50);}
  throw new Error('Agent did not settle');
}
async function notification(session:Session){
  const me=await session.request('/api/v1/auth/session/');
  const id=randomUUID();
  await pool.query("INSERT INTO notifications(id,recipient_id,kind,title,body,link) VALUES($1,$2,'general','Agent test notification','A test-only record','/student/attendance')",[id,me.user.id]);
  return id;
}
beforeAll(async()=>{
  // Only this suite's runs in the strictly guarded disposable database.
  await pool.query("UPDATE users SET pro_features_enabled=true WHERE username IN ('aarav.student','pooja.parent','kavita.staff','meera.principal')");
  await pool.query("DELETE FROM notifications WHERE title='Agent test notification'");
  await pool.query("DELETE FROM agent_runs WHERE model='test-tools'");
  await pool.query('DELETE FROM api_rate_limit_buckets');
  model=createServer((req,res)=>{let raw='';req.on('data',(chunk:Buffer)=>{raw+=chunk.toString();});req.on('end',()=>{
    if(req.url==='/api/tags'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:[{name:'test-tools'}]}));return;}
    const body=JSON.parse(raw) as Record<string,any>;modelRequests.push(body);
    const question=String(body.messages.findLast((message:any)=>message.role==='user')?.content??'');
    const conversation=JSON.stringify(body.messages);
    const last=body.messages.findLast((message:any)=>message.role==='tool');
    let message:Record<string,unknown>;
    const call=(name:string,args:unknown)=>({content:'',tool_calls:[{function:{name,arguments:args}}]});
    if(question.startsWith('Create durable conversation memory'))message={content:'The user prefers concise, evidence-linked answers. A prior proposal was dismissed and nothing changed.'};
    else if(question==='Please remember that I always prefer concise answers with the important evidence first.')message=!last
      ?call('manage_user_memory',{changes:[{operation:'remember',category:'communication_preference',topic:'response_length',value:'Concise answers with the important evidence first.',evidence_quote:'I always prefer concise answers with the important evidence first'}]})
      :{content:'I will keep future answers concise and lead with the important evidence.'};
    else if(question==='Complete my first pending homework'){
      if(!last)message=call('diary',{});
      else if(last.tool_name==='diary'){
        const data=JSON.parse(last.content).data;const results=Array.isArray(data?.results)?data.results:data?.results?.items;
        const item=results?.find((row:any)=>row.item_type==='homework'&&row.completed===false);
        message=item?call('complete_homework',{record_id:item.id}):{content:'No published homework is available.'};
      }else message={content:'The homework action was recorded by the app.'};
    }
    else if(question.includes('forbidden SQL'))message=call('execute_sql',{sql:'DELETE FROM users'});
    else if(/(?:continue|proceed|go ahead|you can)/i.test(question)&&conversation.includes('Change Aarav Sharma attendance to'))message=!last?call('record_student_attendance',{student:'Ananya Iyer',status:conversation.includes('to present')?'absent':'present',reason:'Reused from an old proposal'}):{content:JSON.parse(last.content).error??'Please review the continued change.'};
    else if(question==='List my test notifications')message=!last?call('notifications',{}):{content:'I found your test notification. You can ask me to mark it read.'};
    else if(question==='Mark it read')message=call('read_notification',{record_id:followupNotification});
    else if(question.includes('about aarav'))message=!last?call('find_students',{search:'Aarav Sharma'}):{content:'Aarav Sharma, admission CIS-2023-071, is in Class 7A.'};
    else if(question.includes('his presence'))message=!last?call('record_student_attendance',{student:'CIS-2023-071',status:'present'}):{content:JSON.parse(last.content).error??'Please review the attendance change.'};
    else if(question.includes('cross-turn isolation setup'))message=!last?call('record_student_attendance',{student:'Rohan Verma',status:question.includes(' present')?'absent':'present',reason:'Rejected model-only arguments'}):{content:JSON.parse(last.content).error??'Please review the setup change.'};
    else if(question.includes('Change Aarav Sharma attendance to'))message=!last?call('record_student_attendance',{student:'Ananya Iyer',status:question.includes(' to present')?'absent':'present',reason:'Reused from the prior turn'}):{content:JSON.parse(last.content).error??'Please review the corrected change.'};
    else if(question.includes('Record one student'))message=!last?call('record_student_attendance',{student:'Ananya Iyer',status:question.includes('absent')?'absent':'present',reason:'Explicit isolated test correction'}) : {content:JSON.parse(last.content).error??'Please review the change.'};
    else if(question.includes('Ambiguous student attendance'))message=!last?call('record_student_attendance',{student:'Sharma',status:'present'}):{content:JSON.parse(last.content).error??'Choose a student.'};
    else if(question.includes('false completion')||question.includes('App verification:'))message={content:'I have marked him present.'};
    else if(question.includes('explicit test attendance')){
      if(!last)message=call('class_registers',{});
      else if(last.tool_name==='class_registers'){
        const data=JSON.parse(last.content).data;const section=data?.classes?.find((item:any)=>item.can_mark!==false&&item.submission_status!=='locked');
        message=section?call('attendance_register',{class_section_id:section.class_section_id,date:data.date}):{content:'Class read failed: '+last.content};
      }else if(last.tool_name==='attendance_register'){
        const data=JSON.parse(last.content).data;
        message=call('record_attendance',{class_section_id:data.class.id,date:data.date,expected_revision:data.register.revision,records:data.roster.map((student:any)=>({student_id:student.id,status:'present'})),reason:'Explicit isolated integration-test observations for the full roster'});
      }else message={content:'No action available.'};
    }
    else if(question.includes('notification')){
      if(!last||last.tool_name==='find_tools')message=call('notifications',{});
      else {const data=JSON.parse(last.content);const item=data.data?.results?.find((row:any)=>row.title==='Agent test notification');message=item?call('read_notification',{record_id:item.id}):{content:'No test notification.'};}
    }else if(!last)message=call('my_attendance',{});
    else message={content:'I checked your recorded attendance. Open the verified source to review it.'};
    const reply=()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({done:true,message}));};
    if(question.includes('slow'))setTimeout(reply,1000);else reply();
  });});
  await new Promise<void>(resolve=>model.listen(0,'127.0.0.1',resolve));modelPort=(model.address() as {port:number}).port;
  api=spawn(process.execPath,['dist/main.js'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:databaseUrl,EVENT_DATABASE_URL:databaseUrl,NODE_ENV:'test',PORT:'8138',HOST:'127.0.0.1',COOKIE_SECRET:'agent-test-secret-at-least-thirty-two-characters',DEMO_MODE:'true',AGENT_USER_HOURLY_LIMIT:'60',AGENT_USER_DAILY_LIMIT:'100',AGENT_PROVIDER:'ollama',AGENT_MODEL:'test-tools',AGENT_CONTEXT_WINDOW_TOKENS:'4096',AGENT_BASE_URL:`http://127.0.0.1:${modelPort}`,LOG_LEVEL:'silent',SPA_DIST_DIR:'no-spa'},stdio:['ignore','pipe','pipe']});
  let errors='';api.stderr?.on('data',(chunk:Buffer)=>{errors+=chunk.toString();});
  for(let i=0;i<100;i++){try{if((await fetch(base+'/readyz')).ok)return;}catch{/*starting*/}await pause(100);}
  throw new Error('Test API failed to start: '+errors.slice(-1000));
});
beforeEach(async()=>{modelRequests=[];await pool.query("UPDATE agent_runs SET status='failed',answer='Isolated test cleanup',finished_at=now() WHERE status='running' AND model='test-tools'");await pool.query('DELETE FROM agent_user_memories');await pool.query('DELETE FROM api_rate_limit_buckets');});
afterAll(async()=>{api?.kill('SIGTERM');await new Promise<void>(resolve=>{if(!model)return resolve();model.close(()=>resolve());model.closeAllConnections();});await pool.end();});

describe('agent end-to-end guarded execution',()=>{
  it('persists only explicit bounded user memory, reuses it across threads and lets the owner erase it',async()=>{
    const session=new Session();await session.login('student');
    const saved=await run(session,'Please remember that I always prefer concise answers with the important evidence first.');
    expect(saved.run.status).toBe('completed');expect(saved.run.answer).toContain('future answers concise');
    const listed=await session.request('/api/v1/agent/memories');
    expect(listed).toMatchObject({contract:'2026-10-10.1',budget:{used_items:1,max_tokens:1200,max_items:32}});
    expect(listed.items[0]).toMatchObject({portal:'student',category:'communication_preference',topic:'response_length',content:'Concise answers with the important evidence first.',revision:1});
    expect(listed.budget.used_tokens).toBeLessThanOrEqual(listed.budget.max_tokens);
    modelRequests=[];
    const followup=await run(session,'Check my attendance and use my established communication preference.');
    expect(followup.run.status).toBe('completed');
    const request=modelRequests.find(item=>item.messages?.some((message:any)=>message.content==='Check my attendance and use my established communication preference.'));
    expect(JSON.stringify(request)).toContain('App-provided long-term user memory');
    expect(JSON.stringify(request)).toContain('Concise answers with the important evidence first.');
    expect(JSON.stringify(request)).toContain('Aarav Sharma');
    expect(JSON.stringify(request)).not.toContain('aarav.student@');
    expect(await session.delete(`/api/v1/agent/memories/${listed.items[0].id}`)).toMatchObject({deleted:true,id:listed.items[0].id});
    expect((await session.request('/api/v1/agent/memories')).items).toHaveLength(0);
    expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action IN ('agent.memory.changed','agent.memory.deleted') AND actor_id=(SELECT id FROM users WHERE username='aarav.student')")).rows[0].n).toBeGreaterThanOrEqual(2);
  });
  it('disables every assistant endpoint when Pro is off',async()=>{
    const student=new Session();await student.login('student');
    const on=await student.request('/api/v1/agent/status?portal=student');
    expect(on.pro_features_enabled).toBe(true);
    try {
      const changed=await student.request('/api/v1/auth/pro-features/',{enabled:false});
      expect(changed).toMatchObject({enabled:false,preview:true});
      expect((await student.raw('/api/v1/agent/status?portal=student')).status).toBe(403);
      expect((await student.raw('/api/v1/agent/threads',{portal:'student'})).status).toBe(403);
      expect((await student.raw('/api/v1/ai/attendance/query/',{question:'How is my attendance?'})).status).toBe(403);
      expect((await student.raw('/api/v1/auth/pro-features/',{enabled:'yes'})).status).toBe(400);
    } finally { await student.request('/api/v1/auth/pro-features/',{enabled:true}); }
  });
  it('does not execute a pending AI action after Pro is turned off',async()=>{
    const admin=new Session();await admin.login('student');
    await notification(admin);
    const prepared=await run(admin,'Mark the test notification read','student');
    expect(prepared.run.status).toBe('confirmation');
    try {
      await admin.request('/api/v1/auth/pro-features/',{enabled:false});
      const denied=await admin.raw(`/api/v1/agent/threads/${prepared.thread}/actions/${prepared.run.action.id}`,{decision:'confirm'});
      expect(denied.status).toBe(403);
      expect((await admin.raw(`/api/v1/agent/threads/${prepared.thread}/actions/${prepared.run.action.id}`,{decision:'reject'})).status).toBe(403);
      expect((await pool.query('SELECT status FROM agent_actions WHERE id=$1',[prepared.run.action.id])).rows[0].status).toBe('rejected');
      expect((await pool.query('SELECT status FROM agent_runs WHERE id=$1',[prepared.runId])).rows[0].status).toBe('completed');
    } finally {
      await admin.request('/api/v1/auth/pro-features/',{enabled:true});
      const dismissed=await admin.request(`/api/v1/agent/threads/${prepared.thread}/actions/${prepared.run.action.id}`,{decision:'confirm'});
      expect(dismissed.status).toBe('rejected');
    }
  });
  it('cancels an in-flight request when Pro is turned off',async()=>{
    const student=new Session();await student.login('student');
    const thread=await student.request('/api/v1/agent/threads',{portal:'student'});
    const started=await student.request(`/api/v1/agent/threads/${thread.id}/messages`,{question:'Check slow attendance',client_id:randomUUID()});
    try {
      await student.request('/api/v1/auth/pro-features/',{enabled:false});
      const run=(await pool.query('SELECT status,answer FROM agent_runs WHERE id=$1',[started.run_id])).rows[0];
      expect(run.status).toBe('cancelled');expect(run.answer).toMatch(/No pending action was executed/);
      await pause(1100);
      expect((await pool.query('SELECT status FROM agent_runs WHERE id=$1',[started.run_id])).rows[0].status).toBe('cancelled');
    } finally { await student.request('/api/v1/auth/pro-features/',{enabled:true}); }
  });
  it('reproduces lookup then pronoun attendance without asking for an internal ID',async()=>{
    const admin=new Session();await admin.login('admin');
    const target=await admin.request('/api/v1/teacher/attendance/student?student=CIS-2023-071');
    // Fresh CI seeds include today's observations and immutable revision history.
    // Temporarily move the current fixture out of today's lookup, then restore it;
    // never delete or rewrite append-only attendance revisions.
    const displaced=await pool.query("UPDATE attendance_records SET date=date-interval '100 years' WHERE student_id=$1 AND date=$2 RETURNING id",[target.selected.student.id,target.date]);
    try {
    const first=await run(admin,'Check about aarav sharma','principal');
    expect(first.run.status).toBe('completed');expect(first.run.evidence[0].capability).toBe('find_students');
    modelRequests=[];
    const second=await run(admin,'Can you mark his presence today','principal',first.thread);
    expect(second.run.status).toBe('confirmation');expect(second.run.action.capability).toBe('record_student_attendance');
    expect(second.run.action.preview).toMatchObject({student:'Aarav Sharma',class_name:'Class 7A',previous_status:'Not marked',status:'present'});
    expect(second.run.action.href).toContain('student_id=');
    expect(JSON.stringify(modelRequests)).toContain('App-provided record references');
    expect(JSON.stringify(modelRequests)).toContain(second.run.action.input.body.student_id);
    await admin.request(`/api/v1/agent/threads/${first.thread}/actions/${second.run.action.id}`,{decision:'reject'});
    const check=await admin.request('/api/v1/teacher/attendance/student?student=CIS-2023-071');
    expect(check.selected.student.status).toBeNull();
    } finally {
      if(displaced.rows.length)await pool.query('UPDATE attendance_records SET date=$2 WHERE id=ANY($1::uuid[])',[displaced.rows.map(row=>row.id),target.date]);
    }
  });
  it('isolates each write intent and never reuses a rejected learner or broadens a retry',async()=>{
    const admin=new Session();await admin.login('admin');
    const ananya=await admin.request('/api/v1/teacher/attendance/student?student=Ananya%20Iyer');
    const setupStatus=ananya.selected.student.status==='absent'?'present':'absent';
    const setup=await run(admin,`Mark Ananya Iyer ${setupStatus} today. Correction reason: cross-turn isolation setup`,'principal');
    expect(setup.run.status).toBe('confirmation');expect(setup.run.action.preview.student).toBe('Ananya Iyer');
    await admin.request(`/api/v1/agent/threads/${setup.thread}/actions/${setup.run.action.id}`,{decision:'reject'});
    expect((await pool.query('SELECT status FROM agent_runs WHERE id=$1',[setup.runId])).rows[0].status).toBe('completed');

    const aarav=await admin.request('/api/v1/teacher/attendance/student?student=Aarav%20Sharma');
    const desired=aarav.selected.student.status==='present'?'absent':'present';
    const beforeRequest=modelRequests.length;
    const corrected=await run(admin,`Change Aarav Sharma attendance to ${desired} today. Accidentally marked the previous status.`,'principal',setup.thread);
    expect(corrected.run.status).toBe('confirmation');expect(corrected.run.action).toMatchObject({capability:'record_student_attendance',title:'Record one student’s attendance'});
    expect(corrected.run.action.preview).toMatchObject({student:'Aarav Sharma',status:desired,reason:'Accidentally marked the previous status'});
    expect(corrected.run.action.input.body.student_id).toBe(aarav.selected.student.id);
    expect(JSON.stringify(modelRequests[beforeRequest])).not.toContain('Rohan Verma');
    expect(JSON.stringify(modelRequests[beforeRequest])).not.toContain('Rejected model-only arguments');
    await admin.request(`/api/v1/agent/threads/${setup.thread}/actions/${corrected.run.action.id}`,{decision:'reject'});

    const retry=await run(admin,'You can.','principal',setup.thread);
    expect(retry.run.status).toBe('confirmation');expect(retry.run.action).toMatchObject({capability:'record_student_attendance'});
    expect(retry.run.action.preview).toMatchObject({student:'Aarav Sharma',status:desired,reason:'Accidentally marked the previous status'});
    expect(retry.run.action.input.body.student_id).toBe(aarav.selected.student.id);
    expect(retry.run.action.capability).not.toBe('record_attendance');
    await admin.request(`/api/v1/agent/threads/${setup.thread}/actions/${retry.run.action.id}`,{decision:'reject'});
  });
  it('records just one learner, preserves every other row and leaves a draft register open',async()=>{
    const admin=new Session();await admin.login('admin');
    const lookup=await admin.request('/api/v1/teacher/attendance/student?student=Ananya%20Iyer');
    expect(lookup.matches).toHaveLength(1);
    const path=`/api/v1/screens/teacher/attendance?class_section_id=${lookup.selected.class.id}&date=${lookup.date}`;
    const before=await admin.request(path);
    const desired=lookup.selected.student.status==='present'?'absent':'present';
    const result=await run(admin,`Record one student Ananya Iyer ${desired} with reason Explicit isolated test correction`,'principal');
    expect(result.run.status).toBe('confirmation');
    expect((await admin.request(path)).roster).toEqual(before.roster);
    const decision=await admin.request(`/api/v1/agent/threads/${result.thread}/actions/${result.run.action.id}`,{decision:'confirm'});
    expect(decision.status).toBe('succeeded');
    const after=await admin.request(path);
    expect(after.register.state).toBe('draft');expect(after.register.submitted_at).toBeNull();
    const target=lookup.selected.student.id;
    expect(after.roster.find((row:any)=>row.id===target).status).toBe(desired);
    expect(after.roster.filter((row:any)=>row.id!==target)).toEqual(before.roster.filter((row:any)=>row.id!==target));
    expect(after.register.revision).toBe(before.register.revision+1);
    const trace=await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='attendance.student.recorded' AND request_id=$1",[decision.receipt.request_id]);
    expect(trace.rows[0].n).toBe(1);
  });
  it('asks for a distinguishing detail instead of choosing an ambiguous learner',async()=>{
    const admin=new Session();await admin.login('admin');
    const result=await run(admin,'Ambiguous student attendance: mark Sharma present','principal');
    expect(result.run.action).toBeNull();expect(result.run.answer).toContain('Multiple students');
    expect(result.run.evidence[0].capability).toBe('student_attendance');
    expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='agent.tool.failed' AND target_id=$1",[result.runId])).rows[0].n).toBe(1);
  });
  it('requires a correction reason, preserves omitted remarks and replays a single-student key exactly once',async()=>{
    const admin=new Session();await admin.login('admin');
    const lookup=await admin.request('/api/v1/teacher/attendance/student?student=Ananya%20Iyer');
    const selected=lookup.selected;const target=selected.student.id;
    const before=await pool.query('SELECT id,status,remarks,revision FROM attendance_records WHERE student_id=$1 AND date=$2',[target,lookup.date]);
    const input={class_section_id:selected.class.id,student_id:target,date:lookup.date,expected_revision:selected.register.revision,status:selected.student.status==='present'?'absent':'present'};
    const headers={'Idempotency-Key':randomUUID()};
    expect((await admin.raw('/api/v1/teacher/attendance/student',input,true,headers)).status).toBe(400);
    expect((await pool.query('SELECT id,status,remarks,revision FROM attendance_records WHERE student_id=$1 AND date=$2',[target,lookup.date])).rows).toEqual(before.rows);
    const command={...input,reason:'Explicit isolated test correction'};
    const first=await admin.raw('/api/v1/teacher/attendance/student',command,true,headers);expect(first.status).toBe(200);
    const saved=await first.json();const replay=await admin.raw('/api/v1/teacher/attendance/student',command,true,headers);
    expect(replay.status).toBe(200);expect(await replay.json()).toEqual(saved);
    const after=await admin.request('/api/v1/teacher/attendance/student?student=Ananya%20Iyer');
    expect(after.selected.student.remarks).toBe(selected.student.remarks);
    expect(after.selected.register.revision).toBe(selected.register.revision+1);
    expect((await admin.raw('/api/v1/teacher/attendance/student',{...command,status:'late'},true,headers)).status).toBe(409);
    expect((await admin.raw('/api/v1/teacher/attendance/student',command,true,{'Idempotency-Key':randomUUID()})).status).toBe(409);
  });
  it('invalidates a single-student preview when the register changes before confirmation',async()=>{
    const admin=new Session();await admin.login('admin');const lookup=await admin.request('/api/v1/teacher/attendance/student?student=Ananya%20Iyer');
    const desired=lookup.selected.student.status==='present'?'absent':'present';
    const proposed=await run(admin,`Record one student Ananya Iyer ${desired} with reason Explicit isolated test correction`,'principal');
    expect(proposed.run.status).toBe('confirmation');
    await pool.query('UPDATE attendance_registers SET revision=revision+1 WHERE id=$1',[lookup.selected.register.id]);
    const decision=await admin.request(`/api/v1/agent/threads/${proposed.thread}/actions/${proposed.run.action.id}`,{decision:'confirm'});
    expect(decision.status).toBe('stale');
    expect((await admin.request('/api/v1/teacher/attendance/student?student=Ananya%20Iyer')).selected.student.status).toBe(lookup.selected.student.status);
  });
  it('rejects a locked register or a student outside the selected roster on the domain API',async()=>{
    const admin=new Session();await admin.login('admin');const lookup=await admin.request('/api/v1/teacher/attendance/student?student=Ananya%20Iyer');
    const selected=lookup.selected;
    const input={class_section_id:selected.class.id,student_id:selected.student.id,date:lookup.date,expected_revision:selected.register.revision,status:'late',reason:'Explicit isolated test correction'};
    expect((await admin.raw('/api/v1/teacher/attendance/student',{...input,student_id:randomUUID()},true,{'Idempotency-Key':randomUUID()})).status).toBe(400);
    await pool.query("UPDATE attendance_registers SET state='locked' WHERE id=$1",[selected.register.id]);
    try{expect((await admin.raw('/api/v1/teacher/attendance/student',input,true,{'Idempotency-Key':randomUUID()})).status).toBe(403);}
    finally{await pool.query('UPDATE attendance_registers SET state=$1 WHERE id=$2',[selected.register.state,selected.register.id]);}
  });
  it('never presents a model-only completion claim as a saved action',async()=>{
    const admin=new Session();await admin.login('admin');const result=await run(admin,'Test false completion','principal');
    expect(result.run.status).toBe('failed');expect(result.run.action).toBeNull();expect(result.run.answer).toContain('No change was made');
  });
  it('rejects family use of the individual attendance write API',async()=>{
    const parent=new Session();await parent.login('parent');
    expect((await parent.raw('/api/v1/teacher/attendance/student',{class_section_id:randomUUID(),student_id:randomUUID(),date:'2026-10-09',status:'present',expected_revision:0})).status).toBe(403);
  });
  it('reads real authorized app data and persists verified sources, never credentials',async()=>{
    const session=new Session();await session.login('student');const result=await run(session,'Check attendance now');
    expect(result.run.status).toBe('completed');expect(result.run.evidence[0].href).toBe('/student/attendance');
    expect(result.run.action).toBeNull();expect((await session.request(`/api/v1/agent/threads/${result.thread}`)).runs[0].id).toBe(result.runId);
    const sent=JSON.stringify(modelRequests);for(const value of session.cookies.values())expect(sent).not.toContain(value);
  });
  it('does not write before approval; confirms once with a domain receipt and audit',async()=>{
    const session=new Session();await session.login('student');const target=await notification(session);
    const result=await run(session,'Mark the test notification read');expect(result.run.status).toBe('confirmation');
    expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[target])).rows[0].read_at).toBeNull();
    const path=`/api/v1/agent/threads/${result.thread}/actions/${result.run.action.id}`;
    expect((await session.raw(path,{decision:'confirm'},false)).status).toBe(403);
    const responses=await Promise.all([session.request(path,{decision:'confirm'}),session.request(path,{decision:'confirm'})]);
    expect(responses.some(response=>response.status==='succeeded')).toBe(true);
    expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[target])).rows[0].read_at).not.toBeNull();
    expect((await session.request(path,{decision:'confirm'})).status).toBe('succeeded');
    expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='agent.action.succeeded' AND target_id=$1",[result.runId])).rows[0].n).toBe(1);
  });
  it('refreshes a prior source and retains internal references for a different-domain follow-up action',async()=>{
    const session=new Session();await session.login('student');followupNotification=await notification(session);
    const first=await run(session,'List my test notifications');expect(first.run.action).toBeNull();
    const second=await run(session,'Mark it read','student',first.thread);
    expect(second.run.status).toBe('confirmation');expect(second.run.action.input.id).toBe(followupNotification);
    expect(second.run.evidence[0].capability).toBe('notifications');
    expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[followupNotification])).rows[0].read_at).toBeNull();
    expect((await session.request(`/api/v1/agent/threads/${first.thread}/actions/${second.run.action.id}`,{decision:'confirm'})).status).toBe('succeeded');
  });
  it('rejects changed records without executing the proposed write',async()=>{
    const session=new Session();await session.login('student');const target=await notification(session);const result=await run(session,'Mark test notification read');
    await pool.query("UPDATE notifications SET body='Changed after preview' WHERE id=$1",[target]);
    const decision=await session.request(`/api/v1/agent/threads/${result.thread}/actions/${result.run.action.id}`,{decision:'confirm'});
    expect(decision.status).toBe('stale');expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[target])).rows[0].read_at).toBeNull();
  });
  it('supports rejection and expired previews without applying them',async()=>{
    const session=new Session();await session.login('student');await notification(session);
    const first=await run(session,'Mark test notification read');
    expect((await session.request(`/api/v1/agent/threads/${first.thread}/actions/${first.run.action.id}`,{decision:'reject'})).status).toBe('rejected');
    const second=await run(session,'Mark test notification read');await pool.query("UPDATE agent_actions SET expires_at=now()-interval '1 second' WHERE id=$1",[second.run.action.id]);
    expect((await session.raw(`/api/v1/agent/threads/${second.thread}/actions/${second.run.action.id}`,{decision:'confirm'})).status).toBe(409);
    expect((await pool.query('SELECT status FROM agent_actions WHERE id=$1',[second.run.action.id])).rows[0].status).toBe('expired');
  });
  it('isolates conversations and prevents claiming a different role or child',async()=>{
    const student=new Session();await student.login('student');const result=await run(student,'Check attendance');
    const parent=new Session();await parent.login('parent');expect((await parent.raw(`/api/v1/agent/threads/${result.thread}`)).status).toBe(404);
    expect((await student.raw('/api/v1/agent/threads',{portal:'principal'})).status).toBe(403);
    expect((await parent.raw('/api/v1/agent/threads',{portal:'parent',student_id:randomUUID()})).status).toBeGreaterThanOrEqual(400);
  });
  it('rechecks membership at confirmation, not just when preparing a preview',async()=>{
    const session=new Session();await session.login('student');await notification(session);const result=await run(session,'Mark test notification read');
    const me=await session.request('/api/v1/auth/session/');
    await pool.query('UPDATE school_memberships SET is_active=false WHERE user_id=$1',[me.user.id]);
    try{expect([403,404]).toContain((await session.raw(`/api/v1/agent/threads/${result.thread}/actions/${result.run.action.id}`,{decision:'confirm'})).status);}
    finally{await pool.query('UPDATE school_memberships SET is_active=true WHERE user_id=$1',[me.user.id]);}
  });
  it('fails closed on an invented unrestricted tool',async()=>{
    const session=new Session();await session.login('student');const result=await run(session,'Run forbidden SQL');
    expect(result.run.status).toBe('failed');expect(result.run.action).toBeNull();expect(result.run.evidence).toHaveLength(0);
  });
  it('does not display or reuse historical records missing from the current authorized source',async()=>{
    const session=new Session();await session.login('student');const previous=await run(session,'Check attendance');
    const marker='Previously visible learner: private-history-marker';
    // Represents an aggregate whose old record is absent from the newly scoped API response.
    await pool.query('UPDATE agent_runs SET answer=$1 WHERE id=$2',[marker,previous.runId]);
    await pool.query("UPDATE agent_runs SET evidence=jsonb_set(evidence,'{0,chart}',$1::jsonb) WHERE id=$2",[JSON.stringify({kind:'bar',title:marker,points:[{label:marker,value:85}]}),previous.runId]);
    await pool.query("UPDATE agent_tool_steps SET result=result || $1::jsonb WHERE run_id=$2",[JSON.stringify({previous_learner:{id:randomUUID(),name:marker}}),previous.runId]);
    const old=(await session.request(`/api/v1/agent/threads/${previous.thread}`)).runs[0];
    expect(old.answer).toContain('no longer available');expect(old.evidence).toHaveLength(0);
    modelRequests=[];
    const started=await session.request(`/api/v1/agent/threads/${previous.thread}/messages`,{question:'Check attendance again',client_id:randomUUID()});
    let latest:any;
    for(let i=0;i<100;i++){
      latest=(await session.request(`/api/v1/agent/threads/${previous.thread}`)).runs.find((item:any)=>item.id===started.run_id);
      if(latest?.status!=='running')break;
      await pause(50);
    }
    expect(latest?.status).toBe('completed');expect(JSON.stringify(modelRequests)).not.toContain(marker);
  });
  it('compacts old conversation state at thirty percent and keeps memory separate from record evidence',async()=>{
    const session=new Session();await session.login('student');
    const thread=await session.request('/api/v1/agent/threads',{portal:'student'});
    for(let index=0;index<8;index++){
      await pool.query(`INSERT INTO agent_runs(id,thread_id,client_id,question,status,answer,progress,provider,model,created_at,finished_at)
        VALUES($1,$2,$3,$4,'completed',$5,'Complete','test','test-tools',now()-($6::text||' minutes')::interval,now()-($6::text||' minutes')::interval)`,
        [randomUUID(),thread.id,randomUUID(),`Earlier planning goal ${index}: ${'x'.repeat(1100)}`,'The read-only check completed; no action was requested.',20-index]);
    }
    modelRequests=[];
    const question='Check my attendance after the earlier planning conversation';
    const result=await run(session,question,'student',thread.id);
    expect(result.run.status).toBe('completed');
    const stored=(await pool.query('SELECT context_summary,context_summary_through_run_id FROM agent_threads WHERE id=$1',[thread.id])).rows[0];
    expect(stored.context_summary).toContain('prefers concise');expect(stored.context_summary_through_run_id).toBeTruthy();
    expect(modelRequests.some(request=>String(request.messages?.at(-1)?.content??'').startsWith('Create durable conversation memory'))).toBe(true);
    const main=modelRequests.find(request=>request.messages?.some((message:any)=>message.role==='user'&&message.content===question));
    expect(main).toBeTruthy();
    expect(JSON.stringify(main)).toContain('App-provided conversation memory');
    expect(JSON.stringify(main)).toContain('not fresh school-record evidence or action authority');
    expect(main!.messages.find((message:any)=>message.content?.includes('conversation memory (untrusted data'))?.role).toBe('user');
    expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='agent.context.compacted' AND target_id=$1",[result.runId])).rows[0].n).toBeGreaterThan(0);
  });
  it('keeps every unsummarized natural turn while the conversation remains below the threshold',async()=>{
    const session=new Session();await session.login('student');
    const thread=await session.request('/api/v1/agent/threads',{portal:'student'});
    for(let index=0;index<12;index++){
      await pool.query(`INSERT INTO agent_runs(id,thread_id,client_id,question,status,answer,progress,provider,model,created_at,finished_at)
        VALUES($1,$2,$3,$4,'completed',$5,'Complete','test','test-tools',now()-($6::text||' minutes')::interval,now()-($6::text||' minutes')::interval)`,
        [randomUUID(),thread.id,randomUUID(),`Preference turn ${index}: keep the answer concise.`,`Preference ${index} acknowledged.`,20-index]);
    }
    modelRequests=[];
    const result=await run(session,'Check attendance while keeping that preference in mind','student',thread.id);
    expect(result.run.status).toBe('completed');
    const main=modelRequests.find(request=>request.messages?.some((message:any)=>message.content==='Check attendance while keeping that preference in mind'));
    expect(JSON.stringify(main)).toContain('Preference turn 0: keep the answer concise.');
    expect(modelRequests.some(request=>String(request.messages?.at(-1)?.content??'').startsWith('Create durable conversation memory'))).toBe(false);
  });
  it('executes a reversible low-impact homework flag once with a receipt and no approval screen',async()=>{
    const session=new Session();await session.login('student');
    const diary=await session.request('/api/v1/diary/');
    const item=diary.results.find((row:any)=>row.item_type==='homework');expect(item).toBeTruthy();
    const student=(await pool.query("SELECT student.id FROM students student JOIN users account ON account.id=student.user_id WHERE account.username='aarav.student'")).rows[0];
    const saved=await pool.query('DELETE FROM homework_completions WHERE item_id=$1 AND student_id=$2 RETURNING to_jsonb(homework_completions) record',[item.id,student.id]);
    try {
      const result=await run(session,'Complete my first pending homework');
      expect(result.run.status).toBe('completed');
      expect(result.run.action).toMatchObject({capability:'complete_homework',status:'succeeded',contract:{effect:'low_impact',control:'monitored',presentation:'receipt'}});
      expect(result.run.action.receipt).toMatchObject({title:'Mark this homework complete',policy:{control:'monitored'}});
      expect((await pool.query('SELECT count(*)::int n FROM homework_completions WHERE item_id=$1 AND student_id=$2',[item.id,student.id])).rows[0].n).toBe(1);
      const refreshed=await session.request('/api/v1/diary/');expect(refreshed.results.find((row:any)=>row.id===item.id)).toMatchObject({completed:true});
      expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='agent.action.succeeded' AND target_id=$1",[result.runId])).rows[0].n).toBe(1);
    } finally {
      await pool.query('DELETE FROM homework_completions WHERE item_id=$1 AND student_id=$2',[item.id,student.id]);
      for(const row of saved.rows)await pool.query('INSERT INTO homework_completions SELECT * FROM jsonb_populate_record(NULL::homework_completions,$1::jsonb)',[JSON.stringify(row.record)]);
    }
  });
  it('replays the same message key without starting another run',async()=>{
    const session=new Session();await session.login('student');const result=await run(session,'Check attendance');
    const replay=await session.request(`/api/v1/agent/threads/${result.thread}/messages`,{question:'Check attendance',client_id:result.client_id});
    expect(replay.run_id).toBe(result.runId);expect((await session.request(`/api/v1/agent/threads/${result.thread}`)).runs).toHaveLength(1);
  });
  it('cancels an in-flight model request without executing anything',async()=>{
    const session=new Session();await session.login('student');const thread=await session.request('/api/v1/agent/threads',{portal:'student'});
    const started=await session.request(`/api/v1/agent/threads/${thread.id}/messages`,{question:'Check slow attendance',client_id:randomUUID()});
    await session.request(`/api/v1/agent/threads/${thread.id}/runs/${started.run_id}/cancel`,{});
    expect((await session.request(`/api/v1/agent/threads/${thread.id}`)).runs[0].status).toBe('cancelled');
  });
  it('cannot cancel somebody else’s run through an owned conversation',async()=>{
    const student=new Session();await student.login('student');const thread=await student.request('/api/v1/agent/threads',{portal:'student'});
    const started=await student.request(`/api/v1/agent/threads/${thread.id}/messages`,{question:'Check slow attendance',client_id:randomUUID()});
    const parent=new Session();await parent.login('parent');const other=await parent.request('/api/v1/agent/threads',{portal:'parent'});
    expect((await parent.raw(`/api/v1/agent/threads/${other.id}/runs/${started.run_id}/cancel`,{})).status).toBe(404);
    expect((await student.request(`/api/v1/agent/threads/${thread.id}`)).runs[0].status).toBe('running');
    await student.request(`/api/v1/agent/threads/${thread.id}/runs/${started.run_id}/cancel`,{});
  });
  it('recovers an expired worker lease without executing a pending action',async()=>{
    const student=new Session();await student.login('student');const result=await run(student,'Check attendance');
    await pool.query("UPDATE agent_runs SET status='running',lease_expires_at=now()-interval '1 minute' WHERE id=$1",[result.runId]);
    const recovered=(await student.request(`/api/v1/agent/threads/${result.thread}`)).runs[0];expect(recovered.status).toBe('failed');expect(recovered.action).toBeNull();
  });
  it('requires verification after an interrupted write and never redispatches its confirmation',async()=>{
    const student=new Session();await student.login('student');const target=await notification(student);const result=await run(student,'Mark the test notification read');
    await pool.query("UPDATE agent_actions SET status='executing',created_at=now()-interval '13 minutes' WHERE id=$1",[result.run.action.id]);
    const recovered=(await student.request(`/api/v1/agent/threads/${result.thread}`)).runs[0];
    expect(recovered.action.status).toBe('uncertain');expect(recovered.action.receipt.message).toContain('verify');
    const confirmation=await student.request(`/api/v1/agent/threads/${result.thread}/actions/${result.run.action.id}`,{decision:'confirm'});
    expect(confirmation.status).toBe('uncertain');
    expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[target])).rows[0].read_at).toBeNull();
  });
  it('records a supplied attendance observation despite newly issued offline snapshot timestamps',async()=>{
    const session=new Session();await session.login('admin');const result=await run(session,'Record explicit test attendance: I observed all learners in the first open class present.','principal');
    expect(result.run.status).toBe('confirmation');
    const decision=await session.request(`/api/v1/agent/threads/${result.thread}/actions/${result.run.action.id}`,{decision:'confirm'});
    expect(decision.status).toBe('succeeded');
    expect(decision.receipt.href).toContain('/principal/attendance?class_section_id=');
    const input=result.run.action.input.body;const register=await session.request(`/api/v1/screens/teacher/attendance?class_section_id=${input.class_section_id}&date=${input.date}`);
    expect(register.roster.find((item:any)=>item.id===input.records[0].student_id).status).toBe('present');
  });
  it('respects the staff AI gate and can operate after a scoped administrator grant',async()=>{
    const teacher=new Session();await teacher.login('staff');const me=await teacher.request('/api/v1/auth/session/');
    const initial=await teacher.raw('/api/v1/agent/status?portal=teacher');
    const admin=new Session();await admin.login('admin');
    const today=(await pool.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text today")).rows[0].today;
    let grant:string|undefined;
    if(initial.status===403){
      grant=(await admin.request(`/api/v1/schools/${me.user.active_school_id}/roles/members/${me.user.id}/exceptions`,{permission:'ai.use',reason:'Isolated agent integration verification',scope_kind:'institution',valid_from:today,valid_until:today})).id;
    }else expect(initial.status).toBe(200);
    try{
      await notification(teacher);const result=await run(teacher,'Mark the test notification read','teacher');expect(result.run.status).toBe('confirmation');
      expect((await teacher.request(`/api/v1/agent/threads/${result.thread}/actions/${result.run.action.id}`,{decision:'confirm'})).status).toBe('succeeded');
    }finally{if(grant)await admin.request(`/api/v1/schools/${me.user.active_school_id}/roles/exceptions/${grant}/revoke`,{expected_revision:1,reason:'Isolated verification completed'});}
  });
});
