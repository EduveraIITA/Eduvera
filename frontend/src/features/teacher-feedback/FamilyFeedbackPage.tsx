import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ParentShell } from '../../pages/parent/ParentShell';
import { StudentShell } from '../../pages/student/StudentShell';
import { getPending } from './api';
import { RespondFeedback } from './RespondFeedback';
import './teacher-feedback.css';
export default function FamilyFeedbackPage({portal}:{portal:'parent'|'student'}) {
  const auth=useAuth();const school=auth.user?.active_school_id??auth.memberships.find(m=>m.role===(portal==='parent'?'guardian':'student'))?.school_id??'';
  const query=useQuery({queryKey:['teacher-feedback','pending',school,auth.user?.id],queryFn:()=>getPending(school),enabled:Boolean(school),refetchInterval:30000});
  const campaigns=query.data?.campaigns.filter(c=>c.audience===(portal==='parent'?'parents':'students'))??[];
  const content=<div className="teacher-feedback"><header><h1>A quick teaching check-in</h1><p>Your experience can help your school improve.</p></header>
    {!school?<p role="alert">Select your institution to see feedback requests.</p>:query.isPending?<p role="status">Loading your feedback requests…</p>:query.error?<div role="alert"><p>{query.error.message}</p><button onClick={()=>void query.refetch()}>Try again</button></div>:campaigns.length?campaigns.map(c=><RespondFeedback key={c.id} school={school} campaign={c} onSubmitted={async()=>{await query.refetch();}}/>):<section className="teacher-feedback__card"><h2>You're all caught up</h2><p>When your principal asks for feedback, it will appear here.</p></section>}
  </div>;
  return portal==='parent'?<ParentShell active="more" pageLabel="Teacher feedback">{content}</ParentShell>:<StudentShell activeNav="launcher" pageTitle="Teacher feedback">{content}</StudentShell>;
}
