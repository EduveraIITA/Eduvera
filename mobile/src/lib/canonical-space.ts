import type { CampusSpace, InstitutionSetup } from '../../../packages/contracts/src/institution';
import type { NativePendingAction, NativePendingScope } from './native-pending-action';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export const canonicalSpaceKinds=['hostel','residential_room','building','wing','floor','classroom','laboratory','library','office','auditorium','sports_area','workshop','staff_room','gate','outdoor_area','virtual','other'] as const;
export function canonicalSpaceActionAllowed(action:NativePendingAction,scope:NativePendingScope){
 const root=`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/institution-setup/`;
 if(action.domain!=='resources'||action.endpoint!==`${root}spaces/`||action.refreshPath!==root||action.method!=='POST'||action.replayPolicy!=='same_request'||action.payload.kind!=='json'||action.source?.kind!=='canonical_space_creation'||action.source.sourceId!==scope.schoolId||action.source.revision!==0)return false;
 const b=JSON.parse(action.payload.body) as Record<string,unknown>;
 return Object.keys(b).every(k=>['name','code','kind','parent_space_id','campus_id','capacity','is_accessible','is_bookable','status','create_campus_if_missing','idempotency_key'].includes(k))&&b.idempotency_key===action.clientId&&b.create_campus_if_missing===true&&typeof b.name==='string'&&b.name.trim().length>=2&&b.name.length<=160&&typeof b.code==='string'&&/^PLACE_[0-9A-F]{32}$/.test(b.code)&&canonicalSpaceKinds.includes(b.kind as never)&&(b.campus_id===undefined||uuid(b.campus_id))&&(b.parent_space_id===null||uuid(b.parent_space_id))&&b.capacity===null&&b.is_accessible===false&&b.is_bookable===false&&b.status==='active';
}
export function canonicalSpaceResult(value:unknown,action:NativePendingAction){
 if(action.payload.kind!=='json')throw new Error('The exact place creation is unavailable.');
 const row=value as CampusSpace|null,body=JSON.parse(action.payload.body) as Record<string,unknown>;
 if(!row||!uuid(row.id)||row.school_id!==action.scope.schoolId||!uuid(row.campus_id)||body.campus_id&&row.campus_id!==body.campus_id||row.name!==body.name||row.code!==body.code||row.kind!==body.kind||row.parent_space_id!==body.parent_space_id||row.revision!==1)throw new Error('The response did not confirm this exact canonical place creation. Keep its original request.');return row;
}
export function canonicalSpaceCurrent(value:InstitutionSetup,action:NativePendingAction){
 if(value.school?.id!==action.scope.schoolId||action.payload.kind!=='json')throw new Error('This campus setup does not match the retained place creation.');
 const body=JSON.parse(action.payload.body) as Record<string,unknown>,matches=value.spaces?.filter(row=>row.code===body.code&&row.name===body.name&&row.kind===body.kind&&row.parent_space_id===body.parent_space_id&&(!body.campus_id||row.campus_id===body.campus_id));
 if(matches?.length!==1||!uuid(matches[0]!.id)||matches[0]!.school_id!==action.scope.schoolId)throw new Error('The saved canonical place could not be refreshed exactly. Its accepted request remains retained.');return matches[0]!;
}
