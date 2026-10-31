import { randomUUID } from 'node:crypto';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { acceptWithRecipientProof } from './invitation-recipient-proof.test-support.js';
import { type createResourceLoanFixture,resourceLoanRequest } from './resource-loans.test-support.js';

/** Explicit fictional administrative reader; no implicit custody until the native handover. */
export async function addResourceCustodian(f:Awaited<ReturnType<typeof createResourceLoanFixture>>) {
 const person=await f.people.create(resourceLoanRequest(f.user),f.schoolId,{first_name:'Farah',last_name:'Successor',idempotency_key:randomUUID()});
 const email=`resource-successor-${randomUUID()}@example.test`;
 const invitation=await f.operations.invite(f.user,f.schoolId,{role:'member',person_id:person.id,email,idempotency_key:randomUUID()});
 await acceptWithRecipientProof(f.operations,{email,token:invitation.token,password:'Q4!mT9x#7zB2vL6p',first_name:'Farah',last_name:'Successor'});
 const account=await f.db.selectFrom('users').select(['id','username','email','first_name','last_name','role','is_active']).where('email','=',email).executeTakeFirstOrThrow();
 await f.db.updateTable('school_memberships').set({role:'admin'}).where('school_id','=',f.schoolId).where('user_id','=',account.id).execute();
 const now=new Date(Date.now()+1000).toISOString(),user={...account,active_school_id:f.schoolId};
 const run=<T>(fn:()=>Promise<T>)=>executionEnvironmentStorage.run(createLiveExecutionEnvironment({institution_id:f.schoolId,clock:{now:()=>new Date(now),nowIso:()=>now}}),fn);
 return {user,personId:person.id,now,run};
}
