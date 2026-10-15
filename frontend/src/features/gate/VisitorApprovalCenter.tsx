import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOptionalAuth } from '../auth/AuthContext';
import { gateCommand, getVisitorApprovals, type Visitor } from './api';
import { VisitorApprovalPrompt } from './VisitorApprovalPrompt';
import { gateError } from './gateError';
import './visitor-approvals.css';

export function VisitorApprovalCenter() {
  const auth=useOptionalAuth();
  if(auth?.status!=='authenticated'||!auth.user||auth.user.email_verified===false||auth.publicDemo||!auth.memberships.some(m=>m.role==='staff'||m.role==='admin'))return null;
  return <ApprovalInbox key={`${auth.user.id}:${auth.user.active_school_id??''}`} />;
}

function ApprovalInbox() {
  const auth=useOptionalAuth()!;const client=useQueryClient();const location=useLocation();const navigate=useNavigate();
  const [dismissed,setDismissed]=useState<string[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState<{id:string;message:string}|null>(null);
  const queryKey=['gate-approvals',auth.user?.id,auth.user?.active_school_id??'all'];
  const query=useQuery({queryKey,queryFn:({signal})=>getVisitorApprovals(signal),staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:true,refetchInterval:30000,retry:false});
  const requested=new URLSearchParams(location.search).get('visitor_request');
  const visitor=query.data?.find(v=>v.id===requested)??query.data?.find(v=>!dismissed.includes(v.id));
  const member=auth.memberships.find(m=>m.school_id===visitor?.school_id);
  const hindi=Boolean(member?.permissions?.includes('gate.manage')&&localStorage.getItem(`eduera:gate-language:${auth.user?.id}:${member.school_id}`)==='hi');
  function clearMarker(){const params=new URLSearchParams(location.search);if(params.has('visitor_request')){params.delete('visitor_request');void navigate({pathname:location.pathname,search:params.toString()},{replace:true});}}
  function later(){if(!visitor||busy)return;setDismissed(ids=>[...ids,visitor.id]);setError(null);clearMarker();}
  async function decide(action:'approve'|'deny') {
    if(!visitor||busy||query.isError)return;setBusy(true);setError(null);
    try {
      await gateCommand(visitor.school_id,`visitors/${visitor.id}/${action}`,{expected_revision:visitor.revision});
      client.setQueryData<Visitor[]>(queryKey,rows=>rows?.filter(row=>row.id!==visitor.id));
      clearMarker();
      for(const key of ['gate-approvals','gate','gate-admin','notifications'])void client.invalidateQueries({queryKey:[key]});
    }catch(failure){setError({id:visitor.id,message:gateError(failure,hindi,hindi?'निर्णय की पुष्टि नहीं हुई। फिर कोशिश करें।':'Could not confirm your decision. Retry after checking the request.')});void query.refetch();}
    finally{setBusy(false);}
  }
  if(!visitor)return null;
  const message=query.isError?(hindi?'अनुरोध लोड नहीं हुआ। फिर कोशिश करें।':'Unable to refresh this request. Check the connection and retry.'):error?.id===visitor.id?error.message:'';
  return <VisitorApprovalPrompt key={visitor.id} visitor={visitor} hindi={hindi} busy={busy} error={message} onLater={later} onDecide={action=>void decide(action)} onRetry={()=>{setError(null);void query.refetch();}}/>;
}
