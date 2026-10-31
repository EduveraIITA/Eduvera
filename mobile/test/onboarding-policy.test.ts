import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityDestination, currentSetup, selectedStartingGoals, setupDestination, setupGateBody, startingGoalsBody } from '../src/lib/onboarding-policy';
import type { ProgressiveSetup, ProgressiveWorkspace } from '../../packages/contracts/src/onboarding';
const workspace = { workspace: { id:'school' }, goals:{ selected:[],primary:null }, catalogue:[{key:'attendance',selection_kind:'goal'},{key:'gate',selection_kind:'goal'},{key:'whole_campus',selection_kind:'shortcut'},{key:'explore',selection_kind:'demo'}] } as unknown as ProgressiveWorkspace;
const setup = { school_id:'school', options:{ gates:[{id:'gate',label:'Gate'}], staff:[{id:'staff',label:'Staff'},{id:'actor',label:'You'}] } } as unknown as ProgressiveSetup;
test('starting goals accept only current catalogue goals and keep one explicit first choice',()=>{
 assert.deepEqual(selectedStartingGoals(['attendance','whole_campus','gate','gate','explore','old'],workspace),['attendance','gate']);
 assert.deepEqual(startingGoalsBody(['attendance','gate'],'gate',workspace),{goals:['gate','attendance'],primary:'gate'});
 assert.throws(()=>startingGoalsBody(['attendance'],'whole_campus',workspace));
});
test('setup never substitutes another active campus or an external destination',()=>{
 assert.equal(currentSetup(workspace,setup,'school'),setup);
 assert.equal(currentSetup(workspace,setup,'other'),null);
 assert.equal(currentSetup(workspace,{...setup,school_id:'other'},'school'),null);
 for(const href of ['https://evil.test/areas','//evil.test/more','/areas/../company','/company','/login','/more/setup#token']) assert.throws(()=>setupDestination(href));
 assert.equal(setupDestination('/areas/timetable/planning?create=attendance'),'/areas/timetable/planning?create=attendance');
});
test('gate setup requires a current choice and explicit operator responsibility',()=>{
 assert.throws(()=>setupGateBody('Gate','','self',false,setup,'actor'));
 assert.throws(()=>setupGateBody('Gate','missing','self',true,setup,'actor'));
 assert.throws(()=>setupGateBody('Gate','','actor',false,setup,'actor'));
 assert.throws(()=>setupGateBody('Gate','','unassigned',false,setup,'actor'));
 assert.deepEqual(setupGateBody('Gate','gate','staff',false,setup,'actor'),{existing_gate_id:'gate',operator:{kind:'staff',user_id:'staff'}});
 assert.deepEqual(setupGateBody(' North entrance ','','self',true,setup,'actor'),{gate_name:'North entrance',operator:{kind:'current_user',confirm:true}});
});
test('current source-owned setup continues to its owner rather than another setup editor',()=>{
 assert.equal(capabilityDestination({capability:'fees',fees_operation:{destination:'/areas/fees/ledger?invoice=one'}} as never),'/areas/fees/ledger?invoice=one');
 assert.throws(()=>capabilityDestination({capability:'fees',fees_operation:{destination:'//foreign/areas'}} as never));
});


test('starting-point requests match the owning provision/update schemas, including existing purpose-required workspaces', async()=>{
 const {startingGoalsRequest}=await import('../src/lib/onboarding-policy');
 const {provisionWorkspaceSchema,updateStartingGoalsSchema}=await import('../../backend/src/institution-onboarding/progressive-onboarding.contracts');
 const catalogue=[{key:'gate',selection_kind:'goal'},{key:'attendance',selection_kind:'goal'}];
 for(const status of ['purpose_required','ready']){
  const request=startingGoalsRequest(['attendance','gate'],'gate',{workspace:{id:'existing'},status,catalogue} as any,'Asia/Kolkata');
  assert.equal(request.method,'PUT');assert.equal(request.path,'/api/v1/onboarding/goals/');assert.equal(updateStartingGoalsSchema.safeParse(request.body).success,true);assert.equal('timezone' in request.body,false);
 }
 const request=startingGoalsRequest(['attendance','gate'],'gate',{workspace:null,status:'workspace_required',catalogue} as any,'Asia/Kolkata');
 assert.equal(request.method,'POST');assert.equal(provisionWorkspaceSchema.safeParse(request.body).success,true);assert.equal('primary' in request.body,false);assert.deepEqual(request.body.goals,['gate','attendance']);
});
