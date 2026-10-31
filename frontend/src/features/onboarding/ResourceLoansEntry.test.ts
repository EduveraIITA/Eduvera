import { describe, expect, it } from 'vitest';
import { capabilityReadinessPresentation } from './capabilityReadinessPresentation';
import { goalIconNames } from './StartingPoints';
import type { CapabilityReadiness, ResourceLoansOperationReadiness } from './progressive-api';

describe('Resources progressive entry',()=>{
  it.each([
    ['ready_to_issue','Issue an item'],['loan_recorded','Open recorded loan'],
    ['borrower_view','Open my borrowing'],['unavailable','Review borrowing access'],
  ] as const)('explains the actual %s state without claiming setup or a report is completed custody',(state,action)=>{
    const operation:ResourceLoansOperationReadiness={actor_user_id:'actor',environment_namespace_id:'live:campus',
      action:state==='unavailable'?'unavailable':state==='ready_to_issue'?'issue':'view',state,
      scope:null,source_revision:null,evaluated_at:'2026-10-24T10:00:00Z',requires_recheck:true,destination:'/areas/resources'};
    const capability:CapabilityReadiness={capability:'resources',label:'Resources & borrowing',status:'needs_setup',
      destination:operation.destination,setup_path:'/more/setup/capabilities?task=resources',counts:{},missing:[],resources_operation:operation};
    expect(capabilityReadinessPresentation(capability).action).toBe(action);
    expect(goalIconNames.resources).toBe('resources');
  });
});
