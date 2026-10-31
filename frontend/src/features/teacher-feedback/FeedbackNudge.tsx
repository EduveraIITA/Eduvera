import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ProductIcon } from '../../components/ProductIcon';
import { useOptionalAuth } from '../auth/AuthContext';
import { getPending } from './api';
import './teacher-feedback.css';
export function FeedbackNudge({portal}:{portal:'student'|'parent'}) {
  const auth=useOptionalAuth();const school=auth?.user?.active_school_id??auth?.memberships.find(m=>m.role===(portal==='parent'?'guardian':'student'))?.school_id??'';
  const query=useQuery({queryKey:['teacher-feedback','pending',school,auth?.user?.id],queryFn:()=>getPending(school),enabled:auth?.status==='authenticated'&&Boolean(school),refetchInterval:60000});
  const count=query.data?.campaigns.filter(c=>!c.submitted&&c.audience===(portal==='parent'?'parents':'students')).length??0;
  if(!count)return null;
  const scope=portal==='parent'?'dependent':'self';
  return <aside className="teacher-feedback-nudge"><Link to={`/more/feedback?view=respond&scope=${scope}`} aria-label={`Give teacher feedback, ${count} pending request${count===1?'':'s'}`}><span className="teacher-feedback-nudge__icon" aria-hidden="true"><ProductIcon name="feedback" size={28}/></span><span className="teacher-feedback-nudge__copy"><strong>Teacher feedback</strong><small>{count} request{count===1?'':'s'} pending</small></span><ChevronRight className="teacher-feedback-nudge__arrow" size={20} aria-hidden="true"/></Link></aside>;
}
