import { useState } from 'react';
import { useSession } from '../../auth/SessionProvider';
import { useApi } from '../../lib/query';
import { campusPooledRoomResources } from '../../lib/campus-member-presentation';
import { Empty, Loading, Notice, Row, Section } from '../../ui/components';
import { DomainPages, DomainText } from '../ResourcesScreen';

/** Quantities are canonical inventory records, never mapped individual units. */
export function CampusRoomInventory({schoolId,campusId,spaceId}:{schoolId:string;campusId:string;spaceId:string}){
  const session=useSession(),allowed=session.status==='authenticated'&&session.schoolId===schoolId&&!!session.user&&session.memberships.some(row=>row.school_id===schoolId&&row.role==='admin'&&row.access_scope!=='assigned_work');
  if(!allowed)return null;
  if(session.environment.unavailable)return <Notice message="Room resources are unavailable until this Simulation is recovered."/>;
  return <ActiveRoomInventory key={JSON.stringify([session.scopeKey,campusId,spaceId])} {...{schoolId,campusId,spaceId}}/>;
}
function ActiveRoomInventory({schoolId,campusId,spaceId}:{schoolId:string;campusId:string;spaceId:string}){
  const session=useSession(),[page,setPage]=useState(1),params=new URLSearchParams({search:'',page:String(page),space_id:spaceId,tracking_mode:'pooled'}),query=useApi<unknown>(`/api/v1/schools/${encodeURIComponent(schoolId)}/campus-scenes/${encodeURIComponent(campusId)}/resources/?${params}`,{staleTime:15_000,refetchInterval:session.environment.mode==='live'?30_000:false});
  const loading=query.isPending||query.isFetching,data=!loading&&!query.isError?campusPooledRoomResources(query.data,spaceId,page):null;
  return <Section title="Room inventory">{loading?<Loading label="Loading room resources…"/>:!data?<Empty title="Room resources could not be confirmed" onRetry={()=>void query.refetch()}/>:<>{data.items.map(item=><Row key={item.id} title={item.name} detail={`${item.quantity?.toLocaleString()} ${item.unit_label}`} status={item.state==='unavailable'?'Recorded unavailable':undefined}/>)}{!data.items.length?<DomainText>No pooled resources are recorded for this room.</DomainText>:<DomainText>Recorded quantities; individual positions are not mapped.</DomainText>}<DomainPages page={page} hasMore={page*data.page_size<data.total} onChange={setPage}/></>}</Section>;
}
