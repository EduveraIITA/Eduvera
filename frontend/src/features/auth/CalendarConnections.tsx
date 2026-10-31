import {useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {CalendarSync,Check,Copy,Download,ExternalLink,RefreshCw,Trash2} from 'lucide-react';
import {ProductIcon} from '../../components/ProductIcon';
import {apiFetch} from '../../lib/api';
import {shiftSchoolDate} from '../../lib/schoolTime';
import type {ProfileConnectionAudience} from './profileConnectionScope';
import {useOptionalExecutionEnvironment} from '../simulation/ExecutionEnvironmentContext';

interface Subscription {id:string;token_hint:string;created_at:string;last_fetched_at:string|null;revision:number;evidence_mode?:'live'|'simulation';external_subscription?:boolean}
interface Status {scope:{portal:ProfileConnectionAudience;student_id:string|null;calendar_name:string};subscription:Subscription|null;evidence_mode?:'live'|'simulation';external_subscription?:boolean}
interface Created extends Subscription {feed_url:string;calendar_name:string;evidence_mode?:'live'|'simulation';external_subscription?:boolean}

function parameters(audience:ProfileConnectionAudience,studentId?:string){
  return new URLSearchParams({portal:audience,...(studentId?{student_id:studentId}:{})});
}
function lastSync(value:string|null){
  if(!value)return 'Waiting for the calendar app to refresh';
  return `Last refreshed ${new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}`;
}

export function CalendarConnections({audience,studentId}:{audience:ProfileConnectionAudience;studentId?:string}){
  const environment=useOptionalExecutionEnvironment();
  const cache=useQueryClient();const queryString=useMemo(()=>parameters(audience,studentId).toString(),[audience,studentId]);
  const query=useQuery({queryKey:['calendar-connections',audience,studentId??'self'],queryFn:()=>apiFetch<Status>(`/api/v1/calendar-connections?${queryString}`),staleTime:15_000});
  const [created,setCreated]=useState<Created|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [confirm,setConfirm]=useState<'replace'|'disconnect'|null>(null);const [copied,setCopied]=useState(false);
  const subscription=query.data?.subscription??null;
  const simulated=environment?.mode==='simulation'||query.data?.evidence_mode==='simulation'||created?.evidence_mode==='simulation';
  async function create(){
    setBusy(true);setError('');setCopied(false);
    try{const result=await apiFetch<Created>('/api/v1/calendar-connections/subscriptions',{method:'POST',body:JSON.stringify({portal:audience,...(studentId?{student_id:studentId}:{})})});
      setCreated(result);setConfirm(null);await cache.invalidateQueries({queryKey:['calendar-connections',audience,studentId??'self']});
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not create the calendar connection.');}finally{setBusy(false);}
  }
  async function disconnect(){
    if(!subscription)return;setBusy(true);setError('');
    try{await apiFetch(`/api/v1/calendar-connections/subscriptions/${subscription.id}`,{method:'DELETE'});setCreated(null);setConfirm(null);await cache.invalidateQueries({queryKey:['calendar-connections',audience,studentId??'self']});}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not disconnect the calendar.');}finally{setBusy(false);}
  }
  function download(){
    const query=parameters(audience,studentId);query.set('from',shiftSchoolDate(-7));query.set('to',shiftSchoolDate(360));
    window.location.assign(`/api/v1/calendar-connections/export.ics?${query.toString()}`);
  }
  async function copy(){if(!created)return;try{await navigator.clipboard.writeText(created.feed_url);setCopied(true);}catch{setError('Copy was blocked. Open the calendar app instead.');}}
  function openCalendar(){if(created)window.location.assign(created.feed_url.replace(/^https?:/,'webcal:'));}
  function openPreview(){if(created)window.location.assign(created.feed_url);}
  const title=query.data?.scope?.calendar_name??'ThatCampus calendar';
  return <section className="account-profile-group account-calendar" aria-labelledby="calendar-connections-title">
    <div className="account-profile-row account-calendar__heading">
      <span className="account-profile-row__icon"><ProductIcon name="calendar" size={28}/></span>
      <span className="account-profile-row__copy"><strong id="calendar-connections-title">{simulated?'Run-local calendar preview':'Calendar sync'}</strong><small>{simulated?`Inspect ${title} from this isolated world`:`Keep ${title} in your installed calendar app`}</small></span>
    </div>
    {query.isPending?<p className="account-channels__state" role="status">Checking calendar connection…</p>:null}
    {query.isError?<p className="account-channels__state security-alert" role="alert">Could not load calendar sync. <button type="button" onClick={()=>void query.refetch()}>Retry</button></p>:null}
    {!query.isPending&&!query.isError?<div className="account-calendar__body">
      <div className="account-calendar__status">
        <span className={`account-calendar__mark${subscription?' is-connected':''}`} aria-hidden="true">{subscription?<Check size={18}/>:<CalendarSync size={18}/>}</span>
        <span><strong>{simulated?(subscription?'Run-local preview ready':'Create a calendar preview'):(subscription?'Subscribed calendar ready':'Connect your calendar')}</strong><small>{simulated?'Authenticated .ics only; no external calendar receives updates':subscription?lastSync(subscription.last_fetched_at):'Updates automatically without Google or Microsoft access'}</small></span>
      </div>
      {created?<div className="account-calendar__secret" role="status"><strong>{simulated?'Run-local preview created':'Private link created'}</strong><p>{simulated?'Download this authenticated preview while this Simulation world is selected. It is not an external subscription.':'Open it now or copy it. ThatCampus stores only a fingerprint, so this link is shown once.'}</p><div>
        <button type="button" onClick={simulated?openPreview:openCalendar}>{simulated?<Download size={15}/>:<ExternalLink size={15}/>} {simulated?'Open/download preview':'Open calendar app'}</button>
        {!simulated?<button type="button" onClick={()=>void copy()}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Copied':'Copy link'}</button>:null}
      </div></div>:null}
      <div className="account-calendar__actions">
        <button type="button" onClick={download}><Download size={15}/> Export .ics</button>
        {!subscription?<button className="is-primary" type="button" disabled={busy} onClick={()=>void create()}><CalendarSync size={15}/> {busy?'Creating…':simulated?'Create preview':'Subscribe'}</button>:null}
        {subscription&&confirm===null?<><button type="button" disabled={busy} onClick={()=>setConfirm('replace')}><RefreshCw size={15}/> {simulated?'Refresh preview':'Replace link'}</button><button className="is-danger" type="button" disabled={busy} onClick={()=>setConfirm('disconnect')}><Trash2 size={15}/> {simulated?'Remove preview':'Disconnect'}</button></>:null}
      </div>
      {confirm?<div className="account-calendar__confirm" role="alert"><span>{simulated?(confirm==='replace'?'The current run-local preview will be replaced.':'This run-local preview will be removed.'):(confirm==='replace'?'The old calendar link will stop refreshing.':'The installed calendar will stop receiving updates.')}</span><div><button type="button" onClick={()=>setConfirm(null)}>Keep it</button><button type="button" disabled={busy} onClick={()=>void (confirm==='replace'?create():disconnect())}>{simulated?(confirm==='replace'?'Refresh':'Remove'):(confirm==='replace'?'Replace':'Disconnect')}</button></div></div>:null}
    </div>:null}
    {error?<p className="account-channels__state security-alert" role="alert">{error}</p>:null}
    <p className="account-profile-explainer">{simulated?'This preview is generated only from the isolated Simulation world. No public token is created and no calendar app is subscribed.':'ThatCampus sends only the timetable, assessments, events and school dates visible to this profile. Calendar apps cannot change school records.'}</p>
  </section>;
}
