import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useOptionalAuth } from '../auth/AuthContext';
import { getPending } from './api';
import './teacher-feedback.css';
export function FeedbackNudge({portal}:{portal:'student'|'parent'}) {
  const auth=useOptionalAuth();const school=auth?.user?.active_school_id??auth?.memberships.find(m=>m.role===(portal==='parent'?'guardian':'student'))?.school_id??'';
  const query=useQuery({queryKey:['teacher-feedback','pending',school,auth?.user?.id],queryFn:()=>getPending(school),enabled:auth?.status==='authenticated'&&Boolean(school),refetchInterval:60000});
  const count=query.data?.campaigns.filter(c=>!c.submitted&&c.audience===(portal==='parent'?'parents':'students')).length??0;
  if(!count)return null;
  return <aside className="teacher-feedback-nudge"><span><strong>Your principal would like your feedback</strong><small>{count} quick teaching check-in{count===1?'':'s'} · Low, Okay or High</small></span><Link to={`/${portal}/teacher-feedback`}>Give feedback →</Link></aside>;
}
