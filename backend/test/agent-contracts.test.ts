import { describe,expect,it } from 'vitest';
import { CAPABILITIES,availableCapabilities,capabilityTool,findCapabilities,verificationScreen,type AgentScope } from '../src/agent/catalogue.js';
import { assertKnownIds,assertLocalScreen,redactEvidence,stableHash } from '../src/agent/gateway.js';
import { compactModelData } from '../src/agent/agent.service.js';
import { recordReferences, resolveReferences, reportsUnverifiedWrite, schoolDate } from '../src/agent/references.js';
import { attendanceArguments } from '../src/agent/attendance-intent.js';
import { recordRevision } from '../src/agent/revisions.js';
const school='f7169af8-adb8-4342-8d64-7f2131c32348';
const child='a7169af8-adb8-4342-8d64-7f2131c32348';
const scope:AgentScope={userId:school,schoolId:school,portal:'teacher',studentId:null,permissions:['ai.use','attendance.view'],timezone:'Asia/Kolkata'};
describe('agent capability boundary',()=>{
  it('has unique, schema-described operations and no unrestricted executor',()=>{
    expect(new Set(CAPABILITIES.map(cap=>cap.name)).size).toBe(CAPABILITIES.length);
    for(const cap of CAPABILITIES){expect(capabilityTool(cap).parameters).toMatchObject({type:'object',additionalProperties:false});expect(cap.name).toMatch(/^[a-z_]+$/);}
    expect(CAPABILITIES.some(cap=>/sql|shell|browser|fetch_url|execute_code/.test(cap.name))).toBe(false);
  });
  it('does not offer writes outside the current portal or staff grant',()=>{
    const allowed=availableCapabilities(scope).map(cap=>cap.name);
    expect(allowed).toContain('attendance_register');expect(allowed).not.toContain('record_attendance');expect(allowed).not.toContain('create_assessment');expect(allowed).not.toContain('my_attendance');
  });
  it('keeps physical/safety/account decisions out of executable tools',()=>{
    for(const name of ['transport_controls','safeguarding','account_security','attendance_reconciliation'])expect(CAPABILITIES.find(cap=>cap.name===name)?.kind).toBe('handoff');
    expect(CAPABILITIES.filter(cap=>cap.kind==='write').some(cap=>/handover|riders|location|authority|safeguarding|password/.test(cap.name))).toBe(false);
  });
  it('injects child scope and does not accept model-supplied school/child or confirmation flags',()=>{
    const cap=CAPABILITIES.find(cap=>cap.name==='complete_homework')!;
    const input={id:school,body:{},basis_id:child};
    expect(cap.schema.safeParse({...input,body:{student_id:school}}).success).toBe(false);
    expect(cap.schema.safeParse({...input,confirmed:true}).success).toBe(false);
    expect(cap.request!(input,{...scope,portal:'parent',studentId:child},child).body).toEqual({student_id:child});
  });
  it('rejects unobserved identifiers and unsafe screen links',()=>{
    expect(()=>assertKnownIds({id:child},new Set([school]))).toThrow(/Read/);
    for(const path of ['https://example.com','//evil','/api/v1/auth','/principal\\evil'])expect(()=>assertLocalScreen(path)).toThrow();
    expect(assertLocalScreen('/parent/diary?student_id='+child)).toContain(child);
  });
  it('uses simple action fields while the server owns evidence binding',()=>{
    const cap=CAPABILITIES.find(cap=>cap.name==='read_notification')!;
    expect(cap.parseArguments!({record_id:child})).toEqual({id:child,body:{}});
    expect(()=>cap.parseArguments!({record_id:child,basis_id:school})).toThrow();
    expect(capabilityTool(cap).parameters.properties).not.toHaveProperty('body');
    expect(cap.schema.safeParse({id:child,body:{}}).success).toBe(false);
  });
  it('redacts secrets and precise locations from model evidence',()=>{
    expect(redactEvidence({name:'Ride',cookie:'private',nested:{latitude:32,longitude:77,token:'secret',state:'active'}})).toEqual({name:'Ride',nested:{state:'active'}});
  });
  it('excludes volatile offline capture credentials without masking actual roster changes',()=>{
    const snapshot={register:{revision:3},roster:[{id:child,status:'present'}],continuity_snapshot:{captured_at:'a',expires_at:'b',token:'private'}};
    expect(stableHash(redactEvidence(snapshot))).toBe(stableHash(redactEvidence({...snapshot,continuity_snapshot:{captured_at:'c',expires_at:'d',token:'new'}})));
    expect(stableHash(redactEvidence(snapshot))).not.toBe(stableHash(redactEvidence({...snapshot,roster:[{id:child,status:'absent'}]})));
  });
  it('uses stable whole-record snapshot hashes',()=>{
    expect(stableHash({b:2,a:1})).toBe(stableHash({a:1,b:2}));
    expect(stableHash({revision:1})).not.toBe(stableHash({revision:2}));
  });
  it('keeps compact data structured and labels partial collections',()=>{
    const data=compactModelData({summary:{percentage:93},ranking:{large:true},students:Array.from({length:45},(_,id)=>({id,avatar_url:'x'}))}) as any;
    expect(data.summary.percentage).toBe(93);expect(data).not.toHaveProperty('ranking');expect(data.students).toMatchObject({partial:true,total_items:45});expect(data.students.items).toHaveLength(40);
  });
  it('finds attendance tools despite a common spelling error',()=>expect(findCapabilities('attendence',availableCapabilities(scope)).some(cap=>cap.domain==='attendance')).toBe(true));
  it.each(['Can you mark his presence today','Mark Aarav present today','She is absent','Record him late','attendence'])('routes colloquial attendance: %s',question=>{
    const selected=findCapabilities(question,CAPABILITIES).map(cap=>cap.name);
    expect(selected.slice(0,4)).toContain('record_student_attendance');
    expect(selected).not.toContain('save_marks');expect(selected).not.toContain('mark_conversation_read');
  });
  it('routes person lookups and distinguishes academic marks from attendance',()=>{
    expect(findCapabilities('Check about aarav sharma',CAPABILITIES)[0]?.name).toBe('find_students');
    expect(findCapabilities('Save her maths marks',CAPABILITIES).some(cap=>cap.name==='save_marks')).toBe(true);
    expect(findCapabilities('Mark it read',CAPABILITIES,['notifications'])[0]?.name).toBe('notifications');
    expect(findCapabilities('Show his homework',CAPABILITIES,['attendance'])[0]?.domain).toBe('diary');
  });
  it('carries minimal record references and resolves exact unique admission/name aliases',()=>{
    const refs=recordReferences({results:[{id:child,name:'Aarav Sharma',admission_number:'CIS-2023-071',phone:'secret',date_of_birth:'2014-04-09'}]},'find_students');
    expect(JSON.stringify(refs)).not.toContain('secret');expect(JSON.stringify(refs)).not.toContain('2014');
    expect(resolveReferences({student_id:'CIS-2023-071'},refs)).toEqual({student_id:child});
    expect(resolveReferences({record_id:' aarav  sharma '},refs)).toEqual({record_id:child});
    expect(()=>resolveReferences({student_id:'Aarav'},refs)).toThrow(/Look up/);
    expect(()=>resolveReferences({student_id:'Aarav Sharma'},[...refs,{...refs[0]!,id:school}])).toThrow(/More than one/);
    expect(resolveReferences({body:'Aarav Sharma'},refs)).toEqual({body:'Aarav Sharma'});
  });
  it('uses the school-local date at midnight boundaries',()=>{
    expect(schoolDate('Asia/Kolkata',new Date('2026-10-08T19:00:00Z'))).toBe('2026-10-09');
    expect(schoolDate('America/Los_Angeles',new Date('2026-10-09T01:00:00Z'))).toBe('2026-10-08');
  });
  it('grounds student names and rejects invented lookup filters without stripping real names',()=>{
    expect(attendanceArguments({student:'Mark Sharma',class_name:'Class 10'},'Mark Sharma present today',[],'Asia/Kolkata')).toMatchObject({student:'Sharma'});
    expect(attendanceArguments({student:'Ananya Iyer',class_name:'Class 10'},'Mark Ananya Iyer absent',[],'Asia/Kolkata')).not.toHaveProperty('class_name');
    expect(attendanceArguments({student:'Mark Mark Sharma'},'Mark Mark Sharma present',[],'Asia/Kolkata')).toMatchObject({student:'Mark Sharma'});
    expect(attendanceArguments({student:'Sharma',class_name:'Class 7A'},'Mark Sharma from Class 7A present',[],'Asia/Kolkata')).toMatchObject({student:'Sharma',class_name:'Class 7A'});
  });
  it('does not accept model-invented correction reasons or clear existing notes incidentally',()=>{
    const proposed={student:'Aarav Sharma',status:'present',reason:'User requested it',remarks:''};
    const grounded=attendanceArguments(proposed,'Mark Aarav Sharma present today',[],'Asia/Kolkata');
    expect(grounded).not.toHaveProperty('reason');expect(grounded).not.toHaveProperty('remarks');
    expect(attendanceArguments(proposed,'Mark Aarav Sharma present because I entered the wrong status',[],'Asia/Kolkata')).toHaveProperty('reason','I entered the wrong status');
    expect(attendanceArguments(proposed,'I entered the wrong status',[],'Asia/Kolkata',true)).toHaveProperty('reason','I entered the wrong status');
    expect(attendanceArguments(proposed,'Yes',[],'Asia/Kolkata',true)).not.toHaveProperty('reason');
    expect(attendanceArguments(proposed,'Mark Aarav present. Note: Arrived with the school bus',[],'Asia/Kolkata')).toHaveProperty('remarks','Arrived with the school bus');
    expect(attendanceArguments({student:'Aarav Sharma'},'Check Aarav because I need to correct a mistake',[],'Asia/Kolkata')).toEqual({student:'Aarav Sharma'});
  });
  it('detects unverified completion claims without blocking ordinary reads or proposals',()=>{
    expect(reportsUnverifiedWrite("I've marked him present.")).toBe(true);
    expect(reportsUnverifiedWrite('I saved the results.')).toBe(true);
    expect(reportsUnverifiedWrite('I can prepare a change for your review.')).toBe(false);
    expect(reportsUnverifiedWrite('Your attendance is 93%.')).toBe(false);
  });
  it('keeps class, student ID and revision resolution out of the single-student tool contract',()=>{
    const cap=CAPABILITIES.find(cap=>cap.name==='record_student_attendance')!;
    expect(capabilityTool(cap).parameters.properties).not.toHaveProperty('expected_revision');
    const args=cap.parseArguments!({student:'Aarav Sharma',status:'present'});
    const selected={student:{id:child,name:'Aarav Sharma',status:null,remarks:'Existing note'},class:{id:school},register:{state:'draft',revision:7},availability:{can_mark:true}};
    expect(cap.prepare!.bind(args,{date:'2026-10-09',matches:[{id:child}],selected})).toEqual({body:{student_id:child,class_section_id:school,date:'2026-10-09',expected_revision:7,status:'present'}});
    expect(()=>cap.prepare!.bind(args,{matches:[{},{}],selected:null})).toThrow(/Multiple/);
    expect(()=>cap.prepare!.bind(args,{date:'2026-10-09',matches:[{}],selected:{...selected,student:{...selected.student,status:'absent'}}})).toThrow(/reason/);
    expect(()=>cap.prepare!.bind(args,{matches:[{}],selected:{...selected,register:{state:'locked'}}})).toThrow(/locked/);
  });
  it('binds routine write revisions to the exact source record, not model arguments',()=>{
    const cap=CAPABILITIES.find(cap=>cap.name==='publish_event')!;
    expect(capabilityTool(cap).parameters.properties).not.toHaveProperty('expected_revision');
    const result=cap.bindInput!({id:child,body:{}},{event:{id:child,revision:12},other:{id:school,revision:30}}) as any;
    expect(result.body.expected_revision).toBe(12);
    expect(()=>recordRevision({event:{id:school,revision:30}},child)).toThrow(/exact record/);
    expect(()=>recordRevision([{id:child,revision:1},{id:child,revision:2}],child)).toThrow(/unambiguously/);
  });
  it('links receipts to the created record and preserves parent child context',()=>{
    const cap=(name:string)=>CAPABILITIES.find(item=>item.name===name)!;
    expect(verificationScreen(cap('plan_transport_trip'),{body:{}},{...scope,portal:'principal'},{id:child})).toBe('/principal/departure/journeys/'+child);
    expect(verificationScreen(cap('create_staff_profile'),{body:{}},{...scope,portal:'principal'},{id:child})).toBe('/principal/staff/'+child);
    expect(verificationScreen(cap('read_notification'),{id:school},{...scope,portal:'parent',studentId:child})).toBe('/parent/home?notifications=open&student_id='+child);
    expect(verificationScreen(cap('send_message'),{id:school},{...scope,portal:'parent',studentId:child})).toBe('/parent/messages?conversation='+school+'&student_id='+child);
  });
});
