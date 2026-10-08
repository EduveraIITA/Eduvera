import { useQuery } from '@tanstack/react-query';
import { getResults } from './api';
const signalLabels:Record<string,string>={insufficient:'Not enough ratings',review:'Needs a conversation',strength:'Strength',mixed:'Mixed feedback'};
export function FeedbackResults({school,id}:{school:string;id:string}) {
  const query=useQuery({queryKey:['teacher-feedback','results',school,id],queryFn:()=>getResults(school,id)});
  if(query.isPending)return <p role="status">Loading feedback…</p>;
  if(query.error)return <div role="alert"><p>{query.error.message}</p><button onClick={()=>void query.refetch()}>Retry results</button></div>;
  const data=query.data;
  return <section className="teacher-feedback__results" aria-label="Feedback results">
    <p>{data.response_count} responses · {data.campaign.is_closed?'Closed':'Collecting feedback'}</p>
    {!data.available?<p role="status">{!data.campaign.is_closed?'Results unlock when this request closes.':'At least 5 responses are needed to show results.'}</p>:<>
      {data.parameters.map(p=><article key={p.parameter}><div className="teacher-feedback__result-heading"><h3>{p.parameter}</h3><span className={`teacher-feedback__signal teacher-feedback__signal--${p.signal}`}>{signalLabels[p.signal]}</span></div>
        {p.counts?<><div className="teacher-feedback__bars" aria-hidden="true">{(['low','okay','high'] as const).map(r=><span key={r} className={`teacher-feedback__bar--${r}`} style={{flexGrow:p.counts![r]}}/>)}</div><p>Low {p.counts.low} · Okay {p.counts.okay} · High {p.counts.high} · Not sure {p.counts.na}</p></>:<p>Fewer than 5 ratings; Not sure is excluded.</p>}
      </article>)}<p>Use this feedback to start a supportive conversation. Low = needs improvement, Okay = meets expectations, High = doing well. Review signals start at 40% Low; strengths at 70% High.</p>
    </>}
  </section>;
}
