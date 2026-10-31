import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeAuthDestination} from '../src/auth/auth-entry';
import {canRetainSessionPresentation} from '../src/auth/session-presentation';
import type {SessionState} from '../src/auth/session-types';
const session:SessionState={status:'authenticated',user:{id:'actor',username:'actor',email:'',first_name:'',last_name:'',display_name:'',email_verified:true,active_school_id:'campus'},memberships:[{id:'member',school_id:'campus',school_name:'Campus',role:'admin'}],environment:{mode:'live',institution_id:'campus'},error:null,setupRequired:false};
test('entry uses actual company and onboarding authority, never a role label',()=>{
 assert.equal(nativeAuthDestination(session),'/today');
 assert.equal(nativeAuthDestination({...session,companyOperator:true}),'/company');
 assert.equal(nativeAuthDestination({...session,onboarding:{status:'purpose_required'}}),'/onboarding/start');
 assert.equal(nativeAuthDestination({...session,user:{...session.user!,email_verified:false}},'/areas/fees'),'/more/account/security?from=%2Fareas%2Ffees');
 assert.equal(nativeAuthDestination({...session,memberships:[]}),'/onboarding/start');
});
test('entry keeps a valid in-app continuation and rejects external or auth-loop next values',()=>{
 assert.equal(nativeAuthDestination(session,'/join?campus=one'),'/join?campus=one');
 for(const next of ['//evil.test/areas','https://evil.test','/login?next=/login','/signup','/areas/%2fprivate','/more/account#secret']) assert.equal(nativeAuthDestination(session,next),'/today');
});
test('company privilege revocation clears protected presentation on recheck',()=>{
 assert.equal(canRetainSessionPresentation({...session,companyOperator:true},{...session,companyOperator:false}),false);
});
