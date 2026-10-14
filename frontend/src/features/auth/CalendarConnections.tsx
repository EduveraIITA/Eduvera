import {useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {CalendarSync,Check,Copy,Download,ExternalLink,RefreshCw,Trash2} from 'lucide-react';
import {apiFetch} from '../../lib/api';
import {shiftSchoolDate} from '../../lib/schoolTime';
import type {Portal} from './AuthContext';

interface Subscription {id:string;token_hint:string;created_at:string;last_fetched_at:string|null;revision:number}
interface Status {scope:{portal:Portal;student_id:string|null;calendar_name:string};subscription:Subscription|null}
interface Created extends Subscription {feed_url:string;calendar_name:string}

function parameters(portal:Portal,studentId?:string){
  return new URLSearchParams({portal,...(studentId?{student_id:studentId}:{})});
}
function lastSync(value:string|null){
  if(!value)return 'Waiting for the calendar app to refresh';
  return `Last refreshed ${new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}`;
}

export function CalendarConnections({portal,studentId}:{portal:Portal;studentId?:string}){
  const cache=useQueryClient();const queryString=useMemo(()=>parameters(portal,studentId).toString(),[portal,studentId]);
  const query=useQuery({queryKey:['calendar-connections',portal,studentId??'self'],queryFn:()=>apiFetch<Status>(`/api/v1/calendar-connections?${queryString}`),staleTime:15_000});
  const [created,setCreated]=useState<Created|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [confirm,setConfirm]=useState<'replace'|'disconnect'|null>(null);const [copied,setCopied]=useState(false);
  const subscription=query.data?.subscription??null;
  async function create(){
    setBusy(true);setError('');setCopied(false);
    try{const result=await apiFetch<Created>('/api/v1/calendar-connections/subscriptions',{method:'POST',body:JSON.stringify({portal,...(studentId?{student_id:studentId}:{})})});
      setCreated(result);setConfirm(null);await cache.invalidateQueries({queryKey:['calendar-connections',portal,studentId??'self']});
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not create the calendar connection.');}finally{setBusy(false);}
  }
  async function disconnect(){
    if(!subscription)return;setBusy(true);setError('');
    try{await apiFetch(`/api/v1/calendar-connections/subscriptions/${subscription.id}`,{method:'DELETE'});setCreated(null);setConfirm(null);await cache.invalidateQueries({queryKey:['calendar-connections',portal,studentId??'self']});}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not disconnect the calendar.');}finally{setBusy(false);}
  }
  function download(){
    const query=parameters(portal,studentId);query.set('from',shiftSchoolDate(-7));query.set('to',shiftSchoolDate(360));
    window.location.assign(`/api/v1/calendar-connections/export.ics?${query.toString()}`);
  }
  async function copy(){if(!created)return;try{await navigator.clipboard.writeText(created.feed_url);setCopied(true);}catch{setError('Copy was blocked. Open the calendar app instead.');}}
  function openCalendar(){if(created)window.location.assign(created.feed_url.replace(/^https?:/,'webcal:'));}
  const title=query.data?.scope?.calendar_name??'Edura calendar';
  return <section className="account-profile-group account-calendar" aria-labelledby="calendar-connections-title">
    <div className="account-profile-row account-calendar__heading">
      <span className="account-profile-row__icon"><CalendarSync size={20}/></span>
      <span className="account-profile-row__copy"><strong id="calendar-connections-title">Calendar sync</strong><small>Keep {title} in your installed calendar app</small></span>
    </div>
    {query.isPending?<p className="account-channels__state" role="status">Checking calendar connection…</p>:null}
    {query.isError?<p className="account-channels__state security-alert" role="alert">Could not load calendar sync. <button type="button" onClick={()=>void query.refetch()}>Retry</button></p>:null}
    {!query.isPending&&!query.isError?<div className="account-calendar__body">
      <div className="account-calendar__status">
        <span className={`account-calendar__mark${subscription?' is-connected':''}`} aria-hidden="true">{subscription?<Check size={18}/>:<CalendarSync size={18}/>}</span>
        <span><strong>{subscription?'Subscribed calendar ready':'Connect your calendar'}</strong><small>{subscription?lastSync(subscription.last_fetched_at):'Updates automatically without Google or Microsoft access'}</small></span>
      </div>
      {created?<div className="account-calendar__secret" role="status"><strong>Private link created</strong><p>Open it now or copy it. Edura stores only a fingerprint, so this link is shown once.</p><div>
        <button type="button" onClick={openCalendar}><ExternalLink size={15}/> Open calendar app</button>
        <button type="button" onClick={()=>void copy()}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Copied':'Copy link'}</button>
      </div></div>:null}
      <div className="account-calendar__actions">
        <button type="button" onClick={download}><Download size={15}/> Export .ics</button>
        {!subscription?<button className="is-primary" type="button" disabled={busy} onClick={()=>void create()}><CalendarSync size={15}/> {busy?'Creating…':'Subscribe'}</button>:null}
        {subscription&&confirm===null?<><button type="button" disabled={busy} onClick={()=>setConfirm('replace')}><RefreshCw size={15}/> Replace link</button><button className="is-danger" type="button" disabled={busy} onClick={()=>setConfirm('disconnect')}><Trash2 size={15}/> Disconnect</button></>:null}
      </div>
      {confirm?<div className="account-calendar__confirm" role="alert"><span>{confirm==='replace'?'The old calendar link will stop refreshing.':'The installed calendar will stop receiving updates.'}</span><div><button type="button" onClick={()=>setConfirm(null)}>Keep it</button><button type="button" disabled={busy} onClick={()=>void (confirm==='replace'?create():disconnect())}>{confirm==='replace'?'Replace':'Disconnect'}</button></div></div>:null}
    </div>:null}
    {error?<p className="account-channels__state security-alert" role="alert">{error}</p>:null}
    <p className="account-profile-explainer">Edura sends only the timetable, assessments, events and school dates visible to this profile. Calendar apps cannot change school records.</p>
  </section>;
}
