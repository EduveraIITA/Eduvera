import { useQuery } from '@tanstack/react-query';
import { BarChart3, CircleCheck, LockKeyhole, MessageCircle, Users } from 'lucide-react';
import { getResults } from './api';
import { FeedbackHistory, RatingMix, ResponseActivity } from './FeedbackCharts';
import { ParameterRatings } from './ParameterRatings';
import { feedbackOverview, nextStep, percent } from './feedback-analytics';
import './feedback-results.css';
export function FeedbackResults({ school, id }: { school: string; id: string }) {
  const query = useQuery({ queryKey: ['teacher-feedback', 'results', school, id], queryFn: () => getResults(school, id),
    refetchInterval: q => q.state.data?.campaign.is_closed ? false : 30000 });
  if (query.isPending) return <div className="teacher-feedback__results feedback-dashboard" role="status" aria-busy="true"><p>Loading feedback…</p><div className="feedback-skeleton" /></div>;
  if (query.error) return <div role="alert"><p>{query.error.message}</p><button onClick={() => void query.refetch()}>Retry results</button></div>;
  const data = query.data, minimum = data.minimum_responses ?? 5, overview = feedbackOverview(data.available ? data.parameters : []);
  return <section className="teacher-feedback__results feedback-dashboard" aria-label="Feedback results" id={`feedback-results-${id}`}>
    <div className="feedback-panel__heading"><h3><BarChart3 size={20} aria-hidden="true" /> Feedback results</h3><span className="teacher-feedback__status">{data.campaign.is_closed ? 'Closed' : 'Collecting'}</span></div>
    {data.demo_preview ? <p className="feedback-demo" role="status">Demo preview · results appear after 1 response, even while open. This small sample is for demonstration only.</p> : null}
    <div className="feedback-metrics">
      <div><Users size={18} aria-hidden="true" /><strong>{data.response_count}</strong><span>{data.response_count === 1 ? 'Response' : 'Responses'}</span></div>
      <div><CircleCheck size={18} aria-hidden="true" /><strong>{data.available ? overview.strengths.length : '—'}</strong><span>Strengths</span></div>
      <div><MessageCircle size={18} aria-hidden="true" /><strong>{data.available ? overview.priorities.length : '—'}</strong><span>To discuss</span></div>
    </div>
    {!data.available ? <div className="feedback-locked" role="status"><LockKeyhole size={22} aria-hidden="true" /><div><h4>{!data.campaign.is_closed ? 'Collecting a clearer picture' : 'More responses needed'}</h4><p>{data.demo_preview ? 'Submit one demo response to see the charts.' : !data.campaign.is_closed ? 'Results unlock when this request closes.' : 'At least 5 responses are needed to show results.'}</p><p>{data.response_count < minimum ? `${minimum - data.response_count} more response${minimum - data.response_count === 1 ? '' : 's'} needed to reach the minimum. ` : ''}Each parameter also needs {minimum} Low, Okay or High {minimum === 1 ? 'rating' : 'ratings'}.{data.campaign.is_closed ? ' This request is closed; start a new round to collect more feedback.' : ''}</p></div></div> : <>
      <RatingMix parameters={data.parameters} minimum={minimum} />
      <ParameterRatings parameters={data.parameters} minimum={minimum} />
      <section className="feedback-panel"><h4>What to take forward</h4>
        {overview.priorities.length ? overview.priorities.map(p => <div className="feedback-takeaway feedback-takeaway--review" key={p.parameter}><MessageCircle size={18} aria-hidden="true" /><div><strong>{p.parameter}</strong><p>{percent(p.counts!.low, p.rated)}% Low from {p.rated} {p.rated === 1 ? 'rating' : 'ratings'}. {nextStep(p.parameter)}</p></div></div>) : <p>{overview.visible ? 'No published parameter meets the discussion threshold in this round. Keep listening as you review the mixed feedback.' : 'No parameter has enough ratings for an insight yet.'}</p>}
        {overview.strengths.map(p => <div className="feedback-takeaway feedback-takeaway--strength" key={p.parameter}><CircleCheck size={18} aria-hidden="true" /><div><strong>{p.parameter}</strong><p>{percent(p.counts!.high, p.rated)}% High from {p.rated} {p.rated === 1 ? 'rating' : 'ratings'}. Recognise what is working and ask the teacher which practices to continue.</p></div></div>)}
        <p className="feedback-footnote">Discussion signals start at 40% Low; strengths at 70% High. These are prompts for a supportive conversation, not a performance verdict.</p>
      </section>
      <FeedbackHistory history={data.history ?? []} minimum={minimum} />
    </>}
    <ResponseActivity activity={data.activity ?? []} />
    <p className="feedback-footnote">{data.demo_preview ? 'Demo response counts are shown without respondent names.' : 'Only grouped feedback is shown. No respondent names or individual answers appear here.'}</p>
  </section>;
}
