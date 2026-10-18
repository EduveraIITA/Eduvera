import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock3, ShieldCheck, UserRound, X } from 'lucide-react';
import { gateCommand, getVisitorApprovals, type Visitor } from './api';
import { gateError } from './gateError';

export function GateApprovalInbox({hindi}:{hindi:boolean}) {
  const client=useQueryClient();
  const [error,setError]=useState('');
  const query=useQuery({queryKey:['gate-approvals'],queryFn:({signal})=>getVisitorApprovals(signal),staleTime:0,refetchOnWindowFocus:true,refetchInterval:30_000,retry:false});
  async function decide(visitor:Visitor,action:'approve'|'deny') {
    setError('');
    try {
      await gateCommand(visitor.school_id,`visitors/${visitor.id}/${action}`,{expected_revision:visitor.revision});
      await client.invalidateQueries({queryKey:['gate-approvals']});
      await client.invalidateQueries({queryKey:['gate']});
    } catch(error) {
      setError(gateError(error,hindi,hindi?'निर्णय की पुष्टि नहीं हुई। फिर कोशिश करें।':'Could not confirm this decision. Refresh and retry.'));
      await query.refetch();
    }
  }
  return <section className="gate-approvals" aria-labelledby="gate-approvals-title">
    <header className="gate-section-heading"><span className="gate-section-icon"><Clock3 size={22}/></span><div><h2 id="gate-approvals-title">{hindi?'आगंतुक अनुमतियाँ':'Pending approvals'}</h2><p>{hindi?'आपसे मिलने आए लोगों के अनुरोध।':'Visitor requests addressed to you.'}</p></div></header>
    {query.isLoading?<div className="gate-approval-skeleton" aria-busy="true"><span/><span/><span/></div>:null}
    {query.isError?<div className="gate-visitor-empty" role="alert"><ShieldCheck size={28}/><h3>{hindi?'अनुमतियाँ लोड नहीं हुईं':'Approvals could not load'}</h3><p>{hindi?'कनेक्शन जाँचें और फिर कोशिश करें।':'Check your connection and try again.'}</p><button onClick={()=>void query.refetch()}>{hindi?'फिर कोशिश करें':'Retry'}</button></div>:null}
    {error?<p className="gate-error" role="alert">{error}</p>:null}
    {query.isSuccess&&!query.data?.length?<div className="gate-visitor-empty" role="status"><ShieldCheck size={28}/><h3>{hindi?'कोई लंबित अनुरोध नहीं':'No pending requests'}</h3><p>{hindi?'नए अनुरोध यहाँ दिखाई देंगे।':'New requests addressed to you will appear here.'}</p></div>:null}
    <div className="gate-approval-list">{query.data?.map(visitor=><article className="gate-approval-row" key={`${visitor.school_id}:${visitor.id}`}>
      <div className="gate-approval-photo">{visitor.photo_url?<img src={visitor.photo_url} alt={hindi?`${visitor.name} की फोटो`:`Photo of ${visitor.name}`}/>:<UserRound size={20}/>}</div>
      <div className="gate-approval-copy"><strong>{visitor.name}</strong><small>{visitor.category==='guest'?(hindi?'अतिथि':'Guest'):(visitor.category??(hindi?'आगंतुक':'Visitor'))}{visitor.purpose?` · ${visitor.purpose}`:''}</small><small>{visitor.school_name||visitor.host_name||''}</small></div>
      <span className="gate-approval-age">{visitor.created_at?new Intl.DateTimeFormat(hindi?'hi-IN':'en-IN',{hour:'numeric',minute:'2-digit'}).format(new Date(visitor.created_at)):''}</span>
      <div className="gate-approval-row-actions"><button className="is-decline" disabled={query.isFetching} onClick={()=>void decide(visitor,'deny')}><X size={16}/>{hindi?'अस्वीकार':'Decline'}</button><button className="is-approve" disabled={query.isFetching} onClick={()=>void decide(visitor,'approve')}><Check size={16}/>{hindi?'स्वीकार':'Approve'}</button></div>
    </article>)}</div>
  </section>;
}
