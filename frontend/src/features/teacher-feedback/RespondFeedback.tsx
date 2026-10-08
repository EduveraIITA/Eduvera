import { useState, type FormEvent } from 'react';
import { submitFeedback, type Campaign, type Rating } from './api';
export const ratingLabels:Record<Rating,string>={low:'Low',okay:'Okay',high:'High',na:'Not sure'};
export function RespondFeedback({school,campaign,onSubmitted}:{school:string;campaign:Campaign;onSubmitted:()=>Promise<void>}) {
  const [ratings,setRatings]=useState<Record<string,Rating>>({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [sent,setSent]=useState(false);
  async function submit(event:FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{await submitFeedback(school,campaign.id,ratings);setSent(true);await onSubmitted();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  if(campaign.submitted||sent)return <section className="teacher-feedback__card" role="status"><h2>Thank you for your feedback</h2><p>{campaign.teacher_name} · {campaign.title}</p><p>Your response has been recorded.</p></section>;
  return <form className="teacher-feedback__card teacher-feedback__form" onSubmit={event=>void submit(event)}>
    <h2>{campaign.teacher_name}</h2><p>{campaign.title} · Class {campaign.class_name}</p>
    <p>Low: needs improvement · Okay: meets expectations · High: doing well. Choose Not sure if you have not observed something.</p>
    {campaign.parameters.map((parameter,index)=><fieldset key={parameter}><legend>{parameter}</legend><div className="teacher-feedback__ratings" data-selected={ratings[parameter]}>{(Object.keys(ratingLabels) as Rating[]).map(rating=><label key={rating} className={`teacher-feedback__rating teacher-feedback__rating--${rating}${ratings[parameter]===rating?' is-selected':''}`}><input type="radio" name={`${campaign.id}-${index}`} value={rating} checked={ratings[parameter]===rating} required disabled={busy} onChange={()=>setRatings(old=>({...old,[parameter]:rating}))}/><span>{ratingLabels[rating]}</span></label>)}</div></fieldset>)}
    <p>Your account prevents duplicate responses. Your name and individual answers are not shown to teachers or in principal results; authorised system operators can access stored records. Only grouped results appear after closing with at least 5 responses.</p>
    <p>Closes {new Date(campaign.closes_at).toLocaleString()} · One submission per person.</p>
    {error?<p role="alert">{error}</p>:null}<button className="teacher-feedback__primary" disabled={busy||Object.keys(ratings).length!==campaign.parameters.length}>{busy?'Submitting…':'Submit feedback'}</button>
  </form>;
}
