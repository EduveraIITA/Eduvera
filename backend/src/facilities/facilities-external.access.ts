import { ForbiddenException,NotFoundException } from '@nestjs/common';
import { sql,type Transaction } from 'kysely';
import type { Database } from '../database/types.js';
import { executionNow } from '../campus-model-core/execution-time.runtime.js';
import { facilitiesHref } from './facilities.contracts.js';
type Tx=Transaction<Database>;

/** Technical joining scope is additive; it never downgrades another campus membership. */
export async function facilitiesWorkOnly(tx:Tx,school:string,user:string){
 return Boolean((await sql<{limited:boolean}>`SELECT campus_membership_is_work_only(${school}::uuid,${user}::uuid) AS limited`.execute(tx)).rows[0]?.limited);
}

/** Source-owned invitation authorization. Identity/credential issuance remains People/Auth. */
export async function authorizeExternalInvitation(tx:Tx,input:{school_id:string;repair_id:string;assignment_id:string;person_id:string;actor_user_id:string}){
 const at=executionNow();
 const row=(await sql<{id:string;person_id:string;coordinator_person_id:string;starts_at:Date;ends_at:Date;person_revision:number}>`SELECT access.id,access.person_id,repair.coordinator_person_id,
  access.starts_at,access.ends_at,person.revision AS person_revision FROM facilities_repairs repair
  JOIN facilities_external_assignments access ON access.id=repair.external_assignment_id AND access.school_id=repair.school_id AND access.repair_id=repair.id
  JOIN school_people person ON person.id=access.person_id AND person.school_id=access.school_id AND person.retired_at IS NULL
  WHERE repair.school_id=${input.school_id}::uuid AND repair.id=${input.repair_id}::uuid AND access.id=${input.assignment_id}::uuid
   AND access.person_id=${input.person_id}::uuid AND access.status='granted' AND access.ends_at>${at}::timestamptz AND repair.state<>'closed'
   AND EXISTS(SELECT 1 FROM campus_model_current_account_endpoints(repair.school_id,${input.actor_user_id}::uuid,${at}::timestamptz))
   AND(campus_model_account_person_is_active(repair.school_id,${input.actor_user_id}::uuid,repair.coordinator_person_id,${at}::timestamptz)
    OR facilities_actor_can_manage(repair.school_id,${input.actor_user_id}::uuid) AND NOT EXISTS(SELECT 1 FROM school_people contact WHERE contact.school_id=repair.school_id AND contact.id=repair.coordinator_person_id AND contact.account_user_id IS NOT NULL AND campus_model_account_person_is_active(repair.school_id,contact.account_user_id,contact.id,${at}::timestamptz)))
  FOR SHARE OF repair,person`.execute(tx)).rows[0];
 if(!row)throw new ForbiddenException('This exact technician invitation needs the current repair coordinator and an unexpired assignment.');
 return {school_id:input.school_id,repair_id:input.repair_id,assignment_id:row.id,person_id:row.person_id,
  person_revision:row.person_revision,coordinator_person_id:row.coordinator_person_id,starts_at:row.starts_at.toISOString(),ends_at:row.ends_at.toISOString(),href:facilitiesHref(input.repair_id)};
}

/** A deep link grants nothing; resolve only the exact current authenticated source. */
export async function externalContinuation(tx:Tx,input:{school_id:string;repair_id:string;assignment_id:string;person_id:string;user_id:string}){
 const row=(await sql<{id:string}>`SELECT repair.id FROM facilities_repairs repair
  JOIN facilities_external_assignments access ON access.id=repair.external_assignment_id AND access.school_id=repair.school_id AND access.repair_id=repair.id
  WHERE repair.school_id=${input.school_id}::uuid AND repair.id=${input.repair_id}::uuid AND access.id=${input.assignment_id}::uuid
   AND access.person_id=${input.person_id}::uuid AND access.status='granted' AND access.starts_at<=${executionNow()}::timestamptz AND access.ends_at>${executionNow()}::timestamptz
   AND campus_model_account_person_is_active(repair.school_id,${input.user_id}::uuid,access.person_id,${executionNow()}::timestamptz)`.execute(tx)).rows[0];
 if(!row)throw new NotFoundException('This work access is not currently available. Ask your campus contact to review its dates or assignment.');
 return {school_id:input.school_id,repair_id:row.id,assignment_id:input.assignment_id,href:facilitiesHref(row.id)};
}
