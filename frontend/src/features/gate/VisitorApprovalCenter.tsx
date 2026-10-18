import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { authDestination, useOptionalAuth } from '../auth/AuthContext';
import { gateApprovalsQueryKey, gateCommand, getVisitorApprovals, type Visitor } from './api';
import { VisitorApprovalPrompt } from './VisitorApprovalPrompt';
import { gateError } from './gateError';
import './visitor-approvals.css';

export function VisitorApprovalCenter() {
  const auth=useOptionalAuth();
  if(auth?.status!=='authenticated'||!auth.user||auth.user.email_verified===false||auth.publicDemo||!auth.memberships.some(m=>m.role==='staff'||m.role==='admin'))return null;
  const home=authDestination(auth);
  if(!['/teacher','/principal','/workspace','/gate','/parent/home','/student','/company'].includes(home))return null;
  return <ApprovalInbox key={`${auth.user.id}:${auth.user.active_school_id??''}`} home={home} />;
}

function ApprovalInbox({home}:{home:string}) {
  const auth=useOptionalAuth()!;const client=useQueryClient();const location=useLocation();const navigate=useNavigate();
  const [dismissed,setDismissed]=useState<string[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState<{id:string;message:string}|null>(null);
  const [outcome,setOutcome]=useState<{visitor:Visitor;action:'approve'|'deny'}|null>(null);
  const isHome=location.pathname.replace(/\/$/,'')===home;
  const queryKey=gateApprovalsQueryKey(auth.user?.id,auth.user?.active_school_id);
  const query=useQuery({queryKey,queryFn:({signal})=>getVisitorApprovals(signal),enabled:isHome,staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:true,refetchInterval:isHome?30000:false,retry:false});
  const marker=new URLSearchParams(location.search).get('visitor_request');
  const requested=marker&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(marker)?marker:null;
  // Notification links always open on the user's real home, never over a tool,
  // login or security screen. Do not retain the notification's return-to tool.
  useEffect(()=>{
    if(requested&&!isHome)void navigate({pathname:home,search:`?visitor_request=${requested}`},{replace:true,state:null});
  },[home,isHome,navigate,requested]);
  useEffect(()=>{
    if(!outcome)return;
    const timer=window.setTimeout(()=>setOutcome(null),1200);
    return()=>window.clearTimeout(timer);
  },[outcome]);
  const visitor=outcome?.visitor??query.data?.find(v=>v.id===requested)??query.data?.find(v=>!dismissed.includes(v.id));
  const member=auth.memberships.find(m=>m.school_id===visitor?.school_id);
  const hindi=Boolean(member?.permissions?.includes('gate.manage')&&localStorage.getItem(`eduera:gate-language:${auth.user?.id}:${member.school_id}`)==='hi');
  function clearMarker(){const params=new URLSearchParams(location.search);params.delete('visitor_request');void navigate({pathname:home,search:params.toString()},{replace:true,state:null});}
  function later(){if(!visitor||busy)return;setDismissed(ids=>[...ids,visitor.id]);setError(null);clearMarker();}
  async function decide(action:'approve'|'deny') {
    if(!visitor||busy||query.isError||outcome||!isHome)return;setBusy(true);setError(null);
    try {
      await gateCommand(visitor.school_id,`visitors/${visitor.id}/${action}`,{expected_revision:visitor.revision});
      setOutcome({visitor,action});
      setDismissed(ids=>[...ids,visitor.id]);
      client.setQueryData<Visitor[]>(queryKey,rows=>rows?.filter(row=>row.id!==visitor.id));
      clearMarker();
      for(const key of ['gate-approvals','gate','gate-admin','notifications'])void client.invalidateQueries({queryKey:[key]});
    }catch(failure){setError({id:visitor.id,message:gateError(failure,hindi,hindi?'निर्णय की पुष्टि नहीं हुई। फिर कोशिश करें।':'Could not confirm your decision. Retry after checking the request.')});void query.refetch();}
    finally{setBusy(false);}
  }
  if(!isHome||!visitor)return null;
  const message=query.isError?(hindi?'अनुरोध लोड नहीं हुआ। फिर कोशिश करें।':'Unable to refresh this request. Check the connection and retry.'):error?.id===visitor.id?error.message:'';
  return <VisitorApprovalPrompt key={visitor.id} visitor={visitor} hindi={hindi} busy={busy} error={message} outcome={outcome?.action??null} onComplete={()=>setOutcome(null)} onLater={later} onDecide={action=>void decide(action)} onRetry={()=>{setError(null);void query.refetch();}}/>;
}
