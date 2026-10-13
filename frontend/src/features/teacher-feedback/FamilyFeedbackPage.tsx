import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ParentShell } from '../../pages/parent/ParentShell';
import { StudentShell } from '../../pages/student/StudentShell';
import { getPending } from './api';
import { RespondFeedback } from './RespondFeedback';
import { useSearchParams } from 'react-router-dom';
import './teacher-feedback.css';
export default function FamilyFeedbackPage({portal}:{portal:'parent'|'student'}) {
  const [params]=useSearchParams();
  const auth=useAuth();const school=auth.user?.active_school_id??auth.memberships.find(m=>m.role===(portal==='parent'?'guardian':'student'))?.school_id??'';
  const focusCampaignId=params.get('campaign');
  const query=useQuery({queryKey:['teacher-feedback','pending',school,auth.user?.id],queryFn:()=>getPending(school),enabled:Boolean(school),refetchInterval:30000});
  const campaigns=query.data?.campaigns.filter(c=>c.audience===(portal==='parent'?'parents':'students'))??[];
  const focusUnavailable=Boolean(focusCampaignId&&query.isSuccess&&!campaigns.some(c=>c.id===focusCampaignId));
  const content=<div className="teacher-feedback"><header><h2>A quick teaching check-in</h2><p>Your experience can help your school improve.</p></header>
    {focusUnavailable?<p className="teacher-feedback__status" role="alert">This feedback request is no longer open for your profile.</p>:null}
    {!school?<p role="alert">Select your institution to see feedback requests.</p>:query.isPending?<p role="status">Loading your feedback requests…</p>:query.error?<div role="alert"><p>{query.error.message}</p><button onClick={()=>void query.refetch()}>Try again</button></div>:campaigns.length?campaigns.map(c=><RespondFeedback key={c.id} school={school} campaign={c} focused={c.id===focusCampaignId} onSubmitted={async()=>{await query.refetch();}}/>):<section className="teacher-feedback__card"><h2>You're all caught up</h2><p>When your principal asks for feedback, it will appear here.</p></section>}
  </div>;
  return portal==='parent'?<ParentShell active="more" pageLabel="Teacher feedback">{content}</ParentShell>:<StudentShell activeNav="launcher" pageTitle="Teacher feedback">{content}</StudentShell>;
}
