import type { SharedVisitDetail } from '../../../packages/contracts/src/wire/features/gate/visitSharingApi';
import { Disclosure } from '../ui/DomainControls';
import { Notice, Row } from '../ui/components';
import { gateSharedVisitTime, readGateSharedChanges } from './GateSharedVisitPolicy';
export function GateSharedVisitChanges({detail}:{detail:SharedVisitDetail}) {
  let history:ReturnType<typeof readGateSharedChanges>;
  try{history=readGateSharedChanges(detail);}catch(cause){return <Notice tone="warning" message={cause instanceof Error?cause.message:'Shared changes are unavailable.'}/>;}
  if(!history.changes.length)return null;
  const when=(value:string)=>gateSharedVisitTime(value,detail.timezone);
  return <Disclosure title={`Visit changes · ${history.changes.length}`}><Notice message="The visit details above are current. These are earlier plan versions shared with you."/>{history.changes.map(change=><Row key={change.revision} title={change.state==='cancelled'?'Visit cancelled':'Plan updated'} status={`Revision ${change.revision}`} detail={`${when(change.recorded_at)}\n${change.title}\n${when(change.starts_at)} – ${when(change.ends_at)} · ${detail.timezone}\n${change.place_label} · ${change.contact_label}\n${change.party_size} planned ${change.party_size===1?'person':'people'}`}/>)}{history.hasMore?<Notice message="Showing the latest 25 changes available in this shared view. Earlier versions remain in the campus record."/>:null}</Disclosure>;
}
