import { useState, type FormEvent } from 'react';
import { submitFeedback, type Campaign, type Rating } from './api';
import { RatingSelector } from './RatingSelector';
export { ratingLabels } from './RatingSelector';
export function RespondFeedback({school,campaign,onSubmitted}:{school:string;campaign:Campaign;onSubmitted:()=>Promise<void>}) {
  const [ratings,setRatings]=useState<Record<string,Rating>>({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [sent,setSent]=useState(false);
  async function submit(event:FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{await submitFeedback(school,campaign.id,ratings);setSent(true);await onSubmitted();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  if(campaign.submitted||sent)return <section className="teacher-feedback__card" role="status"><h2>Thank you for your feedback</h2><p>{campaign.teacher_name} · {campaign.title}</p><p>Your response has been recorded.</p></section>;
  return <form className="teacher-feedback__card teacher-feedback__form" onSubmit={event=>void submit(event)}>
    <h2>{campaign.teacher_name}</h2><p>{campaign.title} · Class {campaign.class_name}</p>
    <p>Low: needs improvement · Okay: meets expectations · High: doing well. Choose Not sure if you have not observed something.</p>
    {campaign.parameters.map((parameter,index)=><fieldset key={parameter}><legend>{parameter}</legend><RatingSelector name={`${campaign.id}-${index}`} value={ratings[parameter]} disabled={busy} onChange={rating=>setRatings(old=>{const next={...old};if(rating)next[parameter]=rating;else delete next[parameter];return next;})}/></fieldset>)}
    <p>Your account prevents duplicate responses. Your name and individual answers are not shown to teachers or in principal results; authorised system operators can access stored records. Only grouped results appear after closing with at least 5 responses.</p>
    <p>Closes {new Date(campaign.closes_at).toLocaleString()} · One submission per person.</p>
    {error?<p role="alert">{error}</p>:null}<button className="teacher-feedback__primary" disabled={busy||Object.keys(ratings).length!==campaign.parameters.length}>{busy?'Submitting…':'Submit feedback'}</button>
  </form>;
}
