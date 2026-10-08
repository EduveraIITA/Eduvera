import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { CreateFeedback } from './CreateFeedback';
import { FeedbackResults } from './FeedbackResults';
import { closeCampaign, getWorkspace } from './api';
import './teacher-feedback.css';
export default function PrincipalFeedbackPage() {
  const auth=useAuth();const client=useQueryClient();
  const school=auth.memberships.find(m=>m.role==='admin'&&(!auth.user?.active_school_id||m.school_id===auth.user.active_school_id))?.school_id??'';
  const query=useQuery({queryKey:['teacher-feedback','workspace',school],queryFn:()=>getWorkspace(school),enabled:Boolean(school),refetchInterval:30000});
  const [creating,setCreating]=useState(false);const [selected,setSelected]=useState('');const [closing,setClosing]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function close(id:string){setBusy(true);setError('');try{await closeCampaign(school,id);setClosing('');await client.invalidateQueries({queryKey:['teacher-feedback']});}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  return <OperationsShell portal="principal" active="more" title="Teacher feedback"><div className="teacher-feedback">
    <header className="teacher-feedback__heading"><div><h1>Small check-ins. Better teaching.</h1><p>Ask a class what is working and where support could help.</p></div><button className="teacher-feedback__primary" disabled={!query.data||creating} onClick={()=>setCreating(true)}>Ask for feedback</button></header>
    {!school?<p role="alert">Select an institution with principal administrator access.</p>:query.isPending?<p role="status">Loading feedback requests…</p>:query.error?<div role="alert"><p>{query.error.message}</p><button onClick={()=>void query.refetch()}>Try again</button></div>:query.data?<>
      {creating?<CreateFeedback school={school} data={query.data} onCancel={()=>setCreating(false)} onCreated={async()=>{setCreating(false);await query.refetch();}}/>:null}
      {error?<p role="alert">{error}</p>:null}
      {!query.data.campaigns.length?<section className="teacher-feedback__card"><h2>No feedback requests yet</h2><p>Start with a few focused parameters. Students or parents can respond in under a minute.</p></section>:query.data.campaigns.map(c=><section className="teacher-feedback__card" key={c.id}>
        <div className="teacher-feedback__result-heading"><div><h2>{c.title}</h2><p>{c.teacher_name} · Class {c.class_name} · {c.audience}</p></div><span className="teacher-feedback__status">{c.is_closed?'Closed':'Open'}</span></div>
        <p>{c.response_count} responses · Closes {new Date(c.closes_at).toLocaleString()}</p>
        <div className="teacher-feedback__actions"><button aria-expanded={selected===c.id} onClick={()=>setSelected(selected===c.id?'':c.id)}>{selected===c.id?'Hide results':'View results'}</button>{!c.is_closed?<button onClick={()=>setClosing(c.id)}>Close request</button>:null}</div>
        {closing===c.id?<div className="teacher-feedback__confirm"><p>Close this request now? New responses will stop and it cannot be reopened.</p><button disabled={busy} onClick={()=>void close(c.id)}>{busy?'Closing…':'Yes, close request'}</button><button disabled={busy} onClick={()=>setClosing('')}>Keep open</button></div>:null}
        {selected===c.id?<FeedbackResults school={school} id={c.id}/>:null}
      </section>)}
    </>:null}
  </div></OperationsShell>;
}
