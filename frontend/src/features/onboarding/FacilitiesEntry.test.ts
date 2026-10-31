import { expect, it } from 'vitest';
import { capabilityReadinessPresentation } from './capabilityReadinessPresentation';
import { goalIconNames } from './StartingPoints';
import type { CapabilityReadiness, FacilitiesOperationReadiness } from './progressive-api';

it('offers Repairs without calling configured intake a completed repair',()=>{
  const item:CapabilityReadiness={capability:'facilities',label:'Repairs',status:'working',destination:'/areas/facilities',
    setup_path:'/more/setup/capabilities?task=facilities',counts:{},missing:[]};
  expect(goalIconNames.facilities).toBe('facilities');
  expect(capabilityReadinessPresentation(item)).toEqual({description:'Report a problem and follow its repair.',action:'Open repairs'});
  expect(capabilityReadinessPresentation({...item,status:'needs_setup',missing:[{key:'handler',label:'Repair handler',
    reason:'Choose an accountable handler.',destination:'/areas/facilities'}]})).toEqual({description:'Choose an accountable handler.',action:'Set up repairs'});
});
it.each([
  ['needs_intake','configure','Set up repairs'],['ready_to_report','report','Report a problem'],
  ['repair_recorded','view','Open reported repair'],['unavailable','unavailable','Review repair access'],
] as const)('describes %s without inventing repair completion',(state,action,label)=>{
  const operation:FacilitiesOperationReadiness={actor_user_id:'actor',environment_namespace_id:'live:campus',state,action,
    scope:state==='repair_recorded'?{kind:'repair',id:'source'}:null,source_revision:state==='repair_recorded'?2:null,
    evaluated_at:'2026-10-24T10:00:00Z',requires_recheck:true,destination:'/areas/facilities'};
  expect(capabilityReadinessPresentation({capability:'facilities',label:'Repairs',status:'needs_setup',destination:operation.destination,
    setup_path:'/more/setup/capabilities?task=facilities',counts:{},missing:[],facilities_operation:operation}).action).toBe(label);
});
